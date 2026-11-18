/* Multi-Key / Multi-Model Router with Task Scoring, Live 429 Failover, and Economy Mode. */

import { extractAndRepairJson } from "./json-repair";
import { AnthropicDriver } from "./providers/anthropic";
import { ClaudeArtifactDriver, hasClaudeArtifactBridge } from "./providers/claude-artifact";
import { GeminiDriver } from "./providers/gemini";
import { MockProviderDriver } from "./providers/mock";
import { OpenAICompatibleDriver } from "./providers/openai-compatible";
import { estimateTokens, RateLimiter } from "./rate-limiter";
import {
  DEFAULT_ROUTING_CONFIG,
  LLMError,
  TASK_DEFAULT_PRIORITY,
  TASK_PREFERRED_TIER,
  type LLMRequest,
  type LLMResponse,
  type ModelConnection,
  type ProviderDriver,
  type ProviderKind,
  type RoutingConfig,
  type TaskKind,
  type WaitTickListener
} from "./types";

export interface ModelRouterOptions {
  connections?: ModelConnection[];
  config?: Partial<RoutingConfig>;
  resolveApiKey?: (apiKeyRef: string) => Promise<string> | string;
  rateLimiter?: RateLimiter;
  drivers?: ProviderDriver[];
}

export class ModelRouter {
  private connections: ModelConnection[];
  private config: RoutingConfig;
  private resolveApiKeyFn: (apiKeyRef: string) => Promise<string> | string;
  readonly rateLimiter: RateLimiter;
  private drivers = new Map<ProviderKind, ProviderDriver>();

  constructor(opts: ModelRouterOptions = {}) {
    this.connections = opts.connections ? [...opts.connections] : [];
    this.config = { ...DEFAULT_ROUTING_CONFIG, ...(opts.config || {}) };
    this.resolveApiKeyFn = opts.resolveApiKey ?? (ref => ref);
    this.rateLimiter = opts.rateLimiter ?? new RateLimiter();

    const defaultDrivers: ProviderDriver[] = [
      new OpenAICompatibleDriver(),
      new AnthropicDriver(),
      new GeminiDriver(),
      new ClaudeArtifactDriver(),
      new MockProviderDriver()
    ];
    for (const d of defaultDrivers) this.drivers.set(d.kind, d);
    if (opts.drivers) {
      for (const d of opts.drivers) this.drivers.set(d.kind, d);
    }
  }

  registerDriver(driver: ProviderDriver): void {
    this.drivers.set(driver.kind, driver);
  }

  getDriver(kind: ProviderKind): ProviderDriver | undefined {
    return this.drivers.get(kind);
  }

  setConnections(connections: ModelConnection[]): void {
    this.connections = [...connections];
  }

  getConnections(): readonly ModelConnection[] {
    return this.connections;
  }

  getEnabledConnections(): ModelConnection[] {
    const active = this.connections.filter(c => c.enabled);
    if (active.length > 0) return active;

    // Automatic zero-config bridge if running inside claude.ai with no keys configured
    if (hasClaudeArtifactBridge()) {
      return [
        {
          id: "claude-artifact-auto",
          label: "Claude Artifact Host",
          provider: "claude-artifact",
          model: "claude-artifact",
          apiKeyRef: "",
          enabled: true,
          capabilities: {
            jsonMode: true,
            streaming: false,
            contextWindow: 100000,
            maxOutputTokens: 4096,
            reasoningTier: 3,
            imageGen: false
          },
          limits: { rpm: 20, tpm: null, rpd: null, isFreeTier: false }
        }
      ];
    }
    return [];
  }

  setConfig(config: Partial<RoutingConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      pins: config.pins ? { ...config.pins } : this.config.pins
    };
  }

  getConfig(): Readonly<RoutingConfig> {
    return this.config;
  }

  onWaitTick(listener: WaitTickListener): () => void {
    return this.rateLimiter.onWaitTick(listener);
  }

  /** True when Economy / Free-Tier conservation rules are active */
  isEconomyActive(): boolean {
    if (this.config.economyMode === "on") return true;
    if (this.config.economyMode === "off") return false;
    const enabled = this.getEnabledConnections();
    if (enabled.length === 0) return true;
    return enabled.every(
      c => c.limits.isFreeTier || (c.limits.rpm != null && c.limits.rpm > 0 && c.limits.rpm <= 15)
    );
  }

  /** Recommended beat threshold before folding memory (16 in Economy Mode vs 10 standard) */
  getMemoryFoldThreshold(): number {
    return this.isEconomyActive() ? 16 : 10;
  }

  private scoreConnection(conn: ModelConnection, task: TaskKind, estTokens: number): number {
    const waitStatus = this.rateLimiter.getWaitStatus(conn, estTokens);
    if (waitStatus.dailyExhausted) return -10_000;

    let score = 0;

    // Strong preference for immediately ready keys (enables seamless multi-key rotation)
    if (waitStatus.waitMs === 0) {
      score += 120;
    } else {
      score -= Math.min(90, Math.ceil(waitStatus.waitMs / 1000));
    }

    // Headroom bonus [0..25]
    score += this.rateLimiter.getHeadroomRatio(conn) * 25;

    // Tier matching: preserve strong models for world_prep / story_strong / ruling,
    // and route background tasks (memory_fold, combat_round, portrait_prompt) to lighter/faster keys
    const targetTier = TASK_PREFERRED_TIER[task];
    const tierDiff = Math.abs(conn.capabilities.reasoningTier - targetTier);
    score += (3 - tierDiff) * 18;
    if (targetTier === 3 && conn.capabilities.reasoningTier === 3) score += 15;
    if (targetTier === 1 && conn.capabilities.reasoningTier === 1) score += 12;

    // Context window fit
    if (conn.capabilities.contextWindow >= estTokens * 2) {
      score += 10;
    } else if (conn.capabilities.contextWindow < estTokens) {
      score -= 80;
    }

    // TPM fit
    if (conn.limits.tpm != null && conn.limits.tpm > 0 && estTokens > conn.limits.tpm * 0.75) {
      score -= 35;
    }

    return score;
  }

  /** Returns enabled connections ordered from best fit to fallback for a given task. */
  rankConnections(task: TaskKind, estTokens = 1200): ModelConnection[] {
    const enabled = this.getEnabledConnections();
    if (enabled.length <= 1) return enabled;

    const pinnedId = this.config.pins?.[task];
    const scored = enabled
      .map(conn => ({
        conn,
        isPinned: pinnedId === conn.id,
        score: this.scoreConnection(conn, task, estTokens)
      }))
      .sort((a, b) => {
        // Pinned connection goes first unless it is currently cooling down while another key is immediately ready
        if (a.isPinned !== b.isPinned) {
          const pinned = a.isPinned ? a : b;
          const other = a.isPinned ? b : a;
          const pinnedWait = this.rateLimiter.getWaitStatus(pinned.conn, estTokens).waitMs;
          const otherWait = this.rateLimiter.getWaitStatus(other.conn, estTokens).waitMs;
          if (pinnedWait === 0 || otherWait > 0) {
            return a.isPinned ? -1 : 1;
          }
        }
        return b.score - a.score;
      });

    return scored.map(s => s.conn);
  }

  /** Inspects which connection will be used next so packet builders can size context budgets accurately. */
  peekBestConnection(task: TaskKind): ModelConnection | null {
    const ranked = this.rankConnections(task, 1200);
    return ranked[0] ?? null;
  }

  async complete(req: LLMRequest): Promise<LLMResponse> {
    // Economy Mode conservation: combat already renders crisp deterministic roll logs,
    // so skip optional per-round LLM embellishment calls when conserving free-tier quota.
    if (req.task === "combat_round" && this.isEconomyActive()) {
      return {
        text: "",
        json: req.jsonMode ? { prose: "" } : undefined,
        connectionId: "economy-skip",
        model: "economy-skip",
        provider: "mock",
        inputTokensEst: 0,
        outputTokensEst: 0,
        skippedByEconomy: true
      };
    }

    const estInputTokens = estimateTokens(req.system) + estimateTokens(req.user);
    const priority = req.priority ?? TASK_DEFAULT_PRIORITY[req.task] ?? 2;
    const candidates = this.rankConnections(req.task, estInputTokens);

    if (candidates.length === 0) {
      throw new LLMError(
        "No AI model connection is enabled. Open API & Model Settings to connect a provider (e.g., Gemini Free Tier, Groq, OpenRouter, OpenAI, Anthropic, or Local Ollama)."
      );
    }

    const errors: Error[] = [];

    // Pass 1: Try any candidate that has 0 wait time right now; failover immediately on 429 or transient error
    const readyCandidates = candidates.filter(
      c => this.rateLimiter.getWaitStatus(c, estInputTokens).waitMs === 0
    );

    for (const conn of readyCandidates) {
      try {
        return await this.executeOnConnection(req, conn, estInputTokens);
      } catch (err: any) {
        if (req.signal?.aborted || err?.name === "AbortError") throw err;
        errors.push(err instanceof Error ? err : new Error(String(err)));
        if (err instanceof LLMError && err.isRateLimit) {
          this.rateLimiter.markCooldown(
            conn.id,
            err.retryAfterMs ?? 15_000,
            `${conn.label} returned 429 Too Many Requests`
          );
          continue; // Failover to next connection in pool!
        }
        // If another backup connection exists, try failing over
        if (readyCandidates.length > 1 || candidates.length > 1) {
          continue;
        }
        // Single-connection transient malformed/empty JSON retry
        if (
          req.jsonMode &&
          !(err instanceof LLMError) &&
          /json|empty response/i.test(String(err?.message || ""))
        ) {
          await this.rateLimiter.waitForSlot(conn, estInputTokens, priority, req.task, req.signal);
          return await this.executeOnConnection(req, conn, estInputTokens);
        }
        throw err;
      }
    }

    // Pass 2: All healthy keys were either busy/cooling down or hit 429 just now.
    // Pick the non-daily-exhausted candidate with the shortest wait window, wait cleanly with UI countdown, and execute.
    const viableWaiters = candidates
      .map(c => ({ conn: c, status: this.rateLimiter.getWaitStatus(c, estInputTokens) }))
      .filter(x => !x.status.dailyExhausted)
      .sort((a, b) => a.status.waitMs - b.status.waitMs);

    if (viableWaiters.length === 0) {
      throw (
        errors[errors.length - 1] ??
        new LLMError("All enabled API connections have exhausted their daily quota.")
      );
    }

    const chosen = viableWaiters[0].conn;
    await this.rateLimiter.waitForSlot(chosen, estInputTokens, priority, req.task, req.signal);

    try {
      return await this.executeOnConnection(req, chosen, estInputTokens);
    } catch (err: any) {
      if (err instanceof LLMError && err.isRateLimit) {
        // Single extra retry after honoring provider's Retry-After if single-key hit an unexpected server-side 429
        const retryWait = err.retryAfterMs ?? 10_000;
        this.rateLimiter.markCooldown(chosen.id, retryWait, `${chosen.label} rate limit retry`);
        await this.rateLimiter.waitForSlot(chosen, estInputTokens, priority, req.task, req.signal);
        return await this.executeOnConnection(req, chosen, estInputTokens);
      }
      throw err;
    }
  }

  private async executeOnConnection(
    req: LLMRequest,
    conn: ModelConnection,
    estInputTokens: number
  ): Promise<LLMResponse> {
    const driver = this.drivers.get(conn.provider);
    if (!driver) {
      throw new LLMError(`Unsupported provider driver: ${conn.provider}`);
    }
    const apiKey = String((await this.resolveApiKeyFn(conn.apiKeyRef)) ?? "");
    this.rateLimiter.recordStart(conn.id, estInputTokens);
    try {
      const resp = await driver.send(req, conn, apiKey);
      if (req.jsonMode && resp.json === undefined) {
        resp.json = extractAndRepairJson(resp.text);
      }
      this.rateLimiter.recordFinish(conn.id, resp.outputTokensEst, resp.rateLimitHeaders);
      return resp;
    } catch (err) {
      this.rateLimiter.recordFailure(conn.id);
      throw err;
    }
  }
}
