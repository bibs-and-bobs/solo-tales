/* Multi-Provider Portrait Image Router & Upload/Crest Adapter.
   Automatically uses image-capable keys in the user's ModelConnection pool
   (OpenAI, Gemini Imagen / Flash-Image, OpenRouter), an optional dedicated image endpoint
   (e.g. FAL / Local Automatic1111 / ComfyUI), custom file uploads, or zero-API Heraldic SVG crests. */

import type { ModelConnection } from "../llm/types";
import type { CampaignArtBrief, PortraitStylePreset } from "../../engine";
import {
  base64ToBlob,
  composePortraitPrompt,
  compressToWebpBlob,
  DEFAULT_THEME_ART_PROFILE,
  generateHeraldicSvg,
  svgToBlob,
  type SubjectSpec,
  type ThemeArtProfile
} from "../../narrator/portraits";

export type DedicatedImageProvider =
  | "auto"
  | "openai"
  | "gemini"
  | "openrouter"
  | "local-sd"
  | "heraldic-only";

export interface ImageEndpointConfig {
  mode: DedicatedImageProvider;
  baseUrl?: string;
  model?: string;
  apiKeyRef?: string;
}

export interface GeneratedPortrait {
  blob: Blob;
  prompt: string;
  source: "api" | "upload" | "heraldic";
  providerLabel: string;
}

export const DEFAULT_IMAGE_CONFIG: ImageEndpointConfig = {
  mode: "auto"
};

export interface ImageRouterOptions {
  getConnections: () => readonly ModelConnection[];
  resolveApiKey: (apiKeyRef: string) => Promise<string> | string;
  config?: ImageEndpointConfig;
  themeProfile?: ThemeArtProfile;
  fetchFn?: typeof fetch;
}

export class ImageRouter {
  private getConnectionsFn: () => readonly ModelConnection[];
  private resolveApiKeyFn: (apiKeyRef: string) => Promise<string> | string;
  private config: ImageEndpointConfig;
  private themeProfile: ThemeArtProfile;
  private fetchFn: typeof fetch;

  constructor(opts: ImageRouterOptions) {
    this.getConnectionsFn = opts.getConnections;
    this.resolveApiKeyFn = opts.resolveApiKey;
    this.config = { ...DEFAULT_IMAGE_CONFIG, ...(opts.config || {}) };
    this.themeProfile = opts.themeProfile ?? DEFAULT_THEME_ART_PROFILE;
    this.fetchFn = opts.fetchFn ?? ((...args) => globalThis.fetch(...args));
  }

  setConfig(config: Partial<ImageEndpointConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): Readonly<ImageEndpointConfig> {
    return this.config;
  }

  setThemeProfile(profile: ThemeArtProfile): void {
    this.themeProfile = profile;
  }

  getThemeProfile(): ThemeArtProfile {
    return this.themeProfile;
  }

  /** Checks whether an AI image generation backend is currently configured & enabled. */
  hasAiImageCapability(): boolean {
    if (this.config.mode === "heraldic-only") return false;
    if (this.config.mode !== "auto") return true;
    return this.getConnectionsFn().some(c => c.enabled && c.capabilities.imageGen);
  }

  createHeraldicPortrait(
    subject: SubjectSpec,
    artBrief?: CampaignArtBrief | null
  ): GeneratedPortrait {
    const svg = generateHeraldicSvg(subject, artBrief);
    return {
      blob: svgToBlob(svg),
      prompt: "Heraldic crest & monogram",
      source: "heraldic",
      providerLabel: "Built-in Heraldic Crest"
    };
  }

  async importUploadedFile(file: Blob): Promise<GeneratedPortrait> {
    const compressed = await compressToWebpBlob(file, 512, 0.86);
    return {
      blob: compressed,
      prompt: "Custom uploaded portrait",
      source: "upload",
      providerLabel: "Uploaded Image"
    };
  }

  async generatePortrait(
    subject: SubjectSpec,
    artBrief?: CampaignArtBrief | null,
    opts?: {
      styleOverride?: PortraitStylePreset;
      customStyleNote?: string;
      signal?: AbortSignal;
      fallbackToHeraldic?: boolean;
    }
  ): Promise<GeneratedPortrait> {
    const composed = composePortraitPrompt(
      this.themeProfile,
      artBrief,
      subject,
      opts?.styleOverride,
      opts?.customStyleNote
    );

    if (this.config.mode === "heraldic-only") {
      return this.createHeraldicPortrait(subject, artBrief);
    }

    try {
      let rawBlob: Blob | null = null;
      let label = "";

      if (this.config.mode === "local-sd") {
        rawBlob = await this.callLocalSd(composed.prompt, composed.negativePrompt, opts?.signal);
        label = "Local Stable Diffusion";
      } else if (this.config.mode === "openai") {
        const key = await this.resolveApiKeyFn(this.config.apiKeyRef || "");
        rawBlob = await this.callOpenAiImages(
          this.config.baseUrl || "https://api.openai.com/v1",
          this.config.model || "gpt-image-1",
          key,
          composed.prompt,
          opts?.signal
        );
        label = `OpenAI (${this.config.model || "gpt-image-1"})`;
      } else if (this.config.mode === "gemini") {
        const key = await this.resolveApiKeyFn(this.config.apiKeyRef || "");
        rawBlob = await this.callGeminiImage(
          this.config.baseUrl || "https://generativelanguage.googleapis.com/v1beta",
          this.config.model || "gemini-2.0-flash-preview-image-generation",
          key,
          composed.prompt,
          opts?.signal
        );
        label = `Gemini (${this.config.model || "Image"})`;
      } else if (this.config.mode === "openrouter") {
        const key = await this.resolveApiKeyFn(this.config.apiKeyRef || "");
        rawBlob = await this.callOpenAiImages(
          this.config.baseUrl || "https://openrouter.ai/api/v1",
          this.config.model || "black-forest-labs/flux-1-schnell",
          key,
          composed.prompt,
          opts?.signal
        );
        label = `OpenRouter (${this.config.model || "FLUX"})`;
      } else {
        // Auto mode: find first enabled image-capable ModelConnection in pool
        const imgConn = this.getConnectionsFn().find(c => c.enabled && c.capabilities.imageGen);
        if (!imgConn) {
          if (opts?.fallbackToHeraldic !== false) {
            return this.createHeraldicPortrait(subject, artBrief);
          }
          throw new Error(
            "No image-capable API key is enabled. Add an OpenAI, Gemini, or dedicated image endpoint in Settings, or upload an image."
          );
        }

        const key = String((await this.resolveApiKeyFn(imgConn.apiKeyRef)) ?? "");
        const imgModel = imgConn.capabilities.imageModel || imgConn.model;
        label = `${imgConn.label} (${imgModel})`;

        if (imgConn.provider === "gemini") {
          rawBlob = await this.callGeminiImage(
            imgConn.baseUrl || "https://generativelanguage.googleapis.com/v1beta",
            imgModel,
            key,
            composed.prompt,
            opts?.signal
          );
        } else {
          rawBlob = await this.callOpenAiImages(
            imgConn.baseUrl || "https://api.openai.com/v1",
            imgModel,
            key,
            composed.prompt,
            opts?.signal
          );
        }
      }

      if (!rawBlob) {
        throw new Error("Image provider returned no image data.");
      }

      const webpBlob = await compressToWebpBlob(rawBlob, 512, 0.85);
      return {
        blob: webpBlob,
        prompt: composed.prompt,
        source: "api",
        providerLabel: label
      };
    } catch (err) {
      if (opts?.signal?.aborted) throw err;
      if (opts?.fallbackToHeraldic === true) {
        return this.createHeraldicPortrait(subject, artBrief);
      }
      throw err;
    }
  }

  private async callOpenAiImages(
    baseUrl: string,
    model: string,
    apiKey: string,
    prompt: string,
    signal?: AbortSignal
  ): Promise<Blob> {
    const base = baseUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey.trim()) headers["Authorization"] = `Bearer ${apiKey.trim()}`;

    const body: Record<string, any> = {
      model,
      prompt: prompt.slice(0, 3800),
      n: 1,
      size: "1024x1024"
    };
    if (!model.startsWith("gpt-image")) {
      body.response_format = "b64_json";
    }

    const res = await this.fetchFn(`${base}/images/generations`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Image generation failed (HTTP ${res.status}): ${txt.slice(0, 240)}`);
    }

    const data = await res.json();
    const item = data?.data?.[0];
    if (typeof item?.b64_json === "string") {
      return base64ToBlob(item.b64_json, "image/png");
    }
    if (typeof item?.url === "string") {
      const imgRes = await this.fetchFn(item.url, { signal });
      if (!imgRes.ok) throw new Error("Failed to download generated portrait URL.");
      return await imgRes.blob();
    }
    throw new Error("Unexpected response shape from OpenAI-compatible image endpoint.");
  }

  private async callGeminiImage(
    baseUrl: string,
    model: string,
    apiKey: string,
    prompt: string,
    signal?: AbortSignal
  ): Promise<Blob> {
    const base = baseUrl.replace(/\/+$/, "");
    const modelPath = model.startsWith("models/") ? model : `models/${model}`;

    // Imagen 3 `:predict` endpoint vs Gemini Flash Image `:generateContent` endpoint
    if (/^models\/imagen/i.test(modelPath)) {
      const res = await this.fetchFn(`${base}/${modelPath}:predict`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey.trim()
        },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount: 1, aspectRatio: "1:1" }
        }),
        signal
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Gemini Imagen failed (HTTP ${res.status}): ${txt.slice(0, 240)}`);
      }
      const data = await res.json();
      const b64 = data?.predictions?.[0]?.bytesBase64Encoded;
      const mime = data?.predictions?.[0]?.mimeType || "image/png";
      if (typeof b64 === "string") return base64ToBlob(b64, mime);
      throw new Error("Imagen returned no image bytes.");
    }

    // Gemini multimodal image generation (`responseModalities: ["TEXT", "IMAGE"]`)
    const res = await this.fetchFn(`${base}/${modelPath}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey.trim()
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"]
        }
      }),
      signal
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Gemini image generation failed (HTTP ${res.status}): ${txt.slice(0, 240)}`);
    }

    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (typeof part?.inlineData?.data === "string") {
        return base64ToBlob(part.inlineData.data, part.inlineData.mimeType || "image/png");
      }
    }
    throw new Error("Gemini response contained no inline image data.");
  }

  private async callLocalSd(
    prompt: string,
    negativePrompt: string,
    signal?: AbortSignal
  ): Promise<Blob> {
    const base = (this.config.baseUrl || "http://127.0.0.1:7860").replace(/\/+$/, "");
    const res = await this.fetchFn(`${base}/sdapi/v1/txt2img`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        negative_prompt: negativePrompt,
        width: 512,
        height: 512,
        steps: 22,
        cfg_scale: 6.5
      }),
      signal
    });
    if (!res.ok) {
      throw new Error(`Local Stable Diffusion endpoint returned HTTP ${res.status}`);
    }
    const data = await res.json();
    const b64 = data?.images?.[0];
    if (typeof b64 !== "string") {
      throw new Error("Local Stable Diffusion returned no image.");
    }
    return base64ToBlob(b64, "image/png");
  }
}
