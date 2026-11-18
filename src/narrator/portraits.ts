/* Campaign-Flavour-Linked Portrait Composer, Deterministic SVG Heraldic Fallback,
   and WebP Blob Compressor.
   Decouples UI aesthetic (`ThemeArtProfile`) from campaign flavour (`CampaignArtBrief`)
   and character traits (`SubjectSpec`) so a future UI overhaul only swaps `ThemeArtProfile`. */

import { cleanArtBrief, str, type CampaignArtBrief, type PortraitStylePreset } from "../engine";

export interface ThemeArtProfile {
  id: string;
  label: string;
  frameTone: string;
  compositionRule: string;
  lightingBias: string;
  negativePrompt: string;
}

/** Pluggable UI theme art hook — swap this single object when redesigning the UI later! */
export const DEFAULT_THEME_ART_PROFILE: Readonly<ThemeArtProfile> = Object.freeze({
  id: "candlelit_parchment_v1",
  label: "Candlelit Tabletop Chronicle",
  frameTone: "warm dark vignette background suitable for a brass-trimmed circular or portrait frame",
  compositionRule:
    "head-and-shoulders three-quarter tabletop RPG character portrait, centered face, clear silhouette, expressive eyes",
  lightingBias: "rich grounded contrast, natural skin and cloth texture, cohesive dark backdrop",
  negativePrompt:
    "text, watermark, signature, UI frame, border, speech bubble, modern clothing, sci-fi neon, multiple heads, deformed hands, blurry, photorealistic selfie"
});

export const STYLE_PRESET_DIRECTIVES: Readonly<Record<PortraitStylePreset, string>> = Object.freeze({
  painterly:
    "hand-painted oil and gouache tabletop RPG character illustration with visible brushwork",
  ink_parchment:
    "fine crosshatched ink-and-sepia illustration with muted watercolour wash on aged vellum",
  dark_woodcut:
    "dramatic chiaroscuro woodcut and charcoal engraving with bold ink shadows and gold-ochre accents",
  custom: "cohesive stylized tabletop RPG character portrait"
});

export interface SubjectSpec {
  kind: "hero" | "npc";
  name: string;
  species?: string;
  cls?: string;
  role?: string;
  appearance?: string;
  equippedSummary?: string;
  attitude?: "friendly" | "neutral" | "hostile";
}

export interface ComposedPortraitPrompt {
  prompt: string;
  negativePrompt: string;
  stylePreset: PortraitStylePreset;
}

export function composePortraitPrompt(
  themeProfile: ThemeArtProfile,
  artBrief: CampaignArtBrief | null | undefined,
  subject: SubjectSpec,
  styleOverride?: PortraitStylePreset,
  customStyleNote?: string
): ComposedPortraitPrompt {
  const brief = cleanArtBrief(artBrief || {})!;
  const preset = styleOverride || brief.stylePreset || "painterly";
  const presetDesc =
    preset === "custom" && (customStyleNote || brief.customStyleNote)
      ? str(customStyleNote || brief.customStyleNote, 200)
      : STYLE_PRESET_DIRECTIVES[preset];

  const identityParts = [
    subject.species ? str(subject.species, 30) : "",
    subject.cls ? str(subject.cls, 30) : "",
    subject.role ? str(subject.role, 60) : ""
  ].filter(Boolean);

  const demeanour =
    subject.attitude === "hostile"
      ? "guarded, sharp-eyed expression"
      : subject.attitude === "friendly"
      ? "warm, approachable expression"
      : "composed, observant expression";

  const segments = [
    `${presetDesc}.`,
    `Subject: ${str(subject.name, 40)}${identityParts.length ? `, a ${identityParts.join(" ")}` : ""}.`,
    subject.appearance ? `Appearance: ${str(subject.appearance, 220)}.` : "",
    subject.equippedSummary ? `Visible gear: ${str(subject.equippedSummary, 140)}.` : "",
    `Attire & world aesthetic: ${brief.attireStyle}; ${brief.medium}.`,
    `Palette & lighting: ${brief.palette}; ${brief.lighting}; ${themeProfile.lightingBias}.`,
    `Mood: ${brief.moodKeywords}, ${demeanour}.`,
    `Composition: ${themeProfile.compositionRule}, ${themeProfile.frameTone}. No text or borders.`
  ].filter(Boolean);

  return {
    prompt: segments.join(" "),
    negativePrompt: themeProfile.negativePrompt,
    stylePreset: preset
  };
}

function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function initialsOf(name: string): string {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const CREST_PALETTES: ReadonlyArray<[string, string, string]> = [
  ["#1b2a25", "#0f1815", "#d9b25c"], // Frontier forest & gold
  ["#281a24", "#120c12", "#d89a7e"], // Gothic wine & rose-brass
  ["#162834", "#0c151d", "#7ec4cf"], // Maritime slate & seafoam
  ["#2b2218", "#15100b", "#e3be6b"], // Parchment umber & gilt
  ["#1d2633", "#0e131b", "#b8c7e0"]  // Star-vault indigo & silver
];

/** Deterministic zero-API SVG heraldic portrait crest & monogram fallback. */
export function generateHeraldicSvg(
  subject: SubjectSpec,
  artBrief?: CampaignArtBrief | null
): string {
  const seed = hashString(`${subject.name}:${subject.cls || subject.role || ""}:${artBrief?.palette || ""}`);
  const [bgTop, bgBot, accent] = CREST_PALETTES[seed % CREST_PALETTES.length];
  const init = escapeXml(initialsOf(subject.name));
  const subLabel = escapeXml(
    str(subject.cls || subject.role || subject.species || "", 18).toUpperCase()
  );

  // Subtle geometric emblem behind monogram based on seed
  const motifIdx = seed % 3;
  const motifSvg =
    motifIdx === 0
      ? `<polygon points="128,26 214,128 128,230 42,128" fill="none" stroke="${accent}" stroke-opacity="0.24" stroke-width="3"/>`
      : motifIdx === 1
      ? `<circle cx="128" cy="128" r="88" fill="none" stroke="${accent}" stroke-opacity="0.25" stroke-width="3" stroke-dasharray="10 6"/>`
      : `<path d="M64 56 L192 56 L192 142 C192 188 128 220 128 220 C128 220 64 188 64 142 Z" fill="none" stroke="${accent}" stroke-opacity="0.26" stroke-width="3"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="${escapeXml(
    subject.name
  )}">
  <defs>
    <radialGradient id="g_${seed % 9999}" cx="50%" cy="35%" r="70%">
      <stop offset="0%" stop-color="${bgTop}"/>
      <stop offset="100%" stop-color="${bgBot}"/>
    </radialGradient>
  </defs>
  <rect width="256" height="256" rx="28" fill="url(#g_${seed % 9999})"/>
  <rect x="10" y="10" width="236" height="236" rx="22" fill="none" stroke="${accent}" stroke-opacity="0.45" stroke-width="2"/>
  ${motifSvg}
  <text x="128" y="142" text-anchor="middle" fill="${accent}" font-family="Georgia, 'Times New Roman', serif" font-size="76" font-weight="600" letter-spacing="2">${init}</text>
  ${
    subLabel
      ? `<text x="128" y="206" text-anchor="middle" fill="${accent}" fill-opacity="0.72" font-family="system-ui, sans-serif" font-size="13" letter-spacing="2.5">${subLabel}</text>`
      : ""
  }
</svg>`;
}

export function svgToBlob(svg: string): Blob {
  return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
}

export function svgToDataUrl(svg: string): string {
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/"/g, "%22");
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

export function base64ToBlob(b64: string, mimeType = "image/png"): Blob {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function blobToBase64DataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(fr.error || new Error("Failed to read blob"));
      fr.readAsDataURL(blob);
    });
  }
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(bin)}`;
}

/** Resizes & compresses a raster image Blob into a compact square WebP Blob (falls back cleanly in headless test environments). */
export async function compressToWebpBlob(
  source: Blob,
  maxDim = 512,
  quality = 0.84
): Promise<Blob> {
  if (source.type.includes("svg")) return source;
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return source;
  }

  let objectUrl = "";
  try {
    objectUrl = URL.createObjectURL(source);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Image decode unsupported in current environment"));
      el.src = objectUrl;
    });

    const w = img.naturalWidth || maxDim;
    const h = img.naturalHeight || maxDim;
    const side = Math.min(w, h);
    const sx = Math.floor((w - side) / 2);
    const sy = Math.floor((h - side) / 2);
    const outSide = Math.min(maxDim, side || maxDim);

    const canvas = document.createElement("canvas");
    canvas.width = outSide;
    canvas.height = outSide;
    const ctx = canvas.getContext("2d");
    if (!ctx) return source;

    ctx.drawImage(img, sx, sy, side, side, 0, 0, outSide, outSide);

    const outBlob = await new Promise<Blob | null>(resolve => {
      if (typeof canvas.toBlob !== "function") {
        resolve(null);
        return;
      }
      canvas.toBlob(b => resolve(b), "image/webp", quality);
    });

    return outBlob && outBlob.size > 0 ? outBlob : source;
  } catch {
    return source;
  } finally {
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        // ignore
      }
    }
  }
}
