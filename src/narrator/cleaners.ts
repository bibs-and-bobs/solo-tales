/* Schema validators & cleaners for LLM replies (Story turns, Combat rounds, Speakers).
   Accepts both Typed JSON events and legacy string events while enforcing strict bounds. */

import {
  clamp,
  cleanRuling,
  cleanStory,
  isObj,
  MOODS,
  normCheck,
  presentNpcsIn,
  str,
  type ActiveCombat,
  type CampaignBundle,
  type CleanedTurnReply,
  type Mood,
  type NarratorEvent,
  type PendingCheckBranch,
  type RoundNarration
} from "../engine";

function cleanEventList(rawEvents: unknown, limit: number): NarratorEvent[] {
  if (!Array.isArray(rawEvents)) return [];
  const out: NarratorEvent[] = [];
  for (const ev of rawEvents.slice(0, limit)) {
    if (typeof ev === "string") {
      const s = str(ev, 240);
      if (s) out.push(s);
    } else if (isObj(ev) && typeof ev.type === "string") {
      out.push(ev as NarratorEvent);
    }
  }
  return out;
}

function cleanReplyBranch(rawBranch: unknown): PendingCheckBranch {
  if (!isObj(rawBranch)) return { story: [], events: [] };
  return {
    story: cleanStory(rawBranch.story),
    events: cleanEventList(rawBranch.events, 10)
  };
}

export function cleanReply(raw: unknown, bundle: CampaignBundle): CleanedTurnReply | null {
  if (!isObj(raw)) return null;
  const G = bundle.campaign;

  // Support alternate prose fallback if a free/local model returned {"prose":"..."} instead of {"story":[{"n":"..."}]}
  const rawStory = Array.isArray(raw.story)
    ? raw.story
    : typeof raw.prose === "string" && raw.prose.trim()
    ? [{ n: raw.prose }]
    : [];

  const moodCandidate = String(raw.mood ?? "") as Mood;
  const out: CleanedTurnReply = {
    story: cleanStory(rawStory),
    events: cleanEventList(raw.events, 16),
    beat: str(raw.beat, 140),
    options: Array.isArray(raw.options)
      ? raw.options
          .slice(0, 3)
          .map((o: unknown) => str(o, 48))
          .filter(Boolean)
      : [],
    mood: MOODS.includes(moodCandidate) ? moodCandidate : G.mood,
    scene_end: Boolean(raw.scene_end),
    check: null
  };

  if (isObj(raw.check)) {
    const chk = normCheck(raw.check.skill || raw.check.ability || raw.check.key);
    if (chk) {
      out.check = {
        ...chk,
        dc: clamp(Math.round(Number(raw.check.dc) || 12), 5, 25),
        adv: clamp(Math.round(Number(raw.check.adv) || 0), -1, 1)
      };
      out.success = cleanReplyBranch(raw.success);
      out.failure = cleanReplyBranch(raw.failure);
      if (!out.success.story.length) out.success.story = [{ n: "You manage it." }];
      if (!out.failure.story.length) out.failure.story = [{ n: "It doesn't go your way." }];

      if (isObj(raw.ruling)) {
        const rl = cleanRuling(
          { ...raw.ruling, check: { skill: out.check.key, dc: out.check.dc } },
          false,
          G.char
        );
        if (rl) {
          rl.check.adv = out.check.adv;
          out.check.dc = rl.check.dc!;
          out.ruling = rl;
        }
      }
    }
  }

  if (!out.story.length && !out.check) return null;
  return out;
}

export function speakerIn(
  who: unknown,
  bundle: CampaignBundle,
  combat: ActiveCombat | null
): string | null {
  const w = str(who, 40).toLowerCase();
  if (!w) return null;
  const foeNames = combat?.cs
    ? Object.values(combat.cs.actors)
        .filter(a => a.side === "foe")
        .map(a => a.name)
    : [];
  const npcNames = presentNpcsIn(bundle.campaign.place, bundle.entities).map(n => n.name);
  const names = [...foeNames, ...npcNames];
  return (
    names.find(n => n.toLowerCase() === w) ||
    names.find(n => n.toLowerCase().startsWith(w + " ") || w.startsWith(n.toLowerCase())) ||
    null
  );
}

export function cleanRound(
  raw: unknown,
  bundle: CampaignBundle,
  combat: ActiveCombat | null
): RoundNarration | null {
  if (!isObj(raw)) return null;
  const line = str(raw.line ?? raw.narration ?? raw.n ?? raw.prose, 320);
  if (!line) return null;
  const out: RoundNarration = { line, sfx: null, say: null };
  const sfx = str(raw.sfx, 24)
    .toUpperCase()
    .replace(/[^A-Z!' -]/g, "")
    .trim();
  if (sfx && sfx.split(/\s+/).length <= 2) {
    out.sfx = sfx.slice(0, 16);
  }
  if (isObj(raw.say)) {
    const who = speakerIn(raw.say.who, bundle, combat);
    const text = str(raw.say.text, 160);
    if (who && text) out.say = { who, text };
  }
  return out;
}
