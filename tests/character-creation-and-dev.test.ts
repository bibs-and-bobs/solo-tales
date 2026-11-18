// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLASSES,
  RACES,
  BACKGROUNDS,
  buildCreatedCharacter,
  createCampaignBundle,
  migrate,
  mod,
  rollBalancedStats
} from "../src/engine";
import { MemoryGameStore } from "../src/adapters/storage";
import { ModelRouter } from "../src/adapters/llm";
import { ImageRouter } from "../src/adapters/image/image-router";
import { PortraitUrlCache } from "../src/ui/dom";
import { renderCharacterCreator } from "../src/ui/character-creator";
import { isDevModeEnabled, openDevModal, setDevModeEnabled } from "../src/ui/dev-modal";

describe("Character Creation Rules & Balanced Stat Rolling", () => {
  it("rollBalancedStats stays within balanced total & modifier guardrails across 100 rolls", () => {
    for (let i = 0; i < 100; i++) {
      const res = rollBalancedStats();
      expect(res.scores).toHaveLength(6);
      expect(res.sum).toBeGreaterThanOrEqual(72);
      expect(res.sum).toBeLessThanOrEqual(78);
      expect(res.modSum).toBeGreaterThanOrEqual(4);
      expect(res.modSum).toBeLessThanOrEqual(8);
      expect(Math.max(...res.scores)).toBeGreaterThanOrEqual(15);
      expect(Math.min(...res.scores)).toBeGreaterThanOrEqual(8);
    }
  });

  it("buildCreatedCharacter applies race, class, perks, background, and survives migrate()", () => {
    const ch = buildCreatedCharacter({
      name: "Sylvaris",
      raceId: "elf",
      racePerkId: "elf_fleet",
      classId: "ranger",
      classPerkId: "ranger_sharp",
      backgroundId: "outlander",
      baseAbil: { str: 12, dex: 15, con: 14, int: 10, wis: 13, cha: 8 },
      chosenSkills: ["perception", "stealth", "nature"],
      backstory: "Born under the canopy of the Silverwood."
    });

    expect(ch.species).toBe("Elf");
    expect(ch.cls).toBe("Ranger");
    expect(ch.bg).toBe("Outlander");
    // Elf (+2 DEX, +1 WIS) + Sharpshooter (+1 DEX) => DEX 18, WIS 14
    expect(ch.abil.dex).toBe(18);
    expect(ch.abil.wis).toBe(14);
    // Fleet of Foot (+1.5 m) => 10.5 m
    expect(ch.speed).toBe(10.5);
    // Ranger d10 + CON mod (+2) => 12 HP
    expect(ch.maxHp).toBe(10 + mod(ch.abil.con));
    expect(ch.perks?.length).toBe(2);
    expect(ch.backstory).toContain("Silverwood");

    const bundle = createCampaignBundle({ customChar: ch });
    const migrated = migrate(bundle.campaign);
    expect(migrated?.char.perks).toEqual(ch.perks);
    expect(migrated?.char.backstory).toBe(ch.backstory);
  });

  it("renders Character Creator UI with live sheet, stat rolling, and AI backstory completion", async () => {
    const host = document.createElement("div");
    const store = new MemoryGameStore();
    const router = new ModelRouter({
      connections: [
        {
          id: "mock-1",
          label: "Mock",
          provider: "mock",
          model: "gpt-test",
          apiKeyRef: "mock",
          enabled: true,
          capabilities: {
            contextWindow: 32000,
            maxOutputTokens: 2048,
            jsonMode: true,
            streaming: false,
            imageGen: false,
            reasoningTier: 2
          },
          limits: {
            rpm: 60,
            tpm: 100000,
            rpd: 1000,
            isFreeTier: true
          }
        }
      ],
      resolveApiKey: () => "sk-test"
    });
    vi.spyOn(router, "complete").mockResolvedValue({
      text: "Expanded AI backstory paragraph.",
      connectionId: "mock-1",
      model: "gpt-test",
      provider: "mock",
      inputTokensEst: 50,
      outputTokensEst: 20
    });

    const imageRouter = new ImageRouter({ getConnections: () => [], resolveApiKey: () => "" });
    const portraits = new PortraitUrlCache();

    renderCharacterCreator(host, {
      router,
      imageRouter,
      store,
      portraits,
      onBack: vi.fn(),
      onOpenSettings: vi.fn(),
      onCreated: vi.fn()
    });

    expect(host.querySelector('[data-stage="create"]')).not.toBeNull();
    expect(host.querySelector('[data-slot="cc-sheet"]')?.textContent).toContain(RACES[0].name);
    expect(host.querySelector('[data-slot="cc-sheet"]')?.textContent).toContain(CLASSES[0].name);

    // Jump to Step 3 (Roll Stats)
    const stepBtns = Array.from(host.querySelectorAll<HTMLButtonElement>(".st-cc-steps button"));
    stepBtns[2].click();
    const rollBtn = host.querySelector<HTMLButtonElement>('[data-action="roll-stats"]');
    expect(rollBtn).not.toBeNull();
    rollBtn!.click();

    // Jump to Step 4 (Backstory)
    const stepBtnsAfter = Array.from(host.querySelectorAll<HTMLButtonElement>(".st-cc-steps button"));
    stepBtnsAfter[3].click();
    const genBtn = host.querySelector<HTMLButtonElement>('[data-action="generate-backstory"]');
    expect(genBtn).not.toBeNull();
    genBtn!.click();

    await vi.waitFor(() => {
      const sheetText = host.querySelector('[data-slot="cc-sheet"]')?.textContent || "";
      expect(sheetText).toContain("Expanded AI backstory paragraph.");
    });
  });
});

describe("Developer Mode Toggle & Console", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("persists dev mode flag and allows live parameter edits & event injection", async () => {
    expect(isDevModeEnabled()).toBe(false);
    setDevModeEnabled(true);
    expect(isDevModeEnabled()).toBe(true);

    const bundle = createCampaignBundle({ heroKey: "fighter" });
    const onSave = vi.fn(async () => {});
    const onRenderAll = vi.fn();

    openDevModal({
      getBundle: () => bundle,
      onSave,
      onRenderAll
    });

    const modal = document.querySelector('[data-stage="dev"]');
    expect(modal).not.toBeNull();

    // Click "+100 Gold" quick action
    const goldBtn = Array.from(modal!.querySelectorAll("button")).find(b => b.textContent === "+100 Gold");
    expect(goldBtn).not.toBeUndefined();
    const beforeGold = bundle.campaign.char.gold;
    goldBtn!.click();

    await vi.waitFor(() => {
      expect(bundle.campaign.char.gold).toBe(beforeGold + 100);
      expect(onSave).toHaveBeenCalled();
      expect(onRenderAll).toHaveBeenCalled();
    });
  });
});
