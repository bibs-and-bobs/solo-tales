/* Anthropic Messages API driver with ephemeral system-prompt caching & browser CORS support. */

import { extractAndRepairJson } from "../json-repair";
import { estimateTokens, parseRateLimitHeaders } from "../rate-limiter";
import { LLMError, type LLMRequest, type LLMResponse, type ModelConnection, type ProviderDriver } from "../types";

export class AnthropicDriver implements ProviderDriver {
  readonly kind = "anthropic" as const;
  private fetchFn: typeof fetch;

  constructor(fetchFn?: typeof fetch) {
    this.fetchFn = fetchFn ?? ((...args) => globalThis.fetch(...args));
  }

  async send(req: LLMRequest, conn: ModelConnection, apiKey: string): Promise<LLMResponse> {
    const base = (conn.baseUrl || "https://api.anthropic.com/v1").replace(/\/+$/, "");
    const url = `${base}/messages`;

    const maxTokens = Math.min(
      req.maxOutputTokens ?? 1400,
      conn.capabilities.maxOutputTokens || 4096
    );
    const wantStream = Boolean(req.onStreamChunk && conn.capabilities.streaming && !req.jsonMode);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": apiKey.trim(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    };

    const body = {
      model: conn.model,
      max_tokens: maxTokens,
      temperature: req.temperature ?? 0.7,
      stream: wantStream,
      system: [
        {
          type: "text",
          text: req.system,
          cache_control: { type: "ephemeral" }
        }
      ],
      messages: [{ role: "user", content: req.user }]
    };

    const res = await this.fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: req.signal
    });

    const rlHeaders = parseRateLimitHeaders(res.headers);

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        msg = errJson?.error?.message || msg;
      } catch {
        // ignore
      }
      throw new LLMError(`${conn.label}: ${msg}`, {
        status: res.status,
        isRateLimit: res.status === 429 || res.status === 529,
        retryAfterMs: rlHeaders.retryAfterMs,
        isAuthError: res.status === 401 || res.status === 403,
        isContextTooLarge: res.status === 413 || /prompt is too long/i.test(msg),
        rateLimitHeaders: rlHeaders
      });
    }

    const inputTokensEst = estimateTokens(req.system) + estimateTokens(req.user);

    if (wantStream && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const ev = JSON.parse(payload);
            if (ev?.type === "content_block_delta" && typeof ev?.delta?.text === "string") {
              fullText += ev.delta.text;
              req.onStreamChunk?.(ev.delta.text);
            }
          } catch {
            // ignore
          }
        }
      }

      return {
        text: fullText,
        connectionId: conn.id,
        model: conn.model,
        provider: conn.provider,
        inputTokensEst,
        outputTokensEst: estimateTokens(fullText),
        rateLimitHeaders: rlHeaders
      };
    }

    const data = await res.json();
    const blocks = Array.isArray(data?.content) ? data.content : [];
    const text = blocks
      .filter((b: any) => b?.type === "text")
      .map((b: any) => b.text)
      .join("");

    const inTokens =
      typeof data?.usage?.input_tokens === "number" ? data.usage.input_tokens : inputTokensEst;
    const outTokens =
      typeof data?.usage?.output_tokens === "number"
        ? data.usage.output_tokens
        : estimateTokens(text);

    return {
      text,
      json: req.jsonMode ? extractAndRepairJson(text) : undefined,
      connectionId: conn.id,
      model: conn.model,
      provider: conn.provider,
      inputTokensEst: inTokens,
      outputTokensEst: outTokens,
      rateLimitHeaders: rlHeaders
    };
  }
}
