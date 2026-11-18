/* Core data contracts for the pure headless CampaignBundle state machine. */

import type { Mood } from "../util";
import type { ConditionKey } from "../rules/srd";
import type { CharacterState, FightReward, NormalizedCheck } from "../rules/character";
import type { FoeTemplate } from "../rules/foe-roster";
import type { CombatCommand, CombatState, RulingProposal } from "../combat/combat";
import type { ThreatClock } from "./clocks";
import type { WorldEntity, WorldFact } from "./knowledge";

export const SCHEMA = 10;
export const DEFAULT_PREFS = "Plain language, no metaphors";

export type SettingArchetype =
  | "frontier_mystery"
  | "gothic_dread"
  | "swashbuckling_coast"
  | "court_intrigue"
  | "ancient_ruins"
  | "custom";

export interface PlaystylePillars {
  combat: 1 | 2 | 3;
  mystery: 1 | 2 | 3;
  social: 1 | 2 | 3;
}

export interface CampaignFlavour {
  archetype: SettingArchetype;
  tone: string;
  pillars: PlaystylePillars;
  magicLevel: "rare" | "uncommon" | "high";
  customPremise?: string;
}

export type PortraitStylePreset = "painterly" | "ink_parchment" | "dark_woodcut" | "custom";

export interface CampaignArtBrief {
  stylePreset: PortraitStylePreset;
  medium: string;
  palette: string;
  lighting: string;
  attireStyle: string;
  moodKeywords: string;
  customStyleNote?: string;
}

export interface StorySegment {
  n?: string;
  say?: string;
  text?: string;
  sfx?: string;
  note?: string;
}

export interface QuestRecord {
  id: string;
  title: string;
  obj: string;
  status: "active" | "done" | "failed";
  turn: number;
}

export interface DeedRecord {
  id: string;
  what: string;
  tags: string[];
  witnesses: string[];
  place: string | null;
  turn: number;
  weight: number;
  fight: string;
  foe: string | null;
}

export interface RoundNarration {
  line: string;
  sfx: string | null;
  say: { who: string; text: string } | null;
}

export interface CombatRoundEntry {
  round: number;
  lines: string[];
  notes: string[];
  flavour: string;
  init: { dice: number[]; total: number } | null;
  narr: RoundNarration | null;
  status: "open" | "narrating" | "done" | "failed";
}

export interface PendingAttackRoll {
  cmd: CombatCommand;
  flavour: string;
  atk: number[];
  dmg: Array<{ d: number; why: "damage" | "sneak attack" }>;
  head: { what: string; roll: string; result: string };
  label: string;
  dmgText: string;
}

export interface ActiveCombat {
  v: number;
  id: string;
  phase: "init" | "fight" | "over";
  spec: {
    foes: Array<{
      ref: string;
      n: number;
      at: Array<[number, number] | null>;
      d?: number;
      name?: string | null;
      npcId?: string | null;
    }>;
    map: {
      w: number;
      h: number;
      wall: Array<[number, number]>;
      rough: Array<[number, number]>;
      cover: Array<[number, number]>;
    };
    hero: [number, number] | null;
    surprise: "pc" | "foes" | null;
  };
  seed: number;
  cs: CombatState | null;
  feed: CombatRoundEntry[];
  roll: PendingAttackRoll | null;
  ruling: {
    text: string;
    line: string;
    ruling: RulingProposal;
    capped: string[];
  } | null;
  result: "victory" | "defeat" | "fled" | null;
  chips: Array<[string, string]>;
  started: number;
  place: string | null;
  dead: boolean;
  reward: FightReward | null;
}

export type NarratorEvent = string | TypedNarratorEvent;

export type TypedNarratorEvent =
  | { type: "hp"; amount: number }
  | { type: "gold"; amount: number }
  | { type: "xp"; amount: number }
  | { type: "item_add"; name: string; qty?: number; note?: string }
  | { type: "item_remove"; name: string; qty?: number }
  | { type: "move"; place: string; desc?: string }
  | { type: "time"; minutes: number }
  | {
      type: "npc";
      name: string;
      role?: string;
      attitude?: "friendly" | "neutral" | "hostile";
      appearance?: string;
    }
  | { type: "attitude"; name: string; delta: number }
  | { type: "leaves"; name: string }
  | { type: "fact"; text: string; truth?: boolean }
  | { type: "secret"; holder: string; text: string; truth?: boolean }
  | { type: "reveal"; factId: string }
  | { type: "entity"; kind: "item" | "faction" | "lore"; name: string; desc?: string }
  | { type: "quest_new"; title: string; obj?: string }
  | { type: "quest_update"; title: string; obj: string }
  | { type: "quest_done"; title: string }
  | { type: "quest_fail"; title: string }
  | { type: "condition"; condition: ConditionKey }
  | { type: "condition_end"; condition: ConditionKey }
  | { type: "clock_reveal"; clockId: string; source?: string }
  | { type: "clock_tick"; clockId: string; delta?: number }
  | { type: "clock_avert"; clockId: string }
  | {
      type: "combat_start";
      spec?: string;
      map?: {
        w?: number;
        h?: number;
        wall?: Array<[number, number]>;
        rough?: Array<[number, number]>;
        cover?: Array<[number, number]>;
      };
      hero?: [number, number];
      surprise?: "pc" | "foes" | null;
      foes?: Array<{
        ref: string;
        count?: number;
        at?: Array<[number, number]>;
        name?: string;
        npcId?: string;
      }>;
    };

export interface PendingCheckBranch {
  story: StorySegment[];
  events: NarratorEvent[];
}

export interface PendingCheck {
  t: number;
  check: NormalizedCheck & { dc: number; adv: number };
  success: PendingCheckBranch;
  failure: PendingCheckBranch;
  beat: string;
  options: string[];
  mood: Mood;
  scene_end: boolean;
  input: string;
  opening: boolean;
  timeSet: boolean;
  dmg: number;
  ruling?: RulingProposal;
  setup?: PendingCheckBranch;
  line?: string;
}

export interface RollDisplayRecord {
  label: string;
  dice: number[];
  kept: number;
  bonus: number;
  total: number;
  dc: number | null;
  ok: boolean;
  why: string;
  adv?: number;
}

export interface FightLogSummary {
  id: string;
  result: "victory" | "defeat" | "fled";
  dead: boolean;
  foes: string;
  rounds: Array<{
    round: number;
    lines: string[];
    narr: RoundNarration | null;
    status: "done" | "failed";
  }>;
  reward: FightReward | null;
}

export interface LogEntry {
  t: number;
  you: string;
  segs: StorySegment[];
  chips: Array<[string, string]>;
  roll: RollDisplayRecord | null;
  fight?: FightLogSummary | null;
  setupLen?: number;
  chunk?: number;
  thinking?: boolean;
  skipped?: string[];
  failed?: Array<{ ev: string; why: string }>;
  leak?: string[];
}

export interface CampaignState {
  v: number;
  id: string;
  writer: string;
  name: string;
  created: number;
  updated: number;
  turn: number;
  status: "active" | "dead";
  epitaph?: string;
  setting: {
    premise: string;
    tone: string;
  };
  flavour?: CampaignFlavour | null;
  artBrief?: CampaignArtBrief | null;
  char: CharacterState;
  time: number;
  place: string | null;
  mood: Mood;
  summary: string;
  chapter: string;
  beats: string[];
  recent: Array<{ you: string; out: string }>;
  quests: QuestRecord[];
  options: string[];
  pending: PendingCheck | null;
  combat: ActiveCombat | null;
  nextAdv: number;
  prefs: string;
  logChunk: number;
  learn: boolean;
}

export interface DirtyTracker {
  e: Set<string>;
  f: Set<string>;
  d: Set<string>;
  k: Set<string>;
  r: Set<string>;
  c: Set<number>;
}

export interface CampaignBundle {
  campaign: CampaignState;
  entities: Record<string, WorldEntity>;
  facts: Record<string, WorldFact>;
  deeds: Record<string, DeedRecord>;
  clocks: Record<string, ThreatClock>;
  foeRoster: Record<string, FoeTemplate>;
  log: LogEntry[];
  dirty: DirtyTracker;
  unread: { quests: boolean; journal: boolean };
}
