/* Browser IndexedDB GameStore (`solotales_db_v1`).
   Stores campaigns, binary WebP/SVG portrait blobs, and settings in isolated object stores. */

import { emptyDirty, type CampaignBundle } from "../../engine";
import {
  buildIndexRow,
  hydrateSerializedRecord,
  serializeBundleForStore,
  type CampaignIndexRow,
  type GameStore,
  type SaveOutcome,
  type SerializedCampaignRecord
} from "./store";

const DB_NAME = "solotales_db_v1";
const DB_VERSION = 1;

interface StoredBlobEntry {
  id: string;
  mime: string;
  bytes: ArrayBuffer;
  updated: number;
}

export class IndexedDBGameStore implements GameStore {
  readonly kind = "indexeddb" as const;
  readonly persistent = true;
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (typeof indexedDB === "undefined") {
      throw new Error("IndexedDB is not available in this environment.");
    }
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("campaigns")) {
          db.createObjectStore("campaigns", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("blobs")) {
          db.createObjectStore("blobs", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB"));
    });
  }

  private ensureDb(): IDBDatabase {
    if (!this.db) throw new Error("IndexedDBGameStore not initialized.");
    return this.db;
  }

  async listCampaigns(): Promise<CampaignIndexRow[]> {
    const db = this.ensureDb();
    const records = await new Promise<SerializedCampaignRecord[]>((resolve, reject) => {
      const tx = db.transaction("campaigns", "readonly");
      const req = tx.objectStore("campaigns").getAll();
      req.onsuccess = () => resolve((req.result as SerializedCampaignRecord[]) || []);
      req.onerror = () => reject(req.error);
    });
    return records
      .filter(r => r && r.campaign)
      .map(r => buildIndexRow(r.campaign))
      .sort((a, b) => b.updated - a.updated);
  }

  async saveBundle(
    bundle: CampaignBundle,
    writerSessionId: string,
    lastKnownUpdated = 0
  ): Promise<SaveOutcome> {
    const db = this.ensureDb();
    const existing = await new Promise<SerializedCampaignRecord | undefined>((resolve, reject) => {
      const tx = db.transaction("campaigns", "readonly");
      const req = tx.objectStore("campaigns").get(bundle.campaign.id);
      req.onsuccess = () => resolve(req.result as SerializedCampaignRecord | undefined);
      req.onerror = () => reject(req.error);
    });

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

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("campaigns", "readwrite");
      tx.objectStore("campaigns").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    bundle.campaign.updated = now;
    bundle.campaign.writer = writerSessionId;
    bundle.dirty = emptyDirty();
    return { updated: now, conflict: false };
  }

  async loadBundle(campaignId: string, writerSessionId: string): Promise<CampaignBundle | null> {
    const db = this.ensureDb();
    const rec = await new Promise<SerializedCampaignRecord | undefined>((resolve, reject) => {
      const tx = db.transaction("campaigns", "readonly");
      const req = tx.objectStore("campaigns").get(campaignId);
      req.onsuccess = () => resolve(req.result as SerializedCampaignRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!rec) return null;
    return hydrateSerializedRecord(rec, writerSessionId);
  }

  async deleteCampaign(campaignId: string): Promise<void> {
    const db = this.ensureDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("campaigns", "readwrite");
      tx.objectStore("campaigns").delete(campaignId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async putBlob(blobId: string, blob: Blob): Promise<void> {
    const db = this.ensureDb();
    const bytes = await blob.arrayBuffer();
    const entry: StoredBlobEntry = {
      id: blobId,
      mime: blob.type || "image/webp",
      bytes,
      updated: Date.now()
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("blobs", "readwrite");
      tx.objectStore("blobs").put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getBlob(blobId: string): Promise<Blob | null> {
    const db = this.ensureDb();
    const entry = await new Promise<StoredBlobEntry | undefined>((resolve, reject) => {
      const tx = db.transaction("blobs", "readonly");
      const req = tx.objectStore("blobs").get(blobId);
      req.onsuccess = () => resolve(req.result as StoredBlobEntry | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!entry || !entry.bytes) return null;
    return new Blob([entry.bytes], { type: entry.mime || "image/webp" });
  }

  async deleteBlob(blobId: string): Promise<void> {
    const db = this.ensureDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("blobs", "readwrite");
      tx.objectStore("blobs").delete(blobId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getSetting<T = any>(key: string): Promise<T | null> {
    const db = this.ensureDb();
    const row = await new Promise<{ key: string; value: T } | undefined>((resolve, reject) => {
      const tx = db.transaction("settings", "readonly");
      const req = tx.objectStore("settings").get(key);
      req.onsuccess = () => resolve(req.result as { key: string; value: T } | undefined);
      req.onerror = () => reject(req.error);
    });
    return row ? row.value : null;
  }

  async setSetting<T = any>(key: string, value: T): Promise<void> {
    const db = this.ensureDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("settings", "readwrite");
      tx.objectStore("settings").put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
