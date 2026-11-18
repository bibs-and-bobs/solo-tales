# Solo Tales

A solo tabletop game on the 2024 D&D 5e core rules, narrated by Claude, played and saved inside a claude.ai artifact.

## Status (12 Nov 2026)

One phase per chat. Set the model with /model at the start of each chat. Build order from here: 2E, 3B, 3C, 4A, 4B, 4C, 5A, 5B, 5C.

| Phase | Status | Model and effort |
| --- | --- | --- |
| 1 Core loop | Done and live | n/a |
| Hardening | Done and live | n/a |
| 2A Rules data and combat engine | Done, reviewed and live | Opus 5.5, high |
| 2B Combat screen | Done and live | Sonnet 5.5, high |
| 2C Creative rulings, XP, loot | Done and live | Opus 5.5, high |
| 3A Knowledge data model | Done and live | Opus 5.5, high |
| 3V Narrator voice pass | Done and live | Opus 5.5, medium |
| 2D Grid combat | Done and live | Opus 5.5, high |
| 2E Party in combat | Next | Opus 5.5, high |
| 3B Journal | Planned | Sonnet 5.5, high |
| 3C Roll moment | Planned | Opus 5.5, high |
| 4A Clocks and schedules | Planned | Opus 5.5, high |
| 4B Deeds, hooks, rumours | Planned | Opus 5.5, high |
| 4C Director and pacing | Planned | Opus 5.5, medium |
| 5A Character creation and level-up | Planned | Sonnet 5.5, high |
| 5B Spells | Planned | Opus 5.5, high |
| 5C Polish | Planned | Sonnet 5.5, medium |

3V, 2D and 2E were added on 8 Nov from the playtest notes. PT-030 (a beaten foe comes back unhurt) still has no phase: its first target, 3V, was done before the note was written. The plan doc's "Playtest notes in the plan" table says which note goes in which phase, and "How the mechanisms fit together" lists the rules that keep the new and existing mechanisms working with each other.

**Built so far:** start screen, two premade level 1 heroes, Claude narrator with branched click-to-roll checks, real death saves, rests and potions, scene memory with automatic summaries, Journal (people, places, pinned facts), Quests, time-of-day sky, speech bubbles and sound effects, the "Ask about this world" box, frozen SRD 5.2 rules data and the pure `Combat` engine (2A), the combat screen with click-to-roll attacks and one narrated line per round (2B), creative rulings, XP, loot and deeds (2C), and the knowledge model (3A): five entity kinds, facts with known-by and true or false, secret and reveal events, a scored story packet with secrets tagged, a leak flag, and a hidden narrator self-test (double-click the title on the start screen), and the voice pass (3V): one line per narrator rule (roll only when it matters, fail forward, end on a turn in the scene, companions answer first, several wishes in one reply), the last three failed checks in the packet, story turns of 120 to 180 words when people speak, standing narrator instructions, a Continue chip, summaries that end with open threads, and a self-test on either model, and grid combat (2D): fights on a map of 1.5 m squares with walls, rough ground and cover, the engine owning every position (moves, reach, range, line of sight, opportunity attacks, Disengage, leaving by an edge), the narrator placing everyone in `combat_start` with code snapping invalid squares, a top-down map with tap to move, a turn panel (PT-017), every roll as a card (PT-028), the narrated line under its round (PT-029), and one position line per actor in the round and ruling packets and in the note after a fight. What each phase added, and the bugs found, are in the plan doc under "Handoff".

**Safeguards in place:** save migration on load, two-tab conflict guard, save retry with backoff, isolated panel rendering, per-turn damage cap, self-rebuilding campaign list, all-or-nothing turns on a draft copy, per-event isolation, frozen rules and loot data, cleaned and data-marked narrator packets, render guards, saves tied to the right campaign, saved fights and saved rulings checked before use, ruling caps enforced twice (page and engine), secrets kept out of the Journal, Ask box and chips, a scored packet capped at 800 characters however many facts exist, a story packet trimmed slot by slot (rules 800 tokens, data 1,200), standing instructions capped at 300 characters, cleaned and ranked below the rules, starting squares checked by the engine, a saved fight's map and positions checked on load.

**Not built yet:** everything from 2E on. Scope, tests and prompts for every phase are in the plan doc, section "Build phases and handoffs". Places where the code and the spec differ are in the doc's "Where the code differs from the spec" table; every phase keeps it current.

## How we build

Lean, not cumbersome. Every phase is the smallest change that passes its test, and the game carries nothing the current phase doesn't use. The full list is in the plan doc, section "Build approach". In short: phase scope only, reuse before adding, replace rather than stack, code decides what it can, one-line prompt rules, one file with no new libraries, one test per behaviour, docs hold current state only, and a dead-weight pass at the end of every phase.

## Next phase

Phase 2E in a new chat (Opus 5.5, high). Copy the prompt from the plan doc, section "Prompts", Phase 2E. That is the only copy, so it can't go stale here.

## Links

- Game: https://claude.ai/artifact/B9iV4W58dnXWNTnqeWxLfS
- Design canvas (all screens, palette): https://claude.ai/artifact/6noRj8BvMrEktahFcM8dEp
- Build plan doc (the source of truth): https://claude.ai/artifact/5sSmSL3maiQY9TEhcEmQLS
- Playtest notes doc: https://claude.ai/artifact/NgGBWBEgcFmqjf2mm6rona

## Files in this project

| Path | What it is |
| --- | --- |
| `claude/build-plan.md` | A pointer to the plan doc |
| `claude/game/solo-tales.html` | Current game source, exactly as published (stage 1 + hardening + 2A + review + 2B + 2C + 3A + 3V + 2D) |
| `claude/game/hardening-tests.js` | 280 automated checks, run in Node with jsdom against a fake Claude runtime: `node hardening-tests.js solo-tales.html` (needs `npm i jsdom`). Sections 1-10 hardening, 11-14 phase 2A, 15 phase 2B, 16 phase 2C, 17 phase 3A, 18 phase 3V, 19 phase 2D (13m: the grid rules in the engine). A schema 8 zone fight is embedded as a fixture. Tests queue exact page dice with `window.__dq`. Extend it each phase |
| `claude/design/*.dc.html` | Design mockups: Main (story), Combat, Journal, Spells, Start, Create (character creation), TimeOfDay (phases and palette) |

## Rules for future sessions

1. Always republish the game to the **same** artifact link (read it with the Artifact tool, then publish with its `url`). A new artifact would lose access to existing saves.
2. Saves live in the artifact's database under `data/users/<id>/`: `index`, `prefs`, and `c_<campaign>` with `entities`, `facts`, `deeds` and `log` subcollections. A fight in progress is `combat` inside the campaign doc; its engine state `cs` holds the map (`cs.map`: w, h, cells) and x,y for every actor. A fact carries `known` ("player" and NPC ids), `truth` and `about`. The campaign doc holds the standing narrator instructions as `prefs` (one line, 300 characters). Bump `SCHEMA` (now 9) and extend `migrate()` (or `cleanFact()` for facts) for any change to saved shapes.
3. Capabilities declared: `db`, `user`, `sample`.
4. Content: SRD 5.2 only (CC BY 4.0). Icons from game-icons.net (CC BY 3.0) with credits on the start screen.
5. All state changes go through `transact()`; narrator events go through `applyEvents()`; any text from storage or the player that goes back to Claude goes through `pk()` inside `<game_data>` (player text in `<player_action>`). Every Claude call goes through `ask()` (or logs with `logPrompt()`). Anything shown to the player or sent to the Ask box filters facts with `knows()`; secrets reach the story packet only through `scoredPool()`, tagged.
6. Combat rules go through `Combat`: it reads only its own state and the frozen tables, never `G`. Its state is plain JSON, stored as `G.combat.cs`. Page dice reach it only as its dice script; a skill bonus for a ruling is passed in the command. It owns every grid position: the narrator proposes starting squares in `combat_start`, `Combat.start` checks them, and nothing else moves anyone.
7. One phase per chat. Each phase ends with the dead-weight pass, then updates this README and the plan doc (phase table, Handoff entry, spec-difference table), syncs the game source and tests, and gives the prompt for the next phase by writing it into the plan doc's Prompts section.
8. After 2A, 3A, 2D and 4B, consider a second session to review the diff and run the tests with fresh eyes. (2A: done. 3A and 2D: not yet.)
9. Playtest notes: with every new prompt, read the playtest notes doc first (link above). Implement each Open note whose Target is the current phase, plus any marked "Patch now" that does not change saved shapes. Mark every note you handle as Implemented (date, what changed) or Deferred (reason); leave the rest Open. When the player gives new notes, add them with the next PT number, tags and target, under the right phase heading, keep the count in the doc's lead current, and add the note to the plan doc's "Playtest notes in the plan" table. A note that changes how two mechanisms meet gets a line in "How the mechanisms fit together". Carry this rule into every next-phase prompt.
10. Follow "Build approach" in the plan doc. If a change adds code, prompt text or a saved field, say in the reply why the phase needs it; if it supersedes something, remove the old version in the same phase.

## Decisions so far

- Narration about 80 words, 120 to 180 when people speak (3V). Story turns stay on the quick model: in the 3V A/B on the self-test the strong model wrote fuller outcomes but was not a clear win (it returned one garbled reply). The stronger model stays on a per-turn toggle.
- 3V: the rules are one slot of at most 800 tokens and the data slots share 1,200 (agreed 8 Nov in place of 900 in all). Standing instructions are saved per campaign and change only tone and length. Continue moves the world at least 10 minutes. Failed checks are listed by turns ago, not game time.
- Combat: one narrated line per round; actions as `/commands` with free text for flavour (text after a comma); creative actions resolved as capped rulings.
- Click to roll, English, metric units, Learn mode on by default.
- Full 5e core rules; real character death with death saves. From 2E this applies to allies too.
- Clocks hidden until the player learns of them, then shown in the Journal with time left.
- Director call once per in-game day.
- Default setting: Brookhollow village, changeable from the start screen.
- Look: deep forest green, gold accents, parchment narration; sky band and panel tint follow the time of day; the combat stage is ember-lit.
- NPC colours by attitude: sky blue friendly, grey neutral, ember red hostile; violet for magic.
- Spellcasting waits for phase 5B; 2A left the `/cast` slot (`CAST` in the engine).
- Build split into 15 phases, one per chat, each with one testable outcome (3V, 2D, 2E added 8 Nov).
- Build lean: smallest change per phase, no dead weight (8 Nov).
- 3A adds a small narrator self-test (fixed scenes through the real narrator, checked in state); 3B gives quests a status of rumour, offer or accepted. Both adapt ideas from NaviDnD (non-commercial licence, credited in the plan doc); no code copied.
- 2A: (zones, replaced by the grid in 2D.) A fight ends as "defeat" when the hero drops to 0 HP, and the existing death-save flow takes over. Monsters use average HP. Heroes' masteries: Edda longsword, javelin, battleaxe; Wren shortsword, shortbow. The hero's opportunity attacks are taken automatically.
- 2B: a round in the screen runs from one of the hero's turns to the next, and is narrated when it closes. The narrator can start a fight but never end one or change state during it. A check asked for in the same reply as `combat_start` is dropped. A round costs 6 seconds of in-world time. Thrown weapons and ammunition used in a fight are gone afterwards.
- 2C: rulings use only seven conditions (none that take a turn away); anything cheaper than an action does damage or one effect, not both; a free move can't hurt or hinder; a move that affects a foe needs it within 9 m (6 squares); DCs snap to 10, 13, 15 or 18 and stay hidden until the roll; an improvised attack is STR or DEX plus proficiency, thrown at 6/18 m (4/12 squares). XP counts killed, knocked out and surrendered foes; loot only on victory; deeds get a new `fled` tag.
- 3A: events `fact Text` (`| false` for an untrue belief), `secret Holder | Text`, `reveal fact_id`, `entity item|faction|lore Name | description`. A secret is in the packet only while its holder is present; the scored pool is 800 characters, best first; recency stands in for salience. Narration that states a secret without a reveal is flagged on the log entry, not shown. Fact events are only for what the player needs later. A new fight waits behind an Enter combat button (PT-002); leaving a fight runs one narrator turn from the fight's data (PT-003).
- 2D: squares are x,y from 1,1 in the north-west; every creature takes one square; a wall blocks movement and shots, cover is +2 AC against ranged attacks for whoever stands on it, rough ground costs double. `/retreat` runs for an edge and one more step leaves the map, at any time (through 2C only when every foe was far); a fleeing foe does the same. A foe without a square starts 6 squares east of the hero; the words engaged, near and far in `combat_start` are ignored. Roll cards show the hero's hit points as a number and a foe's state as a word. A round no longer saves its dice list. A saved zone fight goes onto a 20 by 20 map with the hero at 4,10. Rulings: within 6 squares, push or pull up to 2, thrown 4/12, 2C caps kept (the simulation gives the same win rates on the grid).
- Planned: 2E: allies in the Combat state with SRD stat blocks; the hero keeps full XP. 3C adds a check lock: a repeat of a failed check returns the saved result until something changes.
- Not built yet, noted for later: Fighting Style, Halfling Luck, magic weapon bonuses, grappling, Action Surge, recovering ammunition after a fight, monster variants beyond the 11 SRD stat blocks, picking up a dropped weapon, loot tables as published files.
- Gaps found in the 2A review, not reachable in play yet (nothing equips narrator items), left for when equipping arrives: a two-handed weapon can be used with a shield equipped; untrained armour gives no Disadvantage on out-of-combat checks; a second stack of the same weapon (e.g. "Dagger" and "Rusty dagger") isn't used once the first is spent; darts always use DEX. Every foe currently Disengages before leaving the hero's reach, so the hero's own opportunity attack has no live test yet.
