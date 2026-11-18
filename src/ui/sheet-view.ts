/* Dedicated 2-Page Book Spread: Adventure Sheet (03-sheet.html). */

import {
  ABIL,
  ABIL_NAME,
  SKILLS,
  XP_AT,
  attacksOf,
  carryCapacityKg,
  checkBonus,
  mod,
  nice,
  prof,
  sign,
  totalCarryWeightKg,
  type CampaignBundle
} from "../engine";
import { el, put } from "./dom";
import { UI_PATHS, heraldicShieldSvg, lineIcon, phoneBottomNav, type PhoneTab } from "./chrome";

export interface SheetViewContext {
  bundle: CampaignBundle;
  portraitUrl: string | null;
  busyPortrait?: boolean;
  onBack: () => void;
  onNav: (tab: PhoneTab) => void;
  onPaintPortrait: () => void;
  onUploadPortrait: (file: File) => void;
}

export function renderSheetView(container: HTMLElement, ctx: SheetViewContext): void {
  const { bundle, portraitUrl } = ctx;
  const ch = bundle.campaign.char;
  const p = prof(ch.level);
  const nextXp = XP_AT[ch.level + 1] ?? XP_AT[XP_AT.length - 1];
  const attacks = attacksOf(ch);
  const carryKg = totalCarryWeightKg(ch.inv);
  const capKg = carryCapacityKg(ch.abil.str);

  // Build crossed-out HP trail from hpTrail, excluding current HP if repeated at end
  const trail = (ch.hpTrail || []).filter((v, idx, arr) => {
    if (idx === arr.length - 1 && v === ch.hp) return false;
    return true;
  });

  const portraitNode = portraitUrl
    ? el("img", {
        src: portraitUrl,
        alt: `${ch.name} portrait`,
        class: "st-portrait-thumb",
        style: "width:64px;height:74px"
      })
    : heraldicShieldSvg();

  const fileInput = el("input", {
    type: "file",
    accept: "image/*",
    hidden: true,
    onchange: () => {
      const f = fileInput.files?.[0];
      if (f) ctx.onUploadPortrait(f);
    }
  });

  const leftPage = el(
    "section",
    { class: "st-spread-page", "data-slot": "sheet-left" },
    el(
      "div",
      { style: "display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap" },
      el("h1", { class: "st-fr", style: "margin:0;font-size:44px;font-weight:800;line-height:1", text: "Adventure sheet" }),
      el(
        "div",
        { style: "display:flex;align-items:center;gap:10px" },
        portraitNode,
        el(
          "div",
          { style: "display:flex;flex-direction:column;gap:4px" },
          el(
            "button",
            {
              type: "button",
              class: "st-btn-quiet",
              style: "min-height:32px;padding:0 10px;font-size:13px",
              disabled: !!ctx.busyPortrait,
              onclick: ctx.onPaintPortrait
            },
            ctx.busyPortrait ? "Painting..." : "Paint portrait"
          ),
          el(
            "button",
            {
              type: "button",
              class: "st-btn-quiet",
              style: "min-height:32px;padding:0 10px;font-size:13px",
              onclick: () => fileInput.click()
            },
            "Upload"
          ),
          fileInput
        )
      )
    ),

    // Identity 2x2 boxes
    el(
      "div",
      { style: "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px" },
      el("div", { class: "st-box" }, el("div", { class: "st-pl", text: "Name" }), el("div", { class: "st-hand", style: "font-size:26px;line-height:1.15", text: ch.name })),
      el("div", { class: "st-box" }, el("div", { class: "st-pl", text: "Kind and calling" }), el("div", { class: "st-hand", style: "font-size:26px;line-height:1.15", text: `${ch.species} ${ch.cls.toLowerCase()}` })),
      el("div", { class: "st-box" }, el("div", { class: "st-pl", text: "Before this" }), el("div", { class: "st-hand", style: "font-size:26px;line-height:1.15", text: ch.bg })),
      el(
        "div",
        { class: "st-box", style: "display:flex;justify-content:space-between;align-items:flex-end;gap:8px" },
        el("div", null, el("div", { class: "st-pl", text: "Level" }), el("div", { class: "st-hand", style: "font-size:26px;line-height:1.15", text: String(ch.level) })),
        el("div", { style: "text-align:right" }, el("div", { class: "st-pl", text: `Experience, next at ${nextXp.toLocaleString()}` }), el("div", { class: "st-hand", style: "font-size:22px;line-height:1.2", text: ch.xp.toLocaleString() }))
      )
    ),

    // HP / AC / Init / Speed
    el(
      "div",
      { style: "display:grid;grid-template-columns:1.5fr 1fr 1fr 1fr;gap:10px" },
      el(
        "div",
        { class: "st-box", style: "border-width:2.5px", "data-slot": "sheet-hp" },
        el("div", { class: "st-pl", text: `Hit points, of ${ch.maxHp}` }),
        el(
          "div",
          { class: "st-hand st-hp-trail" },
          ...trail.map(old => el("span", { class: "st-hp-old", text: String(old) })),
          el("span", { style: "font-size:48px;line-height:1", text: String(ch.hp) })
        )
      ),
      el("div", { class: "st-box" }, el("div", { class: "st-pl", text: "Armour" }), el("div", { class: "st-hand", style: "font-size:38px;line-height:1.2", text: String(ch.ac) })),
      el("div", { class: "st-box" }, el("div", { class: "st-pl", text: "Initiative" }), el("div", { class: "st-hand", style: "font-size:38px;line-height:1.2", text: sign(mod(ch.abil.dex)) })),
      el("div", { class: "st-box" }, el("div", { class: "st-pl", text: "Speed" }), el("div", { class: "st-hand", style: "font-size:38px;line-height:1.2", text: `${ch.speed} m` }))
    ),

    // 6 Abilities
    el(
      "div",
      { style: "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px", "data-slot": "sheet-abilities" },
      ...ABIL.map(ab => {
        const score = ch.abil[ab];
        const m = mod(score);
        const trained = ch.saves.includes(ab);
        return el(
          "div",
          { class: "st-box", style: "display:flex;justify-content:space-between;align-items:center;gap:8px" },
          el(
            "div",
            null,
            el("div", { style: "font-size:15px;font-weight:700", text: ABIL_NAME[ab] }),
            el("div", { class: "st-pl", text: trained ? "save trained" : "" })
          ),
          el(
            "div",
            { style: "display:flex;align-items:baseline;gap:8px" },
            el("span", { class: "st-hand", style: "font-size:34px;line-height:1.1", text: sign(m) }),
            el("span", { class: "st-hand", style: "font-size:18px;opacity:0.75", text: String(score) })
          )
        );
      })
    ),

    // Attacks
    el(
      "div",
      { "data-slot": "sheet-attacks" },
      el("h2", { class: "st-h", text: "Attacks" }),
      el(
        "div",
        { style: "border-top:1.5px solid var(--st-rule);margin-top:4px" },
        ...attacks.map(w => {
          const notes: string[] = [];
          if (w.range) notes.push(`range ${w.range[0]}/${w.range[1]} m`);
          if (w.mastery && ch.mastery.includes(w.key)) notes.push(w.mastery);
          return el(
            "div",
            { style: "display:grid;grid-template-columns:1.3fr .5fr 1.4fr 1fr;gap:10px;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--st-rule-light)" },
            el("span", { style: "font-weight:700", text: w.name }),
            el("span", { class: "st-hand", style: "font-size:21px", text: sign(w.bonus) }),
            el("span", { class: "st-hand", style: "font-size:21px", text: `${w.dmgText} ${w.type}` }),
            el("span", { class: "st-pl", text: notes.join(", ") })
          );
        })
      ),
      el("div", {
        class: "st-gd",
        style: "font-style:italic;font-size:16px;color:var(--st-ink-muted);margin-top:8px",
        text: `Proficiency bonus is +${p}. Armour ${ch.ac} comes from your equipped gear.`
      })
    )
  );

  // Right Page: Skills, Features, Bottom 4 boxes
  const skillKeys = Object.keys(SKILLS).sort((a, b) => nice(a).localeCompare(nice(b)));
  const resEntries = Object.entries(ch.res || {});

  const rightPage = el(
    "section",
    { class: "st-spread-page", "data-slot": "sheet-right" },
    el(
      "div",
      { "data-slot": "sheet-skills" },
      el("h2", { class: "st-h", text: "Skills" }),
      el(
        "div",
        { style: "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:28px;border-top:1.5px solid var(--st-rule);margin-top:4px" },
        ...skillKeys.map(sk => {
          const ab = SKILLS[sk];
          const trained = ch.skills.includes(sk) || ch.expertise.includes(sk);
          const { bonus } = checkBonus(ch, { kind: "skill", key: sk, abil: ab });
          return el(
            "div",
            { style: "display:flex;align-items:center;gap:10px;height:31px;border-bottom:1px solid var(--st-rule-light)" },
            el("span", {
              "aria-hidden": "true",
              style: trained
                ? "flex:0 0 auto;width:10px;height:10px;border-radius:50%;background:var(--st-ink)"
                : "flex:0 0 auto;width:10px;height:10px;border-radius:50%;border:1.5px solid var(--st-ink-muted)"
            }),
            el("span", { style: `flex:1;font-weight:${trained ? "700" : "400"}`, text: nice(sk) }),
            el("span", { class: "st-pl", text: nice(ab).slice(0, 3) }),
            el("span", { class: "st-hand", style: "font-size:21px;width:30px;text-align:right", text: sign(bonus) })
          );
        })
      ),
      el(
        "div",
        { class: "st-pl", style: "display:flex;align-items:center;gap:8px;margin-top:8px" },
        el("span", { "aria-hidden": "true", style: "width:10px;height:10px;border-radius:50%;background:var(--st-ink)" }),
        `trained: add proficiency, now +${p}`
      )
    ),

    el(
      "div",
      { "data-slot": "sheet-features" },
      el("h2", { class: "st-h", text: "What you can do" }),
      el(
        "div",
        { style: "border-top:1.5px solid var(--st-rule);margin-top:4px" },
        ...resEntries.map(([k, r]) =>
          el(
            "div",
            { style: "display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--st-rule-light)" },
            el(
              "span",
              { style: "flex:1" },
              el("b", { text: nice(k) }),
              el("span", { class: "st-pl", style: "display:block", text: `${r.left} of ${r.max} remaining. Recovers on rest.` })
            ),
            el(
              "span",
              { class: "st-dot-pips", role: "img", "aria-label": `${r.left} of ${r.max} left` },
              ...Array.from({ length: r.max }, (_, i) =>
                el("span", {
                  style: i < r.left
                    ? "width:16px;height:16px;border-radius:50%;background:var(--st-accent-player)"
                    : "width:16px;height:16px;border-radius:50%;border:1.5px dashed var(--st-ink-muted)"
                })
              )
            )
          )
        ),
        ch.mastery.length
          ? el(
              "div",
              { style: "padding:8px 0;border-bottom:1px solid var(--st-rule-light)" },
              el("b", { text: "Weapon mastery" }),
              el("span", { class: "st-pl", style: "display:block", text: ch.mastery.map(nice).join(", ") })
            )
          : null,
        ...(ch.perks || []).map(pk =>
          el(
            "div",
            { style: "padding:8px 0;border-bottom:1px solid var(--st-rule-light)" },
            el("b", { text: "Perk" }),
            el("span", { class: "st-pl", style: "display:block", text: pk })
          )
        ),
        ch.backstory
          ? el(
              "div",
              { style: "padding:10px 0;border-bottom:1px solid var(--st-rule-light)" },
              el("b", { text: "Backstory" }),
              el("p", { class: "st-gd", style: "margin:4px 0 0;font-size:15px;line-height:1.5;white-space:pre-line", text: ch.backstory })
            )
          : null
      )
    ),

    // Bottom 4 boxes: Hit dice, Gold, Load, Conditions
    el(
      "div",
      { style: "display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px", "data-slot": "sheet-resources" },
      el("div", { class: "st-box" }, el("div", { class: "st-pl", text: `Hit dice, d${ch.hd.die}` }), el("div", { class: "st-hand", style: "font-size:26px;line-height:1.2", text: `${ch.hd.left} of ${ch.hd.max}` })),
      el("div", { class: "st-box" }, el("div", { class: "st-pl", text: "Gold" }), el("div", { class: "st-hand", style: "font-size:26px;line-height:1.2", text: String(ch.gold) })),
      el("div", { class: "st-box", "data-slot": "sheet-load" }, el("div", { class: "st-pl", text: `Load, of ${capKg} kg` }), el("div", { class: "st-hand", style: "font-size:26px;line-height:1.2", text: String(carryKg) })),
      el("div", { class: "st-box" }, el("div", { class: "st-pl", text: "Conditions" }), el("div", { class: "st-hand", style: "font-size:22px;line-height:1.2", text: ch.conditions.length ? ch.conditions.map(nice).join(", ") : "none" }))
    )
  );

  put(
    container,
    el(
      "div",
      { "data-stage": "sheet" },
      el(
        "div",
        { class: "st-spread-topbar" },
        el(
          "button",
          { type: "button", class: "st-back-link", "data-slot": "back-to-story", onclick: ctx.onBack },
          lineIcon(UI_PATHS.back, 18),
          el("span", { text: "Back to the story" })
        ),
        el("span", { class: "st-rl", text: "Printed lines are the rules. Blue pen is yours, and changes as you play." })
      ),
      el("main", { "data-slot": "spread" }, leftPage, rightPage),
      phoneBottomNav({ char: ch, activeTab: "sheet", onNav: ctx.onNav })
    )
  );
}
