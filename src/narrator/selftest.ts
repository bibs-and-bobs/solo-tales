/* Provider & Narrator Readiness Benchmark (5-Scene Self-Test).
   Runs fixed investigative/social/retry/multi-wish scenes through the user's configured ModelRouter
   against a throwaway copy of Brookhollow and validates JSON compliance, event application,
   zero secret leakage, budget bounds, length/ending rules, and no repeat failed rolls. */

import type { ModelRouter } from "../adapters/llm/router";
import {
  applyEvents,
  applyStorySegments,
  checkLabel,
  clone,
  commitBundleInPlace,
  createCampaignBundle,
  DEFAULT_SETTING,
  emptyDirty,
  entryFor,
  flagLeaks,
  knows,
  type CampaignBundle,
  type WorldFact
} from "../engine";
import { selectBudgetProfile } from "./budgets";
import { cleanReply } from "./cleaners";
import { buildStoryPacket } from "./packets";

export interface BenchmarkSceneSpec {
  name: string;
  input: string;
  failed?: {
    label: string;
    you: string;
    total: number;
    dc: number;
    skill: string;
  };
  both?: string[];
}

export interface BenchmarkCheckResult {
  ok: boolean;
  what: string;
  why: string;
}

export interface BenchmarkSceneResult {
  name: string;
  model: string;
  tokens: number;
  poolChars: number;
  words?: number;
  revealed?: number;
  text?: string;
  error?: string;
  checks: BenchmarkCheckResult[];
}

export const BENCHMARK_SCENES: readonly BenchmarkSceneSpec[] = [
  { name: "Talk", input: "I sit at the bar and ask Mara what she knows about Tomas." },
  { name: "Search", input: "While Aldric looks away, I search the ledger on his counter." },
  { name: "Pressure", input: "I grab Aldric by the collar and demand the truth about his son." },
  {
    name: "Retry",
    input: "I study Aldric's face again for the lie.",
    failed: {
      label: "Insight check",
      you: "I study Aldric's face for a lie",
      total: 9,
      dc: 15,
      skill: "insight"
    }
  },
  {
    name: "Wishes",
    input:
      "1. I ask Mara for a room for the night. 2. I order a hot meal. 3. I ask Aldric where his son kept the mill key.",
    both: ["Mara Holt", "Aldric"]
  }
];

export function createBenchmarkWorld(): CampaignBundle {
  const bundle = createCampaignBundle({
    name: "Self-test",
    setting: DEFAULT_SETTING,
    heroKey: "fighter"
  });
  const here = "place_the-drowned-oar";
  Object.assign(bundle.campaign, {
    turn: 4,
    place: here,
    mood: "tense",
    summary: "Aldric the miller hired the hero to find his son Tomas, missing three days.",
    beats: ["The hero reached the inn at dusk"]
  });

  bundle.entities = {
    [here]: {
      id: here,
      kind: "place",
      name: "The Drowned Oar",
      desc: "a low riverside inn, smoky and half empty",
      first: 1,
      visited: 4
    },
    npc_mara: {
      id: "npc_mara",
      kind: "npc",
      name: "Mara Holt",
      role: "innkeeper",
      att: 1,
      loc: here,
      seen: 4,
      met: 1
    },
    npc_aldric: {
      id: "npc_aldric",
      kind: "npc",
      name: "Aldric",
      role: "the miller, Tomas's father",
      att: 0,
      loc: here,
      seen: 4,
      met: 1
    },
    "item_iron-key": {
      id: "item_iron-key",
      kind: "item",
      name: "Iron key",
      desc: "cold, with a crude mark on the bow",
      loc: null,
      seen: 3
    }
  };

  const makeFact = (id: string, text: string, known: string[], turn: number): WorldFact => ({
    id,
    text,
    turn,
    place: here,
    pinned: false,
    about: [],
    known,
    truth: true
  });

  bundle.facts = {
    fact_seen: makeFact("fact_seen", "Tomas was last seen walking to the old mill.", ["player"], 2),
    fact_debt: makeFact(
      "fact_debt",
      "Aldric sold his son's gambling debt to the goblin boss.",
      ["npc_aldric"],
      1
    ),
    fact_letter: makeFact(
      "fact_letter",
      "Mara hides a letter from Tomas under the bar.",
      ["npc_mara"],
      1
    )
  };

  for (let i = 1; i <= 40; i++) {
    bundle.facts["fact_old" + i] = makeFact(
      "fact_old" + i,
      `An old rumour, number ${i}, about the river trade and the toll bridge.`,
      ["player"],
      0
    );
  }

  return bundle;
}

export async function runBenchmarkScene(
  sc: BenchmarkSceneSpec,
  router: ModelRouter,
  opts?: { strong?: boolean; signal?: AbortSignal }
): Promise<BenchmarkSceneResult> {
  const baseWorld = createBenchmarkWorld();
  const bundle = clone(baseWorld);
  bundle.dirty = emptyDirty();

  if (sc.failed) {
    bundle.log = [
      {
        t: bundle.campaign.turn,
        you: sc.failed.you,
        segs: [],
        chips: [],
        roll: {
          label: sc.failed.label,
          dice: [sc.failed.total - 3],
          kept: sc.failed.total - 3,
          bonus: 3,
          total: sc.failed.total,
          dc: sc.failed.dc,
          ok: false,
          why: "",
          adv: 0
        }
      }
    ];
  }

  const task = opts?.strong ? "story_strong" : "story_turn";
  const conn = router.peekBestConnection(task);
  const budget = selectBudgetProfile(conn, router.isEconomyActive());
  const pkt = buildStoryPacket(bundle, sc.input, { budget });

  const res: BenchmarkSceneResult = {
    name: sc.name,
    model: conn ? `${conn.label} (${conn.model})` : "unconfigured",
    tokens: pkt.meta.estTokens,
    poolChars: pkt.meta.poolChars,
    checks: []
  };

  const addCheck = (ok: boolean, what: string, why: string) => {
    res.checks.push({ ok, what, why: ok ? "" : why });
  };

  const poolCap = budget.slots.pool || 800;
  addCheck(
    pkt.meta.poolChars <= poolCap && pkt.meta.secretCount === 2,
    "Packet within budget, both secrets tagged",
    `pool ${pkt.meta.poolChars} of ${poolCap} chars, ${pkt.meta.secretCount} of 2 secrets tagged`
  );

  let reply = null;
  try {
    const llmResp = await router.complete({
      task,
      priority: 1,
      system: pkt.system,
      user: pkt.user,
      jsonMode: true,
      maxOutputTokens: budget.maxOutputTokens,
      signal: opts?.signal
    });
    res.model = `${llmResp.model}`;
    reply = cleanReply(llmResp.json, bundle);
  } catch (err: any) {
    res.error = err?.message || String(err);
  }

  addCheck(
    Boolean(reply),
    "Reply in the required JSON shape",
    res.error || "Reply did not match the narrator JSON schema"
  );

  if (reply) {
    const entry = entryFor(bundle, sc.input);
    commitBundleInPlace(bundle, "benchmark scene", (draft, tx) => {
      applyStorySegments(draft, reply.story, entry);
      applyEvents(draft, reply.events, entry, tx);
      if (reply.check && reply.success) {
        applyStorySegments(draft, reply.success.story, entry);
        applyEvents(draft, reply.success.events, entry, tx);
      }
      flagLeaks(entry, draft.facts);
    });

    const bad = [...(entry.failed || []).map(x => x.ev), ...(entry.skipped || [])];
    const proposedCount =
      reply.events.length + (reply.check && reply.success ? reply.success.events.length : 0);
    addCheck(
      bad.length === 0,
      `Every event applied (${proposedCount} proposed)`,
      "Not applied: " + bad.join("; ")
    );

    addCheck(
      !entry.leak || entry.leak.length === 0,
      "No secret stated without a reveal event",
      "Stated without reveal: " +
        (entry.leak || []).map(id => baseWorld.facts[id]?.text || id).join(" / ")
    );

    const told = [...reply.story, ...(reply.check && reply.success ? reply.success.story : [])];
    const lastNarr = told.filter(x => x.n).at(-1)?.n || "";
    res.words = told
      .map(x => x.n || x.text || "")
      .join(" ")
      .split(/\s+/)
      .filter(Boolean).length;

    addCheck(
      res.words <= 185 && !/\?\s*$/.test(lastNarr),
      `At most 185 words (${res.words}), ending on the scene`,
      lastNarr ? `Ends: ${lastNarr.slice(-60)}` : "Too long"
    );

    if (sc.failed) {
      addCheck(
        !(reply.check && reply.check.key === sc.failed.skill),
        "No new roll for the check that just failed",
        "Asked for " +
          checkLabel(
            reply.check
              ? { kind: reply.check.kind, key: reply.check.key }
              : { kind: "skill", key: sc.failed.skill }
          ) +
          " again"
      );
    }

    if (sc.both) {
      const allText = told.map(x => `${x.say || ""} ${x.n || x.text || ""}`).join(" ");
      const missing = sc.both.filter(n => !allText.includes(n.split(" ")[0]));
      addCheck(
        missing.length === 0,
        `Every wish handled in one reply (${sc.both.join(" and ")})`,
        `Missing: ${missing.join(", ")}`
      );
    }

    res.revealed = ["fact_debt", "fact_letter"].filter(id => knows(bundle.facts[id])).length;
    res.text = entry.segs
      .map(x => x.n || (x.say ? `${x.say}: "${x.text}"` : ""))
      .filter(Boolean)
      .join(" ");
  }

  return res;
}

export async function runFullNarratorBenchmark(
  router: ModelRouter,
  opts?: {
    strong?: boolean;
    scenes?: readonly BenchmarkSceneSpec[];
    onSceneDone?: (res: BenchmarkSceneResult) => void;
    signal?: AbortSignal;
  }
): Promise<BenchmarkSceneResult[]> {
  const list = opts?.scenes ?? BENCHMARK_SCENES;
  const results: BenchmarkSceneResult[] = [];
  for (const sc of list) {
    if (opts?.signal?.aborted) break;
    const r = await runBenchmarkScene(sc, router, { strong: opts?.strong, signal: opts?.signal });
    results.push(r);
    opts?.onSceneDone?.(r);
  }
  return results;
}
