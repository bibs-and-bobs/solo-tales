/* Lightweight DOM construction helpers & Portrait Object-URL Cache.
   Zero framework lock-in so the UI layer can be freely restyled or replaced later. */

import type { GameStore } from "../adapters/storage";

export type DomChild = Node | string | number | boolean | null | undefined | DomChild[];

export function $<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document
): T | null {
  return root.querySelector<T>(selector);
}

export function put(node: Element, ...kids: DomChild[]): void {
  const flat: (Node | string)[] = [];
  const collect = (item: DomChild): void => {
    if (item == null || item === false || item === true) return;
    if (Array.isArray(item)) {
      for (const sub of item) collect(sub);
    } else if (item instanceof Node) {
      flat.push(item);
    } else {
      flat.push(String(item));
    }
  };
  for (const k of kids) collect(k);
  node.replaceChildren(...flat);
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, any> | null,
  ...kids: DomChild[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") {
        e.className = String(v);
      } else if (k === "text") {
        e.textContent = String(v);
      } else if (k.startsWith("on") && typeof v === "function") {
        e.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === "checked" && "checked" in e) {
        (e as unknown as HTMLInputElement).checked = Boolean(v);
      } else if (k === "disabled" && "disabled" in e) {
        (e as unknown as HTMLButtonElement).disabled = Boolean(v);
      } else if (k === "selected" && "selected" in e) {
        (e as unknown as HTMLOptionElement).selected = Boolean(v);
      } else if (k === "value" && "value" in e && tag !== "option") {
        (e as unknown as HTMLInputElement).value = String(v);
      } else if (k === "hidden") {
        e.hidden = Boolean(v);
      } else {
        e.setAttribute(k, v === true ? "" : String(v));
      }
    }
  }
  const appendKid = (item: DomChild): void => {
    if (item == null || item === false || item === true) return;
    if (Array.isArray(item)) {
      for (const sub of item) appendKid(sub);
    } else if (item instanceof Node) {
      e.append(item);
    } else {
      e.append(document.createTextNode(String(item)));
    }
  };
  for (const k of kids) appendKid(k);
  return e;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string): void {
  $("#toast")?.remove();
  document.body.append(el("div", { class: "toast", id: "toast", role: "status", text: msg }));
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast")?.remove(), 8000);
}

export function triggerJsonDownload(filename: string, jsonContent: string): void {
  const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Lazily loads & caches Object URLs for portrait blobs stored in GameStore. */
export class PortraitUrlCache {
  private urls = new Map<string, string>();
  private loading = new Set<string>();

  getUrl(blobId: string | null | undefined, store: GameStore, onLoaded?: () => void): string | null {
    if (!blobId) return null;
    const cached = this.urls.get(blobId);
    if (cached) return cached;
    if (!this.loading.has(blobId)) {
      this.loading.add(blobId);
      store
        .getBlob(blobId)
        .then(blob => {
          this.loading.delete(blobId);
          if (blob) {
            const url = URL.createObjectURL(blob);
            this.urls.set(blobId, url);
            onLoaded?.();
          }
        })
        .catch(() => {
          this.loading.delete(blobId);
        });
    }
    return null;
  }

  putBlobUrl(blobId: string, blob: Blob): string {
    const old = this.urls.get(blobId);
    if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(blob);
    this.urls.set(blobId, url);
    return url;
  }

  clear(): void {
    for (const url of this.urls.values()) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
    this.loading.clear();
  }
}

export function renderAvatarNode(opts: {
  name: string;
  portraitUrl: string | null;
  className?: string;
  sizePx?: number;
}): HTMLElement {
  const initial = (opts.name.trim()[0] || "?").toUpperCase();
  const cls = opts.className || "av";
  const style = opts.sizePx ? `width: ${opts.sizePx}px; height: ${opts.sizePx}px;` : undefined;
  if (opts.portraitUrl) {
    return el(
      "span",
      { class: cls + " has-img", style, "aria-hidden": "true" },
      el("img", { src: opts.portraitUrl, alt: opts.name })
    );
  }
  return el("span", { class: cls, style, "aria-hidden": "true", text: initial });
}
