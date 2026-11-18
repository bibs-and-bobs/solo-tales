/* Multi-theme type contracts for Solo Tales UI. */

export type ThemeId = "broadsheet" | "obsidian" | "minimalist";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tagline: string;
  mode: "light" | "dark";
  swatches: [string, string, string, string];
}
