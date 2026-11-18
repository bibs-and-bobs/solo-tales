/* Dual Narrator Event Reducer (Typed JSON Event Objects + Legacy String Fallback)
   and Combat-Start Proposal Parser with Foe Roster & Named NPC Linking. */

import { attWord, clamp, clone, isObj, nice, rid, slug, str } from "../util";
import { CONDITIONS, type ConditionKey } from "../rules/srd";
import { recordHpTrail, refFromName, syncChar, type InventoryItem } from "../rules/character";
import { resolveFoeRef, resolveMonsterDef, type FoeTemplate } from "../rules/foe-roster";
import { advanceClocksOnTime, avertClock, findClock, revealClock, tickClock } from "./clocks";
import { aboutOf, knows, type WorldEntity } from "./knowledge";
import type { CampaignBundle, LogEntry, NarratorEvent, TypedNarratorEvent } from "./types";

export interface TxContext {
  label: string;
  timeSet: boolean;
  dmg: number;
  after: Array<() => void>;
}

export function findItem(bundle: CampaignBundle, name: unknown): InventoryItem | null {
  const n = String(name || "").toLowerCase().trim();
  if (!n) return null;
  const inv = bundle.campaign.char.inv;
  return (
    inv.find(i => i.name.toLowerCase() === n) ||
    (n.length >= 3
      ? inv.find(i => {
          const m = i.name.toLowerCase();
          return m.length >= 3 && (m.includes(n) || n.includes(m));
        })
      : null) ||
    null
  );
}

export function npcByName(entities: Record<string, WorldEntity>, name: unknown): WorldEntity | null {
  const n = String(name || "").toLowerCase().trim();
  if (!n) return null;
  const npcs = Object.values(entities).filter(e => e.kind === "npc");
  const exact = npcs.find(e => e.name.toLowerCase() === n);
  if (exact) return exact;
  const first = n.split(" ")[0];
  if (first.length < 3) return null;
  const hits = npcs.filter(e => e.name.toLowerCase().split(" ")[0] === first);
  return hits.length === 1 ? hits[0] : null;
}

export function ensureNpc(
  bundle: CampaignBundle,
  name: unknown,
  role?: string,
  att?: number,
  appearance?: string
): WorldEntity {
  const nm = str(name, 40);
  if (!nm) throw new Error("npc without a name");
  let e = npcByName(bundle.entities, nm);
  if (!e) {
    let id = "npc_" + slug(nm);
    while (bundle.entities[id]) id = "npc_" + slug(nm) + "_" + rid().slice(0, 3);
    e = {
      id,
      kind: "npc",
      name: nm,
      role: str(role, 60) || "stranger",
      appearance: appearance ? str(appearance, 220) : undefined,
      att: att ?? 0,
      loc: bundle.campaign.place,
      seen: bundle.campaign.turn,
      met: bundle.campaign.turn
    };
    bundle.entities[id] = e;
    bundle.unread.journal = true;
  } else {
    if (role) e.role = str(role, 60);
    if (appearance && !e.appearance) e.appearance = str(appearance, 220);
    if (att != null) e.att = att;
    if (e.combatStatus !== "dead") {
      e.loc = bundle.campaign.place;
      e.seen = bundle.campaign.turn;
    }
  }
  bundle.dirty.e.add(e.id);
  return e;
}

export function advanceTimeInBundle(
  bundle: CampaignBundle,
  minutes: number,
  chips?: Array<[string, string]>
): void {
  if (minutes <= 0) return;
  bundle.campaign.time += minutes;
  const clkRes = advanceClocksOnTime(bundle.clocks, minutes);
  for (const id of [...clkRes.tickedIds, ...clkRes.triggeredIds]) bundle.dirty.k.add(id);
  if (chips && clkRes.chips.length) chips.push(...clkRes.chips);
  if (clkRes.triggeredIds.length) bundle.unread.journal = true;
}

export function applyHeroDamage(
  bundle: CampaignBundle,
  n: number,
  chips: Array<[string, string]>,
  tx?: TxContext | null
): void {
  const c = bundle.campaign.char;
  const curDmg = tx ? tx.dmg : 0;
  const cap = (c.level <= 4 ? 14 : 28) - curDmg;
  n = clamp(n, 0, Math.max(0, cap));
  if (tx) tx.dmg += n;
  if (!n) return;
  if (c.hp === 0 && c.dying) {
    c.dying.f = Math.min(3, c.dying.f + 1);
    chips.push(["Hit while down: a death save failure", "hurt"]);
    return;
  }
  const before = c.hp;
  const left = c.hp - n;
  if (left <= 0 && -left >= c.maxHp) {
    c.hp = 0;
    recordHpTrail(c, before);
    c.status = "dead-massive";
    chips.push([`-${n} HP`, "hurt"]);
    return;
  }
  c.hp = Math.max(0, left);
  recordHpTrail(c, before);
  chips.push([`-${n} HP`, "hurt"]);
  if (c.hp === 0 && !c.dying) c.dying = { s: 0, f: 0 };
}

export function applyHeroHeal(
  bundle: CampaignBundle,
  n: number,
  chips: Array<[string, string]>
): void {
  const c = bundle.campaign.char;
  if (n <= 0) return;
  const before = c.hp;
  c.hp = Math.min(c.maxHp, c.hp + n);
  recordHpTrail(c, before);
  if (c.dying) {
    c.dying = null;
    c.conditions = c.conditions.filter(x => x !== "unconscious");
  }
  chips.push([`+${c.hp - before} HP`, "heal"]);
}

export function revealFactInBundle(
  bundle: CampaignBundle,
  factId: string,
  chips: Array<[string, string]>
): void {
  const f = bundle.facts[factId];
  if (!f || knows(f)) return;
  f.known = [...f.known, "player"];
  bundle.dirty.f.add(f.id);
  bundle.unread.journal = true;
  chips.push([
    "New knowledge: " + (f.text.length > 48 ? f.text.slice(0, 46) + "…" : f.text),
    ""
  ]);
}

export function foeSummary(
  foes: Array<{ ref: string; n: number; name?: string | null }>,
  foeRoster?: Record<string, FoeTemplate> | null
): string {
  return foes
    .map(f => {
      const def = resolveMonsterDef(f.ref, foeRoster);
      const nm = f.name || def?.name || f.ref;
      return `${nm}${f.n > 1 ? " ×" + f.n : ""}`;
    })
    .join(", ");
}

export function parseCombatStart(
  arg: string,
  foeRoster?: Record<string, FoeTemplate> | null,
  entities?: Record<string, WorldEntity>
) {
  const squares = (s: string): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (const m of String(s).matchAll(/(\d+)\s*[,:]\s*(\d+)(?:\s*-\s*(\d+)\s*[,:]\s*(\d+))?/g)) {
      const a: [number, number] = [+m[1], +m[2]];
      const b: [number, number] = m[3] ? [+m[3], +m[4]] : a;
      const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      for (let i = 0; i <= n && out.length < 60; i++) {
        out.push([a[0] + Math.sign(b[0] - a[0]) * i, a[1] + Math.sign(b[1] - a[1]) * i]);
      }
    }
    return out;
  };
  const foes: Array<{
    ref: string;
    n: number;
    at: Array<[number, number] | null>;
    name?: string | null;
    npcId?: string | null;
  }> = [];
  const bad: string[] = [];
  const map = {
    w: 12,
    h: 12,
    wall: [] as Array<[number, number]>,
    rough: [] as Array<[number, number]>,
    cover: [] as Array<[number, number]>
  };
  let hero: [number, number] | null = null;
  let surprise: "pc" | "foes" | null = null;

  for (const seg of String(arg || "").split("|")) {
    const t = seg.toLowerCase().trim();
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^(?:map|grid)\D*(\d+)\s*(?:x|by)\s*(\d+)/))) {
      map.w = clamp(+m[1], 6, 20);
      map.h = clamp(+m[2], 6, 20);
    } else if (/^(hero|player|pc|you)\b/.test(t)) {
      hero = squares(t)[0] || null;
    } else if ((m = t.match(/^(wall|block|rough|difficult|cover)/))) {
      const targetKey = m[1] === "cover" ? "cover" : /^[wb]/.test(m[1]) ? "wall" : "rough";
      map[targetKey].push(...squares(t));
    } else if ((m = t.match(/surpris\w*\s*:?\s*(player|you|hero|pc|foes?|them|enemies|monsters)/))) {
      surprise = /^(player|you|hero|pc)$/.test(m[1]) ? "pc" : "foes";
    } else {
      for (const part of seg.replace(/(\d)\s*,\s*(\d)/g, "$1:$2").split(/[,;]|\band\b/i)) {
        const at = squares(part);
        let p = part.replace(/\d+:\d+(-\d+:\d+)?/g, " ").trim();
        let n = 1;
        if (!p) continue;
        p = p.replace(/\bx\s*(\d+)\b|\b(\d+)\s*x\b|^(\d+)\b/i, (_s, a, b, c) => {
          n = +(a || b || c) || 1;
          return " ";
        });
        const cleanedPhrase = p.replace(/\b(at|in|on|the|a|an|engaged|near|far)\b/gi, " ").trim();
        // Allow "Aldric (bandit)" or direct NPC lookup
        const parenMatch = cleanedPhrase.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        const rawRefText = parenMatch ? parenMatch[2] : cleanedPhrase;
        const rawNameCandidate = parenMatch ? parenMatch[1].trim() : cleanedPhrase;
        let ref = resolveFoeRef(rawRefText, foeRoster);
        const matchedNpc = entities ? npcByName(entities, rawNameCandidate) : null;
        if (!ref && matchedNpc) {
          ref = resolveFoeRef(matchedNpc.role || "bandit", foeRoster) || "bandit";
        }
        if (!ref) {
          bad.push(str(part, 40));
          continue;
        }
        n = clamp(Math.max(n, at.length), 1, 8);
        const sq = Array.from({ length: n }, (_, i) => at[i] || null);
        if (matchedNpc && n === 1) {
          foes.push({ ref, n: 1, at: sq, name: matchedNpc.name, npcId: matchedNpc.id });
        } else {
          const same = foes.find(f => f.ref === ref && !f.npcId);
          if (same) {
            same.at = [...same.at, ...sq].slice(0, 8);
            same.n = same.at.length;
          } else {
            foes.push({ ref, n, at: sq });
          }
        }
      }
    }
  }
  return { foes: foes.slice(0, 6), map, hero, surprise, bad };
}

export function startCombatInBundle(
  bundle: CampaignBundle,
  specInput: string | Extract<TypedNarratorEvent, { type: "combat_start" }>,
  chips: Array<[string, string]>
): void {
  const G = bundle.campaign;
  if (G.combat) throw new Error("a fight is already running");
  if (G.status !== "active" || G.char.dying || G.char.hp <= 0) {
    throw new Error("the hero can't fight right now");
  }
  let parsed: ReturnType<typeof parseCombatStart>;
  if (typeof specInput === "string") {
    parsed = parseCombatStart(specInput, bundle.foeRoster, bundle.entities);
  } else if (specInput.spec) {
    parsed = parseCombatStart(specInput.spec, bundle.foeRoster, bundle.entities);
  } else {
    const mp = specInput.map || {};
    const foes: ReturnType<typeof parseCombatStart>["foes"] = [];
    for (const f of specInput.foes || []) {
      const npc =
        (f.npcId && bundle.entities[f.npcId]) ||
        (f.name ? npcByName(bundle.entities, f.name) : null);
      const ref =
        resolveFoeRef(f.ref, bundle.foeRoster) ||
        (npc ? resolveFoeRef(npc.role || "bandit", bundle.foeRoster) || "bandit" : null);
      if (!ref) continue;
      const n = clamp(Math.round(Number(f.count) || f.at?.length || 1), 1, 8);
      const sq = Array.from({ length: n }, (_, i) =>
        Array.isArray(f.at?.[i]) ? ([f.at![i][0], f.at![i][1]] as [number, number]) : null
      );
      foes.push({
        ref,
        n,
        at: sq,
        name: n === 1 ? f.name || npc?.name || null : null,
        npcId: n === 1 ? npc?.id || f.npcId || null : null
      });
    }
    parsed = {
      foes: foes.slice(0, 6),
      map: {
        w: clamp(Math.round(Number(mp.w) || 12), 6, 20),
        h: clamp(Math.round(Number(mp.h) || 12), 6, 20),
        wall: (mp.wall || []).slice(0, 60),
        rough: (mp.rough || []).slice(0, 60),
        cover: (mp.cover || []).slice(0, 60)
      },
      hero: Array.isArray(specInput.hero) ? [specInput.hero[0], specInput.hero[1]] : null,
      surprise:
        specInput.surprise === "pc" || specInput.surprise === "foes" ? specInput.surprise : null,
      bad: []
    };
  }

  if (!parsed.foes.length) {
    throw new Error("no known monster in combat_start");
  }
  G.combat = {
    v: 1,
    id: rid(),
    phase: "init",
    spec: {
      foes: parsed.foes,
      map: parsed.map,
      hero: parsed.hero,
      surprise: parsed.surprise
    },
    seed: (Math.floor(Math.random() * 4294967296) >>> 0) || 1,
    cs: null,
    feed: [],
    roll: null,
    ruling: null,
    result: null,
    chips: [],
    started: G.turn + 1,
    place: G.place,
    dead: false,
    reward: null
  };
  chips.push(["Fight: " + foeSummary(parsed.foes, bundle.foeRoster), "hurt"]);
}

function recordFactOrSecret(
  bundle: CampaignBundle,
  verb: "fact" | "secret",
  holderName: string | null,
  rawText: string,
  truth: boolean,
  chips: Array<[string, string]>
): void {
  const holder = verb === "secret" ? npcByName(bundle.entities, holderName) : null;
  if (verb === "secret" && !holder) {
    throw new Error("secret held by nobody known: " + str(holderName, 40));
  }
  const text = str(rawText, 220);
  if (!text) return;
  const same = Object.values(bundle.facts).find(f => f.text.toLowerCase() === text.toLowerCase());
  if (same) {
    if (verb === "fact" && !knows(same)) revealFactInBundle(bundle, same.id, chips);
    else if (holder && !same.known.includes(holder.id)) {
      same.known.push(holder.id);
      bundle.dirty.f.add(same.id);
    }
    return;
  }
  let id: string;
  do id = "fact_" + rid().slice(0, 5);
  while (bundle.facts[id]);
  bundle.facts[id] = {
    id,
    text,
    turn: bundle.campaign.turn,
    place: bundle.campaign.place,
    pinned: false,
    about: aboutOf(text, bundle.entities),
    known: [holder ? holder.id : "player"],
    truth
  };
  bundle.dirty.f.add(id);
  if (!holder) {
    bundle.unread.journal = true;
    chips.push(["New knowledge: " + (text.length > 48 ? text.slice(0, 46) + "…" : text), ""]);
  }
}

/** Applies a single Typed JSON event OR legacy string event. Returns false if unknown verb. */
export function applyEvent(
  bundle: CampaignBundle,
  raw: NarratorEvent,
  chips: Array<[string, string]>,
  tx?: TxContext | null
): boolean {
  const G = bundle.campaign;
  const c = G.char;
  const L = c.level;

  // 1. Typed JSON Event Object
  if (isObj(raw) && typeof raw.type === "string") {
    const ev = raw as TypedNarratorEvent;
    switch (ev.type) {
      case "hp": {
        const num = Math.round(Number(ev.amount));
        if (Number.isFinite(num) && num !== 0) {
          if (num < 0) applyHeroDamage(bundle, Math.min(-num, L <= 4 ? 12 : 24), chips, tx);
          else applyHeroHeal(bundle, Math.min(num, c.maxHp), chips);
        }
        return true;
      }
      case "gold": {
        const num = Math.round(Number(ev.amount));
        if (Number.isFinite(num) && num !== 0) {
          const v = num > 0 ? Math.min(num, 50 * L) : Math.max(num, -c.gold);
          if (v) {
            c.gold += v;
            chips.push([(v > 0 ? "+" : "") + v + " gold", v > 0 ? "loot" : ""]);
          }
        }
        return true;
      }
      case "xp": {
        const num = Math.round(Number(ev.amount));
        if (Number.isFinite(num) && num > 0) {
          const v = Math.min(num, 100 * L);
          c.xp += v;
          chips.push([`+${v} XP`, "loot"]);
        }
        return true;
      }
      case "item_add": {
        const name = str(ev.name, 40);
        if (!name) return true;
        const q = clamp(Math.round(Number(ev.qty) || 1), 1, 99);
        const ex = findItem(bundle, name);
        if (ex && ex.name.toLowerCase() === name.toLowerCase()) {
          ex.qty = Math.min(999, ex.qty + q);
        } else {
          c.inv.push({ id: rid(), name, note: str(ev.note, 60), qty: q, ref: refFromName(name) });
        }
        chips.push([`+ ${name}${q > 1 ? " x" + q : ""}`, "loot"]);
        return true;
      }
      case "item_remove": {
        const it = findItem(bundle, str(ev.name, 40));
        if (!it) return true;
        const q = clamp(Math.round(Number(ev.qty) || 1), 1, 99);
        it.qty -= q;
        if (it.qty <= 0) c.inv = c.inv.filter(x => x !== it);
        syncChar(c);
        chips.push([`- ${it.name}${q > 1 ? " x" + q : ""}`, ""]);
        return true;
      }
      case "move": {
        const name = str(ev.place, 50);
        if (!name) return true;
        const id = "place_" + slug(name);
        if (!bundle.entities[id]) {
          bundle.entities[id] = { id, kind: "place", name, desc: str(ev.desc, 160), first: G.turn };
        } else if (ev.desc && !bundle.entities[id].desc) {
          bundle.entities[id].desc = str(ev.desc, 160);
        }
        bundle.entities[id].visited = G.turn;
        bundle.dirty.e.add(id);
        if (G.place !== id) {
          G.place = id;
          chips.push([`Now at ${name}`, ""]);
        }
        return true;
      }
      case "time": {
        const mins = clamp(Math.round(Number(ev.minutes) || 0), 1, 7 * 1440);
        advanceTimeInBundle(bundle, mins, chips);
        if (tx) tx.timeSet = true;
        return true;
      }
      case "npc": {
        if (!ev.name) return true;
        const aw = String(ev.attitude || "").toLowerCase();
        const att = aw.startsWith("friend") ? 1 : aw.startsWith("host") ? -1 : aw ? 0 : undefined;
        const isNew = !npcByName(bundle.entities, ev.name);
        const e = ensureNpc(bundle, ev.name, ev.role, att, ev.appearance);
        if (isNew) chips.push(["Met " + e.name, ""]);
        return true;
      }
      case "attitude": {
        const e = npcByName(bundle.entities, ev.name);
        if (!e) return true;
        const before = attWord(e.att ?? 0);
        e.att = clamp((e.att ?? 0) + clamp(Math.round(Number(ev.delta) || 0), -1, 1), -3, 3);
        bundle.dirty.e.add(e.id);
        if (attWord(e.att) !== before) chips.push([`${e.name} is now ${attWord(e.att)}`, ""]);
        return true;
      }
      case "leaves": {
        const e = npcByName(bundle.entities, ev.name);
        if (e) {
          e.loc = null;
          bundle.dirty.e.add(e.id);
        }
        return true;
      }
      case "fact": {
        recordFactOrSecret(bundle, "fact", null, ev.text, ev.truth !== false, chips);
        return true;
      }
      case "secret": {
        recordFactOrSecret(bundle, "secret", ev.holder, ev.text, ev.truth !== false, chips);
        return true;
      }
      case "reveal": {
        const f = bundle.facts[String(ev.factId || "").trim()];
        if (!f) throw new Error("no such fact: " + str(ev.factId, 40));
        revealFactInBundle(bundle, f.id, chips);
        return true;
      }
      case "entity": {
        const kind = String(ev.kind || "").toLowerCase();
        if (!["item", "faction", "lore"].includes(kind)) {
          throw new Error("entity needs a kind: item, faction or lore");
        }
        const name = str(ev.name, 50);
        if (!name) return true;
        let e = Object.values(bundle.entities).find(
          x => x.kind === kind && x.name.toLowerCase() === name.toLowerCase()
        );
        if (!e) {
          let id = kind + "_" + slug(name);
          while (bundle.entities[id]) id = kind + "_" + slug(name) + "_" + rid().slice(0, 3);
          e = bundle.entities[id] = {
            id,
            kind: kind as "item" | "faction" | "lore",
            name,
            desc: str(ev.desc, 160),
            loc: kind === "item" ? G.place : null,
            seen: G.turn
          };
          bundle.unread.journal = true;
          chips.push(["Noted: " + name, ""]);
        } else {
          if (ev.desc) e.desc = str(ev.desc, 160);
          e.seen = G.turn;
        }
        bundle.dirty.e.add(e.id);
        return true;
      }
      case "quest_new": {
        const title = str(ev.title, 60);
        if (!title || G.quests.some(q => q.title.toLowerCase() === title.toLowerCase())) return true;
        G.quests.push({ id: rid(), title, obj: str(ev.obj, 140), status: "active", turn: G.turn });
        bundle.unread.quests = true;
        chips.push(["New quest: " + title, "loot"]);
        return true;
      }
      case "quest_update": {
        const q = G.quests.find(x => x.title.toLowerCase() === str(ev.title, 60).toLowerCase());
        if (q && ev.obj) {
          q.obj = str(ev.obj, 140);
          bundle.unread.quests = true;
          chips.push(["Quest updated", ""]);
        }
        return true;
      }
      case "quest_done":
      case "quest_fail": {
        const q = G.quests.find(x => x.title.toLowerCase() === str(ev.title, 60).toLowerCase());
        if (q && q.status === "active") {
          q.status = ev.type === "quest_done" ? "done" : "failed";
          bundle.unread.quests = true;
          chips.push([
            (ev.type === "quest_done" ? "Quest complete: " : "Quest failed: ") + q.title,
            ev.type === "quest_done" ? "loot" : "hurt"
          ]);
        }
        return true;
      }
      case "condition": {
        const k = String(ev.condition || "").toLowerCase() as ConditionKey;
        if (CONDITIONS.includes(k) && !c.conditions.includes(k)) {
          c.conditions.push(k);
          chips.push([nice(k), "hurt"]);
        }
        return true;
      }
      case "condition_end": {
        const k = String(ev.condition || "").toLowerCase() as ConditionKey;
        if (c.conditions.includes(k)) {
          c.conditions = c.conditions.filter(x => x !== k);
          chips.push(["No longer " + k, "heal"]);
        }
        return true;
      }
      case "clock_reveal": {
        const clk = findClock(bundle.clocks, ev.clockId);
        if (!clk) throw new Error("no such clock: " + str(ev.clockId, 40));
        revealClock(clk, G.turn, ev.source, chips);
        bundle.dirty.k.add(clk.id);
        bundle.unread.journal = true;
        return true;
      }
      case "clock_tick": {
        const clk = findClock(bundle.clocks, ev.clockId);
        if (!clk) throw new Error("no such clock: " + str(ev.clockId, 40));
        tickClock(clk, clamp(Math.round(Number(ev.delta ?? 1)), -4, 4), chips);
        bundle.dirty.k.add(clk.id);
        return true;
      }
      case "clock_avert": {
        const clk = findClock(bundle.clocks, ev.clockId);
        if (!clk) throw new Error("no such clock: " + str(ev.clockId, 40));
        avertClock(clk, chips);
        bundle.dirty.k.add(clk.id);
        return true;
      }
      case "combat_start": {
        startCombatInBundle(bundle, ev, chips);
        return true;
      }
      default:
        return false;
    }
  }

  // 2. Legacy Pipe-Delimited String Event Fallback
  const m = String(raw).match(/^\s*([a-z_]+):?\s*(.*)$/i);
  if (!m) return false;
  const verb = m[1].toLowerCase();
  const arg = m[2].trim();
  const parts = arg.split("|").map(s => s.trim());
  const num = parseInt(arg.replace(/\s/g, ""), 10);

  switch (verb) {
    case "hp":
      if (!isNaN(num)) {
        if (num < 0) applyHeroDamage(bundle, Math.min(-num, L <= 4 ? 12 : 24), chips, tx);
        else applyHeroHeal(bundle, Math.min(num, c.maxHp), chips);
      }
      break;
    case "gold":
      if (!isNaN(num)) {
        const v = num > 0 ? Math.min(num, 50 * L) : Math.max(num, -c.gold);
        if (v) {
          c.gold += v;
          chips.push([(v > 0 ? "+" : "") + v + " gold", v > 0 ? "loot" : ""]);
        }
      }
      break;
    case "xp":
      if (!isNaN(num) && num > 0) {
        const v = Math.min(num, 100 * L);
        c.xp += v;
        chips.push([`+${v} XP`, "loot"]);
      }
      break;
    case "item_add":
    case "item": {
      const mm = arg.match(/^(.*?)(?:\s*\((.*?)\))?(?:\s*x\s*(\d+))?\s*$/i);
      const name = str(mm?.[1], 40);
      if (!name) break;
      const q = clamp(parseInt(mm?.[3] || "1", 10) || 1, 1, 99);
      const ex = findItem(bundle, name);
      if (ex && ex.name.toLowerCase() === name.toLowerCase()) {
        ex.qty = Math.min(999, ex.qty + q);
      } else {
        c.inv.push({ id: rid(), name, note: str(mm?.[2], 60), qty: q, ref: refFromName(name) });
      }
      chips.push([`+ ${name}${q > 1 ? " x" + q : ""}`, "loot"]);
      break;
    }
    case "item_remove": {
      const mm = arg.match(/^(.*?)(?:\s*x\s*(\d+))?\s*$/i);
      const it = findItem(bundle, str(mm?.[1], 40));
      if (!it) break;
      const q = clamp(parseInt(mm?.[2] || "1", 10) || 1, 1, 99);
      it.qty -= q;
      if (it.qty <= 0) c.inv = c.inv.filter(x => x !== it);
      syncChar(c);
      chips.push([`- ${it.name}${q > 1 ? " x" + q : ""}`, ""]);
      break;
    }
    case "move": {
      const name = str(parts[0], 50);
      if (!name) break;
      const id = "place_" + slug(name);
      if (!bundle.entities[id]) {
        bundle.entities[id] = { id, kind: "place", name, desc: str(parts[1], 160), first: G.turn };
      } else if (parts[1] && !bundle.entities[id].desc) {
        bundle.entities[id].desc = str(parts[1], 160);
      }
      bundle.entities[id].visited = G.turn;
      bundle.dirty.e.add(id);
      if (G.place !== id) {
        G.place = id;
        chips.push([`Now at ${name}`, ""]);
      }
      break;
    }
    case "time": {
      const t = arg.match(/(\d+)\s*([mhd])/i);
      if (t) {
        const mult = ({ m: 1, h: 60, d: 1440 } as Record<string, number>)[t[2].toLowerCase()];
        const v = clamp(+t[1] * mult, 1, 7 * 1440);
        advanceTimeInBundle(bundle, v, chips);
        if (tx) tx.timeSet = true;
      }
      break;
    }
    case "fact":
    case "secret": {
      const text = verb === "secret" ? parts[1] : parts[0];
      const truth = !/^(false|untrue|lie)$/i.test(parts[verb === "secret" ? 2 : 1] || "");
      recordFactOrSecret(bundle, verb, verb === "secret" ? parts[0] : null, text, truth, chips);
      break;
    }
    case "reveal": {
      const f = bundle.facts[arg.split(/\s/)[0]];
      if (!f) throw new Error("no such fact: " + str(arg, 40));
      revealFactInBundle(bundle, f.id, chips);
      break;
    }
    case "entity": {
      const mm = arg.match(/^(item|faction|lore)\s+(.*)$/i);
      if (!mm) throw new Error("entity needs a kind: item, faction or lore");
      const kind = mm[1].toLowerCase() as "item" | "faction" | "lore";
      const [nm, desc] = mm[2].split("|").map(x => x.trim());
      const name = str(nm, 50);
      if (!name) break;
      let e = Object.values(bundle.entities).find(
        x => x.kind === kind && x.name.toLowerCase() === name.toLowerCase()
      );
      if (!e) {
        let id = kind + "_" + slug(name);
        while (bundle.entities[id]) id = kind + "_" + slug(name) + "_" + rid().slice(0, 3);
        e = bundle.entities[id] = {
          id,
          kind,
          name,
          desc: str(desc, 160),
          loc: kind === "item" ? G.place : null,
          seen: G.turn
        };
        bundle.unread.journal = true;
        chips.push(["Noted: " + name, ""]);
      } else {
        if (desc) e.desc = str(desc, 160);
        e.seen = G.turn;
      }
      bundle.dirty.e.add(e.id);
      break;
    }
    case "npc": {
      if (!parts[0]) break;
      const aw = (parts[2] || "").toLowerCase();
      const att = aw.startsWith("friend") ? 1 : aw.startsWith("host") ? -1 : aw ? 0 : undefined;
      const isNew = !npcByName(bundle.entities, parts[0]);
      const e = ensureNpc(bundle, parts[0], parts[1], att, parts[3]);
      if (isNew) chips.push(["Met " + e.name, ""]);
      break;
    }
    case "attitude": {
      const mm = arg.match(/^(.*?)\s*([+-]\d)\s*$/);
      if (!mm) break;
      const e = npcByName(bundle.entities, mm[1]);
      if (!e) break;
      const before = attWord(e.att ?? 0);
      e.att = clamp((e.att ?? 0) + clamp(+mm[2], -1, 1), -3, 3);
      bundle.dirty.e.add(e.id);
      if (attWord(e.att) !== before) chips.push([`${e.name} is now ${attWord(e.att)}`, ""]);
      break;
    }
    case "leaves": {
      const e = npcByName(bundle.entities, arg);
      if (e) {
        e.loc = null;
        bundle.dirty.e.add(e.id);
      }
      break;
    }
    case "quest_new": {
      const title = str(parts[0], 60);
      if (!title || G.quests.some(q => q.title.toLowerCase() === title.toLowerCase())) break;
      G.quests.push({ id: rid(), title, obj: str(parts[1], 140), status: "active", turn: G.turn });
      bundle.unread.quests = true;
      chips.push(["New quest: " + title, "loot"]);
      break;
    }
    case "quest_update":
    case "quest_step": {
      const q = G.quests.find(x => x.title.toLowerCase() === str(parts[0], 60).toLowerCase());
      if (q && parts[1]) {
        q.obj = str(parts[1], 140);
        bundle.unread.quests = true;
        chips.push(["Quest updated", ""]);
      }
      break;
    }
    case "quest_done":
    case "quest_fail": {
      const q = G.quests.find(x => x.title.toLowerCase() === str(parts[0], 60).toLowerCase());
      if (q && q.status === "active") {
        q.status = verb === "quest_done" ? "done" : "failed";
        bundle.unread.quests = true;
        chips.push([
          (verb === "quest_done" ? "Quest complete: " : "Quest failed: ") + q.title,
          verb === "quest_done" ? "loot" : "hurt"
        ]);
      }
      break;
    }
    case "condition": {
      const k = arg.toLowerCase() as ConditionKey;
      if (CONDITIONS.includes(k) && !c.conditions.includes(k)) {
        c.conditions.push(k);
        chips.push([nice(k), "hurt"]);
      }
      break;
    }
    case "condition_end": {
      const k = arg.toLowerCase() as ConditionKey;
      if (c.conditions.includes(k)) {
        c.conditions = c.conditions.filter(x => x !== k);
        chips.push(["No longer " + k, "heal"]);
      }
      break;
    }
    case "clock_reveal": {
      const clk = findClock(bundle.clocks, parts[0]);
      if (!clk) throw new Error("no such clock: " + str(parts[0], 40));
      revealClock(clk, G.turn, parts[1], chips);
      bundle.dirty.k.add(clk.id);
      bundle.unread.journal = true;
      break;
    }
    case "clock_tick": {
      const mm = arg.match(/^(.*?)(?:\s+([+-]?\d+))?$/);
      const clk = findClock(bundle.clocks, mm?.[1] || arg);
      if (!clk) throw new Error("no such clock: " + str(arg, 40));
      tickClock(clk, clamp(parseInt(mm?.[2] || "1", 10) || 1, -4, 4), chips);
      bundle.dirty.k.add(clk.id);
      break;
    }
    case "clock_avert": {
      const clk = findClock(bundle.clocks, parts[0]);
      if (!clk) throw new Error("no such clock: " + str(parts[0], 40));
      avertClock(clk, chips);
      bundle.dirty.k.add(clk.id);
      break;
    }
    case "combat_start":
      startCombatInBundle(bundle, arg, chips);
      break;
    default:
      return false;
  }
  return true;
}

/** Runs each narrator event in isolation: a bad one rolls back only itself and logs to entry.failed / entry.skipped. */
export function applyEvents(
  bundle: CampaignBundle,
  list: NarratorEvent[] | undefined,
  entry: LogEntry,
  tx?: TxContext | null
): void {
  let failed = 0;
  for (const raw of list || []) {
    const g0 = clone(bundle.campaign);
    const e0 = clone(bundle.entities);
    const f0 = clone(bundle.facts);
    const k0 = clone(bundle.clocks);
    const chipsAt = entry.chips.length;
    const tx0 = tx ? { timeSet: tx.timeSet, dmg: tx.dmg } : null;
    const evLabel = typeof raw === "string" ? str(raw, 120) : str(JSON.stringify(raw), 120);
    try {
      if (applyEvent(bundle, raw, entry.chips, tx) === false) {
        (entry.skipped ||= []).push(evLabel);
      }
    } catch (e: any) {
      bundle.campaign = g0;
      bundle.entities = e0;
      bundle.facts = f0;
      bundle.clocks = k0;
      if (tx && tx0) {
        tx.timeSet = tx0.timeSet;
        tx.dmg = tx0.dmg;
      }
      entry.chips.length = chipsAt;
      failed++;
      (entry.failed ||= []).push({ ev: evLabel, why: str(e?.message || e, 100) });
    }
  }
  if (failed) {
    entry.chips.push([`${failed} narrator change${failed > 1 ? "s" : ""} skipped`, ""]);
  }
}
