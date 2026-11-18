/* Decoupled Main Game Shell: Cover & Start, Story Stage, Fight Stage, Book Spreads & Persistence Loop.
   Strictly delegates all rules/math to `src/engine/`, all LLM/image calls to `src/narrator/` + `src/adapters/`,
   and all persistence to `GameStore` + `KeyringManager`. */

import type { ImageRouter } from "../adapters/image/image-router";
import type { ModelRouter, WaitNotice } from "../adapters/llm";
import {
  TabConflictGuard,
  exportCampaignArchive,
  importCampaignArchive,
  type CampaignIndexRow,
  type GameStore,
  type KeyringManager
} from "../adapters/storage";
import {
  HEROES,
  armourClass,
  carryCapacityKg,
  checkBonus,
  checkLabel,
  clockText,
  clone,
  commitBundleInPlace,
  drinkPotionInBundle,
  foeSummary,
  knows,
  mod,
  nice,
  npcByName,
  phaseOf,
  presentNpcsIn,
  replaceBundleInPlace,
  restInBundle,
  rid,
  rollDeathSaveInBundle,
  rollPendingCheckInBundle,
  sign,
  str,
  totalCarryWeightKg,
  type CampaignBundle,
  type LogEntry,
  type RollDisplayRecord,
  type WorldEntity
} from "../engine";
import {
  ARCHETYPE_PROFILES,
  CONTINUE_DIRECTOR_NOTE,
  createQuickStartSeed,
  foldCampaignMemory,
  generateHeroEpitaph,
  requestStoryTurn
} from "../narrator";
import {
  UI_PATHS,
  attitudeKey,
  choiceArrowSvg,
  d20Badge,
  heraldicShieldSvg,
  lineIcon,
  phoneBottomNav,
  quillSvg,
  skyBackdrop,
  svgEl,
  type PhoneTab
} from "./chrome";
import { renderCharacterCreator } from "./character-creator";
import { createCombatController, createCombatUiState, renderFightLogCard, renderRulingCard } from "./combat-view";
import { isDevModeEnabled, openDevModal } from "./dev-modal";
import { $, el, put, renderAvatarNode, toast, triggerJsonDownload, type PortraitUrlCache } from "./dom";
import { iconFor, svgIcon } from "./icons";
import { createAskState, renderJournalSpread, type JournalSpreadTab } from "./journal-view";
import { createPrepStudioCard } from "./prep-studio";
import { openSettingsModal } from "./settings-modal";

export interface GameShellDeps {
  root: HTMLElement;
  store: GameStore;
  keyring: KeyringManager;
  router: ModelRouter;
  imageRouter: ImageRouter;
  portraits: PortraitUrlCache;
}

export interface GameShellController {
  showStart: () => Promise<void>;
  enterGame: (bundle: CampaignBundle) => Promise<void>;
  dispose: () => void;
}

type ShellViewMode = "start" | "create" | "play" | "sheet" | "journal";

export function createGameShell(deps: GameShellDeps): GameShellController {
  const sessionId = rid();
  let bundle: CampaignBundle | null = null;
  let lastTurnUndo: CampaignBundle | null = null;
  let lastSavedUpdated = 0;
  let conflicted = false;
  let saving = false;
  let saveQueued = false;

  let viewMode: ShellViewMode = "start";
  let journalTab: JournalSpreadTab = "people";
  let selectedNpcId: string | null = null;
  let selectedPlaceId: string | null = null;
  let startHeroKey: "fighter" | "rogue" = "rogue";
  let startPremise = ARCHETYPE_PROFILES.frontier_mystery.defaultPremise;
  let startLearnMode = true;
  let prepDrawerOpen = false;

  let busy = false;
  let retryState: {
    input: string;
    opts?: { strong?: boolean; opening?: boolean; note?: string; minTime?: number };
    msg: string;
  } | null = null;
  let strongNext = false;
  let activeWaitNotice: WaitNotice | null = null;
  let heroPortraitBusy = false;

  const cui = createCombatUiState();
  const ask = createAskState();

  const conflictGuard = new TabConflictGuard(sessionId, campaignId => {
    if (bundle && bundle.campaign.id === campaignId) {
      markConflicted();
    }
  });

  const stageHost = el("div", { id: "stage-host" });
  const importFileInput = el("input", {
    type: "file",
    accept: ".json,.solotales.json,application/json",
    hidden: true,
    onchange: async (e: Event) => {
      const input = e.currentTarget as HTMLInputElement;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      try {
        const raw = await file.text();
        const imported = await importCampaignArchive(raw, deps.store, sessionId);
        toast(`Imported "${imported.campaign.name}".`);
        if (viewMode !== "start") {
          await enterGame(imported);
        } else {
          await renderStartScreen();
        }
      } catch (err: any) {
        toast(err?.message || "Could not import campaign archive.");
      }
    }
  });

  put(deps.root, stageHost, importFileInput);

  const unsubWait = deps.router.onWaitTick(notice => {
    activeWaitNotice = notice;
    renderWaitPills();
  });

  function renderWaitPills(): void {
    const label = activeWaitNotice
      ? `Rate limit: ${Math.max(1, Math.ceil(activeWaitNotice.secondsLeft))}s (${activeWaitNotice.connectionLabel})`
      : "";
    for (const pill of stageHost.querySelectorAll<HTMLElement>('[data-slot="wait-pill"]')) {
      pill.hidden = !activeWaitNotice;
      pill.textContent = label;
    }
  }

  function canAct(): boolean {
    if (!bundle || busy || conflicted) return false;
    if (bundle.campaign.status !== "active" || bundle.campaign.char.dying || bundle.campaign.pending) return false;
    if (bundle.campaign.combat) return false;
    return true;
  }

  /* ---- Entity Highlights & Speech Rendering ---- */
  function renderHighlight(text: string): HTMLElement {
    const p = el("p", { class: "st-narr" });
    if (!bundle) {
      p.textContent = text;
      return p;
    }
    const list = Object.values(bundle.entities)
      .filter(e => e.name.length > 2)
      .sort((a, b) => b.name.length - a.name.length);
    if (!list.length) {
      p.textContent = text;
      return p;
    }

    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const byName = new Map(list.map(e => [e.name.toLowerCase(), e]));
    const re = new RegExp("\\b(" + list.map(e => esc(e.name)).join("|") + ")\\b", "gi");

    let pos = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (match.index > pos) p.append(text.slice(pos, match.index));
      const ent = byName.get(match[0].toLowerCase());
      if (ent) {
        p.append(
          el("span", {
            class: "st-hl",
            role: "button",
            tabindex: "0",
            title: ent.desc || ent.role || ent.kind,
            onclick: () => openEntityInJournal(ent),
            onkeydown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openEntityInJournal(ent);
              }
            },
            text: match[0]
          })
        );
      } else {
        p.append(match[0]);
      }
      pos = match.index + match[0].length;
    }
    if (pos < text.length) p.append(text.slice(pos));
    return p;
  }

  function openEntityInJournal(ent: WorldEntity): void {
    if (ent.kind === "npc") {
      selectedNpcId = ent.id;
      journalTab = "people";
    } else if (ent.kind === "place") {
      selectedPlaceId = ent.id;
      journalTab = "places";
    } else {
      journalTab = "facts";
    }
    viewMode = "journal";
    renderAll();
  }

  function renderSpeechSeg(who: string, text: string): HTMLElement {
    const npc = bundle ? npcByName(bundle.entities, who) : null;
    const ak = attitudeKey(npc?.att);
    const portraitUrl = npc?.portraitId
      ? deps.portraits.getUrl(npc.portraitId, deps.store, () => renderAll())
      : null;

    return el(
      "div",
      { class: "st-speech-block" },
      el(
        "div",
        { class: "st-speech-speaker" },
        portraitUrl
          ? el("img", { src: portraitUrl, alt: who, class: "st-speech-avatar" })
          : el("span", { class: "st-pip", "data-attitude": ak, "aria-hidden": "true" }),
        el("span", { class: "st-speech-name", "data-attitude": ak, text: who }),
        npc?.role ? el("span", { class: "st-pl", text: npc.role }) : null
      ),
      el("p", { class: "st-speech-quote", text: `“${text}”` })
    );
  }

  /* ---- Combat & Journal Controllers ---- */
  const combatCtrl = createCombatController({
    getBundle: () => bundle,
    cui,
    router: deps.router,
    store: deps.store,
    portraits: deps.portraits,
    isConflicted: () => conflicted,
    onRenderAll: () => renderAll(),
    onRenderCombatOnly: () => {
      if (viewMode !== "play") return;
      combatCtrl.renderCombat();
      const sheetHost = $("#sheet");
      const panelHost = $("#panel");
      if (sheetHost) combatCtrl.renderCombatSheet(sheetHost);
      if (panelHost) combatCtrl.renderCombatPanel(panelHost);
    },
    onSave: () => queueSave(),
    onSetMobileView: () => {},
    onAftermathTurn: note => {
      void runTurn("(after the fight)", { note });
    },
    onHeroDied: cid => {
      void handleHeroDied(cid);
    },
    renderHighlight,
    renderSpeechSeg
  });

  /* ---- Persistence & Conflict Guard ---- */
  function markConflicted(): void {
    conflicted = true;
    renderAll();
    toast("This campaign was updated in another tab. Reload before continuing.");
  }

  async function queueSave(): Promise<void> {
    if (!bundle || conflicted) return;
    if (saving) {
      saveQueued = true;
      return;
    }
    saving = true;
    const savedEl = $('[data-slot="save-status"]');
    if (savedEl) savedEl.textContent = "Saving…";

    try {
      const target = bundle;
      const out = await deps.store.saveBundle(target, sessionId, lastSavedUpdated);
      if (out.conflict) {
        markConflicted();
        return;
      }
      lastSavedUpdated = out.updated;
      target.campaign.updated = out.updated;
      conflictGuard.notifySaved(target.campaign.id, out.updated);
      if (savedEl && !conflicted) {
        savedEl.textContent = deps.store.persistent ? "Saved" : "Session memory";
      }
    } catch {
      if (savedEl) savedEl.textContent = "Save error";
    } finally {
      saving = false;
      if (saveQueued && !conflicted) {
        saveQueued = false;
        void queueSave();
      }
    }
  }

  async function exportCurrentCampaign(): Promise<void> {
    if (!bundle) return;
    try {
      const { filename, json } = await exportCampaignArchive(bundle, id => deps.store.getBlob(id));
      triggerJsonDownload(filename, json);
      toast(`Exported ${filename}`);
    } catch (err: any) {
      toast(err?.message || "Could not export campaign.");
    }
  }

  async function exportSavedCampaignById(id: string): Promise<void> {
    try {
      const loaded = await deps.store.loadBundle(id, sessionId);
      if (!loaded) {
        toast("Could not load campaign to export.");
        return;
      }
      const { filename, json } = await exportCampaignArchive(loaded, blobId => deps.store.getBlob(blobId));
      triggerJsonDownload(filename, json);
      toast(`Exported ${filename}`);
    } catch (err: any) {
      toast(err?.message || "Export failed.");
    }
  }

  function openDevConsole(): void {
    openDevModal({
      getBundle: () => bundle,
      onSave: queueSave,
      onRenderAll: renderAll
    });
  }

  function openCharacterCreator(): void {
    viewMode = "create";
    renderCharacterCreator(stageHost, {
      router: deps.router,
      imageRouter: deps.imageRouter,
      store: deps.store,
      portraits: deps.portraits,
      onBack: () => {
        void showStart();
      },
      onOpenSettings: openSettings,
      onCreated: async created => {
        await enterGame(created);
      }
    });
  }

  function openSettings(): void {
    openSettingsModal({
      keyring: deps.keyring,
      router: deps.router,
      imageRouter: deps.imageRouter,
      onOpenDevConsole: bundle ? openDevConsole : undefined,
      onChanged: () => {
        if (viewMode === "start") void renderStartScreen();
        else if (viewMode !== "create") renderAll();
      }
    });
  }

  /* ---- Story Turn, Undo, Memory Fold & Epitaph ---- */
  function captureUndo(): void {
    if (bundle) lastTurnUndo = clone(bundle);
  }

  function doUndoLastTurn(): void {
    if (!bundle || !lastTurnUndo || busy || conflicted) return;
    replaceBundleInPlace(bundle, lastTurnUndo);
    lastTurnUndo = null;
    retryState = null;
    cui.entered = bundle.campaign.combat?.cs ? bundle.campaign.combat.id : null;
    renderAll(true);
    void queueSave();
    toast("Rewound the last turn.");
  }

  function triggerBackgroundMemoryFold(targetBundle: CampaignBundle): void {
    if (deps.router.getEnabledConnections().length === 0) return;
    foldCampaignMemory(targetBundle, deps.router)
      .then(ok => {
        if (ok && bundle === targetBundle) void queueSave();
      })
      .catch(() => {});
  }

  async function handleHeroDied(campaignId: string): Promise<void> {
    if (!bundle || bundle.campaign.id !== campaignId) return;
    renderAll();
    void queueSave();
    if (!bundle.campaign.epitaph && deps.router.getEnabledConnections().length > 0) {
      await generateHeroEpitaph(bundle, deps.router);
      if (bundle && bundle.campaign.id === campaignId) {
        renderAll();
        void queueSave();
      }
    } else if (!bundle.campaign.epitaph && bundle) {
      commitBundleInPlace(bundle, "fallback epitaph", draft => {
        draft.campaign.epitaph = `${draft.campaign.char.name} fell far from home, and the valley kept the story.`;
      });
      renderAll();
      void queueSave();
    }
  }

  async function runTurn(
    inputRaw: string,
    opts?: { strong?: boolean; opening?: boolean; note?: string; minTime?: number }
  ): Promise<void> {
    if (!bundle || busy || conflicted) return;
    const input = str(inputRaw, 400);
    if (!input && !opts?.opening && !opts?.note) return;

    if (deps.router.getEnabledConnections().length === 0) {
      toast("Connect an AI model in Settings before taking a narrator turn.");
      openSettings();
      return;
    }

    const activeBundle = bundle;
    captureUndo();
    busy = true;
    retryState = null;
    const useStrong = Boolean(opts?.strong ?? strongNext);
    strongNext = false;

    renderAll(true);

    try {
      await requestStoryTurn(activeBundle, deps.router, input, {
        ...opts,
        strong: useStrong,
        onFoldNeeded: () => triggerBackgroundMemoryFold(activeBundle),
        onDead: cid => {
          void handleHeroDied(cid);
        }
      });
      if (bundle !== activeBundle) return;
      busy = false;
      renderAll(true);
      await queueSave();
    } catch (err: any) {
      if (bundle !== activeBundle) return;
      busy = false;
      retryState = {
        input,
        opts: { ...opts, strong: useStrong },
        msg: err?.message || "Narrator request failed."
      };
      renderAll(true);
    }
  }

  function doRollPendingCheck(): void {
    if (!bundle || busy || conflicted || !bundle.campaign.pending) return;
    const activeBundle = bundle;
    let diedId: string | null = null;
    const res = commitBundleInPlace(activeBundle, "roll pending check", (draft, tx) => {
      rollPendingCheckInBundle(draft, tx, {
        foldBeatThreshold: deps.router.getMemoryFoldThreshold(),
        onFoldNeeded: () => triggerBackgroundMemoryFold(activeBundle),
        onDead: cid => {
          diedId = cid;
        }
      });
    });
    if (!res.ok) {
      toast("Could not resolve roll.");
      return;
    }
    renderAll(true);
    void queueSave();
    if (diedId) void handleHeroDied(diedId);
  }

  function doCancelCreativeRuling(): void {
    if (!bundle || busy || conflicted || !bundle.campaign.pending?.ruling) return;
    const prevInput = bundle.campaign.pending.input || "";
    commitBundleInPlace(bundle, "cancel ruling", draft => {
      const p = draft.campaign.pending;
      if (p) {
        const idx = draft.log.findLastIndex(x => x.t === p.t);
        if (idx >= 0 && !draft.log[idx].segs.length) {
          draft.log.splice(idx, 1);
        }
      }
      draft.campaign.pending = null;
    });
    renderAll();
    void queueSave();
    const actInput = $<HTMLInputElement>("#act");
    if (actInput && prevInput) {
      actInput.value = prevInput;
      actInput.focus();
    }
  }

  function doRollDeathSave(): void {
    if (!bundle || busy || conflicted || !bundle.campaign.char.dying) return;
    let diedId: string | null = null;
    commitBundleInPlace(bundle, "death save", draft => {
      rollDeathSaveInBundle(draft, {
        onDead: cid => {
          diedId = cid;
        }
      });
    });
    renderAll(true);
    void queueSave();
    if (diedId) void handleHeroDied(diedId);
  }

  function doRest(kind: "short" | "long"): void {
    if (!canAct() || !bundle) return;
    captureUndo();
    commitBundleInPlace(bundle, `${kind} rest`, draft => {
      restInBundle(draft, kind);
    });
    renderAll(true);
    void queueSave();
  }

  async function paintHeroPortrait(): Promise<void> {
    if (!bundle || heroPortraitBusy) return;
    if (!deps.imageRouter.hasAiImageCapability()) {
      toast("Configure an Image API or keep Heraldic Crests in Settings.");
      return;
    }
    heroPortraitBusy = true;
    renderAll();
    try {
      const ch = bundle.campaign.char;
      const res = await deps.imageRouter.generatePortrait(
        {
          kind: "hero",
          name: ch.name,
          species: ch.species,
          cls: ch.cls,
          appearance: ch.appearance || undefined
        },
        bundle.campaign.artBrief
      );
      const portraitId = `hero_${bundle.campaign.id}_${rid()}`;
      await deps.store.putBlob(portraitId, res.blob);
      deps.portraits.putBlobUrl(portraitId, res.blob);
      commitBundleInPlace(bundle, "hero portrait", draft => {
        draft.campaign.char.portraitId = portraitId;
      });
      await queueSave();
      toast("Hero portrait updated.");
    } catch (err: any) {
      toast(err?.message || "Portrait generation failed.");
    } finally {
      heroPortraitBusy = false;
      renderAll();
    }
  }

  async function uploadHeroPortrait(file: File): Promise<void> {
    if (!bundle) return;
    try {
      const portraitId = `hero_${bundle.campaign.id}_${rid()}`;
      const imported = await deps.imageRouter.importUploadedFile(file);
      await deps.store.putBlob(portraitId, imported.blob);
      deps.portraits.putBlobUrl(portraitId, imported.blob);
      commitBundleInPlace(bundle, "upload portrait", draft => {
        draft.campaign.char.portraitId = portraitId;
      });
      await queueSave();
      renderAll();
      toast("Portrait uploaded.");
    } catch (err: any) {
      toast(err?.message || "Could not upload portrait.");
    }
  }

  /* ---- 1. COVER & START STAGE ---- */
  async function renderStartScreen(): Promise<void> {
    const list: CampaignIndexRow[] = await deps.store.listCampaigns();
    const prepStudioNode = createPrepStudioCard({
      router: deps.router,
      imageRouter: deps.imageRouter,
      store: deps.store,
      portraits: deps.portraits,
      onOpenSettings: openSettings,
      onCampaignReady: async created => {
        await deps.store.saveBundle(created, sessionId, 0);
        await enterGame(created);
      }
    });

    const coverArtwork = svgEl(
      "svg",
      {
        "aria-hidden": "true",
        width: "100%",
        height: 330,
        viewBox: "0 0 450 330",
        preserveAspectRatio: "none",
        style: "position:absolute;left:0;bottom:0;display:block"
      },
      svgEl("path", {
        d: "M0 110 L40 84 L80 100 L130 52 L170 88 L215 40 L260 92 L300 70 L345 96 L395 50 L450 86 L450 330 L0 330 Z",
        fill: "var(--st-sky-far)"
      }),
      svgEl("path", {
        d: "M0 170 L60 138 L110 160 L150 132 L196 150 L200 96 L206 96 L206 86 L214 86 L214 96 L222 96 L222 86 L230 86 L230 96 L236 96 L240 150 L300 136 L360 164 L410 140 L450 158 L450 330 L0 330 Z",
        fill: "var(--st-sky-mid)"
      }),
      svgEl("path", {
        d: "M0 232 C60 200 130 226 200 212 C280 196 340 236 450 204 L450 330 L0 330 Z",
        fill: "var(--st-cover-bg)"
      }),
      svgEl("path", {
        d: "M0 290 C90 254 190 286 280 268 C350 254 400 276 450 262 L450 330 L0 330 Z",
        fill: "var(--st-rail-bg)"
      }),
      svgEl("path", {
        d: "M214 150 C230 190 180 216 214 262",
        fill: "none",
        stroke: "#f0a56f",
        "stroke-opacity": "0.5",
        "stroke-width": "2",
        "stroke-dasharray": "1 7",
        "stroke-linecap": "round"
      })
    );

    const bookCover = el(
      "aside",
      { "data-slot": "book-cover" },
      el(
        "div",
        { class: "st-cover-frame" },
        el(
          "div",
          { class: "st-cover-canvas" },
          el("div", {
            "aria-hidden": "true",
            style: "position:absolute;left:62%;top:62%;width:84px;height:84px;border-radius:50%;background:var(--st-sky-orb);box-shadow:0 0 100px 40px var(--st-sky-glow)"
          }),
          coverArtwork,
          el(
            "div",
            { class: "st-cover-title" },
            el("div", { class: "st-cover-h1", text: "Solo Tales" }),
            el("div", { class: "st-gd", style: "font-style:italic;font-size:22px;color:var(--st-cover-ink);margin-top:20px", text: "A game for one, told as you play" })
          ),
          el(
            "div",
            { style: "position:absolute;left:32px;right:32px;bottom:24px;display:flex;justify-content:space-between;font-size:15px;color:var(--st-rail-ink)" },
            el("span", { text: "On the 2024 core rules" }),
            el("span", { text: `${deps.router.getEnabledConnections().length || 0} model${deps.router.getEnabledConnections().length === 1 ? "" : "s"} ready` })
          )
        )
      )
    );

    const startNewQuick = () => {
      const preset = HEROES[startHeroKey];
      const profile = ARCHETYPE_PROFILES.frontier_mystery;
      const seeded = createQuickStartSeed({
        campaignName: "A New Tale",
        heroKey: startHeroKey,
        heroName: preset.name,
        heroAppearance: preset.appearance || "",
        flavour: {
          archetype: "frontier_mystery",
          tone: profile.defaultTone,
          magicLevel: profile.defaultMagic,
          pillars: { ...profile.defaultPillars },
          customPremise: str(startPremise, 400) || profile.defaultPremise
        },
        stylePresetOverride: profile.defaultArtBrief.stylePreset
      });
      const created = seeded.bundle;
      created.campaign.learn = startLearnMode;
      void deps.store.saveBundle(created, sessionId, 0).then(() => enterGame(created));
    };

    const rightPage = el(
      "main",
      { "data-slot": "start-page" },
      // Subtle utility row
      el(
        "div",
        { style: "display:flex;justify-content:flex-end;align-items:center;gap:10px;flex-wrap:wrap" },
        el("span", { "data-slot": "wait-pill", hidden: !activeWaitNotice }),
        el(
          "button",
          { type: "button", class: "st-btn-quiet", style: "min-height:36px;font-size:14px", onclick: () => importFileInput.click() },
          "Import .solotales.json"
        ),
        el(
          "button",
          { type: "button", class: "st-btn-quiet", style: "min-height:36px;font-size:14px", onclick: openSettings },
          lineIcon(UI_PATHS.sliders, 16),
          el("span", { text: "API & Theme Settings" })
        )
      ),

      // Pick up a tale
      el(
        "section",
        { "data-slot": "saved-tales" },
        el("h2", { class: "st-h", text: "Pick up a tale" }),
        el(
          "div",
          { style: "border-top:1.5px solid var(--st-rule);margin-top:4px" },
          list.length
            ? list.map(row =>
                el(
                  "div",
                  { class: "st-tale-row" },
                  el(
                    "button",
                    {
                      type: "button",
                      class: "st-tale-open",
                      onclick: async () => {
                        const loaded = await deps.store.loadBundle(row.id, sessionId);
                        if (!loaded) {
                          toast("Could not load this campaign.");
                          return;
                        }
                        await enterGame(loaded);
                      }
                    },
                    el("span", { class: "st-fr", style: "display:block;font-size:26px;font-weight:700;line-height:1.15", text: row.name }),
                    el("span", {
                      class: "st-pl",
                      style: "display:block",
                      text: `${row.hero}. ${row.clock || ""}${row.status === "dead" ? " · Fallen" : ""}`
                    })
                  ),
                  el(
                    "button",
                    {
                      type: "button",
                      class: "st-btn-quiet",
                      style: "min-height:34px;padding:0 10px;font-size:13px",
                      onclick: () => void exportSavedCampaignById(row.id)
                    },
                    "Export"
                  ),
                  el(
                    "button",
                    {
                      type: "button",
                      class: "st-btn-danger",
                      style: "min-height:34px;padding:0 10px;font-size:13px",
                      onclick: async () => {
                        if (!confirm(`Delete "${row.name}"? This cannot be undone.`)) return;
                        await deps.store.deleteCampaign(row.id);
                        await renderStartScreen();
                      }
                    },
                    "Delete"
                  ),
                  lineIcon(UI_PATHS.chevronRight, 18)
                )
              )
            : el("p", { class: "st-pl", style: "padding:10px 0", text: "No saved tales yet. Begin a new one below." })
        )
      ),

      // Or begin a new one
      el(
        "section",
        { style: "display:flex;flex-direction:column;gap:14px", "data-slot": "new-tale" },
        el("h2", { class: "st-h", text: "Or begin a new one" }),
        el(
          "div",
          { role: "group", "aria-label": "Choose your hero", style: "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px" },
          (["fighter", "rogue"] as const).map(hk => {
            const h = HEROES[hk];
            const selected = startHeroKey === hk;
            const blurb =
              hk === "fighter"
                ? "Steady and hard to put down. Longsword, shield, chain mail."
                : "Quick, quiet and sharp-eyed. Shortsword, shortbow, leather.";
            return el(
              "button",
              {
                type: "button",
                class: "st-hero-pick",
                "aria-pressed": selected ? "true" : "false",
                onclick: () => {
                  startHeroKey = hk;
                  void renderStartScreen();
                }
              },
              el(
                "span",
                { style: "display:flex;justify-content:space-between;align-items:center" },
                el("span", { class: "st-fr", style: "font-size:24px;font-weight:700", text: h.name }),
                selected ? lineIcon(UI_PATHS.check, 20) : null
              ),
              el("span", { class: "st-pl", text: `${h.species} ${h.cls.toLowerCase()}, once a ${h.bg.toLowerCase()}` }),
              el("span", { class: "st-gd", style: "font-size:17px;line-height:1.45", text: blurb })
            );
          })
        ),
        el(
          "div",
          { style: "display:flex;flex-direction:column;gap:4px" },
          el("label", { for: "where-start", class: "st-pl", text: "Where it starts. Leave it, or write your own place." }),
          el("textarea", {
            id: "where-start",
            class: "st-hand-input",
            rows: "2",
            style: "height:auto;resize:none",
            oninput: (e: Event) => {
              startPremise = (e.target as HTMLTextAreaElement).value;
            }
          }, startPremise)
        ),
        el(
          "div",
          { style: "display:flex;flex-wrap:wrap;align-items:center;gap:14px 20px" },
          el("button", { type: "button", class: "st-btn-primary", style: "min-height:52px;padding:0 28px;font-size:18px", onclick: startNewQuick }, "Begin the tale"),
          el("button", { type: "button", class: "st-btn-gold", "data-action": "open-creator", style: "min-height:52px;padding:0 22px;font-size:16px", onclick: openCharacterCreator }, "Create character"),
          el(
            "label",
            { style: "display:flex;align-items:center;gap:8px;min-height:44px;font-size:16px;cursor:pointer" },
            el("input", {
              type: "checkbox",
              checked: startLearnMode,
              style: "width:18px;height:18px;accent-color:var(--st-accent-player)",
              onchange: (e: Event) => {
                startLearnMode = (e.target as HTMLInputElement).checked;
              }
            }),
            "Explain the rules as I play"
          ),
          el(
            "button",
            {
              type: "button",
              class: "st-btn-quiet",
              style: "margin-left:auto",
              "aria-expanded": prepDrawerOpen ? "true" : "false",
              onclick: () => {
                prepDrawerOpen = !prepDrawerOpen;
                void renderStartScreen();
              }
            },
            prepDrawerOpen ? "Hide Prep Studio" : "Customise world & hero (Prep Studio)"
          )
        ),
        prepDrawerOpen ? el("div", { "data-slot": "prep-drawer" }, prepStudioNode) : null
      ),

      el("div", {
        class: "st-pl",
        style: "margin-top:auto;padding:14px 0 6px;border-top:1px solid var(--st-rule-light)",
        text: "Rules from the SRD 5.2, CC BY 4.0. Icons from game-icons.net, CC BY 3.0."
      })
    );

    put(stageHost, el("div", { "data-stage": "start" }, bookCover, rightPage));
    renderWaitPills();
  }

  /* ---- 2. STORY & FIGHT SHARED SHELL ---- */
  function renderPlayStage(scrollToBottom = false): void {
    if (!bundle) return;
    const G = bundle.campaign;
    const ch = G.char;
    const inCombat = Boolean(G.combat && cui.entered === G.combat.id);
    const phase = phaseOf(G.time);
    const placeName = G.place && bundle.entities[G.place] ? bundle.entities[G.place].name : "On the road";

    const header = el(
      "header",
      { "data-slot": "stage-header" },
      el(
        "div",
        null,
        el("div", { "data-slot": "header-title", text: G.name }),
        el("div", {
          "data-slot": "header-subtitle",
          text: inCombat ? `A fight. Round ${G.combat?.cs?.round || 1}.` : `${placeName} · turn ${G.turn}`
        })
      ),
      el(
        "div",
        { "data-slot": "header-meta" },
        el(
          "div",
          { "data-slot": "clock-readout" },
          el("div", { "data-slot": "clock-phase", text: nice(phase) }),
          el("div", { "data-slot": "clock-detail", text: clockText(G.time) })
        ),
        el("span", { "data-slot": "wait-pill", hidden: !activeWaitNotice }),
        el(
          "span",
          { "data-slot": "save-status" },
          conflicted ? "Updated in another tab" : deps.store.persistent ? "Saved" : "Session memory"
        ),
        conflicted
          ? el(
              "button",
              {
                type: "button",
                class: "st-btn-gold",
                style: "min-height:36px;padding:0 12px;font-size:14px",
                onclick: async () => {
                  const fresh = await deps.store.loadBundle(G.id, sessionId);
                  if (fresh) await enterGame(fresh);
                }
              },
              "Reload"
            )
          : null,
        el(
          "button",
          {
            type: "button",
            class: "st-icon-btn",
            "data-slot": "undo-btn",
            "aria-label": "Undo the last turn",
            title: lastTurnUndo ? "Undo the last turn" : "Nothing to undo",
            disabled: !lastTurnUndo || busy || conflicted || inCombat,
            onclick: doUndoLastTurn
          },
          lineIcon(UI_PATHS.undo, 20)
        ),
        isDevModeEnabled()
          ? el(
              "button",
              {
                type: "button",
                class: "st-btn-quiet sm",
                "data-slot": "dev-btn",
                title: "Open Developer Console",
                onclick: openDevConsole
              },
              "Dev"
            )
          : null,
        el(
          "button",
          {
            type: "button",
            class: "st-icon-btn",
            "aria-label": "API & Theme Settings",
            title: "API & Theme Settings",
            onclick: openSettings
          },
          lineIcon(UI_PATHS.sliders, 20)
        ),
        el(
          "button",
          {
            type: "button",
            class: "st-icon-btn",
            "aria-label": "All tales",
            title: "All tales",
            onclick: () => void showStart()
          },
          lineIcon(UI_PATHS.allTales, 20)
        )
      )
    );

    const heroRail = el("aside", { id: "sheet", "data-slot": "hero-rail" });
    const pageMain = el("main", { "data-slot": "page", id: inCombat ? "cstage" : "sstage" });
    const contextRail = el("aside", { id: "panel", "data-slot": "context-rail" });

    const stageEl = el(
      "div",
      {
        "data-stage": inCombat ? "fight" : "story",
        "data-time": phase
      },
      skyBackdrop(),
      header,
      el("div", { "data-slot": "stage-columns" }, heroRail, pageMain, contextRail),
      phoneBottomNav({
        char: ch,
        activeTab: "story",
        onNav: handlePhoneNav
      })
    );

    put(stageHost, stageEl);
    renderWaitPills();

    if (inCombat) {
      combatCtrl.renderCombatSheet(heroRail);
      combatCtrl.renderCombat();
      combatCtrl.renderCombatPanel(contextRail);
    } else {
      renderStoryHeroRail(heroRail);
      renderStoryPage(pageMain, scrollToBottom);
      renderStoryContextRail(contextRail);
    }
  }

  function renderStoryHeroRail(rail: HTMLElement): void {
    if (!bundle) return;
    const G = bundle.campaign;
    const ch = G.char;
    const AC = armourClass(ch);
    const heroUrl = deps.portraits.getUrl(ch.portraitId, deps.store, () => renderStoryHeroRail(rail));
    const hpPct = Math.max(0, Math.min(100, Math.round((ch.hp / Math.max(1, ch.maxHp)) * 100)));
    const nextXp = ch.level >= 20 ? ch.xp : 300 * Math.pow(2, ch.level - 1);
    const xpPct = Math.max(0, Math.min(100, Math.round((ch.xp / Math.max(1, nextXp)) * 100)));
    const sw = ch.res?.second_wind;

    put(
      rail,
      el(
        "div",
        { class: "st-hero-identity" },
        heroUrl
          ? el("img", { src: heroUrl, alt: ch.name, class: "st-portrait-thumb" })
          : heraldicShieldSvg(),
        el(
          "div",
          null,
          el("div", { class: "st-fr", style: "font-size:26px;font-weight:600;line-height:1.1;color:var(--st-rail-ink-bright)", text: ch.name }),
          el("div", { class: "st-rl", text: `${ch.species} ${ch.cls.toLowerCase()}, level ${ch.level}` })
        )
      ),
      el(
        "div",
        { style: "display:flex;flex-direction:column;gap:8px" },
        el(
          "div",
          { style: "display:flex;justify-content:space-between;align-items:baseline" },
          el("span", { class: "st-rl", text: "Hit points" }),
          el("span", null, el("span", { class: "st-fr", style: "font-size:24px;font-weight:600;color:var(--st-rail-ink-bright)", text: String(ch.hp) }), el("span", { class: "st-rl", text: ` of ${ch.maxHp}` }))
        ),
        el("div", { class: "st-bar-track", role: "img", "aria-label": `${ch.hp} of ${ch.maxHp} hit points` }, el("div", { class: "st-bar-fill-hp", style: `width:${hpPct}%` })),
        el(
          "div",
          { style: "display:flex;justify-content:space-between;align-items:baseline;margin-top:4px" },
          el("span", { class: "st-rl", text: "Experience" }),
          el("span", { class: "st-rl", text: `${ch.xp.toLocaleString()} of ${nextXp.toLocaleString()}` })
        ),
        el("div", { class: "st-bar-track is-thin", role: "img", "aria-label": `${ch.xp} experience` }, el("div", { class: "st-bar-fill-xp", style: `width:${xpPct}%` }))
      ),
      el(
        "div",
        { class: "st-rail-stats3" },
        el("div", { title: AC.why }, el("div", { class: "st-fr", style: "font-size:24px;font-weight:600;color:var(--st-rail-ink-bright)", text: String(AC.ac) }), el("div", { class: "st-rl", text: "Armour" })),
        el("div", null, el("div", { class: "st-fr", style: "font-size:24px;font-weight:600;color:var(--st-rail-ink-bright)", text: sign(mod(ch.abil.dex)) }), el("div", { class: "st-rl", text: "Initiative" })),
        el("div", null, el("div", { class: "st-fr", style: "font-size:24px;font-weight:600;color:var(--st-rail-ink-bright)", text: `${ch.speed} m` }), el("div", { class: "st-rl", text: "Speed" }))
      ),
      el(
        "div",
        { style: "display:flex;flex-direction:column;gap:10px;font-size:15px" },
        sw
          ? el(
              "div",
              { style: "display:flex;justify-content:space-between;align-items:center" },
              el("span", { text: "Second Wind" }),
              el(
                "span",
                { class: "st-dot-pips", role: "img", "aria-label": `${sw.left} of ${sw.max} left` },
                ...Array.from({ length: sw.max }, (_, i) =>
                  el("span", { class: `st-dot-pip${i < sw.left ? "" : " is-spent"}` })
                )
              )
            )
          : null,
        el("div", { style: "display:flex;justify-content:space-between" }, el("span", { text: "Hit dice" }), el("span", { class: "st-rl", text: `${ch.hd.left} of ${ch.hd.max}, d${ch.hd.die}` })),
        el("div", { style: "display:flex;justify-content:space-between" }, el("span", { text: "Conditions" }), el("span", { class: "st-rl", text: ch.conditions.map(nice).join(", ") || "None" })),
        el("div", { style: "display:flex;justify-content:space-between" }, el("span", { text: "Gold" }), el("span", { style: "color:var(--st-rail-gold);font-weight:700", text: `${ch.gold} gp` }))
      ),
      el(
        "button",
        {
          type: "button",
          class: "st-rail-btn",
          "data-slot": "open-sheet-btn",
          onclick: () => {
            viewMode = "sheet";
            renderAll();
          }
        },
        lineIcon(UI_PATHS.sheet, 20),
        el("span", { text: "Open the adventure sheet" })
      )
    );
  }

  function renderStoryContextRail(rail: HTMLElement): void {
    if (!bundle) return;
    const G = bundle.campaign;
    const ch = G.char;
    const herePlace = G.place ? bundle.entities[G.place] : null;
    const nearby = presentNpcsIn(G.place, bundle.entities);
    const activeQuest = [...G.quests].reverse().find(q => q.status === "active");
    const atHand = ch.inv.filter(i => !i.eq).slice(0, 4);
    const carryKg = totalCarryWeightKg(ch.inv);
    const capKg = carryCapacityKg(ch.abil.str);

    put(
      rail,
      el(
        "div",
        null,
        el("h2", { class: "st-fr", style: "margin:0;font-size:22px;font-style:italic;font-weight:500;color:var(--st-rail-ink-bright)", text: "Here and now" }),
        el("div", { class: "st-rl", style: "margin-top:4px", text: herePlace?.desc || herePlace?.name || "On the road." })
      ),
      nearby.length
        ? el(
            "div",
            { class: "st-rail-section" },
            el("span", { class: "st-rl", text: "With you" }),
            ...nearby.map(n =>
              el(
                "div",
                { style: "display:flex;align-items:baseline;gap:10px" },
                el("span", { class: "st-pip-rail", "data-attitude": attitudeKey(n.att), "aria-hidden": "true" }),
                el("span", null, el("strong", { text: n.name }), el("span", { class: "st-rl", text: n.role ? `. ${n.role}` : "" }))
              )
            )
          )
        : null,
      activeQuest
        ? el(
            "div",
            { class: "st-rail-section" },
            el("span", { class: "st-rl", text: "Your errand" }),
            el("div", { class: "st-fr", style: "font-size:19px;font-weight:600;color:var(--st-rail-ink-bright)", text: activeQuest.title }),
            el("div", { style: "font-size:15px", text: activeQuest.obj })
          )
        : null,
      atHand.length
        ? el(
            "div",
            { class: "st-rail-section" },
            el("span", { class: "st-rl", text: "At hand" }),
            ...atHand.map(it => {
              const canDrink = /healing/i.test(it.name) && ch.hp < ch.maxHp;
              const useLabel = canDrink ? "Drink" : /key|torch|lantern|rope/i.test(it.name) ? "Use" : "";
              return el(
                "div",
                { style: "display:flex;align-items:center;gap:12px;min-height:44px" },
                svgIcon(iconFor(it.name), "var(--st-rail-gold)", 20),
                el(
                  "span",
                  { style: "flex:1;min-width:0" },
                  el("span", { style: "display:block", text: it.qty > 1 ? `${it.name}, ${it.qty}` : it.name }),
                  it.note ? el("span", { class: "st-rl", style: "display:block", text: it.note }) : null
                ),
                useLabel
                  ? el(
                      "button",
                      {
                        type: "button",
                        style: "min-height:36px;padding:0 12px;background:transparent;border:1px solid var(--st-rail-gold);border-radius:3px;color:var(--st-rail-gold);font-size:14px;font-weight:700;cursor:pointer",
                        disabled: !canAct(),
                        onclick: () => {
                          if (canDrink && bundle) {
                            commitBundleInPlace(bundle, "potion", draft => {
                              drinkPotionInBundle(draft, it.id);
                            });
                            void queueSave();
                            renderAll();
                          } else {
                            void runTurn(`I use ${it.name}.`);
                          }
                        }
                      },
                      useLabel
                    )
                  : null
              );
            })
          )
        : null,
      el(
        "div",
        { class: "st-rail-section" },
        el(
          "button",
          {
            type: "button",
            class: "st-rail-btn",
            "data-slot": "open-journal-btn",
            onclick: () => {
              journalTab = "people";
              viewMode = "journal";
              renderAll();
            }
          },
          lineIcon(UI_PATHS.allTales, 20),
          el("span", { style: "flex:1", text: "Journal" }),
          bundle.unread.journal || bundle.unread.quests
            ? el("span", { style: "font-size:13px;color:var(--st-rail-gold)", text: "updated" })
            : null
        ),
        el(
          "button",
          {
            type: "button",
            class: "st-rail-btn",
            "data-slot": "open-bag-btn",
            onclick: () => {
              journalTab = "bag";
              viewMode = "journal";
              renderAll();
            }
          },
          lineIcon(UI_PATHS.bag, 20),
          el("span", { style: "flex:1", text: "Whole bag" }),
          el("span", { class: "st-rl", text: `${carryKg} of ${capKg} kg` })
        )
      )
    );
  }

  function renderRollRecord(r: RollDisplayRecord): HTMLElement {
    const learn = Boolean(bundle?.campaign.learn);
    return el(
      "div",
      { class: "st-roll-card" },
      d20Badge(String(r.kept), true),
      el(
        "div",
        { style: "flex:1;min-width:0" },
        el(
          "div",
          { style: "display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px" },
          el("span", { class: "st-fr", style: "font-size:20px;font-weight:600", text: r.label }),
          el("span", {
            style: "font-size:16px;color:var(--st-ink-muted)",
            text: `${r.kept} ${r.bonus >= 0 ? "+" : "−"} ${Math.abs(r.bonus)} = ${r.total}, against ${r.dc}`
          })
        ),
        learn && r.why ? el("div", { style: "font-size:14px;color:var(--st-ink-muted)", text: r.why }) : null
      ),
      el("div", {
        class: `st-roll-outcome ${r.ok ? "is-ok" : "is-fail"}`,
        text: r.ok ? "Success" : "Failure"
      })
    );
  }

  function renderStoryPage(page: HTMLElement, scrollToBottom = false): void {
    if (!bundle) return;
    const G = bundle.campaign;
    const ch = G.char;
    const place = G.place ? bundle.entities[G.place] : null;
    const keepAct = ($("#act") as HTMLInputElement | null)?.value || "";
    const actFocused = document.activeElement?.id === "act";

    const kids: HTMLElement[] = [];

    // Previously on... collapsible recap
    if (G.summary) {
      kids.push(
        el(
          "details",
          { class: "st-recap-box" },
          el("summary", { class: "st-recap-toggle", text: "The story so far" }),
          el("p", {
            class: "st-gd",
            style: "margin:8px 0 0;font-style:italic;font-size:18px;line-height:1.55;color:var(--st-ink-muted)",
            text: G.summary
          })
        )
      );
    }

    // Scene Header
    kids.push(
      el(
        "div",
        { class: "st-scene-head" },
        el(
          "div",
          null,
          el("h1", { class: "st-fr", style: "margin:0;font-size:38px;font-weight:700;line-height:1.05", text: place?.name || G.name }),
          place?.desc ? el("div", { class: "st-gd", style: "font-style:italic;font-size:17px;color:var(--st-ink-muted)", text: place.desc }) : null
        )
      )
    );

    // Log Entries
    let firstNarrDone = false;
    for (const entry of bundle.log) {
      if (entry.t > 0) {
        kids.push(el("div", { class: "st-turn-num", text: String(entry.t) }));
      }
      if (entry.you && !/^\(/.test(entry.you)) {
        kids.push(
          el(
            "div",
            { class: "st-you-move" },
            el("span", { style: "color:var(--st-accent-player);margin-top:4px" }, quillSvg(18)),
            el("div", { class: "st-you-move-text", text: entry.you })
          )
        );
      }
      if (entry.roll) kids.push(renderRollRecord(entry.roll));

      entry.segs.forEach((seg, idx) => {
        if (seg.n) {
          const p = renderHighlight(seg.n);
          if (!firstNarrDone && seg.n.length > 1) {
            firstNarrDone = true;
            const firstChar = seg.n[0];
            p.prepend(el("span", { class: "st-dropcap", "aria-hidden": "true", text: firstChar }));
          }
          const isLastSeg = idx === entry.segs.length - 1;
          if (isLastSeg && entry.chips.length) {
            kids.push(
              el(
                "div",
                { class: "st-narr-row" },
                p,
                el(
                  "div",
                  { "data-slot": "margin-notes" },
                  ...entry.chips.map(([txt, kind]) =>
                    el("span", { "data-kind": kind || "info", text: txt })
                  )
                )
              )
            );
          } else {
            kids.push(p);
          }
        } else if (seg.say) {
          kids.push(renderSpeechSeg(seg.say, seg.text || ""));
        } else if (seg.sfx) {
          kids.push(
            el(
              "div",
              { class: "st-sfx-block", role: "img", "aria-label": `Sound: ${seg.sfx}` },
              el("div", { class: "st-sfx-word", text: seg.sfx })
            )
          );
        }
      });

      if (entry.fight) {
        kids.push(renderFightLogCard(entry.fight, ch.name, renderHighlight));
      }
    }

    // Interactive Edge Cards (Pending Check / Ruling / Death Saves / Combat Gate / Thinking / Retry / Fallen)
    if (G.pending && !G.combat) {
      const p = G.pending;
      if (p.ruling) {
        kids.push(
          renderRulingCard({
            bundle,
            rl: {
              ruling: p.ruling,
              line: p.line || p.input
            },
            info: null,
            inFight: false,
            onRoll: doRollPendingCheck,
            onChange: doCancelCreativeRuling
          })
        );
      } else if (p.check) {
        const { bonus, why } = checkBonus(ch, p.check);
        kids.push(
          el(
            "div",
            { class: "st-roll-card", "data-slot": "pending-roll" },
            d20Badge("", false),
            el(
              "div",
              { style: "flex:1;min-width:0" },
              el("div", { class: "st-fr", style: "font-size:20px;font-weight:600", text: checkLabel(p.check) }),
              el("div", { class: "st-pl", text: `d20 ${sign(bonus)} · DC ${p.check.dc}. ${why}` })
            ),
            el("button", { type: "button", class: "st-btn-gold", onclick: doRollPendingCheck }, "Roll the d20")
          )
        );
      }
    }

    if (ch.dying && G.status === "active" && !G.combat) {
      kids.push(
        el(
          "div",
          { class: "st-ruling-card", "data-slot": "death-saves" },
          el("div", { class: "st-h", text: "At death's door" }),
          el("div", { text: `${ch.name} is unconscious at 0 HP. Successes: ${ch.dying.s} of 3 · Failures: ${ch.dying.f} of 3.` }),
          el("div", { style: "display:flex;justify-content:flex-end" }, el("button", { type: "button", class: "st-btn-gold", onclick: doRollDeathSave }, "Roll death save"))
        )
      );
    }

    if (G.combat && !cui.entered && G.status === "active") {
      kids.push(
        el(
          "div",
          { class: "st-ruling-card", "data-slot": "hostiles-engaged" },
          el("div", { class: "st-h", text: "Hostiles engaged" }),
          el("div", { text: foeSummary(G.combat.spec.foes) || "Steel is drawn." }),
          el(
            "div",
            { style: "display:flex;justify-content:flex-end" },
            el(
              "button",
              {
                type: "button",
                class: "st-btn-ink",
                onclick: () => {
                  cui.entered = G.combat!.id;
                  renderAll(true);
                }
              },
              "Enter combat"
            )
          )
        )
      );
    }

    if (busy) {
      kids.push(
        el(
          "div",
          { class: "st-pl", style: "font-style:italic" },
          activeWaitNotice
            ? `Waiting ${Math.ceil(activeWaitNotice.secondsLeft)}s for rate limit (${activeWaitNotice.connectionLabel})...`
            : "The narrator is writing..."
        )
      );
    }

    if (retryState && !busy) {
      kids.push(
        el(
          "div",
          { class: "st-ruling-card", "data-slot": "retry-card" },
          el("div", { class: "st-h", text: "The narrator stumbled" }),
          el("div", { class: "st-pl", text: retryState.msg }),
          el(
            "div",
            { style: "display:flex;justify-content:flex-end" },
            el("button", { type: "button", class: "st-btn-primary", onclick: () => void runTurn(retryState!.input, retryState!.opts) }, "Try again")
          )
        )
      );
    }

    if (G.status !== "active") {
      kids.push(
        el(
          "div",
          { class: "st-ruling-card", "data-slot": "hero-fallen" },
          el("div", { class: "st-fr", style: "font-size:26px;font-weight:700;color:var(--st-accent-foe)", text: `${ch.name} has fallen` }),
          G.epitaph ? el("p", { class: "st-gd", style: "font-style:italic;font-size:19px;margin:0", text: G.epitaph }) : null,
          el(
            "div",
            { style: "display:flex;justify-content:flex-end;gap:10px" },
            el("button", { type: "button", class: "st-btn-quiet", onclick: () => void exportCurrentCampaign() }, "Export chronicle"),
            el("button", { type: "button", class: "st-btn-primary", onclick: () => void showStart() }, "Return to cover")
          )
        )
      );
    }

    // What do you do? Action Block
    if (G.status === "active" && !G.combat) {
      const open = canAct();
      const opts = G.options || [];
      const actBlock = el(
        "div",
        { "data-slot": "action-block" },
        el("h2", { class: "st-fr", style: "margin:0 0 6px;font-size:24px;font-style:italic;font-weight:600", text: "What do you do?" }),
        ...opts.map(opt =>
          el(
            "button",
            {
              type: "button",
              class: "st-choice",
              disabled: !open,
              onclick: () => void runTurn(opt)
            },
            choiceArrowSvg(),
            el("span", { text: opt })
          )
        ),
        el(
          "form",
          {
            class: "st-hand-input-row",
            onsubmit: (e: Event) => {
              e.preventDefault();
              const inp = $("#act") as HTMLInputElement | null;
              const val = inp?.value.trim() || "";
              if (val) {
                if (inp) inp.value = "";
                void runTurn(val);
              }
            }
          },
          el("span", { style: "color:var(--st-accent-player);margin-bottom:12px" }, quillSvg(18)),
          el("label", { for: "act", class: "sr-only" }, "Write your own move"),
          el("input", {
            id: "act",
            class: "st-hand-input",
            autocomplete: "off",
            maxlength: "400",
            disabled: !open,
            value: keepAct,
            placeholder: "or write your own move"
          }),
          el("button", { type: "submit", class: "st-btn-primary", disabled: !open }, "Send")
        ),
        el(
          "div",
          { style: "display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:14px" },
          el(
            "button",
            {
              type: "button",
              class: "st-btn-quiet",
              disabled: !open,
              onclick: () => void runTurn(CONTINUE_DIRECTOR_NOTE, { note: CONTINUE_DIRECTOR_NOTE, minTime: 10 })
            },
            lineIcon(UI_PATHS.hourglass, 18),
            el("span", { text: "Let time pass" })
          ),
          el(
            "button",
            { type: "button", class: "st-btn-quiet", disabled: !open, onclick: () => doRest("short") },
            lineIcon(UI_PATHS.campfire, 18),
            el("span", { text: "Short rest" })
          ),
          el(
            "button",
            { type: "button", class: "st-btn-quiet", disabled: !open, onclick: () => doRest("long") },
            lineIcon(UI_PATHS.moon, 18),
            el("span", { text: "Long rest" })
          )
        ),
        el(
          "div",
          { style: "display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px 20px;margin-top:8px;font-size:15px;color:var(--st-ink-muted)" },
          el(
            "label",
            { style: "display:flex;align-items:center;gap:8px;min-height:44px;cursor:pointer" },
            el("input", {
              type: "checkbox",
              checked: strongNext,
              style: "width:18px;height:18px;accent-color:var(--st-accent-player)",
              onchange: (e: Event) => {
                strongNext = (e.target as HTMLInputElement).checked;
              }
            }),
            "Stronger narrator for this turn"
          ),
          el(
            "details",
            { style: "font-size:14px" },
            el("summary", { style: "cursor:pointer", text: `Narrator is told: ${G.prefs || "default style"}.` }),
            el("input", {
              type: "text",
              class: "st-hand-input",
              style: "font-size:17px;height:36px;margin-top:4px",
              value: G.prefs || "",
              placeholder: "Plain language, no metaphors",
              onchange: (e: Event) => {
                const val = str((e.target as HTMLInputElement).value, 300);
                commitBundleInPlace(bundle!, "update prefs", draft => {
                  draft.campaign.prefs = val;
                });
                void queueSave();
                toast("Narrator instructions saved.");
              }
            })
          )
        )
      );
      kids.push(actBlock);
    }

    put(
      page,
      el(
        "div",
        { "data-slot": "page-running-head" },
        el("span", { class: "st-gd", style: "font-style:italic;font-size:16px", text: "Solo Tales" }),
        el("span", { class: "st-gd", style: "font-variant:small-caps;letter-spacing:.06em;font-size:16px", text: place?.name || G.name }),
        el("span", { text: `turn ${G.turn}` })
      ),
      el("div", { "data-slot": "page-body" }, ...kids)
    );

    const box = $<HTMLInputElement>("#act");
    if (box && actFocused && !box.disabled) box.focus();
    if (scrollToBottom) {
      requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
    }
  }

  function handlePhoneNav(tab: PhoneTab): void {
    if (tab === "story") {
      viewMode = "play";
    } else if (tab === "sheet") {
      viewMode = "sheet";
    } else if (tab === "bag") {
      journalTab = "bag";
      viewMode = "journal";
    } else {
      journalTab = "people";
      viewMode = "journal";
    }
    renderAll();
  }

  function renderAll(scrollToBottom = false): void {
    if (viewMode === "start" || !bundle) {
      void renderStartScreen();
      return;
    }
    if (viewMode === "sheet") {
      const heroUrl = deps.portraits.getUrl(bundle.campaign.char.portraitId, deps.store, () => renderAll());
      import("./sheet-view").then(({ renderSheetView }) => {
        if (!bundle || viewMode !== "sheet") return;
        renderSheetView(stageHost, {
          bundle,
          portraitUrl: heroUrl,
          busyPortrait: heroPortraitBusy,
          onBack: () => {
            viewMode = "play";
            renderAll();
          },
          onNav: handlePhoneNav,
          onPaintPortrait: () => void paintHeroPortrait(),
          onUploadPortrait: f => void uploadHeroPortrait(f)
        });
      });
      return;
    }
    if (viewMode === "journal") {
      renderJournalSpread(stageHost, {
        getBundle: () => bundle,
        getTab: () => journalTab,
        setTab: t => {
          journalTab = t;
        },
        getSelectedNpcId: () => selectedNpcId,
        setSelectedNpcId: id => {
          selectedNpcId = id;
        },
        getSelectedPlaceId: () => selectedPlaceId,
        setSelectedPlaceId: id => {
          selectedPlaceId = id;
        },
        ask,
        router: deps.router,
        imageRouter: deps.imageRouter,
        store: deps.store,
        portraits: deps.portraits,
        canAct,
        isConflicted: () => conflicted,
        onBack: () => {
          viewMode = "play";
          renderAll();
        },
        onNav: handlePhoneNav,
        onRenderAll: () => renderAll(),
        onRenderSpreadOnly: () => renderAll(),
        onSave: () => queueSave(),
        onSendAction: text => void runTurn(text)
      });
      return;
    }
    renderPlayStage(scrollToBottom);
  }

  /* ---- Navigation ---- */
  async function showStart(): Promise<void> {
    ask.ctl?.abort();
    bundle = null;
    lastTurnUndo = null;
    conflicted = false;
    busy = false;
    retryState = null;
    viewMode = "start";
    await renderStartScreen();
  }

  async function enterGame(loaded: CampaignBundle): Promise<void> {
    bundle = loaded;
    lastTurnUndo = null;
    lastSavedUpdated = loaded.campaign.updated || Date.now();
    conflicted = false;
    busy = false;
    retryState = null;
    cui.entered = loaded.campaign.combat?.cs ? loaded.campaign.combat.id : null;
    cui.aim = null;
    cui.msg = "";
    cui.notes = [];
    viewMode = "play";
    renderAll(true);
  }

  function dispose(): void {
    unsubWait();
    conflictGuard.close();
    deps.portraits.clear();
  }

  return {
    showStart,
    enterGame,
    dispose
  };
}
