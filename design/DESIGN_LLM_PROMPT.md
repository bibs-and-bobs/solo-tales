# Design LLM Prompt — Create a New Solo Tales Theme

Copy and paste the prompt below to any design LLM alongside `design/DESIGN_SYSTEM_CONTRACT.md`, replacing `[DESCRIBE YOUR DESIRED AESTHETIC]` with your target look (e.g., *"Sun-bleached desert parchment with lapis lazuli ink and beaten copper trim"* or *"Rain-soaked 1920s noir dossier on typewriter bond paper"*).

---

```text
You are designing a complete drop-in visual theme for Solo Tales, a solo tabletop RPG web application.

Read the attached `DESIGN_SYSTEM_CONTRACT.md` carefully. Every stage, slot, state attribute, and `--st-*` CSS custom property listed in that contract is already wired to live TypeScript DOM elements.

Target aesthetic:
[DESCRIBE YOUR DESIRED AESTHETIC]

Theme ID (lowercase, no spaces): [THEME_ID]
Display Name: [THEME_NAME]
One-line Tagline: [THEME_TAGLINE]

Deliverables:
1. A complete CSS file `src/ui/themes/[THEME_ID].css` scoped to `:root[data-theme="[THEME_ID]"]` that defines ALL `--st-*` custom properties:
   - Typography (`--st-font-display`, `--st-font-narr`, `--st-font-ui`, `--st-font-hand`) — use Google Fonts or system stacks with reliable fallbacks.
   - Paper & ink (`--st-paper`, `--st-paper-elevated`, `--st-paper-tab`, `--st-paper-tab-hover`, `--st-paper-row-hover`, `--st-paper-row-active`, `--st-paper-edge`, `--st-ink`, `--st-ink-muted`, `--st-rule`, `--st-rule-light`, `--st-rule-soft`).
   - Semantic accents (`--st-accent-player`, `--st-accent-player-hover`, `--st-accent-player-ink`, `--st-accent-foe`, `--st-accent-friend`, `--st-accent-gold`).
   - Blueprint map (`--st-map-ink`, `--st-map-ink-deep`, `--st-map-paper`).
   - Rails & cover (`--st-rail-bg`, `--st-rail-ink`, `--st-rail-ink-bright`, `--st-rail-ink-muted`, `--st-rail-border`, `--st-rail-border-strong`, `--st-rail-gold`, `--st-rail-hp`, `--st-rail-foe`, `--st-rail-friend`, `--st-rail-player`, `--st-cover-bg`, `--st-cover-ink`).
   - Geometry & shadows (`--st-radius-sm`, `--st-radius-md`, `--st-page-shadow`, `--st-spread-shadow`).
   - Time-of-day sky overrides for `[data-theme="[THEME_ID]"] [data-stage="story"][data-time="dawn" | "day" | "dusk" | "night"]` and combat sky `[data-theme="[THEME_ID]"] [data-stage="fight"]`.
   - Any optional stage/slot flourishes scoped strictly under `[data-theme="[THEME_ID]"]`.
2. A TypeScript entry to add to `THEMES` in `src/ui/themes/registry.ts` (including 4 hex `swatches: [railBg, paper, accentGold, ink]`) and the 1-line CSS import for `src/ui/styles.css`.
3. Verify WCAG AA contrast (>= 4.5:1 for body text on `--st-paper` and rail text on `--st-rail-bg`, >= 3:1 for large display headings and UI controls).
4. Do NOT rename or remove any `data-stage`, `data-slot`, `data-time`, `data-attitude`, `data-kind`, or `aria-*` hooks.
```
