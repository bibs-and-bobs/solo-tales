/* Public barrel & platform-auto-detecting factory for Solo Tales persistence. */

import { IndexedDBGameStore } from "./indexeddb-store";
import { MemoryGameStore, type GameStore } from "./store";
import { isTauriDesktop, TauriDesktopStore } from "./tauri-fs-store";

export * from "./store";
export * from "./indexeddb-store";
export * from "./tauri-fs-store";
export * from "./keyring";
export * from "./bundle-io";

export async function createPlatformGameStore(): Promise<GameStore> {
  if (isTauriDesktop()) {
    const tauriStore = new TauriDesktopStore();
    try {
      await tauriStore.init();
      return tauriStore;
    } catch {
      // fall through
    }
  }
  if (typeof indexedDB !== "undefined") {
    const idb = new IndexedDBGameStore();
    try {
      await idb.init();
      return idb;
    } catch {
      // fall through to memory store (e.g. locked-down private browsing)
    }
  }
  const mem = new MemoryGameStore();
  await mem.init();
  return mem;
}
