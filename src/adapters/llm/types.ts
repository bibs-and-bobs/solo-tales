/* Multi-key / Multi-model LLM Router & Free-Tier Scheduler types. */

export type TaskKind =
  | "world_prep"
  | "story_turn"
  | "story_strong"
  | "combat_round"
  | "ruling"
  | "memory_fold"
  | "ask_world"
  | "epitaph"
  | "portrait_prompt";

/** 1 = Interactive turn/ruling/ask, 2 = Campaign prep step, 3 = Background fold / combat round prose */
export type RequestPriority = 1 | 2 | 3;

export type ProviderKind =
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "claude-artifact"
  | "mock";

export type ReasoningTier = 1 | 2 | 3;

export interface ModelCapabilities {
  jsonMode: boolean;
  streaming: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  reasoningTier: ReasoningTier;
  imageGen: boolean;
  imageModel?: string;
}

export interface RateLimitConfig {
  /** Max requests per 60s rolling window (null = unlimited/provider-managed) */
  rpm: number | null;
  /** Max input+output tokens per 60s rolling window */
  tpm: number | null;
  /** Optional daily cap */
  rpd: number | null;
  /** Marks free-tier keys so Auto Economy Mode activates automatically */
  isFreeTier: boolean;
}

export interface ModelConnection {
  id: string;
  label: string;
  provider: ProviderKind;
  baseUrl?: string;
  model: string;
  /** Keyring slot ID (never serialized with the raw secret into campaign exports) */
  apiKeyRef: string;
  enabled: boolean;
  capabilities: ModelCapabilities;
  limits: RateLimitConfig;
}

export type EconomyModeSetting = "auto" | "on" | "off";

export interface RoutingConfig {
  economyMode: EconomyModeSetting;
  /** Optional user pins mapping a specific task to a ModelConnection.id */
  pins: Partial<Record<TaskKind, string>>;
  /** Minimum spacing in ms between sequential prep calls when in Economy Mode */
  prepStepSpacingMs: number;
}

export interface LLMRequest {
  task: TaskKind;
  priority?: RequestPriority;
  system: string;
  user: string;
  jsonMode?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  onStreamChunk?: (delta: string) => void;
}

export interface RateLimitHeaders {
  retryAfterMs?: number;
  remainingRequests?: number;
  remainingTokens?: number;
  resetRequestsMs?: number;
}

export interface LLMResponse {
  text: string;
  json?: any;
  connectionId: string;
  model: string;
  provider: ProviderKind;
  inputTokensEst: number;
  outputTokensEst: number;
  rateLimitHeaders?: RateLimitHeaders;
  skippedByEconomy?: boolean;
}

export interface WaitNotice {
  connectionId: string;
  connectionLabel: string;
  secondsLeft: number;
  reason: string;
  task: TaskKind;
}

export type WaitTickListener = (notice: WaitNotice | null) => void;

export class LLMError extends Error {
  status?: number;
  isRateLimit: boolean;
  retryAfterMs?: number;
  isAuthError: boolean;
  isContextTooLarge: boolean;
  rateLimitHeaders?: RateLimitHeaders;

  constructor(
    message: string,
    opts: {
      status?: number;
      isRateLimit?: boolean;
      retryAfterMs?: number;
      isAuthError?: boolean;
      isContextTooLarge?: boolean;
      rateLimitHeaders?: RateLimitHeaders;
    } = {}
  ) {
    super(message);
    this.name = "LLMError";
    this.status = opts.status;
    this.isRateLimit = Boolean(opts.isRateLimit || opts.status === 429);
    this.retryAfterMs = opts.retryAfterMs;
    this.isAuthError = Boolean(opts.isAuthError || opts.status === 401 || opts.status === 403);
    this.isContextTooLarge = Boolean(opts.isContextTooLarge || opts.status === 413);
    this.rateLimitHeaders = opts.rateLimitHeaders;
  }
}

export interface ProviderDriver {
  readonly kind: ProviderKind;
  send(req: LLMRequest, conn: ModelConnection, apiKey: string): Promise<LLMResponse>;
}

export interface ConnectionPreset {
  presetId: string;
  label: string;
  badge: string;
  provider: ProviderKind;
  baseUrl?: string;
  model: string;
  requiresKey: boolean;
  keyPlaceholder: string;
  capabilities: ModelCapabilities;
  limits: RateLimitConfig;
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  economyMode: "auto",
  pins: {},
  prepStepSpacingMs: 1200
};

export const TASK_DEFAULT_PRIORITY: Record<TaskKind, RequestPriority> = {
  story_turn: 1,
  story_strong: 1,
  ruling: 1,
  ask_world: 1,
  epitaph: 1,
  world_prep: 2,
  portrait_prompt: 2,
  combat_round: 3,
  memory_fold: 3
};

/** Preferred reasoning tier per task when multiple healthy connections exist */
export const TASK_PREFERRED_TIER: Record<TaskKind, ReasoningTier> = {
  world_prep: 3,
  story_strong: 3,
  ruling: 3,
  epitaph: 2,
  story_turn: 2,
  ask_world: 2,
  portrait_prompt: 1,
  memory_fold: 1,
  combat_round: 1
};

export const CONNECTION_PRESETS: readonly ConnectionPreset[] = [
  {
    presetId: "gemini-flash-free",
    label: "Google Gemini 2.5 Flash (Free Tier)",
    badge: "Free Tier • 10 RPM",
    provider: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash",
    requiresKey: true,
    keyPlaceholder: "AIzaSy...",
    capabilities: {
      jsonMode: true,
      streaming: true,
      contextWindow: 1000000,
      maxOutputTokens: 4096,
      reasoningTier: 2,
      imageGen: true,
      imageModel: "gemini-2.0-flash-preview-image-generation"
    },
    limits: { rpm: 10, tpm: 250000, rpd: 250, isFreeTier: true }
  },
  {
    presetId: "gemini-pro",
    label: "Google Gemini 2.5 Pro",
    badge: "Deep Worldbuilding",
    provider: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-pro",
    requiresKey: true,
    keyPlaceholder: "AIzaSy...",
    capabilities: {
      jsonMode: true,
      streaming: true,
      contextWindow: 1000000,
      maxOutputTokens: 8192,
      reasoningTier: 3,
      imageGen: true,
      imageModel: "imagen-3.0-generate-002"
    },
    limits: { rpm: 30, tpm: 500000, rpd: null, isFreeTier: false }
  },
  {
    presetId: "groq-llama-free",
    label: "Groq — Llama 3.3 70B (Free Tier)",
    badge: "Free Tier • 30 RPM / 12k TPM",
    provider: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    requiresKey: true,
    keyPlaceholder: "gsk_...",
    capabilities: {
      jsonMode: true,
      streaming: true,
      contextWindow: 32768,
      maxOutputTokens: 3072,
      reasoningTier: 2,
      imageGen: false
    },
    limits: { rpm: 28, tpm: 11500, rpd: 1000, isFreeTier: true }
  },
  {
    presetId: "openrouter-free",
    label: "OpenRouter — Free Model Router",
    badge: "Free Tier • 20 RPM",
    provider: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "meta-llama/llama-3.3-70b-instruct:free",
    requiresKey: true,
    keyPlaceholder: "sk-or-v1-...",
    capabilities: {
      jsonMode: true,
      streaming: true,
      contextWindow: 65536,
      maxOutputTokens: 3072,
      reasoningTier: 2,
      imageGen: false
    },
    limits: { rpm: 18, tpm: 60000, rpd: 200, isFreeTier: true }
  },
  {
    presetId: "openai-gpt41-mini",
    label: "OpenAI — GPT-4.1 Mini (+ Portraits)",
    badge: "Fast + Image Gen",
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    requiresKey: true,
    keyPlaceholder: "sk-...",
    capabilities: {
      jsonMode: true,
      streaming: true,
      contextWindow: 128000,
      maxOutputTokens: 4096,
      reasoningTier: 2,
      imageGen: true,
      imageModel: "gpt-image-1"
    },
    limits: { rpm: 60, tpm: 200000, rpd: null, isFreeTier: false }
  },
  {
    presetId: "openai-gpt41",
    label: "OpenAI — GPT-4.1 (+ Portraits)",
    badge: "Flagship + Image Gen",
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1",
    requiresKey: true,
    keyPlaceholder: "sk-...",
    capabilities: {
      jsonMode: true,
      streaming: true,
      contextWindow: 128000,
      maxOutputTokens: 4096,
      reasoningTier: 3,
      imageGen: true,
      imageModel: "gpt-image-1"
    },
    limits: { rpm: 60, tpm: 150000, rpd: null, isFreeTier: false }
  },
  {
    presetId: "anthropic-sonnet",
    label: "Anthropic — Claude Sonnet 4.5",
    badge: "Flagship Prose + Prompt Cache",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5",
    requiresKey: true,
    keyPlaceholder: "sk-ant-...",
    capabilities: {
      jsonMode: true,
      streaming: true,
      contextWindow: 200000,
      maxOutputTokens: 4096,
      reasoningTier: 3,
      imageGen: false
    },
    limits: { rpm: 50, tpm: 80000, rpd: null, isFreeTier: false }
  },
  {
    presetId: "anthropic-haiku",
    label: "Anthropic — Claude Haiku 4.5",
    badge: "Fast + Prompt Cache",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-haiku-4-5",
    requiresKey: true,
    keyPlaceholder: "sk-ant-...",
    capabilities: {
      jsonMode: true,
      streaming: true,
      contextWindow: 200000,
      maxOutputTokens: 4096,
      reasoningTier: 1,
      imageGen: false
    },
    limits: { rpm: 50, tpm: 100000, rpd: null, isFreeTier: false }
  },
  {
    presetId: "ollama-local",
    label: "Local Ollama (127.0.0.1:11434)",
    badge: "Offline / Zero Cost",
    provider: "openai-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "qwen2.5:14b",
    requiresKey: false,
    keyPlaceholder: "Optional (leave blank for local)",
    capabilities: {
      jsonMode: true,
      streaming: true,
      contextWindow: 8192,
      maxOutputTokens: 2048,
      reasoningTier: 2,
      imageGen: false
    },
    limits: { rpm: null, tpm: null, rpd: null, isFreeTier: false }
  },
  {
    presetId: "lmstudio-local",
    label: "LM Studio / OpenAI-Compatible Local",
    badge: "Offline / Custom URL",
    provider: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "local-model",
    requiresKey: false,
    keyPlaceholder: "Optional API key",
    capabilities: {
      jsonMode: true,
      streaming: true,
      contextWindow: 8192,
      maxOutputTokens: 2048,
      reasoningTier: 2,
      imageGen: false
    },
    limits: { rpm: null, tpm: null, rpd: null, isFreeTier: false }
  }
];
