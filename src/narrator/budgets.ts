/* Dynamic context budget profiles for Free-Tier / Small-Context vs Standard vs Expanded models. */

import { deepFreeze } from "../engine/util";
import type { ModelConnection } from "../adapters/llm/types";

export type BudgetProfileName = "compact" | "standard" | "expanded";

export interface BudgetProfile {
  name: BudgetProfileName;
  useCompactVoice: boolean;
  rulesCap: number;
  dataCap: number;
  maxOutputTokens: number;
  slots: {
    setting: number;
    pc: number;
    scene: number;
    people: number;
    summary: number;
    chapter: number;
    beats: number;
    quests: number;
    clocks: number;
    pool: number;
    checks: number;
    recent: number;
    prefs: number;
    input: number;
  };
}

export const BUDGET_PROFILES: Readonly<Record<BudgetProfileName, BudgetProfile>> = deepFreeze({
  compact: {
    name: "compact",
    useCompactVoice: true,
    rulesCap: 1650,
    dataCap: 1850,
    maxOutputTokens: 750,
    slots: {
      setting: 130,
      pc: 190,
      scene: 170,
      people: 180,
      summary: 240,
      chapter: 130,
      beats: 140,
      quests: 130,
      clocks: 160,
      pool: 360,
      checks: 150,
      recent: 200,
      prefs: 140,
      input: 280
    }
  },
  standard: {
    name: "standard",
    useCompactVoice: false,
    rulesCap: 3500,
    dataCap: 4800,
    maxOutputTokens: 1300,
    slots: {
      setting: 200,
      pc: 260,
      scene: 300,
      people: 360,
      summary: 520,
      chapter: 220,
      beats: 240,
      quests: 200,
      clocks: 300,
      pool: 800,
      checks: 300,
      recent: 480,
      prefs: 300,
      input: 400
    }
  },
  expanded: {
    name: "expanded",
    useCompactVoice: false,
    rulesCap: 3600,
    dataCap: 7600,
    maxOutputTokens: 1600,
    slots: {
      setting: 320,
      pc: 340,
      scene: 380,
      people: 500,
      summary: 900,
      chapter: 380,
      beats: 380,
      quests: 320,
      clocks: 420,
      pool: 1400,
      checks: 380,
      recent: 760,
      prefs: 300,
      input: 450
    }
  }
});

export function selectBudgetProfile(
  conn: ModelConnection | null | undefined,
  economyActive: boolean
): BudgetProfile {
  if (!conn) return BUDGET_PROFILES.standard;
  const ctx = conn.capabilities.contextWindow || 32768;
  const tpm = conn.limits.tpm;

  // Tight TPM (e.g., Groq free tier 12k TPM) or small local 8k-16k context window -> compact (~900 input tokens)
  if (ctx <= 16384 || (tpm != null && tpm > 0 && tpm <= 16000)) {
    return BUDGET_PROFILES.compact;
  }

  // Free-tier or Economy Mode -> standard or compact
  if (economyActive || conn.limits.isFreeTier) {
    if (tpm != null && tpm > 0 && tpm <= 30000) return BUDGET_PROFILES.compact;
    return BUDGET_PROFILES.standard;
  }

  // Large 128k+ paid/high-headroom flagship -> expanded
  if (ctx >= 128000 && (tpm == null || tpm >= 120000)) {
    return BUDGET_PROFILES.expanded;
  }

  return BUDGET_PROFILES.standard;
}

/** Keeps the newest complete lines that fit within `cap` characters, preserving chronological order. */
export function fitLines(lines: string[], cap: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const len = lines[i].length + 1;
    if (used + len > cap) break;
    out.unshift(lines[i]);
    used += len;
  }
  return out;
}

/** Preserves the tail end of a summary so open threads at the end are never truncated. */
export function tail(text: string, cap: number): string {
  if (text.length <= cap) return text;
  return "…" + text.slice(text.length - cap + 1);
}
