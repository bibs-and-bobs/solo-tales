/* Portable `.solotales.json` Campaign Bundle Exporter & Importer.
   Packs CampaignBundle state + embedded WebP/SVG portrait blobs into a single portable file
   movable between Web Browser and PC Desktop builds, while guaranteeing ZERO API keys leak. */

import { isObj, rid, slug, type CampaignBundle } from "../../engine";
import { base64ToBlob, blobToBase64DataUrl } from "../../narrator/portraits";
import {
  hydrateSerializedRecord,
  serializeBundleForStore,
  type GameStore
} from "./store";

export const PORTABLE_FORMAT_MAGIC = "solotales.campaign.bundle";
export const PORTABLE_FORMAT_VERSION = 1;

export interface PortableCampaignArchive {
  format: typeof PORTABLE_FORMAT_MAGIC;
  formatVersion: number;
  exportedAt: string;
  record: ReturnType<typeof serializeBundleForStore>;
  portraits: Record<string, string>;
}

export function collectBundlePortraitIds(bundle: CampaignBundle): string[] {
  const ids = new Set<string>();
  if (bundle.campaign.char.portraitId) {
    ids.add(bundle.campaign.char.portraitId);
  }
  for (const ent of Object.values(bundle.entities)) {
    if (ent.portraitId) ids.add(ent.portraitId);
  }
  return [...ids];
}

export async function exportCampaignArchive(
  bundle: CampaignBundle,
  getBlob: (blobId: string) => Promise<Blob | null>
): Promise<{ filename: string; json: string; archive: PortableCampaignArchive }> {
  const record = serializeBundleForStore(bundle, "export", bundle.campaign.updated);
  const portraitIds = collectBundlePortraitIds(bundle);
  const portraits: Record<string, string> = {};

  for (const pid of portraitIds) {
    const blob = await getBlob(pid);
    if (blob) {
      portraits[pid] = await blobToBase64DataUrl(blob);
    }
  }

  const archive: PortableCampaignArchive = {
    format: PORTABLE_FORMAT_MAGIC,
    formatVersion: PORTABLE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    record,
    portraits
  };

  const json = JSON.stringify(archive, null, 2);
  const safeSlug = slug(bundle.campaign.name || "campaign");
  return {
    filename: `${safeSlug}.solotales.json`,
    json,
    archive
  };
}

function parseDataUrlToBlob(dataUrl: string): Blob | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;
  if (dataUrl.startsWith("data:image/svg+xml;charset=utf-8,")) {
    const svg = decodeURIComponent(dataUrl.slice("data:image/svg+xml;charset=utf-8,".length));
    return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  }
  const m = dataUrl.match(/^data:([^,]+?);base64,(.+)$/);
  if (!m) return null;
  return base64ToBlob(m[2], m[1]);
}

export async function importCampaignArchive(
  rawJson: string,
  store: GameStore,
  writerSessionId: string,
  opts?: { assignNewIdIfExists?: boolean }
): Promise<CampaignBundle> {
  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("That file is not valid JSON.");
  }

  if (!isObj(parsed)) {
    throw new Error("Unrecognized campaign archive.");
  }

  const rawRecord =
    parsed.format === PORTABLE_FORMAT_MAGIC && isObj(parsed.record) ? parsed.record : parsed;

  const bundle = hydrateSerializedRecord(rawRecord, writerSessionId);
  if (!bundle) {
    throw new Error("Campaign archive could not be read or failed schema validation.");
  }

  if (opts?.assignNewIdIfExists !== false) {
    const existing = await store.loadBundle(bundle.campaign.id, writerSessionId);
    if (existing) {
      bundle.campaign.id = rid();
      bundle.campaign.name = `${bundle.campaign.name} (Imported)`.slice(0, 40);
    }
  }

  // Restore embedded portrait blobs
  if (isObj(parsed.portraits)) {
    for (const [pid, dataUrl] of Object.entries(parsed.portraits)) {
      if (typeof dataUrl !== "string") continue;
      const blob = parseDataUrlToBlob(dataUrl);
      if (blob) {
        await store.putBlob(pid, blob);
      }
    }
  }

  await store.saveBundle(bundle, writerSessionId, 0);
  return bundle;
}
