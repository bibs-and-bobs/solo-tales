/* Pure grid-based 2024 5e Combat Engine.
   Every call clones its input and returns { cs, ok, msg, lines, events, rolls, notes, res }.
   Positions are squares on a grid of 1.5 m squares (1,1 is NW corner; x runs east, y runs south). */

import { clone, deepFreeze, hurtWord } from "../util";
import {
  AMMO,
  COND,
  MONSTERS,
  SIZES,
  prof,
  type AbilityKey,
  type ConditionKey,
  type MonsterAttackDef,
  type MonsterMorale,
  type MonsterRole,
  type SizeCode
} from "../rules/srd";
import {
  armourClass,
  attacksOf,
  checkBonus,
  extraAttacks,
  refInfo,
  sizeOf,
  sneakDice,
  type CharacterState,
  type ClassResource,
  type HeroAttackProfile
} from "../rules/character";
import { resolveMonsterDef, type FoeTemplate } from "../rules/foe-roster";

export type CellTerrain = "wall" | "rough" | "cover";
export type ActorStatus = "active" | "dead" | "out" | "fled" | "surrendered";

export interface ActiveEffect {
  k: string;
  when: "start" | "end";
  of: string;
  left: number;
  target?: string | null;
  cond?: ConditionKey;
  item?: string;
}

export interface CombatActor {
  id: string;
  side: "pc" | "foe";
  kind: "pc" | "monster";
  ref?: string;
  baseRef?: string;
  npcId?: string | null;
  customName?: string | null;
  name: string;
  size: SizeCode;
  ac: number;
  hp: number;
  maxHp: number;
  speed: number;
  abil: Record<AbilityKey, number>;
  saves?: Partial<Record<AbilityKey, number>>;
  saveProf?: AbilityKey[];
  prof?: number;
  level?: number;
  cls?: string;
  stealth?: number;
  stealthDis?: boolean;
  armourDis?: boolean;
  sneak?: number;
  sneakTurn?: string;
  extra?: number;
  attacks?: HeroAttackProfile[];
  bag?: Array<{ id: string; name: string; ref: string | null; qty: number }>;
  res?: Record<string, ClassResource>;
  pp?: number;
  role?: MonsterRole;
  morale?: MonsterMorale;
  traits: string[];
  vuln?: string[];
  resist?: string[];
  immune?: string[];
  condImmune?: ConditionKey[];
  cond: ConditionKey[];
  fx: ActiveEffect[];
  x: number;
  y: number;
  status: ActorStatus;
  fleeing?: boolean;
  edge?: string | null;
  dead?: boolean;
  init: number;
  reaction: boolean;
}

export interface CombatTurnState {
  id: string;
  action: number;
  bonus: number;
  move: number;
  attacksLeft: number;
  light: string | null;
  lightThrown?: boolean;
  offhandDone: boolean;
  nickUsed: boolean;
  sneakDone: boolean;
  cleaveDone: boolean;
  loaded: boolean;
  disengaged: boolean;
  freeRuling?: boolean;
  skip: boolean;
}

export interface CombatOverState {
  result: "victory" | "defeat" | "fled";
  dead?: boolean;
  round: number;
  edge?: string | null;
}

export interface CombatState {
  v: number;
  map: { w: number; h: number; cells: Record<string, CellTerrain> };
  round: number;
  cur: number;
  order: string[];
  actors: Record<string, CombatActor>;
  pc: string;
  rng: number;
  startFoes: number;
  moraleChecked: boolean;
  leaderChecked: boolean;
  surprise: "pc" | "foes" | null;
  spent: Record<string, number>;
  turn: CombatTurnState | null;
  over: CombatOverState | null;
  log: string[];
  foeRoster?: Record<string, FoeTemplate>;
}

export interface CombatRollRecord {
  d: number;
  v: number;
  why: string;
}

export type CombatLogEvent =
  | {
      kind: "attack_roll";
      attackerId: string;
      attackerName: string;
      targetId: string;
      targetName: string;
      weaponName: string;
      opportunity: boolean;
      rollSummary: string;
      outcome: "critical hit" | "hit" | "natural 1, miss" | "miss";
      sneak: boolean;
      damageText: string | null;
      targetStatusText: string | null;
    }
  | {
      kind: "ruling_roll";
      actorName: string;
      rulingName: string;
      rollSummary: string;
      outcome: "critical success" | "success" | "failure";
    }
  | {
      kind: "move";
      actorId: string;
      actorName: string;
      to: [number, number];
    }
  | {
      kind: "down";
      actorId: string;
      actorName: string;
      how: "dead" | "out";
    };

export interface CombatStartSpec {
  pc: CharacterState;
  foes: Array<{
    ref: string;
    n?: number;
    at?: Array<[number, number] | null>;
    d?: number;
    name?: string | null;
    npcId?: string | null;
  }>;
  map?: {
    w?: number;
    h?: number;
    wall?: Array<[number, number]>;
    rough?: Array<[number, number]>;
    cover?: Array<[number, number]>;
  };
  hero?: [number, number] | null;
  surprise?: "pc" | "foes" | null;
  seed?: number;
  foeRoster?: Record<string, FoeTemplate>;
}

export interface RulingProposal {
  name: string;
  cost: "action" | "bonus" | "move" | "reaction" | "free";
  time?: number | null;
  check: {
    kind: "skill" | "ability" | "attack";
    key?: string;
    abil: AbilityKey;
    label: string;
    dc: number | null;
    adv?: number;
  };
  target: string | null;
  success: {
    damage: string | null;
    type: string;
    effect: { k: "cond" | "adv" | "dis" | "push" | "pull"; cond?: ConditionKey } | null;
    object: string | null;
  };
  failure: "none" | "lose" | "prone" | "disarmed" | "hurt";
  follow?: { text: string; cmd: CombatCommand } | null;
  capped?: string[];
}

export interface CombatCommand {
  type: string;
  target?: string | null;
  weapon?: string | null;
  ranged?: boolean;
  nonlethal?: boolean;
  dir?: "away" | "toward";
  to?: [number, number];
  item?: string;
  spell?: string;
  ruling?: RulingProposal;
  bonus?: number;
}

export interface CombatResult {
  cs: CombatState | null;
  ok: boolean;
  msg: string;
  lines: string[];
  events: CombatLogEvent[];
  rolls: CombatRollRecord[];
  notes: string[];
  res?: any;
}

export interface CombatOutcome {
  result: "victory" | "defeat" | "fled" | null;
  rounds: number;
  at: [number, number];
  edge: string | null;
  hp: number;
  dead: boolean;
  conditions: ConditionKey[];
  res: Record<string, ClassResource>;
  spent: Record<string, number>;
  foes: Array<{
    id: string;
    ref: string;
    baseRef: string;
    npcId: string | null;
    name: string;
    status: ActorStatus;
    at: [number, number];
    edge: string | null;
  }>;
}

interface ExecCtx {
  cs: CombatState;
  script: number[];
  rolls: CombatRollRecord[];
  lines: string[];
  events: CombatLogEvent[];
  notes: string[];
  res?: any;
}

export const Combat = (() => {
  const SQ = 1.5;
  const CELLS: readonly CellTerrain[] = ["wall", "rough", "cover"];
  const NEAR8: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1]
  ];
  const cl = clone;
  const lim = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
  const md = (s: number) => Math.floor((s - 10) / 2);
  const sgn = (n: number) => (n >= 0 ? "+" : "") + n;
  type CastHandler = (x: ExecCtx, pc: CombatActor, cmd: CombatCommand) => true | string;
  let CAST = null as CastHandler | null;

  /* ---- dice ---- */
  function rand(cs: CombatState): number {
    const s = (cs.rng = (cs.rng + 0x6d2b79f5) | 0);
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function die(x: ExecCtx, n: number, why: string): number {
    const v = x.script.length
      ? lim(Math.round(Number(x.script.shift()) || 1), 1, n)
      : 1 + Math.floor(rand(x.cs) * n);
    x.rolls.push({ d: n, v, why });
    return v;
  }

  function parseDice(e: string): { n: number; f: number; k: number } {
    const s = String(e).replace(/\s/g, "");
    let m = s.match(/^(\d+)d(\d+)([+-]\d+)?$/);
    if (m) return { n: +m[1], f: +m[2], k: +(m[3] || 0) };
    m = s.match(/^([+-]?\d+)$/);
    if (m) return { n: 0, f: 0, k: +m[1] };
    throw new Error("bad dice " + e);
  }

  function rollDice(x: ExecCtx, e: string, crit: boolean, why: string): number {
    const p = parseDice(e);
    let t = p.k;
    for (let i = 0; i < (crit ? 2 : 1) * p.n; i++) t += die(x, p.f, why);
    return t;
  }

  /* ---- lookups ---- */
  const pcOf = (cs: CombatState): CombatActor => cs.actors[cs.pc];
  const foes = (cs: CombatState): CombatActor[] => Object.values(cs.actors).filter(a => a.side === "foe");
  const active = (cs: CombatState): CombatActor[] => foes(cs).filter(a => a.status === "active");
  const has = (a: CombatActor, k: ConditionKey): boolean => a.cond.includes(k);
  const flag = (a: CombatActor, f: keyof (typeof COND)["blinded"]): boolean =>
    a.cond.some(k => Boolean(COND[k]?.[f]));
  const incap = (a: CombatActor): boolean => flag(a, "incap");
  const up = (a: CombatActor): boolean => (a.side === "pc" ? a.hp > 0 : a.status === "active");
  const shape = (a: CombatActor): string =>
    a.side === "pc" ? `${a.hp}/${a.maxHp} HP` : hurtWord(a.hp, a.maxHp);
  const mDef = (cs: CombatState, ref: string) =>
    resolveMonsterDef(ref, cs.foeRoster) || (MONSTERS[ref] ? { ...MONSTERS[ref], baseRef: ref } : null);

  /* ---- the grid ---- */
  const key = (x: number, y: number) => x + "," + y;
  const gap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const cellAt = (cs: CombatState, x: number, y: number): CellTerrain | null =>
    cs.map.cells[key(x, y)] || null;
  const inMap = (cs: CombatState, x: number, y: number) =>
    x >= 1 && y >= 1 && x <= cs.map.w && y <= cs.map.h;
  const free = (cs: CombatState, x: number, y: number, but?: CombatActor) =>
    inMap(cs, x, y) &&
    cellAt(cs, x, y) !== "wall" &&
    !Object.values(cs.actors).some(a => a !== but && up(a) && a.x === x && a.y === y);
  const stepCost = (cs: CombatState, x: number, y: number) =>
    cellAt(cs, x, y) === "rough" ? 2 * SQ : SQ;
  const edgeOf = (cs: CombatState, p: { x: number; y: number }) =>
    p.y === 1 ? "north" : p.y === cs.map.h ? "south" : p.x === 1 ? "west" : p.x === cs.map.w ? "east" : null;
  const enemies = (cs: CombatState, a: CombatActor) =>
    a.side === "pc" ? active(cs) : [pcOf(cs)].filter(up);
  const threats = (cs: CombatState, a: CombatActor) =>
    enemies(cs, a).filter(o => gap(o, a) <= 1 && !incap(o));

  interface PathNode {
    x: number;
    y: number;
    c: number;
    from: PathNode | null;
  }

  function paths(cs: CombatState, a: CombatActor, budget = Infinity): PathNode[] {
    const first: PathNode = { x: a.x, y: a.y, c: 0, from: null };
    const best: Record<string, PathNode> = { [key(a.x, a.y)]: first };
    const open: PathNode[] = [first];
    const held = new Set(
      Object.values(cs.actors)
        .filter(o => o !== a && up(o))
        .map(o => key(o.x, o.y))
    );
    while (open.length) {
      let i = 0;
      for (let j = 1; j < open.length; j++) if (open[j].c < open[i].c) i = j;
      const n = open.splice(i, 1)[0];
      if (best[key(n.x, n.y)] !== n) continue;
      for (const [dx, dy] of NEAR8) {
        const x = n.x + dx;
        const y = n.y + dy;
        const k = key(x, y);
        if (!inMap(cs, x, y) || cellAt(cs, x, y) === "wall" || held.has(k)) continue;
        const c = n.c + stepCost(cs, x, y);
        if (c > budget || (best[k] && best[k].c <= c)) continue;
        best[k] = { x, y, c, from: n };
        open.push(best[k]);
      }
    }
    return Object.values(best);
  }

  const route = (n: PathNode | null): PathNode[] => {
    const r: PathNode[] = [];
    for (let cur = n; cur && cur.from; cur = cur.from) r.unshift(cur);
    return r;
  };

  const pick = (nodes: PathNode[], score: (n: PathNode) => number | null): PathNode | null =>
    nodes
      .map(n => [score(n), n] as const)
      .filter((s): s is [number, PathNode] => s[0] != null)
      .sort((p, q) => q[0] - p[0] || p[1].c - q[1].c || p[1].y - q[1].y || p[1].x - q[1].x)[0]?.[1] || null;

  const wayOut = (cs: CombatState, a: CombatActor): PathNode | null =>
    pick(paths(cs, a), n =>
      edgeOf(cs, n) ? Math.min(99, ...enemies(cs, a).map(o => gap(n, o))) - n.c : null
    );

  function sees(cs: CombatState, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    let x = a.x;
    let y = a.y;
    const dx = Math.abs(b.x - x);
    const dy = Math.abs(b.y - y);
    let err = dx - dy;
    const sx = x < b.x ? 1 : -1;
    const sy = y < b.y ? 1 : -1;
    while (x !== b.x || y !== b.y) {
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
      if ((x !== b.x || y !== b.y) && cellAt(cs, x, y) === "wall") return false;
    }
    return true;
  }

  function walk(x: ExecCtx, a: CombatActor, steps: PathNode[]): void {
    const cs = x.cs;
    const t = cs.turn!;
    for (const s of steps) {
      const cost = stepCost(cs, s.x, s.y);
      if (t.move < cost) break;
      if (!t.disengaged) {
        for (const o of threats(cs, a)) {
          if (o.reaction && gap(o, s) > 1) {
            if (a.side === "pc" && !x.notes.some(n => /Disengage/.test(n))) {
              x.notes.push(
                "Leaving an enemy's reach without the Disengage action lets it make an opportunity attack. Disengage first next time, or accept the risk."
              );
            }
            opportunity(x, o, a);
            if (!up(a) || cs.over || has(a, "prone")) return;
          }
        }
      }
      if (cost > SQ && a.side === "pc" && !x.notes.some(n => /Rough/.test(n))) {
        x.notes.push("Rough ground costs double: 3 m of movement a square.");
      }
      t.move -= cost;
      a.x = s.x;
      a.y = s.y;
    }
  }

  function shove(
    cs: CombatState,
    a: CombatActor,
    from: { x: number; y: number },
    n: number,
    toward?: boolean
  ): boolean {
    const at = key(a.x, a.y);
    const way = toward ? -1 : 1;
    for (; n > 0 && !(toward && gap(a, from) <= 1); n--) {
      const len = Math.hypot(a.x - from.x, a.y - from.y) || 1;
      const tx = a.x + (way * (a.x - from.x)) / len;
      const ty = a.y + (way * (a.y - from.y)) / len;
      const off = (c: { x: number; y: number }) => (c.x - tx) ** 2 + (c.y - ty) ** 2;
      const c = NEAR8.map(([dx, dy]) => ({ x: a.x + dx, y: a.y + dy }))
        .filter(c => free(cs, c.x, c.y, a) && way * (gap(c, from) - gap(a, from)) > 0)
        .sort((p, q) => off(p) - off(q))[0];
      if (!c) break;
      a.x = c.x;
      a.y = c.y;
    }
    return key(a.x, a.y) !== at;
  }

  function place(cs: CombatState, a: CombatActor, want: { x: number; y: number }, d = 0): boolean {
    const pc = pcOf(cs);
    const cells: Array<{ x: number; y: number }> = [];
    const far = (c: { x: number; y: number }) => (c.x - want.x) ** 2 + (c.y - want.y) ** 2;
    const off = (c: { x: number; y: number }) => (d ? Math.abs(gap(c, pc) - d) : 0);
    for (let y = 1; y <= cs.map.h; y++) {
      for (let x = 1; x <= cs.map.w; x++) {
        if (free(cs, x, y, a)) cells.push({ x, y });
      }
    }
    const c = cells.sort(
      (p, q) => gap(p, want) - gap(q, want) || off(p) - off(q) || far(p) - far(q) || p.y - q.y || p.x - q.x
    )[0];
    a.x = c.x;
    a.y = c.y;
    return c.x === want.x && c.y === want.y;
  }

  function addCond(a: CombatActor, k: ConditionKey): boolean {
    if (!a.cond.includes(k) && !(a.condImmune || []).includes(k)) {
      a.cond.push(k);
      return true;
    }
    return false;
  }

  function speedOf(a: CombatActor): number {
    if (flag(a, "speed0")) return 0;
    const s = a.speed - (has(a, "exhaustion") ? 1.5 : 0) - (a.fx.some(e => e.k === "slow") ? 3 : 0);
    return Math.max(0, s);
  }

  function saveBonus(a: CombatActor, ab: AbilityKey): number {
    if (a.side === "pc") return md(a.abil[ab]) + (a.saveProf?.includes(ab) ? a.prof || 2 : 0);
    return a.saves?.[ab] ?? md(a.abil[ab]);
  }

  function save(x: ExecCtx, a: CombatActor, ab: AbilityKey, dc: number, why: string): boolean {
    if ((ab === "str" || ab === "dex") && flag(a, "failStrDex")) {
      x.lines.push(`${a.name} fails the ${ab.toUpperCase()} save automatically`);
      return false;
    }
    const dis =
      (ab === "dex" && flag(a, "dexSaveDis")) || ((ab === "str" || ab === "dex") && !!a.armourDis);
    const adv = ab === "dex" && a.fx.some(e => e.k === "dodge");
    const r1 = die(x, 20, why);
    const r2 = adv !== dis ? die(x, 20, why) : null;
    const kept = r2 == null ? r1 : adv ? Math.max(r1, r2) : Math.min(r1, r2);
    const tot = kept + saveBonus(a, ab) + (has(a, "exhaustion") ? -2 : 0);
    const ok = tot >= dc;
    x.lines.push(`${a.name} ${ab.toUpperCase()} save ${tot} vs DC ${dc}: ${ok ? "success" : "failure"}`);
    return ok;
  }

  function expire(cs: CombatState, when: "start" | "end", id: string): void {
    for (const a of Object.values(cs.actors)) {
      a.fx = a.fx.filter(e => {
        if (!(e.when === when && e.of === id && --e.left <= 0)) return true;
        if (e.k === "rcond" && e.cond && !a.fx.some(o => o !== e && o.k === "rcond" && o.cond === e.cond && o.left > 0)) {
          a.cond = a.cond.filter(k => k !== e.cond);
        }
        return false;
      });
    }
  }

  /* ---- building a fight ---- */
  function fromChar(c: CharacterState): CombatActor {
    const A = armourClass(c);
    return {
      id: "pc",
      side: "pc",
      kind: "pc",
      name: c.name,
      size: sizeOf(c),
      ac: A.ac,
      hp: c.hp,
      maxHp: c.maxHp,
      speed: Math.max(0, (c.speed || 9) - (A.heavySlow ? 3 : 0)),
      abil: { ...c.abil },
      prof: prof(c.level),
      level: c.level,
      cls: String(c.cls).toLowerCase(),
      saveProf: [...c.saves],
      stealth: checkBonus(c, { kind: "skill", key: "stealth", abil: "dex" }).bonus,
      stealthDis: A.stealthDis || A.untrained,
      armourDis: A.untrained,
      sneak: sneakDice(c),
      extra: extraAttacks(c),
      attacks: attacksOf(c),
      bag: (c.inv || []).map(i => ({ id: i.id, name: i.name, ref: i.ref || null, qty: i.qty })),
      res: cl(c.res || {}),
      traits: [],
      cond: [...(c.conditions || [])].filter(k => Boolean(COND[k])),
      fx: [],
      x: 0,
      y: 0,
      status: "active",
      init: 0,
      reaction: true
    };
  }

  function fromMonster(
    cs: CombatState,
    ref: string,
    i: number,
    n: number,
    customName?: string | null,
    npcId?: string | null
  ): CombatActor {
    const m = mDef(cs, ref)!;
    const baseName = customName || m.name;
    return {
      id: `${ref}_${i}`,
      side: "foe",
      kind: "monster",
      ref,
      baseRef: m.baseRef,
      npcId: npcId || null,
      customName: customName || null,
      name: n > 1 && !customName ? `${baseName} ${i}` : baseName,
      size: m.size,
      ac: m.ac,
      hp: m.hp,
      maxHp: m.hp,
      speed: m.speed,
      abil: { ...m.abil },
      saves: { ...m.saves },
      pp: m.pp,
      role: m.role,
      morale: m.morale,
      traits: [...m.traits],
      vuln: [...(m.vuln || [])],
      resist: [...(m.resist || [])],
      immune: [...(m.immune || [])],
      condImmune: [...(m.condImmune || [])],
      cond: [],
      fx: [],
      x: 0,
      y: 0,
      status: "active",
      fleeing: false,
      init: 0,
      reaction: true
    };
  }

  function ctx(cs: CombatState, script?: number[]): ExecCtx {
    return {
      cs,
      script: Array.isArray(script) ? script.slice() : [],
      rolls: [],
      lines: [],
      events: [],
      notes: []
    };
  }

  function done(x: ExecCtx): CombatResult {
    x.cs.log = [...x.cs.log, ...x.lines].slice(-80);
    return {
      cs: x.cs,
      ok: true,
      msg: "",
      lines: x.lines,
      events: x.events,
      rolls: x.rolls,
      notes: x.notes,
      res: x.res || null
    };
  }

  function start(spec: CombatStartSpec, script?: number[]): CombatResult {
    const list = Array.isArray(spec?.foes) ? spec.foes : [];
    if (!spec?.pc || !list.length) {
      return { cs: null, ok: false, msg: "A fight needs the hero and at least one foe.", lines: [], events: [], rolls: [], notes: [] };
    }
    const bad = list.find(f => !resolveMonsterDef(f?.ref, spec.foeRoster));
    if (bad) {
      return { cs: null, ok: false, msg: `Unknown monster: ${String(bad?.ref)}.`, lines: [], events: [], rolls: [], notes: [] };
    }
    const mp = spec.map || {};
    const side = (v: unknown) => lim(Math.round(Number(v) || 12), 6, 20);
    const sq = (p: unknown) =>
      Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1])
        ? { x: p[0] as number, y: p[1] as number }
        : null;

    const cs: CombatState = {
      v: 2,
      map: { w: side(mp.w), h: side(mp.h), cells: {} },
      round: 1,
      cur: -1,
      order: [],
      actors: {},
      pc: "pc",
      rng: (Number(spec.seed) >>> 0) || 1,
      startFoes: 0,
      moraleChecked: false,
      leaderChecked: false,
      surprise: spec.surprise === "pc" || spec.surprise === "foes" ? spec.surprise : null,
      spent: {},
      turn: null,
      over: null,
      log: [],
      ...(spec.foeRoster && Object.keys(spec.foeRoster).length ? { foeRoster: cl(spec.foeRoster) } : {})
    };
    const x = ctx(cs, script);
    for (const kind of CELLS) {
      for (const p of (Array.isArray(mp[kind]) ? mp[kind]! : []).map(sq)) {
        if (p && inMap(cs, p.x, p.y) && Object.keys(cs.map.cells).length < (cs.map.w * cs.map.h) / 3) {
          cs.map.cells[key(p.x, p.y)] = kind;
        }
      }
    }
    const pc = (cs.actors.pc = fromChar(spec.pc));
    const moved: Array<[CombatActor, { x: number; y: number }]> = [];
    const putActor = (a: CombatActor, at: { x: number; y: number } | null, d = 0) => {
      if (!place(cs, a, at || { x: pc.x + d, y: pc.y }, at ? 0 : d) && at) moved.push([a, at]);
    };
    putActor(pc, sq(spec.hero) || { x: Math.min(4, cs.map.w), y: Math.ceil(cs.map.h / 2) });

    let count = 0;
    for (const f of list) {
      const n = lim(Math.round(Number(f.n) || 1), 1, 8);
      const already = foes(cs).filter(a => a.ref === f.ref).length;
      for (let i = 1; i <= n && count < 12; i++, count++) {
        const a = fromMonster(
          cs,
          f.ref,
          already + i,
          already + n,
          n === 1 ? f.name : null,
          n === 1 ? f.npcId : null
        );
        cs.actors[a.id] = a;
        putActor(a, sq(f.at?.[i - 1]), lim(Math.round(Number(f.d) || 6), 1, 19));
      }
    }
    // Keep names unique across duplicate groups unless customName is set
    for (const ref of new Set(foes(cs).map(a => a.ref!))) {
      const g = foes(cs).filter(a => a.ref === ref && !a.customName);
      const def = mDef(cs, ref)!;
      g.forEach((a, i) => {
        a.name = g.length > 1 ? `${def.name} ${i + 1}` : def.name;
      });
    }
    cs.startFoes = foes(cs).length;
    for (const [a, at] of moved) {
      x.notes.push(`${a.name} couldn't start at ${at.x},${at.y}, so the rules put them on the nearest free square: ${a.x},${a.y}.`);
    }

    const rollInit = (a: CombatActor, label: string, dis: boolean, adv: boolean) => {
      const r1 = die(x, 20, "initiative " + label);
      const r2 = dis !== adv ? die(x, 20, "initiative " + label) : null;
      const k = r2 == null ? r1 : adv ? Math.max(r1, r2) : Math.min(r1, r2);
      return k + md(a.abil.dex) + (has(a, "exhaustion") ? -2 : 0);
    };
    pc.init = rollInit(pc, pc.name, cs.surprise === "pc" || incap(pc) || !!pc.armourDis, has(pc, "invisible"));
    const groups: string[] = [];
    for (const ref of new Set(foes(cs).map(a => a.ref!))) {
      const g = foes(cs).filter(a => a.ref === ref);
      const def = mDef(cs, ref)!;
      const v = rollInit(g[0], def.name, cs.surprise === "foes", false);
      g.forEach(a => {
        a.init = v;
      });
      const label = g.length === 1 && g[0].customName ? g[0].customName : `${def.name}${g.length > 1 ? "s" : ""}`;
      groups.push(`${label} ${v}`);
    }
    cs.order = Object.values(cs.actors)
      .sort(
        (a, b) =>
          b.init - a.init ||
          (a.side === "pc" ? -1 : b.side === "pc" ? 1 : 0) ||
          b.abil.dex - a.abil.dex ||
          a.id.localeCompare(b.id)
      )
      .map(a => a.id);
    x.lines.push(
      `Initiative: ${pc.name} ${pc.init}, ${groups.join(", ")}${
        cs.surprise ? ` (${cs.surprise === "pc" ? pc.name + " was" : "the foes were"} surprised)` : ""
      }`
    );
    nextTurn(x);
    settle(x);
    return done(x);
  }

  /* ---- turns ---- */
  function startTurn(x: ExecCtx, id: string): void {
    const cs = x.cs;
    const a = cs.actors[id];
    expire(cs, "start", id);
    a.reaction = true;
    cs.turn = {
      id,
      action: 1,
      bonus: 1,
      move: speedOf(a),
      attacksLeft: 0,
      light: null,
      offhandDone: false,
      nickUsed: false,
      sneakDone: false,
      cleaveDone: false,
      loaded: false,
      disengaged: false,
      skip: false
    };
    x.lines.push(`Round ${cs.round}: ${a.name}'s turn`);
    if (incap(a)) {
      cs.turn.skip = true;
      x.lines.push(`${a.name} can't act (${a.cond.filter(k => COND[k]?.incap).join(", ")})`);
    }
  }

  function nextTurn(x: ExecCtx): void {
    const cs = x.cs;
    for (let i = 0; i < cs.order.length; i++) {
      cs.cur++;
      if (cs.cur >= cs.order.length) {
        cs.cur = 0;
        cs.round++;
      }
      const a = cs.actors[cs.order[cs.cur]];
      if (a.status === "active") {
        startTurn(x, a.id);
        return;
      }
    }
    cs.turn = null;
  }

  function endTurn(x: ExecCtx): void {
    const cs = x.cs;
    if (!cs.turn) return;
    expire(cs, "end", cs.turn.id);
    nextTurn(x);
  }

  function settle(x: ExecCtx): void {
    const cs = x.cs;
    for (let guard = 0; !cs.over && cs.turn && guard < 400; guard++) {
      const a = cs.actors[cs.turn.id];
      if (cs.turn.skip || a.status !== "active") {
        endTurn(x);
        continue;
      }
      if (a.side === "pc") return;
      foeTurn(x, a);
      if (!cs.over) endTurn(x);
    }
  }

  function checkOver(x: ExecCtx): boolean {
    const cs = x.cs;
    const pc = pcOf(cs);
    if (cs.over) return true;
    if (pc.hp <= 0) cs.over = { result: "defeat", dead: !!pc.dead, round: cs.round };
    else if (!active(cs).length) cs.over = { result: "victory", round: cs.round };
    if (cs.over) x.lines.push(cs.over.result === "victory" ? "The fight is won" : `${pc.name} falls`);
    return !!cs.over;
  }

  /* ---- attacks ---- */
  interface AttackWeaponProfile {
    name: string;
    ranged: boolean;
    bonus: number;
    dice: string;
    mod: number;
    type: string;
    range: [number, number] | null;
    advDmg?: string;
    extra: Array<{ dmg: string; type: string }>;
    onHit?: { cond: ConditionKey; maxSize: SizeCode };
    props: string[];
    item?: string | null;
    thrown?: boolean;
    ammo?: string | null;
    mastery?: string | null;
    abilMod?: number;
    kind?: "melee" | "ranged";
  }

  function monsterProfile(at: MonsterAttackDef, g: number): AttackWeaponProfile {
    const p = parseDice(at.dmg);
    const ranged = at.kind === "ranged" || (at.kind === "both" && g > 1);
    return {
      name: at.name,
      ranged,
      bonus: at.bonus,
      dice: p.n ? `${p.n}d${p.f}` : String(p.k),
      mod: p.n ? p.k : 0,
      type: at.type,
      range: at.range ? [at.range[0], at.range[1]] : null,
      advDmg: at.advDmg,
      extra: at.extra || [],
      onHit: at.onHit,
      props: []
    };
  }

  function heroProfile(w: HeroAttackProfile, g: number, thrown?: boolean): AttackWeaponProfile {
    const ranged = w.kind === "ranged" || (w.thrown && (g > 1 || !!thrown));
    return { ...w, ranged, extra: [] };
  }

  function setup(cs: CombatState, att: CombatActor, tgt: CombatActor, p: AttackWeaponProfile) {
    const g = gap(att, tgt);
    const dist = SQ * g;
    const adv: string[] = [];
    const dis: string[] = [];
    if (p.ranged) {
      if (!p.range) return { ok: false as const, msg: `${p.name} can't reach that far.` };
      if (dist > p.range[1]) return { ok: false as const, msg: `${tgt.name} is beyond ${p.name}'s range.` };
      if (!sees(cs, att, tgt)) return { ok: false as const, msg: `There's no clear shot at ${tgt.name}: a wall is in the way.` };
      if (dist > p.range[0]) dis.push("long range");
      if (threats(cs, att).length) dis.push("shooting with an enemy in melee reach");
    } else if (g > 1) {
      return {
        ok: false as const,
        msg: `${tgt.name} is ${dist} m away, out of melee reach. Move next to it first.`,
        learn: "Melee attacks need the target within reach: move to a square next to it first."
      };
    }
    if (has(att, "invisible")) adv.push("unseen attacker");
    if (has(tgt, "invisible")) dis.push("target unseen");
    for (const k of att.cond) if (COND[k]?.attackDis) dis.push(k);
    for (const k of tgt.cond) if (COND[k]?.attackedAdv) adv.push("target " + k);
    if (flag(tgt, "prone") && !has(tgt, "unconscious")) {
      (g <= 1 ? adv : dis).push(g <= 1 ? "target prone and close" : "target prone and far");
    }
    if (tgt.fx.some(e => e.k === "dodge") && !incap(tgt) && !has(att, "invisible")) dis.push("target dodging");
    if (
      att.traits?.includes("pack_tactics") &&
      tgt.side === "pc" &&
      active(cs).some(f => f.id !== att.id && gap(f, tgt) <= 1 && !incap(f))
    ) {
      adv.push("pack tactics");
    }
    if (att.fx.some(e => e.k === "vex" && e.target === tgt.id)) adv.push("vex");
    if (att.fx.some(e => e.k === "sap")) dis.push("sapped");
    if (att.fx.some(e => e.k === "radv" && (!e.target || e.target === tgt.id))) adv.push("your creative move");
    if (att.fx.some(e => e.k === "rdis")) dis.push("thrown off by your creative move");
    if (att.armourDis) dis.push("armour without training");
    if (att.side === "pc" && p.props?.includes("heavy") && (p.ranged ? att.abil.dex : att.abil.str) < 13) {
      dis.push("heavy weapon, too weak");
    }
    const net = adv.length && dis.length ? 0 : adv.length ? 1 : dis.length ? -1 : 0;
    const penalty = has(att, "exhaustion") ? 2 : 0;
    const cover = p.ranged && cellAt(cs, tgt.x, tgt.y) === "cover";
    return {
      ok: true as const,
      g,
      adv: net,
      advWhy: adv,
      disWhy: dis,
      bonus: p.bonus - penalty,
      ac: tgt.ac + (cover ? 2 : 0),
      cover
    };
  }

  function applyDamage(
    x: ExecCtx,
    tgt: CombatActor,
    parts: Array<{ v: number; type: string }>,
    crit: boolean
  ): { total: number; text: string; before: number } {
    const byType: Record<string, number> = {};
    for (const pt of parts) byType[pt.type] = (byType[pt.type] || 0) + Math.max(0, pt.v);
    let total = 0;
    const bits: string[] = [];
    for (const [type, raw] of Object.entries(byType)) {
      let v = raw;
      if (tgt.immune?.includes(type)) v = 0;
      else {
        if (tgt.resist?.includes(type) || flag(tgt, "resistAll")) v = Math.floor(v / 2);
        if (tgt.vuln?.includes(type)) v *= 2;
      }
      if (v) bits.push(`${v} ${type}`);
      total += v;
    }
    const before = tgt.hp;
    tgt.hp = Math.max(0, tgt.hp - total);
    if (tgt.side === "pc") {
      if (tgt.hp === 0 && total - before >= tgt.maxHp) tgt.dead = true;
    } else if (
      tgt.hp === 0 &&
      tgt.traits.includes("undead_fortitude") &&
      total > 0 &&
      !crit &&
      !parts.some(pt => pt.type === "radiant")
    ) {
      if (save(x, tgt, "con", 5 + total, "undead fortitude")) {
        tgt.hp = 1;
        x.lines.push(`${tgt.name} refuses to fall (Undead Fortitude)`);
      }
    }
    return { total, text: bits.join(" + ") || "no damage", before };
  }

  function foeDown(x: ExecCtx, f: CombatActor, how: "dead" | "out"): void {
    const cs = x.cs;
    f.status = how;
    f.fleeing = false;
    if (how === "out") addCond(f, "unconscious");
    x.lines.push(`${f.name} ${how === "out" ? "is knocked out" : "dies"}`);
    x.events.push({ kind: "down", actorId: f.id, actorName: f.name, how });
    if (f.role === "leader" && !cs.leaderChecked) {
      cs.leaderChecked = true;
      morale(x, "their leader fell");
    }
    if (active(cs).length <= Math.floor(cs.startFoes / 2)) morale(x, "half of them are down");
    checkOver(x);
  }

  function morale(x: ExecCtx, why: string): void {
    const cs = x.cs;
    const left = active(cs).filter(f => !f.fleeing && f.morale !== "fearless");
    if (cs.startFoes < 2 || !left.length) return;
    if (why === "half of them are down") {
      if (cs.moraleChecked) return;
      cs.moraleChecked = true;
    }
    x.lines.push(`Morale check: ${why}`);
    for (const f of left) {
      if (!save(x, f, "wis", 10, "morale")) {
        f.fleeing = true;
        x.lines.push(`${f.name} breaks and tries to flee`);
      }
    }
  }

  function attack(
    x: ExecCtx,
    att: CombatActor,
    tgt: CombatActor,
    p: AttackWeaponProfile,
    opts: { offhand?: boolean; cleave?: boolean; nonlethal?: boolean; opportunity?: boolean } = {}
  ) {
    const cs = x.cs;
    const pc = pcOf(cs);
    const hero = att.side === "pc";
    if (hero && tgt.traits?.includes("redirect_attack") && tgt.reaction && !incap(tgt)) {
      const ally = active(cs).find(
        f => f.id !== tgt.id && gap(f, tgt) <= 1 && !incap(f) && ["S", "M"].includes(f.size)
      );
      if (ally) {
        tgt.reaction = false;
        x.lines.push(`${tgt.name} shoves ${ally.name} into the way`);
        [ally.x, ally.y, tgt.x, tgt.y] = [tgt.x, tgt.y, ally.x, ally.y];
        tgt = ally;
      }
    }
    const s = setup(cs, att, tgt, p);
    if (!s.ok) return s;
    const r1 = die(x, 20, "attack");
    const r2 = s.adv ? die(x, 20, "attack") : null;
    const kept = s.adv > 0 ? Math.max(r1, r2!) : s.adv < 0 ? Math.min(r1, r2!) : r1;
    const total = kept + s.bonus;
    let crit = kept === 20;
    const hit = kept !== 1 && (crit || total >= s.ac);
    if (hit && s.g <= 1 && flag(tgt, "meleeCrit")) crit = true;
    att.fx = att.fx.filter(
      e =>
        !(e.k === "vex" && e.target === tgt.id) &&
        e.k !== "sap" &&
        e.k !== "rdis" &&
        !(e.k === "radv" && (!e.target || e.target === tgt.id))
    );
    if (has(att, "invisible")) {
      att.cond = att.cond.filter(k => k !== "invisible");
      x.lines.push(`${att.name} gives away their hiding place`);
    }
    if (hero && p.item) {
      if (p.ranged && p.thrown) cs.spent[p.item] = (cs.spent[p.item] || 0) + 1;
      if (p.ammo && pc.bag) {
        const it = pc.bag.find(i => refInfo(i.ref)?.k === p.ammo && i.qty - (cs.spent[i.id] || 0) > 0);
        if (it) cs.spent[it.id] = (cs.spent[it.id] || 0) + 1;
      }
    }
    const roll = `${r2 == null ? kept : `${r1}/${r2}→${kept}`}${sgn(s.bonus)}=${total} vs AC ${s.ac}`;
    const what = `${att.name} ${opts.opportunity ? "makes an opportunity attack on" : "attacks"} ${tgt.name} with ${p.name}${
      opts.offhand ? " (off hand)" : ""
    }${opts.cleave ? " (cleave)" : ""}`;
    const res: any = {
      hit,
      crit,
      kept,
      total,
      adv: s.adv,
      advWhy: s.advWhy,
      disWhy: s.disWhy,
      target: tgt.id,
      dmg: 0
    };
    if (s.cover && hero) x.notes.push("Cover: a target behind cover has +2 AC against ranged attacks.");
    if (!hit) {
      const outcomeWord = kept === 1 ? "natural 1, miss" : "miss";
      x.lines.push(`${what}: ${roll}, ${kept === 1 ? "natural 1, " : ""}miss`);
      x.events.push({
        kind: "attack_roll",
        attackerId: att.id,
        attackerName: att.name,
        targetId: tgt.id,
        targetName: tgt.name,
        weaponName: p.name,
        opportunity: !!opts.opportunity,
        rollSummary: roll,
        outcome: outcomeWord,
        sneak: false,
        damageText: null,
        targetStatusText: null
      });
      if (hero && p.mastery === "graze" && (p.abilMod || 0) > 0) {
        const d = applyDamage(x, tgt, [{ v: p.abilMod!, type: p.type }], false);
        res.dmg = d.total;
        x.lines.push(`Graze: ${d.text}`);
        afterHit(x, att, tgt, p, opts, d, false);
      }
      return { ok: true as const, res };
    }
    const noMod = opts.offhand || opts.cleave;
    const parts = [{ v: rollDice(x, p.dice, crit, "damage") + (noMod ? Math.min(0, p.mod) : p.mod), type: p.type }];
    if (p.advDmg && s.adv > 0) parts.push({ v: rollDice(x, p.advDmg, crit, "damage"), type: p.type });
    for (const e of p.extra || []) parts.push({ v: rollDice(x, e.dmg, crit, "damage"), type: e.type });
    const sneakKey = `${cs.round}:${cs.turn?.id}`;
    if (
      hero &&
      att.sneak &&
      att.sneakTurn !== sneakKey &&
      s.adv > 0 &&
      (p.kind === "ranged" || p.props?.includes("finesse"))
    ) {
      att.sneakTurn = sneakKey;
      parts.push({ v: rollDice(x, `${att.sneak}d6`, crit, "sneak attack"), type: p.type });
      res.sneak = true;
    }
    const d = applyDamage(x, tgt, parts, crit);
    res.dmg = d.total;
    const tgtShape = `${tgt.name} ${shape(tgt)}`;
    x.lines.push(
      `${what}: ${roll}, ${crit ? "critical hit" : "hit"}${res.sneak ? " with Sneak Attack" : ""}, ${d.text} (${tgtShape})`
    );
    x.events.push({
      kind: "attack_roll",
      attackerId: att.id,
      attackerName: att.name,
      targetId: tgt.id,
      targetName: tgt.name,
      weaponName: p.name,
      opportunity: !!opts.opportunity,
      rollSummary: roll,
      outcome: crit ? "critical hit" : "hit",
      sneak: !!res.sneak,
      damageText: d.text,
      targetStatusText: tgtShape
    });
    afterHit(x, att, tgt, p, opts, d, true);
    return { ok: true as const, res };
  }

  function afterHit(
    x: ExecCtx,
    att: CombatActor,
    tgt: CombatActor,
    p: Pick<AttackWeaponProfile, "mastery" | "ranged" | "onHit" | "abilMod">,
    opts: { offhand?: boolean; cleave?: boolean; nonlethal?: boolean },
    d: { total: number; text: string },
    hit?: boolean
  ): void {
    const cs = x.cs;
    const hero = att.side === "pc";
    if (tgt.side === "pc") {
      checkOver(x);
    } else if (tgt.hp <= 0) {
      foeDown(x, tgt, opts.nonlethal && !p.ranged ? "out" : "dead");
    } else if (tgt.morale === "coward" && !tgt.fleeing && tgt.hp <= tgt.maxHp / 2) {
      tgt.fleeing = true;
      x.lines.push(`${tgt.name} is bloodied and turns to run`);
    }
    if (!hit || cs.over) return;
    const alive = tgt.status === "active" || (tgt.side === "pc" && tgt.hp > 0);
    if (
      p.onHit?.cond &&
      alive &&
      SIZES.indexOf(tgt.size) <= SIZES.indexOf(p.onHit.maxSize) &&
      addCond(tgt, p.onHit.cond)
    ) {
      x.lines.push(`${tgt.name} is knocked ${p.onHit.cond}`);
    }
    if (!hero || !p.mastery || (opts.offhand && p.mastery === "nick")) return;
    const mine = cs.turn?.id === att.id;
    if (p.mastery === "vex" && d.total > 0 && alive) {
      att.fx.push({ k: "vex", target: tgt.id, when: "end", of: att.id, left: mine ? 2 : 1 });
      x.lines.push(`Vex: Advantage on the next attack against ${tgt.name}`);
    }
    if (p.mastery === "sap" && alive) {
      tgt.fx.push({ k: "sap", when: "start", of: att.id, left: 1 });
      x.lines.push(`Sap: ${tgt.name} has Disadvantage on its next attack`);
    }
    if (p.mastery === "slow" && d.total > 0 && alive && !tgt.fx.some(e => e.k === "slow")) {
      tgt.fx.push({ k: "slow", when: "start", of: att.id, left: 1 });
      x.lines.push(`Slow: ${tgt.name} loses 3 m of Speed`);
    }
    if (p.mastery === "topple" && alive && !has(tgt, "prone")) {
      if (!save(x, tgt, "con", 8 + (p.abilMod || 0) + (att.prof || 2), "topple")) {
        addCond(tgt, "prone");
        x.lines.push(`Topple: ${tgt.name} falls prone`);
      }
    }
    if (p.mastery === "push" && alive && SIZES.indexOf(tgt.size) <= SIZES.indexOf("L") && shove(cs, tgt, att, 2)) {
      x.lines.push(`Push: ${tgt.name} is shoved back to ${tgt.x},${tgt.y}`);
    }
    if (p.mastery === "cleave" && !p.ranged && !opts.cleave && mine && !cs.turn!.cleaveDone) {
      const next = active(cs).find(f => f.id !== tgt.id && gap(f, att) <= 1 && gap(f, tgt) <= 1);
      if (next) {
        cs.turn!.cleaveDone = true;
        attack(x, att, next, p as AttackWeaponProfile, { cleave: true });
      }
    }
  }

  function opportunity(x: ExecCtx, reactor: CombatActor, mover: CombatActor): void {
    if (!reactor.reaction || incap(reactor) || reactor.status !== "active" || x.cs.over) return;
    let p: AttackWeaponProfile;
    if (reactor.side === "pc") {
      const w = pickWeapon(reactor, null, 1, x.cs);
      if (!w) return;
      p = heroProfile(w, 1);
    } else {
      const def = mDef(x.cs, reactor.ref!);
      const at = def?.attacks.find(a => a.kind !== "ranged");
      if (!at) return;
      p = monsterProfile(at, 1);
    }
    reactor.reaction = false;
    attack(x, reactor, mover, p, { opportunity: true });
  }

  /* ---- enemy behaviour ---- */
  function goTo(x: ExecCtx, a: CombatActor, node: PathNode | null): void {
    const from = key(a.x, a.y);
    walk(x, a, route(node));
    if (key(a.x, a.y) !== from && up(a)) {
      x.lines.push(`${a.name} moves to ${a.x},${a.y}`);
      x.events.push({ kind: "move", actorId: a.id, actorName: a.name, to: [a.x, a.y] });
    }
  }

  function approach(x: ExecCtx, a: CombatActor): void {
    const cs = x.cs;
    const pc = pcOf(cs);
    const all = paths(cs, a);
    if (gap(a, pc) <= 1) return;
    goTo(x, a, pick(all, n => (gap(n, pc) === 1 ? -n.c : null)) || pick(all, n => -gap(n, pc)));
  }

  function foeTurn(x: ExecCtx, a: CombatActor): void {
    const cs = x.cs;
    const t = cs.turn!;
    const pc = pcOf(cs);
    const m = mDef(cs, a.ref!)!;
    if (has(a, "prone")) {
      const half = Math.ceil(a.speed / 2);
      if (t.move >= half) {
        t.move -= half;
        a.cond = a.cond.filter(k => k !== "prone");
        x.lines.push(`${a.name} gets up`);
      }
    }
    if (a.fleeing) return flee(x, a);
    const melee = m.attacks.filter(k => k.kind !== "ranged");
    const shots = m.attacks.filter(k => k.kind !== "melee" && k.range);
    const shot = (at: { x: number; y: number }) =>
      shots.find(k => SQ * gap(at, pc) <= k.range![1] && sees(cs, at, pc));
    if (shots.length && (a.role === "skirmisher" || (a.role === "leader" && active(cs).length > 1))) {
      if (gap(a, pc) <= 1) {
        if (a.traits.includes("nimble_escape") && t.bonus && t.move >= SQ) {
          t.bonus = 0;
          t.disengaged = true;
          x.lines.push(`${a.name} slips away (Nimble Escape)`);
          goTo(x, a, pick(paths(cs, a, t.move), n => (gap(n, pc) > 1 && shot(n) ? gap(n, pc) : null)));
        }
      } else if (!shot(a)) {
        const all = paths(cs, a, t.move);
        goTo(x, a, pick(all, n => (gap(n, pc) > 1 && shot(n) ? -n.c : null)) || pick(all, n => -gap(n, pc)));
      }
      return attackAction(x, a, gap(a, pc) <= 1 && melee.length ? melee[0] : shot(a) || melee[0]);
    }
    approach(x, a);
    if (!up(a) || cs.over) return;
    if (gap(a, pc) <= 1 && melee.length) return attackAction(x, a, melee[0]);
    if (shot(a)) return attackAction(x, a, shot(a)!);
    t.action = 0;
    t.move += speedOf(a);
    x.lines.push(`${a.name} dashes`);
    approach(x, a);
  }

  function attackAction(x: ExecCtx, a: CombatActor, at: MonsterAttackDef | undefined): void {
    const cs = x.cs;
    const pc = pcOf(cs);
    if (!at || !cs.turn?.action) return;
    cs.turn.action = 0;
    const multi = mDef(cs, a.ref!)?.multi || 1;
    for (let i = 0; i < multi && !cs.over && a.status === "active"; i++) {
      const r = attack(x, a, pc, monsterProfile(at, gap(a, pc)));
      if (!r.ok) {
        x.lines.push(`${a.name} holds back (${r.msg})`);
        return;
      }
    }
  }

  function flee(x: ExecCtx, a: CombatActor): void {
    const cs = x.cs;
    const t = cs.turn!;
    const pc = pcOf(cs);
    if (gap(a, pc) <= 1) {
      if (a.traits.includes("nimble_escape") && t.bonus) {
        t.bonus = 0;
        t.disengaged = true;
      } else if (t.action) {
        t.action = 0;
        t.disengaged = true;
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      const out = wayOut(cs, a);
      if (!out || speedOf(a) === 0) {
        a.status = "surrendered";
        a.fleeing = false;
        x.lines.push(`${a.name} can't get away and surrenders`);
        checkOver(x);
        return;
      }
      walk(x, a, route(out));
      if (!up(a) || cs.over) return;
      if (a.x === out.x && a.y === out.y && t.move >= SQ) {
        a.status = "fled";
        a.edge = edgeOf(cs, a);
        x.lines.push(`${a.name} escapes off the ${a.edge} edge`);
        checkOver(x);
        return;
      }
      if (t.action) {
        t.action = 0;
        t.move += speedOf(a);
      } else break;
    }
    x.lines.push(`${a.name} runs to ${a.x},${a.y}`);
  }

  /* ---- the hero's commands ---- */
  function findTarget(cs: CombatState, q?: string | null): CombatActor | null {
    const list = active(cs);
    if (!list.length) return null;
    const pc = pcOf(cs);
    const near = (a: CombatActor, b: CombatActor) => gap(a, pc) - gap(b, pc);
    if (!q) return list.sort(near)[0];
    if (cs.actors[q]?.side === "foe" && cs.actors[q].status === "active") return cs.actors[q];
    const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (ws: string[]) =>
      list.filter(a => {
        const nm = a.name.toLowerCase();
        const parts = nm.split(/\s+/);
        return ws.every(w => (/^\d+$/.test(w) ? parts.includes(w) : nm.includes(w)));
      });
    let hits = matches(words);
    if (!hits.length && words.some(w => /^\d+$/.test(w))) {
      hits = matches(words.filter(w => !/^\d+$/.test(w))).filter(a => !/\d$/.test(a.name));
    }
    return hits.sort(near)[0] || null;
  }

  const ammoOk = (pc: CombatActor, w: HeroAttackProfile, cs: CombatState): boolean =>
    Boolean(
      pc.bag?.some(i => {
        const r = refInfo(i.ref);
        return r?.t === "ammo" && r.k === w.ammo && i.qty - (cs.spent[i.id] || 0) > 0;
      })
    );

  function pickWeapon(
    pc: CombatActor,
    q: string | null | undefined,
    g: number,
    cs: CombatState,
    ranged?: boolean
  ): HeroAttackProfile | null {
    const usable = (pc.attacks || []).filter(w => {
      const it = w.item && pc.bag?.find(i => i.id === w.item);
      if (it && it.qty - (cs.spent[it.id] || 0) < 1) return false;
      if (w.item && pc.fx.some(e => e.k === "disarmed" && e.item === w.item)) return false;
      return true;
    });
    if (q) {
      const n = String(q).toLowerCase();
      return (
        usable.find(w => w.item === q || w.key === q || w.name.toLowerCase() === n) ||
        usable.find(w => w.name.toLowerCase().includes(n) || w.key.includes(n.replace(/\s+/g, "_"))) ||
        null
      );
    }
    const far = (w: HeroAttackProfile) => (w.kind === "ranged" ? !w.ammo || ammoOk(pc, w, cs) : w.thrown);
    if (ranged) {
      const r =
        usable.find(w => far(w) && w.kind === "ranged" && w.range && SQ * g <= w.range[1]) ||
        usable.find(w => far(w) && w.range && SQ * g <= w.range[1]);
      if (r) return r;
    }
    if (g <= 1) {
      return (
        usable.find(w => w.kind === "melee" && w.eq) ||
        usable.find(w => w.kind === "melee" && w.key !== "unarmed") ||
        usable.find(w => w.key === "unarmed") ||
        null
      );
    }
    return (
      usable.find(w => w.kind === "ranged" && (!w.ammo || ammoOk(pc, w, cs)) && w.range && SQ * g <= w.range[1]) ||
      usable.find(w => w.thrown && w.range && SQ * g <= w.range[1]) ||
      null
    );
  }

  function heroAttack(x: ExecCtx, pc: CombatActor, cmd: CombatCommand, offhand: boolean): true | string {
    const cs = x.cs;
    const t = cs.turn!;
    const tgt = findTarget(cs, cmd.target);
    if (!tgt) return "Pick a target that's still fighting.";
    const g = gap(pc, tgt);
    const w = pickWeapon(pc, cmd.weapon, g, cs, !!cmd.ranged);
    if (!w) {
      return cmd.weapon
        ? `You don't have a usable ${cmd.weapon}.`
        : g <= 1
        ? "You have nothing to attack with."
        : `${tgt.name} is ${SQ * g} m away. Nothing you carry reaches; move closer or throw something.`;
    }
    const p = heroProfile(w, g, cmd.ranged);
    if (p.ammo && !ammoOk(pc, w, cs)) return `You're out of ${AMMO[p.ammo].name.toLowerCase()}.`;
    if (p.props.includes("loading") && t.loaded) return `${w.name} has the Loading property: one shot per action.`;
    if (offhand) {
      if (!t.light) return "An off-hand attack needs an attack with a Light weapon first this turn.";
      if (t.offhandDone) return "You've already made your off-hand attack this turn.";
      if (!p.props.includes("light")) return `${w.name} isn't a Light weapon, so it can't make the off-hand attack.`;
      const sameItem = w.item && w.item === t.light;
      if (
        sameItem &&
        (pc.bag?.find(i => i.id === w.item)?.qty || 0) - (cs.spent[w.item!] || 0) < (t.lightThrown ? 1 : 2)
      ) {
        return "The off-hand attack needs a second Light weapon.";
      }
      const nick = w.mastery === "nick" && !t.nickUsed;
      if (!nick && !t.bonus) return "You've used your Bonus Action this turn.";
      const s = setup(cs, pc, tgt, p);
      if (!s.ok) return s.msg;
      if (nick) t.nickUsed = true;
      else t.bonus = 0;
      t.offhandDone = true;
      attack(x, pc, tgt, p, { offhand: true });
      if (nick) {
        x.notes.push("Nick: the off-hand attack was part of your Attack action, so your Bonus Action is still free.");
      }
      return true;
    }
    const s = setup(cs, pc, tgt, p);
    if (!s.ok) {
      if (s.learn) x.notes.push(s.learn);
      return s.msg;
    }
    if (t.attacksLeft > 0) t.attacksLeft--;
    else if (t.action) {
      t.action = 0;
      t.attacksLeft = pc.extra || 0;
      t.loaded = false;
    } else return "You've used your action this turn.";
    if (p.props.includes("loading")) t.loaded = true;
    if (s.disWhy.includes("shooting with an enemy in melee reach")) {
      x.notes.push(
        "Ranged attacks have Disadvantage while an enemy is within reach of you. Step back first, or use a melee weapon."
      );
    }
    if (s.disWhy.includes("long range")) {
      x.notes.push("Past a weapon's normal range, attacks have Disadvantage.");
    }
    if (p.props.includes("light") && !t.light) {
      t.light = w.item || w.key;
      t.lightThrown = !!(p.ranged && p.thrown);
    }
    attack(x, pc, tgt, p, { nonlethal: !!cmd.nonlethal });
    return true;
  }

  /* ---- creative rulings (phase 2C) ---- */
  const RULING = {
    costs: ["action", "bonus", "move", "reaction", "free"],
    dcs: [10, 13, 15, 18],
    conds: ["blinded", "deafened", "frightened", "grappled", "poisoned", "prone", "restrained"],
    effects: ["cond", "adv", "dis", "push", "pull"],
    setbacks: ["none", "lose", "prone", "disarmed", "hurt"],
    types: [
      "acid",
      "bludgeoning",
      "cold",
      "fire",
      "force",
      "lightning",
      "necrotic",
      "piercing",
      "poison",
      "psychic",
      "radiant",
      "slashing",
      "thunder"
    ]
  };
  const capDice = (level: number) => (level >= 11 ? "4d6" : level >= 5 ? "2d6" : "1d6");
  const halfMove = (a: CombatActor) => Math.ceil(a.speed / 2);
  const needsTarget = (r: RulingProposal) =>
    r.check.kind === "attack" ||
    !!r.success.damage ||
    ["cond", "dis", "push", "pull"].includes(r.success.effect?.k || "");
  const pc0abil: Record<AbilityKey, number> = { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 };

  function isRuling(r: any): r is RulingProposal {
    return (
      typeof r?.name === "string" &&
      RULING.costs.includes(r.cost) &&
      r.check &&
      ["skill", "ability", "attack"].includes(r.check.kind) &&
      Object.hasOwn(pc0abil, r.check.abil) &&
      (r.check.kind === "attack" || RULING.dcs.includes(r.check.dc)) &&
      r.success &&
      (r.success.effect == null || RULING.effects.includes(r.success.effect.k)) &&
      RULING.setbacks.includes(r.failure)
    );
  }

  function rulingCheck(cs: CombatState, r: any, pageBonus?: number) {
    const pc = pcOf(cs);
    const t = cs.turn!;
    if (!r || !isRuling(r)) return { ok: false as const, msg: "That ruling can't be used." };
    const costEntry = {
      action: [t.action, "You've used your action this turn."],
      bonus: [t.bonus, "You've used your Bonus Action this turn."],
      move: [
        t.move >= halfMove(pc) && speedOf(pc) > 0,
        `That takes ${halfMove(pc)} m of movement and you have ${t.move} m left.`
      ],
      reaction: [pc.reaction, "You've used your Reaction."],
      free: [!t.freeRuling, "You've already made a free creative move this turn."]
    }[r.cost];
    if (!costEntry[0]) return { ok: false as const, msg: costEntry[1] as string };
    if (r.cost === "free" && (r.success.damage || r.success.effect)) {
      return { ok: false as const, msg: "A free move can't hurt or hinder anyone. Give it a cost." };
    }
    let tgt: CombatActor | null = null;
    if (needsTarget(r)) {
      tgt = findTarget(cs, r.target);
      if (!tgt) return { ok: false as const, msg: "Pick a target that's still fighting." };
      if (gap(pc, tgt) > 6) {
        return {
          ok: false as const,
          msg: `${tgt.name} is too far away for that (${SQ * gap(pc, tgt)} m; a creative move reaches 9 m).`
        };
      }
    }
    if (r.check.kind === "attack") {
      const s = setup(cs, pc, tgt!, {
        name: r.name,
        ranged: gap(pc, tgt!) > 1,
        range: [6, 18],
        bonus: md(pc.abil[r.check.abil]) + (pc.prof || 2),
        dice: "0",
        mod: 0,
        type: "bludgeoning",
        extra: [],
        props: []
      });
      if (!s.ok) return { ok: false as const, msg: s.msg };
      return {
        ok: true as const,
        tgt,
        adv: s.adv,
        advWhy: s.advWhy,
        disWhy: s.disWhy,
        bonus: s.bonus,
        vs: s.ac
      };
    }
    const adv: string[] = [];
    const dis: string[] = [];
    if (pc.fx.some(e => e.k === "radv" && !e.target)) adv.push("your last creative move");
    for (const k of pc.cond) if (COND[k]?.checkDis) dis.push(k);
    if (pc.armourDis && (r.check.abil === "str" || r.check.abil === "dex")) dis.push("armour without training");
    const net = adv.length && dis.length ? 0 : adv.length ? 1 : dis.length ? -1 : 0;
    return {
      ok: true as const,
      tgt,
      adv: net,
      advWhy: adv,
      disWhy: dis,
      bonus: lim(Math.round(Number(pageBonus) || 0), -5, 20) - (has(pc, "exhaustion") ? 2 : 0),
      vs: r.check.dc!
    };
  }

  function heroRuling(x: ExecCtx, pc: CombatActor, cmd: CombatCommand): true | string {
    const cs = x.cs;
    const t = cs.turn!;
    const r = cmd.ruling!;
    const k = rulingCheck(cs, r, cmd.bonus);
    if (!k.ok) return k.msg;
    const cheap = ["bonus", "move", "reaction"].includes(r.cost) && !!r.success.effect;
    const dmg =
      r.success.damage && !cheap
        ? (() => {
            const p = parseDice(r.success.damage!);
            const c = parseDice(capDice(pc.level || 1));
            return p.n * p.f + p.k > c.n * c.f || p.k > 0 ? capDice(pc.level || 1) : r.success.damage!;
          })()
        : null;
    ({
      action: () => {
        t.action = 0;
      },
      bonus: () => {
        t.bonus = 0;
      },
      move: () => {
        t.move -= halfMove(pc);
      },
      reaction: () => {
        pc.reaction = false;
      },
      free: () => {
        t.freeRuling = true;
      }
    })[r.cost]();
    const r1 = die(x, 20, "ruling");
    const r2 = k.adv ? die(x, 20, "ruling") : null;
    const kept = r2 == null ? r1 : k.adv > 0 ? Math.max(r1, r2) : Math.min(r1, r2);
    const total = kept + k.bonus;
    const tgt = k.tgt;
    const atk = r.check.kind === "attack";
    pc.fx = pc.fx.filter(e => !(e.k === "radv" && (!e.target || (atk && e.target === tgt?.id))));
    const crit = atk && kept === 20;
    const win = atk ? kept !== 1 && (crit || total >= k.vs) : total >= r.check.dc!;
    const rollSummary = `${r.check.label} ${r2 == null ? kept : `${r1}/${r2}→${kept}`}${sgn(k.bonus)}=${total} vs ${
      atk ? "AC" : "DC"
    } ${k.vs}`;
    const outcomeWord = crit ? "critical success" : win ? "success" : "failure";
    x.lines.push(`${pc.name} tries ${r.name}: ${rollSummary}, ${outcomeWord}`);
    x.events.push({
      kind: "ruling_roll",
      actorName: pc.name,
      rulingName: r.name,
      rollSummary,
      outcome: outcomeWord
    });
    x.res = { win, crit, kept, total, target: tgt?.id || null };
    if (win) {
      if (dmg && tgt) {
        const d = applyDamage(
          x,
          tgt,
          [{ v: rollDice(x, dmg, crit, "ruling damage"), type: r.success.type || "bludgeoning" }],
          crit
        );
        x.lines.push(`${tgt.name} takes ${d.text} (${tgt.name} ${shape(tgt)})`);
        afterHit(x, pc, tgt, { mastery: null, ranged: true }, {}, d, true);
      }
      const e = r.success.effect;
      const live = tgt && tgt.status === "active";
      if (e?.k === "cond" && live && e.cond && RULING.conds.includes(e.cond)) {
        if (addCond(tgt!, e.cond)) {
          if (e.cond !== "prone") tgt!.fx.push({ k: "rcond", cond: e.cond, when: "start", of: pc.id, left: 1 });
          x.lines.push(`${tgt!.name} is ${e.cond}${e.cond === "prone" ? "" : " until your next turn"}`);
        } else x.lines.push(`${tgt!.name} shrugs it off (${e.cond} has no effect)`);
      }
      if (e?.k === "adv") {
        pc.fx.push({ k: "radv", target: tgt?.id || null, when: "end", of: pc.id, left: 2 });
        x.lines.push(`Advantage on your next ${tgt ? "attack against " + tgt.name : "roll"}`);
      }
      if (e?.k === "dis" && live) {
        tgt!.fx.push({ k: "rdis", when: "start", of: pc.id, left: 1 });
        x.lines.push(`${tgt!.name} has Disadvantage on its next attack`);
      }
      if ((e?.k === "push" || e?.k === "pull") && live) {
        x.lines.push(
          shove(cs, tgt!, pc, 2, e.k === "pull")
            ? `${tgt!.name} is ${e.k === "push" ? "driven back" : "drawn in"} to ${tgt!.x},${tgt!.y}`
            : `${tgt!.name} has nowhere to go`
        );
      }
      if (r.success.object) x.lines.push(`Effect: ${String(r.success.object).slice(0, 80)}`);
    } else {
      if (r.failure === "lose") {
        t.action = 0;
        t.attacksLeft = 0;
        x.lines.push(`${pc.name} loses the action`);
      }
      if (r.failure === "prone" && addCond(pc, "prone")) x.lines.push(`${pc.name} falls prone`);
      if (r.failure === "disarmed") {
        const w = (pc.attacks || []).find(
          a => a.item && a.kind === "melee" && a.eq && !pc.fx.some(e => e.k === "disarmed" && e.item === a.item)
        );
        if (w) {
          pc.fx.push({ k: "disarmed", item: w.item!, when: "start", of: pc.id, left: 2 });
          x.lines.push(`${pc.name} drops the ${w.name.toLowerCase()} and can't use it until after the next turn`);
        }
      }
      if (r.failure === "hurt") {
        const d = applyDamage(x, pc, [{ v: rollDice(x, "1d6", false, "setback"), type: "bludgeoning" }], false);
        x.lines.push(`${pc.name} takes ${d.text} (${pc.name} ${shape(pc)})`);
      }
    }
    checkOver(x);
    return true;
  }

  const H: Record<string, (x: ExecCtx, pc: CombatActor, cmd: CombatCommand) => true | string> = {
    attack: (x, pc, cmd) => heroAttack(x, pc, cmd, false),
    offhand: (x, pc, cmd) => heroAttack(x, pc, cmd, true),
    move(x, pc, cmd) {
      const cs = x.cs;
      const t = cs.turn!;
      if (has(pc, "prone")) return "You're prone: stand up first (it costs half your Speed).";
      if (t.move < SQ) {
        return speedOf(pc) === 0
          ? "You can't move right now."
          : `You have ${t.move} m of movement left and a square costs ${SQ} m. Dash doubles your movement.`;
      }
      const from = key(pc.x, pc.y);
      const all = paths(cs, pc);
      const stuck = () =>
        key(pc.x, pc.y) === from &&
        !x.rolls.length &&
        "You don't have the movement left for the next square on that way.";
      if (cmd.dir === "away") {
        const out = wayOut(cs, pc);
        if (!out) return "There's no way out of here.";
        walk(x, pc, route(out));
        if (cs.over || !up(pc)) return true;
        if (pc.x === out.x && pc.y === out.y && t.move >= SQ) {
          t.move -= SQ;
          cs.over = { result: "fled", round: cs.round, edge: edgeOf(cs, pc) };
          x.lines.push(`${pc.name} gets away off the ${cs.over.edge} edge`);
          return true;
        }
        const st = stuck();
        if (st) return st;
        x.lines.push(`${pc.name} runs for the ${edgeOf(cs, out)} edge, now at ${pc.x},${pc.y}`);
        return true;
      }
      let goal: PathNode | null | undefined;
      if (Array.isArray(cmd.to)) {
        const gx = Number(cmd.to[0]);
        const gy = Number(cmd.to[1]);
        const n = all.find(c => c.x === gx && c.y === gy);
        if (!inMap(cs, gx, gy)) {
          return "That square is off the map. /retreat runs for the nearest edge and leaves the fight.";
        }
        if (cellAt(cs, gx, gy) === "wall") return "That square is blocked.";
        if (!n) return free(cs, gx, gy, pc) ? "There's no way through to that square." : "Someone is standing there.";
        if (!n.from) return "You're already there.";
        if (n.c > t.move) return `That square takes ${n.c} m of movement and you have ${t.move} m left.`;
        goal = n;
      } else {
        const tgt = findTarget(cs, cmd.target);
        if (!tgt) return "Move toward whom?";
        if (gap(pc, tgt) <= 1) return `You're already in reach of ${tgt.name}.`;
        goal = pick(all, n => (gap(n, tgt) === 1 ? -n.c : null));
        if (!goal) return `There's no way through to ${tgt.name}.`;
      }
      walk(x, pc, route(goal));
      const st = stuck();
      if (st) return st;
      if (!cs.over && up(pc)) {
        x.lines.push(`${pc.name} moves to ${pc.x},${pc.y}`);
        x.events.push({ kind: "move", actorId: pc.id, actorName: pc.name, to: [pc.x, pc.y] });
      }
      return true;
    },
    dash(x, pc) {
      const t = x.cs.turn!;
      if (!t.action) return "You've used your action this turn.";
      t.action = 0;
      t.move += speedOf(pc);
      x.lines.push(`${pc.name} dashes`);
      return true;
    },
    disengage(x, pc) {
      const t = x.cs.turn!;
      if (!t.action) return "You've used your action this turn.";
      t.action = 0;
      t.disengaged = true;
      x.lines.push(`${pc.name} disengages`);
      return true;
    },
    dodge(x, pc) {
      const t = x.cs.turn!;
      if (!t.action) return "You've used your action this turn.";
      t.action = 0;
      pc.fx.push({ k: "dodge", when: "start", of: pc.id, left: 1 });
      x.lines.push(`${pc.name} takes the Dodge action`);
      return true;
    },
    hide(x, pc) {
      const cs = x.cs;
      const t = cs.turn!;
      if (!t.action) return "You've used your action this turn.";
      if (threats(cs, pc).length) return "You can't hide with an enemy right next to you.";
      if (has(pc, "invisible")) return "You're already hidden.";
      t.action = 0;
      const r1 = die(x, 20, "stealth");
      const r2 = pc.stealthDis ? die(x, 20, "stealth") : null;
      const kept = r2 == null ? r1 : Math.min(r1, r2);
      const tot = kept + (pc.stealth || 0) + (has(pc, "exhaustion") ? -2 : 0);
      const best = Math.max(0, ...active(cs).map(f => f.pp || 10));
      const ok = tot >= 15 && tot >= best;
      if (ok) addCond(pc, "invisible");
      x.lines.push(
        `${pc.name} tries to hide: Stealth ${tot}${pc.stealthDis ? " (armour gives Disadvantage)" : ""} vs DC 15${
          best > 15 ? " and a watchful " + best : ""
        }, ${ok ? "hidden" : "spotted"}`
      );
      if (ok) {
        x.notes.push(
          "Hidden: you count as Invisible, so your next attack has Advantage. Attacking gives your position away."
        );
      }
      return true;
    },
    stand(x, pc) {
      const t = x.cs.turn!;
      const half = Math.ceil(pc.speed / 2);
      if (!has(pc, "prone")) return "You're already on your feet.";
      if (t.move < half) return "Not enough movement left to stand up.";
      t.move -= half;
      pc.cond = pc.cond.filter(k => k !== "prone");
      x.lines.push(`${pc.name} stands up`);
      return true;
    },
    use(x, pc, cmd) {
      const cs = x.cs;
      const t = cs.turn!;
      const q = String(cmd.item || "potion").toLowerCase();
      const it = pc.bag?.find(
        i =>
          (i.id === cmd.item || i.name.toLowerCase().includes(q)) &&
          /potion of healing|healing potion/i.test(i.name) &&
          i.qty - (cs.spent[i.id] || 0) > 0
      );
      if (!it) return "You have no potion of healing to drink.";
      if (!t.bonus) return "Drinking a potion takes your Bonus Action, and you've used it.";
      t.bonus = 0;
      cs.spent[it.id] = (cs.spent[it.id] || 0) + 1;
      const v = rollDice(x, "2d4+2", false, "healing");
      const before = pc.hp;
      pc.hp = Math.min(pc.maxHp, pc.hp + v);
      x.lines.push(`${pc.name} drinks a potion of healing: +${pc.hp - before} HP`);
      return true;
    },
    second_wind(x, pc) {
      const t = x.cs.turn!;
      const sw = pc.res?.second_wind;
      if (!sw) return "Only fighters have Second Wind.";
      if (sw.left < 1) return "No uses of Second Wind left. A short rest restores one.";
      if (!t.bonus) return "Second Wind takes your Bonus Action, and you've used it.";
      t.bonus = 0;
      sw.left--;
      const v = rollDice(x, `1d10+${pc.level || 1}`, false, "second wind");
      const before = pc.hp;
      pc.hp = Math.min(pc.maxHp, pc.hp + v);
      x.lines.push(`${pc.name} uses Second Wind: +${pc.hp - before} HP (${sw.left} left)`);
      return true;
    },
    cast(x, pc, cmd) {
      return CAST ? CAST(x, pc, cmd) : "Spellcasting isn't in the game yet. It arrives with the Spells update.";
    },
    ruling(x, pc, cmd) {
      return heroRuling(x, pc, cmd);
    },
    end(x, pc) {
      x.lines.push(`${pc.name} ends the turn`);
      return true;
    }
  };

  function rulingInfo(cs: CombatState | null, r: RulingProposal, bonus?: number) {
    if (!cs || cs.over || !cs.turn || cs.turn.id !== cs.pc) return { ok: false as const, msg: "It isn't your turn." };
    try {
      const k = rulingCheck(cl(cs), r, bonus);
      return k.ok
        ? {
            ok: true as const,
            adv: k.adv,
            advWhy: k.advWhy,
            disWhy: k.disWhy,
            bonus: k.bonus,
            target: k.tgt?.id || null,
            targetName: k.tgt?.name || null,
            vsAC: r.check.kind === "attack" ? k.vs : null
          }
        : k;
    } catch {
      return { ok: false as const, msg: "That ruling can't be used." };
    }
  }

  function act(cs0: CombatState | null, cmd: CombatCommand, script?: number[]): CombatResult {
    const fail = (msg: string, notes?: string[]): CombatResult => ({
      cs: cs0,
      ok: false,
      msg,
      lines: [],
      events: [],
      rolls: [],
      notes: notes || []
    });
    if (!cs0 || typeof cs0 !== "object") return fail("There is no fight.");
    if (cs0.over) return fail("The fight is over.");
    if (!cs0.turn || cs0.turn.id !== cs0.pc) return fail("It isn't your turn.");
    const h = Object.hasOwn(H, cmd?.type) ? H[cmd.type] : null;
    if (!h) return fail("Unknown command.");
    const cs = cl(cs0);
    const x = ctx(cs, script);
    const pc = pcOf(cs);
    if (incap(pc) && cmd.type !== "end") return fail("You can't act right now.");
    const r = h(x, pc, cmd);
    if (r !== true) return fail(r, x.notes);
    checkOver(x);
    if (!cs.over && cmd.type === "end") {
      endTurn(x);
      settle(x);
    }
    return done(x);
  }

  function preview(cs: CombatState | null, cmd: CombatCommand) {
    if (!cs || cs.over) return null;
    const c = cl(cs);
    const pc = pcOf(c);
    const tgt = findTarget(c, cmd?.target);
    if (!tgt) return null;
    const g = gap(pc, tgt);
    const w = pickWeapon(pc, cmd?.weapon, g, c, !!cmd?.ranged);
    if (!w) return null;
    const p = heroProfile(w, g, cmd?.ranged);
    const s = setup(c, pc, tgt, p);
    if (!s.ok) return { ok: false as const, msg: s.msg };
    const off = cmd?.type === "offhand";
    return {
      ok: true as const,
      target: tgt.id,
      targetName: tgt.name,
      weapon: w.name,
      bonus: s.bonus,
      adv: s.adv,
      advWhy: s.advWhy,
      disWhy: s.disWhy,
      ac: s.ac,
      dmg: off ? `${w.dice}${w.mod < 0 ? " − " + -w.mod : ""}` : w.dmgText,
      type: w.type,
      why: w.why + (off ? " The off-hand attack adds no positive ability modifier to damage." : ""),
      sneak:
        pc.sneak && s.adv > 0 && (p.kind === "ranged" || p.props.includes("finesse")) ? `${pc.sneak}d6` : null
    };
  }

  function available(cs: CombatState | null) {
    if (!cs || cs.over || !cs.turn || cs.turn.id !== cs.pc) return { mine: false as const, commands: [] as string[] };
    const pc = pcOf(cs);
    const t = cs.turn;
    const list: string[] = [];
    const canAttack = Boolean(t.action || t.attacksLeft > 0);
    const engaged = active(cs).some(f => gap(f, pc) <= 1);
    if (canAttack) list.push("attack");
    if (t.light && !t.offhandDone && (t.bonus || (!t.nickUsed && pc.attacks?.some(w => w.mastery === "nick")))) {
      list.push("offhand");
    }
    if (t.move >= SQ && !has(pc, "prone")) list.push("move");
    if (has(pc, "prone")) list.push("stand");
    if (t.action) list.push("dash", "disengage", "dodge");
    if (t.action && !engaged && !has(pc, "invisible")) list.push("hide");
    if (
      t.bonus &&
      pc.bag?.some(i => /potion of healing|healing potion/i.test(i.name) && i.qty - (cs.spent[i.id] || 0) > 0)
    ) {
      list.push("use");
    }
    if (t.bonus && (pc.res?.second_wind?.left || 0) > 0) list.push("second_wind");
    list.push("cast", "end");
    return {
      mine: true as const,
      action: t.action,
      bonus: t.bonus,
      move: t.move,
      attacksLeft: t.attacksLeft,
      reaction: pc.reaction,
      commands: list,
      targets: active(cs).map(f => ({
        id: f.id,
        name: f.name,
        m: SQ * gap(f, pc),
        hurt: f.hp <= f.maxHp / 2 ? "bloodied" : f.hp < f.maxHp ? "hurt" : "unhurt",
        fleeing: !!f.fleeing
      }))
    };
  }

  function reach(cs: CombatState | null): Record<string, number> {
    const out: Record<string, number> = {};
    if (!cs || cs.over || cs.turn?.id !== cs.pc || has(pcOf(cs), "prone")) return out;
    for (const n of paths(cs, pcOf(cs), cs.turn.move)) if (n.from) out[key(n.x, n.y)] = n.c;
    return out;
  }

  function fromZones(cs0: any): CombatState {
    const cs = cl(cs0);
    const pc = pcOf(cs);
    cs.v = 2;
    cs.map = { w: 20, h: 20, cells: {} };
    for (const a of [pc, ...foes(cs)]) {
      const d = [1, 6, 12][(a as any).zone] || 6;
      delete (a as any).zone;
      a.x = a.y = 0;
      place(cs, a, a === pc ? { x: 4, y: 10 } : { x: pc.x + d, y: pc.y }, a === pc ? 0 : d);
    }
    return cs;
  }

  function parse(text: unknown): { cmd?: CombatCommand; flavour?: string; error?: string } | null {
    const raw = String(text || "").trim();
    if (!raw.startsWith("/")) return null;
    const [head, ...rest] = raw
      .slice(1)
      .replace(/^(\w+\s+(?:to\s+)?\d+)\s*,\s*(?=\d)/i, "$1 ")
      .split(",");
    const flavour = rest.join(",").trim().slice(0, 200);
    const words = head.trim().split(/\s+/);
    const verb = (words.shift() || "").toLowerCase();
    const arg = words.join(" ").trim();
    const withSplit = (s: string) => {
      const m = s.match(/^(.*?)\s+with\s+(.+)$/i);
      return m ? { target: m[1].trim() || null, weapon: m[2].trim() } : { target: s || null };
    };
    let cmd: CombatCommand;
    switch (verb) {
      case "attack":
      case "hit":
      case "shoot":
      case "throw": {
        const restArg = arg.replace(/\bnonlethal\b|\bto knock out\b/i, "").trim();
        const at = (verb === "shoot" || verb === "throw") && restArg.match(/^(.+?)\s+at\s+(.+)$/i);
        const a = /\swith\s/i.test(restArg) || !at ? withSplit(restArg) : { target: at[2].trim(), weapon: at[1].trim() };
        cmd = { type: "attack", ...a, nonlethal: /\bnonlethal\b|\bknock out\b/i.test(arg) };
        if (verb === "shoot" || verb === "throw") cmd.ranged = true;
        break;
      }
      case "offhand":
      case "off-hand":
        cmd = { type: "offhand", ...withSplit(arg) };
        break;
      case "move":
      case "approach":
      case "advance":
      case "retreat":
      case "back":
      case "flee": {
        const away =
          (verb !== "move" && verb !== "approach" && verb !== "advance") || /^(away|back)\b/i.test(arg);
        const to = arg.match(/^(?:to\s+)?(\d+)\s*[, ]\s*(\d+)$/i);
        cmd = away
          ? { type: "move", dir: "away" }
          : to
          ? { type: "move", to: [+to[1], +to[2]] }
          : { type: "move", dir: "toward", target: arg.replace(/^(toward|towards|to)\s+/i, "") || null };
        break;
      }
      case "dash":
      case "disengage":
      case "dodge":
      case "hide":
      case "stand":
      case "end":
        cmd = { type: verb };
        break;
      case "use":
      case "drink":
        cmd = { type: "use", item: arg || "potion" };
        break;
      case "second":
      case "secondwind":
      case "second_wind":
        cmd = { type: "second_wind" };
        break;
      case "cast": {
        const m = arg.match(/^(.*?)(?:\s+(?:at|on)\s+(.+))?$/i);
        cmd = { type: "cast", spell: (m?.[1] || "").trim(), target: m?.[2]?.trim() || null };
        break;
      }
      default:
        return { error: `Unknown command /${verb}.` };
    }
    return { cmd, flavour };
  }

  function outcome(cs: CombatState | null): CombatOutcome | null {
    if (!cs) return null;
    const pc = pcOf(cs);
    return {
      result: cs.over?.result || null,
      rounds: cs.round,
      at: [pc.x, pc.y],
      edge: cs.over?.edge || null,
      hp: pc.hp,
      dead: !!pc.dead,
      conditions: pc.cond.filter(k => k !== "invisible" && k !== "prone"),
      res: cl(pc.res || {}),
      spent: { ...cs.spent },
      foes: foes(cs).map(f => ({
        id: f.id,
        ref: f.ref!,
        baseRef: f.baseRef || f.ref!,
        npcId: f.npcId || null,
        name: f.name,
        status: f.status,
        at: [f.x, f.y],
        edge: f.edge || null
      }))
    };
  }

  return deepFreeze({
    start,
    act,
    preview,
    available,
    reach,
    fromZones,
    parse,
    outcome,
    rulingInfo,
    capDice,
    RULING,
    SQ,
    CELLS
  });
})();
