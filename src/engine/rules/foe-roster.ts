/* Campaign Foe Roster & Named NPC Combat Sync.
   Maps campaign-flavoured FoeTemplates onto balanced SRD 5.2 stat blocks,
   and updates named NPC entities when fights conclude (fixing PT-030). */

import { isObj, slug, str } from "../util";
import { MONSTERS, type MonsterDef, type MonsterMorale } from "./srd";

export interface FoeTemplate {
  id: string;
  baseRef: string;
  name: string;
  weaponNames?: Record<string, string>;
  morale?: MonsterMorale;
  description?: string;
  npcId?: string;
}

export const FOE_ALIAS: Readonly<Record<string, string>> = {
  goblin: "goblin_warrior",
  rat: "giant_rat",
  boss: "goblin_boss",
  skeleton: "skeleton",
  undead: "zombie",
  thug: "bandit",
  brigand: "bandit",
  pirate: "bandit",
  smuggler: "bandit",
  highwayman: "bandit",
  soldier: "guard",
  watchman: "guard",
  knight: "guard",
  priest: "acolyte",
  fanatic: "cultist",
  archer: "scout",
  ranger: "scout",
  assassin: "spy",
  cutthroat: "spy",
  spider: "giant_spider",
  armour: "animated_armour",
  armor: "animated_armour",
  mage: "mage_apprentice",
  wizard: "mage_apprentice"
};

export function cleanFoeTemplate(raw: unknown): FoeTemplate | null {
  if (!isObj(raw)) return null;
  const baseRaw = String(raw.baseRef ?? raw.base ?? "").toLowerCase().trim().replace(/\s+/g, "_");
  const baseRef = Object.hasOwn(MONSTERS, baseRaw) ? baseRaw : FOE_ALIAS[baseRaw] || null;
  const name = str(raw.name, 40);
  if (!baseRef || !name) return null;
  const id = str(raw.id, 40).toLowerCase().replace(/[^a-z0-9_]+/g, "_") || slug(name).replace(/-/g, "_");
  const weaponNames: Record<string, string> = {};
  if (isObj(raw.weaponNames)) {
    for (const [k, v] of Object.entries(raw.weaponNames)) {
      const wn = str(v, 36);
      if (wn) weaponNames[str(k, 36)] = wn;
    }
  }
  const morale: MonsterMorale | undefined = ["coward", "normal", "fearless"].includes(raw.morale)
    ? raw.morale
    : undefined;
  return {
    id,
    baseRef,
    name,
    weaponNames: Object.keys(weaponNames).length ? weaponNames : undefined,
    morale,
    description: raw.description ? str(raw.description, 140) : undefined,
    npcId: raw.npcId ? str(raw.npcId, 50) : undefined
  };
}

/** Resolves either a canonical SRD monster key or a campaign FoeTemplate into an effective MonsterDef. */
export function resolveMonsterDef(
  ref: string,
  foeRoster?: Record<string, FoeTemplate> | null
): (MonsterDef & { baseRef: string }) | null {
  if (foeRoster && Object.hasOwn(foeRoster, ref)) {
    const tpl = foeRoster[ref];
    if (Object.hasOwn(MONSTERS, tpl.baseRef)) {
      const m = MONSTERS[tpl.baseRef];
      return {
        ...m,
        baseRef: tpl.baseRef,
        name: tpl.name || m.name,
        morale: tpl.morale || m.morale,
        attacks: m.attacks.map(a => ({
          ...a,
          name: tpl.weaponNames?.[a.name] || a.name
        }))
      };
    }
  }
  if (Object.hasOwn(MONSTERS, ref)) {
    return { ...MONSTERS[ref], baseRef: ref };
  }
  return null;
}

/** Maps a narrator phrase to a valid SRD key or campaign FoeTemplate key. */
export function resolveFoeRef(
  phrase: unknown,
  foeRoster?: Record<string, FoeTemplate> | null
): string | null {
  const p = String(phrase || "")
    .toLowerCase()
    .replace(/[^a-z0-9_ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!p) return null;
  const key = p.replace(/ /g, "_");
  const sing = p.replace(/ves$/, "f").replace(/s$/, "");
  const singKey = sing.replace(/ /g, "_");

  if (foeRoster) {
    if (Object.hasOwn(foeRoster, key)) return key;
    if (Object.hasOwn(foeRoster, singKey)) return singKey;
    for (const [k, tpl] of Object.entries(foeRoster)) {
      const n = tpl.name.toLowerCase();
      if (n === p || n === sing) return k;
    }
  }

  if (Object.hasOwn(MONSTERS, key)) return key;
  for (const [k, m] of Object.entries(MONSTERS)) {
    const n = m.name.toLowerCase();
    if (n === p || n === sing || k === singKey) return k;
  }
  return FOE_ALIAS[p] || FOE_ALIAS[sing] || null;
}
