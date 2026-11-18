/* Behind-the-Screen Campaign Flavour Picker, Hero Portrait Studio & Resumable 3-Step Prep UI. */

import type { ImageRouter } from "../adapters/image/image-router";
import type { ModelRouter } from "../adapters/llm";
import type { GameStore } from "../adapters/storage";
import {
  HEROES,
  TONES,
  rid,
  str,
  type CampaignBundle,
  type CampaignFlavour,
  type PortraitStylePreset,
  type SettingArchetype
} from "../engine";
import {
  ARCHETYPE_PROFILES,
  CampaignPrepPipeline,
  OPENING_DIRECTOR_PROMPT,
  createQuickStartSeed,
  requestStoryTurn,
  type PrepProgressEvent,
  type PrepSessionState,
  type SubjectSpec
} from "../narrator";
import { $, el, put, toast, type PortraitUrlCache } from "./dom";
import { svgIcon } from "./icons";

export interface PrepStudioContext {
  router: ModelRouter;
  imageRouter: ImageRouter;
  store: GameStore;
  portraits: PortraitUrlCache;
  onOpenSettings: () => void;
  onCampaignReady: (bundle: CampaignBundle) => Promise<void>;
}

interface StepViewState {
  status: "idle" | "running" | "done" | "error";
  message: string;
  detail?: string;
}

export function createPrepStudioCard(ctx: PrepStudioContext): HTMLElement {
  const host = el("div", { class: "card" });

  let archetype: SettingArchetype = "frontier_mystery";
  let campaignName = ARCHETYPE_PROFILES.frontier_mystery.defaultCampaignName;
  let tone = ARCHETYPE_PROFILES.frontier_mystery.defaultTone;
  let magicLevel: CampaignFlavour["magicLevel"] = ARCHETYPE_PROFILES.frontier_mystery.defaultMagic;
  let pillars = { ...ARCHETYPE_PROFILES.frontier_mystery.defaultPillars };
  let customPremise = ARCHETYPE_PROFILES.frontier_mystery.defaultPremise;

  let heroKey: "fighter" | "rogue" = "fighter";
  let heroName = HEROES.fighter.name;
  let heroAppearance = HEROES.fighter.appearance || "";
  let stylePreset: PortraitStylePreset = ARCHETYPE_PROFILES.frontier_mystery.defaultArtBrief.stylePreset;
  let portraitBlobId: string | null = null;
  let portraitPreviewUrl: string | null = null;
  let portraitSourceLabel = "Heraldic Crest";
  let portraitBusy = false;

  let prepBusy = false;
  let prepSession: PrepSessionState | null = null;
  let prepAbort: AbortController | null = null;
  let steps: Record<1 | 2 | 3, StepViewState> = {
    1: { status: "idle", message: "1. World Spine, Hidden Clocks & Visual Brief" },
    2: { status: "idle", message: "2. Places, NPC Agendas, Secrets & Foe Roster" },
    3: { status: "idle", message: "3. Opening Scene" }
  };

  function currentSubject(): SubjectSpec {
    const h = HEROES[heroKey];
    return {
      kind: "hero",
      name: heroName || h.name,
      species: h.species,
      cls: h.cls,
      role: h.bg,
      appearance: heroAppearance || h.appearance || "",
      attitude: "neutral"
    };
  }

  function ensureHeraldicPreview(): void {
    const arch = ARCHETYPE_PROFILES[archetype];
    const gen = ctx.imageRouter.createHeraldicPortrait(currentSubject(), {
      ...arch.defaultArtBrief,
      stylePreset
    });
    const id = portraitBlobId || "portrait_hero_" + rid();
    portraitBlobId = id;
    portraitPreviewUrl = ctx.portraits.putBlobUrl(id, gen.blob);
    portraitSourceLabel = gen.providerLabel;
    ctx.store.putBlob(id, gen.blob).catch(() => {});
  }

  ensureHeraldicPreview();

  function selectArchetype(next: SettingArchetype): void {
    archetype = next;
    const p = ARCHETYPE_PROFILES[next];
    campaignName = p.defaultCampaignName;
    tone = p.defaultTone;
    magicLevel = p.defaultMagic;
    pillars = { ...p.defaultPillars };
    customPremise = p.defaultPremise;
    stylePreset = p.defaultArtBrief.stylePreset;
    prepSession = null;
    if (portraitSourceLabel === "Built-in Heraldic Crest") {
      ensureHeraldicPreview();
    }
    render();
  }

  function selectHero(next: "fighter" | "rogue"): void {
    heroKey = next;
    heroName = HEROES[next].name;
    heroAppearance = HEROES[next].appearance || "";
    prepSession = null;
    if (portraitSourceLabel === "Built-in Heraldic Crest") {
      ensureHeraldicPreview();
    }
    render();
  }

  async function handleGenerateAiPortrait(): Promise<void> {
    if (portraitBusy) return;
    portraitBusy = true;
    render();
    try {
      const arch = ARCHETYPE_PROFILES[archetype];
      const gen = await ctx.imageRouter.generatePortrait(
        currentSubject(),
        { ...arch.defaultArtBrief, stylePreset },
        { styleOverride: stylePreset, fallbackToHeraldic: false }
      );
      const id = "portrait_hero_" + rid();
      await ctx.store.putBlob(id, gen.blob);
      portraitBlobId = id;
      portraitPreviewUrl = ctx.portraits.putBlobUrl(id, gen.blob);
      portraitSourceLabel = gen.providerLabel;
    } catch (err: any) {
      toast(err?.message || "Could not generate AI portrait. Check Settings or upload an image.");
    }
    portraitBusy = false;
    render();
  }

  async function handleUploadPortrait(file: File | undefined): Promise<void> {
    if (!file) return;
    portraitBusy = true;
    render();
    try {
      const gen = await ctx.imageRouter.importUploadedFile(file);
      const id = "portrait_hero_" + rid();
      await ctx.store.putBlob(id, gen.blob);
      portraitBlobId = id;
      portraitPreviewUrl = ctx.portraits.putBlobUrl(id, gen.blob);
      portraitSourceLabel = gen.providerLabel;
    } catch (err: any) {
      toast(err?.message || "Image upload failed.");
    }
    portraitBusy = false;
    render();
  }

  function buildSessionInput() {
    return {
      campaignName: str(campaignName, 40) || ARCHETYPE_PROFILES[archetype].defaultCampaignName,
      flavour: {
        archetype,
        tone,
        pillars: { ...pillars },
        magicLevel,
        customPremise: str(customPremise, 600)
      },
      heroKey,
      heroName: str(heroName, 30) || HEROES[heroKey].name,
      heroAppearance: str(heroAppearance, 240),
      heroPortraitId: portraitBlobId,
      stylePresetOverride: stylePreset
    };
  }

  async function launchPreparedCampaign(resumeExisting = false): Promise<void> {
    if (prepBusy) return;
    if (ctx.router.getEnabledConnections().length === 0) {
      toast("Connect an AI model in Settings first, or use Quick Start.");
      ctx.onOpenSettings();
      return;
    }

    if (!resumeExisting || !prepSession) {
      prepSession = { input: buildSessionInput() };
      steps = {
        1: { status: "idle", message: "1. World Spine, Hidden Clocks & Visual Brief" },
        2: { status: "idle", message: "2. Places, NPC Agendas, Secrets & Foe Roster" },
        3: { status: "idle", message: "3. Opening Scene" }
      };
    } else {
      prepSession.input.heroPortraitId = portraitBlobId;
    }

    prepBusy = true;
    prepAbort = new AbortController();
    render();

    const pipeline = new CampaignPrepPipeline(ctx.router);
    try {
      const bundle = await pipeline.runAll(
        prepSession,
        (ev: PrepProgressEvent) => {
          steps[ev.stepIndex] = {
            status: ev.status,
            message: `${ev.stepIndex}. ${ev.message}`,
            detail: ev.detail
          };
          render();
        },
        prepAbort.signal
      );
      prepBusy = false;
      prepSession = null;
      await ctx.onCampaignReady(bundle);
    } catch (err: any) {
      prepBusy = false;
      if (err?.name !== "AbortError") {
        toast(err?.message || "Prep paused on an error. You can retry from the failed step.");
      }
      render();
    }
  }

  async function launchQuickStart(): Promise<void> {
    if (prepBusy) return;
    const { bundle } = createQuickStartSeed(buildSessionInput());
    if (ctx.router.getEnabledConnections().length > 0) {
      prepBusy = true;
      steps = {
        1: { status: "done", message: "1. Brookhollow Spine & Clocks loaded instantly" },
        2: { status: "done", message: "2. Places, NPC Secrets & Redbriar Roster ready" },
        3: { status: "running", message: "3. Writing opening scene at The Drowned Oar…" }
      };
      render();
      try {
        await requestStoryTurn(bundle, ctx.router, OPENING_DIRECTOR_PROMPT, { opening: true });
      } catch {
        // Even if offline or rate-limited, open the seeded campaign cleanly so player can start!
      }
      prepBusy = false;
    }
    await ctx.onCampaignReady(bundle);
  }

  function renderPillarControl(key: "combat" | "mystery" | "social", label: string): HTMLElement {
    const names: Record<1 | 2 | 3, string> = { 1: "Light", 2: "Balanced", 3: "Heavy" };
    return el(
      "div",
      { class: "pillar-box" },
      el("span", { class: "lbl", text: label }),
      el(
        "div",
        { class: "pillar-dots" },
        ([1, 2, 3] as const).map(lvl =>
          el(
            "button",
            {
              type: "button",
              disabled: prepBusy,
              "aria-pressed": String(pillars[key] === lvl),
              onclick: () => {
                pillars[key] = lvl;
                prepSession = null;
                render();
              }
            },
            names[lvl]
          )
        )
      )
    );
  }

  function render(): void {
    const hasModel = ctx.router.getEnabledConnections().length > 0;
    const hasStepError = Object.values(steps).some(s => s.status === "error");
    const showProgress = prepBusy || hasStepError;

    const fileInput = el("input", {
      type: "file",
      accept: "image/*",
      hidden: true,
      onchange: (e: Event) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        handleUploadPortrait(f);
      }
    });

    put(
      host,
      el(
        "div",
        { style: "display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap" },
        el("span", { class: "lbl", style: "color: var(--gold)", text: "New Campaign — Flavour & Prep Studio" }),
        el("span", { class: "muted", style: "font-size: 13px", text: "2024 D&D 5e · Level 1 Start" })
      ),

      /* 1. Setting Archetypes */
      el("div", { class: "field" },
        el("span", { class: "lbl", text: "1. Choose Campaign Flavour" }),
        el(
          "div",
          { class: "arch-grid" },
          (Object.keys(ARCHETYPE_PROFILES) as SettingArchetype[]).map(k => {
            const p = ARCHETYPE_PROFILES[k];
            return el(
              "button",
              {
                class: "arch-card",
                type: "button",
                disabled: prepBusy,
                "aria-pressed": String(archetype === k),
                onclick: () => selectArchetype(k)
              },
              el("b", { text: p.label }),
              el("span", { text: p.tagline })
            );
          })
        )
      ),

      /* Campaign Title, Tone, Magic */
      el(
        "div",
        { style: "display: grid; grid-template-columns: repeat(auto-fit, minmax(175px, 1fr)); gap: 10px" },
        el(
          "div",
          { class: "field" },
          el("label", { for: "cname", class: "lbl", text: "Campaign Name" }),
          el("input", {
            id: "cname",
            maxlength: "40",
            disabled: prepBusy,
            value: campaignName,
            oninput: (e: Event) => {
              campaignName = (e.target as HTMLInputElement).value;
            }
          })
        ),
        el(
          "div",
          { class: "field" },
          el("label", { for: "tone", class: "lbl", text: "Tone" }),
          el(
            "select",
            {
              id: "tone",
              disabled: prepBusy,
              onchange: (e: Event) => {
                tone = (e.target as HTMLSelectElement).value;
                prepSession = null;
              }
            },
            TONES.map(t => el("option", { value: t, selected: t === tone }, t))
          )
        ),
        el(
          "div",
          { class: "field" },
          el("label", { for: "magic", class: "lbl", text: "Magic in the World" }),
          el(
            "select",
            {
              id: "magic",
              disabled: prepBusy,
              onchange: (e: Event) => {
                magicLevel = (e.target as HTMLSelectElement).value as CampaignFlavour["magicLevel"];
                prepSession = null;
              }
            },
            el("option", { value: "rare", selected: magicLevel === "rare" }, "Rare & Subtle"),
            el("option", { value: "uncommon", selected: magicLevel === "uncommon" }, "Uncommon & Wonderous"),
            el("option", { value: "high", selected: magicLevel === "high" }, "High Mythic")
          )
        )
      ),

      /* Playstyle Pillars */
      el(
        "div",
        { class: "pillars-row" },
        renderPillarControl("combat", "Combat"),
        renderPillarControl("mystery", "Mystery"),
        renderPillarControl("social", "Intrigue & Talk")
      ),

      /* Premise / Seed */
      el(
        "div",
        { class: "field" },
        el("label", { for: "premise", class: "lbl", text: "Starting Premise / Hook (Editable)" }),
        el(
          "textarea",
          {
            id: "premise",
            maxlength: "600",
            disabled: prepBusy,
            oninput: (e: Event) => {
              customPremise = (e.target as HTMLTextAreaElement).value;
              prepSession = null;
            }
          },
          customPremise
        )
      ),

      /* 2. Hero Selection & Portrait Studio */
      el("div", { class: "lbl", text: "2. Choose Your Hero & Portrait" }),
      el(
        "div",
        { class: "heroes" },
        (["fighter", "rogue"] as const).map(k => {
          const h = HEROES[k];
          return el(
            "button",
            {
              class: "hero",
              type: "button",
              disabled: prepBusy,
              "aria-pressed": String(heroKey === k),
              onclick: () => selectHero(k)
            },
            el(
              "span",
              { style: "display: flex; gap: 10px; align-items: center" },
              el("span", { class: "tile" }, svgIcon(k === "fighter" ? "crossed-swords" : "hood", "#d9b25c")),
              el(
                "span",
                {},
                el("span", { class: "nm", text: h.name }),
                el("span", { class: "muted", style: "display: block; font-size: 13.5px", text: `${h.species} ${h.cls} · ${h.bg}` })
              )
            ),
            el("span", { class: "muted", style: "font-size: 13.5px", text: h.blurb })
          );
        })
      ),

      el(
        "div",
        { style: "display: grid; grid-template-columns: 1fr 1.6fr; gap: 10px" },
        el(
          "div",
          { class: "field" },
          el("label", { for: "hname", class: "lbl", text: "Hero Name" }),
          el("input", {
            id: "hname",
            maxlength: "30",
            disabled: prepBusy,
            value: heroName,
            oninput: (e: Event) => {
              heroName = (e.target as HTMLInputElement).value;
              if (portraitSourceLabel === "Built-in Heraldic Crest") {
                ensureHeraldicPreview();
                const img = $(".portrait-frame img", host) as HTMLImageElement | null;
                if (img && portraitPreviewUrl) img.src = portraitPreviewUrl;
              }
            }
          })
        ),
        el(
          "div",
          { class: "field" },
          el("label", { for: "happ", class: "lbl", text: "Appearance (Shapes Portrait)" }),
          el("input", {
            id: "happ",
            maxlength: "240",
            disabled: prepBusy,
            value: heroAppearance,
            oninput: (e: Event) => {
              heroAppearance = (e.target as HTMLInputElement).value;
            }
          })
        )
      ),

      /* Portrait Studio Box */
      el(
        "div",
        { class: "portrait-studio" },
        el(
          "div",
          { class: "portrait-frame" },
          portraitPreviewUrl ? el("img", { src: portraitPreviewUrl, alt: heroName }) : null
        ),
        el(
          "div",
          { style: "flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 8px" },
          el(
            "div",
            { style: "display: flex; justify-content: space-between; gap: 8px; align-items: center; flex-wrap: wrap" },
            el("span", { class: "lbl", text: `Portrait · ${portraitSourceLabel}` }),
            el(
              "select",
              {
                style: "background: #0a120e; color: var(--ink); border: 1px solid var(--line-2); border-radius: 6px; padding: 4px 8px; font-size: 13px;",
                disabled: portraitBusy || prepBusy,
                onchange: (e: Event) => {
                  stylePreset = (e.target as HTMLSelectElement).value as PortraitStylePreset;
                }
              },
              el("option", { value: "painterly", selected: stylePreset === "painterly" }, "Painterly Fantasy"),
              el("option", { value: "ink_parchment", selected: stylePreset === "ink_parchment" }, "Ink & Parchment"),
              el("option", { value: "dark_woodcut", selected: stylePreset === "dark_woodcut" }, "Chiaroscuro Woodcut")
            )
          ),
          el(
            "div",
            { style: "display: flex; gap: 8px; flex-wrap: wrap" },
            el(
              "button",
              {
                class: "btn ghost sm",
                type: "button",
                disabled: portraitBusy || prepBusy,
                onclick: handleGenerateAiPortrait
              },
              svgIcon("portrait", "#d9b25c", 14),
              portraitBusy ? "Painting…" : "Generate AI Portrait"
            ),
            fileInput,
            el(
              "button",
              {
                class: "btn ghost sm",
                type: "button",
                disabled: portraitBusy || prepBusy,
                onclick: () => fileInput.click()
              },
              svgIcon("upload", "currentColor", 13),
              "Upload Image"
            ),
            el(
              "button",
              {
                class: "btn ghost sm",
                type: "button",
                disabled: portraitBusy || prepBusy,
                onclick: () => {
                  ensureHeraldicPreview();
                  render();
                }
              },
              "Heraldic Crest"
            )
          )
        )
      ),

      /* 3-Step Prep Progress Stepper (when running or resumable) */
      showProgress
        ? el(
            "div",
            { class: "prep-steps", role: "status", "aria-live": "polite" },
            el("span", { class: "lbl", style: "color: var(--gold-hi)", text: "Behind the Screen — Preparing Your World" }),
            ([1, 2, 3] as const).map(idx => {
              const st = steps[idx];
              const badgeTxt = st.status === "done" ? "✓" : st.status === "error" ? "!" : String(idx);
              return el(
                "div",
                { class: `prep-step ${st.status}` },
                el("span", { class: "badge", text: badgeTxt }),
                el(
                  "div",
                  {},
                  el("div", { text: st.message }),
                  st.detail ? el("div", { class: "muted", style: "font-size: 12.5px", text: st.detail }) : null
                )
              );
            }),
            hasStepError && !prepBusy
              ? el(
                  "div",
                  { style: "display: flex; gap: 8px; justify-content: flex-end" },
                  el(
                    "button",
                    { class: "btn sm", type: "button", onclick: () => launchPreparedCampaign(true) },
                    "Resume from Failed Step"
                  )
                )
              : null
          )
        : null,

      /* Launch Buttons */
      el(
        "div",
        { style: "display: flex; gap: 10px; flex-wrap: wrap; align-items: center; justify-content: space-between; padding-top: 4px" },
        el(
          "button",
          {
            class: "btn ghost",
            type: "button",
            disabled: prepBusy,
            title: "Skip AI world-prep calls and jump straight into the handcrafted Brookhollow mystery seed",
            onclick: launchQuickStart
          },
          "Quick Start (Instant Seed)"
        ),
        prepBusy
          ? el(
              "button",
              {
                class: "btn danger",
                type: "button",
                onclick: () => {
                  prepAbort?.abort();
                  prepBusy = false;
                  render();
                }
              },
              "Cancel Prep"
            )
          : el(
              "button",
              {
                class: "btn",
                type: "button",
                id: "go",
                onclick: () => launchPreparedCampaign(false)
              },
              hasModel ? "Prepare World & Begin" : "Connect API to Prepare World"
            )
      )
    );
  }

  render();
  return host;
}
