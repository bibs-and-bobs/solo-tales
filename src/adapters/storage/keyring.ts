/* BYOK Keyring & Connection Pool Persistence.
   Keeps API keys and provider configurations strictly isolated in local device settings
   (NEVER inside CampaignBundle or exported `.solotales.json` save files),
   with optional WebCrypto AES-GCM passphrase encryption for shared machines. */

import {
  DEFAULT_IMAGE_CONFIG,
  type ImageEndpointConfig
} from "../image/image-router";
import {
  DEFAULT_ROUTING_CONFIG,
  type ConnectionPreset,
  type ModelConnection,
  type RoutingConfig
} from "../llm/types";
import { clone, isObj, rid } from "../../engine";
import type { GameStore } from "./store";

const SETTINGS_KEY_POOL = "llm_pool_v1";
const SETTINGS_KEY_SECRETS = "llm_secrets_v1";

interface StoredPoolConfig {
  connections: ModelConnection[];
  routing: RoutingConfig;
  image: ImageEndpointConfig;
}

interface StoredSecretsPayload {
  encrypted: boolean;
  saltB64?: string;
  ivB64?: string;
  cipherB64?: string;
  plain?: Record<string, string>;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100_000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export class KeyringManager {
  private store: GameStore;
  private connections: ModelConnection[] = [];
  private routing: RoutingConfig = clone(DEFAULT_ROUTING_CONFIG);
  private imageConfig: ImageEndpointConfig = clone(DEFAULT_IMAGE_CONFIG);
  private secrets = new Map<string, string>();
  private locked = false;
  private passphrase: string | null = null;

  constructor(store: GameStore) {
    this.store = store;
  }

  async load(): Promise<void> {
    const cfg = await this.store.getSetting<StoredPoolConfig>(SETTINGS_KEY_POOL);
    if (isObj(cfg)) {
      if (Array.isArray(cfg.connections)) {
        this.connections = cfg.connections.filter(isObj) as ModelConnection[];
      }
      if (isObj(cfg.routing)) {
        this.routing = { ...DEFAULT_ROUTING_CONFIG, ...cfg.routing };
      }
      if (isObj(cfg.image)) {
        this.imageConfig = { ...DEFAULT_IMAGE_CONFIG, ...cfg.image };
      }
    }

    const sec = await this.store.getSetting<StoredSecretsPayload>(SETTINGS_KEY_SECRETS);
    if (isObj(sec)) {
      if (sec.encrypted) {
        this.locked = true;
      } else if (isObj(sec.plain)) {
        this.locked = false;
        for (const [k, v] of Object.entries(sec.plain)) {
          if (typeof v === "string") this.secrets.set(k, v);
        }
      }
    }
  }

  isLocked(): boolean {
    return this.locked;
  }

  async unlockWithPassphrase(passphrase: string): Promise<boolean> {
    const sec = await this.store.getSetting<StoredSecretsPayload>(SETTINGS_KEY_SECRETS);
    if (!isObj(sec) || !sec.encrypted || !sec.saltB64 || !sec.ivB64 || !sec.cipherB64) {
      this.locked = false;
      return true;
    }
    try {
      const key = await deriveKey(passphrase, b64ToBytes(sec.saltB64));
      const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: b64ToBytes(sec.ivB64) as BufferSource },
        key,
        b64ToBytes(sec.cipherB64) as BufferSource
      );
      const parsed = JSON.parse(new TextDecoder().decode(decrypted));
      this.secrets.clear();
      if (isObj(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") this.secrets.set(k, v);
        }
      }
      this.passphrase = passphrase;
      this.locked = false;
      return true;
    } catch {
      return false;
    }
  }

  async setEncryptionPassphrase(passphrase: string | null): Promise<void> {
    this.passphrase = passphrase && passphrase.trim() ? passphrase.trim() : null;
    this.locked = false;
    await this.persistSecrets();
  }

  getConnections(): ModelConnection[] {
    return clone(this.connections);
  }

  getRoutingConfig(): RoutingConfig {
    return clone(this.routing);
  }

  getImageConfig(): ImageEndpointConfig {
    return clone(this.imageConfig);
  }

  resolveApiKey = (apiKeyRef: string): string => {
    if (!apiKeyRef) return "";
    return this.secrets.get(apiKeyRef) ?? "";
  };

  hasSecret(apiKeyRef: string): boolean {
    return Boolean(apiKeyRef && (this.secrets.get(apiKeyRef) || "").length > 0);
  }

  async addFromPreset(preset: ConnectionPreset, apiKey: string): Promise<ModelConnection> {
    const id = "conn_" + rid();
    const apiKeyRef = "key_" + id;
    const conn: ModelConnection = {
      id,
      label: preset.label,
      provider: preset.provider,
      baseUrl: preset.baseUrl,
      model: preset.model,
      apiKeyRef,
      enabled: true,
      capabilities: clone(preset.capabilities),
      limits: clone(preset.limits)
    };
    if (apiKey.trim()) {
      this.secrets.set(apiKeyRef, apiKey.trim());
    }
    this.connections.push(conn);
    await this.persistAll();
    return clone(conn);
  }

  async upsertConnection(conn: ModelConnection, newApiKey?: string): Promise<void> {
    const ref = conn.apiKeyRef || `key_${conn.id}`;
    const updated: ModelConnection = { ...clone(conn), apiKeyRef: ref };
    const idx = this.connections.findIndex(c => c.id === updated.id);
    if (idx >= 0) this.connections[idx] = updated;
    else this.connections.push(updated);

    if (newApiKey !== undefined) {
      if (newApiKey.trim()) this.secrets.set(ref, newApiKey.trim());
      else this.secrets.delete(ref);
    }
    await this.persistAll();
  }

  async removeConnection(connectionId: string): Promise<void> {
    const existing = this.connections.find(c => c.id === connectionId);
    this.connections = this.connections.filter(c => c.id !== connectionId);
    if (existing?.apiKeyRef) {
      this.secrets.delete(existing.apiKeyRef);
    }
    for (const [task, pinnedId] of Object.entries(this.routing.pins)) {
      if (pinnedId === connectionId) {
        delete this.routing.pins[task as keyof RoutingConfig["pins"]];
      }
    }
    await this.persistAll();
  }

  async updateRoutingConfig(patch: Partial<RoutingConfig>): Promise<void> {
    this.routing = {
      ...this.routing,
      ...patch,
      pins: patch.pins ? { ...patch.pins } : this.routing.pins
    };
    await this.persistPool();
  }

  async updateImageConfig(patch: Partial<ImageEndpointConfig>, newApiKey?: string): Promise<void> {
    const apiKeyRef = this.imageConfig.apiKeyRef || "key_dedicated_image";
    this.imageConfig = { ...this.imageConfig, ...patch, apiKeyRef };
    if (newApiKey !== undefined) {
      if (newApiKey.trim()) this.secrets.set(apiKeyRef, newApiKey.trim());
      else this.secrets.delete(apiKeyRef);
    }
    await this.persistAll();
  }

  private async persistPool(): Promise<void> {
    await this.store.setSetting<StoredPoolConfig>(SETTINGS_KEY_POOL, {
      connections: this.connections,
      routing: this.routing,
      image: this.imageConfig
    });
  }

  private async persistSecrets(): Promise<void> {
    const plainObj: Record<string, string> = {};
    for (const [k, v] of this.secrets.entries()) {
      plainObj[k] = v;
    }

    if (this.passphrase && typeof crypto !== "undefined" && crypto.subtle) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await deriveKey(this.passphrase, salt);
      const cipher = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv as BufferSource },
        key,
        new TextEncoder().encode(JSON.stringify(plainObj))
      );
      await this.store.setSetting<StoredSecretsPayload>(SETTINGS_KEY_SECRETS, {
        encrypted: true,
        saltB64: bytesToB64(salt),
        ivB64: bytesToB64(iv),
        cipherB64: bytesToB64(new Uint8Array(cipher))
      });
      return;
    }

    await this.store.setSetting<StoredSecretsPayload>(SETTINGS_KEY_SECRETS, {
      encrypted: false,
      plain: plainObj
    });
  }

  private async persistAll(): Promise<void> {
    await Promise.all([this.persistPool(), this.persistSecrets()]);
  }
}
