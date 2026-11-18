import { describe, expect, it } from "vitest";
import {
  LLMError,
  MockProviderDriver,
  ModelRouter,
  RateLimiter,
  estimateTokens,
  extractAndRepairJson,
  parseRateLimitHeaders,
  type ModelConnection,
  type WaitNotice
} from "../src/adapters/llm";
import { BUDGET_PROFILES, buildStoryPacket, createQuickStartSeed, selectBudgetProfile } from "../src/narrator";

function makeConn(overrides: Partial<ModelConnection> & { id: string; label: string }): ModelConnection {
  return {
    id: overrides.id,
    label: overrides.label,
    provider: overrides.provider ?? "mock",
    baseUrl: overrides.baseUrl ?? "mock://local",
    model: overrides.model ?? overrides.id,
    apiKeyRef: overrides.apiKeyRef ?? `key_${overrides.id}`,
    enabled: overrides.enabled ?? true,
    capabilities: {
      streaming: true,
      jsonMode: true,
      imageGen: false,
      contextWindow: 32_000,
      maxOutputTokens: 2048,
      reasoningTier: 2,
      ...(overrides.capabilities || {})
    },
    limits: {
      rpm: 60,
      tpm: 100_000,
      rpd: null,
      isFreeTier: false,
      ...(overrides.limits || {})
    }
  };
}

describe("Multi-Key ModelRouter, Rate Limiter, Economy Mode & JSON Repair", () => {
  it("routes heavy tasks (world_prep, story_strong) to Tier 3 and utility tasks (memory_fold) to Tier 1", async () => {
    const mock = new MockProviderDriver();
    const fastTier1 = makeConn({
      id: "fast_1",
      label: "Fast Tier 1",
      capabilities: {
        streaming: true,
        jsonMode: true,
        imageGen: false,
        contextWindow: 16_000,
        maxOutputTokens: 2048,
        reasoningTier: 1
      }
    });
    const deepTier3 = makeConn({
      id: "deep_3",
      label: "Deep Tier 3",
      capabilities: {
        streaming: true,
        jsonMode: true,
        imageGen: false,
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        reasoningTier: 3
      }
    });

    const router = new ModelRouter({
      connections: [fastTier1, deepTier3],
      drivers: [mock]
    });

    const prepResp = await router.complete({
      task: "world_prep",
      priority: 1,
      system: "Build world.",
      user: "Go.",
      jsonMode: true
    });
    expect(prepResp.connectionId).toBe("deep_3");

    const foldResp = await router.complete({
      task: "memory_fold",
      priority: 3,
      system: "Fold beats.",
      user: "Beats.",
      jsonMode: true
    });
    expect(foldResp.connectionId).toBe("fast_1");
  });

  it("fails over seamlessly to a backup connection on HTTP 429 and marks primary on cooldown", async () => {
    const mock = new MockProviderDriver((_req, conn) => {
      if (conn.id === "key_a") {
        throw new LLMError("Rate limit exceeded", {
          status: 429,
          isRateLimit: true,
          retryAfterMs: 15_000
        });
      }
      return { story: [{ n: "Backup model answered cleanly." }], events: [] };
    });

    const connA = makeConn({
      id: "key_a",
      label: "Primary Key A",
      capabilities: { streaming: true, jsonMode: true, imageGen: false, contextWindow: 64_000, maxOutputTokens: 2048, reasoningTier: 3 }
    });
    const connB = makeConn({
      id: "key_b",
      label: "Backup Key B",
      capabilities: { streaming: true, jsonMode: true, imageGen: false, contextWindow: 64_000, maxOutputTokens: 2048, reasoningTier: 2 }
    });

    const router = new ModelRouter({
      connections: [connA, connB],
      drivers: [mock]
    });

    const resp = await router.complete({
      task: "story_turn",
      priority: 1,
      system: "Sys",
      user: "Act",
      jsonMode: true
    });

    expect(resp.connectionId).toBe("key_b");
    expect(resp.json.story[0].n).toContain("Backup model");
    // Subsequent call immediately picks key_b while key_a is cooling down
    expect(router.peekBestConnection("story_turn")?.id).toBe("key_b");
  });

  it("queues single-key RPM bursts, emits live WaitNotice countdowns, and parses Retry-After headers", async () => {
    const headers = parseRateLimitHeaders({
      "retry-after": "1.5",
      "x-ratelimit-remaining-requests": "0",
      "x-ratelimit-remaining-tokens": "4200"
    });
    expect(headers.retryAfterMs).toBe(1500);
    expect(headers.remainingRequests).toBe(0);
    expect(headers.remainingTokens).toBe(4200);

    const goHeaders = parseRateLimitHeaders({ "x-ratelimit-reset-requests": "1m2.5s" });
    expect(goHeaders.resetRequestsMs).toBe(62_500);

    // Simulate single free-tier key with a brief 250ms cooldown and verify WaitNotice emission
    const limiter = new RateLimiter();
    const notices: Array<WaitNotice | null> = [];
    limiter.onWaitTick(n => notices.push(n));

    const singleFree = makeConn({
      id: "free_single",
      label: "Gemini Flash Free",
      limits: { rpm: 5, tpm: 32_000, rpd: null, isFreeTier: true }
    });
    limiter.markCooldown(singleFree.id, 520, "HTTP 429 cooldown");

    const mock = new MockProviderDriver(() => ({ ok: true }));
    const router = new ModelRouter({
      connections: [singleFree],
      rateLimiter: limiter,
      drivers: [mock]
    });

    const out = await router.complete({
      task: "story_turn",
      priority: 1,
      system: "Sys",
      user: "Hello",
      jsonMode: true
    });

    expect(out.json).toEqual({ ok: true });
    expect(notices.some(n => n !== null && n.connectionId === "free_single")).toBe(true);
    expect(notices.at(-1)).toBeNull(); // Cleared once acquired
  });

  it("activates Economy Mode automatically on free-tier keys, skips combat_round prose, and compacts context budgets", async () => {
    const freeConn = makeConn({
      id: "groq_free",
      label: "Groq 8B Free",
      capabilities: {
        streaming: true,
        jsonMode: true,
        imageGen: false,
        contextWindow: 8_000,
        maxOutputTokens: 1024,
        reasoningTier: 1
      },
      limits: { rpm: 10, tpm: 6_000, rpd: null, isFreeTier: true }
    });

    const mock = new MockProviderDriver();
    const router = new ModelRouter({
      connections: [freeConn],
      config: { economyMode: "auto", pins: {}, prepStepSpacingMs: 0 },
      drivers: [mock]
    });

    expect(router.isEconomyActive()).toBe(true);
    expect(router.getMemoryFoldThreshold()).toBe(16);

    const skippedRound = await router.complete({
      task: "combat_round",
      priority: 3,
      system: "Round",
      user: "Lines",
      jsonMode: true
    });
    expect(skippedRound.skippedByEconomy).toBe(true);
    expect(mock.calls.length).toBe(0);

    // Verify compact budget keeps populated campaign story packet <= 1,000 estimated user+world tokens
    const budget = selectBudgetProfile(freeConn, router.isEconomyActive());
    expect(budget.name).toBe(BUDGET_PROFILES.compact.name);

    const { bundle } = createQuickStartSeed({
      campaignName: "Brookhollow",
      heroKey: "fighter",
      flavour: {
        archetype: "frontier_mystery",
        tone: "Grounded & atmospheric",
        magicLevel: "rare",
        pillars: { combat: 2, mystery: 3, social: 2 }
      }
    });
    for (let i = 0; i < 12; i++) {
      bundle.campaign.beats.push(`Beat ${i}: explored the muddy riverbank near the old timber mill.`);
    }
    const pkt = buildStoryPacket(bundle, "Ask Mara about the missing apprentice", { budget });
    expect(estimateTokens(pkt.user)).toBeLessThanOrEqual(1000);
  });

  it("repairs malformed LLM JSON (markdown fences, comments, trailing commas, unescaped newlines)", () => {
    const messy = [
      "Here is the JSON response:",
      "```json",
      "{",
      '  // Narrator scene output',
      '  "story": [',
      '    { "n": "Rain drums on the slate roof',
      'above the hearth." },',
      '  ],',
      '  "options": ["Inspect the latch", "Call out",],',
      "}",
      "```"
    ].join("\n");

    const parsed = extractAndRepairJson(messy);
    expect(parsed).not.toBeNull();
    expect(parsed.story[0].n).toContain("Rain drums on the slate roof");
    expect(parsed.options).toEqual(["Inspect the latch", "Call out"]);
  });

  it("strips <think> reasoning blocks before extracting JSON", () => {
    const withThink = `<think>Let me check {"not": "this"} first.</think>\n{"ok": true, "beat": "gate"}`;
    expect(extractAndRepairJson(withThink)).toEqual({ ok: true, beat: "gate" });
  });

  it("handles reasoning-model token budgets, length retries, and o-series/gpt-5 parameter fallbacks", async () => {
    const { OpenAICompatibleDriver, GeminiDriver } = await import("../src/adapters/llm");
    const bodies: any[] = [];
    let call = 0;

    const oaiDriver = new OpenAICompatibleDriver(async (_url, init) => {
      call++;
      const parsedBody = JSON.parse(String(init?.body || "{}"));
      bodies.push(parsedBody);
      if (call === 1) {
        // Simulate gpt-oss exhausting max_tokens on thinking -> empty content with finish_reason=length
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const gptOssConn = makeConn({
      id: "groq_oss",
      label: "Groq OSS 120B",
      model: "openai/gpt-oss-120b",
      capabilities: {
        streaming: true,
        jsonMode: true,
        imageGen: false,
        contextWindow: 32768,
        maxOutputTokens: 3072,
        reasoningTier: 2
      }
    });

    const oaiResp = await oaiDriver.send(
      { task: "story_turn", system: "Sys", user: "Usr", jsonMode: true, maxOutputTokens: 900 },
      gptOssConn,
      "gsk_test"
    );
    expect(oaiResp.json).toEqual({ ok: true });
    expect(bodies[0].reasoning_effort).toBe("low");
    expect(bodies[0].max_tokens).toBe(2400);
    expect(bodies[1].max_tokens).toBe(3072);

    // Gemini 2.5 Flash should disable thinkingBudget on JSON turns & filter thought parts
    const gemBodies: any[] = [];
    const gemDriver = new GeminiDriver(async (_url, init) => {
      gemBodies.push(JSON.parse(String(init?.body || "{}")));
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: '{"wrong": true}' },
                  { text: '{"right": true}' }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const gemConn = makeConn({
      id: "gem_flash",
      label: "Gemini Flash",
      provider: "gemini",
      model: "gemini-2.5-flash"
    });
    const gemResp = await gemDriver.send(
      { task: "story_turn", system: "Sys", user: "Usr", jsonMode: true, maxOutputTokens: 1200 },
      gemConn,
      "AIza_test"
    );
    expect(gemBodies[0].generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(gemResp.json).toEqual({ right: true });
  });
});
