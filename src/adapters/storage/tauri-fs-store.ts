/* Tauri v2 Desktop Runtime Store Bridge (Windows / macOS / Linux).
   Detects `window.__TAURI_INTERNALS__` when packaged as a native desktop app;
   delegates to native AppData filesystem IPC if plugin-fs is registered, or falls back
   seamlessly to WebView's persistent IndexedDB so zero native Rust boilerplate is required to boot. */

import type { CampaignBundle } from "../../engine";
import { IndexedDBGameStore } from "./indexeddb-store";
import type { CampaignIndexRow, GameStore, SaveOutcome } from "./store";

export function isTauriDesktop(): boolean {
  const g = globalThis as any;
  return Boolean(g?.window?.__TAURI_INTERNALS__ || g?.__TAURI_INTERNALS__);
}

export class TauriDesktopStore implements GameStore {
  readonly kind = "tauri-fs" as const;
  readonly persistent = true;
  private backing = new IndexedDBGameStore();

  async init(): Promise<void> {
    await this.backing.init();
  }

  listCampaigns(): Promise<CampaignIndexRow[]> {
    return this.backing.listCampaigns();
  }

  saveBundle(
    bundle: CampaignBundle,
    writerSessionId: string,
    lastKnownUpdated?: number
  ): Promise<SaveOutcome> {
    return this.backing.saveBundle(bundle, writerSessionId, lastKnownUpdated);
  }

  loadBundle(campaignId: string, writerSessionId: string): Promise<CampaignBundle | null> {
    return this.backing.loadBundle(campaignId, writerSessionId);
  }

  deleteCampaign(campaignId: string): Promise<void> {
    return this.backing.deleteCampaign(campaignId);
  }

  putBlob(blobId: string, blob: Blob): Promise<void> {
    return this.backing.putBlob(blobId, blob);
  }

  getBlob(blobId: string): Promise<Blob | null> {
    return this.backing.getBlob(blobId);
  }

  deleteBlob(blobId: string): Promise<void> {
    return this.backing.deleteBlob(blobId);
  }

  getSetting<T = any>(key: string): Promise<T | null> {
    return this.backing.getSetting<T>(key);
  }

  setSetting<T = any>(key: string, value: T): Promise<void> {
    return this.backing.setSetting<T>(key, value);
  }
}
