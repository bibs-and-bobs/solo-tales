/* Optional claude.ai artifact host bridge (only used if window.claude.complete exists). */

import { extractAndRepairJson } from "../json-repair";
import { estimateTokens } from "../rate-limiter";
import { LLMError, type LLMRequest, type LLMResponse, type ModelConnection, type ProviderDriver } from "../types";

export function hasClaudeArtifactBridge(): boolean {
  const g = globalThis as any;
  return typeof g?.window?.claude?.complete === "function";
}

export class ClaudeArtifactDriver implements ProviderDriver {
  readonly kind = "claude-artifact" as const;

  async send(req: LLMRequest, conn: ModelConnection): Promise<LLMResponse> {
    const g = globalThis as any;
    const completeFn = g?.window?.claude?.complete;
    if (typeof completeFn !== "function") {
      throw new LLMError("Claude artifact bridge is not available outside claude.ai.");
    }
    const combined = `${req.system}\n\n${req.user}`;
    const raw = await completeFn(combined);
    const text = String(raw ?? "");
    if (req.onStreamChunk && text) req.onStreamChunk(text);
    return {
      text,
      json: req.jsonMode ? extractAndRepairJson(text) : undefined,
      connectionId: conn.id,
      model: conn.model || "claude-artifact",
      provider: "claude-artifact",
      inputTokensEst: estimateTokens(combined),
      outputTokensEst: estimateTokens(text)
    };
  }
}
