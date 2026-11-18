/* Pure Headless Campaign State Machine & Transactional Operations. */

import { arr, clamp, clone, d, hurtWord, rid, str, type Mood } from "../util";
import { CONDITIONS, LOOT_NOTES, MONSTERS, XP_AT, mod, type ConditionKey } from "../rules/srd";
import {
  DEFAULT_SETTING,
  HEROES,
  TONES,
  checkBonus,
  checkLabel,
  fightReward,
  recordHpTrail,
  refFromName,
  syncChar,
  type CharacterState,
  type NormalizedCheck
} from "../rules/character";
import { resolveMonsterDef } from "../rules/foe-roster";
import { Combat, type CombatActor, type CombatResult } from "../combat/combat";
import { aboutOf, flagLeaks, presentNpcsIn } from "./knowledge";
import {
  advanceTimeInBundle,
  applyEvents,
  applyHeroDamage,
  applyHeroHeal,
  ensureNpc,
  foeSummary,
  npcByName,
  type TxContext
} from "./events";
import {
  DEFAULT_PREFS,
  SCHEMA,
  type ActiveCombat,
  type CampaignArtBrief,
  type CampaignBundle,
  type CampaignFlavour,
  type CombatRoundEntry,
  type DirtyTracker,
  type LogEntry,
  type NarratorEvent,
  type PendingCheckBranch,
  type StorySegment
} from "./types";

export function emptyDirty(): DirtyTracker {
  return {
    e: new Set(),
    f: new Set(),
    d: new Set(),
    k: new Set(),
    r: new Set(),
    c: new Set()
  };
}

export function cloneDirty(dt: DirtyTracker): DirtyTracker {
  return {
    e: new Set(dt.e),
    f: new Set(dt.f),
    d: new Set(dt.d),
    k: new Set(dt.k),
    r: new Set(dt.r),
    c: new Set(dt.c)
  };
}

export function createCampaignBundle(opts: {
  name?: string;
  setting?: { premise?: string; tone?: string };
  heroKey?: "fighter" | "rogue";
  heroName?: string;
  heroAppearance?: string;
  heroPortraitId?: string | null;
  customChar?: CharacterState;
  flavour?: CampaignFlavour | null;
  artBrief?: CampaignArtBrief | null;
  writer?: string;
}): CampaignBundle {
  const heroKey = opts.heroKey === "rogue" ? "rogue" : "fighter";
  let ch: any;
  if (opts.customChar) {
    ch = clone(opts.customChar);
    if (opts.heroName) ch.name = str(opts.heroName, 30) || ch.name;
    if (opts.heroAppearance) ch.appearance = str(opts.heroAppearance, 260);
    if (opts.heroPortraitId !== undefined) ch.portraitId = opts.heroPortraitId;
  } else {
    const tpl = clone(HEROES[heroKey]);
    ch = { ...tpl };
    delete ch.blurb;
    if (opts.heroName) ch.name = str(opts.heroName, 30) || ch.name;
    if (opts.heroAppearance) ch.appearance = str(opts.heroAppearance, 260);
    if (opts.heroPortraitId !== undefined) ch.portraitId = opts.heroPortraitId;
    ch.inv = tpl.inv.map(i => ({ id: rid(), ...i, ref: i.ref || refFromName(i.name) }));
    syncChar(ch);
  }

  const tone = opts.setting?.tone && TONES.includes(opts.setting.tone) ? opts.setting.tone : TONES[0];
  const premise = str(opts.setting?.premise, 600) || DEFAULT_SETTING.premise;

  return {
    campaign: {
      v: SCHEMA,
      writer: opts.writer || rid(),
      id: rid(),
      name: str(opts.name, 40) || "Brookhollow",
      created: Date.now(),
      updated: Date.now(),
      turn: 0,
      status: "active",
      setting: { premise, tone },
      flavour: opts.flavour || null,
      artBrief: opts.artBrief || null,
      char: ch,
      time: 16 * 60,
      place: null,
      mood: "calm",
      summary: "",
      chapter: "",
      beats: [],
      recent: [],
      quests: [],
      options: [],
      pending: null,
      combat: null,
      nextAdv: 0,
      prefs: DEFAULT_PREFS,
      logChunk: 0,
      learn: true
    },
    entities: {},
    facts: {},
    deeds: {},
    clocks: {},
    foeRoster: {},
    log: [],
    dirty: emptyDirty(),
    unread: { quests: false, journal: false }
  };
}

export interface TransactionOutcome {
  ok: boolean;
  bundle: CampaignBundle;
  undo: CampaignBundle | null;
  after: Array<() => void>;
  error?: unknown;
}

/** Pure transactional state transition: clones the bundle, runs fn, and returns either the new bundle or the untouched input on error. */
export function transactBundle(
  live: CampaignBundle,
  label: string,
  fn: (draft: CampaignBundle, tx: TxContext) => void
): TransactionOutcome {
  const tx: TxContext = { label, timeSet: false, dmg: 0, after: [] };
  const draft: CampaignBundle = {
    campaign: clone(live.campaign),
    entities: clone(live.entities),
    facts: clone(live.facts),
    deeds: clone(live.deeds),
    clocks: clone(live.clocks),
    foeRoster: clone(live.foeRoster),
    log: clone(live.log),
    dirty: cloneDirty(live.dirty),
    unread: { ...live.unread }
  };
  try {
    fn(draft, tx);
    return {
      ok: true,
      bundle: draft,
      undo: live,
      after: tx.after
    };
  } catch (error) {
    return {
      ok: false,
      bundle: live,
      undo: null,
      after: [],
      error
    };
  }
}

/** Runs `transactBundle` and atomically swaps the committed state onto `target` only on full success. */
export function commitBundleInPlace(
  target: CampaignBundle,
  label: string,
  fn: (draft: CampaignBundle, tx: TxContext) => void
): TransactionOutcome {
  const res = transactBundle(target, label, fn);
  if (res.ok) {
    target.campaign = res.bundle.campaign;
    target.entities = res.bundle.entities;
    target.facts = res.bundle.facts;
    target.deeds = res.bundle.deeds;
    target.clocks = res.bundle.clocks;
    target.foeRoster = res.bundle.foeRoster;
    target.log = res.bundle.log;
    target.dirty = res.bundle.dirty;
    target.unread = res.bundle.unread;
    for (const f of res.after) {
      setTimeout(() => {
        try {
          f();
        } catch {
          // ignore follow-up error
        }
      }, 0);
    }
  }
  return res;
}

/** Replaces a live CampaignBundle's fields from a snapshot (used for single-step turn undo). */
export function replaceBundleInPlace(target: CampaignBundle, snapshot: CampaignBundle): void {
  const fresh = clone(snapshot);
  target.campaign = fresh.campaign;
  target.entities = fresh.entities;
  target.facts = fresh.facts;
  target.deeds = fresh.deeds;
  target.clocks = fresh.clocks;
  target.foeRoster = fresh.foeRoster;
  target.log = fresh.log;
  target.dirty = fresh.dirty;
  target.unread = fresh.unread;
}

export function entryFor(bundle: CampaignBundle, input: string): LogEntry {
  return { t: bundle.campaign.turn + 1, you: input, segs: [], chips: [], roll: null };
}

export function pushLog(bundle: CampaignBundle, entry: LogEntry): void {
  const G = bundle.campaign;
  const inChunk = bundle.log.filter(x => x.chunk === G.logChunk).length;
  if (inChunk >= 25) G.logChunk++;
  entry.chunk = G.logChunk;
  bundle.log.push(entry);
  bundle.dirty.c.add(entry.chunk);
}

export function applyStorySegments(
  bundle: CampaignBundle,
  story: StorySegment[] | undefined,
  entry: LogEntry
): void {
  for (const s of story || []) {
    entry.segs.push(s);
    if (!s.say) continue;
    try {
      const e = npcByName(bundle.entities, s.say) || ensureNpc(bundle, s.say, "", 0);
      if (e.combatStatus !== "dead") {
        e.loc = bundle.campaign.place;
        e.seen = bundle.campaign.turn;
      }
      bundle.dirty.e.add(e.id);
    } catch {
      // speaker skipped
    }
  }
}

export function addItemToBag(
  bundle: CampaignBundle,
  name: string,
  qty: number,
  note = ""
): void {
  const inv = bundle.campaign.char.inv;
  const ex = inv.find(i => i.name.toLowerCase() === name.toLowerCase());
  if (ex) ex.qty = Math.min(999, ex.qty + qty);
  else inv.push({ id: rid(), name: str(name, 40), note: str(note, 60), qty, ref: refFromName(name) });
}

/* ---- Combat Integration & PT-030 Entity Sync ---- */
const RESULT_WORDS: Readonly<Record<"victory" | "defeat" | "fled", string>> = {
  victory: "won",
  defeat: "lost",
  fled: "got away"
};

export function newRoundEntry(round: number): CombatRoundEntry {
  return { round, lines: [], notes: [], flavour: "", init: null, narr: null, status: "open" };
}

export function addCombatFlavour(bundle: CampaignBundle, text: string): void {
  const rd = bundle.campaign.combat?.feed.at(-1);
  const t = str(text, 200);
  if (!rd || !t || rd.status !== "open") return;
  rd.flavour = str((rd.flavour ? rd.flavour + "; " : "") + t, 300);
}

export function markHeroDead(bundle: CampaignBundle, onDead?: (campaignId: string) => void): void {
  const G = bundle.campaign;
  const prevHp = G.char.hp;
  G.status = "dead";
  G.char.hp = 0;
  recordHpTrail(G.char, prevHp);
  G.pending = null;
  if (onDead) onDead(G.id);
}

/** Absorbs a CombatResult into bundle.campaign.combat, returning round numbers that closed and need optional narration. */
export function absorbCombatResult(
  bundle: CampaignBundle,
  r: CombatResult,
  opts?: { skipRoundNarration?: boolean; onDead?: (campaignId: string) => void }
): { closedRounds: number[] } {
  const c = bundle.campaign.combat!;
  c.cs = r.cs!;
  const closedRounds: number[] = [];
  let cur = c.feed.at(-1);
  if (!cur || cur.status !== "open") {
    cur = newRoundEntry(c.cs.round);
    c.feed.push(cur);
  }
  const closeRound = (rd: CombatRoundEntry) => {
    if (!rd || rd.status !== "open") return;
    if (!rd.lines.length || opts?.skipRoundNarration) {
      rd.status = "done";
      return;
    }
    rd.status = "narrating";
    closedRounds.push(rd.round);
  };

  const quiet = `${c.cs.actors.pc.name} ends the turn`;
  for (const line of r.lines) {
    const m = /^Round (\d+): /.exec(line);
    if (m) {
      if (+m[1] > cur.round) {
        closeRound(cur);
        cur = newRoundEntry(+m[1]);
        c.feed.push(cur);
      }
      continue;
    }
    if (line !== quiet) cur.lines.push(str(line, 200));
  }
  cur.lines = cur.lines.slice(-40);
  for (const n of r.notes || []) {
    if (!cur.notes.includes(n) && cur.notes.length < 6) cur.notes.push(str(n, 240));
  }
  if (c.cs.over) {
    closeRound(cur);
    finishFightInBundle(bundle, opts?.onDead);
  }
  c.feed = c.feed.slice(-40);
  return { closedRounds };
}

export function finishFightInBundle(
  bundle: CampaignBundle,
  onDead?: (campaignId: string) => void
): void {
  const G = bundle.campaign;
  const c = G.combat!;
  const out = Combat.outcome(c.cs)!;
  const ch = G.char;
  const chips: Array<[string, string]> = [];
  const before = ch.hp;

  c.phase = "over";
  c.result = out.result && ["victory", "defeat", "fled"].includes(out.result) ? out.result : "victory";
  c.roll = null;
  c.ruling = null;

  ch.hp = clamp(Math.round(out.hp), 0, ch.maxHp);
  if (ch.hp !== before) {
    recordHpTrail(ch, before);
    chips.push([`${ch.hp > before ? "+" : ""}${ch.hp - before} HP`, ch.hp > before ? "heal" : "hurt"]);
  }
  ch.conditions = arr<ConditionKey>(out.conditions, k => CONDITIONS.includes(k));
  for (const [k, r] of Object.entries(out.res || {})) {
    if (ch.res?.[k] && Number.isFinite(r?.left)) {
      ch.res[k].left = clamp(r.left, 0, ch.res[k].max);
    }
  }
  for (const [id, n] of Object.entries(out.spent || {})) {
    const it = ch.inv.find(i => i.id === id);
    if (!it || !(n > 0)) continue;
    const q = Math.min(it.qty, Math.round(n));
    it.qty -= q;
    chips.push([`- ${it.name}${q > 1 ? " x" + q : ""}`, ""]);
  }
  ch.inv = ch.inv.filter(i => i.qty > 0);
  syncChar(ch);

  const rounds = c.cs!.round;
  const foesLabel = foeSummary(c.spec.foes, bundle.foeRoster);
  advanceTimeInBundle(bundle, Math.max(1, Math.ceil((rounds * 6) / 60)), chips);
  G.beats.push(`${ch.name} fought ${foesLabel} and ${RESULT_WORDS[c.result]} in ${rounds} round${rounds > 1 ? "s" : ""}`);
  G.beats = G.beats.slice(-14);

  // Fix PT-030: Synchronize any named NPC foes back to bundle.entities & facts!
  for (const f of out.foes) {
    const npc =
      (f.npcId && bundle.entities[f.npcId]) ||
      npcByName(bundle.entities, f.name);
    if (!npc || npc.kind !== "npc") continue;
    if (f.status === "dead") {
      npc.combatStatus = "dead";
      npc.loc = null;
      bundle.dirty.e.add(npc.id);
      const text = `${npc.name} was slain in battle.`;
      if (!Object.values(bundle.facts).some(x => x.text.toLowerCase() === text.toLowerCase())) {
        const fid = "fact_" + rid().slice(0, 5);
        bundle.facts[fid] = {
          id: fid,
          text,
          turn: G.turn,
          place: G.place,
          pinned: false,
          about: [npc.id],
          known: ["player"],
          truth: true
        };
        bundle.dirty.f.add(fid);
      }
    } else if (f.status === "out" || f.status === "surrendered") {
      npc.combatStatus = "captured";
      npc.att = Math.min(npc.att ?? 0, -1);
      bundle.dirty.e.add(npc.id);
    } else if (f.status === "fled") {
      npc.combatStatus = "fled";
      npc.loc = null;
      npc.att = Math.min(npc.att ?? 0, -1);
      bundle.dirty.e.add(npc.id);
    }
  }

  if (c.result === "defeat" && out.dead) {
    c.dead = true;
    chips.push(["Killed outright", "hurt"]);
    markHeroDead(bundle, onDead);
  } else if (c.result === "defeat") {
    ch.dying = { s: 0, f: 0 };
    if (!ch.conditions.includes("unconscious")) ch.conditions.push("unconscious");
    chips.push(["Down and dying", "hurt"]);
  } else {
    chips.push([c.result === "fled" ? "Got away" : "Fight won", c.result === "fled" ? "" : "loot"]);
  }

  const rw = fightReward(out, c.result, c.seed);
  if (rw.xp && !c.dead) {
    ch.xp = Math.min(1e7, ch.xp + rw.xp);
    chips.push([`+${rw.xp} XP`, "loot"]);
    if (ch.xp >= (XP_AT[ch.level] ?? Infinity)) chips.push(["Level up ready", "loot"]);
  }
  if (rw.gold) {
    ch.gold = Math.min(1e7, ch.gold + rw.gold);
    chips.push([`+${rw.gold} gold`, "loot"]);
  }
  for (const it of rw.items) {
    addItemToBag(bundle, it.name, it.qty, LOOT_NOTES[it.name] || "");
    chips.push([`+ ${it.name}${it.qty > 1 ? " x" + it.qty : ""}`, "loot"]);
  }
  syncChar(ch);
  c.reward = { xp: c.dead ? 0 : rw.xp, gold: rw.gold, items: rw.items };
  c.chips = chips;
}

export function buildFightDeeds(bundle: CampaignBundle, c: ActiveCombat) {
  const out = Combat.outcome(c.cs);
  const foes = arr(out?.foes);
  const deeds: Array<{ what: string; tags: string[]; weight: number; foe: string | null; witnesses: string[] }> = [];
  const plural = (n: number, nm: string) => (n > 1 ? `${n} ${nm}s` : `a ${nm}`);
  const eyes = [
    ...presentNpcsIn(bundle.campaign.place, bundle.entities).map(n => n.id),
    ...foes
      .filter(f => ["fled", "active", "out", "surrendered"].includes(f.status))
      .map(f => "foe:" + f.ref)
  ];
  const witnesses = [...new Set(eyes)].slice(0, 12);
  const byRef = (st: string[]) => {
    const g: Record<string, number> = {};
    for (const f of foes.filter(x => st.includes(x.status))) g[f.ref] = (g[f.ref] || 0) + 1;
    return Object.entries(g);
  };
  for (const [ref, n] of byRef(["dead"])) {
    const nm = resolveMonsterDef(ref, bundle.foeRoster)?.name || MONSTERS[ref]?.name || ref;
    deeds.push({ what: `Killed ${plural(n, nm)}`, tags: ["violent"], weight: clamp(n, 1, 5), foe: ref, witnesses });
  }
  for (const [ref, n] of byRef(["out", "surrendered"])) {
    const nm = resolveMonsterDef(ref, bundle.foeRoster)?.name || MONSTERS[ref]?.name || ref;
    deeds.push({
      what: `Spared ${plural(n, nm)} (beaten, left alive)`,
      tags: ["merciful"],
      weight: clamp(n + 1, 1, 5),
      foe: ref,
      witnesses
    });
  }
  if (c.result === "fled") {
    deeds.push({
      what: `Fled from a fight with ${foeSummary(c.spec.foes, bundle.foeRoster)}`,
      tags: ["fled"],
      weight: 1,
      foe: null,
      witnesses
    });
  }
  return deeds;
}

export function actorWhereLine(a: CombatActor, sanitize: (v: unknown, max?: number) => string = str): string {
  const statusPart =
    a.side === "pc" || a.status === "active"
      ? `at ${a.x},${a.y}, ${hurtWord(a.hp, a.maxHp)}${a.fleeing ? ", fleeing" : ""}${
          a.cond.length ? ", " + a.cond.join(" ") : ""
        }`
      : a.status === "fled"
      ? "fled" + (a.edge ? " off the " + a.edge + " edge" : "")
      : `${a.status} at ${a.x},${a.y}`;
  return `${sanitize(a.name, 40)} ${statusPart}`;
}

export function buildAftermathNote(
  bundle: CampaignBundle,
  c: ActiveCombat,
  sanitize: (v: unknown, max?: number) => string = str
): string {
  const out = Combat.outcome(c.cs)!;
  const mins = Math.max(1, Math.ceil((c.cs!.round * 6) / 60));
  const pl = c.place ? bundle.entities[c.place] : null;
  const resWord = RESULT_WORDS[c.result || "victory"];
  return `The fight just ended: the hero ${resWord} against ${foeSummary(
    c.spec.foes,
    bundle.foeRoster
  )} in ${c.cs!.round} round${c.cs!.round > 1 ? "s" : ""} (about ${mins} minute${mins > 1 ? "s" : ""})${
    pl ? " at " + sanitize(pl.name, 50) : ""
  }. Where it ended, on a map of ${c.cs!.map.w} by ${c.cs!.map.h} squares of 1.5 m: ${Object.values(c.cs!.actors)
    .map(a => actorWhereLine(a, sanitize))
    .join("; ")}.${
    out.edge ? ` The hero left by the ${out.edge} edge.` : ""
  } Narrate the moment after: whether the noise drew attention, what anyone who fled may do, and what the hero now notices. Do not start a new fight. End with a clear next step.`;
}

export function leaveFightInBundle(
  bundle: CampaignBundle,
  sanitize: (v: unknown, max?: number) => string = str
): { aftermathNote: string } {
  const G = bundle.campaign;
  const c = G.combat!;
  const entry = entryFor(bundle, "");
  const foesText = foeSummary(c.spec.foes, bundle.foeRoster);
  entry.fight = {
    id: c.id,
    result: c.result || "victory",
    dead: !!c.dead,
    foes: foesText,
    rounds: c.feed.map(r => ({
      round: r.round,
      lines: r.lines.slice(),
      narr: r.narr,
      status: r.status === "open" || r.status === "narrating" ? "done" : r.status
    })),
    reward: c.reward || null
  };
  entry.chips = c.chips.slice();
  const told = c.feed
    .map(r => r.narr?.line)
    .filter(Boolean)
    .join(" ");
  G.turn++;
  for (const dd of buildFightDeeds(bundle, c)) {
    const id = "d_" + rid();
    bundle.deeds[id] = {
      id,
      ...dd,
      place: c.place || G.place,
      turn: G.turn,
      fight: c.id
    };
    bundle.dirty.d.add(id);
  }
  G.recent = [
    ...G.recent,
    {
      you: "(the fight)",
      out: str(`The hero ${RESULT_WORDS[c.result || "victory"]} the fight against ${foesText}. ${told}`, 600)
    }
  ].slice(-2);
  const aftermathNote = buildAftermathNote(bundle, c, sanitize);
  G.options = [];
  G.combat = null;
  pushLog(bundle, entry);
  return { aftermathNote };
}

/* ---- Story Turn Finalization, Checks, Death Saves & Code-Only Actions ---- */
export interface CleanedTurnReply {
  story: StorySegment[];
  events: NarratorEvent[];
  beat: string;
  options: string[];
  mood: Mood;
  scene_end: boolean;
  check: (NormalizedCheck & { dc: number; adv: number }) | null;
  success?: PendingCheckBranch;
  failure?: PendingCheckBranch;
  ruling?: any;
}

export function checkHeroDeath(
  bundle: CampaignBundle,
  entry: LogEntry,
  onDead?: (campaignId: string) => void
): void {
  const c = bundle.campaign.char;
  if (c.status === "dead-massive") {
    delete c.status;
    entry.segs.push({ n: "The blow is too much. There is no getting up from this." });
    markHeroDead(bundle, onDead);
    return;
  }
  if (c.dying && c.dying.f >= 3) {
    markHeroDead(bundle, onDead);
    return;
  }
  if (c.dying && !c.conditions.includes("unconscious")) {
    c.conditions.push("unconscious");
    entry.chips.push(["Unconscious and dying", "hurt"]);
  }
}

export function finishTurnInBundle(
  bundle: CampaignBundle,
  entry: LogEntry,
  reply: Pick<CleanedTurnReply, "beat" | "options" | "mood" | "scene_end">,
  input: string,
  opening: boolean,
  tx: TxContext,
  opts?: { alreadyLogged?: boolean; foldBeatThreshold?: number; onFoldNeeded?: () => void; onDead?: (id: string) => void }
): void {
  const G = bundle.campaign;
  G.turn++;
  if (!tx.timeSet) advanceTimeInBundle(bundle, 5, entry.chips);
  if (reply.beat) G.beats.push(reply.beat);
  G.beats = G.beats.slice(-14);
  const out = entry.segs
    .map(s => s.n || (s.say ? `${s.say}: "${s.text}"` : ""))
    .filter(Boolean)
    .join(" ")
    .slice(0, 600);
  G.recent = opening ? [{ you: "(start)", out }] : [...G.recent, { you: input, out }].slice(-2);
  G.options = reply.options || [];
  G.mood = reply.mood || G.mood;
  flagLeaks(entry, bundle.facts);
  if (!opts?.alreadyLogged) pushLog(bundle, entry);
  checkHeroDeath(bundle, entry, opts?.onDead);
  const foldThreshold = opts?.foldBeatThreshold ?? 10;
  if (G.status === "active" && (reply.scene_end || G.beats.length >= foldThreshold) && opts?.onFoldNeeded) {
    tx.after.push(opts.onFoldNeeded);
  }
}

export function applyTurnReplyInBundle(
  bundle: CampaignBundle,
  reply: CleanedTurnReply,
  input: string,
  tx: TxContext,
  opts?: {
    opening?: boolean;
    note?: string;
    minTime?: number;
    foldBeatThreshold?: number;
    onFoldNeeded?: () => void;
    onDead?: (id: string) => void;
  }
): void {
  const G = bundle.campaign;
  const isDirectorNote = Boolean(opts?.opening || opts?.note);
  const entry = entryFor(bundle, isDirectorNote ? "" : input);
  const t0 = G.time;
  const enforceMinTime = () => {
    if (opts?.minTime && G.time - t0 < opts.minTime) {
      advanceTimeInBundle(bundle, opts.minTime - (G.time - t0), entry.chips);
      tx.timeSet = true;
    }
  };
  const hasCombatStart = reply.events.some(e =>
    typeof e === "string" ? /^\s*combat_start/i.test(e) : e.type === "combat_start"
  );

  if (reply.ruling && reply.check && !hasCombatStart) {
    G.pending = {
      t: entry.t,
      check: reply.check,
      success: reply.success!,
      failure: reply.failure!,
      beat: reply.beat,
      options: reply.options,
      mood: reply.mood,
      scene_end: reply.scene_end,
      input,
      opening: !!opts?.opening,
      timeSet: false,
      dmg: 0,
      ruling: reply.ruling,
      setup: { story: reply.story, events: reply.events },
      line: str(
        reply.story
          .filter(x => x.n)
          .map(x => x.n)
          .join(" "),
        240
      )
    };
    enforceMinTime();
    G.pending.timeSet = tx.timeSet;
    pushLog(bundle, entry);
    return;
  }

  applyStorySegments(bundle, reply.story, entry);
  applyEvents(bundle, reply.events, entry, tx);
  enforceMinTime();

  const check = reply.check && !G.combat ? reply.check : null;
  if (check) {
    G.pending = {
      t: entry.t,
      check,
      success: reply.success!,
      failure: reply.failure!,
      beat: reply.beat,
      options: reply.options,
      mood: reply.mood,
      scene_end: reply.scene_end,
      input,
      opening: !!opts?.opening,
      timeSet: tx.timeSet,
      dmg: tx.dmg
    };
    pushLog(bundle, entry);
    return;
  }

  finishTurnInBundle(bundle, entry, reply, opts?.note || input, !!opts?.opening, tx, {
    foldBeatThreshold: opts?.foldBeatThreshold,
    onFoldNeeded: opts?.onFoldNeeded,
    onDead: opts?.onDead
  });
}

export function rollPendingCheckInBundle(
  bundle: CampaignBundle,
  tx: TxContext,
  opts?: {
    dice?: [number, number];
    setbackDie?: number;
    foldBeatThreshold?: number;
    onFoldNeeded?: () => void;
    onDead?: (id: string) => void;
  }
): void {
  const G = bundle.campaign;
  const p = G.pending;
  if (!p) return;
  tx.timeSet = !!p.timeSet;
  tx.dmg = p.dmg || 0;
  const i = bundle.log.findLastIndex(x => x.t === p.t);
  if (i < 0) {
    G.pending = null;
    return;
  }
  const entry = (bundle.log[i] = clone(bundle.log[i]));
  if (entry.chunk != null) bundle.dirty.c.add(entry.chunk);

  const rl = p.ruling || null;
  if (rl) {
    applyStorySegments(bundle, p.setup?.story, entry);
    applyEvents(bundle, p.setup?.events, entry, tx);
    if (!tx.timeSet) {
      const mins = rl.time || 10;
      advanceTimeInBundle(bundle, mins, entry.chips);
      tx.timeSet = true;
      entry.chips.push([`${mins >= 60 ? mins / 60 + " h" : mins + " min"}`, ""]);
    }
  }

  const chk = p.check;
  const { bonus, why } = checkBonus(G.char, chk);
  const adv = clamp((chk.adv || 0) + (G.nextAdv ? 1 : 0), -1, 1);
  const [a, b] = opts?.dice || [d(20), d(20)];
  const kept = adv > 0 ? Math.max(a, b) : adv < 0 ? Math.min(a, b) : a;
  const total = kept + bonus;
  const win = total >= chk.dc;
  if (G.nextAdv) G.nextAdv = 0;
  entry.setupLen = entry.segs.length;
  entry.roll = {
    label: (rl ? rl.name + " · " : "") + checkLabel(chk),
    dice: adv ? [a, b] : [a],
    kept,
    bonus,
    total,
    dc: chk.dc,
    ok: win,
    why,
    adv
  };
  const br = win ? p.success : p.failure;
  applyStorySegments(bundle, br.story, entry);
  applyEvents(bundle, br.events, entry, tx);
  if (rl && win && rl.success.effect?.k === "adv") {
    G.nextAdv = 1;
    entry.chips.push(["Advantage on your next check", "loot"]);
  }
  if (rl && !win && rl.failure === "hurt") {
    applyHeroDamage(bundle, opts?.setbackDie ?? d(6), entry.chips, tx);
  }
  if (rl && !win && rl.failure === "lose") {
    advanceTimeInBundle(bundle, rl.time || 10, entry.chips);
    entry.chips.push(["It takes twice as long", ""]);
  }
  G.pending = null;
  finishTurnInBundle(
    bundle,
    entry,
    { beat: p.beat, options: p.options, mood: p.mood, scene_end: p.scene_end },
    p.input,
    p.opening,
    tx,
    {
      alreadyLogged: true,
      foldBeatThreshold: opts?.foldBeatThreshold,
      onFoldNeeded: opts?.onFoldNeeded,
      onDead: opts?.onDead
    }
  );
}

export function rollDeathSaveInBundle(
  bundle: CampaignBundle,
  opts?: { roll?: number; wakeHours?: number; onDead?: (id: string) => void }
): void {
  const G = bundle.campaign;
  const c = G.char;
  if (!c.dying) return;
  const r = opts?.roll ?? d(20);
  const entry = entryFor(bundle, "");
  let res: string;
  if (r === 20) {
    const prevHp = c.hp;
    c.hp = 1;
    recordHpTrail(c, prevHp);
    c.dying = null;
    c.conditions = c.conditions.filter(x => x !== "unconscious");
    res = "A natural 20. You gasp awake with 1 HP.";
  } else if (r === 1) {
    c.dying.f = Math.min(3, c.dying.f + 2);
    res = "A natural 1 counts as two failures.";
  } else if (r >= 10) {
    c.dying.s++;
    res = "Success.";
  } else {
    c.dying.f++;
    res = "Failure.";
  }
  entry.roll = {
    label: "Death saving throw",
    dice: [r],
    kept: r,
    bonus: 0,
    total: r,
    dc: 10,
    ok: r >= 10,
    why: "Each turn at 0 HP you roll a d20 with no modifiers: 10 or higher is a success. Three successes and you stabilise; three failures and you die. A 20 brings you back with 1 HP, a 1 counts double."
  };
  entry.segs.push({
    n: res + (c.dying ? ` Successes ${c.dying.s} of 3, failures ${c.dying.f} of 3.` : "")
  });
  if (c.dying && c.dying.f >= 3) {
    G.turn++;
    pushLog(bundle, entry);
    markHeroDead(bundle, opts?.onDead);
    return;
  }
  if (c.dying && c.dying.s >= 3) {
    c.dying = null;
    const hrs = opts?.wakeHours ?? d(4);
    advanceTimeInBundle(bundle, hrs * 60, entry.chips);
    const prevHp = c.hp;
    c.hp = 1;
    recordHpTrail(c, prevHp);
    c.conditions = c.conditions.filter(x => x !== "unconscious");
    entry.segs.push({ n: `You stabilise. ${hrs} hour${hrs > 1 ? "s" : ""} later you come to, aching, with 1 HP.` });
    G.beats.push(`${c.name} nearly died, stabilised and woke ${hrs} hours later`);
  }
  G.turn++;
  pushLog(bundle, entry);
}

export function restInBundle(bundle: CampaignBundle, kind: "short" | "long", hdRoll?: number): void {
  const G = bundle.campaign;
  const c = G.char;
  const entry = entryFor(bundle, kind === "long" ? "Long rest" : "Short rest");
  if (kind === "short") {
    advanceTimeInBundle(bundle, 60, entry.chips);
    if (c.hd.left > 0 && c.hp < c.maxHp) {
      const r = hdRoll ?? d(c.hd.die);
      const v = Math.max(1, r + mod(c.abil.con));
      c.hd.left--;
      applyHeroHeal(bundle, v, entry.chips);
      entry.roll = {
        label: "Hit die",
        dice: [r],
        kept: r,
        bonus: mod(c.abil.con),
        total: v,
        dc: null,
        ok: true,
        why: `On a short rest you can spend Hit Dice: roll your class die (d${c.hd.die}) and add your Constitution modifier.`
      };
    }
    if (c.res.second_wind && c.res.second_wind.left < c.res.second_wind.max) {
      c.res.second_wind.left++;
      entry.chips.push(["Second Wind +1 use", "heal"]);
    }
    entry.segs.push({
      n: "You rest for an hour." + (c.hd.left === 0 ? " No Hit Dice left; a long rest restores them." : "")
    });
  } else {
    advanceTimeInBundle(bundle, 480, entry.chips);
    applyHeroHeal(bundle, c.maxHp, entry.chips);
    c.hd.left = Math.min(c.hd.max, c.hd.left + Math.max(1, Math.floor(c.hd.max / 2)));
    c.conditions = c.conditions.filter(x => x !== "exhaustion");
    for (const r of Object.values(c.res || {})) r.left = r.max;
    entry.segs.push({ n: "You sleep for eight hours. HP and Hit Dice restored." });
  }
  G.beats.push(`${c.name} took a ${kind} rest`);
  G.beats = G.beats.slice(-14);
  G.turn++;
  pushLog(bundle, entry);
}

export function drinkPotionInBundle(bundle: CampaignBundle, itemId: string, dice?: [number, number]): boolean {
  const G = bundle.campaign;
  const item = G.char.inv.find(x => x.id === itemId);
  if (!item || !/potion of healing|healing potion/i.test(item.name)) return false;
  const entry = entryFor(bundle, `Drink a ${item.name}`);
  const [a, b] = dice || [d(4), d(4)];
  const v = a + b + 2;
  entry.roll = {
    label: "Potion of healing",
    dice: [a, b],
    kept: a + b,
    bonus: 2,
    total: v,
    dc: null,
    ok: true,
    why: "A potion of healing restores 2d4 + 2 hit points."
  };
  applyHeroHeal(bundle, v, entry.chips);
  item.qty--;
  if (item.qty <= 0) G.char.inv = G.char.inv.filter(x => x !== item);
  entry.segs.push({ n: "Warmth spreads through your chest as the potion takes hold." });
  advanceTimeInBundle(bundle, 1, entry.chips);
  G.turn++;
  pushLog(bundle, entry);
  return true;
}
