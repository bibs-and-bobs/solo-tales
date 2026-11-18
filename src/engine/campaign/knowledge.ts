/* Epistemic Knowledge Graph, Scored Context Pool & Secret Leak Detection. */

import { attWord, clamp } from "../util";

export type EntityKind = "npc" | "place" | "item" | "faction" | "lore";

export interface WorldEntity {
  id: string;
  kind: EntityKind;
  name: string;
  role?: string;
  desc?: string;
  appearance?: string;
  agenda?: string;
  portraitId?: string | null;
  att?: number;
  loc?: string | null;
  seen?: number;
  met?: number;
  first?: number;
  visited?: number;
  combatStatus?: "dead" | "captured" | "fled" | null;
  playerNote?: string;
}

export interface WorldFact {
  id: string;
  text: string;
  turn: number;
  place: string | null;
  pinned: boolean;
  about: string[];
  known: string[];
  truth: boolean;
}

export const knows = (f: Pick<WorldFact, "known">): boolean => f.known.includes("player");

const SKIP_WORDS = new Set(
  "about after again their there these those which where while would could should other being under above every from into onto with that this have what when your yours them they then than were will just look around".split(
    " "
  )
);

export const words5 = (t: unknown): Set<string> =>
  new Set((String(t).toLowerCase().match(/[a-z']{5,}/g) || []).filter(w => !SKIP_WORDS.has(w)));

export function aboutOf(text: unknown, entities: Record<string, WorldEntity>): string[] {
  const t = String(text).toLowerCase();
  return Object.values(entities)
    .filter(e => {
      const n = e.name.toLowerCase();
      const first = n.split(" ")[0];
      return (
        t.includes(n) ||
        (e.kind === "npc" &&
          first.length >= 3 &&
          new RegExp("\\b" + first.replace(/[^a-z]/g, "") + "\\b").test(t))
      );
    })
    .map(e => e.id)
    .slice(0, 6);
}

export function presentNpcsIn(
  placeId: string | null,
  entities: Record<string, WorldEntity>
): WorldEntity[] {
  if (!placeId) return [];
  return Object.values(entities).filter(
    e => e.kind === "npc" && e.loc === placeId && e.combatStatus !== "dead"
  );
}

export interface ScoredPoolItem {
  s: number;
  line: string;
  secret?: string;
}

export function scoredPool(
  params: {
    place: string | null;
    turn: number;
    entities: Record<string, WorldEntity>;
    facts: Record<string, WorldFact>;
    sanitize: (v: unknown, max?: number) => string;
    budget?: number;
  },
  input: string
): ScoredPoolItem[] {
  const { place: here, turn, entities, facts, sanitize, budget = 800 } = params;
  const present = new Set(presentNpcsIn(here, entities).map(n => n.id));
  const named = new Set(aboutOf(input, entities));
  const iw = words5(input);
  const near = (ids: string[]) => ids.some(id => id === here || present.has(id));
  const recency = (t?: number) => clamp(20 - (turn - (t || 0)), 0, 20);
  const factScore = (f: WorldFact) => {
    let s = recency(f.turn);
    if (f.about.some(id => named.has(id))) s += 50;
    else {
      let m = 0;
      for (const w of words5(f.text)) if (iw.has(w)) m++;
      s += Math.min(50, 25 * m);
    }
    if (f.place === here || near(f.about)) s += 40;
    if (f.pinned) s += 40;
    return s;
  };

  const cand: ScoredPoolItem[] = [];
  for (const f of Object.values(facts)) {
    if (knows(f)) {
      cand.push({
        s: factScore(f) + (f.pinned ? 1000 : 0),
        line: (f.truth ? "" : "[untrue, the player believes it] ") + sanitize(f.text, 200)
      });
      continue;
    }
    const holders = f.known.filter(id => present.has(id) && entities[id]);
    if (holders.length) {
      cand.push({
        s: factScore(f) + 30,
        secret: f.id,
        line: `[secret ${f.id}, known to ${holders
          .map(id => sanitize(entities[id].name, 40))
          .join(", ")}: reveal only if earned]${f.truth ? "" : " [untrue]"} ${sanitize(f.text, 200)}`
      });
    }
  }

  for (const e of Object.values(entities)) {
    if (e.id === here || present.has(e.id)) continue;
    let s = recency(e.seen ?? e.visited ?? e.first);
    if (named.has(e.id)) s += 50;
    if (e.loc && e.loc === here) s += 40;
    if (s < 15) continue;
    cand.push({
      s,
      line:
        e.kind === "npc"
          ? `${sanitize(e.name, 40)} | ${sanitize(e.role, 60)} | ${attWord(e.att ?? 0)} | ${
              e.combatStatus === "dead" ? "dead" : "not here"
            }`
          : `${e.kind} ${sanitize(e.name, 50)} | ${sanitize(e.desc, 120)}`
    });
  }

  cand.sort((a, b) => b.s - a.s);
  const out: ScoredPoolItem[] = [];
  let used = 0;
  for (const c of cand) {
    const n = c.line.length + 3;
    if (used + n > budget) continue;
    out.push(c);
    used += n;
  }
  return out;
}

/** Detects if narration states >=70% of the significant words of an unrevealed secret. */
export function flagLeaks(
  entry: { segs: Array<{ n?: string; text?: string }>; leak?: string[] },
  facts: Record<string, WorldFact>
): string[] {
  const told = words5(entry.segs.map(s => s.n || s.text || "").join(" "));
  const leak: string[] = [];
  for (const f of Object.values(facts)) {
    if (knows(f)) continue;
    const w = [...words5(f.text)];
    if (w.length < 3) continue;
    if (w.filter(x => told.has(x)).length / w.length >= 0.7) leak.push(f.id);
  }
  if (leak.length) {
    entry.leak = leak;
  }
  return leak;
}
