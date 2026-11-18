/* Unified Cross-Platform GameStore Contract, Multi-Tab Broadcast Guard, and In-Memory Store. */

import {
  cleanDeed,
  cleanEntity,
  cleanFact,
  cleanFightLog,
  cleanFoeTemplate,
  cleanRoll,
  cleanStory,
  cleanThreatClock,
  clockText,
  clone,
  emptyDirty,
  isObj,
  migrate,
  type CampaignBundle,
  type CampaignState,
  type DeedRecord,
  type FoeTemplate,
  type LogEntry,
  type ThreatClock,
  type WorldEntity,
  type WorldFact
} from "../../engine";

export interface CampaignIndexRow {
  id: string;
  name: string;
  hero: string;
  initial: string;
  portraitId: string | null;
  clock: string;
  updated: number;
  status: "active" | "dead";
  recap: string;
}

export interface SerializedCampaignRecord {
  id: string;
  updated: number;
  writer: string;
  campaign: CampaignState;
  entities: Record<string, WorldEntity>;
  facts: Record<string, WorldFact>;
  deeds: Record<string, DeedRecord>;
  clocks: Record<string, ThreatClock>;
  foeRoster: Record<string, FoeTemplate>;
  log: LogEntry[];
}

export interface SaveOutcome {
  updated: number;
  conflict: boolean;
}

export interface GameStore {
  readonly kind: "indexeddb" | "tauri-fs" | "memory";
  readonly persistent: boolean;
  init(): Promise<void>;
  listCampaigns(): Promise<CampaignIndexRow[]>;
  saveBundle(
    bundle: CampaignBundle,
    writerSessionId: string,
    lastKnownUpdated?: number
  ): Promise<SaveOutcome>;
  loadBundle(campaignId: string, writerSessionId: string): Promise<CampaignBundle | null>;
  deleteCampaign(campaignId: string): Promise<void>;
  putBlob(blobId: string, blob: Blob): Promise<void>;
  getBlob(blobId: string): Promise<Blob | null>;
  deleteBlob(blobId: string): Promise<void>;
  getSetting<T = any>(key: string): Promise<T | null>;
  setSetting<T = any>(key: string, value: T): Promise<void>;
}

export function buildIndexRow(bundleOrState: CampaignBundle | CampaignState): CampaignIndexRow {
  const g = "campaign" in bundleOrState ? bundleOrState.campaign : bundleOrState;
  const c = g.char;
  return {
    id: g.id,
    name: g.name,
    hero: `${c.name} · ${c.species} ${c.cls} ${c.level}`,
    initial: (c.name[0] || "?").toUpperCase(),
    portraitId: c.portraitId || null,
    clock: clockText(g.time),
    updated: g.updated,
    status: g.status,
    recap: g.chapter || g.beats.at(-1) || g.setting.premise.slice(0, 120)
  };
}

export function serializeBundleForStore(
  bundle: CampaignBundle,
  writerSessionId: string,
  now = Date.now()
): SerializedCampaignRecord {
  const campaignCopy: CampaignState = {
    ...clone(bundle.campaign),
    updated: now,
    writer: writerSessionId
  };
  return {
    id: campaignCopy.id,
    updated: now,
    writer: writerSessionId,
    campaign: campaignCopy,
    entities: clone(bundle.entities),
    facts: clone(bundle.facts),
    deeds: clone(bundle.deeds),
    clocks: clone(bundle.clocks),
    foeRoster: clone(bundle.foeRoster),
    log: clone(bundle.log)
  };
}

export function hydrateSerializedRecord(
  raw: unknown,
  writerSessionId: string
): CampaignBundle | null {
  if (!isObj(raw)) return null;
  const rawCampaign = isObj(raw.campaign) ? raw.campaign : raw;

  const foeRoster: Record<string, FoeTemplate> = {};
  if (isObj(raw.foeRoster)) {
    for (const [k, v] of Object.entries(raw.foeRoster)) {
      const ft = cleanFoeTemplate(isObj(v) ? { id: k, ...v } : v);
      if (ft) foeRoster[ft.id] = ft;
    }
  }

  const g = migrate(rawCampaign, foeRoster);
  if (!g) return null;
  g.writer = writerSessionId;

  const entities: Record<string, WorldEntity> = {};
  if (isObj(raw.entities)) {
    for (const v of Object.values(raw.entities)) {
      const e = cleanEntity(v);
      if (e) entities[e.id] = e;
    }
  }

  const facts: Record<string, WorldFact> = {};
  if (isObj(raw.facts)) {
    for (const v of Object.values(raw.facts)) {
      const f = cleanFact(v);
      if (f) facts[f.id] = f;
    }
  }

  const deeds: Record<string, DeedRecord> = {};
  if (isObj(raw.deeds)) {
    for (const v of Object.values(raw.deeds)) {
      const d = cleanDeed(v);
      if (d) deeds[d.id] = d;
    }
  }

  const clocks: Record<string, ThreatClock> = {};
  if (isObj(raw.clocks)) {
    for (const v of Object.values(raw.clocks)) {
      const c = cleanThreatClock(v);
      if (c) clocks[c.id] = c;
    }
  }

  const log: LogEntry[] = [];
  if (Array.isArray(raw.log)) {
    for (const x of raw.log) {
      if (!isObj(x) || !Array.isArray(x.segs)) continue;
      log.push({
        t: Number(x.t) || 0,
        you: String(x.you ?? ""),
        segs: cleanStory(x.segs),
        chips: Array.isArray(x.chips)
          ? x.chips
              .filter(Array.isArray)
              .map((c: any[]) => [String(c[0] ?? ""), String(c[1] ?? "")] as [string, string])
          : [],
        roll: cleanRoll(x.roll),
        fight: cleanFightLog(x.fight) || undefined,
        setupLen: typeof x.setupLen === "number" ? x.setupLen : undefined,
        chunk: typeof x.chunk === "number" ? x.chunk : 0
      });
    }
  }

  if (g.place && !entities[g.place]) g.place = null;
  if (g.pending && !log.some(x => x.t === g.pending!.t)) g.pending = null;

  return {
    campaign: g,
    entities,
    facts,
    deeds,
    clocks,
    foeRoster,
    log,
    dirty: emptyDirty(),
    unread: { quests: false, journal: false }
  };
}

/** Multi-tab conflict guard via BroadcastChannel. */
export class TabConflictGuard {
  private channel: BroadcastChannel | null = null;
  private sessionId: string;
  private onConflictFn?: (campaignId: string) => void;

  constructor(sessionId: string, onConflict?: (campaignId: string) => void) {
    this.sessionId = sessionId;
    this.onConflictFn = onConflict;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        this.channel = new BroadcastChannel("solotales_campaign_sync_v1");
        this.channel.onmessage = ev => {
          const data = ev?.data;
          if (
            isObj(data) &&
            data.type === "campaign_saved" &&
            typeof data.campaignId === "string" &&
            data.writer !== this.sessionId
          ) {
            this.onConflictFn?.(data.campaignId);
          }
        };
      } catch {
        this.channel = null;
      }
    }
  }

  notifySaved(campaignId: string, updated: number): void {
    try {
      this.channel?.postMessage({
        type: "campaign_saved",
        campaignId,
        writer: this.sessionId,
        updated
      });
    } catch {
      // ignore
    }
  }

  close(): void {
    try {
      this.channel?.close();
    } catch {
      // ignore
    }
  }
}

/** Pure in-memory GameStore for automated tests and restricted sandbox environments. */
export class MemoryGameStore implements GameStore {
  readonly kind = "memory" as const;
  readonly persistent = false;
  private campaigns = new Map<string, SerializedCampaignRecord>();
  private blobs = new Map<string, Blob>();
  private settings = new Map<string, any>();

  async init(): Promise<void> {}

  async listCampaigns(): Promise<CampaignIndexRow[]> {
    const rows: CampaignIndexRow[] = [];
    for (const rec of this.campaigns.values()) {
      rows.push(buildIndexRow(rec.campaign));
    }
    return rows.sort((a, b) => b.updated - a.updated);
  }

  async saveBundle(
    bundle: CampaignBundle,
    writerSessionId: string,
    lastKnownUpdated = 0
  ): Promise<SaveOutcome> {
    const existing = this.campaigns.get(bundle.campaign.id);
    if (
      existing &&
      lastKnownUpdated > 0 &&
      existing.writer &&
      existing.writer !== writerSessionId &&
      existing.updated > lastKnownUpdated
    ) {
      return { updated: existing.updated, conflict: true };
    }
    const now = Date.now();
    const rec = serializeBundleForStore(bundle, writerSessionId, now);
    this.campaigns.set(rec.id, rec);
    bundle.campaign.updated = now;
    bundle.campaign.writer = writerSessionId;
    bundle.dirty = emptyDirty();
    return { updated: now, conflict: false };
  }

  async loadBundle(campaignId: string, writerSessionId: string): Promise<CampaignBundle | null> {
    const rec = this.campaigns.get(campaignId);
    if (!rec) return null;
    return hydrateSerializedRecord(rec, writerSessionId);
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    this.campaigns.delete(campaignId);
  }

  async putBlob(blobId: string, blob: Blob): Promise<void> {
    this.blobs.set(blobId, blob);
  }

  async getBlob(blobId: string): Promise<Blob | null> {
    return this.blobs.get(blobId) ?? null;
  }

  async deleteBlob(blobId: string): Promise<void> {
    this.blobs.delete(blobId);
  }

  async getSetting<T = any>(key: string): Promise<T | null> {
    return this.settings.has(key) ? clone(this.settings.get(key)) : null;
  }

  async setSetting<T = any>(key: string, value: T): Promise<void> {
    this.settings.set(key, clone(value));
  }
}
