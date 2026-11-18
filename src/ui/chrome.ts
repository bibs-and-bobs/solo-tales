/* Shared Semantic Chrome & Editorial SVG Helpers for Solo Tales Stages. */

import type { CharacterState } from "../engine";
import { el } from "./dom";

const SVG_NS = "http://www.w3.org/2000/svg";

export type PhoneTab = "story" | "sheet" | "bag" | "journal";

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  ...children: SVGElement[]
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, String(v));
  }
  for (const ch of children) node.appendChild(ch);
  return node;
}

export function lineIcon(paths: string | string[], size = 20, viewBox = "0 0 24 24"): SVGSVGElement {
  const list = Array.isArray(paths) ? paths : [paths];
  return svgEl(
    "svg",
    {
      width: size,
      height: size,
      viewBox,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "1.7",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true"
    },
    ...list.map(d => svgEl("path", { d }))
  );
}

export const UI_PATHS = {
  undo: ["M9 14 4 9l5-5", "M4 9h10a6 6 0 0 1 0 12h-3"],
  allTales: ["M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z", "M5 17a3 3 0 0 1 3-3h11"],
  sheet: ["M7 4h10v14a2 2 0 0 0 2 2H9a2 2 0 0 1-2-2z", "M10 8h4M10 12h4"],
  bag: ["M7 9h10l2 11H5z", "M9 9V7a3 3 0 0 1 6 0v2"],
  back: "M15 5l-7 7 7 7",
  check: "M20 6 9 17l-5-5",
  chevronRight: "M9 5l7 7-7 7",
  hourglass: ["M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"],
  campfire: ["M5 20l14-4M5 16l14 4M12 4c2.5 2.5 3.5 4 3.5 6a3.5 3.5 0 0 1-7 0c0-2 1-3.5 3.5-6z"],
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  storyBook: "M4 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-5a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h5z",
  shield: "M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z",
  sliders: ["M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"]
};

export function quillSvg(size = 18): SVGSVGElement {
  return svgEl(
    "svg",
    { width: size, height: size, viewBox: "0 0 18 18", "aria-hidden": "true", style: "flex:0 0 auto" },
    svgEl("path", { d: "M2 12 12 2l4 4L6 16l-5 1z", fill: "currentColor" })
  );
}

export function choiceArrowSvg(): SVGSVGElement {
  return svgEl(
    "svg",
    { width: 10, height: 12, viewBox: "0 0 10 12", "aria-hidden": "true", style: "flex:0 0 auto" },
    svgEl("path", { d: "M1 1l8 5-8 5z", fill: "currentColor" })
  );
}

export function starSvg(filled: boolean): SVGSVGElement {
  return svgEl(
    "svg",
    {
      width: 20,
      height: 20,
      viewBox: "0 0 24 24",
      fill: filled ? "var(--st-accent-gold)" : "none",
      stroke: "var(--st-ink)",
      "stroke-width": "1.6",
      "stroke-linejoin": "round",
      "aria-hidden": "true"
    },
    svgEl("path", { d: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" })
  );
}

export function heraldicShieldSvg(): SVGSVGElement {
  return svgEl(
    "svg",
    { width: 52, height: 60, viewBox: "0 0 52 60", "aria-hidden": "true", style: "flex:0 0 auto" },
    svgEl("path", {
      d: "M26 3 48 11v19c0 14-10 22-22 27C14 52 4 44 4 30V11z",
      fill: "var(--st-accent-player)",
      stroke: "var(--st-rail-gold)",
      "stroke-width": "2"
    }),
    svgEl("path", {
      d: "M17 43l3-3m0 0 13-22 4-2-1 4.5-13 22zm-4-3 7 5",
      fill: "none",
      stroke: "#fff8ea",
      "stroke-width": "2",
      "stroke-linecap": "round"
    })
  );
}

export function d20Badge(valueText: string, filled = true): HTMLElement {
  const poly = svgEl(
    "svg",
    {
      width: 48,
      height: 48,
      viewBox: "0 0 48 48",
      "aria-hidden": "true",
      style: "position:absolute;inset:0"
    },
    svgEl("polygon", {
      points: "24,3 42,13.5 42,34.5 24,45 6,34.5 6,13.5",
      fill: filled ? "var(--st-accent-gold)" : "none",
      stroke: "var(--st-ink)",
      "stroke-width": "1.5",
      ...(filled ? {} : { "stroke-dasharray": "4 3" })
    }),
    ...(filled
      ? [
          svgEl("path", {
            d: "M24 3 12 30M24 3l12 27M12 30h24M6 13.5l6 16.5M42 13.5 36 30M12 30l12 15M36 30 24 45M6 34.5l6-4.5M42 34.5l-6-4.5",
            fill: "none",
            stroke: "var(--st-ink)",
            "stroke-width": "1",
            opacity: "0.38"
          })
        ]
      : [])
  );
  return el(
    "div",
    { class: "st-d20-badge" },
    poly,
    valueText ? el("span", { class: "st-d20-num", text: valueText }) : null
  );
}

export function skyBackdrop(): HTMLElement {
  const hills = svgEl(
    "svg",
    {
      "data-slot": "sky-hills",
      width: "100%",
      height: 220,
      viewBox: "0 0 1440 220",
      preserveAspectRatio: "none"
    },
    svgEl("path", {
      d: "M0 120 L90 96 L170 110 L260 70 L340 100 L430 60 L520 98 L610 80 L700 104 L800 58 L880 92 L980 72 L1070 100 L1160 64 L1250 96 L1340 78 L1440 104 L1440 220 L0 220 Z",
      fill: "var(--st-sky-far)"
    }),
    svgEl("path", {
      d: "M0 160 L120 128 L220 150 L330 116 L450 152 L560 130 L640 146 L650 104 L656 104 L656 96 L664 96 L664 104 L672 104 L672 96 L680 96 L680 104 L686 104 L690 148 L800 132 L920 156 L1040 124 L1150 150 L1280 126 L1440 156 L1440 220 L0 220 Z",
      fill: "var(--st-sky-mid)"
    }),
    svgEl("path", {
      d: "M0 196 C200 160 380 190 560 176 C760 160 900 200 1100 178 C1250 162 1360 184 1440 172 L1440 220 L0 220 Z",
      fill: "var(--st-sky-ground)"
    })
  );
  return el(
    "div",
    { "data-slot": "sky-backdrop", "aria-hidden": "true" },
    el("div", { "data-slot": "sky-stars" }),
    el("div", { "data-slot": "sky-orb" }),
    hills
  );
}

export function attitudeKey(att: number | undefined): "friendly" | "neutral" | "hostile" {
  const n = att ?? 0;
  if (n >= 1) return "friendly";
  if (n <= -1) return "hostile";
  return "neutral";
}

export function phoneBottomNav(opts: {
  char: Pick<CharacterState, "name" | "hp" | "maxHp">;
  activeTab: PhoneTab;
  onNav: (tab: PhoneTab) => void;
}): HTMLElement {
  const { char, activeTab, onNav } = opts;
  const pct = Math.max(0, Math.min(100, Math.round((char.hp / Math.max(1, char.maxHp)) * 100)));
  const tabs: Array<{ id: PhoneTab; label: string; icon: string | string[] }> = [
    { id: "story", label: "Story", icon: UI_PATHS.storyBook },
    { id: "sheet", label: "Sheet", icon: UI_PATHS.shield },
    { id: "bag", label: "Bag", icon: UI_PATHS.bag },
    { id: "journal", label: "Journal", icon: UI_PATHS.allTales }
  ];
  return el(
    "nav",
    { "data-slot": "phone-nav", "aria-label": "Sections" },
    el(
      "div",
      { style: "display:flex;align-items:center;gap:10px;font-size:14px" },
      el("span", { style: "font-weight:700;color:var(--st-rail-ink-bright)", text: char.name.split(" ")[0] }),
      el(
        "div",
        { class: "st-bar-track is-thin", style: "flex:1", role: "img", "aria-label": `${char.hp} of ${char.maxHp} hit points` },
        el("div", { class: "st-bar-fill-hp", style: `width:${pct}%` })
      ),
      el("span", { class: "st-rl", text: `${char.hp} of ${char.maxHp}` })
    ),
    el(
      "div",
      { class: "st-phone-tabs" },
      ...tabs.map(t =>
        el(
          "button",
          {
            type: "button",
            class: "st-phone-tab",
            "aria-current": activeTab === t.id ? "page" : undefined,
            onClick: () => onNav(t.id)
          },
          lineIcon(t.icon, 20),
          el("span", { text: t.label })
        )
      )
    )
  );
}
