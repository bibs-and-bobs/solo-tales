/* Pure utility helpers shared across the headless engine, narrator, and adapters. */

export const clamp = (n: number, a: number, b: number): number => Math.max(a, Math.min(b, n));

export const d = (n: number): number => 1 + Math.floor(Math.random() * n);

export const rid = (): string => Math.random().toString(36).slice(2, 10);

export const slug = (s: unknown): string =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || rid();

export const sign = (n: number): string => (n >= 0 ? "+" : "") + n;

export function clone<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

export const str = (v: unknown, max = 200): string =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export const isObj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function arr<T = any>(v: unknown, filterFn?: (item: any) => boolean): T[] {
  if (!Array.isArray(v)) return [];
  return (filterFn ? v.filter(filterFn) : v) as T[];
}

export const numOr = (v: unknown, dflt: number, lo?: number, hi?: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(Math.round(n), lo ?? -1e9, hi ?? 1e9) : dflt;
};

export const strs = (v: unknown, n: number, max: number): string[] =>
  arr<string>(v, x => typeof x === "string")
    .slice(-n)
    .map(x => str(x, max));

export function deepFreeze<T>(o: T): Readonly<T> {
  if (o && typeof o === "object" && !(o instanceof RegExp) && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

/** Deterministic Mulberry32 generator used for combat dice and seeded loot. */
export function seededRng(seed: number): () => number {
  let s = (Number(seed) >>> 0) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const nice = (k: string): string =>
  k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

export type Mood = "calm" | "tense" | "danger" | "wonder" | "grim";
export const MOODS: readonly Mood[] = deepFreeze(["calm", "tense", "danger", "wonder", "grim"]);

export function phaseOf(timeMinutes: number): "dawn" | "day" | "dusk" | "night" {
  const h = Math.floor(((timeMinutes % 1440) + 1440) % 1440 / 60);
  return h >= 5 && h < 8 ? "dawn" : h >= 8 && h < 17 ? "day" : h >= 17 && h < 20 ? "dusk" : "night";
}

export function clockText(timeMinutes: number): string {
  const safe = Math.max(0, Math.round(timeMinutes));
  const day = Math.floor(safe / 1440) + 1;
  const m = safe % 1440;
  return `Day ${day} · ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export const attWord = (a: number): "friendly" | "neutral" | "hostile" =>
  a >= 1 ? "friendly" : a <= -1 ? "hostile" : "neutral";

export const hurtWord = (hp: number, max: number): "down" | "near death" | "bloodied" | "hurt" | "unhurt" =>
  hp <= 0 ? "down" : hp <= max / 4 ? "near death" : hp <= max / 2 ? "bloodied" : hp < max ? "hurt" : "unhurt";
