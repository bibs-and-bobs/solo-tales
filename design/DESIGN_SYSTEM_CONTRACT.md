# Solo Tales — Design System & Theme Contract

This document is the authoritative contract between Solo Tales' application code and any visual theme or CSS overhaul. Every stage, slot, state attribute, typography role, and CSS custom property listed here is **live in the DOM** and wired to real game state.

A theme **MUST NOT** require edits to TypeScript or HTML structure: styling `[data-theme="<id>"]`, `[data-stage]`, `[data-slot]`, state attributes, and `--st-*` custom properties is sufficient to completely re-skin Solo Tales.

---

## 1. How Themes Are Registered & Applied

1. **DOM Activation**: `applyTheme(id)` in `src/ui/themes/registry.ts` sets `document.documentElement.dataset.theme = id` (`"broadsheet"` | `"obsidian"` | `"minimalist"` | custom ID) and persists the selection under `solo_tales_theme` in `localStorage`.
2. **Default Theme**: `broadsheet` (*Illuminated Broadsheet*) defines all `--st-*` defaults on `:root` in `src/ui/styles/tokens.css`.
3. **Custom Theme CSS**: A new theme overrides any subset of `--st-*` tokens under `:root[data-theme="your_theme_id"] { ... }` and may add targeted overrides using `[data-theme="your_theme_id"] [data-stage="..."]` or `[data-slot="..."]`.
4. **Theme Registry**: Add the theme metadata (`id`, `name`, `tagline`, `swatches: [bg, paper, accent, ink]`) to `THEMES` in `src/ui/themes/registry.ts` and import its CSS file in `src/ui/styles.css` so it appears automatically in **API & Theme Settings**.

---

## 2. CSS Custom Properties (`--st-*`)

### 2.1 Typography Roles
| Token | Role | Default (`broadsheet`) |
|---|---|---|
| `--st-font-display` | Display headings, cover title, chapter headings, drop-caps, roll/crit callouts | `"Fraunces", Georgia, serif` |
| `--st-font-narr` | Prose narration, NPC speech, journal facts | `"Sorts Mill Goudy", Georgia, serif` |
| `--st-font-ui` | Rails, labels, buttons, tabs, combat controls | `"Alegreya Sans", system-ui, sans-serif` |
| `--st-font-hand` | Player-written moves, handwritten sheet numbers, NPC player notes | `"Kalam", cursive` |

### 2.2 Paper & Ink Surfaces
| Token | Purpose |
|---|---|
| `--st-paper` | Primary page / spread surface |
| `--st-paper-elevated` | Elevated card surface (roll cards, fight log, modal cards) |
| `--st-paper-tab` | Inactive book tab in 2-page spreads |
| `--st-paper-tab-hover` | Hovered book tab |
| `--st-paper-row-hover` | Hovered list row (People/Places/Errands) |
| `--st-paper-row-active` | Selected list row (`[aria-pressed="true"]`) |
| `--st-paper-edge` | Subtle edge border for book pages |
| `--st-ink` | Primary body ink on `--st-paper` |
| `--st-ink-muted` | Secondary captions, timestamps, labels |
| `--st-rule` | Primary divider rules (1.5px borders, table headers) |
| `--st-rule-light` | Hairline row dividers |
| `--st-rule-soft` | Subtle section separators |

### 2.3 Semantic Accents
| Token | Purpose |
|---|---|
| `--st-accent-player` | Player choice links, handwritten moves, player map token |
| `--st-accent-player-hover` | Hover color for player choices |
| `--st-accent-player-ink` | High-contrast ink paired with player accent |
| `--st-accent-foe` | Hostile attitude, damage margin notes, foe map tokens, filled threat clock pips |
| `--st-accent-friend` | Friendly attitude, healing margin notes, success callouts |
| `--st-accent-gold` | Initiative highlight, gold CTA buttons, active turn dot, cover frame |

### 2.4 Tactical Blueprint Map
| Token | Purpose |
|---|---|
| `--st-map-ink` | Grid lines, walls, cover rings |
| `--st-map-ink-deep` | High-contrast map annotations |
| `--st-map-paper` | Blueprint grid background |

### 2.5 Dark Rails & Book Cover
| Token | Purpose |
|---|---|
| `--st-rail-bg` | Left/right rail background (`story`, `fight`), spread backdrop, mobile bottom nav |
| `--st-rail-ink` | Primary rail text |
| `--st-rail-ink-bright` | Active/emphasized rail text |
| `--st-rail-ink-muted` | Secondary rail captions |
| `--st-rail-border` | Rail card/section dividers |
| `--st-rail-border-strong` | Emphasized rail borders |
| `--st-rail-gold` | Gold trim in rails |
| `--st-rail-hp` | Hero HP bar fill |
| `--st-rail-foe` | Hostile indicator in rails |
| `--st-rail-friend` | Friendly indicator in rails |
| `--st-rail-player` | Player turn indicator in rails |
| `--st-cover-bg` | Left-side book cover & spread top gradient |
| `--st-cover-ink` | Book cover title ink |

### 2.6 Elevation & Geometry
| Token | Purpose |
|---|---|
| `--st-radius-sm` | Small boxes & roll cards |
| `--st-radius-md` | Buttons, modals, cards |
| `--st-page-shadow` | Shadow under Story/Fight broadsheet page |
| `--st-spread-shadow` | Shadow under 2-page open book spreads (`sheet`, `journal`) |

### 2.7 Living Sky Backdrop (Auto-driven by `data-time` and `data-stage="fight"`)
| Token | Purpose |
|---|---|
| `--st-sky-bg` | Sky gradient |
| `--st-sky-far` | Distant hill silhouette |
| `--st-sky-mid` | Midground hill silhouette |
| `--st-sky-ground` | Foreground ground silhouette (blends into `--st-rail-bg`) |
| `--st-sky-orb` | Sun / moon fill |
| `--st-sky-glow` | Halo / ambient glow |
| `--st-sky-orb-x` | Horizontal orb position (e.g. `18%`, `74%`) |
| `--st-sky-orb-y` | Vertical orb position (e.g. `42%`, `20%`) |
| `--st-sky-stars` | Starfield opacity (`0` in daytime, `0.85` at night) |

---

## 3. Stages (`[data-stage]`)

| Selector | Screen | Layout Structure |
|---|---|---|
| `[data-stage="start"]` | Cover & Start | Split layout: `[data-slot="book-cover"]` (left) + `[data-slot="start-page"]` (right: Saved Tales, New Tale, Prep Studio drawer, utility buttons) |
| `[data-stage="story"]` | Story Broadsheet | `[data-slot="sky-backdrop"]` + `[data-slot="stage-header"]` + 3-column `[data-slot="stage-columns"]` (`[data-slot="hero-rail"]`, `[data-slot="page"]`, `[data-slot="context-rail"]`) + `[data-slot="phone-nav"]` |
| `[data-stage="fight"]` | Combat Broadsheet | `[data-slot="sky-backdrop"]` (ember sky) + `[data-slot="stage-header"]` + 3-column `[data-slot="stage-columns"]` (`[data-slot="hero-rail"]`, `[data-slot="page"]` with `.st-fight-split` + `[data-slot="combat-controls"]`, `[data-slot="context-rail"]` with `Who acts when`) + `[data-slot="phone-nav"]` |
| `[data-stage="sheet"]` | Adventure Sheet Spread | Topbar (`[data-slot="back-to-story"]`) + `[data-slot="spread"]` (`[data-slot="sheet-left"]` + `[data-slot="sheet-right"]`) + `[data-slot="phone-nav"]` |
| `[data-stage="journal"]` | Journal & Bag Spread | Topbar (`[data-slot="back-to-story"]` + `[data-slot="book-tabs"]`) + `[data-slot="spread"]` (`people`, `places`, `errands`, `facts`, `bag`) + `[data-slot="phone-nav"]` |
| `[data-stage="settings"]` | API & Theme Settings Modal | Modal card inside `.st-modal-backdrop` containing `[data-slot="theme-switcher"]`, LLM connections, Image settings, and model diagnostics |

---

## 4. Semantic Slots (`[data-slot]`)

### Global / Header / Sky
- `sky-backdrop`, `sky-stars`, `sky-orb`, `sky-hills`
- `stage-header`, `header-title`, `header-subtitle`, `header-meta`
- `clock-readout`, `clock-phase`, `clock-detail`
- `save-status`, `wait-pill`, `undo-btn`
- `phone-nav` (visible at `<= 820px`)

### Cover & Start (`start`)
- `book-cover`, `start-page`, `saved-tales`, `new-tale`, `prep-drawer`

### Story & Fight Rails (`story`, `fight`)
- `stage-columns`, `hero-rail`, `context-rail`
- `open-sheet-btn`, `open-journal-btn`, `open-bag-btn`

### Story Page (`story`)
- `page`, `page-running-head`, `page-body`
- `margin-notes` (child `<span>` carries `data-kind="hurt" | "heal" | "info"`)
- `pending-roll`, `death-saves`, `hostiles-engaged`, `retry-card`, `hero-fallen`
- `action-block` (choices + handwritten `.st-hand-input` + `Do it` submit)

### Fight Page (`fight`)
- `battle-map` (blueprint grid, reach cells, walls, rough terrain, pillars, tokens)
- `combat-log` (round-grouped attack/save/narration entries)
- `combat-controls`, `turn-economy`, `aim-readout`, `combat-action`

### Adventure Sheet (`sheet`)
- `spread`, `back-to-story`, `sheet-left`, `sheet-right`
- `sheet-hp` (crossed-out `.st-hp-trail` + current HP)
- `sheet-abilities`, `sheet-attacks`, `sheet-skills`, `sheet-features`, `sheet-resources`
- `sheet-load` (computed `kg` load vs Str carry capacity)

### Journal & Bag (`journal`)
- `book-tabs` (`people`, `places`, `errands`, `facts`, `bag`)
- `journal-left`, `journal-dossier`, `npc-player-note`
- `journal-errands`, `journal-threats` (known `ThreatClock` segment bars)
- `journal-facts`, `journal-pinned`
- `bag-equipped`, `bag-carried`

### Settings (`settings`)
- `theme-switcher` (cards with `aria-pressed="true" | "false"`)

---

## 5. Semantic State Attributes

- `[data-time="dawn" | "day" | "dusk" | "night"]` on `[data-stage="story"]`
- `[data-theme="broadsheet" | "obsidian" | "minimalist" | ...]` on `:root` (`<html>`)
- `[data-attitude="friendly" | "neutral" | "hostile"]` on NPC speech & indicators
- `[data-kind="hurt" | "heal" | "info"]` on margin notes
- `[aria-pressed="true" | "false"]` on selected NPC/Place rows, starred facts, theme cards, and toggle buttons
- `[aria-selected="true" | "false"]` on `[data-slot="book-tabs"]` tabs
- `[aria-current="page"]` on active `[data-slot="phone-nav"]` tab
