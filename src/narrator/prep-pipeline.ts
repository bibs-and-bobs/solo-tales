/* Resumable 3-Step Behind-the-Screen Campaign Prep Pipeline & Quick-Start Seed.
   Builds World Spine, Hidden Threat Clocks, Campaign Art Brief, Places, NPCs with Secrets,
   False Rumours, Quests, and a Setting-Flavoured SRD Foe Roster before Turn 1. */

import type { ModelRouter } from "../adapters/llm/router";
import {
  aboutOf,
  applyEvent,
  applyTurnReplyInBundle,
  cleanArtBrief,
  cleanFlavour,
  cleanFoeTemplate,
  cleanThreatClock,
  commitBundleInPlace,
  createCampaignBundle,
  DEFAULT_SETTING,
  isObj,
  MONSTERS,
  rid,
  slug,
  str,
  TONES,
  type CampaignArtBrief,
  type CampaignBundle,
  type CampaignFlavour,
  type CharacterState,
  type FoeTemplate,
  type SettingArchetype,
  type ThreatClock
} from "../engine";
import { selectBudgetProfile } from "./budgets";
import { cleanReply } from "./cleaners";
import { buildStoryPacket } from "./packets";
import { pk } from "./sanitize";

export interface ArchetypeProfile {
  id: SettingArchetype;
  label: string;
  tagline: string;
  defaultCampaignName: string;
  defaultTone: string;
  defaultMagic: "rare" | "uncommon" | "high";
  defaultPillars: { combat: 1 | 2 | 3; mystery: 1 | 2 | 3; social: 1 | 2 | 3 };
  defaultPremise: string;
  defaultArtBrief: CampaignArtBrief;
}

export const ARCHETYPE_PROFILES: Record<SettingArchetype, ArchetypeProfile> = {
  frontier_mystery: {
    id: "frontier_mystery",
    label: "Frontier Mystery",
    tagline: "Rain-soaked borderland villages, old timber mills, vanishing folk, and watchful woods.",
    defaultCampaignName: "Brookhollow",
    defaultTone: TONES[0],
    defaultMagic: "rare",
    defaultPillars: { combat: 2, mystery: 3, social: 2 },
    defaultPremise:
      "A muddy river settlement at the edge of an ancient forest where livestock vanish by night, a local apprentice is missing, and no two neighbours tell the same story.",
    defaultArtBrief: {
      stylePreset: "painterly",
      medium: "textured oil-and-gouache character portrait on warm linen",
      palette: "hearth-amber, moss slate, weathered oak, rain-washed iron",
      lighting: "warm lantern rim-light against cool twilight mist",
      attireStyle: "practical travel-worn wool, oiled leather, mud-splashed iron buckles",
      moodKeywords: "grounded frontier mystery, weathered, observant"
    }
  },
  gothic_dread: {
    id: "gothic_dread",
    label: "Gothic Dread",
    tagline: "Fog-bound abbey towns, ancestral curses, tolling bells, and secrets buried shallow.",
    defaultCampaignName: "Ravenshollow",
    defaultTone: "Dark and grim",
    defaultMagic: "uncommon",
    defaultPillars: { combat: 2, mystery: 3, social: 2 },
    defaultPremise:
      "A cliffside parish cut off by autumn floods, where the abbey bell tolls at midnight without a bell-ringer and the burgomaster locks his shutters before sundown.",
    defaultArtBrief: {
      stylePreset: "dark_woodcut",
      medium: "chiaroscuro ink-and-charcoal engraving with muted oil wash",
      palette: "bone parchment, soot black, tarnished silver, dried crimson",
      lighting: "harsh single-tallow candlelight with deep dramatic shadows",
      attireStyle: "high-collared heavy wool, tarnished silver clasps, rain-darkened cloaks",
      moodKeywords: "gothic dread, solemn, haunted, taut"
    }
  },
  swashbuckling_coast: {
    id: "swashbuckling_coast",
    label: "Swashbuckling Coast",
    tagline: "Salt-wind harbours, smuggling coves, tide-flooded sea caves, and rival captains.",
    defaultCampaignName: "Saltmere Reach",
    defaultTone: "Light-hearted adventure",
    defaultMagic: "uncommon",
    defaultPillars: { combat: 2, mystery: 2, social: 3 },
    defaultPremise:
      "A free harbour of chalk cliffs and crooked taverns where a wrecked treasure barque washed ashore without its crew and three rival captains claim the salvage chart.",
    defaultArtBrief: {
      stylePreset: "painterly",
      medium: "expressive maritime watercolour and brushwork portrait",
      palette: "seafoam teal, sun-bleached canvas, brass gold, driftwood umber",
      lighting: "crisp coastal late-afternoon sun with warm salt-haze bounce",
      attireStyle: "salt-stained linen coats, brass buckles, sea-leather baldrics",
      moodKeywords: "windswept maritime adventure, bold, spirited"
    }
  },
  court_intrigue: {
    id: "court_intrigue",
    label: "Court Intrigue",
    tagline: "Walled trade cities,guild rivalries, poisoned wine, and knives behind velvet.",
    defaultCampaignName: "Verrin's Gate",
    defaultTone: TONES[0],
    defaultMagic: "rare",
    defaultPillars: { combat: 1, mystery: 3, social: 3 },
    defaultPremise:
      "A succession truce hangs by a thread inside a walled river-city after the seal-keeper was found dead in a locked Counting House and every guild blames another.",
    defaultArtBrief: {
      stylePreset: "ink_parchment",
      medium: "renaissance chalk-and-sepia court portrait on aged vellum",
      palette: "burnished gold, Venetianwine, walnut ink, warm ivory",
      lighting: "mullioned window sidelight over velvet shadow",
      attireStyle: "tailored guild doublets, subtle house brooches, concealed street steel",
      moodKeywords: "sharp political intrigue, guarded, aristocratic"
    }
  },
  ancient_ruins: {
    id: "ancient_ruins",
    label: "Ancient Ruins",
    tagline: "Sunkenempire vaults,expedition camps, rival delves, and waking stone.",
    defaultCampaignName: "Sunken Oakhaven",
    defaultTone: "Heroic high fantasy",
    defaultMagic: "high",
    defaultPillars: { combat: 3, mystery: 2, social: 1 },
    defaultPremise:
      "A sinkhole outside a quarry camp broke into a pre-imperial star-vault; the first survey team never returned, and strange bronze automata have been sighted on the ridge.",
    defaultArtBrief: {
      stylePreset: "painterly",
      medium: "classic fantasy illustration in rich gouache and ink line",
      palette: "verdigris bronze, torchlight gold, sandstone ochre, starlight indigo",
      lighting: "warm torchlight meeting cool ancient subterranean glow",
      attireStyle: "expedition harnesses, bronze relic trinkets, scarred delve gear",
      moodKeywords: "mythic ruin delve, awe-struck, weathered"
    }
  },
  custom: {
    id: "custom",
    label: "Custom World",
    tagline: "Write your own premise, hook, and tone from scratch.",
    defaultCampaignName: "New Chronicle",
    defaultTone: TONES[0],
    defaultMagic: "uncommon",
    defaultPillars: { combat: 2, mystery: 2, social: 2 },
    defaultPremise: DEFAULT_SETTING.premise,
    defaultArtBrief: cleanArtBrief({})!
  }
};

export interface Step1SpineOutput {
  title: string;
  premise: string;
  factions: Array<{ name: string; desc: string }>;
  clocks: ThreatClock[];
  artBrief: CampaignArtBrief;
}

export interface Step2WorldGraphOutput {
  places: Array<{ name: string; desc: string; start?: boolean }>;
  npcs: Array<{
    name: string;
    role: string;
    attitude: "friendly" | "neutral" | "hostile";
    place: string;
    appearance: string;
    agenda: string;
  }>;
  secrets: Array<{ holder: string; text: string }>;
  rumours: Array<{ text: string; truth: boolean }>;
  quests: Array<{ title: string; obj: string }>;
  foeRoster: Record<string, FoeTemplate>;
}

export type PrepStepId = "spine" | "world_graph" | "opening_scene";

export interface PrepProgressEvent {
  step: PrepStepId;
  stepIndex: 1 | 2 | 3;
  status: "running" | "done" | "error";
  message: string;
  detail?: string;
}

export interface PrepSessionInput {
  campaignName: string;
  flavour: CampaignFlavour;
  heroKey: "fighter" | "rogue";
  heroName?: string;
  heroAppearance?: string;
  heroPortraitId?: string | null;
  customChar?: CharacterState;
  stylePresetOverride?: CampaignArtBrief["stylePreset"];
}

export interface PrepSessionState {
  input: PrepSessionInput;
  step1?: Step1SpineOutput;
  step2?: Step2WorldGraphOutput;
  bundle?: CampaignBundle;
}

export const OPENING_DIRECTOR_PROMPT =
  "Begin the adventure in the starting place already established in <game_data>. Bring the scene to life through concrete sensory details, have one or two present NPCs speak or react in \"say\" segments, surface an immediate hook tied to the active quests, and end on a clear turn in the scene.";

function pillarDesc(v: 1 | 2 | 3): string {
  return v === 3 ? "high focus" : v === 2 ? "moderate" : "light";
}

function buildStep1Prompt(input: PrepSessionInput): { system: string; user: string } {
  const arch = ARCHETYPE_PROFILES[input.flavour.archetype] || ARCHETYPE_PROFILES.frontier_mystery;
  const seedPremise = str(input.flavour.customPremise, 600) || arch.defaultPremise;

  const system = `You are the world-architect preparing a solo 2024 D&D 5e campaign behind the screen before Turn 1.
Build a tight, playable low-level starting region with real tension, concrete stakes, no clichés, and no em-dashes.
Design:
1) A crisp campaign title (if needed) and a 2-3 sentence grounded premise.
2) 1 or 2 local factions or power groups with conflicting interests.
3) Exactly 2 Hidden Threat Clocks that advance behind the screen if the hero ignores them (segments: 4 or 6; minutesPerTick between 180 and 720; a dramatic "consequence" when full; a subtle "portent" sign the narrator can hint at).
4) A visual "artBrief" describing consistent character portrait aesthetics matching this world's tone and culture.

Reply ONLY with one valid JSON object matching this exact schema:
{
  "title": "2-4 word campaign title",
  "premise": "2-3 concrete sentences setting up the local crisis",
  "factions": [{"name": "Faction Name", "desc": "who they are and what they want"}],
  "clocks": [
    {"id": "clock_short_slug", "name": "Threat Name", "segments": 4, "minutesPerTick": 240, "consequence": "What happens in the world when full", "portent": "Subtle sign as it advances"}
  ],
  "artBrief": {
    "stylePreset": "painterly",
    "medium": "visual medium description",
    "palette": "4-5 key colours",
    "lighting": "characteristic lighting",
    "attireStyle": "local clothing, armour and material textures",
    "moodKeywords": "3-4 mood adjectives"
  }
}`;

  const user = `CAMPAIGN REQUEST:
Working title: ${pk(input.campaignName || arch.defaultCampaignName, 40)}
Archetype: ${arch.label} (${arch.tagline})
Tone: ${pk(input.flavour.tone, 50)}
Magic level: ${input.flavour.magicLevel}
Playstyle pillars: Combat ${pillarDesc(input.flavour.pillars.combat)}, Mystery ${pillarDesc(
    input.flavour.pillars.mystery
  )}, Social ${pillarDesc(input.flavour.pillars.social)}
Player seed / premise idea: ${pk(seedPremise, 550)}
Hero: ${pk(input.heroName || "the hero", 30)} (${input.heroKey})`;

  return { system, user };
}

function buildStep2Prompt(
  input: PrepSessionInput,
  step1: Step1SpineOutput
): { system: string; user: string } {
  const validMonsterBases = Object.keys(MONSTERS).join(", ");
  const system = `You are populating the starting local region of a solo 2024 D&D 5e campaign behind the screen.
Using the World Spine below, create an interconnected web of places, people with private agendas, hidden secrets, rumours (including at least ONE false rumour that locals mistakenly believe!), starting quests, and a Setting-Flavoured Foe Roster mapped strictly onto valid SRD base stat blocks.

VALID SRD BASE MONSTER KEYS (every foeRoster entry MUST use one of these exact keys as "base"):
${validMonsterBases}

Rules:
- 3 to 4 connected places (mark exactly one with "start": true where Turn 1 opens).
- 4 to 5 named NPCs placed across those locations ("attitude": "friendly", "neutral", or "hostile"), with distinct physical "appearance" (for portrait generation) and private "agenda".
- 3 hidden NPC secrets ("holder" MUST match one of your NPC names; the player does NOT know these yet).
- 2 local rumours the hero hears on arrival: at least one true ("truth": true) and one misleading/untrue ("truth": false).
- 1 or 2 clear starting quests ("title", "obj").
- 4 to 5 reskinned foes in "foeRoster": give each a snake_case "key" (e.g. "ash_hound", "briar_cutthroat"), a setting-specific "name", a valid SRD "base" from the list above, and optional "npcName" if the template represents one of your named hostile/rival NPCs.

Reply ONLY with one valid JSON object:
{
  "places": [{"name": "Place Name", "desc": "vivid 1-sentence description with exits/landmarks", "start": true}],
  "npcs": [{"name": "Full Name", "role": "occupation/role", "attitude": "neutral", "place": "Place Name", "appearance": "distinctive face, age, attire", "agenda": "what they privately want"}],
  "secrets": [{"holder": "Full Name", "text": "One concrete hidden truth this NPC is hiding"}],
  "rumours": [{"text": "A rumour circulating locally", "truth": true}, {"text": "A plausible but false local belief", "truth": false}],
  "quests": [{"title": "Quest Title", "obj": "Concrete first objective"}],
  "foeRoster": [
    {"key": "custom_snake_key", "name": "Display Name", "base": "bandit", "npcName": "", "flavourNote": "how they fight"}
  ]
}`;

  const user = `WORLD SPINE:
Title: ${pk(step1.title, 50)}
Premise: ${pk(step1.premise, 550)}
Tone: ${pk(input.flavour.tone, 50)} | Magic: ${input.flavour.magicLevel}
Factions: ${step1.factions.map(f => `${pk(f.name, 40)} (${pk(f.desc, 100)})`).join("; ") || "none"}
Hidden Clocks: ${step1.clocks.map(c => `${pk(c.name, 40)} -> ${pk(c.consequence, 100)}`).join("; ")}`;

  return { system, user };
}

function parseStep1Output(raw: unknown, input: PrepSessionInput): Step1SpineOutput {
  const arch = ARCHETYPE_PROFILES[input.flavour.archetype] || ARCHETYPE_PROFILES.frontier_mystery;
  const obj = isObj(raw) ? raw : {};

  const title = str(obj.title || input.campaignName || arch.defaultCampaignName, 40) || arch.defaultCampaignName;
  const premise =
    str(obj.premise || input.flavour.customPremise || arch.defaultPremise, 600) ||
    arch.defaultPremise;

  const factions = Array.isArray(obj.factions)
    ? obj.factions
        .filter(isObj)
        .slice(0, 3)
        .map(f => ({ name: str(f.name, 50), desc: str(f.desc, 160) }))
        .filter(f => f.name)
    : [];

  const clocks: ThreatClock[] = [];
  if (Array.isArray(obj.clocks)) {
    for (const rawClk of obj.clocks.slice(0, 3)) {
      if (!isObj(rawClk)) continue;
      const id =
        "clock_" +
        slug(String(rawClk.id || rawClk.name || rid()).replace(/^clock[_-]?/i, "")).slice(0, 24);
      const cleaned = cleanThreatClock({
        ...rawClk,
        id,
        secretSummary: rawClk.portent ?? rawClk.secretSummary ?? rawClk.name,
        advanceEveryMinutes: rawClk.minutesPerTick ?? rawClk.advanceEveryMinutes ?? 240,
        accumulatedMinutes: 0,
        filled: 0,
        knownToPlayer: false,
        status: "active"
      });
      if (cleaned) clocks.push(cleaned);
    }
  }
  if (clocks.length === 0) {
    clocks.push({
      id: "clock_gathering_threat",
      name: "Gathering Shadow",
      secretSummary: "Fresh tracks and hushed warnings multiply at dusk.",
      segments: 4,
      filled: 0,
      advanceEveryMinutes: 240,
      accumulatedMinutes: 0,
      knownToPlayer: false,
      consequence: "The unseen threat strikes openly at the settlement.",
      status: "active"
    });
  }

  const baseArt = isObj(obj.artBrief)
    ? cleanArtBrief({
        ...arch.defaultArtBrief,
        ...obj.artBrief,
        stylePreset: input.stylePresetOverride || obj.artBrief.stylePreset || arch.defaultArtBrief.stylePreset
      })!
    : cleanArtBrief({
        ...arch.defaultArtBrief,
        stylePreset: input.stylePresetOverride || arch.defaultArtBrief.stylePreset
      })!;

  return { title, premise, factions, clocks, artBrief: baseArt };
}

function parseStep2Output(raw: unknown): Step2WorldGraphOutput {
  const obj = isObj(raw) ? raw : {};

  const places = Array.isArray(obj.places)
    ? obj.places
        .filter(isObj)
        .slice(0, 6)
        .map(p => ({
          name: str(p.name, 50),
          desc: str(p.desc, 160),
          start: Boolean(p.start)
        }))
        .filter(p => p.name)
    : [];

  if (places.length === 0) {
    places.push({
      name: "The Crossroads Inn",
      desc: "A low timber common room smelling of wet wool, woodsmoke, and sour ale.",
      start: true
    });
  }
  if (!places.some(p => p.start)) {
    places[0].start = true;
  }

  const startPlaceName = places.find(p => p.start)!.name;

  const npcs = Array.isArray(obj.npcs)
    ? obj.npcs
        .filter(isObj)
        .slice(0, 7)
        .map(n => {
          const attRaw = String(n.attitude ?? "neutral").toLowerCase();
          const attitude: "friendly" | "neutral" | "hostile" = attRaw.startsWith("friend")
            ? "friendly"
            : attRaw.startsWith("host")
            ? "hostile"
            : "neutral";
          return {
            name: str(n.name, 40),
            role: str(n.role, 60) || "local",
            attitude,
            place: str(n.place, 50) || startPlaceName,
            appearance: str(n.appearance, 180),
            agenda: str(n.agenda, 160)
          };
        })
        .filter(n => n.name)
    : [];

  const secrets = Array.isArray(obj.secrets)
    ? obj.secrets
        .filter(isObj)
        .slice(0, 6)
        .map(s => ({ holder: str(s.holder, 40), text: str(s.text, 220) }))
        .filter(s => s.holder && s.text)
    : [];

  const rumours = Array.isArray(obj.rumours)
    ? obj.rumours
        .filter(isObj)
        .slice(0, 4)
        .map(r => ({ text: str(r.text, 220), truth: r.truth !== false }))
        .filter(r => r.text)
    : [];

  const quests = Array.isArray(obj.quests)
    ? obj.quests
        .filter(isObj)
        .slice(0, 3)
        .map(q => ({ title: str(q.title, 60), obj: str(q.obj, 140) }))
        .filter(q => q.title)
    : [];

  const foeRoster: Record<string, FoeTemplate> = {};
  const rawRoster = Array.isArray(obj.foeRoster)
    ? obj.foeRoster
    : isObj(obj.foeRoster)
    ? Object.entries(obj.foeRoster).map(([key, v]) => (isObj(v) ? { key, ...v } : null))
    : [];

  for (const item of rawRoster.slice(0, 8)) {
    if (!isObj(item)) continue;
    const key = String(item.key || item.id || slug(String(item.name || "")).replace(/-/g, "_"))
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 36);
    if (!key) continue;
    const baseCandidate = String(item.base || item.baseRef || "bandit").toLowerCase().trim();
    const base = Object.hasOwn(MONSTERS, baseCandidate) ? baseCandidate : "bandit";
    const cleaned = cleanFoeTemplate({
      id: key,
      name: str(item.name, 40) || niceKey(key),
      baseRef: base,
      description: str(item.flavourNote ?? item.description, 120),
      npcId: item.npcName ? `pending_npc:${str(item.npcName, 40)}` : undefined
    });
    if (cleaned) foeRoster[cleaned.id] = cleaned;
  }

  return { places, npcs, secrets, rumours, quests, foeRoster };
}

function niceKey(k: string): string {
  return k
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Builds a fully populated CampaignBundle at Turn 0 from Step 1 + Step 2 world prep artifacts. */
export function assemblePreparedBundle(
  input: PrepSessionInput,
  step1: Step1SpineOutput,
  step2: Step2WorldGraphOutput
): CampaignBundle {
  const campaignTitle = str(input.campaignName, 40) || step1.title;
  const bundle = createCampaignBundle({
    name: campaignTitle,
    setting: { premise: step1.premise, tone: input.flavour.tone },
    heroKey: input.heroKey,
    heroName: input.heroName,
    heroAppearance: input.heroAppearance,
    heroPortraitId: input.heroPortraitId,
    customChar: input.customChar,
    flavour: cleanFlavour(input.flavour),
    artBrief: step1.artBrief
  });

  commitBundleInPlace(bundle, "seed campaign prep", draft => {
    const G = draft.campaign;
    const chips: Array<[string, string]> = [];

    // 1. Factions
    for (const fac of step1.factions) {
      applyEvent(draft, { type: "entity", kind: "faction", name: fac.name, desc: fac.desc }, chips);
    }

    // 2. Places (create non-starting places first, then move hero to starting place)
    const startPlace = step2.places.find(p => p.start) || step2.places[0];
    for (const pl of step2.places) {
      const id = "place_" + slug(pl.name);
      draft.entities[id] = {
        id,
        kind: "place",
        name: pl.name,
        desc: pl.desc,
        first: 0,
        visited: pl === startPlace ? 0 : undefined
      };
      draft.dirty.e.add(id);
    }
    if (startPlace) {
      G.place = "place_" + slug(startPlace.name);
    }

    // 3. NPCs (placed in their designated locations, with appearance & private agenda stored)
    const npcIdByName = new Map<string, string>();
    for (const n of step2.npcs) {
      const placeId = "place_" + slug(n.place);
      const resolvedLoc = draft.entities[placeId] ? placeId : G.place;
      let id = "npc_" + slug(n.name);
      while (draft.entities[id]) id = "npc_" + slug(n.name) + "_" + rid().slice(0, 3);
      const att = n.attitude === "friendly" ? 1 : n.attitude === "hostile" ? -1 : 0;
      draft.entities[id] = {
        id,
        kind: "npc",
        name: n.name,
        role: n.role,
        att,
        loc: resolvedLoc,
        seen: resolvedLoc === G.place ? 0 : undefined,
        met: 0,
        appearance: n.appearance || undefined,
        agenda: n.agenda || undefined,
        combatStatus: null
      };
      draft.dirty.e.add(id);
      npcIdByName.set(n.name.toLowerCase(), id);
      npcIdByName.set(n.name.toLowerCase().split(" ")[0], id);

      // Private agenda also stored as an NPC-held secret if non-empty so the narrator knows their motive when present!
      if (n.agenda) {
        const fid = "fact_ag_" + rid().slice(0, 5);
        draft.facts[fid] = {
          id: fid,
          text: `${n.name}'s motive: ${n.agenda}`,
          turn: 0,
          place: resolvedLoc,
          pinned: false,
          about: [id],
          known: [id],
          truth: true
        };
        draft.dirty.f.add(fid);
      }
    }

    // 4. Hidden NPC Secrets (strictly known ONLY to the holder NPC, never to "player"!)
    for (const sec of step2.secrets) {
      const holderId =
        npcIdByName.get(sec.holder.toLowerCase()) ||
        npcIdByName.get(sec.holder.toLowerCase().split(" ")[0]);
      if (!holderId) continue;
      let fid = "fact_" + rid().slice(0, 5);
      while (draft.facts[fid]) fid = "fact_" + rid().slice(0, 5);
      draft.facts[fid] = {
        id: fid,
        text: sec.text,
        turn: 0,
        place: draft.entities[holderId]?.loc ?? G.place,
        pinned: false,
        about: Array.from(new Set([holderId, ...aboutOf(sec.text, draft.entities)])).slice(0, 6),
        known: [holderId],
        truth: true
      };
      draft.dirty.f.add(fid);
    }

    // 5. Starting Rumours (known to "player", including untrue `[untrue]` beliefs!)
    for (const rum of step2.rumours) {
      applyEvent(draft, { type: "fact", text: rum.text, truth: rum.truth }, chips);
    }

    // 6. Starting Quests
    for (const q of step2.quests) {
      applyEvent(draft, { type: "quest_new", title: q.title, obj: q.obj }, chips);
    }

    // 7. Hidden Threat Clocks
    for (const clk of step1.clocks) {
      const copy = { ...clk };
      draft.clocks[copy.id] = copy;
      draft.dirty.k.add(copy.id);
    }

    // 8. Foe Roster (resolving any `pending_npc:Name` links to actual `npc_...` entity IDs!)
    for (const [k, tpl] of Object.entries(step2.foeRoster)) {
      let resolvedNpcId = tpl.npcId;
      if (resolvedNpcId?.startsWith("pending_npc:")) {
        const targetName = resolvedNpcId.slice("pending_npc:".length).toLowerCase().trim();
        resolvedNpcId =
          npcIdByName.get(targetName) || npcIdByName.get(targetName.split(" ")[0]) || undefined;
      }
      draft.foeRoster[k] = { ...tpl, npcId: resolvedNpcId };
      draft.dirty.r.add(k);
    }

    G.summary = `${step1.premise} Open threads: ${step2.quests.map(q => q.title).join("; ") || "Uncover what troubles this place."}`.slice(
      0,
      1200
    );
    draft.unread = { quests: G.quests.length > 0, journal: true };
  });

  return bundle;
}

/** Instant zero-LLM-wait prebuilt Brookhollow world seed for "Quick Start" (still gets Hidden Clocks & Foe Roster!). */
export function createQuickStartSeed(input: PrepSessionInput): {
  step1: Step1SpineOutput;
  step2: Step2WorldGraphOutput;
  bundle: CampaignBundle;
} {
  const arch = ARCHETYPE_PROFILES[input.flavour.archetype] || ARCHETYPE_PROFILES.frontier_mystery;
  const step1: Step1SpineOutput = {
    title: str(input.campaignName, 40) || "Brookhollow",
    premise: str(input.flavour.customPremise, 600) || DEFAULT_SETTING.premise,
    factions: [
      {
        name: "Brookhollow Reeve's Watch",
        desc: "Overstretched village militia trying to keep calm before market day."
      },
      {
        name: "Redbriar Raiders",
        desc: "A bold goblin band lairing up-stream in the collapsed sluice caves."
      }
    ],
    clocks: [
      {
        id: "clock_millers_son",
        name: "Ransom at the Old Sluice",
        secretSummary: "Fresh iron-shod bootprints and ash signals appear along the millrace.",
        segments: 4,
        filled: 0,
        advanceEveryMinutes: 240,
        accumulatedMinutes: 0,
        knownToPlayer: false,
        consequence: "Redbriar scouts march Tomas deeper into the hills beyond easy rescue.",
        status: "active"
      },
      {
        id: "clock_village_panic",
        name: "Panic in Brookhollow",
        secretSummary: "Tempers fray in the tavern as another sheep pen is found broken.",
        segments: 6,
        filled: 0,
        advanceEveryMinutes: 360,
        accumulatedMinutes: 0,
        knownToPlayer: false,
        consequence: "Angry farmers barricade the bridge and accuse innocent travellers.",
        status: "active"
      }
    ],
    artBrief: cleanArtBrief({
      ...arch.defaultArtBrief,
      stylePreset: input.stylePresetOverride || arch.defaultArtBrief.stylePreset
    })!
  };

  const step2: Step2WorldGraphOutput = {
    places: [
      {
        name: "The Drowned Oar",
        desc: "A low riverside inn smelling of woodsmoke, wet cloaks, and river pike.",
        start: true
      },
      {
        name: "Aldric's Mill",
        desc: "A silent timber watermill at the forest edge with a jammed wheel and mud-churned yard."
      },
      {
        name: "Old Sluice Bridge",
        desc: "A mossy stone arch where forest game-trails cross the black millstream."
      }
    ],
    npcs: [
      {
        name: "Mara Holt",
        role: "innkeeper of The Drowned Oar",
        attitude: "friendly",
        place: "The Drowned Oar",
        appearance: "Square-shouldered woman in her forties, braided grey-streaked hair, rolled linen sleeves, ring of brass keys.",
        agenda: "Keep the peace in her common room while quietly helping Tomas get home alive."
      },
      {
        name: "Aldric Reed",
        role: "village miller, Tomas's father",
        attitude: "neutral",
        place: "The Drowned Oar",
        appearance: "Gaunt man in flour-dusted wool with sleepless hollows under his eyes and raw knuckles.",
        agenda: "Find Tomas without letting the village learn about the unpaid gambling debt."
      },
      {
        name: "Voss",
        role: "toll-warden at the river ford",
        attitude: "neutral",
        place: "Old Sluice Bridge",
        appearance: "Tall lean watchman in a patched oilskin cape carrying a notched billhook.",
        agenda: "Collect river-tolls and hide that he deserted his post the night Tomas vanished."
      },
      {
        name: "Skabgrim",
        role: "Redbriar war-leader",
        attitude: "hostile",
        place: "Old Sluice Bridge",
        appearance: "Scar-eared goblin boss in scavenged brigandine wearing a stolen silver mill-tally.",
        agenda: "Extort coin and iron tools from Aldric before winter."
      }
    ],
    secrets: [
      {
        holder: "Aldric Reed",
        text: "Tomas owed twenty silver to smugglers who trade iron with Skabgrim's band."
      },
      {
        holder: "Mara Holt",
        text: "Mara hides an unsigned note from Tomas under her bar promising to pay his debt at the Old Sluice."
      },
      {
        holder: "Voss",
        text: "Voss left the bridge unguarded on the night Tomas disappeared because he was drinking at a poacher's camp."
      }
    ],
    rumours: [
      {
        text: "Tomas Reed was last seen walking upstream toward the silent watermill at dusk three days ago.",
        truth: true
      },
      {
        text: "Folk say a lone dire wolf dragged the miller's son into the deep timber.",
        truth: false
      }
    ],
    quests: [
      {
        title: "The Miller's Missing Son",
        obj: "Speak with Aldric and Mara at The Drowned Oar and pick up Tomas's trail."
      }
    ],
    foeRoster: {
      redbriar_forager: {
        id: "redbriar_forager",
        name: "Redbriar Forager",
        baseRef: "goblin_warrior",
        description: "Carries a hooked bill and whistles bird-calls to signal allies."
      },
      skabgrim_boss: {
        id: "skabgrim_boss",
        name: "Skabgrim",
        baseRef: "goblin_boss",
        npcId: "pending_npc:Skabgrim",
        description: "Barks orders from behind his foragers and wears stolen brigandine."
      },
      briar_wolf: {
        id: "briar_wolf",
        name: "Briar-maw Wolf",
        baseRef: "wolf",
        description: "Half-starved timber wolf drawn to tethered livestock."
      },
      ford_cutthroat: {
        id: "ford_cutthroat",
        name: "River-ford Smuggler",
        baseRef: "bandit",
        description: "Oiled cloak, heavy cudgel, and light crossbow."
      }
    }
  };

  const bundle = assemblePreparedBundle(input, step1, step2);
  return { step1, step2, bundle };
}

/** Resumable 3-step Campaign Prep Pipeline. */
export class CampaignPrepPipeline {
  private router: ModelRouter;
  private sleepFn: (ms: number) => Promise<void>;

  constructor(router: ModelRouter, sleepFn?: (ms: number) => Promise<void>) {
    this.router = router;
    this.sleepFn = sleepFn ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  private async maybeSpaceCall(signal?: AbortSignal): Promise<void> {
    if (!this.router.isEconomyActive()) return;
    const ms = this.router.getConfig().prepStepSpacingMs ?? 1000;
    if (ms <= 0) return;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await this.sleepFn(ms);
  }

  async runStep1(session: PrepSessionState, signal?: AbortSignal): Promise<Step1SpineOutput> {
    const { system, user } = buildStep1Prompt(session.input);
    const resp = await this.router.complete({
      task: "world_prep",
      priority: 2,
      system,
      user,
      jsonMode: true,
      maxOutputTokens: 1200,
      temperature: 0.75,
      signal
    });
    const parsed = parseStep1Output(resp.json, session.input);
    session.step1 = parsed;
    return parsed;
  }

  async runStep2(session: PrepSessionState, signal?: AbortSignal): Promise<Step2WorldGraphOutput> {
    if (!session.step1) {
      throw new Error("Step 1 (World Spine) must complete before Step 2.");
    }
    const { system, user } = buildStep2Prompt(session.input, session.step1);
    const resp = await this.router.complete({
      task: "world_prep",
      priority: 2,
      system,
      user,
      jsonMode: true,
      maxOutputTokens: 1800,
      temperature: 0.75,
      signal
    });
    const parsed = parseStep2Output(resp.json);
    session.step2 = parsed;
    return parsed;
  }

  async runStep3Opening(
    session: PrepSessionState,
    signal?: AbortSignal
  ): Promise<CampaignBundle> {
    if (!session.step1 || !session.step2) {
      throw new Error("Steps 1 and 2 must complete before Step 3 (Opening Scene).");
    }
    const bundle = session.bundle ?? assemblePreparedBundle(session.input, session.step1, session.step2);
    session.bundle = bundle;

    const conn = this.router.peekBestConnection("world_prep");
    const budget = selectBudgetProfile(conn, this.router.isEconomyActive());
    const pkt = buildStoryPacket(bundle, OPENING_DIRECTOR_PROMPT, {
      opening: true,
      directorNote: true,
      budget
    });

    const resp = await this.router.complete({
      task: "world_prep",
      priority: 1,
      system: pkt.system,
      user: pkt.user,
      jsonMode: true,
      maxOutputTokens: budget.maxOutputTokens,
      temperature: 0.75,
      signal
    });

    const reply = cleanReply(resp.json, bundle);
    if (!reply) {
      throw new Error("Opening scene reply did not match the narrator JSON schema.");
    }

    const res = commitBundleInPlace(bundle, "opening scene", (draft, tx) => {
      applyTurnReplyInBundle(draft, reply, OPENING_DIRECTOR_PROMPT, tx, {
        opening: true,
        foldBeatThreshold: this.router.getMemoryFoldThreshold()
      });
    });
    if (!res.ok) {
      throw new Error("Opening scene transaction rolled back safely.");
    }

    return bundle;
  }

  /** Runs (or resumes!) all remaining prep steps, emitting live step progress updates. */
  async runAll(
    session: PrepSessionState,
    onProgress?: (ev: PrepProgressEvent) => void,
    signal?: AbortSignal
  ): Promise<CampaignBundle> {
    if (!session.step1) {
      onProgress?.({
        step: "spine",
        stepIndex: 1,
        status: "running",
        message: "Shaping world spine, hidden threat clocks & visual brief…"
      });
      try {
        const s1 = await this.runStep1(session, signal);
        onProgress?.({
          step: "spine",
          stepIndex: 1,
          status: "done",
          message: `World spine ready: ${s1.title}`,
          detail: `${s1.clocks.length} hidden clocks · ${s1.artBrief.stylePreset.replace(/_/g, " ")} palette`
        });
      } catch (err: any) {
        onProgress?.({
          step: "spine",
          stepIndex: 1,
          status: "error",
          message: "Failed while shaping world spine.",
          detail: err?.message || String(err)
        });
        throw err;
      }
      await this.maybeSpaceCall(signal);
    }

    if (!session.step2) {
      onProgress?.({
        step: "world_graph",
        stepIndex: 2,
        status: "running",
        message: "Populating places, NPC agendas, hidden secrets & foe roster…"
      });
      try {
        const s2 = await this.runStep2(session, signal);
        onProgress?.({
          step: "world_graph",
          stepIndex: 2,
          status: "done",
          message: `Built ${s2.places.length} places, ${s2.npcs.length} people & ${Object.keys(s2.foeRoster).length} foes`,
          detail: `${s2.secrets.length} hidden secrets · ${s2.quests.length} starting quest${s2.quests.length === 1 ? "" : "s"}`
        });
      } catch (err: any) {
        onProgress?.({
          step: "world_graph",
          stepIndex: 2,
          status: "error",
          message: "Failed while building places & NPCs.",
          detail: err?.message || String(err)
        });
        throw err;
      }
      await this.maybeSpaceCall(signal);
    }

    onProgress?.({
      step: "opening_scene",
      stepIndex: 3,
      status: "running",
      message: "Setting the opening scene…"
    });
    try {
      const bundle = await this.runStep3Opening(session, signal);
      onProgress?.({
        step: "opening_scene",
        stepIndex: 3,
        status: "done",
        message: "Your chronicle is ready."
      });
      return bundle;
    } catch (err: any) {
      onProgress?.({
        step: "opening_scene",
        stepIndex: 3,
        status: "error",
        message: "Failed while writing the opening scene.",
        detail: err?.message || String(err)
      });
      throw err;
    }
  }
}
