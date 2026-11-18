/* Discreet Developer Mode Console:
   Edit any character/campaign parameter, inject any engine event, override pending check/combat outcomes,
   tweak Threat Clocks/Quests, or inspect/apply raw state JSON. */

import {
  ABIL,
  CONDITIONS,
  MONSTERS,
  MOODS,
  XP_AT,
  applyEvent,
  applyEvents,
  clone,
  commitBundleInPlace,
  rid,
  syncChar,
  type CampaignBundle,
  type ConditionKey,
  type NarratorEvent,
  type TypedNarratorEvent
} from "../engine";
import { $, el, put, toast } from "./dom";

const DEV_MODE_STORAGE_KEY = "solotales_dev_mode";

export function isDevModeEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(DEV_MODE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDevModeEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage !== "undefined") {
      if (enabled) localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
      else localStorage.removeItem(DEV_MODE_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export interface DevModalContext {
  getBundle: () => CampaignBundle | null;
  onSave: () => Promise<void>;
  onRenderAll: () => void;
}

type DevTab = "params" | "events" | "outcomes" | "raw";

export function openDevModal(ctx: DevModalContext): void {
  $("#dev-modal-backdrop")?.remove();

  let activeTab: DevTab = "params";
  let eventType: TypedNarratorEvent["type"] = "hp";
  let evAmount = "5";
  let evName = "";
  let evText = "";
  let evExtra = "";
  let evBool = true;
  let rawEventJson = JSON.stringify({ type: "gold", amount: 50 }, null, 2);
  let customLogText = "";

  const backdrop = el("div", {
    class: "st-modal-backdrop modal-backdrop",
    id: "dev-modal-backdrop",
    onclick: (e: MouseEvent) => {
      if (e.target === backdrop) close();
    }
  });
  const modal = el("div", {
    class: "st-modal-card modal st-dev-modal",
    role: "dialog",
    "data-stage": "dev",
    "aria-label": "Developer Console"
  });
  backdrop.append(modal);
  document.body.append(backdrop);

  function close(): void {
    backdrop.remove();
  }

  async function mutate(label: string, fn: (draft: CampaignBundle) => void): Promise<void> {
    const b = ctx.getBundle();
    if (!b) return;
    commitBundleInPlace(b, label, fn);
    await ctx.onSave();
    ctx.onRenderAll();
    render();
  }

  function renderParamsTab(b: CampaignBundle): HTMLElement {
    const c = b.campaign.char;
    const g = b.campaign;

    const places = Object.values(b.entities).filter(e => e.kind === "place");

    return el(
      "div",
      { style: "display:flex;flex-direction:column;gap:14px" },
      el(
        "div",
        { style: "display:flex;flex-wrap:wrap;gap:6px" },
        el("button", { type: "button", class: "st-btn-quiet sm", onclick: () => void mutate("dev full heal", d => { d.campaign.char.hp = d.campaign.char.maxHp; d.campaign.char.dying = null; d.campaign.status = "active"; }) }, "Full Heal"),
        el("button", { type: "button", class: "st-btn-quiet sm", onclick: () => void mutate("dev +100 gold", d => { d.campaign.char.gold += 100; }) }, "+100 Gold"),
        el("button", { type: "button", class: "st-btn-quiet sm", onclick: () => void mutate("dev +300 xp", d => { d.campaign.char.xp += 300; }) }, "+300 XP"),
        el("button", {
          type: "button",
          class: "st-btn-quiet sm",
          onclick: () =>
            void mutate("dev level up", d => {
              const ch = d.campaign.char;
              if (ch.level < 20) {
                ch.level += 1;
                ch.hd.max = ch.level;
                ch.hd.left = ch.level;
                ch.maxHp += Math.max(1, Math.floor(ch.hd.die / 2) + 1);
                ch.hp = ch.maxHp;
                ch.xp = Math.max(ch.xp, XP_AT[ch.level - 1] || 0);
              }
            })
        }, "Level Up"),
        el("button", { type: "button", class: "st-btn-quiet sm", onclick: () => void mutate("dev clear conditions", d => { d.campaign.char.conditions = []; }) }, "Clear Conditions")
      ),

      el("div", { class: "st-lbl", text: "Character Parameters" }),
      el(
        "div",
        { class: "st-dev-grid" },
        numField("HP", c.hp, v => void mutate("dev hp", d => { d.campaign.char.hp = Math.max(0, Math.min(d.campaign.char.maxHp, v)); })),
        numField("Max HP", c.maxHp, v => void mutate("dev maxHp", d => { d.campaign.char.maxHp = Math.max(1, v); d.campaign.char.hp = Math.min(d.campaign.char.hp, d.campaign.char.maxHp); })),
        numField("AC", c.ac, v => void mutate("dev ac", d => { d.campaign.char.ac = Math.max(1, v); })),
        numField("Speed (m)", c.speed, v => void mutate("dev speed", d => { d.campaign.char.speed = Math.max(0, v); })),
        numField("Level", c.level, v => void mutate("dev level", d => { d.campaign.char.level = Math.max(1, Math.min(20, v)); })),
        numField("XP", c.xp, v => void mutate("dev xp", d => { d.campaign.char.xp = Math.max(0, v); })),
        numField("Gold", c.gold, v => void mutate("dev gold", d => { d.campaign.char.gold = Math.max(0, v); })),
        textField("Name", c.name, v => void mutate("dev name", d => { d.campaign.char.name = v || d.campaign.char.name; })),
        textField("Race", c.species, v => void mutate("dev species", d => { d.campaign.char.species = v || d.campaign.char.species; })),
        textField("Class", c.cls, v => void mutate("dev cls", d => { d.campaign.char.cls = v || d.campaign.char.cls; syncChar(d.campaign.char); }))
      ),

      el("div", { class: "st-lbl", text: "Ability Scores" }),
      el(
        "div",
        { class: "st-dev-grid-6" },
        ...ABIL.map(k =>
          numField(k.toUpperCase(), c.abil[k], v => void mutate(`dev abil ${k}`, d => { d.campaign.char.abil[k] = Math.max(1, Math.min(30, v)); }))
        )
      ),

      el("div", { class: "st-lbl", text: "Conditions" }),
      el(
        "div",
        { style: "display:flex;flex-wrap:wrap;gap:6px" },
        ...CONDITIONS.map(cond => {
          const active = c.conditions.includes(cond);
          return el(
            "button",
            {
              type: "button",
              class: active ? "st-chip-btn is-active" : "st-chip-btn",
              onclick: () =>
                void mutate(`dev cond ${cond}`, d => {
                  const list = d.campaign.char.conditions;
                  if (list.includes(cond)) d.campaign.char.conditions = list.filter(x => x !== cond);
                  else d.campaign.char.conditions = [...list, cond];
                })
            },
            cond
          );
        })
      ),

      el("div", { class: "st-lbl", text: "Campaign Parameters" }),
      el(
        "div",
        { class: "st-dev-grid" },
        numField("Turn", g.turn, v => void mutate("dev turn", d => { d.campaign.turn = Math.max(0, v); })),
        numField("Time (min)", g.time, v => void mutate("dev time", d => { d.campaign.time = Math.max(0, v); })),
        selectField(
          "Mood",
          g.mood,
          MOODS.map(m => ({ value: m, label: m })),
          v => void mutate("dev mood", d => { d.campaign.mood = v as any; })
        ),
        selectField(
          "Status",
          g.status,
          [
            { value: "active", label: "active" },
            { value: "dead", label: "dead" }
          ],
          v => void mutate("dev status", d => { d.campaign.status = v as "active" | "dead"; })
        ),
        selectField(
          "Next Roll Adv",
          String(g.nextAdv),
          [
            { value: "0", label: "Normal (0)" },
            { value: "1", label: "Advantage (+1)" },
            { value: "-1", label: "Disadvantage (-1)" }
          ],
          v => void mutate("dev nextAdv", d => { d.campaign.nextAdv = Number(v); })
        ),
        selectField(
          "Place",
          g.place || "",
          [{ value: "", label: "(none)" }, ...places.map(p => ({ value: p.id, label: p.name }))],
          v => void mutate("dev place", d => { d.campaign.place = v || null; })
        )
      )
    );
  }

  function buildEventFromForm(): TypedNarratorEvent {
    switch (eventType) {
      case "hp":
        return { type: "hp", amount: Number(evAmount) || 0 };
      case "gold":
        return { type: "gold", amount: Number(evAmount) || 0 };
      case "xp":
        return { type: "xp", amount: Number(evAmount) || 0 };
      case "time":
        return { type: "time", minutes: Number(evAmount) || 10 };
      case "item_add":
        return { type: "item_add", name: evName || "Mysterious Key", qty: Math.max(1, Number(evAmount) || 1), note: evText || undefined };
      case "item_remove":
        return { type: "item_remove", name: evName, qty: Math.max(1, Number(evAmount) || 1) };
      case "move":
        return { type: "move", place: evName || "Old Watchtower", desc: evText || undefined };
      case "npc":
        return {
          type: "npc",
          name: evName || "Vesper",
          role: evText || "traveller",
          attitude: (evExtra as any) || "neutral"
        };
      case "attitude":
        return { type: "attitude", name: evName, delta: Number(evAmount) || 1 };
      case "quest_new":
        return { type: "quest_new", title: evName || "New Lead", obj: evText || "Investigate the rumour." };
      case "quest_update":
        return { type: "quest_update", title: evName, obj: evText };
      case "quest_done":
        return { type: "quest_done", title: evName };
      case "quest_fail":
        return { type: "quest_fail", title: evName };
      case "fact":
        return { type: "fact", text: evText || "A new rumour circulates.", truth: evBool };
      case "secret":
        return { type: "secret", holder: evName, text: evText, truth: evBool };
      case "condition":
        return { type: "condition", condition: (evName || "poisoned") as ConditionKey };
      case "condition_end":
        return { type: "condition_end", condition: (evName || "poisoned") as ConditionKey };
      case "clock_tick":
        return { type: "clock_tick", clockId: evName, delta: Number(evAmount) || 1 };
      case "clock_reveal":
        return { type: "clock_reveal", clockId: evName };
      case "clock_avert":
        return { type: "clock_avert", clockId: evName };
      case "combat_start":
        return {
          type: "combat_start",
          foes: [{ ref: evName || "goblin_warrior", count: Math.max(1, Number(evAmount) || 1) }]
        };
      default:
        return { type: "gold", amount: 10 };
    }
  }

  function renderEventsTab(b: CampaignBundle): HTMLElement {
    const eventTypes: Array<TypedNarratorEvent["type"]> = [
      "hp", "gold", "xp", "time", "item_add", "item_remove", "move",
      "npc", "attitude", "quest_new", "quest_update", "quest_done", "quest_fail",
      "fact", "secret", "condition", "condition_end", "clock_tick", "clock_reveal", "clock_avert", "combat_start"
    ];

    return el(
      "div",
      { style: "display:flex;flex-direction:column;gap:14px" },
      el("div", { class: "st-lbl", text: "Create & Fire Engine Event" }),
      el(
        "div",
        { class: "st-dev-grid" },
        selectField(
          "Event Type",
          eventType,
          eventTypes.map(t => ({ value: t, label: t })),
          v => {
            eventType = v as TypedNarratorEvent["type"];
            rawEventJson = JSON.stringify(buildEventFromForm(), null, 2);
            render();
          }
        ),
        textField("Name / Target / Ref / ClockId", evName, v => { evName = v; }),
        textField("Amount / Qty / Minutes / Delta", evAmount, v => { evAmount = v; }),
        textField("Description / Text / Role / Objective", evText, v => { evText = v; })
      ),
      eventType === "combat_start"
        ? el("div", { class: "st-pl", text: `Available monster refs: ${Object.keys(MONSTERS).slice(0, 10).join(", ")}...` })
        : null,
      eventType === "clock_tick" || eventType === "clock_reveal" || eventType === "clock_avert"
        ? el("div", { class: "st-pl", text: `Clocks: ${Object.keys(b.clocks).join(", ") || "(none)"}` })
        : null,
      el(
        "div",
        { style: "display:flex;gap:8px;flex-wrap:wrap" },
        el(
          "button",
          {
            type: "button",
            class: "st-btn-primary",
            onclick: async () => {
              const ev = buildEventFromForm();
              const chips: Array<[string, string]> = [];
              await mutate(`dev event ${ev.type}`, d => {
                applyEvent(d, ev, chips);
              });
              toast(chips.map(c => c[0]).join(" · ") || `Applied ${ev.type} event.`);
            }
          },
          "Fire Event"
        ),
        el(
          "button",
          {
            type: "button",
            class: "st-btn-quiet",
            onclick: () => {
              rawEventJson = JSON.stringify(buildEventFromForm(), null, 2);
              render();
            }
          },
          "Preview in Raw JSON ↓"
        )
      ),

      el("div", { class: "st-lbl", style: "margin-top:8px", text: "Raw Event JSON (Single Object or Array)" }),
      el("textarea", {
        class: "st-hand-input",
        rows: "5",
        style: "height:auto;font-family:monospace;font-size:13px",
        oninput: (e: Event) => {
          rawEventJson = (e.target as HTMLTextAreaElement).value;
        }
      }, rawEventJson),
      el(
        "button",
        {
          type: "button",
          class: "st-btn-gold",
          style: "align-self:flex-start",
          onclick: async () => {
            try {
              const parsed = JSON.parse(rawEventJson);
              const list: NarratorEvent[] = Array.isArray(parsed) ? parsed : [parsed];
              const chips: Array<[string, string]> = [];
              await mutate("dev raw events", d => {
                for (const ev of list) applyEvent(d, ev, chips);
              });
              toast(chips.map(c => c[0]).join(" · ") || `Applied ${list.length} event(s).`);
            } catch (err: any) {
              toast(err?.message || "Invalid JSON event.");
            }
          }
        },
        "Fire Raw JSON Event(s)"
      )
    );
  }

  function renderOutcomesTab(b: CampaignBundle): HTMLElement {
    const pending = b.campaign.pending;
    const combat = b.campaign.combat;
    const clocks = Object.values(b.clocks);
    const quests = b.campaign.quests;

    return el(
      "div",
      { style: "display:flex;flex-direction:column;gap:16px" },

      // Pending Check Outcome Override
      el(
        "div",
        { class: "st-cc-card" },
        el("div", { class: "st-lbl", text: "Pending Check Outcome" }),
        pending
          ? el(
              "div",
              { style: "display:flex;flex-direction:column;gap:8px" },
              el("div", { text: `Pending: ${pending.check.key} (DC ${pending.check.dc})` }),
              el(
                "div",
                { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" },
                numField("Override DC", pending.check.dc, v => void mutate("dev dc", d => { if (d.campaign.pending) d.campaign.pending.check.dc = Math.max(1, v); })),
                el(
                  "button",
                  {
                    type: "button",
                    class: "st-btn-primary",
                    onclick: async () => {
                      await mutate("dev force check success", d => {
                        const p = d.campaign.pending;
                        if (!p) return;
                        const chips: Array<[string, string]> = [["Dev override: Success", "good"]];
                        const entry = {
                          t: d.campaign.turn,
                          you: p.input || "(Check override)",
                          segs: p.success.story,
                          chips,
                          roll: { label: p.check.key, dice: [20], kept: 20, bonus: 0, total: 99, dc: p.check.dc, ok: true, why: "Dev override" }
                        };
                        applyEvents(d, p.success.events, entry);
                        d.log.push(entry);
                        d.campaign.options = p.options;
                        d.campaign.mood = p.mood;
                        d.campaign.pending = null;
                      });
                      toast("Forced check success.");
                    }
                  },
                  "Force Success"
                ),
                el(
                  "button",
                  {
                    type: "button",
                    class: "st-btn-danger",
                    onclick: async () => {
                      await mutate("dev force check failure", d => {
                        const p = d.campaign.pending;
                        if (!p) return;
                        const chips: Array<[string, string]> = [["Dev override: Failure", "hurt"]];
                        const entry = {
                          t: d.campaign.turn,
                          you: p.input || "(Check override)",
                          segs: p.failure.story,
                          chips,
                          roll: { label: p.check.key, dice: [1], kept: 1, bonus: 0, total: 1, dc: p.check.dc, ok: false, why: "Dev override" }
                        };
                        applyEvents(d, p.failure.events, entry);
                        d.log.push(entry);
                        d.campaign.options = p.options;
                        d.campaign.mood = p.mood;
                        d.campaign.pending = null;
                      });
                      toast("Forced check failure.");
                    }
                  },
                  "Force Failure"
                )
              )
            )
          : el("div", { class: "st-pl", text: "No pending skill/saving throw check right now." })
      ),

      // Combat Outcome Override
      el(
        "div",
        { class: "st-cc-card" },
        el("div", { class: "st-lbl", text: "Active Combat Override" }),
        combat
          ? el(
              "div",
              { style: "display:flex;flex-direction:column;gap:8px" },
              el("div", { text: `Phase: ${combat.phase} · Round: ${combat.cs?.round ?? 0}` }),
              el(
                "div",
                { style: "display:flex;gap:8px;flex-wrap:wrap" },
                el(
                  "button",
                  {
                    type: "button",
                    class: "st-btn-primary",
                    onclick: () =>
                      void mutate("dev combat victory", d => {
                        if (!d.campaign.combat) return;
                        if (d.campaign.combat.cs) {
                          for (const a of Object.values(d.campaign.combat.cs.actors)) {
                            if (a.side === "foe") {
                              a.hp = 0;
                              a.status = "dead";
                            }
                          }
                        }
                        d.campaign.combat.phase = "over";
                        d.campaign.combat.result = "victory";
                      })
                  },
                  "Force Victory"
                ),
                el(
                  "button",
                  {
                    type: "button",
                    class: "st-btn-danger",
                    onclick: () =>
                      void mutate("dev clear combat", d => {
                        d.campaign.combat = null;
                      })
                  },
                  "End & Clear Combat"
                )
              )
            )
          : el("div", { class: "st-pl", text: "No active combat." })
      ),

      // Custom Log / Narration Entry
      el(
        "div",
        { class: "st-cc-card" },
        el("div", { class: "st-lbl", text: "Inject Story Outcome / Narrator Entry" }),
        el("textarea", {
          class: "st-hand-input",
          rows: "3",
          style: "height:auto",
          placeholder: "Write a custom narrator outcome to append to the story log...",
          oninput: (e: Event) => {
            customLogText = (e.target as HTMLTextAreaElement).value;
          }
        }, customLogText),
        el(
          "button",
          {
            type: "button",
            class: "st-btn-gold",
            style: "align-self:flex-start",
            onclick: async () => {
              if (!customLogText.trim()) return;
              await mutate("dev custom story", d => {
                d.campaign.turn += 1;
                d.log.push({
                  t: d.campaign.turn,
                  you: "(Dev Outcome)",
                  segs: [{ n: customLogText.trim() }],
                  chips: [["Dev note", "note"]],
                  roll: null
                });
              });
              customLogText = "";
              toast("Added custom story entry.");
            }
          },
          "Append to Story Log"
        )
      ),

      // Clocks & Quests
      clocks.length
        ? el(
            "div",
            { class: "st-cc-card" },
            el("div", { class: "st-lbl", text: "Threat Clocks" }),
            ...clocks.map(clk =>
              el(
                "div",
                { style: "display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0" },
                el("span", { text: `${clk.name} (${clk.filled}/${clk.segments}) · ${clk.knownToPlayer ? "Known" : "Hidden"}` }),
                el(
                  "div",
                  { style: "display:flex;gap:6px" },
                  el("button", { type: "button", class: "st-btn-quiet sm", onclick: () => void mutate("dev clock -1", d => { const k = d.clocks[clk.id]; if (k) k.filled = Math.max(0, k.filled - 1); }) }, "-1"),
                  el("button", { type: "button", class: "st-btn-quiet sm", onclick: () => void mutate("dev clock +1", d => { const k = d.clocks[clk.id]; if (k) k.filled = Math.min(k.segments, k.filled + 1); }) }, "+1"),
                  el("button", { type: "button", class: "st-btn-quiet sm", onclick: () => void mutate("dev clock reveal", d => { const k = d.clocks[clk.id]; if (k) k.knownToPlayer = !k.knownToPlayer; }) }, clk.knownToPlayer ? "Hide" : "Reveal")
                )
              )
            )
          )
        : null,

      quests.length
        ? el(
            "div",
            { class: "st-cc-card" },
            el("div", { class: "st-lbl", text: "Quests" }),
            ...quests.map((q, idx) =>
              el(
                "div",
                { style: "display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 0" },
                el("span", { text: `${q.title} [${q.status}]` }),
                el(
                  "div",
                  { style: "display:flex;gap:6px" },
                  el("button", { type: "button", class: "st-btn-quiet sm", onclick: () => void mutate("dev q active", d => { d.campaign.quests[idx].status = "active"; }) }, "Active"),
                  el("button", { type: "button", class: "st-btn-quiet sm", onclick: () => void mutate("dev q done", d => { d.campaign.quests[idx].status = "done"; }) }, "Done"),
                  el("button", { type: "button", class: "st-btn-quiet sm", onclick: () => void mutate("dev q fail", d => { d.campaign.quests[idx].status = "failed"; }) }, "Fail")
                )
              )
            )
          )
        : null
    );
  }

  function renderRawTab(b: CampaignBundle): HTMLElement {
    let jsonText = JSON.stringify(b.campaign, null, 2);
    return el(
      "div",
      { style: "display:flex;flex-direction:column;gap:10px" },
      el("div", { class: "st-lbl", text: "Raw Campaign State JSON" }),
      el("textarea", {
        class: "st-hand-input",
        rows: "16",
        style: "height:auto;font-family:monospace;font-size:12px",
        oninput: (e: Event) => {
          jsonText = (e.target as HTMLTextAreaElement).value;
        }
      }, jsonText),
      el(
        "button",
        {
          type: "button",
          class: "st-btn-danger",
          style: "align-self:flex-start",
          onclick: async () => {
            try {
              const parsed = JSON.parse(jsonText);
              await mutate("dev raw campaign", d => {
                d.campaign = clone(parsed);
              });
              toast("Applied raw campaign JSON.");
            } catch (err: any) {
              toast(err?.message || "Invalid JSON.");
            }
          }
        },
        "Apply Raw Campaign JSON"
      )
    );
  }

  function numField(label: string, value: number, onChange: (n: number) => void): HTMLElement {
    return el(
      "label",
      { style: "display:flex;flex-direction:column;gap:3px;font-size:12px" },
      el("span", { class: "st-pl", text: label }),
      el("input", {
        type: "number",
        class: "st-hand-input",
        style: "min-height:36px;padding:4px 8px",
        value: String(value),
        onchange: (e: Event) => onChange(Number((e.target as HTMLInputElement).value))
      })
    );
  }

  function textField(label: string, value: string, onChange: (s: string) => void): HTMLElement {
    return el(
      "label",
      { style: "display:flex;flex-direction:column;gap:3px;font-size:12px" },
      el("span", { class: "st-pl", text: label }),
      el("input", {
        type: "text",
        class: "st-hand-input",
        style: "min-height:36px;padding:4px 8px",
        value,
        onchange: (e: Event) => onChange((e.target as HTMLInputElement).value)
      })
    );
  }

  function selectField(
    label: string,
    value: string,
    options: Array<{ value: string; label: string }>,
    onChange: (v: string) => void
  ): HTMLElement {
    return el(
      "label",
      { style: "display:flex;flex-direction:column;gap:3px;font-size:12px" },
      el("span", { class: "st-pl", text: label }),
      el(
        "select",
        {
          class: "st-hand-input",
          style: "min-height:36px;padding:4px 8px",
          onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value)
        },
        ...options.map(o => el("option", { value: o.value, selected: o.value === value }, o.label))
      )
    );
  }

  function render(): void {
    const b = ctx.getBundle();
    const tabs: Array<{ id: DevTab; label: string }> = [
      { id: "params", label: "Parameters" },
      { id: "events", label: "Create Event" },
      { id: "outcomes", label: "Outcomes & Clocks" },
      { id: "raw", label: "Raw JSON" }
    ];

    put(
      modal,
      el(
        "div",
        { class: "modal-head" },
        el("h2", { style: "margin:0", text: "Developer Console" }),
        el("button", { class: "btn ghost sm", type: "button", onclick: close }, "Close")
      ),
      !b
        ? el("p", { class: "muted", text: "Load or start a campaign first to inspect and edit live game state." })
        : el(
            "div",
            { style: "display:flex;flex-direction:column;gap:14px" },
            el(
              "div",
              { style: "display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--st-rule-light);padding-bottom:10px" },
              ...tabs.map(t =>
                el(
                  "button",
                  {
                    type: "button",
                    class: t.id === activeTab ? "st-chip-btn is-active" : "st-chip-btn",
                    onclick: () => {
                      activeTab = t.id;
                      render();
                    }
                  },
                  t.label
                )
              )
            ),
            activeTab === "params"
              ? renderParamsTab(b)
              : activeTab === "events"
                ? renderEventsTab(b)
                : activeTab === "outcomes"
                  ? renderOutcomesTab(b)
                  : renderRawTab(b)
          )
    );
  }

  render();
}
