/* Character Creation Rules: Races, Classes, Perks, Backgrounds, Balanced Stat Rolling & Builder. */

import { deepFreeze, rid, str } from "../util";
import { ABIL, mod, type AbilityKey, type SizeCode } from "./srd";
import {
  refFromName,
  resFor,
  syncChar,
  type CharacterState,
  type InventoryItem
} from "./character";

export interface PerkEffects {
  abil?: Partial<Record<AbilityKey, number>>;
  hpBonus?: number;
  acBonus?: number;
  speedBonus?: number;
  skills?: string[];
  expertise?: string[];
  goldBonus?: number;
}

export interface CreationPerk {
  id: string;
  name: string;
  summary: string;
  effects: PerkEffects;
}

export interface RaceOption {
  id: string;
  name: string;
  tagline: string;
  size: SizeCode;
  speed: number;
  abilityBonuses: Partial<Record<AbilityKey, number>>;
  bonusSkills: string[];
  perks: readonly CreationPerk[];
}

export interface ClassOption {
  id: string;
  name: string;
  tagline: string;
  hitDie: 6 | 8 | 10 | 12;
  primaryAbil: AbilityKey;
  recommendedOrder: readonly AbilityKey[];
  saves: readonly AbilityKey[];
  armourNote: string;
  weaponNote: string;
  skillCount: number;
  expertiseCount: number;
  skillChoices: readonly string[];
  startingGold: number;
  mastery: readonly string[];
  startingInv: ReadonlyArray<Omit<InventoryItem, "id">>;
  perks: readonly CreationPerk[];
}

export interface BackgroundOption {
  id: string;
  name: string;
  summary: string;
  skills: readonly string[];
  bonusGold: number;
}

export const RACES: readonly RaceOption[] = deepFreeze([
  {
    id: "human",
    name: "Human",
    tagline: "Adaptable, ambitious, and quick to learn any trade.",
    size: "M",
    speed: 9,
    abilityBonuses: { str: 1, dex: 1, con: 1 },
    bonusSkills: [],
    perks: [
      {
        id: "human_scholar",
        name: "Versatile Scholar",
        summary: "+1 Intelligence and Persuasion proficiency.",
        effects: { abil: { int: 1 }, skills: ["persuasion"] }
      },
      {
        id: "human_resolve",
        name: "Tough Resolve",
        summary: "+2 Max HP and Athletics proficiency.",
        effects: { hpBonus: 2, skills: ["athletics"] }
      },
      {
        id: "human_lucky",
        name: "Merchant's Luck",
        summary: "+1 Charisma and +15 starting gold.",
        effects: { abil: { cha: 1 }, goldBonus: 15 }
      }
    ]
  },
  {
    id: "elf",
    name: "Elf",
    tagline: "Graceful, long-lived, and sharp of eye and ear.",
    size: "M",
    speed: 9,
    abilityBonuses: { dex: 2, wis: 1 },
    bonusSkills: ["perception"],
    perks: [
      {
        id: "elf_keen",
        name: "Keen Senses",
        summary: "Insight & Nature proficiency.",
        effects: { skills: ["insight", "nature"] }
      },
      {
        id: "elf_fleet",
        name: "Fleet of Foot",
        summary: "+1.5 m movement speed (10.5 m total).",
        effects: { speedBonus: 1.5 }
      },
      {
        id: "elf_fey",
        name: "Fey Ancestry",
        summary: "+1 Intelligence and Arcana proficiency.",
        effects: { abil: { int: 1 }, skills: ["arcana"] }
      }
    ]
  },
  {
    id: "dwarf",
    name: "Dwarf",
    tagline: "Stout as bedrock, unyielding in battle and craft.",
    size: "M",
    speed: 7.5,
    abilityBonuses: { con: 2, str: 1 },
    bonusSkills: [],
    perks: [
      {
        id: "dwarf_tough",
        name: "Dwarven Toughness",
        summary: "+3 Max HP.",
        effects: { hpBonus: 3 }
      },
      {
        id: "dwarf_stone",
        name: "Stonecunning",
        summary: "History & Investigation proficiency.",
        effects: { skills: ["history", "investigation"] }
      },
      {
        id: "dwarf_iron",
        name: "Ironclad",
        summary: "+1 Armour Class.",
        effects: { acBonus: 1 }
      }
    ]
  },
  {
    id: "halfling",
    name: "Halfling",
    tagline: "Nimble, quiet, and blessed with uncanny good fortune.",
    size: "S",
    speed: 7.5,
    abilityBonuses: { dex: 2, cha: 1 },
    bonusSkills: ["stealth"],
    perks: [
      {
        id: "halfling_luck",
        name: "Halfling Luck",
        summary: "Acrobatics & Sleight of Hand proficiency.",
        effects: { skills: ["acrobatics", "sleight_of_hand"] }
      },
      {
        id: "halfling_brave",
        name: "Brave Heart",
        summary: "+1 Constitution and Persuasion proficiency.",
        effects: { abil: { con: 1 }, skills: ["persuasion"] }
      },
      {
        id: "halfling_nimble",
        name: "Nimble Step",
        summary: "+1.5 m speed and +1 Armour Class.",
        effects: { speedBonus: 1.5, acBonus: 1 }
      }
    ]
  },
  {
    id: "tiefling",
    name: "Tiefling",
    tagline: "Infernal-blooded, sharp-witted, and fiercely independent.",
    size: "M",
    speed: 9,
    abilityBonuses: { cha: 2, int: 1 },
    bonusSkills: [],
    perks: [
      {
        id: "tiefling_rebuke",
        name: "Hellish Presence",
        summary: "Intimidation & Deception proficiency.",
        effects: { skills: ["intimidation", "deception"] }
      },
      {
        id: "tiefling_silver",
        name: "Silver Tongue",
        summary: "+1 Charisma and Persuasion proficiency.",
        effects: { abil: { cha: 1 }, skills: ["persuasion"] }
      },
      {
        id: "tiefling_flame",
        name: "Flame-Touched",
        summary: "+2 Max HP and Arcana proficiency.",
        effects: { hpBonus: 2, skills: ["arcana"] }
      }
    ]
  },
  {
    id: "dragonborn",
    name: "Dragonborn",
    tagline: "Proud, towering, and carrying ancient draconic might.",
    size: "M",
    speed: 9,
    abilityBonuses: { str: 2, cha: 1 },
    bonusSkills: [],
    perks: [
      {
        id: "dragon_scales",
        name: "Draconic Scales",
        summary: "+1 Armour Class.",
        effects: { acBonus: 1 }
      },
      {
        id: "dragon_ember",
        name: "Ember Breath",
        summary: "+1 Strength and Intimidation proficiency.",
        effects: { abil: { str: 1 }, skills: ["intimidation"] }
      },
      {
        id: "dragon_noble",
        name: "Clan Heritage",
        summary: "History & Persuasion proficiency.",
        effects: { skills: ["history", "persuasion"] }
      }
    ]
  }
]);

export const CLASSES: readonly ClassOption[] = deepFreeze([
  {
    id: "fighter",
    name: "Fighter",
    tagline: "Trained warrior who wins through steel, armour, and grit.",
    hitDie: 10,
    primaryAbil: "str",
    recommendedOrder: ["str", "con", "dex", "wis", "cha", "int"],
    saves: ["str", "con"],
    armourNote: "All armour & shields",
    weaponNote: "Simple & martial weapons",
    skillCount: 2,
    expertiseCount: 0,
    skillChoices: ["athletics", "perception", "intimidation", "survival", "acrobatics", "insight", "history"],
    startingGold: 15,
    mastery: ["longsword", "javelin", "battleaxe"],
    startingInv: [
      { name: "Longsword", note: "1d8 + STR slashing", qty: 1, eq: true, ref: "w:longsword" },
      { name: "Shield", note: "+2 AC", qty: 1, eq: true, ref: "a:shield" },
      { name: "Chain mail", note: "AC 16", qty: 1, eq: true, ref: "a:chain_mail" },
      { name: "Javelin", note: "1d6 + STR, thrown 9 m", qty: 4, ref: "w:javelin" },
      { name: "Potion of healing", note: "Heals 2d4 + 2", qty: 1 },
      { name: "Rope, hempen", note: "15 m", qty: 1 },
      { name: "Rations", note: "1 day each", qty: 5 }
    ],
    perks: [
      { id: "fighter_defence", name: "Defence Style", summary: "+1 AC in armour.", effects: { acBonus: 1 } },
      { id: "fighter_duel", name: "Duelling Mastery", summary: "+1 Strength and Athletics proficiency.", effects: { abil: { str: 1 }, skills: ["athletics"] } },
      { id: "fighter_tough", name: "Battle Hardened", summary: "+3 Max HP.", effects: { hpBonus: 3 } }
    ]
  },
  {
    id: "rogue",
    name: "Rogue",
    tagline: "Quick, quiet, and sharp-eyed. Strikes from shadow.",
    hitDie: 8,
    primaryAbil: "dex",
    recommendedOrder: ["dex", "con", "wis", "int", "cha", "str"],
    saves: ["dex", "int"],
    armourNote: "Light armour",
    weaponNote: "Simple & finesse/light martial",
    skillCount: 4,
    expertiseCount: 2,
    skillChoices: ["stealth", "sleight_of_hand", "acrobatics", "perception", "deception", "investigation", "persuasion", "insight"],
    startingGold: 16,
    mastery: ["shortsword", "shortbow"],
    startingInv: [
      { name: "Shortsword", note: "1d6 + DEX piercing", qty: 1, eq: true, ref: "w:shortsword" },
      { name: "Shortbow", note: "1d6 + DEX, range 24 m", qty: 1, ref: "w:shortbow" },
      { name: "Arrows", note: "", qty: 20, ref: "ammo:arrows" },
      { name: "Dagger", note: "1d4 + DEX, thrown 6 m", qty: 2, ref: "w:dagger" },
      { name: "Leather armour", note: "AC 11 + DEX", qty: 1, eq: true, ref: "a:leather" },
      { name: "Thieves' tools", note: "Pick locks, disarm traps", qty: 1 },
      { name: "Potion of healing", note: "Heals 2d4 + 2", qty: 1 }
    ],
    perks: [
      { id: "rogue_shadow", name: "Shadowstep", summary: "+1 Dexterity and Stealth expertise.", effects: { abil: { dex: 1 }, expertise: ["stealth"] } },
      { id: "rogue_street", name: "Streetwise", summary: "Investigation & Persuasion proficiency.", effects: { skills: ["investigation", "persuasion"] } },
      { id: "rogue_reflex", name: "Quick Reflexes", summary: "+1 AC and +1.5 m speed.", effects: { acBonus: 1, speedBonus: 1.5 } }
    ]
  },
  {
    id: "barbarian",
    name: "Barbarian",
    tagline: "Fierce frontier warrior fuelled by primal fury.",
    hitDie: 12,
    primaryAbil: "str",
    recommendedOrder: ["str", "con", "dex", "wis", "cha", "int"],
    saves: ["str", "con"],
    armourNote: "Light, medium & shields",
    weaponNote: "Simple & martial weapons",
    skillCount: 2,
    expertiseCount: 0,
    skillChoices: ["athletics", "intimidation", "nature", "perception", "survival", "animal_handling"],
    startingGold: 10,
    mastery: ["greataxe", "handaxe"],
    startingInv: [
      { name: "Greataxe", note: "1d12 + STR slashing", qty: 1, eq: true, ref: "w:greataxe" },
      { name: "Handaxe", note: "1d6 + STR, thrown 6 m", qty: 2, ref: "w:handaxe" },
      { name: "Hide armour", note: "AC 12 + DEX (max 2)", qty: 1, eq: true, ref: "a:hide" },
      { name: "Potion of healing", note: "Heals 2d4 + 2", qty: 1 },
      { name: "Rations", note: "1 day each", qty: 5 }
    ],
    perks: [
      { id: "barb_grit", name: "Unarmoured Grit", summary: "+3 Max HP and +1 Constitution.", effects: { hpBonus: 3, abil: { con: 1 } } },
      { id: "barb_might", name: "Berserker's Might", summary: "+1 Strength and Intimidation proficiency.", effects: { abil: { str: 1 }, skills: ["intimidation"] } },
      { id: "barb_instinct", name: "Wild Instinct", summary: "Perception & Survival proficiency.", effects: { skills: ["perception", "survival"] } }
    ]
  },
  {
    id: "ranger",
    name: "Ranger",
    tagline: "Sharp-eyed tracker who stalks the wild borderlands.",
    hitDie: 10,
    primaryAbil: "dex",
    recommendedOrder: ["dex", "wis", "con", "str", "int", "cha"],
    saves: ["str", "dex"],
    armourNote: "Light, medium & shields",
    weaponNote: "Simple & martial weapons",
    skillCount: 3,
    expertiseCount: 0,
    skillChoices: ["survival", "perception", "stealth", "nature", "athletics", "insight", "investigation", "animal_handling"],
    startingGold: 15,
    mastery: ["longbow", "shortsword"],
    startingInv: [
      { name: "Longbow", note: "1d8 + DEX, range 45 m", qty: 1, eq: true, ref: "w:longbow" },
      { name: "Arrows", note: "", qty: 20, ref: "ammo:arrows" },
      { name: "Shortsword", note: "1d6 + DEX piercing", qty: 1, eq: true, ref: "w:shortsword" },
      { name: "Studded leather", note: "AC 12 + DEX", qty: 1, eq: true, ref: "a:studded_leather" },
      { name: "Potion of healing", note: "Heals 2d4 + 2", qty: 1 },
      { name: "Rations", note: "1 day each", qty: 5 }
    ],
    perks: [
      { id: "ranger_sharp", name: "Sharpshooter", summary: "+1 Dexterity and Stealth proficiency.", effects: { abil: { dex: 1 }, skills: ["stealth"] } },
      { id: "ranger_tracker", name: "Beast Tracker", summary: "Survival & Nature proficiency.", effects: { skills: ["survival", "nature"] } },
      { id: "ranger_stride", name: "Warden's Stride", summary: "+1.5 m speed and +2 Max HP.", effects: { speedBonus: 1.5, hpBonus: 2 } }
    ]
  },
  {
    id: "cleric",
    name: "Cleric",
    tagline: "Devotedwarden of sacred oaths, healing, and steel.",
    hitDie: 8,
    primaryAbil: "wis",
    recommendedOrder: ["wis", "con", "str", "cha", "dex", "int"],
    saves: ["wis", "cha"],
    armourNote: "Light, medium & shields",
    weaponNote: "Simple weapons",
    skillCount: 2,
    expertiseCount: 0,
    skillChoices: ["insight", "medicine", "religion", "persuasion", "history"],
    startingGold: 15,
    mastery: [],
    startingInv: [
      { name: "Mace", note: "1d6 + STR bludgeoning", qty: 1, eq: true, ref: "w:mace" },
      { name: "Shield", note: "+2 AC", qty: 1, eq: true, ref: "a:shield" },
      { name: "Scale mail", note: "AC 14 + DEX (max 2)", qty: 1, eq: true, ref: "a:scale_mail" },
      { name: "Holy symbol", note: "Sacred focus", qty: 1 },
      { name: "Potion of healing", note: "Heals 2d4 + 2", qty: 2 },
      { name: "Rations", note: "1 day each", qty: 5 }
    ],
    perks: [
      { id: "cleric_life", name: "Life Blessing", summary: "+3 Max HP and Medicine proficiency.", effects: { hpBonus: 3, skills: ["medicine"] } },
      { id: "cleric_war", name: "War Priest", summary: "+1 Strength and +1 AC.", effects: { abil: { str: 1 }, acBonus: 1 } },
      { id: "cleric_lore", name: "Lorekeeper", summary: "Religion & Arcana proficiency.", effects: { skills: ["religion", "arcana"] } }
    ]
  },
  {
    id: "wizard",
    name: "Wizard",
    tagline: "Scholar of arcane sigils, sharp wits, and ancient lore.",
    hitDie: 6,
    primaryAbil: "int",
    recommendedOrder: ["int", "con", "dex", "wis", "cha", "str"],
    saves: ["int", "wis"],
    armourNote: "Unarmoured",
    weaponNote: "Simple weapons",
    skillCount: 2,
    expertiseCount: 0,
    skillChoices: ["arcana", "history", "investigation", "insight", "religion", "medicine"],
    startingGold: 20,
    mastery: [],
    startingInv: [
      { name: "Quarterstaff", note: "1d6 + STR bludgeoning", qty: 1, eq: true, ref: "w:quarterstaff" },
      { name: "Dagger", note: "1d4 + DEX piercing", qty: 1, ref: "w:dagger" },
      { name: "Spellbook", note: "Bound arcane notes", qty: 1 },
      { name: "Potion of healing", note: "Heals 2d4 + 2", qty: 1 },
      { name: "Torch", note: "1 hour of light", qty: 3 }
    ],
    perks: [
      { id: "wizard_evoker", name: "Evoker's Spark", summary: "+1 Intelligence and Arcana proficiency.", effects: { abil: { int: 1 }, skills: ["arcana"] } },
      { id: "wizard_abjurer", name: "Abjurer's Ward", summary: "+2 Max HP and +1 AC.", effects: { hpBonus: 2, acBonus: 1 } },
      { id: "wizard_sage", name: "Sage's Memory", summary: "History & Investigation proficiency.", effects: { skills: ["history", "investigation"] } }
    ]
  }
]);

export const BACKGROUNDS: readonly BackgroundOption[] = deepFreeze([
  { id: "soldier", name: "Soldier", summary: "Drilled in watchtowers and border marches.", skills: ["athletics", "intimidation"], bonusGold: 10 },
  { id: "criminal", name: "Criminal", summary: "Knows locked doors, alleyways, and quiet fences.", skills: ["deception", "stealth"], bonusGold: 15 },
  { id: "sage", name: "Sage", summary: "Spent years among dusty archives and strange maps.", skills: ["arcana", "history"], bonusGold: 10 },
  { id: "acolyte", name: "Acolyte", summary: "Served a shrine, parish, or wandering order.", skills: ["insight", "religion"], bonusGold: 15 },
  { id: "folk_hero", name: "Folk Hero", summary: "Stood up for a village when no lord came.", skills: ["animal_handling", "survival"], bonusGold: 10 },
  { id: "outlander", name: "Outlander", summary: "Raised on game trails, ridges, and open sky.", skills: ["athletics", "survival"], bonusGold: 10 },
  { id: "noble", name: "Noble", summary: "Born to a crest, etiquette, and old debts.", skills: ["history", "persuasion"], bonusGold: 25 },
  { id: "artisan", name: "Artisan", summary: "Hands calloused by forge, loom, or chisel.", skills: ["investigation", "persuasion"], bonusGold: 15 }
]);

export const STANDARD_ARRAY: readonly number[] = deepFreeze([15, 14, 13, 12, 10, 8]);

export interface RolledStatSlot {
  dice: [number, number, number, number];
  droppedIndex: number;
  total: number;
}

export interface BalancedRollResult {
  slots: RolledStatSlot[];
  scores: number[];
  sum: number;
  modSum: number;
}

function roll4d6DropLowest(rng: () => number): RolledStatSlot {
  const dice: [number, number, number, number] = [
    1 + Math.floor(rng() * 6),
    1 + Math.floor(rng() * 6),
    1 + Math.floor(rng() * 6),
    1 + Math.floor(rng() * 6)
  ];
  let droppedIndex = 0;
  for (let i = 1; i < 4; i++) {
    if (dice[i] < dice[droppedIndex]) droppedIndex = i;
  }
  const total = dice.reduce((a, b, idx) => (idx === droppedIndex ? a : a + b), 0);
  return { dice, droppedIndex, total };
}

/**
 * Rolls 6 ability scores using 4d6-drop-lowest with automatic balance guardrails:
 * - Total sum stays between 72 and 78
 * - Modifier sum stays between +4 and +8
 * - At least one score >= 15 and no score < 8
 */
export function rollBalancedStats(rng: () => number = Math.random): BalancedRollResult {
  for (let attempt = 0; attempt < 40; attempt++) {
    const slots = Array.from({ length: 6 }, () => roll4d6DropLowest(rng));
    const scores = slots.map(s => s.total);
    const sum = scores.reduce((a, b) => a + b, 0);
    const modSum = scores.reduce((a, b) => a + mod(b), 0);
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    if (sum >= 72 && sum <= 78 && modSum >= 4 && modSum <= 8 && maxScore >= 15 && minScore >= 8) {
      return { slots, scores, sum, modSum };
    }
  }

  // Deterministic fallback if 40 random attempts didn't hit the window: gently balance a fresh roll
  const slots = Array.from({ length: 6 }, () => roll4d6DropLowest(rng));
  for (const s of slots) {
    if (s.total < 8) s.total = 8;
  }
  slots.sort((a, b) => b.total - a.total);
  if (slots[0].total < 15) slots[0].total = 15;
  let sum = slots.reduce((a, s) => a + s.total, 0);
  let guard = 0;
  while (sum < 72 && guard++ < 30) {
    const idx = guard % 6;
    if (slots[idx].total < 17) {
      slots[idx].total += 1;
      sum += 1;
    }
  }
  while (sum > 78 && guard++ < 60) {
    const idx = 5 - (guard % 6);
    if (slots[idx].total > 8) {
      slots[idx].total -= 1;
      sum -= 1;
    }
  }
  const scores = slots.map(s => s.total);
  const modSum = scores.reduce((a, b) => a + mod(b), 0);
  return { slots, scores, sum, modSum };
}

export interface CharacterCreationInput {
  name: string;
  raceId: string;
  racePerkId: string;
  classId: string;
  classPerkId: string;
  backgroundId: string;
  baseAbil: Record<AbilityKey, number>;
  chosenSkills: string[];
  chosenExpertise?: string[];
  appearance?: string;
  backstory?: string;
  portraitId?: string | null;
}

export function buildCreatedCharacter(input: CharacterCreationInput): CharacterState {
  const race = RACES.find(r => r.id === input.raceId) || RACES[0];
  const racePerk = race.perks.find(p => p.id === input.racePerkId) || race.perks[0];
  const cls = CLASSES.find(c => c.id === input.classId) || CLASSES[0];
  const clsPerk = cls.perks.find(p => p.id === input.classPerkId) || cls.perks[0];
  const bg = BACKGROUNDS.find(b => b.id === input.backgroundId) || BACKGROUNDS[0];

  const abil = {} as Record<AbilityKey, number>;
  for (const k of ABIL) {
    const base = Math.max(3, Math.min(20, Math.round(input.baseAbil[k] ?? 10)));
    const rBonus = race.abilityBonuses[k] || 0;
    const rpBonus = racePerk.effects.abil?.[k] || 0;
    const cpBonus = clsPerk.effects.abil?.[k] || 0;
    abil[k] = Math.min(20, base + rBonus + rpBonus + cpBonus);
  }

  const skillSet = new Set<string>([
    ...race.bonusSkills,
    ...bg.skills,
    ...input.chosenSkills.slice(0, cls.skillCount),
    ...(racePerk.effects.skills || []),
    ...(clsPerk.effects.skills || [])
  ]);

  const expertiseSet = new Set<string>([
    ...(input.chosenExpertise || []).slice(0, cls.expertiseCount),
    ...(racePerk.effects.expertise || []),
    ...(clsPerk.effects.expertise || [])
  ]);
  for (const ex of expertiseSet) skillSet.add(ex);

  const hpBonus = (racePerk.effects.hpBonus || 0) + (clsPerk.effects.hpBonus || 0);
  const maxHp = Math.max(1, cls.hitDie + mod(abil.con) + hpBonus);
  const speed = race.speed + (racePerk.effects.speedBonus || 0) + (clsPerk.effects.speedBonus || 0);
  const gold = cls.startingGold + bg.bonusGold + (racePerk.effects.goldBonus || 0) + (clsPerk.effects.goldBonus || 0);
  const acBonus = (racePerk.effects.acBonus || 0) + (clsPerk.effects.acBonus || 0);

  const inv: InventoryItem[] = cls.startingInv.map(it => ({
    id: rid(),
    ...it,
    ref: it.ref || refFromName(it.name)
  }));

  const char: CharacterState = {
    name: str(input.name, 30) || "Wanderer",
    species: race.name,
    cls: cls.name,
    bg: bg.name,
    appearance: str(input.appearance || `${race.name} ${cls.name.toLowerCase()}, ${bg.name.toLowerCase()}.`, 260),
    portraitId: input.portraitId ?? null,
    level: 1,
    xp: 0,
    hp: maxHp,
    maxHp,
    ac: 10,
    speed,
    abil,
    skills: Array.from(skillSet),
    expertise: Array.from(expertiseSet),
    saves: [...cls.saves],
    hd: { die: cls.hitDie, max: 1, left: 1 },
    gold,
    conditions: [],
    dying: null,
    mastery: [...cls.mastery],
    res: resFor({ cls: cls.name, level: 1 }),
    inv,
    perks: [`${racePerk.name} (${race.name}): ${racePerk.summary}`, `${clsPerk.name} (${cls.name}): ${clsPerk.summary}`],
    backstory: str(input.backstory || "", 1600) || undefined
  };

  syncChar(char);
  char.ac += acBonus;
  return char;
}
