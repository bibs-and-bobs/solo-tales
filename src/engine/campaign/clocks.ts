/* Hidden & Discovered Threat Clocks.
   Clocks tick deterministically as in-game time advances or when narrator events modify them.
   Hidden clocks remain invisible in the UI until knownToPlayer === true,
   and inject a one-time DIRECTOR EVENT when filled === segments. */

import { clamp, isObj, numOr, rid, slug, str } from "../util";

export type ClockSegments = 4 | 6 | 8 | 10;

export interface ThreatClock {
  id: string;
  name: string;
  secretSummary: string;
  segments: ClockSegments;
  filled: number;
  advanceEveryMinutes: number;
  accumulatedMinutes: number;
  knownToPlayer: boolean;
  learnedFrom?: { source: string; turn: number } | null;
  accelerators?: string;
  consequence: string;
  status: "active" | "triggered" | "averted";
  directorDispatched?: boolean;
}

const VALID_SEGMENTS: readonly ClockSegments[] = [4, 6, 8, 10];

export function snapSegments(v: unknown): ClockSegments {
  const n = Number(v);
  if (!Number.isFinite(n)) return 4;
  return VALID_SEGMENTS.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
}

export function cleanThreatClock(raw: unknown): ThreatClock | null {
  if (!isObj(raw)) return null;
  const name = str(raw.name, 70);
  if (!name) return null;
  const segments = snapSegments(raw.segments);
  const filled = numOr(raw.filled, 0, 0, segments);
  const id = str(raw.id, 40) || "clock_" + slug(name).slice(0, 24) + "_" + rid().slice(0, 3);
  const status: ThreatClock["status"] =
    raw.status === "averted"
      ? "averted"
      : raw.status === "triggered" || filled >= segments
      ? "triggered"
      : "active";
  return {
    id,
    name,
    secretSummary: str(raw.secretSummary ?? raw.summary ?? name, 200),
    segments,
    filled: status === "triggered" ? segments : filled,
    advanceEveryMinutes: numOr(raw.advanceEveryMinutes, 1440, 30, 14 * 1440),
    accumulatedMinutes: numOr(raw.accumulatedMinutes, 0, 0, 14 * 1440),
    knownToPlayer: !!raw.knownToPlayer,
    learnedFrom: isObj(raw.learnedFrom)
      ? { source: str(raw.learnedFrom.source, 60) || "Investigation", turn: numOr(raw.learnedFrom.turn, 0, 0) }
      : null,
    accelerators: raw.accelerators ? str(raw.accelerators, 140) : undefined,
    consequence: str(raw.consequence, 220) || `${name} comes to pass.`,
    status,
    directorDispatched: !!raw.directorDispatched
  };
}

export interface ClockAdvanceResult {
  tickedIds: string[];
  triggeredIds: string[];
  chips: Array<[string, string]>;
}

/** Advances all active clocks when in-game minutes pass. */
export function advanceClocksOnTime(
  clocks: Record<string, ThreatClock>,
  elapsedMinutes: number
): ClockAdvanceResult {
  const tickedIds: string[] = [];
  const triggeredIds: string[] = [];
  const chips: Array<[string, string]> = [];
  if (elapsedMinutes <= 0) return { tickedIds, triggeredIds, chips };

  for (const clk of Object.values(clocks)) {
    if (clk.status !== "active" || clk.advanceEveryMinutes <= 0) continue;
    clk.accumulatedMinutes += elapsedMinutes;
    const ticks = Math.floor(clk.accumulatedMinutes / clk.advanceEveryMinutes);
    if (ticks <= 0) continue;
    clk.accumulatedMinutes = clk.accumulatedMinutes % clk.advanceEveryMinutes;
    const before = clk.filled;
    clk.filled = clamp(clk.filled + ticks, 0, clk.segments);
    if (clk.filled !== before) {
      tickedIds.push(clk.id);
      if (clk.knownToPlayer && clk.filled < clk.segments) {
        chips.push([`Threat advances: ${clk.name} (${clk.filled}/${clk.segments})`, "hurt"]);
      }
    }
    if (clk.filled >= clk.segments) {
      clk.status = "triggered";
      clk.knownToPlayer = true;
      triggeredIds.push(clk.id);
      chips.push([`Threat triggered: ${clk.name}`, "hurt"]);
    }
  }
  return { tickedIds, triggeredIds, chips };
}

export function findClock(clocks: Record<string, ThreatClock>, ref: string): ThreatClock | null {
  const q = String(ref || "").trim().toLowerCase();
  if (!q) return null;
  if (clocks[ref]) return clocks[ref];
  return (
    Object.values(clocks).find(c => c.id.toLowerCase() === q || c.name.toLowerCase() === q) ||
    Object.values(clocks).find(c => c.name.toLowerCase().includes(q)) ||
    null
  );
}

export function tickClock(
  clk: ThreatClock,
  delta: number,
  chips: Array<[string, string]>
): void {
  if (clk.status !== "active" || !delta) return;
  const before = clk.filled;
  clk.filled = clamp(clk.filled + delta, 0, clk.segments);
  if (clk.filled === before) return;
  if (clk.filled >= clk.segments) {
    clk.status = "triggered";
    clk.knownToPlayer = true;
    chips.push([`Threat triggered: ${clk.name}`, "hurt"]);
  } else if (clk.knownToPlayer) {
    chips.push([
      `${clk.name}: ${clk.filled}/${clk.segments}`,
      delta > 0 ? "hurt" : "heal"
    ]);
  }
}

export function revealClock(
  clk: ThreatClock,
  turn: number,
  source: string | undefined,
  chips: Array<[string, string]>
): void {
  if (clk.knownToPlayer) return;
  clk.knownToPlayer = true;
  clk.learnedFrom = { source: str(source, 60) || "Clue uncovered", turn };
  chips.push([`Threat uncovered: ${clk.name} (${clk.filled}/${clk.segments})`, "hurt"]);
}

export function avertClock(clk: ThreatClock, chips: Array<[string, string]>): void {
  if (clk.status !== "active") return;
  clk.status = "averted";
  if (clk.knownToPlayer) {
    chips.push([`Threat averted: ${clk.name}`, "loot"]);
  }
}

/** Formats approximate time left for Journal display (e.g., "about 2 days left"). */
export function clockTimeLeftText(clk: ThreatClock): string {
  if (clk.status === "triggered") return "triggered";
  if (clk.status === "averted") return "averted";
  const segsLeft = Math.max(0, clk.segments - clk.filled);
  const minsLeft = Math.max(0, segsLeft * clk.advanceEveryMinutes - clk.accumulatedMinutes);
  if (minsLeft >= 1440) {
    const days = Math.max(1, Math.round(minsLeft / 1440));
    return `about ${days} day${days > 1 ? "s" : ""} left`;
  }
  const hrs = Math.max(1, Math.round(minsLeft / 60));
  return `about ${hrs} hour${hrs > 1 ? "s" : ""} left`;
}
