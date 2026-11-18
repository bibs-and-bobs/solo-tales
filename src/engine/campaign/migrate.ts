/* Schema v10 Guard, Save Migration (v1..v10 + ZONE8), and Ruling/Story Cleaners. */

import {
  MOODS,
  arr,
  clamp,
  isObj,
  nice,
  numOr,
  rid,
  sign,
  str,
  strs,
  type Mood
} from "../util";
import {
  ABIL,
  ABIL_NAME,
  COND,
  CONDITIONS,
  MONSTERS,
  SKILLS,
  WEAPONS,
  mod,
  prof,
  type AbilityKey,
  type ConditionKey
} from "../rules/srd";
import {
  DEFAULT_SETTING,
  HEROES,
  TONES,
  checkBonus,
  masteryCount,
  normCheck,
  refFromName,
  refInfo,
  resFor,
  syncChar,
  type CharacterState,
  type FightReward
} from "../rules/character";
import { cleanFoeTemplate, resolveMonsterDef, type FoeTemplate } from "../rules/foe-roster";
import {
  Combat,
  type ActorStatus,
  type CellTerrain,
  type CombatCommand,
  type CombatState,
  type RulingProposal
} from "../combat/combat";
import { cleanThreatClock, type ThreatClock } from "./clocks";
import type { EntityKind, WorldEntity, WorldFact } from "./knowledge";
import {
  DEFAULT_PREFS,
  SCHEMA,
  type ActiveCombat,
  type CampaignArtBrief,
  type CampaignFlavour,
  type CampaignState,
  type CombatRoundEntry,
  type DeedRecord,
  type FightLogSummary,
  type NarratorEvent,
  type PendingAttackRoll,
  type PendingCheck,
  type PendingCheckBranch,
  type RollDisplayRecord,
  type RoundNarration,
  type StorySegment
} from "./types";

export const ENTITY_KINDS: readonly EntityKind[] = ["npc", "place", "item", "faction", "lore"];
export const DEED_TAGS: readonly string[] = ["violent", "merciful", "fled", "theft", "promise", "lie"];
const ACTOR_STATUS: readonly ActorStatus[] = ["active", "dead", "out", "fled", "surrendered"];
const RESULTS: ReadonlyArray<"victory" | "defeat" | "fled"> = ["victory", "defeat", "fled"];

export const R_COST: Readonly<Record<RulingProposal["cost"], string>> = {
  action: "action",
  bonus: "bonus action",
  move: "half your movement",
  reaction: "reaction",
  free: "free"
};
export const R_FAIL: Readonly<Record<RulingProposal["failure"], string>> = {
  none: "nothing worse happens",
  prone: "you fall prone",
  hurt: "you take 1d6 bludgeoning damage",
  disarmed: "your weapon drops to the floor",
  lose: "the moment is lost"
};
export const R_FAIL_OUT: Readonly<Record<RulingProposal["failure"], string>> = {
  none: "nothing worse happens",
  prone: "nothing worse happens",
  hurt: "you take 1d6 bludgeoning damage",
  disarmed: "nothing worse happens",
  lose: "it takes twice as long"
};
export const R_TIMES = [1, 10, 60] as const;
export const R_FOLLOW = ["attack", "offhand", "move", "dash", "disengage", "dodge", "hide"] as const;

export function rulingBonus(
  c: CharacterState,
  r: RulingProposal
): { bonus: number; why: string } {
  if (r.check.kind === "attack") {
    const ab = r.check.abil;
    const pb = prof(c.level);
    const m = mod(c.abil[ab]);
    return {
      bonus: m + pb,
      why: `Creative attack roll: ${ABIL_NAME[ab]} (${sign(m)}) + proficiency (${sign(pb)}).`
    };
  }
  return checkBonus(c, {
    kind: r.check.kind,
    key: r.check.key || r.check.abil,
    abil: r.check.abil
  });
}

export function rulingEffectText(r: RulingProposal, targetName?: string | null): string {
  const parts: string[] = [];
  const who = targetName || r.target || "the foe";
  if (r.success.damage) parts.push(`${r.success.damage} ${r.success.type} damage`);
  const ef = r.success.effect;
  if (ef) {
    if (ef.k === "cond" && ef.cond) parts.push(`${who} is ${nice(ef.cond)}`);
    else if (ef.k === "adv") parts.push("Advantage on the next roll");
    else if (ef.k === "dis") parts.push(`${who}'s next attack has Disadvantage`);
    else if (ef.k === "push") parts.push(`push ${who} 3 m`);
    else if (ef.k === "pull") parts.push(`pull ${who} 3 m closer`);
  }
  if (r.success.object) parts.push(r.success.object);
  return parts.join(" · ") || "it works";
}

export const snapDC = (v: unknown): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 13;
  return Combat.RULING.dcs.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
};

export function cleanStory(rawArr: unknown): StorySegment[] {
  if (!Array.isArray(rawArr)) return [];
  return rawArr
    .slice(0, 12)
    .map((s): StorySegment | null => {
      if (!s || typeof s !== "object") return null;
      if (s.say) return { say: str(s.say, 40), text: str(s.text, 500) };
      if (s.sfx) return { sfx: str(s.sfx, 16).toUpperCase(), note: str(s.note, 60) };
      if (s.n) return { n: str(s.n, 900) };
      return null;
    })
    .filter((s): s is StorySegment => Boolean(s && (s.n || s.text || s.sfx)));
}

export function cleanNarratorEvent(raw: unknown): NarratorEvent | null {
  if (typeof raw === "string") {
    const s = str(raw, 240);
    return s || null;
  }
  if (isObj(raw) && typeof raw.type === "string") {
    return raw as NarratorEvent;
  }
  return null;
}

export function cleanRuling(
  raw: unknown,
  combat: boolean,
  char?: Pick<CharacterState, "level" | "abil"> | null
): (RulingProposal & { capped: string[] }) | null {
  if (!isObj(raw)) return null;
  const R = Combat.RULING;
  const L = char?.level || 1;
  const capped: string[] = [];
  const name = str(raw.name ?? raw.action, 40);
  if (!name) return null;
  const ck = isObj(raw.check) ? raw.check : {};
  const s = isObj(raw.success) ? raw.success : {};

  let check: RulingProposal["check"];
  if (combat && (ck.kind === "attack" || ck.attack || /^attack/i.test(String(ck.skill || ck.ability || "")))) {
    const want = String(ck.abil || ck.attack || ck.ability || "")
      .toLowerCase()
      .slice(0, 3);
    const abil: AbilityKey =
      want === "str" || want === "dex"
        ? want
        : char && mod(char.abil.dex) > mod(char.abil.str)
        ? "dex"
        : "str";
    check = { kind: "attack", key: abil, abil, label: `${ABIL_NAME[abil]} attack`, dc: null };
  } else {
    let nc = normCheck(ck.key || ck.skill || ck.ability);
    if (!nc) return null;
    const kind: "skill" | "ability" = nc.kind === "skill" ? "skill" : "ability";
    const dc = snapDC(ck.dc);
    if (Number(ck.dc) !== dc) capped.push(`DC set to ${dc}, the nearest step on the scale`);
    check = {
      kind,
      key: nc.key,
      abil: nc.abil,
      label: kind === "skill" ? nice(nc.key) : ABIL_NAME[nc.key as AbilityKey],
      dc
    };
  }

  const cw = String(raw.cost ?? "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let cost: RulingProposal["cost"] = "action";
  let time: number | null = null;
  if (combat) {
    const mapped = ({
      action: "action",
      "an action": "action",
      bonus: "bonus",
      "bonus action": "bonus",
      "a bonus action": "bonus",
      move: "move",
      movement: "move",
      "half movement": "move",
      reaction: "reaction",
      "a reaction": "reaction",
      free: "free",
      "free action": "free"
    } as Record<string, RulingProposal["cost"]>)[cw];
    if (mapped) cost = mapped;
    else {
      cost = "action";
      if (cw) capped.push("an unknown cost became your action");
    }
  } else {
    const tm = String(raw.time ?? raw.cost ?? "").match(/(\d+)\s*([mh])/i);
    const mins = tm ? +tm[1] * (tm[2].toLowerCase() === "h" ? 60 : 1) : Number(raw.time) || 10;
    time = R_TIMES.reduce((a, b) => (Math.abs(b - mins) < Math.abs(a - mins) ? b : a));
  }

  let damage: string | null = null;
  let type = "bludgeoning";
  if (combat && s.damage) {
    const m = String(s.damage)
      .replace(/\s/g, "")
      .match(/^(\d+)d(\d+)([+-]\d+)?/i);
    const cap = Combat.capDice(L);
    const cm = cap.match(/^(\d+)d(\d+)$/)!;
    if (!m) capped.push("damage dropped: not a dice roll");
    else if (+m[1] * +m[2] > +cm[1] * +cm[2] || +m[1] > 12 || +(m[3] || 0) > 0) {
      damage = cap;
      capped.push(`damage capped at ${cap} for level ${L}`);
    } else damage = `${+m[1]}d${+m[2]}`;
  } else if (!combat && s.damage) {
    capped.push("no damage outside a fight");
  }
  {
    const tp = String(s.type || "").toLowerCase();
    if (R.types.includes(tp)) type = tp;
  }

  const e0 = isObj(s.effect) ? s.effect : null;
  const offers: Array<RulingProposal["success"]["effect"]> = [];
  const cond = String(s.condition ?? (e0?.k === "cond" ? e0.cond : "") ?? "")
    .toLowerCase()
    .trim();
  if (cond) {
    if (R.conds.includes(cond)) offers.push({ k: "cond", cond: cond as ConditionKey });
    else capped.push(`${nice(cond)} isn't on the menu`);
  }
  if (s.adv || e0?.k === "adv") offers.push({ k: "adv" });
  if (s.dis || e0?.k === "dis") offers.push({ k: "dis" });
  if (s.push || e0?.k === "push") offers.push({ k: "push" });
  if (s.pull || e0?.k === "pull") offers.push({ k: "pull" });
  let effect = offers.filter(Boolean)[0] || null;
  if (offers.filter(Boolean).length > 1) capped.push("one effect only");
  if (!combat && effect && effect.k !== "adv") {
    capped.push("only Advantage on your next check carries over outside a fight");
    effect = null;
  }

  const fw = String(isObj(raw.failure) ? raw.failure.setback ?? "" : raw.failure ?? "").toLowerCase();
  let failure: RulingProposal["failure"] = /hurt|damage|1d6|wound/.test(fw)
    ? "hurt"
    : /disarm|drop/.test(fw)
    ? "disarmed"
    : /prone|fall/.test(fw)
    ? "prone"
    : /lose|lost|wast|twice|longer/.test(fw)
    ? "lose"
    : "none";
  if (!combat && (failure === "prone" || failure === "disarmed")) failure = "none";

  if (cost === "free" && (damage || effect)) {
    cost = "action";
    capped.push("a move that hurts or hinders costs your action");
  }
  if (combat && ["bonus", "move", "reaction"].includes(cost) && damage && effect) {
    damage = null;
    capped.push(`a ${R_COST[cost]} does damage or one effect, not both: the damage was dropped`);
  }

  let follow: RulingProposal["follow"] = null;
  if (combat && raw.follow) {
    const txt = str(isObj(raw.follow) ? raw.follow.text : raw.follow, 80);
    const parsed = Combat.parse(txt.startsWith("/") ? txt : "/" + txt);
    if (parsed?.cmd && (R_FOLLOW as readonly string[]).includes(parsed.cmd.type)) {
      follow = { text: "/" + txt.replace(/^\//, "").split(",")[0].trim(), cmd: parsed.cmd };
    }
  }

  return {
    name,
    cost,
    time,
    check,
    target: str(raw.target, 40) || null,
    success: { damage, type, effect, object: str(s.object, 80) || null },
    failure,
    follow,
    capped
  };
}

export function cleanBranch(b: unknown): PendingCheckBranch {
  return {
    story: cleanStory(isObj(b) ? b.story : []),
    events: arr(isObj(b) ? b.events : [])
      .map(cleanNarratorEvent)
      .filter((x): x is NarratorEvent => x !== null)
      .slice(0, 10)
  };
}

export function cleanPending(
  p: unknown,
  char?: Pick<CharacterState, "level" | "abil"> | null
): PendingCheck | null {
  if (!isObj(p) || !isObj(p.check)) return null;
  const chk = normCheck(p.check.key || p.check.skill || p.check.ability);
  if (!chk) return null;
  const out: PendingCheck = {
    t: numOr(p.t, 0, 0),
    check: { ...chk, dc: numOr(p.check.dc, 12, 5, 25), adv: numOr(p.check.adv, 0, -1, 1) },
    success: cleanBranch(p.success),
    failure: cleanBranch(p.failure),
    beat: str(p.beat, 140),
    options: arr<string>(p.options, x => typeof x === "string")
      .slice(0, 3)
      .map(o => str(o, 48)),
    mood: MOODS.includes(p.mood) ? (p.mood as Mood) : "calm",
    scene_end: !!p.scene_end,
    input: str(p.input, 400),
    opening: !!p.opening,
    timeSet: !!p.timeSet,
    dmg: numOr(p.dmg, 0, 0, 999)
  };
  if (!out.success.story.length) out.success.story = [{ n: "You manage it." }];
  if (!out.failure.story.length) out.failure.story = [{ n: "It doesn't go your way." }];
  if (isObj(p.ruling)) {
    const rl = cleanRuling(p.ruling, false, char);
    if (rl) {
      rl.check.adv = out.check.adv;
      out.check.dc = rl.check.dc!;
      rl.capped = strs(p.ruling.capped, 6, 80);
      out.ruling = rl;
      out.setup = cleanBranch(p.setup);
      out.line = str(p.line, 240);
      out.timeSet = false;
      out.dmg = 0;
    }
  }
  return out;
}

export function cleanRoll(r: unknown): RollDisplayRecord | null {
  if (!isObj(r)) return null;
  const dice = arr<number>(r.dice, v => Number.isFinite(v)).slice(0, 4);
  if (!dice.length) return null;
  return {
    label: str(r.label, 60) || "Roll",
    dice,
    kept: numOr(r.kept, dice[0]),
    bonus: numOr(r.bonus, 0),
    total: numOr(r.total, 0),
    dc: r.dc == null ? null : numOr(r.dc, 10, 1, 40),
    ok: !!r.ok,
    why: str(r.why, 400),
    adv: numOr(r.adv, 0, -1, 1)
  };
}

export function cleanNarr(n: unknown): RoundNarration | null {
  if (!isObj(n) || typeof n.line !== "string" || !n.line.trim()) return null;
  const sfx = str(n.sfx, 16)
    .toUpperCase()
    .replace(/[^A-Z!' -]/g, "")
    .trim();
  return {
    line: str(n.line, 320),
    sfx: sfx || null,
    say:
      isObj(n.say) && str(n.say.who, 40) && str(n.say.text, 160)
        ? { who: str(n.say.who, 40), text: str(n.say.text, 160) }
        : null
  };
}

export function cleanRoundEntry(r: any): CombatRoundEntry {
  return {
    round: numOr(r?.round, 1, 1, 9999),
    lines: strs(r?.lines, 40, 200),
    notes: strs(r?.notes, 6, 240),
    flavour: str(r?.flavour, 300),
    init: isObj(r?.init)
      ? { dice: arr<number>(r.init.dice, Number.isFinite).slice(0, 2), total: numOr(r.init.total, 0, -20, 60) }
      : null,
    narr: cleanNarr(r?.narr),
    status:
      r?.status === "narrating"
        ? "failed"
        : ["open", "done", "failed"].includes(r?.status)
        ? r.status
        : "done"
  };
}

export function cleanReward(r: unknown): FightReward | null {
  if (!isObj(r)) return null;
  return {
    xp: numOr(r.xp, 0, 0, 1e6),
    gold: numOr(r.gold, 0, 0, 1e6),
    items: arr(r.items, x => isObj(x) && typeof x.name === "string")
      .slice(0, 12)
      .map(x => ({ name: str(x.name, 40), qty: numOr(x.qty, 1, 1, 99) }))
  };
}

export function cleanFightLog(f: unknown): FightLogSummary | null {
  if (!isObj(f) || !RESULTS.includes(f.result)) return null;
  return {
    id: str(f.id, 20),
    result: f.result,
    dead: !!f.dead,
    foes: str(f.foes, 120),
    rounds: arr(f.rounds, isObj)
      .slice(-40)
      .map(r => {
        const x = cleanRoundEntry(r);
        return {
          round: x.round,
          lines: x.lines,
          narr: x.narr,
          status: x.status === "open" ? "done" : (x.status as "done" | "failed")
        };
      }),
    reward: cleanReward(f.reward)
  };
}

function cleanCmd(c: unknown): CombatCommand | null {
  if (!isObj(c) || !["attack", "offhand"].includes(c.type)) return null;
  const out: CombatCommand = { type: c.type };
  if (typeof c.target === "string") out.target = str(c.target, 60);
  if (typeof c.weapon === "string") out.weapon = str(c.weapon, 60);
  if (c.ranged) out.ranged = true;
  if (c.nonlethal) out.nonlethal = true;
  return out;
}

export function cleanCombatRoll(r: unknown): PendingAttackRoll | null {
  if (!isObj(r)) return null;
  const cmd = cleanCmd(r.cmd);
  const atk = arr<number>(r.atk, v => Number.isInteger(v) && v >= 1 && v <= 20).slice(0, 2);
  const dmg = arr(r.dmg, x => isObj(x) && Number.isInteger(x.d) && x.d >= 1 && x.d <= 20)
    .slice(0, 24)
    .map(x => ({
      d: x.d as number,
      why: (x.why === "sneak attack" ? "sneak attack" : "damage") as "damage" | "sneak attack"
    }));
  if (!cmd || !atk.length || !dmg.length) return null;
  return {
    cmd,
    flavour: str(r.flavour, 200),
    atk,
    dmg,
    head: {
      what: str(r.head?.what, 200),
      roll: str(r.head?.roll, 80),
      result: str(r.head?.result, 30)
    },
    label: str(r.label, 90),
    dmgText: str(r.dmgText, 80)
  };
}

export function cleanCS(
  cs: unknown,
  foeRoster?: Record<string, FoeTemplate> | null
): CombatState | null {
  if (!isObj(cs) || cs.pc !== "pc" || !isObj(cs.actors) || !isObj(cs.actors.pc)) return null;
  const embeddedRoster: Record<string, FoeTemplate> = {};
  if (isObj(cs.foeRoster)) {
    for (const [k, v] of Object.entries(cs.foeRoster)) {
      const cleaned = cleanFoeTemplate(v);
      if (cleaned) embeddedRoster[k] = cleaned;
    }
  }
  const effectiveRoster = { ...(foeRoster || {}), ...embeddedRoster };
  const actors: Record<string, any> = {};
  for (const [id, a] of Object.entries(cs.actors)) {
    if (!isObj(a) || a.id !== id || !isObj(a.abil) || ABIL.some(k => !Number.isFinite(a.abil[k]))) {
      return null;
    }
    if (id === "pc") {
      if (a.side !== "pc") return null;
    } else {
      if (a.side !== "foe" || !resolveMonsterDef(a.ref, effectiveRoster)) return null;
    }
    const maxHp = numOr(a.maxHp, 1, 1, 9999);
    actors[id] = {
      ...a,
      maxHp,
      hp: numOr(a.hp, maxHp, 0, maxHp),
      ac: numOr(a.ac, 10, 1, 40),
      speed: numOr(a.speed, 9, 0, 60),
      init: numOr(a.init, 0, -20, 60),
      cond: arr(a.cond, k => typeof k === "string" && Object.hasOwn(COND, k)),
      fx: arr(a.fx, e => isObj(e) && typeof e.k === "string"),
      status: ACTOR_STATUS.includes(a.status) ? a.status : "dead",
      reaction: !!a.reaction
    };
  }
  const pc = actors.pc;
  if (
    !Array.isArray(pc.attacks) ||
    !pc.attacks.every(
      (w: any) =>
        isObj(w) && typeof w.key === "string" && typeof w.name === "string" && Number.isFinite(w.bonus) && typeof w.dice === "string"
    ) ||
    !Array.isArray(pc.bag) ||
    !pc.bag.every(isObj) ||
    !isObj(pc.res || {})
  ) {
    return null;
  }
  const order = Array.isArray(cs.order) ? cs.order : [];
  if (
    !order.every(id => typeof id === "string" && !!actors[id]) ||
    order.length !== Object.keys(actors).length ||
    new Set(order).size !== order.length ||
    !Object.values(actors).some((a: any) => a.side === "foe")
  ) {
    return null;
  }
  if (cs.turn != null && !(isObj(cs.turn) && actors[cs.turn.id])) return null;
  if (cs.over != null && !(isObj(cs.over) && RESULTS.includes(cs.over.result))) return null;
  const spent: Record<string, number> = {};
  for (const [k, v] of Object.entries(isObj(cs.spent) ? cs.spent : {})) {
    if (Number.isFinite(v) && Number(v) > 0) spent[k] = Math.round(Number(v));
  }
  let out: any = {
    ...cs,
    actors,
    order,
    round: numOr(cs.round, 1, 1, 9999),
    cur: numOr(cs.cur, 0, -1, order.length - 1),
    rng: Number.isInteger(cs.rng) ? cs.rng : 1,
    spent,
    turn: cs.turn ?? null,
    over: cs.over ?? null,
    log: strs(cs.log, 80, 200),
    ...(Object.keys(effectiveRoster).length ? { foeRoster: effectiveRoster } : {})
  };
  if (!isObj(out.map)) out = Combat.fromZones(out);
  const { w, h } = out.map;
  const cells: Record<string, CellTerrain> = {};
  const onMap = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 6 && Number(v) <= 20;
  if (
    !onMap(w) ||
    !onMap(h) ||
    Object.values(out.actors).some(
      (a: any) => !Number.isInteger(a.x) || !Number.isInteger(a.y) || a.x < 1 || a.y < 1 || a.x > w || a.y > h
    )
  ) {
    return null;
  }
  for (const [k, v] of Object.entries(isObj(out.map.cells) ? out.map.cells : {})) {
    if (/^\d+,\d+$/.test(k) && Combat.CELLS.includes(v as CellTerrain)) cells[k] = v as CellTerrain;
  }
  out.map = { w, h, cells };
  return out as CombatState;
}

export function cleanCombat(
  c: unknown,
  char?: Pick<CharacterState, "level" | "abil"> | null,
  foeRoster?: Record<string, FoeTemplate> | null
): ActiveCombat | null {
  if (!isObj(c) || !["init", "fight", "over"].includes(c.phase)) return null;
  const pair = (p: unknown): [number, number] | null =>
    Array.isArray(p) && p.length === 2 && p.every(Number.isInteger)
      ? [clamp(p[0], 0, 99), clamp(p[1], 0, 99)]
      : null;
  const pairs = (v: unknown): Array<[number, number]> =>
    arr(v)
      .slice(0, 60)
      .map(pair)
      .filter((x): x is [number, number] => x !== null);
  const sm = isObj(c.spec?.map) ? c.spec.map : {};
  const foes = arr(
    c.spec?.foes,
    f => isObj(f) && typeof f.ref === "string" && (Object.hasOwn(MONSTERS, f.ref) || Boolean(resolveMonsterDef(f.ref, foeRoster)))
  )
    .slice(0, 6)
    .map(f => ({
      ref: f.ref as string,
      n: numOr(f.n, 1, 1, 8),
      at: arr(f.at).slice(0, 8).map(pair),
      d: numOr(f.d ?? [1, 6, 12][f.zone], 6, 1, 19),
      name: f.name ? str(f.name, 40) : null,
      npcId: typeof f.npcId === "string" ? str(f.npcId, 40) : null
    }));
  if (!foes.length) return null;
  const side = arr(c.spec?.foes).some(f => isObj(f) && f.zone != null) ? 20 : 12;
  const out: ActiveCombat = {
    v: 1,
    id: str(c.id, 20) || rid(),
    phase: c.phase,
    spec: {
      foes,
      map: {
        w: numOr(sm.w, side, 6, 20),
        h: numOr(sm.h, side, 6, 20),
        wall: pairs(sm.wall),
        rough: pairs(sm.rough),
        cover: pairs(sm.cover)
      },
      hero: pair(c.spec?.hero),
      surprise: c.spec?.surprise === "pc" || c.spec?.surprise === "foes" ? c.spec.surprise : null
    },
    seed: numOr(c.seed, 1, 0, 4294967295),
    cs: null,
    feed: arr(c.feed, isObj).slice(-40).map(cleanRoundEntry),
    roll: null,
    ruling: null,
    result: RESULTS.includes(c.result) ? c.result : null,
    chips: arr(c.chips, x => Array.isArray(x) && typeof x[0] === "string")
      .slice(0, 16)
      .map(x => [str(x[0], 80), str(x[1], 10)] as [string, string]),
    started: numOr(c.started, 0, 0),
    place: typeof c.place === "string" ? c.place : null,
    dead: !!c.dead,
    reward: c.phase === "over" ? cleanReward(c.reward) : null
  };
  if (c.phase === "init") {
    out.feed = [];
    return out;
  }
  let cs: CombatState | null = null;
  try {
    cs = cleanCS(c.cs, foeRoster);
  } catch {
    cs = null;
  }
  if (!cs || !!cs.over !== (c.phase === "over") || (c.phase === "over" && !out.result)) return null;
  out.cs = cs;
  if (c.phase === "fight") {
    if (out.feed.at(-1)?.status !== "open") {
      out.feed.push({ round: cs.round, lines: [], notes: [], flavour: "", init: null, narr: null, status: "open" });
    }
    out.roll = cleanCombatRoll(c.roll);
    if (!out.roll && isObj(c.ruling)) {
      const r = cleanRuling(c.ruling.ruling, true, char);
      if (r) {
        out.ruling = {
          text: str(c.ruling.text, 300),
          line: str(c.ruling.line, 240),
          ruling: r,
          capped: strs(c.ruling.capped, 6, 80)
        };
      }
    }
  }
  try {
    Combat.available(cs);
    Combat.outcome(cs);
    if (out.roll && !Combat.act(cs, out.roll.cmd, [...out.roll.atk, ...out.roll.dmg.map(() => 1)]).ok) {
      out.roll = null;
    }
    if (out.ruling) Combat.rulingInfo(cs, out.ruling.ruling, 0);
  } catch {
    return null;
  }
  return out;
}

export function cleanFlavour(raw: unknown): CampaignFlavour | null {
  if (!isObj(raw)) return null;
  const archetypes = [
    "frontier_mystery",
    "gothic_dread",
    "swashbuckling_coast",
    "court_intrigue",
    "ancient_ruins",
    "custom"
  ] as const;
  const archetype = archetypes.includes(raw.archetype) ? raw.archetype : "frontier_mystery";
  const pillar = (v: unknown): 1 | 2 | 3 => clamp(Math.round(Number(v) || 2), 1, 3) as 1 | 2 | 3;
  return {
    archetype,
    tone: TONES.includes(raw.tone) ? raw.tone : TONES[0],
    pillars: {
      combat: pillar(raw.pillars?.combat),
      mystery: pillar(raw.pillars?.mystery),
      social: pillar(raw.pillars?.social)
    },
    magicLevel: ["rare", "uncommon", "high"].includes(raw.magicLevel) ? raw.magicLevel : "rare",
    customPremise: raw.customPremise ? str(raw.customPremise, 600) : undefined
  };
}

export function cleanArtBrief(raw: unknown): CampaignArtBrief | null {
  if (!isObj(raw)) return null;
  const presets = ["painterly", "ink_parchment", "dark_woodcut", "custom"] as const;
  return {
    stylePreset: presets.includes(raw.stylePreset) ? raw.stylePreset : "painterly",
    medium: str(raw.medium, 100) || "oil and gouache tabletop character illustration",
    palette: str(raw.palette, 100) || "warm earthy tones, muted forest greens, weathered brass",
    lighting: str(raw.lighting, 100) || "dramatic directional lantern light",
    attireStyle: str(raw.attireStyle, 100) || "practical worn travel gear, wool, leather, and iron",
    moodKeywords: str(raw.moodKeywords, 100) || "grounded, atmospheric, weathered",
    customStyleNote: raw.customStyleNote ? str(raw.customStyleNote, 160) : undefined
  };
}

export function cleanEntity(e: unknown): WorldEntity | null {
  if (!isObj(e) || typeof e.id !== "string" || !ENTITY_KINDS.includes(e.kind) || typeof e.name !== "string" || !e.name) {
    return null;
  }
  return {
    id: str(e.id, 50),
    kind: e.kind,
    name: str(e.name, 50),
    role: e.role ? str(e.role, 80) : undefined,
    desc: e.desc ? str(e.desc, 200) : undefined,
    appearance: e.appearance ? str(e.appearance, 220) : undefined,
    agenda: e.agenda ? str(e.agenda, 180) : undefined,
    portraitId: typeof e.portraitId === "string" ? str(e.portraitId, 60) : null,
    att: e.kind === "npc" ? numOr(e.att, 0, -3, 3) : undefined,
    loc: typeof e.loc === "string" ? e.loc : null,
    seen: e.seen != null ? numOr(e.seen, 0, 0) : undefined,
    met: e.met != null ? numOr(e.met, 0, 0) : undefined,
    first: e.first != null ? numOr(e.first, 0, 0) : undefined,
    visited: e.visited != null ? numOr(e.visited, 0, 0) : undefined,
    combatStatus: ["dead", "captured", "fled"].includes(e.combatStatus) ? e.combatStatus : null,
    playerNote: typeof e.playerNote === "string" ? str(e.playerNote, 300) : undefined
  };
}

export function cleanFact(f: unknown): WorldFact | null {
  if (!isObj(f) || typeof f.id !== "string" || typeof f.text !== "string" || !f.text) return null;
  const known = arr<string>(f.known, k => typeof k === "string").slice(0, 12);
  return {
    id: str(f.id, 40),
    text: str(f.text, 220),
    turn: numOr(f.turn, 0, 0),
    place: typeof f.place === "string" ? f.place : null,
    pinned: !!f.pinned,
    about: arr<string>(f.about, k => typeof k === "string").slice(0, 6),
    known: Array.isArray(f.known) ? known : ["player"],
    truth: f.truth !== false
  };
}

export function cleanDeed(x: unknown): DeedRecord | null {
  if (!isObj(x) || typeof x.id !== "string" || typeof x.what !== "string" || !x.what) return null;
  return {
    id: str(x.id, 24),
    what: str(x.what, 120),
    tags: arr<string>(x.tags, t => DEED_TAGS.includes(t)),
    witnesses: arr<string>(x.witnesses, w => typeof w === "string")
      .slice(0, 12)
      .map(w => str(w, 40)),
    place: typeof x.place === "string" ? x.place : null,
    turn: numOr(x.turn, 0, 0),
    weight: numOr(x.weight, 1, 1, 5),
    fight: str(x.fight, 20),
    foe: typeof x.foe === "string" ? x.foe : null
  };
}

/** Upgrades any v1..v10 campaign document to Schema v10. */
export function migrate(
  g: unknown,
  foeRoster?: Record<string, FoeTemplate> | null
): CampaignState | null {
  if (!isObj(g) || !g.id) return null;
  const base = HEROES[String(g.char?.cls || "").toLowerCase() === "rogue" ? "rogue" : "fighter"];
  const c = isObj(g.char) ? g.char : {};
  const abil = {} as Record<AbilityKey, number>;
  for (const a of ABIL) abil[a] = numOr(c.abil?.[a], base.abil[a], 1, 30);
  const level = numOr(c.level, 1, 1, 20);
  const maxHp = numOr(c.maxHp, base.maxHp, 1, 999);
  const char: CharacterState = {
    name: str(c.name, 30) || base.name,
    species: str(c.species, 30) || base.species,
    cls: str(c.cls, 30) || base.cls,
    bg: str(c.bg, 30) || base.bg,
    appearance: str(c.appearance, 260) || base.appearance,
    portraitId: typeof c.portraitId === "string" ? str(c.portraitId, 60) : null,
    level,
    xp: numOr(c.xp, 0, 0, 1e7),
    maxHp,
    hp: numOr(c.hp, maxHp, 0, maxHp),
    ac: numOr(c.ac, base.ac, 1, 40),
    speed: numOr(c.speed, 9, 0, 60),
    abil,
    skills: arr<string>(c.skills, k => Boolean(SKILLS[k])),
    expertise: arr<string>(c.expertise, k => Boolean(SKILLS[k])),
    saves: arr<AbilityKey>(c.saves, a => ABIL.includes(a)),
    hd: {
      die: numOr(c.hd?.die, base.hd.die, 4, 12),
      max: numOr(c.hd?.max, level, 1, 20),
      left: numOr(c.hd?.left, level, 0, 20)
    },
    gold: numOr(c.gold, 0, 0, 1e7),
    conditions: arr<ConditionKey>(c.conditions, k => CONDITIONS.includes(k)),
    dying: isObj(c.dying) ? { s: numOr(c.dying.s, 0, 0, 3), f: numOr(c.dying.f, 0, 0, 3) } : null,
    mastery: [],
    res: {},
    hpTrail: Array.isArray(c.hpTrail)
      ? c.hpTrail
          .map((n: unknown) => numOr(n, maxHp, 0, maxHp))
          .slice(-3)
      : undefined,
    perks: Array.isArray(c.perks) ? strs(c.perks, 12, 160) : undefined,
    backstory: typeof c.backstory === "string" ? str(c.backstory, 1600) || undefined : undefined,
    inv: arr(c.inv, isObj).map(i => {
      const name = str(i.name, 40) || "Unknown item";
      return {
        id: str(i.id, 20) || rid(),
        name,
        note: str(i.note, 60),
        qty: numOr(i.qty, 1, 1, 999),
        eq: !!i.eq,
        ref: (numOr(g.v, 1) < 4 ? refFromName(name) : null) || (refInfo(i.ref) ? i.ref : refFromName(name)),
        weightKg: typeof i.weightKg === "number" && i.weightKg >= 0 ? Math.min(500, i.weightKg) : undefined
      };
    })
  };
  const mc = masteryCount(char);
  const sameCls = base.cls.toLowerCase() === char.cls.toLowerCase();
  char.mastery = [...new Set(arr<string>(c.mastery, k => typeof k === "string" && Object.hasOwn(WEAPONS, k)))].slice(
    0,
    mc
  );
  if (!char.mastery.length && mc && sameCls) char.mastery = base.mastery.slice(0, mc);
  char.res = resFor(char);
  for (const [k, r] of Object.entries(char.res)) {
    r.left = numOr(c.res?.[k]?.left, r.max, 0, r.max);
  }
  syncChar(char);

  return {
    v: SCHEMA,
    id: str(g.id, 20),
    writer: str(g.writer, 20),
    name: str(g.name, 40) || "Untitled",
    created: numOr(g.created, Date.now()),
    updated: numOr(g.updated, Date.now()),
    turn: numOr(g.turn, 0, 0),
    status: g.status === "dead" ? "dead" : "active",
    epitaph: str(g.epitaph, 400),
    setting: {
      premise: str(g.setting?.premise, 600) || DEFAULT_SETTING.premise,
      tone: TONES.includes(g.setting?.tone) ? g.setting.tone : TONES[0]
    },
    flavour: cleanFlavour(g.flavour),
    artBrief: cleanArtBrief(g.artBrief),
    char,
    time: numOr(g.time, 960, 0),
    place: typeof g.place === "string" ? g.place : null,
    mood: MOODS.includes(g.mood) ? (g.mood as Mood) : "calm",
    summary: str(g.summary, 1200),
    chapter: str(g.chapter, 600),
    beats: arr<string>(g.beats, x => typeof x === "string").slice(-14),
    recent: arr(g.recent, isObj)
      .slice(-2)
      .map(r => ({ you: str(r.you, 400), out: str(r.out, 600) })),
    quests: arr(g.quests, isObj).map(q => ({
      id: str(q.id, 20) || rid(),
      title: str(q.title, 60) || "Untitled quest",
      obj: str(q.obj, 140),
      status: ["active", "done", "failed"].includes(q.status) ? q.status : "active",
      turn: numOr(q.turn, 0, 0)
    })),
    options: arr<string>(g.options, x => typeof x === "string").slice(0, 3),
    pending: cleanPending(g.pending, char),
    logChunk: numOr(g.logChunk, 0, 0),
    learn: g.learn !== false,
    combat: numOr(g.v, 1) < 5 ? null : cleanCombat(g.combat, char, foeRoster),
    nextAdv: g.nextAdv ? 1 : 0,
    prefs: numOr(g.v, 1) < 8 ? DEFAULT_PREFS : str(g.prefs, 300)
  };
}

export { cleanThreatClock, cleanFoeTemplate };
export type { ThreatClock, FoeTemplate };
