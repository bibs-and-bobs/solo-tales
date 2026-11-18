/* OpenAI-compatible provider driver (OpenAI, Groq, OpenRouter, Ollama, LM Studio, custom v1 endpoints). */

import { extractAndRepairJson } from "../json-repair";
import { estimateTokens, parseRateLimitHeaders } from "../rate-limiter";
import { LLMError, type LLMRequest, type LLMResponse, type ModelConnection, type ProviderDriver } from "../types";

async function readErrorBody(res: Response): Promise<string> {
  try {
    const txt = await res.text();
    try {
      const parsed = JSON.parse(txt);
      const msg = parsed?.error?.message || parsed?.message || txt;
      return String(msg).slice(0, 400);
    } catch {
      return txt.slice(0, 400);
    }
  } catch {
    return `HTTP ${res.status}`;
  }
}

export class OpenAICompatibleDriver implements ProviderDriver {
  readonly kind = "openai-compatible" as const;
  private fetchFn: typeof fetch;

  constructor(fetchFn?: typeof fetch) {
    this.fetchFn = fetchFn ?? ((...args) => globalThis.fetch(...args));
  }

  async send(req: LLMRequest, conn: ModelConnection, apiKey: string): Promise<LLMResponse> {
    const base = (conn.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
    const url = `${base}/chat/completions`;
    const isOpenRouter = base.includes("openrouter.ai");

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (apiKey.trim()) {
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
    }
    if (isOpenRouter) {
      headers["X-Title"] = "Solo Tales";
    }

    const isReasoningModel = /gpt-oss|qwen3|deepseek-r1|\bo[134](?:-|$)/i.test(conn.model);
    const usesCompletionTokens = /^(?:o[134](?:-|$)|gpt-5)/i.test(conn.model);
    const maxTokens = Math.min(
      isReasoningModel ? Math.max(req.maxOutputTokens ?? 1400, 2400) : (req.maxOutputTokens ?? 1400),
      conn.capabilities.maxOutputTokens || 4096
    );
    const wantStream = Boolean(req.onStreamChunk && conn.capabilities.streaming && !req.jsonMode);

    const buildBody = (opts: {
      includeJsonFormat: boolean;
      useCompletionTokens: boolean;
      omitTemperature: boolean;
      tokenCap: number;
    }) => {
      const body: Record<string, any> = {
        model: conn.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user }
        ],
        stream: wantStream
      };
      if (!opts.omitTemperature) {
        body.temperature = req.temperature ?? 0.7;
      }
      if (opts.useCompletionTokens) {
        body.max_completion_tokens = opts.tokenCap;
      } else {
        body.max_tokens = opts.tokenCap;
      }
      if (/gpt-oss/i.test(conn.model)) {
        body.reasoning_effort = "low";
      }
      if (opts.includeJsonFormat && req.jsonMode && conn.capabilities.jsonMode) {
        body.response_format = { type: "json_object" };
      }
      return body;
    };

    const bodyOpts = {
      includeJsonFormat: true,
      useCompletionTokens: usesCompletionTokens,
      omitTemperature: usesCompletionTokens,
      tokenCap: maxTokens
    };

    const post = (opts: typeof bodyOpts) =>
      this.fetchFn(url, {
        method: "POST",
        headers,
        body: JSON.stringify(buildBody(opts)),
        signal: req.signal
      });

    let res = await post(bodyOpts);

    // Fallback for providers/models that reject response_format: json_object (HTTP 400/422)
    // or require max_completion_tokens / default temperature (e.g. o-series / gpt-5)
    if ((res.status === 400 || res.status === 422) && !res.ok) {
      const errPreview = await res.clone().text().catch(() => "");
      const needsCompletionTokens = /max_completion_tokens|max_tokens.*not supported/i.test(errPreview);
      const needsDefaultTemp = /temperature.*not supported|only the default/i.test(errPreview);
      if (needsCompletionTokens || needsDefaultTemp) {
        res = await post({
          ...bodyOpts,
          useCompletionTokens: bodyOpts.useCompletionTokens || needsCompletionTokens,
          omitTemperature: bodyOpts.omitTemperature || needsDefaultTemp
        });
      } else if (req.jsonMode && conn.capabilities.jsonMode) {
        res = await post({ ...bodyOpts, includeJsonFormat: false });
      }
    }

    const rlHeaders = parseRateLimitHeaders(res.headers);

    if (!res.ok) {
      const msg = await readErrorBody(res);
      const isCtx =
        res.status === 413 || /context_length|maximum context|too large|tokens per minute/i.test(msg);
      throw new LLMError(`${conn.label}: ${msg}`, {
        status: res.status,
        isRateLimit: res.status === 429,
        retryAfterMs: rlHeaders.retryAfterMs,
        isAuthError: res.status === 401 || res.status === 403,
        isContextTooLarge: isCtx,
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
            const parsed = JSON.parse(payload);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              fullText += delta;
              req.onStreamChunk?.(delta);
            }
          } catch {
            // ignore partial SSE comment/chunk
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

    let data = await res.json();
    let rawContent = data?.choices?.[0]?.message?.content;
    let text = Array.isArray(rawContent)
      ? rawContent.map((p: any) => p?.text ?? "").join("")
      : String(rawContent ?? "");

    // If a reasoning model hit max_tokens before emitting visible content, retry once with a larger token cap
    if (!text.trim() && data?.choices?.[0]?.finish_reason === "length" && isReasoningModel) {
      const bumpedCap = Math.min(Math.max(maxTokens * 2, 3072), conn.capabilities.maxOutputTokens || 4096);
      if (bumpedCap > maxTokens) {
        const retryRes = await post({ ...bodyOpts, tokenCap: bumpedCap });
        if (retryRes.ok) {
          data = await retryRes.json();
          rawContent = data?.choices?.[0]?.message?.content;
          text = Array.isArray(rawContent)
            ? rawContent.map((p: any) => p?.text ?? "").join("")
            : String(rawContent ?? "");
        }
      }
    }

    if (req.jsonMode) {
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    }

    const outTokens =
      typeof data?.usage?.completion_tokens === "number"
        ? data.usage.completion_tokens
        : estimateTokens(text);
    const inTokens =
      typeof data?.usage?.prompt_tokens === "number" ? data.usage.prompt_tokens : inputTokensEst;

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
