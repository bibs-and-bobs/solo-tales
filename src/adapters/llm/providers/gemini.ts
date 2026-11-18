/* Google Gemini REST API driver (supports Free Tier RetryInfo delay parsing & JSON mode). */

import { extractAndRepairJson } from "../json-repair";
import { estimateTokens, parseRateLimitHeaders } from "../rate-limiter";
import { LLMError, type LLMRequest, type LLMResponse, type ModelConnection, type ProviderDriver } from "../types";

function parseGeminiRetryDelayMs(errObj: any): number | undefined {
  const details = errObj?.error?.details;
  if (!Array.isArray(details)) return undefined;
  for (const item of details) {
    if (typeof item?.retryDelay === "string") {
      const m = item.retryDelay.match(/^(\d+(?:\.\d+)?)s$/);
      if (m) return Math.ceil(parseFloat(m[1]) * 1000);
    }
  }
  return undefined;
}

export class GeminiDriver implements ProviderDriver {
  readonly kind = "gemini" as const;
  private fetchFn: typeof fetch;

  constructor(fetchFn?: typeof fetch) {
    this.fetchFn = fetchFn ?? ((...args) => globalThis.fetch(...args));
  }

  async send(req: LLMRequest, conn: ModelConnection, apiKey: string): Promise<LLMResponse> {
    const base = (conn.baseUrl || "https://generativelanguage.googleapis.com/v1beta").replace(
      /\/+$/,
      ""
    );
    const modelPath = conn.model.startsWith("models/") ? conn.model : `models/${conn.model}`;
    const url = `${base}/${modelPath}:generateContent`;

    const isProThinking = /gemini-2\.5-pro|gemini-3/i.test(conn.model);
    const maxTokens = Math.min(
      isProThinking ? Math.max(req.maxOutputTokens ?? 1600, 2400) : (req.maxOutputTokens ?? 1600),
      conn.capabilities.maxOutputTokens || 4096
    );

    const buildBody = (includeJsonMime: boolean) => {
      const generationConfig: Record<string, any> = {
        temperature: req.temperature ?? 0.7,
        maxOutputTokens: maxTokens
      };
      if (includeJsonMime && req.jsonMode && conn.capabilities.jsonMode) {
        generationConfig.responseMimeType = "application/json";
      }
      if (/gemini-2\.5-flash/i.test(conn.model) && req.jsonMode) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      }
      return {
        systemInstruction: {
          parts: [{ text: req.system }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: req.user }]
          }
        ],
        generationConfig
      };
    };

    let res = await this.fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey.trim()
      },
      body: JSON.stringify(buildBody(true)),
      signal: req.signal
    });

    if (res.status === 400 && req.jsonMode && conn.capabilities.jsonMode) {
      const errPreview = await res.clone().text().catch(() => "");
      if (/responseMimeType|json/i.test(errPreview)) {
        res = await this.fetchFn(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey.trim()
          },
          body: JSON.stringify(buildBody(false)),
          signal: req.signal
        });
      }
    }

    const rlHeaders = parseRateLimitHeaders(res.headers);

    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      let geminiRetryMs: number | undefined;
      try {
        const errJson = await res.json();
        msg = errJson?.error?.message || msg;
        geminiRetryMs = parseGeminiRetryDelayMs(errJson);
      } catch {
        // ignore
      }
      const retryAfterMs = rlHeaders.retryAfterMs ?? geminiRetryMs;
      throw new LLMError(`${conn.label}: ${msg}`, {
        status: res.status,
        isRateLimit: res.status === 429,
        retryAfterMs,
        isAuthError: res.status === 400 && /API key not valid/i.test(msg) ? true : res.status === 401 || res.status === 403,
        isContextTooLarge: /token count exceeds/i.test(msg),
        rateLimitHeaders: retryAfterMs ? { ...rlHeaders, retryAfterMs } : rlHeaders
      });
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts
          .filter((p: any) => !p?.thought)
          .map((p: any) => p?.text ?? "")
          .join("")
      : "";

    if (req.onStreamChunk && text) {
      req.onStreamChunk(text);
    }

    const inputTokensEst =
      typeof data?.usageMetadata?.promptTokenCount === "number"
        ? data.usageMetadata.promptTokenCount
        : estimateTokens(req.system) + estimateTokens(req.user);
    const outputTokensEst =
      typeof data?.usageMetadata?.candidatesTokenCount === "number"
        ? data.usageMetadata.candidatesTokenCount
        : estimateTokens(text);

    return {
      text,
      json: req.jsonMode ? extractAndRepairJson(text) : undefined,
      connectionId: conn.id,
      model: conn.model,
      provider: conn.provider,
      inputTokensEst,
      outputTokensEst,
      rateLimitHeaders: rlHeaders
    };
  }
}
