/* Theme registry and persistence for Solo Tales. */

import type { ThemeDefinition, ThemeId } from "./types";

export const THEME_STORAGE_KEY = "solotales.theme";
export const DEFAULT_THEME_ID: ThemeId = "broadsheet";

export const THEMES: ReadonlyArray<ThemeDefinition> = [
  {
    id: "broadsheet",
    name: "Illuminated Broadsheet",
    tagline: "Warm parchment, blue pen, Fraunces display, and living time-of-day skies.",
    mode: "light",
    swatches: ["#1a1838", "#f1e7d0", "#2b4a9b", "#dcae4a"]
  },
  {
    id: "obsidian",
    name: "Obsidian Grimoire",
    tagline: "Dark slate pages, bone ink, amber leaf, and crimson danger.",
    mode: "dark",
    swatches: ["#0d0e14", "#1b1d28", "#e0a952", "#d9534f"]
  },
  {
    id: "minimalist",
    name: "Minimalist Ink",
    tagline: "Crisp daylight rag paper, charcoal rules, and quiet restraint.",
    mode: "light",
    swatches: ["#eceae4", "#faf8f4", "#1d4ed8", "#b91c1c"]
  }
];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && THEMES.some(t => t.id === value);
}

export function getThemeDefinition(id: ThemeId): ThemeDefinition {
  return THEMES.find(t => t.id === id) || THEMES[0];
}

export function getActiveThemeId(): ThemeId {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(THEME_STORAGE_KEY) : null;
    return isThemeId(raw) ? raw : DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

export function applyTheme(id: ThemeId): ThemeId {
  const valid = isThemeId(id) ? id : DEFAULT_THEME_ID;
  if (typeof document !== "undefined" && document.documentElement) {
    document.documentElement.dataset.theme = valid;
  }
  return valid;
}

export function setActiveThemeId(id: ThemeId): ThemeId {
  const valid = applyTheme(id);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(THEME_STORAGE_KEY, valid);
    }
  } catch {
    // ignore storage quota / private mode errors
  }
  return valid;
}
