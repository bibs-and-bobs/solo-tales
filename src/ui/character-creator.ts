/* Interactive Character Creation Screen:
   Races + Perks, Classes + Perks + Skills, Balanced 4d6 Stat Roller,
   AI-assisted Backstory Builder, and Live Character Sheet Preview. */

import type { ImageRouter } from "../adapters/image/image-router";
import type { ModelRouter } from "../adapters/llm";
import type { GameStore } from "../adapters/storage";
import {
  ABIL,
  ABIL_NAME,
  BACKGROUNDS,
  CLASSES,
  RACES,
  STANDARD_ARRAY,
  buildCreatedCharacter,
  mod,
  nice,
  rid,
  rollBalancedStats,
  sign,
  str,
  type AbilityKey,
  type BalancedRollResult,
  type CampaignBundle,
  type CharacterState
} from "../engine";
import { ARCHETYPE_PROFILES, createQuickStartSeed } from "../narrator";
import { UI_PATHS, heraldicShieldSvg, lineIcon } from "./chrome";
import { el, put, toast, type PortraitUrlCache } from "./dom";

export interface CharacterCreatorContext {
  router: ModelRouter;
  imageRouter: ImageRouter;
  store: GameStore;
  portraits: PortraitUrlCache;
  onBack: () => void;
  onOpenSettings: () => void;
  onCreated: (bundle: CampaignBundle) => Promise<void>;
}

type CreatorStep = 1 | 2 | 3 | 4;

const RANDOM_NAMES: Record<string, string[]> = {
  human: ["Alden Mercer", "Rowan Vance", "Edda Vane", "Garrick Thorne", "Clara Ashworth"],
  elf: ["Sylvaris Vale", "Lirael Moonwhisper", "Theren Oakhaven", "Aelar Windbough"],
  dwarf: ["Torin Ironfoot", "Brynja Stonehelm", "Dain Coppervein", "Helga Deepdelver"],
  halfling: ["Wren Ashby", "Milo Tealeaf", "Pippa Bramble", "Corin Goodbarrel"],
  tiefling: ["Mordai Ashveil", "Kallista Ember", "Damakos Reed", "Orianna Dusk"],
  dragonborn: ["Rhogar Flamecrest", "Akra Stormscale", "Bharash Ironclaw", "Sora Ashwing"]
};

export function renderCharacterCreator(container: HTMLElement, ctx: CharacterCreatorContext): void {
  let step: CreatorStep = 1;

  let raceId = RACES[0].id;
  let racePerkId = RACES[0].perks[0].id;
  let classId = CLASSES[0].id;
  let classPerkId = CLASSES[0].perks[0].id;
  let backgroundId = BACKGROUNDS[0].id;

  let chosenSkills: string[] = CLASSES[0].skillChoices.slice(0, CLASSES[0].skillCount);
  let chosenExpertise: string[] = [];

  let statMode: "rolled" | "array" = "rolled";
  let lastRoll: BalancedRollResult = rollBalancedStats();
  let poolValues: number[] = [...lastRoll.scores];
  // assignment[ability] = index into poolValues (0..5)
  let assignment: Record<AbilityKey, number> = autoAssignPool(poolValues, CLASSES[0].recommendedOrder);

  let heroName = "Alden Mercer";
  let appearance = "";
  let backstory = "";
  let backstoryBusy = false;
  let campaignName = ARCHETYPE_PROFILES.frontier_mystery.defaultCampaignName;
  let premise = ARCHETYPE_PROFILES.frontier_mystery.defaultPremise;
  let learnMode = true;
  let portraitBlobId: string | null = null;
  let portraitUrl: string | null = null;

  function currentRace() {
    return RACES.find(r => r.id === raceId) || RACES[0];
  }
  function currentClass() {
    return CLASSES.find(c => c.id === classId) || CLASSES[0];
  }
  function currentBg() {
    return BACKGROUNDS.find(b => b.id === backgroundId) || BACKGROUNDS[0];
  }

  function autoAssignPool(values: number[], order: readonly AbilityKey[]): Record<AbilityKey, number> {
    const sortedIndices = values
      .map((val, idx) => ({ val, idx }))
      .sort((a, b) => b.val - a.val)
      .map(x => x.idx);
    const out = {} as Record<AbilityKey, number>;
    order.forEach((ab, i) => {
      out[ab] = sortedIndices[i];
    });
    return out;
  }

  function baseAbilRecord(): Record<AbilityKey, number> {
    const out = {} as Record<AbilityKey, number>;
    for (const k of ABIL) {
      out[k] = poolValues[assignment[k]] ?? 10;
    }
    return out;
  }

  function buildPreviewChar(): CharacterState {
    return buildCreatedCharacter({
      name: heroName,
      raceId,
      racePerkId,
      classId,
      classPerkId,
      backgroundId,
      baseAbil: baseAbilRecord(),
      chosenSkills,
      chosenExpertise,
      appearance,
      backstory,
      portraitId: portraitBlobId
    });
  }

  function refreshHeraldicPortrait(): void {
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return;
    const r = currentRace();
    const c = currentClass();
    const bg = currentBg();
    const gen = ctx.imageRouter.createHeraldicPortrait(
      {
        kind: "hero",
        name: heroName || "Wanderer",
        species: r.name,
        cls: c.name,
        role: bg.name,
        appearance: appearance || `${r.name} ${c.name.toLowerCase()}`,
        attitude: "neutral"
      },
      ARCHETYPE_PROFILES.frontier_mystery.defaultArtBrief
    );
    const id = portraitBlobId || "portrait_hero_" + rid();
    portraitBlobId = id;
    portraitUrl = ctx.portraits.putBlobUrl(id, gen.blob);
    ctx.store.putBlob(id, gen.blob).catch(() => {});
  }

  refreshHeraldicPortrait();

  function swapAbilitySlot(targetAbil: AbilityKey, newPoolIndex: number): void {
    const oldPoolIndex = assignment[targetAbil];
    if (oldPoolIndex === newPoolIndex) return;
    const otherAbil = ABIL.find(k => assignment[k] === newPoolIndex);
    if (otherAbil) {
      assignment[otherAbil] = oldPoolIndex;
    }
    assignment[targetAbil] = newPoolIndex;
    render();
  }

  async function generateOrFinishBackstory(): Promise<void> {
    if (backstoryBusy) return;
    const preview = buildPreviewChar();
    const draft = backstory.trim();
    const connections = ctx.router.getEnabledConnections();

    if (connections.length === 0) {
      // Friendly deterministic fallback when no LLM is connected
      const r = currentRace();
      const c = currentClass();
      const bg = currentBg();
      const fallback = draft
        ? `${draft}\n\nAs a ${r.name} ${c.name.toLowerCase()} shaped by years as a ${bg.name.toLowerCase()}, ${preview.name} now carries hard-won instincts and an unfinished debt into ${campaignName || "the borderlands"}.`
        : `${preview.name} grew up among ${r.name.toLowerCase()} folk before life as a ${bg.name.toLowerCase()} forged the grit of a ${c.name.toLowerCase()}. Driven by a quiet promise and a pack of weathered gear, ${preview.name} now arrives in ${campaignName || "Brookhollow"} looking for answers.`;
      backstory = fallback;
      toast("No AI model connected — generated a starter backstory locally. Connect a model in Settings for full AI writing.");
      render();
      return;
    }

    backstoryBusy = true;
    render();
    try {
      const system =
        "You are a grounded tabletop RPG character writer. Write a concise, evocative 2-paragraph character backstory in plain, vivid prose (no purple prose, no clichés). Keep it under 180 words.";
      const user = [
        `Character: ${preview.name} (${preview.species} ${preview.cls}, Background: ${preview.bg})`,
        `Perks: ${(preview.perks || []).join("; ")}`,
        `Stats: STR ${preview.abil.str}, DEX ${preview.abil.dex}, CON ${preview.abil.con}, INT ${preview.abil.int}, WIS ${preview.abil.wis}, CHA ${preview.abil.cha}`,
        appearance.trim() ? `Appearance: ${appearance.trim()}` : "",
        draft
          ? `The player wrote this prompt/opening—seamlessly finish and expand it into a complete 2-paragraph backstory:\n"${draft}"`
          : "Write a fresh, grounded 2-paragraph backstory explaining how they became an adventurer and what draws them toward trouble."
      ]
        .filter(Boolean)
        .join("\n");

      const res = await ctx.router.complete({
        task: "story_turn",
        system,
        user,
        maxOutputTokens: 350,
        temperature: 0.85
      });

      const out = (res.text || "").trim();
      if (out) {
        backstory = out;
        toast("Backstory crafted.");
      } else {
        toast("Model returned an empty backstory. Try again.");
      }
    } catch (err: any) {
      toast(err?.message || "Could not generate backstory.");
    } finally {
      backstoryBusy = false;
      render();
    }
  }

  async function finishAndStart(): Promise<void> {
    const customChar = buildPreviewChar();
    const profile = ARCHETYPE_PROFILES.frontier_mystery;
    const seeded = createQuickStartSeed({
      campaignName: str(campaignName, 40) || profile.defaultCampaignName,
      heroKey: customChar.cls.toLowerCase() === "rogue" ? "rogue" : "fighter",
      heroName: customChar.name,
      heroAppearance: customChar.appearance,
      heroPortraitId: portraitBlobId,
      customChar,
      flavour: {
        archetype: "frontier_mystery",
        tone: profile.defaultTone,
        magicLevel: profile.defaultMagic,
        pillars: { ...profile.defaultPillars },
        customPremise: str(premise, 400) || profile.defaultPremise
      },
      stylePresetOverride: profile.defaultArtBrief.stylePreset
    });
    const created = seeded.bundle;
    created.campaign.learn = learnMode;
    await ctx.store.saveBundle(created, rid(), 0);
    await ctx.onCreated(created);
  }

  function renderStep1(): HTMLElement {
    const race = currentRace();
    return el(
      "div",
      { style: "display:flex;flex-direction:column;gap:18px" },
      el(
        "div",
        null,
        el("h2", { class: "st-h", style: "margin:0", text: "Choose your race & racial perk" }),
        el("p", { class: "st-pl", style: "margin:4px 0 0", text: "Your heritage shapes your base abilities, speed, and a signature racial perk." })
      ),
      el(
        "div",
        { class: "st-cc-grid" },
        ...RACES.map(r => {
          const selected = r.id === raceId;
          const bonusTxt = ABIL.filter(k => (r.abilityBonuses[k] || 0) > 0)
            .map(k => `+${r.abilityBonuses[k]} ${k.toUpperCase()}`)
            .join(", ");
          return el(
            "button",
            {
              type: "button",
              class: "st-hero-pick",
              "aria-pressed": selected ? "true" : "false",
              onclick: () => {
                raceId = r.id;
                racePerkId = r.perks[0].id;
                render();
              }
            },
            el(
              "div",
              { style: "display:flex;justify-content:space-between;align-items:center;width:100%" },
              el("strong", { class: "st-fr", style: "font-size:21px", text: r.name }),
              selected ? lineIcon(UI_PATHS.check, 18) : el("span", { class: "st-pl", text: `${r.speed} m` })
            ),
            el("span", { class: "st-pl", text: `${bonusTxt} · Size ${r.size}` }),
            el("span", { class: "st-gd", style: "font-size:15px;line-height:1.4", text: r.tagline })
          );
        })
      ),
      el(
        "div",
        { class: "st-cc-card" },
        el("div", { class: "st-lbl", text: `${race.name} Perks · Pick one` }),
        el(
          "div",
          { class: "st-cc-perk-grid" },
          ...race.perks.map(p => {
            const active = p.id === racePerkId;
            return el(
              "button",
              {
                type: "button",
                class: "st-hero-pick",
                "aria-pressed": active ? "true" : "false",
                onclick: () => {
                  racePerkId = p.id;
                  render();
                }
              },
              el("strong", { style: "font-size:15px", text: p.name }),
              el("span", { class: "st-pl", text: p.summary })
            );
          })
        )
      )
    );
  }

  function renderStep2(): HTMLElement {
    const cls = currentClass();
    return el(
      "div",
      { style: "display:flex;flex-direction:column;gap:18px" },
      el(
        "div",
        null,
        el("h2", { class: "st-h", style: "margin:0", text: "Choose your class, perk & skills" }),
        el("p", { class: "st-pl", style: "margin:4px 0 0", text: "Your class determines your hit die, saving throws, starting gear, and combat style." })
      ),
      el(
        "div",
        { class: "st-cc-grid" },
        ...CLASSES.map(c => {
          const selected = c.id === classId;
          return el(
            "button",
            {
              type: "button",
              class: "st-hero-pick",
              "aria-pressed": selected ? "true" : "false",
              onclick: () => {
                classId = c.id;
                classPerkId = c.perks[0].id;
                chosenSkills = c.skillChoices.slice(0, c.skillCount);
                chosenExpertise = chosenSkills.slice(0, c.expertiseCount);
                assignment = autoAssignPool(poolValues, c.recommendedOrder);
                render();
              }
            },
            el(
              "div",
              { style: "display:flex;justify-content:space-between;align-items:center;width:100%" },
              el("strong", { class: "st-fr", style: "font-size:21px", text: c.name }),
              selected ? lineIcon(UI_PATHS.check, 18) : el("span", { class: "st-pl", text: `d${c.hitDie}` })
            ),
            el("span", { class: "st-pl", text: `Primary: ${c.primaryAbil.toUpperCase()} · Saves: ${c.saves.map(s => s.toUpperCase()).join(", ")}` }),
            el("span", { class: "st-gd", style: "font-size:15px;line-height:1.4", text: c.tagline })
          );
        })
      ),
      el(
        "div",
        { class: "st-cc-card" },
        el("div", { class: "st-lbl", text: `${cls.name} Perks · Pick one` }),
        el(
          "div",
          { class: "st-cc-perk-grid" },
          ...cls.perks.map(p => {
            const active = p.id === classPerkId;
            return el(
              "button",
              {
                type: "button",
                class: "st-hero-pick",
                "aria-pressed": active ? "true" : "false",
                onclick: () => {
                  classPerkId = p.id;
                  render();
                }
              },
              el("strong", { style: "font-size:15px", text: p.name }),
              el("span", { class: "st-pl", text: p.summary })
            );
          })
        ),
        el("div", { class: "st-lbl", style: "margin-top:8px", text: `Class Skills · Pick ${cls.skillCount} (${chosenSkills.length}/${cls.skillCount})` }),
        el(
          "div",
          { style: "display:flex;flex-wrap:wrap;gap:8px" },
          ...cls.skillChoices.map(sk => {
            const active = chosenSkills.includes(sk);
            return el(
              "button",
              {
                type: "button",
                class: active ? "st-chip-btn is-active" : "st-chip-btn",
                "aria-pressed": active ? "true" : "false",
                onclick: () => {
                  if (active) {
                    chosenSkills = chosenSkills.filter(s => s !== sk);
                    chosenExpertise = chosenExpertise.filter(s => s !== sk);
                  } else if (chosenSkills.length < cls.skillCount) {
                    chosenSkills = [...chosenSkills, sk];
                  } else {
                    chosenSkills = [...chosenSkills.slice(1), sk];
                    chosenExpertise = chosenExpertise.filter(s => chosenSkills.includes(s));
                  }
                  render();
                }
              },
              nice(sk)
            );
          })
        ),
        cls.expertiseCount > 0
          ? el(
              "div",
              { style: "display:flex;flex-direction:column;gap:8px;margin-top:6px" },
              el("div", { class: "st-lbl", text: `Expertise (double proficiency) · Pick ${cls.expertiseCount}` }),
              el(
                "div",
                { style: "display:flex;flex-wrap:wrap;gap:8px" },
                ...chosenSkills.map(sk => {
                  const active = chosenExpertise.includes(sk);
                  return el(
                    "button",
                    {
                      type: "button",
                      class: active ? "st-chip-btn is-active" : "st-chip-btn",
                      "aria-pressed": active ? "true" : "false",
                      onclick: () => {
                        if (active) {
                          chosenExpertise = chosenExpertise.filter(s => s !== sk);
                        } else if (chosenExpertise.length < cls.expertiseCount) {
                          chosenExpertise = [...chosenExpertise, sk];
                        } else {
                          chosenExpertise = [...chosenExpertise.slice(1), sk];
                        }
                        render();
                      }
                    },
                    `${nice(sk)} ★`
                  );
                })
              )
            )
          : null
      )
    );
  }

  function renderStep3(): HTMLElement {
    const race = currentRace();
    const cls = currentClass();
    const racePerk = race.perks.find(p => p.id === racePerkId) || race.perks[0];
    const clsPerk = cls.perks.find(p => p.id === classPerkId) || cls.perks[0];
    const sum = poolValues.reduce((a, b) => a + b, 0);
    const modSum = poolValues.reduce((a, b) => a + mod(b), 0);

    return el(
      "div",
      { style: "display:flex;flex-direction:column;gap:18px" },
      el(
        "div",
        { style: "display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px" },
        el(
          "div",
          null,
          el("h2", { class: "st-h", style: "margin:0", text: "Roll & assign ability scores" }),
          el("p", {
            class: "st-pl",
            style: "margin:4px 0 0",
            text: "Balanced 4d6-drop-lowest keeps total scores between 72 and 78 (modifiers +4 to +8) so every hero is viable."
          })
        ),
        el(
          "div",
          { style: "display:flex;gap:8px;flex-wrap:wrap" },
          el(
            "button",
            {
              type: "button",
              class: "st-btn-gold",
              "data-action": "roll-stats",
              onclick: () => {
                statMode = "rolled";
                lastRoll = rollBalancedStats();
                poolValues = [...lastRoll.scores];
                assignment = autoAssignPool(poolValues, cls.recommendedOrder);
                render();
              }
            },
            "Roll Balanced Stats"
          ),
          el(
            "button",
            {
              type: "button",
              class: "st-btn-quiet",
              onclick: () => {
                statMode = "array";
                poolValues = [...STANDARD_ARRAY];
                assignment = autoAssignPool(poolValues, cls.recommendedOrder);
                render();
              }
            },
            "Use Standard Array"
          ),
          el(
            "button",
            {
              type: "button",
              class: "st-btn-quiet",
              onclick: () => {
                assignment = autoAssignPool(poolValues, cls.recommendedOrder);
                render();
              }
            },
            `Auto-assign for ${cls.name}`
          )
        )
      ),

      statMode === "rolled"
        ? el(
            "div",
            { class: "st-cc-card" },
            el(
              "div",
              { style: "display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px" },
              el("span", { class: "st-lbl", text: "Rolled Dice Pool (4d6 drop lowest)" }),
              el("span", { class: "st-pl", text: `Total ${sum} · Modifiers ${sign(modSum)}` })
            ),
            el(
              "div",
              { class: "st-cc-dice-row" },
              ...lastRoll.slots.map((slot, idx) =>
                el(
                  "div",
                  { class: "st-cc-die-slot" },
                  el("strong", { class: "st-fr", style: "font-size:22px", text: String(poolValues[idx]) }),
                  el(
                    "div",
                    { class: "st-pl", style: "font-size:12px" },
                    ...slot.dice.map((d, di) =>
                      el(
                        "span",
                        {
                          style: di === slot.droppedIndex
                            ? "text-decoration:line-through;opacity:0.45;margin:0 2px"
                            : "margin:0 2px"
                        },
                        String(d)
                      )
                    )
                  )
                )
              )
            )
          )
        : null,

      el(
        "div",
        { class: "st-cc-abil-assign" },
        ...ABIL.map(k => {
          const base = poolValues[assignment[k]];
          const bonus =
            (race.abilityBonuses[k] || 0) +
            (racePerk.effects.abil?.[k] || 0) +
            (clsPerk.effects.abil?.[k] || 0);
          const total = Math.min(20, base + bonus);
          const m = mod(total);

          return el(
            "div",
            { class: "st-cc-abil-row" },
            el(
              "div",
              null,
              el("strong", { style: "font-size:16px", text: ABIL_NAME[k] }),
              bonus > 0
                ? el("div", { class: "st-pl", text: `Base ${base} + ${bonus} racial/perk` })
                : el("div", { class: "st-pl", text: `Base ${base}` })
            ),
            el(
              "select",
              {
                class: "st-hand-input",
                style: "width:auto;min-width:92px;min-height:38px;padding:4px 8px",
                "aria-label": `${ABIL_NAME[k]} base score`,
                onchange: (e: Event) => {
                  const idx = Number((e.target as HTMLSelectElement).value);
                  swapAbilitySlot(k, idx);
                }
              },
              ...poolValues.map((val, idx) =>
                el(
                  "option",
                  { value: String(idx), selected: assignment[k] === idx },
                  `${val} (${sign(mod(val))})`
                )
              )
            ),
            el(
              "div",
              { style: "text-align:right;min-width:64px" },
              el("div", { class: "st-fr", style: "font-size:22px;font-weight:700", text: String(total) }),
              el("div", { class: "st-pl", text: sign(m) })
            )
          );
        })
      )
    );
  }

  function renderStep4(): HTMLElement {
    const race = currentRace();
    return el(
      "div",
      { style: "display:flex;flex-direction:column;gap:16px" },
      el(
        "div",
        null,
        el("h2", { class: "st-h", style: "margin:0", text: "Identity, background & backstory" }),
        el("p", { class: "st-pl", style: "margin:4px 0 0", text: "Write your own backstory, or type a few sentences and let the AI narrator finish it." })
      ),
      el(
        "div",
        { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px" },
        el(
          "div",
          { style: "display:flex;flex-direction:column;gap:4px" },
          el("label", { class: "st-lbl", for: "cc-name", text: "Character Name" }),
          el(
            "div",
            { style: "display:flex;gap:6px" },
            el("input", {
              id: "cc-name",
              class: "st-hand-input",
              value: heroName,
              maxlength: 30,
              oninput: (e: Event) => {
                heroName = (e.target as HTMLInputElement).value;
                updateSheetPreviewOnly();
              }
            }),
            el(
              "button",
              {
                type: "button",
                class: "st-btn-quiet",
                onclick: () => {
                  const pool = RANDOM_NAMES[race.id] || RANDOM_NAMES.human;
                  heroName = pool[Math.floor(Math.random() * pool.length)];
                  refreshHeraldicPortrait();
                  render();
                }
              },
              "Random"
            )
          )
        ),
        el(
          "div",
          { style: "display:flex;flex-direction:column;gap:4px" },
          el("label", { class: "st-lbl", for: "cc-bg", text: "Background" }),
          el(
            "select",
            {
              id: "cc-bg",
              class: "st-hand-input",
              onchange: (e: Event) => {
                backgroundId = (e.target as HTMLSelectElement).value;
                render();
              }
            },
            ...BACKGROUNDS.map(b =>
              el("option", { value: b.id, selected: b.id === backgroundId }, `${b.name} (+${b.bonusGold} gp)`)
            )
          )
        )
      ),
      el(
        "div",
        { style: "display:flex;flex-direction:column;gap:4px" },
        el("label", { class: "st-lbl", for: "cc-look", text: "Appearance (optional)" }),
        el("input", {
          id: "cc-look",
          class: "st-hand-input",
          placeholder: "Weathered cloak, scarred brow, brass compass...",
          value: appearance,
          maxlength: 240,
          oninput: (e: Event) => {
            appearance = (e.target as HTMLInputElement).value;
          }
        })
      ),
      el(
        "div",
        { class: "st-cc-card" },
        el(
          "div",
          { style: "display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px" },
          el("label", { class: "st-lbl", for: "cc-backstory", text: "Backstory (write your own or give a short prompt)" }),
          el(
            "button",
            {
              type: "button",
              class: "st-btn-gold",
              "data-action": "generate-backstory",
              disabled: backstoryBusy,
              onclick: () => void generateOrFinishBackstory()
            },
            backstoryBusy
              ? "Writing..."
              : backstory.trim()
                ? "Finish Backstory with AI"
                : "Generate Backstory with AI"
          )
        ),
        el("textarea", {
          id: "cc-backstory",
          class: "st-hand-input",
          rows: "5",
          style: "height:auto;resize:vertical;line-height:1.5",
          placeholder: "Write your full backstory here, or type 1–3 sentences (e.g. 'Former bridge-guard who lost her brother in the flood...') and click Finish Backstory with AI.",
          oninput: (e: Event) => {
            backstory = (e.target as HTMLTextAreaElement).value;
            updateSheetPreviewOnly();
          }
        }, backstory)
      ),
      el(
        "div",
        { style: "display:grid;grid-template-columns:1fr;gap:8px" },
        el("label", { class: "st-lbl", for: "cc-premise", text: "Starting Tale & Place" }),
        el("textarea", {
          id: "cc-premise",
          class: "st-hand-input",
          rows: "2",
          style: "height:auto;resize:none",
          oninput: (e: Event) => {
            premise = (e.target as HTMLTextAreaElement).value;
          }
        }, premise),
        el(
          "label",
          { style: "display:flex;align-items:center;gap:8px;font-size:15px;cursor:pointer" },
          el("input", {
            type: "checkbox",
            checked: learnMode,
            style: "width:18px;height:18px;accent-color:var(--st-accent-player)",
            onchange: (e: Event) => {
              learnMode = (e.target as HTMLInputElement).checked;
            }
          }),
          "Explain the rules as I play"
        )
      )
    );
  }

  function renderLiveSheet(): HTMLElement {
    const ch = buildPreviewChar();
    const portraitNode = portraitUrl
      ? el("img", {
          src: portraitUrl,
          alt: `${ch.name} portrait`,
          class: "st-portrait-thumb",
          style: "width:56px;height:64px"
        })
      : heraldicShieldSvg();

    return el(
      "aside",
      { class: "st-cc-sheet", "data-slot": "cc-sheet" },
      el("div", { class: "st-lbl", text: "Live Character Sheet" }),
      el(
        "div",
        { style: "display:flex;align-items:center;gap:12px" },
        portraitNode,
        el(
          "div",
          null,
          el("div", { class: "st-fr", style: "font-size:22px;font-weight:700;line-height:1.1", text: ch.name || "Unnamed" }),
          el("div", { class: "st-pl", text: `${ch.species} ${ch.cls} · Level ${ch.level}` }),
          el("div", { class: "st-pl", text: ch.bg })
        )
      ),
      el(
        "div",
        { class: "st-cc-vitals" },
        el("div", { class: "st-cc-vital" }, el("span", { class: "st-pl", text: "HP" }), el("strong", { class: "st-fr", text: String(ch.maxHp) })),
        el("div", { class: "st-cc-vital" }, el("span", { class: "st-pl", text: "AC" }), el("strong", { class: "st-fr", text: String(ch.ac) })),
        el("div", { class: "st-cc-vital" }, el("span", { class: "st-pl", text: "Speed" }), el("strong", { class: "st-fr", text: `${ch.speed} m` })),
        el("div", { class: "st-cc-vital" }, el("span", { class: "st-pl", text: "Gold" }), el("strong", { class: "st-fr", text: `${ch.gold} gp` }))
      ),
      el(
        "div",
        { class: "st-cc-stat-mini" },
        ...ABIL.map(k =>
          el(
            "div",
            { class: "st-cc-stat-box" },
            el("span", { class: "st-pl", style: "font-size:11px", text: k.toUpperCase() }),
            el("strong", { style: "font-size:16px", text: String(ch.abil[k]) }),
            el("span", { class: "st-pl", style: "font-size:12px", text: sign(mod(ch.abil[k])) })
          )
        )
      ),
      el(
        "div",
        { class: "st-cc-sheet-sec" },
        el("div", { class: "st-lbl", text: "Perks" }),
        ...(ch.perks || []).map(pk => el("div", { style: "font-size:13px;line-height:1.4", text: pk }))
      ),
      el(
        "div",
        { class: "st-cc-sheet-sec" },
        el("div", { class: "st-lbl", text: "Skills" }),
        el("div", { style: "font-size:13px;line-height:1.45", text: ch.skills.map(s => nice(s) + (ch.expertise.includes(s) ? " ★" : "")).join(" · ") })
      ),
      el(
        "div",
        { class: "st-cc-sheet-sec" },
        el("div", { class: "st-lbl", text: "Starting Gear" }),
        el("div", { style: "font-size:13px;line-height:1.45", text: ch.inv.map(i => (i.qty > 1 ? `${i.name} ×${i.qty}` : i.name)).join(", ") })
      ),
      ch.backstory
        ? el(
            "div",
            { class: "st-cc-sheet-sec" },
            el("div", { class: "st-lbl", text: "Backstory" }),
            el("div", { class: "st-gd", style: "font-size:14px;line-height:1.45;white-space:pre-line", text: ch.backstory })
          )
        : null,
      el(
        "button",
        {
          type: "button",
          class: "st-btn-primary",
          "data-action": "begin-adventure",
          style: "width:100%;min-height:48px;margin-top:auto",
          onclick: () => void finishAndStart()
        },
        "Begin Adventure"
      )
    );
  }

  let sheetHost: HTMLElement | null = null;
  function updateSheetPreviewOnly(): void {
    if (!sheetHost) return;
    const next = renderLiveSheet();
    sheetHost.replaceWith(next);
    sheetHost = next;
  }

  function render(): void {
    const stepsMeta: Array<{ n: CreatorStep; label: string }> = [
      { n: 1, label: "1. Race & Perks" },
      { n: 2, label: "2. Class & Skills" },
      { n: 3, label: "3. Roll Stats" },
      { n: 4, label: "4. Backstory" }
    ];

    const header = el(
      "header",
      { class: "st-cc-header" },
      el(
        "div",
        { style: "display:flex;align-items:center;gap:12px" },
        el(
          "button",
          { type: "button", class: "st-btn-quiet", onclick: ctx.onBack },
          "← Back"
        ),
        el("h1", { class: "st-fr", style: "margin:0;font-size:26px", text: "Create Character" })
      ),
      el(
        "nav",
        { class: "st-cc-steps", "aria-label": "Character creation steps" },
        ...stepsMeta.map(s =>
          el(
            "button",
            {
              type: "button",
              class: s.n === step ? "st-chip-btn is-active" : "st-chip-btn",
              "aria-current": s.n === step ? "step" : undefined,
              onclick: () => {
                step = s.n;
                render();
              }
            },
            s.label
          )
        )
      ),
      el(
        "button",
        { type: "button", class: "st-btn-quiet", onclick: ctx.onOpenSettings },
        lineIcon(UI_PATHS.sliders, 16),
        el("span", { text: "Settings" })
      )
    );

    const stepBody =
      step === 1
        ? renderStep1()
        : step === 2
          ? renderStep2()
          : step === 3
            ? renderStep3()
            : renderStep4();

    const footerNav = el(
      "div",
      { style: "display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding-top:14px;border-top:1px solid var(--st-rule-light)" },
      step > 1
        ? el(
            "button",
            {
              type: "button",
              class: "st-btn-quiet",
              onclick: () => {
                step = (step - 1) as CreatorStep;
                render();
              }
            },
            "← Previous"
          )
        : el("span"),
      step < 4
        ? el(
            "button",
            {
              type: "button",
              class: "st-btn-primary",
              onclick: () => {
                step = (step + 1) as CreatorStep;
                render();
              }
            },
            "Next →"
          )
        : el(
            "button",
            {
              type: "button",
              class: "st-btn-primary",
              onclick: () => void finishAndStart()
            },
            "Begin Adventure"
          )
    );

    sheetHost = renderLiveSheet();

    put(
      container,
      el(
        "div",
        { "data-stage": "create", class: "st-cc-shell" },
        header,
        el(
          "div",
          { class: "st-cc-layout" },
          el("main", { class: "st-cc-main" }, stepBody, footerNav),
          sheetHost
        )
      )
    );
  }

  render();
}
