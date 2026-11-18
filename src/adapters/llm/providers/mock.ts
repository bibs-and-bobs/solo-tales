/* Deterministic programmable Mock LLM provider for tests, benchmarks, and offline sandboxes. */

import { extractAndRepairJson } from "../json-repair";
import { estimateTokens } from "../rate-limiter";
import type { LLMRequest, LLMResponse, ModelConnection, ProviderDriver } from "../types";

export interface RecordedLLMCall {
  req: LLMRequest;
  conn: ModelConnection;
  apiKey: string;
  at: number;
}

export type MockHandler = (
  req: LLMRequest,
  conn: ModelConnection,
  callIndex: number
) => Promise<string | Record<string, any>> | string | Record<string, any>;

export class MockProviderDriver implements ProviderDriver {
  readonly kind = "mock" as const;
  readonly calls: RecordedLLMCall[] = [];
  private handlers: MockHandler[] = [];
  private fallbackHandler: MockHandler;

  constructor(fallback?: MockHandler) {
    this.fallbackHandler =
      fallback ??
      (req => {
        if (req.task === "ask_world") return "You recall only what the road has shown you so far.";
        if (req.task === "epitaph") return "Here ended a bold road before its song was finished.";
        if (req.task === "memory_fold") return JSON.stringify({ summary: "The road pressed onward." });
        if (req.task === "combat_round") return JSON.stringify({ prose: "Steel rings across the stones." });
        return JSON.stringify({
          prose: "Lanternlight catches the rain on the cobbles as you take stock of the crossroads. What do you do next?",
          events: [],
          roll: null
        });
      });
  }

  enqueue(handler: MockHandler): void {
    this.handlers.push(handler);
  }

  setFallback(handler: MockHandler): void {
    this.fallbackHandler = handler;
  }

  clear(): void {
    this.calls.length = 0;
    this.handlers.length = 0;
  }

  async send(req: LLMRequest, conn: ModelConnection, apiKey: string): Promise<LLMResponse> {
    const idx = this.calls.length;
    this.calls.push({ req, conn, apiKey, at: Date.now() });
    const handler = this.handlers.shift() ?? this.fallbackHandler;
    const result = await handler(req, conn, idx);
    const text = typeof result === "string" ? result : JSON.stringify(result);

    if (req.onStreamChunk && text && !req.jsonMode) {
      req.onStreamChunk(text);
    }

    return {
      text,
      json: req.jsonMode ? extractAndRepairJson(text) : undefined,
      connectionId: conn.id,
      model: conn.model,
      provider: "mock",
      inputTokensEst: estimateTokens(req.system) + estimateTokens(req.user),
      outputTokensEst: estimateTokens(text)
    };
  }
}
