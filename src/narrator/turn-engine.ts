/* High-level Narrator Turn Orchestrator.
   Connects the pure headless CampaignBundle engine with the ModelRouter & Packet/Cleaner pipeline
   so UI components remain 100% free of LLM prompt construction, JSON parsing, or clock bookkeeping. */

import type { ModelRouter } from "../adapters/llm/router";
import {
  addCombatFlavour,
  applyTurnReplyInBundle,
  cleanRuling,
  clone,
  commitBundleInPlace,
  isObj,
  str,
  type CampaignBundle,
  type CleanedTurnReply,
  type CombatRoundEntry,
  type CombatState
} from "../engine";
import { selectBudgetProfile } from "./budgets";
import { cleanReply, cleanRound } from "./cleaners";
import {
  buildAskPacket,
  buildEpitaphPacket,
  buildFoldPacket,
  buildRoundPacket,
  buildRulingPacket,
  buildStoryPacket
} from "./packets";

export const CONTINUE_DIRECTOR_NOTE =
  "The player lets the scene move on without acting. At least 10 minutes pass (add a time event); someone acts or something happens.";

export function combatTurnSignature(cs: CombatState): string {
  return `${cs.round}:${cs.cur}:${cs.log.length}:${cs.turn?.action}:${cs.turn?.bonus}:${cs.turn?.move}`;
}

export async function requestStoryTurn(
  bundle: CampaignBundle,
  router: ModelRouter,
  input: string,
  opts?: {
    strong?: boolean;
    opening?: boolean;
    note?: string;
    minTime?: number;
    signal?: AbortSignal;
    onFoldNeeded?: () => void;
    onDead?: (campaignId: string) => void;
  }
): Promise<{ reply: CleanedTurnReply; connectionId: string }> {
  const task = opts?.strong ? "story_strong" : "story_turn";
  const conn = router.peekBestConnection(task);
  const budget = selectBudgetProfile(conn, router.isEconomyActive());
  const isDirector = Boolean(opts?.opening || opts?.note);

  const pkt = buildStoryPacket(bundle, input, {
    opening: opts?.opening,
    directorNote: isDirector,
    budget
  });

  const resp = await router.complete({
    task,
    priority: 1,
    system: pkt.system,
    user: pkt.user,
    jsonMode: true,
    maxOutputTokens: budget.maxOutputTokens,
    signal: opts?.signal
  });

  const reply = cleanReply(resp.json, bundle);
  if (!reply) {
    throw new Error("The narrator's reply did not match the expected story format.");
  }

  const res = commitBundleInPlace(bundle, "story turn", (draft, tx) => {
    // Mark any triggered clocks that were dispatched in this packet so they only fire once!
    for (const clkId of pkt.meta.triggeredClockIds) {
      const clk = draft.clocks[clkId];
      if (clk) {
        clk.directorDispatched = true;
        clk.knownToPlayer = true;
        draft.dirty.k.add(clkId);
        draft.unread.journal = true;
      }
    }

    applyTurnReplyInBundle(draft, reply, input, tx, {
      opening: opts?.opening,
      note: opts?.note,
      minTime: opts?.minTime,
      foldBeatThreshold: router.getMemoryFoldThreshold(),
      onFoldNeeded: opts?.onFoldNeeded,
      onDead: opts?.onDead
    });
  });

  if (!res.ok) {
    throw new Error("Something went wrong applying that turn, so nothing changed.");
  }

  return { reply, connectionId: resp.connectionId };
}

function locateFightRound(
  bundle: CampaignBundle,
  combatId: string,
  roundNum: number,
  forWrite: boolean
): { rd: CombatRoundEntry; activeCombat: CampaignBundle["campaign"]["combat"] } | null {
  if (bundle.campaign.combat?.id === combatId) {
    const rd = bundle.campaign.combat.feed.find(r => r.round === roundNum);
    return rd ? { rd, activeCombat: bundle.campaign.combat } : null;
  }
  const idx = bundle.log.findLastIndex(x => x.fight?.id === combatId);
  if (idx < 0) return null;
  if (forWrite) {
    bundle.log[idx] = clone(bundle.log[idx]);
    if (bundle.log[idx].chunk != null) bundle.dirty.c.add(bundle.log[idx].chunk!);
  }
  const rd = bundle.log[idx].fight?.rounds.find(r => r.round === roundNum) as
    | CombatRoundEntry
    | undefined;
  return rd ? { rd, activeCombat: null } : null;
}

export async function narrateCombatRound(
  bundle: CampaignBundle,
  router: ModelRouter,
  combatId: string,
  roundNum: number
): Promise<boolean> {
  const found = locateFightRound(bundle, combatId, roundNum, false);
  if (!found || found.rd.status !== "narrating") return false;

  // Economy Mode skips per-round LLM embellishment without marking error
  if (router.isEconomyActive()) {
    commitBundleInPlace(bundle, "economy skip round narration", draft => {
      const w = locateFightRound(draft, combatId, roundNum, true);
      if (w && w.rd.status === "narrating") {
        w.rd.status = "done";
      }
    });
    return false;
  }

  const pkt = buildRoundPacket(bundle, found.rd, found.activeCombat);
  let cleaned = null;
  try {
    const resp = await router.complete({
      task: "combat_round",
      priority: 3,
      system: pkt.system,
      user: pkt.user,
      jsonMode: true,
      maxOutputTokens: 220
    });
    if (resp.skippedByEconomy) {
      commitBundleInPlace(bundle, "economy skip round narration", draft => {
        const w = locateFightRound(draft, combatId, roundNum, true);
        if (w && w.rd.status === "narrating") w.rd.status = "done";
      });
      return false;
    }
    cleaned = cleanRound(resp.json, bundle, found.activeCombat);
  } catch {
    cleaned = null;
  }

  return commitBundleInPlace(bundle, "round narration", draft => {
    const w = locateFightRound(draft, combatId, roundNum, true);
    if (w && w.rd.status === "narrating") {
      w.rd.narr = cleaned;
      w.rd.status = cleaned ? "done" : "failed";
    }
  }).ok;
}

export async function requestCombatRuling(
  bundle: CampaignBundle,
  router: ModelRouter,
  text: string
): Promise<{ applied: boolean; note: string }> {
  const c = bundle.campaign.combat;
  if (!c || c.phase !== "fight" || !c.cs) {
    return { applied: false, note: "Not in an active fight." };
  }
  const cid = c.id;
  const sig = combatTurnSignature(c.cs);
  const pkt = buildRulingPacket(bundle, text);

  let line = "";
  let ruling = null;
  let hadErr = false;

  try {
    const resp = await router.complete({
      task: "ruling",
      priority: 1,
      system: pkt.system,
      user: pkt.user,
      jsonMode: true,
      maxOutputTokens: 450
    });
    if (!isObj(resp.json)) throw new Error("Invalid ruling JSON");
    line = str(resp.json.line, 240);
    ruling =
      resp.json.ruling == null ? null : cleanRuling(resp.json.ruling, true, bundle.campaign.char);
    if (resp.json.ruling != null && !ruling) throw new Error("Unusable ruling");
  } catch {
    hadErr = true;
  }

  const cNow = bundle.campaign.combat;
  if (!cNow || cNow.id !== cid) {
    return { applied: false, note: "" };
  }

  const moved =
    cNow.phase !== "fight" ||
    !cNow.cs ||
    combatTurnSignature(cNow.cs) !== sig ||
    Boolean(cNow.roll) ||
    Boolean(cNow.ruling);

  if (moved || hadErr || !ruling) {
    commitBundleInPlace(bundle, "ruling fallback flavour", draft => addCombatFlavour(draft, text));
    const note = moved
      ? "The fight moved on before the ruling came back, so your words colour this round instead."
      : hadErr
      ? "No ruling came back, so your words colour this round's narration instead. Try again, or use a command."
      : (line ? line + " " : "") + "Your words colour this round's narration.";
    return { applied: false, note };
  }

  const rulingFinal = ruling;
  commitBundleInPlace(bundle, "combat ruling", draft => {
    draft.campaign.combat!.ruling = {
      text,
      line,
      ruling: rulingFinal,
      capped: rulingFinal.capped
    };
  });
  return { applied: true, note: "" };
}

export async function foldCampaignMemory(
  bundle: CampaignBundle,
  router: ModelRouter
): Promise<boolean> {
  if (!bundle.campaign.beats.length) return false;
  const pkt = buildFoldPacket(bundle);
  try {
    const resp = await router.complete({
      task: "memory_fold",
      priority: 3,
      system: pkt.system,
      user: pkt.user,
      jsonMode: true,
      maxOutputTokens: 360
    });
    if (!isObj(resp.json) || !resp.json.chapter) return false;
    const chapter = str(resp.json.chapter, 600);
    const summary = resp.json.summary ? str(resp.json.summary, 1200) : "";
    return commitBundleInPlace(bundle, "memory fold", draft => {
      const folded = new Set(pkt.beatsSnapshot);
      const added = draft.campaign.beats.filter(b => !folded.has(b));
      draft.campaign.chapter = chapter;
      if (summary) draft.campaign.summary = summary;
      draft.campaign.beats = [...pkt.beatsSnapshot.slice(-2), ...added];
    }).ok;
  } catch {
    return false;
  }
}

export async function generateHeroEpitaph(
  bundle: CampaignBundle,
  router: ModelRouter
): Promise<string> {
  const pkt = buildEpitaphPacket(bundle);
  let text = "";
  try {
    const resp = await router.complete({
      task: "epitaph",
      priority: 1,
      system: pkt.system,
      user: pkt.user,
      jsonMode: true,
      maxOutputTokens: 200
    });
    text = str(resp.json?.epitaph, 400);
  } catch {
    text = "";
  }
  if (!text) {
    text = `${bundle.campaign.char.name} fell far from home, and the valley kept the story.`;
  }
  commitBundleInPlace(bundle, "epitaph", draft => {
    draft.campaign.epitaph = text;
  });
  return text;
}

export async function askWorldQuestion(
  bundle: CampaignBundle,
  router: ModelRouter,
  question: string,
  opts?: {
    deep?: boolean;
    signal?: AbortSignal;
    onChunk?: (fullTextSoFar: string) => void;
  }
): Promise<string> {
  const q = str(question, 500);
  if (!q) return "";
  const task = opts?.deep ? "story_strong" : "ask_world";
  const conn = router.peekBestConnection(task);
  const budget = selectBudgetProfile(conn, router.isEconomyActive());
  const pkt = buildAskPacket(bundle, q, budget.name === "compact");

  let acc = "";
  const resp = await router.complete({
    task,
    priority: 1,
    system: pkt.system,
    user: pkt.user,
    jsonMode: false,
    maxOutputTokens: 320,
    signal: opts?.signal,
    onStreamChunk: delta => {
      acc += delta;
      opts?.onChunk?.(acc);
    }
  });

  const finalText = resp.text.trim() || acc.trim();
  opts?.onChunk?.(finalText);
  return finalText;
}
