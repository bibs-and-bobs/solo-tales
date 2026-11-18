/* Dedicated 2-Page Book Spread: Journal & Bag (People, Places, Errands & Threats, What you know, Bag). */

import type { ImageRouter } from "../adapters/image/image-router";
import type { ModelRouter } from "../adapters/llm";
import type { GameStore } from "../adapters/storage";
import {
  attWord,
  carryCapacityKg,
  clockTimeLeftText,
  commitBundleInPlace,
  drinkPotionInBundle,
  itemWeightKg,
  knows,
  rid,
  str,
  totalCarryWeightKg,
  type CampaignBundle,
  type WorldEntity
} from "../engine";
import { askWorldQuestion } from "../narrator";
import { $, el, put, renderAvatarNode, toast, type PortraitUrlCache } from "./dom";
import {
  UI_PATHS,
  attitudeKey,
  lineIcon,
  phoneBottomNav,
  starSvg,
  type PhoneTab
} from "./chrome";
import { iconFor, svgIcon } from "./icons";

export type JournalSpreadTab = "people" | "places" | "errands" | "facts" | "bag";

export interface AskState {
  q: string;
  a: string;
  busy: boolean;
  err: string;
  ctl: AbortController | null;
}

export function createAskState(): AskState {
  return { q: "", a: "", busy: false, err: "", ctl: null };
}

export interface JournalSpreadDeps {
  getBundle: () => CampaignBundle | null;
  getTab: () => JournalSpreadTab;
  setTab: (t: JournalSpreadTab) => void;
  getSelectedNpcId: () => string | null;
  setSelectedNpcId: (id: string | null) => void;
  getSelectedPlaceId: () => string | null;
  setSelectedPlaceId: (id: string | null) => void;
  ask: AskState;
  router: ModelRouter;
  imageRouter: ImageRouter;
  store: GameStore;
  portraits: PortraitUrlCache;
  canAct: () => boolean;
  isConflicted: () => boolean;
  onBack: () => void;
  onNav: (tab: PhoneTab) => void;
  onRenderAll: () => void;
  onRenderSpreadOnly: () => void;
  onSave: () => Promise<void>;
  onSendAction: (text: string) => void;
}

export function renderJournalSpread(container: HTMLElement, deps: JournalSpreadDeps): void {
  const bundle = deps.getBundle();
  if (!bundle) return;
  const G = bundle.campaign;
  const tab = deps.getTab();

  async function askWorld(q: string, deep = false): Promise<void> {
    const b = deps.getBundle();
    if (!b || !q.trim() || deps.ask.busy) return;
    if (!deps.router.getEnabledConnections().length) {
      deps.ask.err = "No AI model connected. Open API & Theme Settings first.";
      deps.onRenderSpreadOnly();
      return;
    }
    const ctl = new AbortController();
    const gid = b.campaign.id;
    deps.ask = Object.assign(deps.ask, { q, a: "", busy: true, err: "", ctl });
    deps.onRenderSpreadOnly();
    try {
      await askWorldQuestion(b, deps.router, q.trim(), {
        deep,
        signal: ctl.signal,
        onChunk: (textSoFar: string) => {
          if (deps.ask.ctl !== ctl) return;
          deps.ask.a = textSoFar;
          const box = $("#askans", container);
          if (box) box.textContent = textSoFar;
        }
      });
    } catch (err: any) {
      if (deps.ask.ctl === ctl && err?.name !== "AbortError") {
        deps.ask.err = err?.message || "Could not get an answer right now.";
      }
    }
    if (deps.ask.ctl !== ctl) return;
    deps.ask.busy = false;
    deps.ask.ctl = null;
    if (deps.getBundle()?.campaign.id === gid) {
      deps.onRenderSpreadOnly();
    }
  }

  function useItem(id: string): void {
    const b = deps.getBundle();
    if (!b || !deps.canAct()) return;
    const it = b.campaign.char.inv.find(i => i.id === id);
    if (!it) return;
    if (/healing/i.test(it.name) && b.campaign.char.hp < b.campaign.char.maxHp) {
      commitBundleInPlace(b, "potion", draft => {
        drinkPotionInBundle(draft, id);
      });
      void deps.onSave();
      deps.onRenderAll();
      return;
    }
    deps.onBack();
    deps.onSendAction(`I use ${it.name}.`);
  }

  async function paintNpcPortrait(npc: WorldEntity): Promise<void> {
    const b = deps.getBundle();
    if (!b || !deps.imageRouter.hasAiImageCapability()) {
      toast("Configure an Image API or keep Heraldic Crests in Settings.");
      return;
    }
    toast(`Painting portrait of ${npc.name}...`);
    try {
      const res = await deps.imageRouter.generatePortrait(
        {
          kind: "npc",
          name: npc.name,
          role: npc.role || undefined,
          appearance: npc.appearance || npc.desc || undefined,
          attitude: attitudeKey(npc.att)
        },
        b.campaign.artBrief
      );
      const portraitId = `npc_${npc.id}_${rid()}`;
      await deps.store.putBlob(portraitId, res.blob);
      deps.portraits.putBlobUrl(portraitId, res.blob);
      commitBundleInPlace(b, "npc-portrait", draft => {
        if (draft.entities[npc.id]) draft.entities[npc.id].portraitId = portraitId;
      });
      await deps.onSave();
      deps.onRenderSpreadOnly();
      toast(`Portrait saved for ${npc.name}.`);
    } catch (err: any) {
      toast(err?.message || "Portrait generation failed.");
    }
  }

  function renderAskBox(): HTMLElement {
    const inp = el("input", {
      id: "askq",
      class: "st-hand-input",
      maxlength: "500",
      value: deps.ask.q,
      placeholder: "who else lives near the mill?",
      oninput: (e: Event) => {
        deps.ask.q = (e.target as HTMLInputElement).value;
      }
    });
    return el(
      "form",
      {
        style: "display:flex;flex-direction:column;gap:8px",
        onsubmit: (e: Event) => {
          e.preventDefault();
          const deep = Boolean(($("#askdeep", container) as HTMLInputElement | null)?.checked);
          void askWorld(deps.ask.q, deep);
        }
      },
      el("label", { for: "askq", class: "st-h", text: "Ask about this world" }),
      el(
        "div",
        { style: "display:flex;align-items:flex-end;gap:12px" },
        inp,
        deps.ask.busy
          ? el("button", { type: "button", class: "st-btn-quiet", onclick: () => deps.ask.ctl?.abort() }, "Stop")
          : el("button", { type: "submit", class: "st-btn-primary" }, "Ask")
      ),
      el(
        "label",
        { style: "display:inline-flex;align-items:center;gap:6px;font-size:14px;color:var(--st-ink-muted);cursor:pointer" },
        el("input", { type: "checkbox", id: "askdeep", style: "accent-color:var(--st-accent-player)" }),
        "Think harder"
      ),
      deps.ask.a || deps.ask.busy
        ? el("p", {
            id: "askans",
            class: "st-gd",
            style: "margin:4px 0 0;font-size:18px;line-height:1.55;color:var(--st-ink)",
            text: deps.ask.a || "Checking what you have learned..."
          })
        : null,
      deps.ask.err ? el("div", { style: "color:var(--st-accent-foe);font-size:14px", text: deps.ask.err }) : null,
      el("div", {
        class: "st-pl",
        text: `Answers use only what ${G.char.name.split(" ")[0]} has learned. Asking costs no time.`
      })
    );
  }

  const activeBundle = bundle;

  function renderFactRow(f: CampaignBundle["facts"][string]): HTMLElement {
    return el(
      "div",
      { style: "display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--st-rule-light)" },
      el("span", { class: "st-gd", style: "flex:1;font-size:18px;line-height:1.45;padding:6px 0", text: f.text }),
      el(
        "button",
        {
          type: "button",
          style: "flex:0 0 auto;width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:transparent;border:0;cursor:pointer",
          "aria-pressed": f.pinned ? "true" : "false",
          "aria-label": f.pinned ? "Starred. Remove the star" : "Star this for the narrator",
          onclick: () => {
            commitBundleInPlace(activeBundle, "pin", draft => {
              if (draft.facts[f.id]) draft.facts[f.id].pinned = !draft.facts[f.id].pinned;
            });
            void deps.onSave();
            deps.onRenderSpreadOnly();
          }
        },
        starSvg(f.pinned)
      )
    );
  }

  const tabs: Array<{ id: JournalSpreadTab; label: string }> = [
    { id: "people", label: "People" },
    { id: "places", label: "Places" },
    { id: "errands", label: "Errands" },
    { id: "facts", label: "What you know" },
    { id: "bag", label: "Bag" }
  ];

  let leftPage: HTMLElement;
  let rightPage: HTMLElement;

  if (tab === "people") {
    const people = Object.values(bundle.entities)
      .filter(e => e.kind === "npc")
      .sort((a, b) => (b.seen || 0) - (a.seen || 0));
    const selId =
      deps.getSelectedNpcId() && people.some(p => p.id === deps.getSelectedNpcId())
        ? deps.getSelectedNpcId()
        : people[0]?.id || null;
    const selected = people.find(p => p.id === selId) || null;

    leftPage = el(
      "section",
      { class: "st-spread-page", "data-slot": "journal-left" },
      el("h1", { class: "st-fr", style: "margin:0;font-size:44px;font-weight:800;line-height:1", text: "Journal" }),
      renderAskBox(),
      el(
        "div",
        null,
        el("h2", { class: "st-h", text: "People you have met" }),
        el(
          "div",
          { style: "border-top:1.5px solid var(--st-rule);margin-top:4px" },
          people.length
            ? people.map(p => {
                const ak = attitudeKey(p.att);
                const open = selected?.id === p.id;
                const placeName = p.loc && bundle.entities[p.loc] ? bundle.entities[p.loc].name : "";
                const ink =
                  ak === "friendly"
                    ? "var(--st-accent-friend)"
                    : ak === "hostile"
                    ? "var(--st-accent-foe)"
                    : "var(--st-ink-muted)";
                return el(
                  "button",
                  {
                    type: "button",
                    class: "st-who-row",
                    "aria-pressed": open ? "true" : "false",
                    onclick: () => {
                      deps.setSelectedNpcId(p.id);
                      deps.onRenderSpreadOnly();
                    }
                  },
                  el("span", { class: "st-pip", "data-attitude": ak, "aria-hidden": "true" }),
                  el(
                    "span",
                    { style: "flex:1;min-width:0" },
                    el("span", {
                      style: `display:block;font-weight:700;font-variant:small-caps;letter-spacing:.05em;font-size:18px;color:${ink}`,
                      text: p.name
                    }),
                    el("span", {
                      class: "st-pl",
                      style: "display:block",
                      text: [p.role, placeName].filter(Boolean).join(". ")
                    })
                  ),
                  el("span", { style: `font-size:14px;color:${ink}`, text: attWord(p.att || 0) })
                );
              })
            : el("p", { class: "st-pl", text: "Nobody met yet. People you talk to appear here." })
        ),
        el(
          "div",
          { class: "st-pl", style: "display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:10px" },
          el("span", { style: "display:flex;align-items:center;gap:6px" }, el("span", { class: "st-pip", "data-attitude": "friendly" }), "friendly"),
          el("span", { style: "display:flex;align-items:center;gap:6px" }, el("span", { class: "st-pip", "data-attitude": "neutral" }), "neither"),
          el("span", { style: "display:flex;align-items:center;gap:6px" }, el("span", { class: "st-pip", "data-attitude": "hostile" }), "hostile")
        )
      )
    );

    if (selected) {
      const ak = attitudeKey(selected.att);
      const ink =
        ak === "friendly"
          ? "var(--st-accent-friend)"
          : ak === "hostile"
          ? "var(--st-accent-foe)"
          : "var(--st-ink-muted)";
      const npcFacts = Object.values(bundle.facts)
        .filter(f => knows(f) && f.about.includes(selected.id))
        .reverse();
      const npcPortraitUrl = deps.portraits.getUrl(selected.portraitId, deps.store, () => deps.onRenderSpreadOnly());
      const avatarBox = renderAvatarNode({
        name: selected.name,
        portraitUrl: npcPortraitUrl,
        className: "st-avatar",
        sizePx: 56
      });

      rightPage = el(
        "section",
        { class: "st-spread-page", "data-slot": "journal-dossier" },
        el(
          "div",
          { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:12px" },
          el(
            "div",
            null,
            el("h2", { class: "st-fr", style: `margin:0;font-size:44px;font-weight:700;line-height:1;color:${ink}`, text: selected.name }),
            el("div", {
              class: "st-gd",
              style: "font-style:italic;font-size:19px;color:var(--st-ink-muted);margin-top:4px",
              text: [selected.role, selected.loc && bundle.entities[selected.loc] ? `at ${bundle.entities[selected.loc].name}` : ""]
                .filter(Boolean)
                .join(", ")
            })
          ),
          el(
            "div",
            { style: "display:flex;flex-direction:column;align-items:flex-end;gap:6px" },
            avatarBox,
            deps.imageRouter.hasAiImageCapability()
              ? el(
                  "button",
                  {
                    type: "button",
                    class: "st-btn-quiet",
                    style: "min-height:32px;padding:0 10px;font-size:13px",
                    onclick: () => void paintNpcPortrait(selected)
                  },
                  selected.portraitId ? "Repaint" : "Paint portrait"
                )
              : null
          )
        ),
        el(
          "div",
          { style: "display:flex;align-items:baseline;gap:10px;padding:10px 0;border-top:1.5px solid var(--st-rule);border-bottom:1px solid var(--st-rule-light)" },
          el("span", { class: "st-pip", "data-attitude": ak, "aria-hidden": "true" }),
          el(
            "span",
            null,
            el("b", { style: `color:${ink}`, text: `${attWord(selected.att || 0)}. ` }),
            selected.combatStatus ? `Status: ${selected.combatStatus}. ` : "",
            selected.desc || ""
          )
        ),
        selected.appearance || selected.agenda
          ? el(
              "div",
              { style: "display:grid;grid-template-columns:90px 1fr;gap:8px 16px;font-size:16px" },
              selected.appearance ? [el("span", { class: "st-pl", text: "Looks" }), el("span", { text: selected.appearance })] : null,
              selected.agenda ? [el("span", { class: "st-pl", text: "Wants" }), el("span", { text: selected.agenda })] : null
            )
          : null,
        el(
          "div",
          null,
          el("h3", { class: "st-h", text: `What you know of ${selected.name.split(" ")[0]}` }),
          el(
            "div",
            { style: "border-top:1.5px solid var(--st-rule);margin-top:4px" },
            npcFacts.length
              ? npcFacts.map(renderFactRow)
              : el("p", { class: "st-pl", text: "No recorded facts yet." })
          ),
          el("div", { class: "st-pl", style: "margin-top:8px", text: "A starred line is always given to the narrator." })
        ),
        el(
          "div",
          { style: "display:flex;flex-direction:column;gap:4px", "data-slot": "npc-player-note" },
          el("label", { for: "npc-note", class: "st-h", text: "Your note" }),
          el("input", {
            id: "npc-note",
            class: "st-hand-input",
            value: selected.playerNote || "",
            placeholder: "jot down what you suspect or want to ask...",
            onchange: (e: Event) => {
              const val = str((e.target as HTMLInputElement).value, 300);
              commitBundleInPlace(bundle, "npc-note", draft => {
                if (draft.entities[selected.id]) draft.entities[selected.id].playerNote = val;
              });
              void deps.onSave();
            }
          })
        )
      );
    } else {
      rightPage = el(
        "section",
        { class: "st-spread-page", "data-slot": "journal-dossier" },
        el("h2", { class: "st-fr", style: "margin:0;font-size:32px;color:var(--st-ink-muted)", text: "No dossier open" }),
        el("p", { class: "st-gd", style: "font-size:18px", text: "As you meet people on your travels, their dossier, attitude, and your handwritten notes will appear here." })
      );
    }
  } else if (tab === "places") {
    const places = Object.values(bundle.entities)
      .filter(e => e.kind === "place")
      .sort((a, b) => (b.visited || 0) - (a.visited || 0));
    const selPlaceId =
      deps.getSelectedPlaceId() && places.some(p => p.id === deps.getSelectedPlaceId())
        ? deps.getSelectedPlaceId()
        : G.place && places.some(p => p.id === G.place)
        ? G.place
        : places[0]?.id || null;
    const selectedPlace = places.find(p => p.id === selPlaceId) || null;

    leftPage = el(
      "section",
      { class: "st-spread-page", "data-slot": "journal-left" },
      el("h1", { class: "st-fr", style: "margin:0;font-size:44px;font-weight:800;line-height:1", text: "Places" }),
      el(
        "div",
        { style: "border-top:1.5px solid var(--st-rule)" },
        places.length
          ? places.map(p =>
              el(
                "button",
                {
                  type: "button",
                  class: "st-who-row",
                  "aria-pressed": selectedPlace?.id === p.id ? "true" : "false",
                  onclick: () => {
                    deps.setSelectedPlaceId(p.id);
                    deps.onRenderSpreadOnly();
                  }
                },
                el(
                  "span",
                  { style: "flex:1;min-width:0" },
                  el("span", { style: "display:block;font-weight:700;font-size:18px", text: p.name }),
                  el("span", { class: "st-pl", style: "display:block", text: p.desc || "" })
                ),
                p.id === G.place ? el("span", { class: "st-pl", text: "here now" }) : null
              )
            )
          : el("p", { class: "st-pl", text: "No places charted yet." })
      )
    );

    rightPage = selectedPlace
      ? el(
          "section",
          { class: "st-spread-page", "data-slot": "journal-dossier" },
          el("h2", { class: "st-fr", style: "margin:0;font-size:40px;font-weight:700", text: selectedPlace.name }),
          el("p", { class: "st-gd", style: "font-size:19px;line-height:1.55", text: selectedPlace.desc || "A place along your road." }),
          el("h3", { class: "st-h", text: "What happened here" }),
          el(
            "div",
            { style: "border-top:1.5px solid var(--st-rule)" },
            ...Object.values(bundle.facts)
              .filter(f => knows(f) && (f.place === selectedPlace.id || f.about.includes(selectedPlace.id)))
              .reverse()
              .map(renderFactRow)
          )
        )
      : el("section", { class: "st-spread-page" }, el("p", { class: "st-pl", text: "Select a place to inspect it." }));
  } else if (tab === "errands") {
    const knownClocks = Object.values(bundle.clocks).filter(c => c.knownToPlayer);

    leftPage = el(
      "section",
      { class: "st-spread-page", "data-slot": "journal-errands" },
      el("h1", { class: "st-fr", style: "margin:0;font-size:44px;font-weight:800;line-height:1", text: "Errands" }),
      G.quests.length
        ? el(
            "div",
            { style: "border-top:1.5px solid var(--st-rule)" },
            ...[...G.quests].reverse().map(q =>
              el(
                "div",
                { style: "padding:12px 0;border-bottom:1px solid var(--st-rule-light)" },
                el(
                  "div",
                  { style: "display:flex;justify-content:space-between;align-items:baseline;gap:8px" },
                  el("strong", { class: "st-fr", style: "font-size:21px", text: q.title }),
                  el("span", { class: "st-pl", text: q.status === "active" ? "Active" : q.status === "done" ? "Completed" : "Failed" })
                ),
                el("div", { class: "st-gd", style: "font-size:18px;margin-top:4px", text: q.obj })
              )
            )
          )
        : el("p", { class: "st-pl", text: "No errands yet. They appear here as people ask things of you." })
    );

    rightPage = el(
      "section",
      { class: "st-spread-page", "data-slot": "journal-threats" },
      el("h2", { class: "st-fr", style: "margin:0;font-size:36px;font-weight:700", text: "Known threats" }),
      el("p", { class: "st-pl", style: "margin:0", text: "Dangers in the world that advance as time passes." }),
      knownClocks.length
        ? el(
            "div",
            { style: "display:flex;flex-direction:column;gap:14px;border-top:1.5px solid var(--st-rule);padding-top:12px" },
            ...knownClocks.map(c =>
              el(
                "div",
                { class: "st-box" },
                el(
                  "div",
                  { style: "display:flex;justify-content:space-between;align-items:baseline;gap:8px" },
                  el("strong", { text: c.name }),
                  el("span", { class: "st-pl", text: c.status === "triggered" ? "Triggered" : c.status === "averted" ? "Averted" : `${c.filled}/${c.segments} · ${clockTimeLeftText(c)}` })
                ),
                c.consequence ? el("div", { class: "st-pl", style: "margin-top:4px", text: c.consequence }) : null,
                el(
                  "div",
                  { class: "st-clock-pips", role: "img", "aria-label": `${c.filled} of ${c.segments} segments` },
                  ...Array.from({ length: c.segments }, (_, i) =>
                    el("span", { class: i < c.filled ? "st-clock-pip is-filled" : "st-clock-pip" })
                  )
                )
              )
            )
          )
        : el("p", { class: "st-pl", text: "No known looming threats right now." })
    );
  } else if (tab === "facts") {
    const knownFacts = Object.values(bundle.facts).filter(knows).reverse();
    const pinnedFacts = knownFacts.filter(f => f.pinned);

    leftPage = el(
      "section",
      { class: "st-spread-page", "data-slot": "journal-facts" },
      el("h1", { class: "st-fr", style: "margin:0;font-size:44px;font-weight:800;line-height:1", text: "What you know" }),
      el("div", { class: "st-pl", text: "Star a line so the narrator never forgets it." }),
      el(
        "div",
        { style: "border-top:1.5px solid var(--st-rule)" },
        knownFacts.length
          ? knownFacts.map(renderFactRow)
          : el("p", { class: "st-pl", text: "Nothing recorded yet." })
      )
    );

    rightPage = el(
      "section",
      { class: "st-spread-page", "data-slot": "journal-pinned" },
      el("h2", { class: "st-fr", style: "margin:0;font-size:36px;font-weight:700", text: "Starred for the narrator" }),
      pinnedFacts.length
        ? el("div", { style: "border-top:1.5px solid var(--st-rule)" }, ...pinnedFacts.map(renderFactRow))
        : el("p", { class: "st-pl", text: "No starred facts yet. Click the star next to any line on the left." })
    );
  } else {
    // Bag tab
    const equipped = G.char.inv.filter(i => i.eq);
    const carried = G.char.inv.filter(i => !i.eq);
    const carryKg = totalCarryWeightKg(G.char.inv);
    const capKg = carryCapacityKg(G.char.abil.str);

    const renderItemRow = (it: (typeof G.char.inv)[number]) =>
      el(
        "div",
        { style: "display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--st-rule-light)" },
        svgIcon(iconFor(it.name), "var(--st-ink)", 24),
        el(
          "span",
          { style: "flex:1;min-width:0" },
          el("span", { style: "display:block;font-weight:700", text: it.qty > 1 ? `${it.name} ×${it.qty}` : it.name }),
          el("span", { class: "st-pl", style: "display:block", text: [it.note, `${itemWeightKg(it)} kg`].filter(Boolean).join(" · ") })
        ),
        !it.eq
          ? el(
              "button",
              {
                type: "button",
                class: "st-btn-quiet",
                style: "min-height:36px;padding:0 12px;font-size:14px",
                onclick: () => useItem(it.id)
              },
              /healing/i.test(it.name) ? "Drink" : "Use"
            )
          : el("span", { class: "st-pl", text: "worn" })
      );

    leftPage = el(
      "section",
      { class: "st-spread-page", "data-slot": "bag-equipped" },
      el("h1", { class: "st-fr", style: "margin:0;font-size:44px;font-weight:800;line-height:1", text: "Whole bag" }),
      el("div", { class: "st-pl", text: `Total load: ${carryKg} of ${capKg} kg · Gold: ${G.char.gold} gp` }),
      el("h2", { class: "st-h", text: "Worn & in hand" }),
      el(
        "div",
        { style: "border-top:1.5px solid var(--st-rule)" },
        equipped.length ? equipped.map(renderItemRow) : el("p", { class: "st-pl", text: "Nothing equipped." })
      )
    );

    rightPage = el(
      "section",
      { class: "st-spread-page", "data-slot": "bag-carried" },
      el("h2", { class: "st-h", text: "In your pack" }),
      el(
        "div",
        { style: "border-top:1.5px solid var(--st-rule)" },
        carried.length ? carried.map(renderItemRow) : el("p", { class: "st-pl", text: "Your pack is empty." })
      )
    );
  }

  put(
    container,
    el(
      "div",
      { "data-stage": "journal" },
      el(
        "div",
        { class: "st-spread-topbar" },
        el(
          "button",
          { type: "button", class: "st-back-link", "data-slot": "back-to-story", onclick: deps.onBack },
          lineIcon(UI_PATHS.back, 18),
          el("span", { text: "Back to the story" })
        ),
        el(
          "div",
          { role: "tablist", "aria-label": "Journal sections", "data-slot": "book-tabs" },
          ...tabs.map(t =>
            el(
              "button",
              {
                type: "button",
                class: "st-book-tab",
                role: "tab",
                "aria-selected": tab === t.id ? "true" : "false",
                onclick: () => {
                  deps.setTab(t.id);
                  deps.onRenderSpreadOnly();
                }
              },
              t.label
            )
          )
        )
      ),
      el("main", { "data-slot": "spread" }, leftPage, rightPage),
      phoneBottomNav({
        char: G.char,
        activeTab: tab === "bag" ? "bag" : "journal",
        onNav: deps.onNav
      })
    )
  );
}
