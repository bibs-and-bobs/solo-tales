/* Character rules, checks, equipment mapping, AC/attack math, premade heroes, and seeded loot. */

import { arr, deepFreeze, nice, seededRng, sign } from "../util";
import {
  ABIL,
  ABIL_NAME,
  AMMO,
  ARMOUR,
  CLASS_RULES,
  LOOT,
  MONSTERS,
  SKILLS,
  WEAPONS,
  mod,
  prof,
  type AbilityKey,
  type ArmourDef,
  type ClassRule,
  type ConditionKey,
  type MasteryKey,
  type SizeCode,
  type WeaponDef
} from "./srd";

export interface InventoryItem {
  id: string;
  name: string;
  note: string;
  qty: number;
  eq?: boolean;
  ref?: string | null;
  weightKg?: number;
}

export interface ClassResource {
  left: number;
  max: number;
}

export interface CharacterState {
  name: string;
  species: string;
  cls: string;
  bg: string;
  appearance?: string;
  portraitId?: string | null;
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  ac: number;
  speed: number;
  abil: Record<AbilityKey, number>;
  skills: string[];
  expertise: string[];
  saves: AbilityKey[];
  hd: { die: number; max: number; left: number };
  gold: number;
  conditions: ConditionKey[];
  dying: { s: number; f: number } | null;
  mastery: string[];
  res: Record<string, ClassResource>;
  inv: InventoryItem[];
  hpTrail?: number[];
  status?: string;
  perks?: string[];
  backstory?: string;
}

export interface NormalizedCheck {
  kind: "skill" | "ability" | "save";
  key: string;
  abil: AbilityKey;
}

export function normCheck(raw: unknown): NormalizedCheck | null {
  const k = String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/_check$/, "");
  const save = /_save$|_saving_throw$/.test(k);
  const base = k.replace(/_save$|_saving_throw$/, "");
  if (Object.hasOwn(SKILLS, base) && !save) {
    return { kind: "skill", key: base, abil: SKILLS[base] };
  }
  const ab = ABIL.find(a => a === base || ABIL_NAME[a].toLowerCase() === base);
  if (ab) return { kind: save ? "save" : "ability", key: ab, abil: ab };
  return null;
}

export function checkBonus(
  c: Pick<CharacterState, "abil" | "level" | "skills" | "expertise" | "saves">,
  chk: NormalizedCheck
): { bonus: number; why: string } {
  const am = mod(c.abil[chk.abil]);
  const p = prof(c.level);
  let pr = 0;
  let why: string;
  if (chk.kind === "skill") {
    if (c.expertise.includes(chk.key)) pr = 2 * p;
    else if (c.skills.includes(chk.key)) pr = p;
    why =
      `${nice(chk.key)} uses ${ABIL_NAME[chk.abil]} (${sign(am)})` +
      (pr
        ? pr > p
          ? `, plus double proficiency for expertise (${sign(pr)}).`
          : `, plus your proficiency bonus (${sign(pr)}).`
        : `. You aren't proficient, so no proficiency bonus.`);
  } else if (chk.kind === "save") {
    if (c.saves.includes(chk.key as AbilityKey)) pr = p;
    why =
      `A ${ABIL_NAME[chk.abil]} saving throw uses your ${ABIL_NAME[chk.abil]} modifier (${sign(am)})` +
      (pr
        ? `, plus proficiency (${sign(pr)}) because your class trains this save.`
        : `. Your class isn't proficient in this save.`);
  } else {
    why = `A raw ${ABIL_NAME[chk.abil]} check: just the modifier (${sign(am)}), no skill applies.`;
  }
  return { bonus: am + pr, why };
}

export function checkLabel(chk: Pick<NormalizedCheck, "kind" | "key">): string {
  if (chk.kind === "skill") return nice(chk.key) + " check";
  const abName = ABIL_NAME[chk.key as AbilityKey] || nice(chk.key);
  return chk.kind === "save" ? abName + " saving throw" : abName + " check";
}

export const classRules = (c: { cls?: string } | null | undefined): ClassRule =>
  CLASS_RULES[String(c?.cls || "").toLowerCase()] || CLASS_RULES._other;

export const masteryCount = (c: { cls?: string; level?: number } | null | undefined): number => {
  const k = String(c?.cls || "").toLowerCase();
  const L = c?.level || 1;
  return k === "fighter" ? (L >= 16 ? 6 : L >= 10 ? 5 : L >= 4 ? 4 : 3) : k === "rogue" ? 2 : 0;
};

export const extraAttacks = (c: { cls?: string; level?: number } | null | undefined): number => {
  const L = c?.level || 1;
  return String(c?.cls || "").toLowerCase() === "fighter"
    ? Number(L >= 20) + Number(L >= 11) + Number(L >= 5)
    : 0;
};

export const sneakDice = (c: { cls?: string; level?: number } | null | undefined): number =>
  classRules(c).sneak ? Math.ceil((c?.level || 1) / 2) : 0;

export const sizeOf = (c: { species?: string } | null | undefined): SizeCode =>
  /halfling|gnome/i.test(c?.species || "") ? "S" : "M";

export function resFor(c: { cls?: string; level?: number } | null | undefined): Record<string, ClassResource> {
  if (String(c?.cls || "").toLowerCase() !== "fighter") return {};
  const L = c?.level || 1;
  const max = L >= 10 ? 4 : L >= 4 ? 3 : 2;
  return { second_wind: { left: max, max } };
}

/* Equipment & Bag mapping */
const REF_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\barrows?\b/, "ammo:arrows"],
  [/\bbolts?\b/, "ammo:bolts"],
  [/sling (bullets?|stones?)/, "ammo:sling_bullets"],
  [/firearm bullets?|\bbullets?\b/, "ammo:firearm_bullets"],
  [/needles?/, "ammo:needles"],
  [/hand ?crossbow/, "w:hand_crossbow"],
  [/heavy crossbow/, "w:heavy_crossbow"],
  [/crossbow/, "w:light_crossbow"],
  [/short ?bow/, "w:shortbow"],
  [/long ?bow/, "w:longbow"],
  [/short ?sword/, "w:shortsword"],
  [/great ?sword/, "w:greatsword"],
  [/long ?sword|arming sword/, "w:longsword"],
  [/great ?axe/, "w:greataxe"],
  [/battle ?axe/, "w:battleaxe"],
  [/hand ?axe|hatchet/, "w:handaxe"],
  [/great ?club/, "w:greatclub"],
  [/light hammer/, "w:light_hammer"],
  [/war ?hammer/, "w:warhammer"],
  [/war ?pick/, "w:war_pick"],
  [/morning ?star/, "w:morningstar"],
  [/quarter ?staff|\bstaff\b/, "w:quarterstaff"],
  [/javelin/, "w:javelin"],
  [/dagger|knife|dirk/, "w:dagger"],
  [/sickle/, "w:sickle"],
  [/\bspear\b/, "w:spear"],
  [/\bdarts?\b/, "w:dart"],
  [/\bsling\b/, "w:sling"],
  [/\bclub\b|cudgel/, "w:club"],
  [/\bmace\b/, "w:mace"],
  [/\bflail\b/, "w:flail"],
  [/glaive/, "w:glaive"],
  [/halberd/, "w:halberd"],
  [/\blance\b/, "w:lance"],
  [/\bmaul\b/, "w:maul"],
  [/\bpike\b/, "w:pike"],
  [/rapier/, "w:rapier"],
  [/scimitar/, "w:scimitar"],
  [/trident/, "w:trident"],
  [/\bwhip\b/, "w:whip"],
  [/blowgun/, "w:blowgun"],
  [/musket/, "w:musket"],
  [/pistol/, "w:pistol"],
  [/half ?plate/, "a:half_plate"],
  [/breastplate/, "a:breastplate"],
  [/\bplate( armou?r)?\b|full plate/, "a:plate"],
  [/chain ?shirt/, "a:chain_shirt"],
  [/chain ?mail/, "a:chain_mail"],
  [/scale ?mail|scale armou?r/, "a:scale_mail"],
  [/ring ?mail/, "a:ring_mail"],
  [/splint/, "a:splint"],
  [/studded leather/, "a:studded_leather"],
  [/^leather$|leather (armou?r|jerkin|cuirass)/, "a:leather"],
  [/hide armou?r|^hide$/, "a:hide"],
  [/padded( armou?r)?$/, "a:padded"],
  [/\bshield\b/, "a:shield"]
];

export type RefEntry =
  | { t: "w"; k: string; d: WeaponDef }
  | { t: "a"; k: string; d: ArmourDef }
  | { t: "ammo"; k: string; d: { name: string } };

export function refInfo(ref: unknown): RefEntry | null {
  const m = String(ref || "").match(/^(w|a|ammo):([a-z_]+)$/);
  if (!m) return null;
  const kind = m[1] as "w" | "a" | "ammo";
  const key = m[2];
  if (kind === "w" && Object.hasOwn(WEAPONS, key)) return { t: "w", k: key, d: WEAPONS[key] };
  if (kind === "a" && Object.hasOwn(ARMOUR, key)) return { t: "a", k: key, d: ARMOUR[key] };
  if (kind === "ammo" && Object.hasOwn(AMMO, key)) return { t: "ammo", k: key, d: AMMO[key] };
  return null;
}

export function refFromName(name: unknown): string | null {
  const n = String(name || "").toLowerCase().trim();
  if (!n || /\b(case|sheath|scabbard|holster|strap|polish|oil|whetstone|of the)\b/.test(n) || /^(empty )?quiver$/.test(n)) {
    return null;
  }
  for (const [re, ref] of REF_NAMES) if (re.test(n)) return ref;
  return null;
}

export function weaponProf(c: Pick<CharacterState, "cls">, w: WeaponDef): boolean {
  const tr = classRules(c).weapons;
  return tr.includes(w.cat) || (w.cat === "martial" && w.props.some(p => tr.includes("martial:" + p)));
}

export function equippedArmour(c: Pick<CharacterState, "inv">): { armour: ArmourDef | null; shield: ArmourDef | null } {
  let armour: ArmourDef | null = null;
  let shield: ArmourDef | null = null;
  for (const it of c.inv || []) {
    if (!it.eq || it.qty < 1) continue;
    const r = refInfo(it.ref);
    if (!r || r.t !== "a") continue;
    if (r.d.cat === "shield") shield = shield || r.d;
    else if (!armour || r.d.ac > armour.ac) armour = r.d;
  }
  return { armour, shield };
}

export interface ArmourClassInfo {
  ac: number;
  why: string;
  armour: ArmourDef | null;
  shield: boolean;
  untrained: boolean;
  stealthDis: boolean;
  heavySlow: boolean;
}

export function armourClass(c: Pick<CharacterState, "cls" | "abil" | "inv">): ArmourClassInfo {
  const tr = classRules(c).armour;
  const { armour, shield } = equippedArmour(c);
  const dm = mod(c.abil.dex);
  let ac: number;
  let why: string;
  if (!armour) {
    ac = 10 + dm;
    why = `No armour: 10 + Dexterity (${sign(dm)})`;
  } else if (armour.cat === "light") {
    ac = armour.ac + dm;
    why = `${armour.name} ${armour.ac} + Dexterity (${sign(dm)})`;
  } else if (armour.cat === "medium") {
    const dd = Math.min(2, dm);
    ac = armour.ac + dd;
    why = `${armour.name} ${armour.ac} + Dexterity (${sign(dd)}, at most +2 in medium armour)`;
  } else {
    ac = armour.ac;
    why = `${armour.name} ${armour.ac}; heavy armour adds no Dexterity`;
  }
  const shieldOk = !!shield && tr.includes("shield");
  if (shieldOk) {
    ac += 2;
    why += ", +2 for the shield";
  } else if (shield) {
    why += "; a shield gives nothing without shield training";
  }
  const untrained = !!armour && !tr.includes(armour.cat);
  if (untrained) why += ". Without training in this armour you have Disadvantage on Strength and Dexterity rolls";
  return {
    ac,
    why: why + ".",
    armour,
    shield: shieldOk,
    untrained,
    stealthDis: !!armour?.stealthDis,
    heavySlow: !!(armour?.str && c.abil.str < armour.str)
  };
}

export interface HeroAttackProfile {
  key: string;
  item: string | null;
  name: string;
  kind: "melee" | "ranged";
  thrown: boolean;
  abil: AbilityKey;
  abilMod: number;
  bonus: number;
  prof: boolean;
  dice: string;
  mod: number;
  type: string;
  props: string[];
  range: [number, number] | null;
  ammo: string | null;
  mastery: MasteryKey | null;
  eq: boolean;
  why: string;
  dmgText: string;
}

export function weaponAttack(
  c: Pick<CharacterState, "cls" | "level" | "abil" | "inv" | "mastery">,
  key: string,
  item?: InventoryItem | null
): HeroAttackProfile {
  const w = WEAPONS[key];
  const fin = w.props.includes("finesse");
  const ranged = w.kind === "ranged";
  const s = mod(c.abil.str);
  const dx = mod(c.abil.dex);
  const abil: AbilityKey = ranged ? "dex" : fin && dx > s ? "dex" : "str";
  const am = mod(c.abil[abil]);
  const pr = weaponProf(c, w) ? prof(c.level) : 0;
  const dice = w.versatile && !equippedArmour(c).shield ? w.versatile : w.dice;
  const why =
    `${w.name} uses ${ABIL_NAME[abil]} (${sign(am)})` +
    (fin ? ", the better of Strength and Dexterity because it's a finesse weapon" : "") +
    (pr ? `, plus your proficiency bonus (${sign(pr)}).` : `. You aren't trained with it, so no proficiency bonus.`) +
    (dice !== w.dice ? ` Held in two hands it deals ${dice}.` : "");
  return {
    key,
    item: item?.id || null,
    name: item?.name || w.name,
    kind: w.kind,
    thrown: w.props.includes("thrown"),
    abil,
    abilMod: am,
    bonus: am + pr,
    prof: !!pr,
    dice,
    mod: am,
    type: w.type,
    props: [...w.props],
    range: w.range ? [w.range[0], w.range[1]] : null,
    ammo: w.ammo || null,
    mastery: classRules(c).mastery && (c.mastery || []).includes(key) ? w.mastery : null,
    eq: !!item?.eq,
    why,
    dmgText: dice === "1" ? `${1 + am}` : `${dice} ${am >= 0 ? "+" : "−"} ${Math.abs(am)}`
  };
}

export function attacksOf(c: Pick<CharacterState, "cls" | "level" | "abil" | "inv" | "mastery">): HeroAttackProfile[] {
  const out: HeroAttackProfile[] = [];
  const seen = new Set<string>();
  const sorted = [...(c.inv || [])].sort((a, b) => Number(!!b.eq) - Number(!!a.eq));
  for (const it of sorted) {
    const r = refInfo(it.ref);
    if (!r || r.t !== "w" || it.qty < 1 || seen.has(r.k)) continue;
    seen.add(r.k);
    out.push(weaponAttack(c, r.k, it));
  }
  const s = mod(c.abil.str);
  const p = prof(c.level);
  out.push({
    key: "unarmed",
    item: null,
    name: "Unarmed strike",
    kind: "melee",
    thrown: false,
    abil: "str",
    abilMod: s,
    bonus: s + p,
    prof: true,
    dice: "1",
    mod: s,
    type: "bludgeoning",
    props: [],
    range: null,
    ammo: null,
    mastery: null,
    eq: false,
    why: `An unarmed strike uses Strength (${sign(s)}) plus proficiency (${sign(p)}) and deals 1 + Strength.`,
    dmgText: String(Math.max(0, 1 + s))
  });
  return out;
}

export function syncChar<T extends Pick<CharacterState, "ac" | "cls" | "abil" | "inv">>(c: T): T {
  c.ac = armourClass(c).ac;
  return c;
}

export interface HeroTemplate extends Omit<CharacterState, "inv"> {
  inv: Array<Omit<InventoryItem, "id">>;
  blurb: string;
}

export const HEROES: Readonly<Record<"fighter" | "rogue", HeroTemplate>> = deepFreeze({
  fighter: {
    name: "Edda Vane",
    species: "Human",
    cls: "Fighter",
    bg: "Soldier",
    appearance: "Weathered veteran with braided dark hair, scarred brow, worn chain mail and an iron-rimmed shield.",
    level: 1,
    xp: 0,
    hp: 12,
    maxHp: 12,
    ac: 18,
    speed: 9,
    abil: { str: 16, dex: 14, con: 15, int: 10, wis: 12, cha: 8 },
    skills: ["athletics", "perception", "intimidation", "survival"],
    expertise: [],
    saves: ["str", "con"],
    hd: { die: 10, max: 1, left: 1 },
    gold: 15,
    conditions: [],
    dying: null,
    mastery: ["longsword", "javelin", "battleaxe"],
    res: { second_wind: { left: 2, max: 2 } },
    inv: [
      { name: "Longsword", note: "1d8 + 3 slashing", qty: 1, eq: true, ref: "w:longsword" },
      { name: "Shield", note: "+2 AC", qty: 1, eq: true, ref: "a:shield" },
      { name: "Chain mail", note: "AC 16", qty: 1, eq: true, ref: "a:chain_mail" },
      { name: "Javelin", note: "1d6 + 3, thrown 9 m", qty: 4, ref: "w:javelin" },
      { name: "Potion of healing", note: "Heals 2d4 + 2", qty: 1 },
      { name: "Rope, hempen", note: "15 m", qty: 1 },
      { name: "Torch", note: "1 hour of light", qty: 5 },
      { name: "Rations", note: "1 day each", qty: 5 },
      { name: "Waterskin", note: "", qty: 1 }
    ],
    blurb: "Armoured, steady, hard to kill. The easiest way to learn."
  },
  rogue: {
    name: "Wren Ashby",
    species: "Halfling",
    cls: "Rogue",
    bg: "Criminal",
    appearance: "Quick-eyed halfling in travel-stained dark leather and a hooded cloak, twin daggers tucked at the belt.",
    level: 1,
    xp: 0,
    hp: 10,
    maxHp: 10,
    ac: 14,
    speed: 9,
    abil: { str: 8, dex: 16, con: 14, int: 12, wis: 13, cha: 10 },
    skills: ["stealth", "sleight_of_hand", "acrobatics", "perception", "deception", "investigation"],
    expertise: ["stealth", "sleight_of_hand"],
    saves: ["dex", "int"],
    hd: { die: 8, max: 1, left: 1 },
    gold: 16,
    conditions: [],
    dying: null,
    mastery: ["shortsword", "shortbow"],
    res: {},
    inv: [
      { name: "Shortsword", note: "1d6 + 3 piercing", qty: 1, eq: true, ref: "w:shortsword" },
      { name: "Shortbow", note: "1d6 + 3, range 24 m", qty: 1, ref: "w:shortbow" },
      { name: "Arrows", note: "", qty: 20, ref: "ammo:arrows" },
      { name: "Dagger", note: "1d4 + 3, thrown 6 m", qty: 2, ref: "w:dagger" },
      { name: "Leather armour", note: "AC 11 + DEX", qty: 1, eq: true, ref: "a:leather" },
      { name: "Thieves' tools", note: "Pick locks, disarm traps", qty: 1 },
      { name: "Potion of healing", note: "Heals 2d4 + 2", qty: 1 },
      { name: "Rope, hempen", note: "15 m", qty: 1 },
      { name: "Rations", note: "1 day each", qty: 5 }
    ],
    blurb: "Quick, quiet, skilled. Talks or sneaks past trouble."
  }
});

export const TONES: readonly string[] = deepFreeze([
  "Grounded low fantasy",
  "Heroic high fantasy",
  "Dark and grim",
  "Light-hearted adventure"
]);

export const DEFAULT_SETTING = deepFreeze({
  premise:
    "Brookhollow, a river village at the edge of an old forest. Livestock has been vanishing at night and the miller's son went missing three days ago.",
  tone: TONES[0]
});

/* Seeded XP & Loot Rewards */
const DEFEATED_STATUSES = ["dead", "out", "surrendered"];

function lootRng(seed: number): () => number {
  return seededRng(((Number(seed) >>> 0) ^ 0x5bd1e995) >>> 0);
}

function lootDice(expr: string, rnd: () => number): number {
  const m = String(expr).replace(/\s/g, "").match(/^(\d+)d(\d+)([+-]\d+)?$|^(\d+)$/);
  if (!m) return 0;
  if (m[4]) return +m[4];
  let t = +(m[3] || 0);
  for (let i = 0; i < +m[1]; i++) t += 1 + Math.floor(rnd() * +m[2]);
  return Math.max(0, t);
}

export interface OutcomeFoeSummary {
  id: string;
  ref: string;
  baseRef?: string;
  name: string;
  status: string;
  npcId?: string | null;
}

export interface FightReward {
  xp: number;
  gold: number;
  items: Array<{ name: string; qty: number }>;
}

export function fightReward(
  out: { foes?: OutcomeFoeSummary[] } | null | undefined,
  result: string,
  seed: number
): FightReward {
  const defeated = arr<OutcomeFoeSummary>(out?.foes, f => {
    const base = f.baseRef || f.ref;
    return DEFEATED_STATUSES.includes(f.status) && Object.hasOwn(MONSTERS, base);
  });
  const xp = defeated.reduce((n, f) => n + MONSTERS[f.baseRef || f.ref].xp, 0);
  if (result !== "victory") return { xp, gold: 0, items: [] };
  const rnd = lootRng(seed);
  const items: Record<string, number> = {};
  let gold = 0;
  for (const f of defeated) {
    const base = f.baseRef || f.ref;
    const t = LOOT[base];
    if (!t) continue;
    gold += lootDice(t.gold, rnd);
    for (const [chance, name, q] of t.items) {
      if (rnd() * 100 < chance) {
        items[name] = (items[name] || 0) + Math.max(1, lootDice(q, rnd));
      }
    }
  }
  return {
    xp,
    gold,
    items: Object.entries(items).map(([name, qty]) => ({ name, qty: Math.min(99, qty) }))
  };
}

const ITEM_WEIGHT_RULES: Array<[RegExp, number]> = [
  [/\bplate\b|splint/, 25],
  [/chain ?mail|ring ?mail|scale ?mail/, 20],
  [/half ?plate/, 18],
  [/breastplate|chain ?shirt/, 9],
  [/hide|studded leather|leather/, 5],
  [/padded/, 3.5],
  [/\bshield\b/, 2.7],
  [/greatsword|greataxe|maul|pike|halberd|glaive|lance|greatclub/, 3],
  [/longsword|battleaxe|warhammer|flail|morningstar|rapier|scimitar|trident|quarterstaff|staff|crossbow|longbow|musket/, 1.5],
  [/shortsword|shortbow|handaxe|javelin|mace|spear|sickle|whip|pistol/, 1],
  [/dagger|knife|dart|sling/, 0.4],
  [/arrows?|bolts?|needles?/, 0.05],
  [/backpack|pack|bedroll|tent/, 2.5],
  [/rope|crowbar|lantern/, 1.5],
  [/ration|waterskin|torch|book|tome|journal|potion|vial|flask/, 0.5],
  [/key|coin|ring|amulet|gem|scroll|parchment|letter/, 0.1]
];

/** Estimate single-unit item weight in kilograms for items without an explicit weight. */
export function estimateItemWeightKg(name: string, note = ""): number {
  const hay = `${name} ${note}`.toLowerCase();
  for (const [re, kg] of ITEM_WEIGHT_RULES) {
    if (re.test(hay)) return kg;
  }
  return 0.5;
}

/** Total weight in kilograms for an inventory stack (unit weight * qty). */
export function itemWeightKg(item: Pick<InventoryItem, "name" | "note" | "qty" | "weightKg">): number {
  const unit = typeof item.weightKg === "number" && item.weightKg >= 0
    ? item.weightKg
    : estimateItemWeightKg(item.name, item.note);
  return Math.round(unit * Math.max(1, item.qty || 1) * 10) / 10;
}

/** Total carried load in kilograms across all inventory items. */
export function totalCarryWeightKg(inv: ReadonlyArray<Pick<InventoryItem, "name" | "note" | "qty" | "weightKg">>): number {
  const sum = inv.reduce((acc, it) => acc + itemWeightKg(it), 0);
  return Math.round(sum * 10) / 10;
}

/** 5e carrying capacity (15 lb per STR) converted to rounded kilograms (109 kg at STR 16). */
export function carryCapacityKg(strScore: number): number {
  return Math.max(15, Math.round(Math.max(1, strScore) * 15 * 0.453592));
}

/** Record previous HP into a rolling 3-entry trail whenever HP changes. */
export function recordHpTrail(char: Pick<CharacterState, "hp" | "maxHp" | "hpTrail">, prevHp: number): void {
  if (prevHp === char.hp) return;
  const base = Array.isArray(char.hpTrail) && char.hpTrail.length
    ? [...char.hpTrail]
    : [prevHp];
  if (base[base.length - 1] !== prevHp) base.push(prevHp);
  base.push(char.hp);
  char.hpTrail = base.slice(-3);
}
