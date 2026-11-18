import { describe, expect, it } from "vitest";
import { ImageRouter } from "../src/adapters/image/image-router";
import { CONNECTION_PRESETS, type ModelConnection } from "../src/adapters/llm";
import {
  KeyringManager,
  MemoryGameStore,
  PORTABLE_FORMAT_MAGIC,
  exportCampaignArchive,
  importCampaignArchive
} from "../src/adapters/storage";
import { cleanArtBrief } from "../src/engine";
import {
  DEFAULT_THEME_ART_PROFILE,
  blobToBase64DataUrl,
  composePortraitPrompt,
  createQuickStartSeed,
  generateHeraldicSvg,
  svgToBlob,
  type ThemeArtProfile
} from "../src/narrator";

describe("Campaign-Flavour Portraits, Encrypted Keyring & Portable .solotales.json Archives", () => {
  it("composes 3-layer portrait prompts and allows swapping ThemeArtProfile without touching campaign state", () => {
    const brief = cleanArtBrief({
      stylePreset: "dark_woodcut",
      medium: "chiaroscuro woodcut engraving",
      palette: "bone white, soot black, tarnished silver",
      lighting: "harsh tallow candlelight",
      attireStyle: "high-collared heavy wool",
      moodKeywords: "gothic dread, solemn"
    })!;
    const snapshotBefore = JSON.stringify(brief);

    const subject = {
      kind: "hero" as const,
      name: "Vespera",
      species: "Elf",
      cls: "Rogue",
      role: "Grave-watcher",
      appearance: "Silver-streaked braid, hooked lantern",
      attitude: "neutral" as const
    };

    const defaultPrompt = composePortraitPrompt(DEFAULT_THEME_ART_PROFILE, brief, subject);
    expect(defaultPrompt.prompt).toContain("Vespera");
    expect(defaultPrompt.prompt).toContain("chiaroscuro woodcut");
    expect(defaultPrompt.prompt).toContain(DEFAULT_THEME_ART_PROFILE.lightingBias);

    // Swap UI ThemeArtProfile (simulating a future UI redesign)
    const stainedGlassTheme: ThemeArtProfile = {
      id: "cathedral_glass_v2",
      label: "Stained Glass Reliquary",
      frameTone: "leaded arch medallion backdrop",
      compositionRule: "iconic profile bust inside an illuminated manuscript border",
      lightingBias: "luminous jewel-toned backlight",
      negativePrompt: "3d render, photograph"
    };

    const restyledPrompt = composePortraitPrompt(stainedGlassTheme, brief, subject);
    expect(restyledPrompt.prompt).toContain("luminous jewel-toned backlight");
    expect(restyledPrompt.prompt).toContain("leaded arch medallion backdrop");
    expect(restyledPrompt.negativePrompt).toBe("3d render, photograph");
    // Campaign state artBrief was NOT mutated
    expect(JSON.stringify(brief)).toBe(snapshotBefore);
  });

  it("generates zero-API Heraldic SVG crests and routes AI portrait generation via ImageRouter", async () => {
    const svg = generateHeraldicSvg(
      { kind: "npc", name: "Captain Vane", role: "Harbourmaster", attitude: "hostile" },
      cleanArtBrief({ stylePreset: "ink_parchment" })
    );
    expect(svg).toContain("<svg");
    expect(svg).toContain("CV");

    // Mock OpenAI /v1/images/generations response (1x1 transparent PNG base64)
    const tinyPngB64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    let capturedUrl = "";
    let capturedAuth = "";

    const mockFetch: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      const hdrs = (init?.headers || {}) as Record<string, string>;
      capturedAuth = hdrs.Authorization || "";
      return new Response(JSON.stringify({ data: [{ b64_json: tinyPngB64 }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    const openAiImgConn: ModelConnection = {
      id: "oai_img",
      label: "OpenAI Image Key",
      provider: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      apiKeyRef: "ref_oai",
      enabled: true,
      capabilities: {
        streaming: true,
        jsonMode: true,
        imageGen: true,
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        reasoningTier: 2
      },
      limits: { rpm: 60, tpm: 100_000, rpd: null, isFreeTier: false }
    };

    const imgRouter = new ImageRouter({
      getConnections: () => [openAiImgConn],
      resolveApiKey: ref => (ref === "ref_oai" ? "sk-img-test-token" : ""),
      fetchFn: mockFetch
    });

    const generated = await imgRouter.generatePortrait(
      { kind: "hero", name: "Rowan", species: "Human", cls: "Fighter" },
      cleanArtBrief({ stylePreset: "painterly" })
    );

    expect(capturedUrl).toContain("/images/generations");
    expect(capturedAuth).toBe("Bearer sk-img-test-token");
    expect(generated.source).toBe("api");
    expect(generated.blob.size).toBeGreaterThan(0);
  });

  it("isolates API keys in KeyringManager with WebCrypto AES-GCM passphrase encryption and exports key-free .solotales.json archives", async () => {
    const storeA = new MemoryGameStore();
    await storeA.init();

    const secretApiKey = "sk-SUPER-SECRET-NEVER-EXPORT-998877";
    const keyring = new KeyringManager(storeA);
    await keyring.load();
    const added = await keyring.addFromPreset(CONNECTION_PRESETS[0], secretApiKey);
    expect(keyring.resolveApiKey(added.apiKeyRef)).toBe(secretApiKey);

    // Enable WebCrypto PBKDF2 + AES-GCM encryption with a passphrase
    await keyring.setEncryptionPassphrase("correct-horse-battery");

    // Simulate app restart with a fresh KeyringManager reading the same store
    const reloadedKeyring = new KeyringManager(storeA);
    await reloadedKeyring.load();
    expect(reloadedKeyring.isLocked()).toBe(true);
    expect(reloadedKeyring.resolveApiKey(added.apiKeyRef)).toBe("");

    // Wrong passphrase fails
    expect(await reloadedKeyring.unlockWithPassphrase("wrong-passphrase")).toBe(false);
    expect(reloadedKeyring.isLocked()).toBe(true);

    // Correct passphrase unlocks the secret
    expect(await reloadedKeyring.unlockWithPassphrase("correct-horse-battery")).toBe(true);
    expect(reloadedKeyring.isLocked()).toBe(false);
    expect(reloadedKeyring.resolveApiKey(added.apiKeyRef)).toBe(secretApiKey);

    // Build a campaign with both hero & NPC portrait blobs stored in storeA
    const { bundle } = createQuickStartSeed({
      campaignName: "Brookhollow Portable",
      heroKey: "fighter",
      flavour: {
        archetype: "frontier_mystery",
        tone: "Grounded & atmospheric",
        magicLevel: "rare",
        pillars: { combat: 2, mystery: 3, social: 2 }
      }
    });

    const heroSvgBlob = svgToBlob(generateHeraldicSvg({ kind: "hero", name: bundle.campaign.char.name }));
    bundle.campaign.char.portraitId = "blob_hero_1";
    await storeA.putBlob("blob_hero_1", heroSvgBlob);

    const firstNpc = Object.values(bundle.entities).find(e => e.kind === "npc")!;
    const npcSvgBlob = svgToBlob(generateHeraldicSvg({ kind: "npc", name: firstNpc.name }));
    firstNpc.portraitId = "blob_npc_1";
    await storeA.putBlob("blob_npc_1", npcSvgBlob);

    await storeA.saveBundle(bundle, "session_1", 0);

    // Export portable .solotales.json archive
    const exported = await exportCampaignArchive(bundle, id => storeA.getBlob(id));
    expect(exported.archive.format).toBe(PORTABLE_FORMAT_MAGIC);
    expect(exported.filename).toBe("brookhollow-portable.solotales.json");

    // CRITICAL SECURITY ASSERTION: Zero API keys or keyring references anywhere in exported file!
    expect(exported.json).not.toContain(secretApiKey);
    expect(exported.json).not.toContain(added.apiKeyRef);

    // Import into a brand-new isolated store (e.g. moving from Browser to PC Desktop)
    const storeB = new MemoryGameStore();
    await storeB.init();

    const imported = await importCampaignArchive(exported.json, storeB, "session_pc");
    expect(imported.campaign.name).toBe("Brookhollow Portable");
    expect(imported.campaign.char.portraitId).toBe("blob_hero_1");
    expect(Object.keys(imported.clocks).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(imported.foeRoster).length).toBeGreaterThanOrEqual(3);

    const restoredHeroBlob = await storeB.getBlob("blob_hero_1");
    const restoredNpcBlob = await storeB.getBlob("blob_npc_1");
    expect(restoredHeroBlob).not.toBeNull();
    expect(restoredNpcBlob).not.toBeNull();
    expect(await blobToBase64DataUrl(restoredHeroBlob!)).toBe(await blobToBase64DataUrl(heroSvgBlob));
    expect(await blobToBase64DataUrl(restoredNpcBlob!)).toBe(await blobToBase64DataUrl(npcSvgBlob));
  });
});
