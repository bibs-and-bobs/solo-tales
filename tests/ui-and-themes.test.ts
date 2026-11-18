// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  carryCapacityKg,
  cleanEntity,
  clone,
  createCampaignBundle,
  estimateItemWeightKg,
  itemWeightKg,
  migrate,
  recordHpTrail,
  replaceBundleInPlace,
  totalCarryWeightKg
} from "../src/engine";
import { THEMES, applyTheme, getActiveThemeId, setActiveThemeId } from "../src/ui/themes/registry";
import { renderSheetView } from "../src/ui/sheet-view";
import { createAskState, renderJournalSpread } from "../src/ui/journal-view";
import { PortraitUrlCache } from "../src/ui/dom";
import { MemoryGameStore } from "../src/adapters/storage";
import { ModelRouter } from "../src/adapters/llm";
import { ImageRouter } from "../src/adapters/image/image-router";

describe("Engine Weight, HP Trail, Undo Snapshot & Migration", () => {
  it("estimates & sums item weights and computes Str carry capacity in kg", () => {
    expect(estimateItemWeightKg("Chain mail")).toBe(20);
    expect(estimateItemWeightKg("Longsword")).toBe(1.5);
    expect(itemWeightKg({ name: "Custom Pack", note: "", qty: 2, weightKg: 1.25 })).toBe(2.5);

    const inv = [
      { id: "1", name: "Chain mail", note: "", qty: 1, eq: true, ref: "a:chain_mail" },
      { id: "2", name: "Torch", note: "", qty: 4 }
    ];
    expect(totalCarryWeightKg(inv)).toBeCloseTo(22.0, 2);
    expect(carryCapacityKg(16)).toBe(109);
  });

  it("records bounded crossed-out HP trail and replaces bundles in place for undo", () => {
    const b = createCampaignBundle({ heroKey: "fighter" });
    b.campaign.char.hpTrail = [];
    b.campaign.char.hp = 12;
    recordHpTrail(b.campaign.char, 12); // no change -> ignored
    b.campaign.char.hp = 8;
    recordHpTrail(b.campaign.char, 12);
    b.campaign.char.hp = 10;
    recordHpTrail(b.campaign.char, 8);
    expect(b.campaign.char.hpTrail).toEqual([12, 8, 10]);

    const snapshot = clone(b);
    b.campaign.name = "Modified Name";
    b.campaign.char.hp = 3;
    replaceBundleInPlace(b, snapshot);
    expect(b.campaign.name).toBe(snapshot.campaign.name);
    expect(b.campaign.char.hp).toBe(snapshot.campaign.char.hp);
  });

  it("preserves weightKg, hpTrail, and entity playerNote across migrate() & cleanEntity()", () => {
    const b = createCampaignBundle({ heroKey: "rogue" });
    b.campaign.char.hpTrail = [10, 6];
    b.campaign.char.inv[0].weightKg = 1.75;
    const npc = cleanEntity({
      id: "npc_test",
      kind: "npc",
      name: "Maren",
      role: "Innkeeper",
      att: 1,
      loc: null,
      alive: true,
      known: true,
      note: "Runs the Hearth",
      playerNote: "Owes me a favour",
      seenTurn: 1
    });

    const migrated = migrate(clone(b.campaign));
    expect(migrated?.char.hpTrail).toEqual([10, 6]);
    expect(migrated?.char.inv[0].weightKg).toBe(1.75);
    expect(npc?.playerNote).toBe("Owes me a favour");
  });
});

describe("Multi-Theme Registry", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("registers broadsheet, obsidian, and minimalist and applies/persists active theme", () => {
    expect(THEMES.map(t => t.id)).toEqual(["broadsheet", "obsidian", "minimalist"]);
    expect(getActiveThemeId()).toBe("broadsheet");

    setActiveThemeId("obsidian");
    expect(getActiveThemeId()).toBe("obsidian");
    expect(document.documentElement.dataset.theme).toBe("obsidian");

    applyTheme("minimalist");
    expect(document.documentElement.dataset.theme).toBe("minimalist");
  });
});

describe("Semantic Stage & Slot DOM Contracts", () => {
  it("renders Adventure Sheet spread with HP trail, Load (kg), attacks, and skills", () => {
    const bundle = createCampaignBundle({ heroKey: "fighter" });
    bundle.campaign.char.hpTrail = [12, 7];
    bundle.campaign.char.hp = 7;

    const host = document.createElement("div");
    renderSheetView(host, {
      bundle,
      portraitUrl: null,
      onBack: vi.fn(),
      onNav: vi.fn(),
      onPaintPortrait: vi.fn(),
      onUploadPortrait: vi.fn()
    });

    expect(host.querySelector('[data-stage="sheet"]')).not.toBeNull();
    expect(host.querySelector('[data-slot="sheet-left"]')).not.toBeNull();
    expect(host.querySelector('[data-slot="sheet-right"]')).not.toBeNull();
    expect(host.querySelector('[data-slot="sheet-hp"]')?.textContent).toContain("12");
    expect(host.querySelector('[data-slot="sheet-load"]')?.textContent).toContain("kg");
    expect(host.querySelector('[data-slot="sheet-attacks"]')?.textContent).toContain("Longsword");
    expect(host.querySelector('[data-slot="sheet-skills"]')?.textContent).toContain("Athletics");
  });

  it("renders Journal & Bag spread with People dossier, Errands & Known Threats clocks, and Bag weights", () => {
    const bundle = createCampaignBundle({ heroKey: "fighter" });
    bundle.entities.npc_bram = cleanEntity({
      id: "npc_bram",
      kind: "npc",
      name: "Bramwell",
      role: "Gate Warden",
      att: 0,
      loc: null,
      desc: "Keeps the iron key",
      playerNote: "Check his ledger",
      seenTurn: 1
    })!;
    bundle.clocks.clock_ash = {
      id: "clock_ash",
      name: "Ashgate Fires",
      secretSummary: "Arson spreads",
      segments: 4,
      filled: 2,
      advanceEveryMinutes: 180,
      accumulatedMinutes: 0,
      knownToPlayer: true,
      consequence: "The mill burns down.",
      status: "active"
    };

    const store = new MemoryGameStore();
    const router = new ModelRouter({ connections: [], resolveApiKey: () => "" });
    const imageRouter = new ImageRouter({ getConnections: () => [], resolveApiKey: () => "" });
    const portraits = new PortraitUrlCache();

    let tab: "people" | "places" | "errands" | "facts" | "bag" = "people";
    let selectedNpc: string | null = "npc_bram";
    const host = document.createElement("div");

    const render = () =>
      renderJournalSpread(host, {
        getBundle: () => bundle,
        getTab: () => tab,
        setTab: t => {
          tab = t;
        },
        getSelectedNpcId: () => selectedNpc,
        setSelectedNpcId: id => {
          selectedNpc = id;
        },
        getSelectedPlaceId: () => null,
        setSelectedPlaceId: vi.fn(),
        ask: createAskState(),
        router,
        imageRouter,
        store,
        portraits,
        canAct: () => true,
        isConflicted: () => false,
        onSave: async () => {},
        onBack: vi.fn(),
        onNav: vi.fn(),
        onRenderAll: vi.fn(),
        onRenderSpreadOnly: render,
        onSendAction: vi.fn()
      });

    render();
    expect(host.querySelector('[data-stage="journal"]')).not.toBeNull();
    expect(host.querySelector('[data-slot="journal-dossier"]')?.textContent).toContain("Bramwell");
    const noteInput = host.querySelector<HTMLInputElement>('[data-slot="npc-player-note"] input');
    expect(noteInput?.value).toBe("Check his ledger");

    tab = "errands";
    render();
    expect(host.querySelector('[data-slot="journal-threats"]')?.textContent).toContain("Ashgate Fires");

    tab = "bag";
    render();
    expect(host.querySelector('[data-slot="bag-equipped"]')?.textContent).toContain("Longsword");
    expect(host.querySelector('[data-slot="bag-equipped"]')?.textContent).toContain("kg");
  });
});
