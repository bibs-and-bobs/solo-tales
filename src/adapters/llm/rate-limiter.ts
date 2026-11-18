/* Per-connection sliding-window RPM & TPM Rate Limiter, HTTP 429 / Retry-After
   header parser, priority waiter, and UI countdown notifier. */

import type {
  ModelConnection,
  RateLimitHeaders,
  RequestPriority,
  TaskKind,
  WaitNotice,
  WaitTickListener
} from "./types";

interface TokenSample {
  at: number;
  tokens: number;
}

interface ConnectionWindow {
  requestTimestamps: number[];
  tokenSamples: TokenSample[];
  dailyCount: number;
  dailyDayKey: string;
  cooldownUntilMs: number;
  cooldownReason: string;
  inFlight: number;
}

interface QueuedWaiter {
  id: number;
  priority: RequestPriority;
  enqueuedAt: number;
  wake: () => void;
}

const WINDOW_MS = 60_000;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 3.8));
}

function parseDurationHeaderToMs(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s) return undefined;

  // Pure numeric seconds (e.g. Retry-After: 12 or 1.5)
  if (/^\d+(\.\d+)?$/.test(s)) {
    return Math.ceil( parseFloat(s) * 1000 );
  }

  // Go-style duration strings used by OpenAI/Groq/OpenRouter (e.g. "6s", "1m20.5s", "450ms")
  let totalMs = 0;
  let matched = false;
  const rx = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(s)) !== null) {
    matched = true;
    const val = parseFloat(m[1]);
    const unit = m[2];
    if (unit === "ms") totalMs += val;
    else if (unit === "s") totalMs += val * 1000;
    else if (unit === "m") totalMs += val * 60_000;
    else if (unit === "h") totalMs += val * 3_600_000;
  }
  if (matched) return Math.ceil(totalMs);

  // HTTP-date format
  const dateMs = Date.parse(s);
  if (Number.isFinite(dateMs)) {
    const diff = dateMs - Date.now();
    if (diff > 0) return diff;
  }
  return undefined;
}

function getHeader(
  headers: Headers | Record<string, string | null | undefined>,
  name: string
): string | null | undefined {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name);
  }
  const rec = headers as Record<string, string | null | undefined>;
  const lower = name.toLowerCase();
  for (const k of Object.keys(rec)) {
    if (k.toLowerCase() === lower) return rec[k];
  }
  return undefined;
}

export function parseRateLimitHeaders(
  headers?: Headers | Record<string, string | null | undefined> | null
): RateLimitHeaders {
  if (!headers) return {};
  const retryAfterMsCol =
    (getHeader(headers, "retry-after-ms")
      ? Math.ceil(parseFloat(String(getHeader(headers, "retry-after-ms"))))
      : undefined) ?? parseDurationHeaderToMs(getHeader(headers, "retry-after"));

  const remReqRaw =
    getHeader(headers, "x-ratelimit-remaining-requests") ??
    getHeader(headers, "anthropic-ratelimit-requests-remaining");
  const remTokRaw =
    getHeader(headers, "x-ratelimit-remaining-tokens") ??
    getHeader(headers, "anthropic-ratelimit-tokens-remaining");
  const resetReqMs =
    parseDurationHeaderToMs(getHeader(headers, "x-ratelimit-reset-requests")) ??
    parseDurationHeaderToMs(getHeader(headers, "anthropic-ratelimit-requests-reset"));

  const out: RateLimitHeaders = {};
  if (retryAfterMsCol !== undefined && Number.isFinite(retryAfterMsCol) && retryAfterMsCol > 0) {
    out.retryAfterMs = retryAfterMsCol;
  }
  if (remReqRaw != null && remReqRaw !== "" && Number.isFinite(Number(remReqRaw))) {
    out.remainingRequests = Number(remReqRaw);
  }
  if (remTokRaw != null && remTokRaw !== "" && Number.isFinite(Number(remTokRaw))) {
    out.remainingTokens = Number(remTokRaw);
  }
  if (resetReqMs !== undefined && Number.isFinite(resetReqMs) && resetReqMs > 0) {
    out.resetRequestsMs = resetReqMs;
  }
  return out;
}

function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

export class RateLimiter {
  private windows = new Map<string, ConnectionWindow>();
  private waiters: QueuedWaiter[] = [];
  private nextWaiterId = 1;
  private listeners = new Set<WaitTickListener>();
  private nowFn: () => number;
  private sleepFn: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(opts?: {
    now?: () => number;
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  }) {
    this.nowFn = opts?.now ?? (() => Date.now());
    this.sleepFn =
      opts?.sleep ??
      ((ms: number, signal?: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          }, ms);
          const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          };
          signal?.addEventListener("abort", onAbort, { once: true });
        }));
  }

  onWaitTick(listener: WaitTickListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitWait(notice: WaitNotice | null): void {
    for (const fn of this.listeners) {
      try {
        fn(notice);
      } catch {
        // Ignore UI listener faults
      }
    }
  }

  private getWindow(connectionId: string, now: number): ConnectionWindow {
    let w = this.windows.get(connectionId);
    const dk = dayKey(now);
    if (!w) {
      w = {
        requestTimestamps: [],
        tokenSamples: [],
        dailyCount: 0,
        dailyDayKey: dk,
        cooldownUntilMs: 0,
        cooldownReason: "",
        inFlight: 0
      };
      this.windows.set(connectionId, w);
    }
    this.prune(w, now);
    return w;
  }

  private prune(w: ConnectionWindow, now: number): void {
    const cutoff = now - WINDOW_MS;
    while (w.requestTimestamps.length > 0 && w.requestTimestamps[0] <= cutoff) {
      w.requestTimestamps.shift();
    }
    while (w.tokenSamples.length > 0 && w.tokenSamples[0].at <= cutoff) {
      w.tokenSamples.shift();
    }
    const dk = dayKey(now);
    if (w.dailyDayKey !== dk) {
      w.dailyDayKey = dk;
      w.dailyCount = 0;
    }
  }

  /** Returns 0 if the connection can fire immediately; otherwise exact wait ms and reason. */
  getWaitStatus(
    conn: ModelConnection,
    estTokens: number,
    now = this.nowFn()
  ): { waitMs: number; reason: string; dailyExhausted: boolean } {
    const w = this.getWindow(conn.id, now);

    if (conn.limits.rpd != null && conn.limits.rpd > 0 && w.dailyCount >= conn.limits.rpd) {
      return {
        waitMs: 3_600_000,
        reason: `${conn.label} reached its daily limit (${conn.limits.rpd} RPD)`,
        dailyExhausted: true
      };
    }

    let waitMs = 0;
    let reason = "";

    if (w.cooldownUntilMs > now) {
      waitMs = w.cooldownUntilMs - now;
      reason = w.cooldownReason || `${conn.label} cooling down after rate limit`;
    }

    if (conn.limits.rpm != null && conn.limits.rpm > 0) {
      if (w.requestTimestamps.length + w.inFlight >= conn.limits.rpm) {
        const oldest = w.requestTimestamps[0] ?? now;
        const rpmWait = Math.max(250, oldest + WINDOW_MS - now + 50);
        if (rpmWait > waitMs) {
          waitMs = rpmWait;
          reason = `${conn.label} rate limit (${conn.limits.rpm} RPM)`;
        }
      }
    }

    if (conn.limits.tpm != null && conn.limits.tpm > 0) {
      const usedTokens = w.tokenSamples.reduce((sum, s) => sum + s.tokens, 0);
      // Only gate if we already have prior samples in the window so a single slightly larger request can still try
      if (w.tokenSamples.length > 0 && usedTokens + estTokens > conn.limits.tpm) {
        const oldestTok = w.tokenSamples[0].at;
        const tpmWait = Math.max(250, oldestTok + WINDOW_MS - now + 50);
        if (tpmWait > waitMs) {
          waitMs = tpmWait;
          reason = `${conn.label} token window (${conn.limits.tpm.toLocaleString()} TPM)`;
        }
      }
    }

    return { waitMs, reason, dailyExhausted: false };
  }

  /** Fraction [0..1] of remaining RPM headroom for scoring healthy connections */
  getHeadroomRatio(conn: ModelConnection, now = this.nowFn()): number {
    const w = this.getWindow(conn.id, now);
    if (w.cooldownUntilMs > now) return 0;
    if (conn.limits.rpd != null && conn.limits.rpd > 0 && w.dailyCount >= conn.limits.rpd) return 0;
    if (conn.limits.rpm == null || conn.limits.rpm <= 0) return 1;
    const used = w.requestTimestamps.length + w.inFlight;
    return Math.max(0, Math.min(1, (conn.limits.rpm - used) / conn.limits.rpm));
  }

  markCooldown(connectionId: string, cooldownMs: number, reason = "Provider rate limit (429)"): void {
    const now = this.nowFn();
    const w = this.getWindow(connectionId, now);
    const target = now + Math.max(500, cooldownMs);
    if (target > w.cooldownUntilMs) {
      w.cooldownUntilMs = target;
      w.cooldownReason = reason;
    }
  }

  applyResponseHeaders(connectionId: string, headers?: RateLimitHeaders): void {
    if (!headers) return;
    if (headers.retryAfterMs && headers.retryAfterMs > 0) {
      this.markCooldown(connectionId, headers.retryAfterMs, "Provider Retry-After header");
      return;
    }
    if (headers.remainingRequests === 0 && headers.resetRequestsMs && headers.resetRequestsMs > 0) {
      this.markCooldown(connectionId, headers.resetRequestsMs, "Provider RPM window exhausted");
    }
  }

  recordStart(connectionId: string, estInputTokens: number): void {
    const now = this.nowFn();
    const w = this.getWindow(connectionId, now);
    w.inFlight++;
    w.requestTimestamps.push(now);
    w.dailyCount++;
    if (estInputTokens > 0) {
      w.tokenSamples.push({ at: now, tokens: estInputTokens });
    }
  }

  recordFinish(connectionId: string, outputTokensEst: number, headers?: RateLimitHeaders): void {
    const now = this.nowFn();
    const w = this.getWindow(connectionId, now);
    w.inFlight = Math.max(0, w.inFlight - 1);
    if (outputTokensEst > 0) {
      w.tokenSamples.push({ at: now, tokens: outputTokensEst });
    }
    this.applyResponseHeaders(connectionId, headers);
    this.wakeNext();
  }

  recordFailure(connectionId: string): void {
    const now = this.nowFn();
    const w = this.getWindow(connectionId, now);
    w.inFlight = Math.max(0, w.inFlight - 1);
    this.wakeNext();
  }

  private wakeNext(): void {
    if (this.waiters.length === 0) return;
    this.waiters.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);
    const next = this.waiters.shift();
    next?.wake();
  }

  /** Waits until `conn` has RPM/TPM/cooldown capacity, respecting priority order and emitting 1s UI ticks. */
  async waitForSlot(
    conn: ModelConnection,
    estTokens: number,
    priority: RequestPriority,
    task: TaskKind,
    signal?: AbortSignal
  ): Promise<void> {
    // Priority turn-taking if other callers are already queued
    if (this.waiters.length > 0) {
      await new Promise<void>((resolve, reject) => {
        const entry: QueuedWaiter = {
          id: this.nextWaiterId++,
          priority,
          enqueuedAt: this.nowFn(),
          wake: resolve
        };
        this.waiters.push(entry);
        this.waiters.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);
        // If we are highest priority at head, wake immediately to check window
        if (this.waiters[0]?.id === entry.id) {
          this.waiters.shift();
          resolve();
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            const idx = this.waiters.findIndex(w => w.id === entry.id);
            if (idx >= 0) this.waiters.splice(idx, 1);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true }
        );
      });
    }

    let emittedNotice = false;
    try {
      while (true) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const status = this.getWaitStatus(conn, estTokens);
        if (status.waitMs <= 0) break;

        emittedNotice = true;
        const secondsLeft = Math.max(1, Math.ceil(status.waitMs / 1000));
        this.emitWait({
          connectionId: conn.id,
          connectionLabel: conn.label,
          secondsLeft,
          reason: status.reason,
          task
        });

        const stepMs = Math.min(status.waitMs, 1000);
        await this.sleepFn(stepMs, signal);
      }
    } finally {
      if (emittedNotice) {
        this.emitWait(null);
      }
    }
  }
}
