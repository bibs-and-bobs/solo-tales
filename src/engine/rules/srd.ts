/* Frozen SRD 5.2 (2024 5e, CC BY 4.0) rules data.
   Distances are in metres (5 ft = 1.5 m). Frozen at load: code reads it, nothing writes it. */

import { deepFreeze } from "../util";

export type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

export const ABIL: readonly AbilityKey[] = deepFreeze(["str", "dex", "con", "int", "wis", "cha"]);

export const ABIL_NAME: Readonly<Record<AbilityKey, string>> = deepFreeze({
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
});

export const SKILLS: Readonly<Record<string, AbilityKey>> = deepFreeze({
  acrobatics: "dex",
  animal_handling: "wis",
  arcana: "int",
  athletics: "str",
  deception: "cha",
  history: "int",
  insight: "wis",
  intimidation: "cha",
  investigation: "int",
  medicine: "wis",
  nature: "int",
  perception: "wis",
  performance: "cha",
  persuasion: "cha",
  religion: "int",
  sleight_of_hand: "dex",
  stealth: "dex",
  survival: "wis"
});

export type ConditionKey =
  | "blinded"
  | "charmed"
  | "deafened"
  | "exhaustion"
  | "frightened"
  | "grappled"
  | "incapacitated"
  | "invisible"
  | "paralyzed"
  | "petrified"
  | "poisoned"
  | "prone"
  | "restrained"
  | "stunned"
  | "unconscious";

export const CONDITIONS: readonly ConditionKey[] = deepFreeze([
  "blinded",
  "charmed",
  "deafened",
  "exhaustion",
  "frightened",
  "grappled",
  "incapacitated",
  "invisible",
  "paralyzed",
  "petrified",
  "poisoned",
  "prone",
  "restrained",
  "stunned",
  "unconscious"
]);

export const XP_AT: readonly number[] = deepFreeze([
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000
]);

export const mod = (score: number): number => Math.floor((score - 10) / 2);
export const prof = (lvl: number): number => 2 + Math.floor((lvl - 1) / 4);

export type SizeCode = "T" | "S" | "M" | "L" | "H" | "G";
export const SIZES: readonly SizeCode[] = deepFreeze(["T", "S", "M", "L", "H", "G"]);

export type MasteryKey = "cleave" | "graze" | "nick" | "push" | "sap" | "slow" | "topple" | "vex";

export const MASTERY: Readonly<Record<MasteryKey, string>> = deepFreeze({
  cleave: "After a melee hit you can attack a second creature next to the first, once per turn. That hit adds no ability modifier.",
  graze: "On a miss you still deal damage equal to the ability modifier you attacked with.",
  nick: "The extra Light-weapon attack happens as part of the Attack action instead of costing your Bonus Action, once per turn.",
  push: "On a hit you push a Large or smaller target 3 m away, out of melee.",
  sap: "On a hit the target has Disadvantage on its next attack roll before the start of your next turn.",
  slow: "On a hit that deals damage, the target's Speed drops by 3 m until the start of your next turn.",
  topple: "On a hit the target makes a Constitution save (DC 8 + your attack modifier + proficiency) or falls Prone.",
  vex: "On a hit that deals damage you have Advantage on your next attack against that target before the end of your next turn."
});

export interface WeaponDef {
  name: string;
  cat: "simple" | "martial";
  kind: "melee" | "ranged";
  dice: string;
  type: string;
  props: string[];
  mastery: MasteryKey;
  range?: [number, number];
  versatile?: string;
  ammo?: string;
}

const Wp = (
  name: string,
  cat: "simple" | "martial",
  kind: "melee" | "ranged",
  dice: string,
  type: string,
  props: string[],
  mastery: MasteryKey,
  more?: Partial<WeaponDef>
): WeaponDef => ({ name, cat, kind, dice, type, props, mastery, ...more });

export const WEAPONS: Readonly<Record<string, WeaponDef>> = deepFreeze({
  club: Wp("Club", "simple", "melee", "1d4", "bludgeoning", ["light"], "slow"),
  dagger: Wp("Dagger", "simple", "melee", "1d4", "piercing", ["finesse", "light", "thrown"], "nick", { range: [6, 18] }),
  greatclub: Wp("Greatclub", "simple", "melee", "1d8", "bludgeoning", ["two-handed"], "push"),
  handaxe: Wp("Handaxe", "simple", "melee", "1d6", "slashing", ["light", "thrown"], "vex", { range: [6, 18] }),
  javelin: Wp("Javelin", "simple", "melee", "1d6", "piercing", ["thrown"], "slow", { range: [9, 36] }),
  light_hammer: Wp("Light hammer", "simple", "melee", "1d4", "bludgeoning", ["light", "thrown"], "nick", { range: [6, 18] }),
  mace: Wp("Mace", "simple", "melee", "1d6", "bludgeoning", [], "sap"),
  quarterstaff: Wp("Quarterstaff", "simple", "melee", "1d6", "bludgeoning", ["versatile"], "topple", { versatile: "1d8" }),
  sickle: Wp("Sickle", "simple", "melee", "1d4", "slashing", ["light"], "nick"),
  spear: Wp("Spear", "simple", "melee", "1d6", "piercing", ["thrown", "versatile"], "sap", { range: [6, 18], versatile: "1d8" }),
  dart: Wp("Dart", "simple", "ranged", "1d4", "piercing", ["finesse", "thrown"], "vex", { range: [6, 18] }),
  light_crossbow: Wp("Light crossbow", "simple", "ranged", "1d8", "piercing", ["ammunition", "loading", "two-handed"], "slow", { range: [24, 96], ammo: "bolts" }),
  shortbow: Wp("Shortbow", "simple", "ranged", "1d6", "piercing", ["ammunition", "two-handed"], "vex", { range: [24, 96], ammo: "arrows" }),
  sling: Wp("Sling", "simple", "ranged", "1d4", "bludgeoning", ["ammunition"], "slow", { range: [9, 36], ammo: "sling_bullets" }),
  battleaxe: Wp("Battleaxe", "martial", "melee", "1d8", "slashing", ["versatile"], "topple", { versatile: "1d10" }),
  flail: Wp("Flail", "martial", "melee", "1d8", "bludgeoning", [], "sap"),
  glaive: Wp("Glaive", "martial", "melee", "1d10", "slashing", ["heavy", "reach", "two-handed"], "graze"),
  greataxe: Wp("Greataxe", "martial", "melee", "1d12", "slashing", ["heavy", "two-handed"], "cleave"),
  greatsword: Wp("Greatsword", "martial", "melee", "2d6", "slashing", ["heavy", "two-handed"], "graze"),
  halberd: Wp("Halberd", "martial", "melee", "1d10", "slashing", ["heavy", "reach", "two-handed"], "cleave"),
  lance: Wp("Lance", "martial", "melee", "1d10", "piercing", ["heavy", "reach", "two-handed"], "topple"),
  longsword: Wp("Longsword", "martial", "melee", "1d8", "slashing", ["versatile"], "sap", { versatile: "1d10" }),
  maul: Wp("Maul", "martial", "melee", "2d6", "bludgeoning", ["heavy", "two-handed"], "topple"),
  morningstar: Wp("Morningstar", "martial", "melee", "1d8", "piercing", [], "sap"),
  pike: Wp("Pike", "martial", "melee", "1d10", "piercing", ["heavy", "reach", "two-handed"], "push"),
  rapier: Wp("Rapier", "martial", "melee", "1d8", "piercing", ["finesse"], "vex"),
  scimitar: Wp("Scimitar", "martial", "melee", "1d6", "slashing", ["finesse", "light"], "nick"),
  shortsword: Wp("Shortsword", "martial", "melee", "1d6", "piercing", ["finesse", "light"], "vex"),
  trident: Wp("Trident", "martial", "melee", "1d8", "piercing", ["thrown", "versatile"], "topple", { range: [6, 18], versatile: "1d10" }),
  warhammer: Wp("Warhammer", "martial", "melee", "1d8", "bludgeoning", ["versatile"], "push", { versatile: "1d10" }),
  war_pick: Wp("War pick", "martial", "melee", "1d8", "piercing", ["versatile"], "sap", { versatile: "1d10" }),
  whip: Wp("Whip", "martial", "melee", "1d4", "slashing", ["finesse", "reach"], "slow"),
  blowgun: Wp("Blowgun", "martial", "ranged", "1", "piercing", ["ammunition", "loading"], "vex", { range: [7.5, 30], ammo: "needles" }),
  hand_crossbow: Wp("Hand crossbow", "martial", "ranged", "1d6", "piercing", ["ammunition", "light", "loading"], "vex", { range: [9, 36], ammo: "bolts" }),
  heavy_crossbow: Wp("Heavy crossbow", "martial", "ranged", "1d10", "piercing", ["ammunition", "heavy", "loading", "two-handed"], "push", { range: [30, 120], ammo: "bolts" }),
  longbow: Wp("Longbow", "martial", "ranged", "1d8", "piercing", ["ammunition", "heavy", "two-handed"], "slow", { range: [45, 180], ammo: "arrows" }),
  musket: Wp("Musket", "martial", "ranged", "1d12", "piercing", ["ammunition", "loading", "two-handed"], "slow", { range: [12, 36], ammo: "firearm_bullets" }),
  pistol: Wp("Pistol", "martial", "ranged", "1d10", "piercing", ["ammunition", "loading"], "vex", { range: [9, 27], ammo: "firearm_bullets" })
});

export const AMMO: Readonly<Record<string, { name: string }>> = deepFreeze({
  arrows: { name: "Arrows" },
  bolts: { name: "Bolts" },
  sling_bullets: { name: "Sling bullets" },
  firearm_bullets: { name: "Firearm bullets" },
  needles: { name: "Needles" }
});

export interface ArmourDef {
  name: string;
  cat: "light" | "medium" | "heavy" | "shield";
  ac: number;
  str?: number;
  stealthDis?: boolean;
}

export const ARMOUR: Readonly<Record<string, ArmourDef>> = deepFreeze({
  padded: { name: "Padded armour", cat: "light", ac: 11, stealthDis: true },
  leather: { name: "Leather armour", cat: "light", ac: 11 },
  studded_leather: { name: "Studded leather armour", cat: "light", ac: 12 },
  hide: { name: "Hide armour", cat: "medium", ac: 12 },
  chain_shirt: { name: "Chain shirt", cat: "medium", ac: 13 },
  scale_mail: { name: "Scale mail", cat: "medium", ac: 14, stealthDis: true },
  breastplate: { name: "Breastplate", cat: "medium", ac: 14 },
  half_plate: { name: "Half plate armour", cat: "medium", ac: 15, stealthDis: true },
  ring_mail: { name: "Ring mail", cat: "heavy", ac: 14, stealthDis: true },
  chain_mail: { name: "Chain mail", cat: "heavy", ac: 16, str: 13, stealthDis: true },
  splint: { name: "Splint armour", cat: "heavy", ac: 17, str: 15, stealthDis: true },
  plate: { name: "Plate armour", cat: "heavy", ac: 18, str: 15, stealthDis: true },
  shield: { name: "Shield", cat: "shield", ac: 2 }
});

export interface CondRule {
  rule: string;
  attackDis?: number;
  attackAdv?: number;
  attackedAdv?: number;
  attackedDis?: number;
  checkDis?: number;
  d20?: number;
  speed?: number;
  speed0?: number;
  incap?: number;
  failStrDex?: number;
  meleeCrit?: number;
  resistAll?: number;
  prone?: number;
  dexSaveDis?: number;
}

export const COND: Readonly<Record<ConditionKey, CondRule>> = deepFreeze({
  blinded: { rule: "You can't see. Your attacks have Disadvantage; attacks against you have Advantage.", attackDis: 1, attackedAdv: 1 },
  charmed: { rule: "You can't attack the charmer, and it has Advantage on social checks against you." },
  deafened: { rule: "You can't hear and automatically fail checks that rely on hearing." },
  exhaustion: { rule: "Each level gives -2 to every d20 test and -1.5 m Speed. Level 6 is death. A long rest removes one level.", d20: -2, speed: -1.5 },
  frightened: { rule: "While the source is in sight you have Disadvantage on checks and attacks, and you can't move closer to it.", attackDis: 1, checkDis: 1 },
  grappled: { rule: "Your Speed is 0, and you have Disadvantage on attacks against anyone but the grappler.", speed0: 1 },
  incapacitated: { rule: "You can't take actions, Bonus Actions or Reactions, and you can't speak.", incap: 1 },
  invisible: { rule: "Others can't see you: your attacks have Advantage and attacks against you have Disadvantage. Hiding ends when you attack.", attackAdv: 1, attackedDis: 1 },
  paralyzed: { rule: "Incapacitated and Speed 0. You fail Strength and Dexterity saves; attacks against you have Advantage, and melee hits are critical.", incap: 1, speed0: 1, failStrDex: 1, attackedAdv: 1, meleeCrit: 1 },
  petrified: { rule: "Turned to stone: Incapacitated, Speed 0, resistant to all damage, failing Strength and Dexterity saves.", incap: 1, speed0: 1, failStrDex: 1, attackedAdv: 1, resistAll: 1 },
  poisoned: { rule: "You have Disadvantage on attack rolls and ability checks.", attackDis: 1, checkDis: 1 },
  prone: { rule: "Your attacks have Disadvantage. Attacks from within 1.5 m have Advantage, from farther away Disadvantage. Standing costs half your Speed.", attackDis: 1, prone: 1 },
  restrained: { rule: "Speed 0. Your attacks and Dexterity saves have Disadvantage; attacks against you have Advantage.", speed0: 1, attackDis: 1, attackedAdv: 1, dexSaveDis: 1 },
  stunned: { rule: "Incapacitated. You fail Strength and Dexterity saves, and attacks against you have Advantage.", incap: 1, failStrDex: 1, attackedAdv: 1 },
  unconscious: { rule: "Incapacitated, Prone and unaware. You fail Strength and Dexterity saves; attacks against you have Advantage, and melee hits are critical.", incap: 1, speed0: 1, failStrDex: 1, attackedAdv: 1, meleeCrit: 1, prone: 1 }
});

export interface MonsterAttackDef {
  name: string;
  kind: "melee" | "ranged" | "both";
  bonus: number;
  dmg: string;
  type: string;
  range?: [number, number];
  advDmg?: string;
  extra?: Array<{ dmg: string; type: string }>;
  onHit?: { cond: ConditionKey; maxSize: SizeCode };
}

export type MonsterMorale = "coward" | "normal" | "fearless";
export type MonsterRole = "skirmisher" | "leader" | "pack" | "brute";

export interface MonsterDef {
  name: string;
  size: SizeCode;
  type: string;
  ac: number;
  hp: number;
  hd: string;
  speed: number;
  abil: Record<AbilityKey, number>;
  saves: Partial<Record<AbilityKey, number>>;
  pp: number;
  cr: string;
  xp: number;
  pb: number;
  role: MonsterRole;
  morale: MonsterMorale;
  traits: string[];
  multi: number;
  icon: string;
  vuln?: string[];
  resist?: string[];
  immune?: string[];
  condImmune?: ConditionKey[];
  attacks: MonsterAttackDef[];
}

const Ma = (
  name: string,
  kind: "melee" | "ranged" | "both",
  bonus: number,
  dmg: string,
  type: string,
  more?: Partial<MonsterAttackDef>
): MonsterAttackDef => ({ name, kind, bonus, dmg, type, ...more });

export const MONSTERS: Readonly<Record<string, MonsterDef>> = deepFreeze({
  goblin_warrior: {
    name: "Goblin Warrior", size: "S", type: "fey (goblinoid)", ac: 15, hp: 10, hd: "3d6", speed: 9,
    abil: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 }, saves: {}, pp: 9, cr: "1/4", xp: 50, pb: 2,
    role: "skirmisher", morale: "normal", traits: ["nimble_escape"], multi: 1, icon: "plain-dagger",
    attacks: [
      Ma("Scimitar", "melee", 4, "1d6+2", "slashing", { advDmg: "1d4" }),
      Ma("Shortbow", "ranged", 4, "1d6+2", "piercing", { range: [24, 96], advDmg: "1d4" })
    ]
  },
  goblin_boss: {
    name: "Goblin Boss", size: "S", type: "fey (goblinoid)", ac: 17, hp: 21, hd: "6d6", speed: 9,
    abil: { str: 10, dex: 15, con: 10, int: 10, wis: 8, cha: 10 }, saves: {}, pp: 9, cr: "1", xp: 200, pb: 2,
    role: "leader", morale: "normal", traits: ["nimble_escape", "redirect_attack"], multi: 2, icon: "crossed-swords",
    attacks: [
      Ma("Scimitar", "melee", 4, "1d6+2", "slashing", { advDmg: "1d4" }),
      Ma("Shortbow", "ranged", 4, "1d6+2", "piercing", { range: [24, 96], advDmg: "1d4" })
    ]
  },
  wolf: {
    name: "Wolf", size: "M", type: "beast", ac: 12, hp: 11, hd: "2d8+2", speed: 12,
    abil: { str: 14, dex: 15, con: 12, int: 3, wis: 12, cha: 6 }, saves: {}, pp: 15, cr: "1/4", xp: 50, pb: 2,
    role: "pack", morale: "normal", traits: ["pack_tactics"], multi: 1, icon: "crossed-swords",
    attacks: [Ma("Bite", "melee", 4, "1d6+2", "piercing", { onHit: { cond: "prone", maxSize: "M" } })]
  },
  dire_wolf: {
    name: "Dire Wolf", size: "L", type: "beast", ac: 14, hp: 22, hd: "3d10+6", speed: 15,
    abil: { str: 17, dex: 15, con: 15, int: 3, wis: 12, cha: 7 }, saves: {}, pp: 15, cr: "1", xp: 200, pb: 2,
    role: "pack", morale: "normal", traits: ["pack_tactics"], multi: 1, icon: "crossed-swords",
    attacks: [Ma("Bite", "melee", 5, "1d10+3", "piercing", { onHit: { cond: "prone", maxSize: "L" } })]
  },
  giant_rat: {
    name: "Giant Rat", size: "S", type: "beast", ac: 13, hp: 7, hd: "2d6", speed: 9,
    abil: { str: 7, dex: 16, con: 11, int: 2, wis: 10, cha: 4 }, saves: { dex: 5 }, pp: 12, cr: "1/8", xp: 25, pb: 2,
    role: "pack", morale: "coward", traits: ["pack_tactics"], multi: 1, icon: "crossed-swords",
    attacks: [Ma("Bite", "melee", 5, "1d4+3", "piercing")]
  },
  bandit: {
    name: "Bandit", size: "M", type: "humanoid", ac: 12, hp: 11, hd: "2d8+2", speed: 9,
    abil: { str: 11, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, saves: {}, pp: 10, cr: "1/8", xp: 25, pb: 2,
    role: "brute", morale: "coward", traits: [], multi: 1, icon: "crossed-swords",
    attacks: [
      Ma("Scimitar", "melee", 3, "1d6+1", "slashing"),
      Ma("Light crossbow", "ranged", 3, "1d8+1", "piercing", { range: [24, 96] })
    ]
  },
  guard: {
    name: "Guard", size: "M", type: "humanoid", ac: 16, hp: 11, hd: "2d8+2", speed: 9,
    abil: { str: 13, dex: 12, con: 12, int: 10, wis: 11, cha: 10 }, saves: {}, pp: 12, cr: "1/8", xp: 25, pb: 2,
    role: "brute", morale: "normal", traits: [], multi: 1, icon: "crossed-swords",
    attacks: [Ma("Spear", "both", 3, "1d6+1", "piercing", { range: [6, 18] })]
  },
  cultist: {
    name: "Cultist", size: "M", type: "humanoid", ac: 12, hp: 9, hd: "2d8", speed: 9,
    abil: { str: 11, dex: 12, con: 10, int: 10, wis: 11, cha: 10 }, saves: { wis: 2 }, pp: 10, cr: "1/8", xp: 25, pb: 2,
    role: "brute", morale: "normal", traits: [], multi: 1, icon: "hood",
    attacks: [Ma("Ritual sickle", "melee", 3, "1d4+1", "slashing", { extra: [{ dmg: "1", type: "necrotic" }] })]
  },
  skeleton: {
    name: "Skeleton", size: "M", type: "undead", ac: 14, hp: 13, hd: "2d8+4", speed: 9,
    abil: { str: 10, dex: 16, con: 15, int: 6, wis: 8, cha: 5 }, saves: {}, pp: 9, cr: "1/4", xp: 50, pb: 2,
    role: "brute", morale: "fearless", traits: [], multi: 1, icon: "skull",
    vuln: ["bludgeoning"], immune: ["poison"], condImmune: ["exhaustion", "poisoned"],
    attacks: [
      Ma("Shortsword", "melee", 5, "1d6+3", "piercing"),
      Ma("Shortbow", "ranged", 5, "1d6+3", "piercing", { range: [24, 96] })
    ]
  },
  zombie: {
    name: "Zombie", size: "M", type: "undead", ac: 8, hp: 15, hd: "2d8+6", speed: 6,
    abil: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 }, saves: { wis: 0 }, pp: 8, cr: "1/4", xp: 50, pb: 2,
    role: "brute", morale: "fearless", traits: ["undead_fortitude"], multi: 1, icon: "skull",
    immune: ["poison"], condImmune: ["exhaustion", "poisoned"],
    attacks: [Ma("Slam", "melee", 3, "1d8+1", "bludgeoning")]
  },
  ogre: {
    name: "Ogre", size: "L", type: "giant", ac: 11, hp: 68, hd: "8d10+24", speed: 12,
    abil: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 }, saves: {}, pp: 8, cr: "2", xp: 450, pb: 2,
    role: "brute", morale: "normal", traits: [], multi: 1, icon: "crossed-swords",
    attacks: [
      Ma("Greatclub", "melee", 6, "2d8+4", "bludgeoning"),
      Ma("Javelin", "both", 6, "2d6+4", "piercing", { range: [9, 36] })
    ]
  },
  /* Expanded SRD 5.2 archetypes for richer Campaign Prep Foe Templates */
  acolyte: {
    name: "Acolyte", size: "M", type: "humanoid", ac: 13, hp: 11, hd: "2d8+2", speed: 9,
    abil: { str: 10, dex: 10, con: 12, int: 10, wis: 14, cha: 11 }, saves: { wis: 4 }, pp: 12, cr: "1/4", xp: 50, pb: 2,
    role: "skirmisher", morale: "normal", traits: [], multi: 1, icon: "hood",
    attacks: [
      Ma("Mace", "melee", 2, "1d6", "bludgeoning", { extra: [{ dmg: "1d4", type: "radiant" }] }),
      Ma("Radiant flame", "ranged", 4, "1d8", "radiant", { range: [18, 18] })
    ]
  },
  scout: {
    name: "Scout", size: "M", type: "humanoid", ac: 13, hp: 16, hd: "3d8+3", speed: 9,
    abil: { str: 11, dex: 14, con: 12, int: 11, wis: 13, cha: 11 }, saves: {}, pp: 15, cr: "1/2", xp: 100, pb: 2,
    role: "skirmisher", morale: "normal", traits: [], multi: 2, icon: "pocket-bow",
    attacks: [
      Ma("Shortsword", "melee", 4, "1d6+2", "piercing"),
      Ma("Longbow", "ranged", 4, "1d8+2", "piercing", { range: [45, 180] })
    ]
  },
  spy: {
    name: "Spy", size: "M", type: "humanoid", ac: 12, hp: 27, hd: "6d8", speed: 9,
    abil: { str: 10, dex: 15, con: 10, int: 12, wis: 14, cha: 16 }, saves: {}, pp: 16, cr: "1", xp: 200, pb: 2,
    role: "skirmisher", morale: "coward", traits: ["nimble_escape"], multi: 1, icon: "plain-dagger",
    attacks: [
      Ma("Shortsword", "melee", 4, "1d6+2", "piercing", { advDmg: "2d6" }),
      Ma("Hand crossbow", "ranged", 4, "1d6+2", "piercing", { range: [9, 36], advDmg: "2d6" })
    ]
  },
  berserker: {
    name: "Berserker", size: "M", type: "humanoid", ac: 13, hp: 67, hd: "9d8+27", speed: 9,
    abil: { str: 16, dex: 12, con: 17, int: 9, wis: 11, cha: 9 }, saves: {}, pp: 10, cr: "2", xp: 450, pb: 2,
    role: "brute", morale: "fearless", traits: [], multi: 1, icon: "battle-axe",
    attacks: [Ma("Greataxe", "melee", 5, "1d12+3", "slashing")]
  },
  mage_apprentice: {
    name: "Mage Apprentice", size: "M", type: "humanoid", ac: 12, hp: 18, hd: "4d8", speed: 9,
    abil: { str: 9, dex: 14, con: 11, int: 16, wis: 12, cha: 11 }, saves: { int: 5, wis: 3 }, pp: 11, cr: "1/2", xp: 100, pb: 2,
    role: "skirmisher", morale: "coward", traits: [], multi: 1, icon: "scroll-unfurled",
    attacks: [
      Ma("Quarterstaff", "melee", 1, "1d6-1", "bludgeoning"),
      Ma("Arcane bolt", "ranged", 5, "1d10+3", "force", { range: [18, 36] })
    ]
  },
  animated_armour: {
    name: "Animated Armour", size: "M", type: "construct", ac: 18, hp: 33, hd: "6d8+6", speed: 7.5,
    abil: { str: 14, dex: 11, con: 13, int: 1, wis: 3, cha: 1 }, saves: {}, pp: 6, cr: "1", xp: 200, pb: 2,
    role: "brute", morale: "fearless", traits: [], multi: 2, icon: "chain-mail",
    immune: ["poison", "psychic"], condImmune: ["blinded", "charmed", "deafened", "exhaustion", "frightened", "paralyzed", "petrified", "poisoned"],
    attacks: [Ma("Slam", "melee", 4, "1d6+2", "bludgeoning")]
  },
  ghoul: {
    name: "Ghoul", size: "M", type: "undead", ac: 12, hp: 22, hd: "5d8", speed: 9,
    abil: { str: 13, dex: 15, con: 10, int: 7, wis: 10, cha: 6 }, saves: {}, pp: 10, cr: "1", xp: 200, pb: 2,
    role: "brute", morale: "fearless", traits: [], multi: 1, icon: "skull",
    immune: ["poison"], condImmune: ["charmed", "exhaustion", "poisoned"],
    attacks: [Ma("Claws", "melee", 4, "2d4+2", "slashing", { onHit: { cond: "poisoned", maxSize: "M" } })]
  },
  giant_spider: {
    name: "Giant Spider", size: "L", type: "beast", ac: 14, hp: 26, hd: "4d10+4", speed: 9,
    abil: { str: 14, dex: 16, con: 12, int: 2, wis: 11, cha: 4 }, saves: {}, pp: 10, cr: "1", xp: 200, pb: 2,
    role: "skirmisher", morale: "normal", traits: [], multi: 1, icon: "crossed-swords",
    attacks: [
      Ma("Venomous bite", "melee", 5, "1d8+3", "piercing", { extra: [{ dmg: "1d6", type: "poison" }] }),
      Ma("Web", "ranged", 5, "0", "bludgeoning", { range: [9, 18], onHit: { cond: "restrained", maxSize: "L" } })
    ]
  }
});

export type MonsterRef = keyof typeof MONSTERS;

export interface ClassRule {
  weapons: string[];
  armour: string[];
  mastery: boolean;
  sneak?: boolean;
}

export const CLASS_RULES: Readonly<Record<string, ClassRule>> = deepFreeze({
  fighter: { weapons: ["simple", "martial"], armour: ["light", "medium", "heavy", "shield"], mastery: true },
  rogue: { weapons: ["simple", "martial:finesse", "martial:light"], armour: ["light"], mastery: true, sneak: true },
  barbarian: { weapons: ["simple", "martial"], armour: ["light", "medium", "shield"], mastery: true },
  ranger: { weapons: ["simple", "martial"], armour: ["light", "medium", "shield"], mastery: true },
  cleric: { weapons: ["simple"], armour: ["light", "medium", "shield"], mastery: false },
  wizard: { weapons: ["simple"], armour: [], mastery: false },
  _other: { weapons: ["simple"], armour: ["light"], mastery: false }
});

export interface LootDef {
  gold: string;
  items: ReadonlyArray<readonly [number, string, string]>;
}

export const LOOT: Readonly<Record<string, LootDef>> = deepFreeze({
  goblin_warrior: { gold: "1d4", items: [[25, "Scimitar", "1"], [20, "Arrows", "1d6"], [10, "Rations", "1"]] },
  goblin_boss: { gold: "2d6", items: [[40, "Potion of healing", "1"], [30, "Scimitar", "1"], [25, "Arrows", "1d6+2"]] },
  wolf: { gold: "0", items: [] },
  dire_wolf: { gold: "0", items: [] },
  giant_rat: { gold: "0", items: [] },
  giant_spider: { gold: "0", items: [] },
  bandit: { gold: "1d6", items: [[20, "Scimitar", "1"], [10, "Light crossbow", "1"], [20, "Bolts", "1d6"], [10, "Potion of healing", "1"]] },
  guard: { gold: "1d4+1", items: [[30, "Spear", "1"], [15, "Rations", "1"]] },
  cultist: { gold: "1d6", items: [[25, "Sickle", "1"], [10, "Potion of healing", "1"]] },
  acolyte: { gold: "1d6", items: [[25, "Mace", "1"], [20, "Potion of healing", "1"]] },
  scout: { gold: "1d6+1", items: [[25, "Arrows", "1d6+2"], [20, "Shortsword", "1"], [15, "Rations", "1"]] },
  spy: { gold: "2d6", items: [[30, "Dagger", "1"], [20, "Bolts", "1d6"], [20, "Potion of healing", "1"]] },
  berserker: { gold: "2d6", items: [[25, "Greataxe", "1"], [15, "Potion of healing", "1"]] },
  mage_apprentice: { gold: "2d4", items: [[20, "Quarterstaff", "1"], [25, "Potion of healing", "1"]] },
  animated_armour: { gold: "0", items: [] },
  skeleton: { gold: "0", items: [[20, "Shortsword", "1"], [15, "Arrows", "1d4"]] },
  zombie: { gold: "1d4-2", items: [[10, "Dagger", "1"]] },
  ghoul: { gold: "1d4-1", items: [[10, "Dagger", "1"]] },
  ogre: { gold: "3d6", items: [[40, "Javelin", "1d3"], [15, "Potion of healing", "1"]] }
});

export const LOOT_NOTES: Readonly<Record<string, string>> = deepFreeze({
  "Potion of healing": "Heals 2d4 + 2",
  "Scimitar": "1d6 slashing, finesse, light",
  "Spear": "1d6 piercing, thrown 6 m",
  "Javelin": "1d6 piercing, thrown 9 m",
  "Dagger": "1d4 piercing, thrown 6 m",
  "Sickle": "1d4 slashing, light",
  "Shortsword": "1d6 piercing, finesse, light",
  "Light crossbow": "1d8 piercing, range 24 m",
  "Mace": "1d6 bludgeoning",
  "Greataxe": "1d12 slashing, heavy, two-handed",
  "Quarterstaff": "1d6 bludgeoning, versatile 1d8",
  "Rations": "1 day each"
});
