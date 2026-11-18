/* Multi-Key / Multi-Model BYOK API Pool Settings Modal & 5-Scene Narrator Benchmark. */

import type { ImageRouter, DedicatedImageProvider } from "../adapters/image/image-router";
import {
  CONNECTION_PRESETS,
  type ConnectionPreset,
  type EconomyModeSetting,
  type ModelConnection,
  type ModelRouter,
  type ProviderKind,
  type ReasoningTier,
  type TaskKind
} from "../adapters/llm";
import type { KeyringManager } from "../adapters/storage";
import { rid } from "../engine";
import { runFullNarratorBenchmark, type BenchmarkSceneResult } from "../narrator";
import { $, el, put, toast } from "./dom";
import { isDevModeEnabled, setDevModeEnabled } from "./dev-modal";
import { svgIcon } from "./icons";
import { THEMES, getActiveThemeId, setActiveThemeId } from "./themes/registry";

export interface SettingsModalContext {
  keyring: KeyringManager;
  router: ModelRouter;
  imageRouter: ImageRouter;
  onChanged: () => void;
  onOpenDevConsole?: () => void;
}

export function syncRoutersFromKeyring(
  keyring: KeyringManager,
  router: ModelRouter,
  imageRouter: ImageRouter
): void {
  router.setConnections(keyring.getConnections());
  router.setConfig(keyring.getRoutingConfig());
  imageRouter.setConfig(keyring.getImageConfig());
}

export function openSettingsModal(ctx: SettingsModalContext): void {
  $("#settings-modal-backdrop")?.remove();

  let selectedPreset: ConnectionPreset = CONNECTION_PRESETS[0];
  let showCustomForm = false;
  let benchRunning = false;
  let benchResults: BenchmarkSceneResult[] = [];
  let benchAbort: AbortController | null = null;

  const backdrop = el("div", {
    class: "st-modal-backdrop modal-backdrop",
    id: "settings-modal-backdrop",
    onclick: (e: MouseEvent) => {
      if (e.target === backdrop && !benchRunning) close();
    }
  });
  const modal = el("div", {
    class: "st-modal-card modal",
    role: "dialog",
    "data-stage": "settings",
    "aria-label": "API, Theme & Model Settings"
  });
  backdrop.append(modal);
  document.body.append(backdrop);

  function close(): void {
    benchAbort?.abort();
    backdrop.remove();
    ctx.onChanged();
  }

  function applyAndSync(): void {
    syncRoutersFromKeyring(ctx.keyring, ctx.router, ctx.imageRouter);
    ctx.onChanged();
    render();
  }

  function render(): void {
    if (ctx.keyring.isLocked()) {
      put(
        modal,
        el(
          "div",
          { class: "modal-head" },
          el("h2", { text: "Unlock API Keyring" }),
          el("button", { class: "btn ghost sm", type: "button", onclick: close }, "Close")
        ),
        el("div", {
          class: "muted",
          text: "Your API keys are encrypted on this device with a passphrase. Enter it to unlock for this session."
        }),
        el(
          "form",
          {
            style: "display: flex; gap: 10px; flex-wrap: wrap",
            onsubmit: async (e: Event) => {
              e.preventDefault();
              const pass = ($("#unlock-pass", modal) as HTMLInputElement | null)?.value || "";
              const ok = await ctx.keyring.unlockWithPassphrase(pass);
              if (!ok) {
                toast("Incorrect passphrase.");
                return;
              }
              applyAndSync();
            }
          },
          el("input", {
            id: "unlock-pass",
            type: "password",
            placeholder: "Passphrase",
            style:
              "flex: 1; min-width: 200px; background: #0a120e; color: var(--ink); border: 1px solid var(--line-2); border-radius: 8px; padding: 10px 12px;"
          }),
          el("button", { class: "btn", type: "submit" }, "Unlock")
        )
      );
      return;
    }

    const connections = ctx.keyring.getConnections();
    const routing = ctx.keyring.getRoutingConfig();
    const imgCfg = ctx.keyring.getImageConfig();
    const economyNow = ctx.router.isEconomyActive();

    const connNodes = connections.length
      ? connections.map(conn => {
          const hasSecret = ctx.keyring.hasSecret(conn.apiKeyRef);
          const limParts = [
            conn.provider,
            `Tier ${conn.capabilities.reasoningTier}`,
            `${Math.round(conn.capabilities.contextWindow / 1000)}k ctx`,
            conn.limits.rpm ? `${conn.limits.rpm} RPM` : "unlimited RPM",
            conn.limits.tpm ? `${Math.round(conn.limits.tpm / 1000)}k TPM` : null,
            conn.limits.isFreeTier ? "Free Tier" : null,
            conn.capabilities.imageGen ? "Portrait Gen" : null,
            hasSecret ? "Key saved" : "No key"
          ].filter(Boolean);

          return el(
            "div",
            { class: "conn-card" + (conn.enabled ? "" : " off") },
            el(
              "div",
              { style: "display: flex; justify-content: space-between; gap: 10px; align-items: center; flex-wrap: wrap" },
              el(
                "div",
                {},
                el("b", { text: conn.label }),
                el("span", { class: "muted", style: "margin-left: 8px; font-size: 13px", text: conn.model })
              ),
              el(
                "div",
                { style: "display: flex; gap: 8px; align-items: center" },
                el(
                  "button",
                  {
                    class: "btn ghost sm",
                    type: "button",
                    onclick: async () => {
                      await ctx.keyring.upsertConnection({ ...conn, enabled: !conn.enabled });
                      applyAndSync();
                    }
                  },
                  conn.enabled ? "Enabled" : "Disabled"
                ),
                el(
                  "button",
                  {
                    class: "btn danger sm",
                    type: "button",
                    title: "Remove connection",
                    onclick: async () => {
                      await ctx.keyring.removeConnection(conn.id);
                      applyAndSync();
                    }
                  },
                  svgIcon("trash", "currentColor", 13),
                  "Remove"
                )
              )
            ),
            el("div", { class: "conn-meta", text: limParts.join(" · ") })
          );
        })
      : [
          el("div", {
            class: "notice",
            text: "No API keys connected yet. Add one or more below—you can mix free-tier keys (Gemini, Groq, OpenRouter) or paid/local endpoints, and Solo Tales will automatically balance rate limits and failover across them."
          })
        ];

    const presetButtons = CONNECTION_PRESETS.map(p =>
      el(
        "button",
        {
          class: "preset-btn",
          type: "button",
          "aria-pressed": String(!showCustomForm && selectedPreset.presetId === p.presetId),
          onclick: () => {
            showCustomForm = false;
            selectedPreset = p;
            render();
          }
        },
        el("b", { style: "font-size: 13.5px; color: var(--parch)", text: p.label }),
        el("span", { style: "font-size: 12px; color: var(--gold-hi)", text: p.badge })
      )
    );

    const addSection = showCustomForm
      ? el(
          "form",
          {
            class: "conn-card",
            onsubmit: async (e: Event) => {
              e.preventDefault();
              const label = ($("#c-label", modal) as HTMLInputElement).value.trim() || "Custom Model";
              const provider = ($("#c-prov", modal) as HTMLSelectElement).value as ProviderKind;
              const baseUrl = ($("#c-url", modal) as HTMLInputElement).value.trim();
              const model = ($("#c-model", modal) as HTMLInputElement).value.trim();
              const apiKey = ($("#c-key", modal) as HTMLInputElement).value.trim();
              const rpmVal = Number(($("#c-rpm", modal) as HTMLInputElement).value);
              const tpmVal = Number(($("#c-tpm", modal) as HTMLInputElement).value);
              const ctxVal = Number(($("#c-ctx", modal) as HTMLInputElement).value) || 32768;
              const tierVal = (Number(($("#c-tier", modal) as HTMLSelectElement).value) || 2) as ReasoningTier;
              const isFree = ($("#c-free", modal) as HTMLInputElement).checked;
              if (!model) {
                toast("Model name is required.");
                return;
              }
              const id = "conn_" + rid();
              const conn: ModelConnection = {
                id,
                label,
                provider,
                baseUrl: baseUrl || undefined,
                model,
                apiKeyRef: "key_" + id,
                enabled: true,
                capabilities: {
                  jsonMode: true,
                  streaming: true,
                  contextWindow: Math.max(2048, ctxVal),
                  maxOutputTokens: 3072,
                  reasoningTier: tierVal,
                  imageGen: false
                },
                limits: {
                  rpm: rpmVal > 0 ? rpmVal : null,
                  tpm: tpmVal > 0 ? tpmVal : null,
                  rpd: null,
                  isFreeTier: isFree
                }
              };
              await ctx.keyring.upsertConnection(conn, apiKey);
              showCustomForm = false;
              applyAndSync();
            }
          },
          el("div", { class: "lbl", text: "Custom Endpoint" }),
          el(
            "div",
            { style: "display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px" },
            el("div", { class: "field" }, el("label", { class: "lbl", text: "Label" }), el("input", { id: "c-label", value: "Custom OpenAI-Compatible" })),
            el(
              "div",
              { class: "field" },
              el("label", { class: "lbl", text: "Protocol" }),
              el(
                "select",
                { id: "c-prov" },
                el("option", { value: "openai-compatible" }, "OpenAI-Compatible"),
                el("option", { value: "gemini" }, "Google Gemini"),
                el("option", { value: "anthropic" }, "Anthropic")
              )
            ),
            el("div", { class: "field" }, el("label", { class: "lbl", text: "Base URL" }), el("input", { id: "c-url", value: "http://127.0.0.1:11434/v1" })),
            el("div", { class: "field" }, el("label", { class: "lbl", text: "Model ID" }), el("input", { id: "c-model", placeholder: "e.g. llama3.1:8b" })),
            el("div", { class: "field" }, el("label", { class: "lbl", text: "API Key (optional for local)" }), el("input", { id: "c-key", type: "password", autocomplete: "off" })),
            el(
              "div",
              { class: "field" },
              el("label", { class: "lbl", text: "Reasoning Tier" }),
              el(
                "select",
                { id: "c-tier" },
                el("option", { value: "3" }, "Tier 3 (Deep / World Prep)"),
                el("option", { value: "2", selected: true }, "Tier 2 (Balanced Story)"),
                el("option", { value: "1" }, "Tier 1 (Fast / Fold)")
              )
            ),
            el("div", { class: "field" }, el("label", { class: "lbl", text: "RPM Limit (blank = none)" }), el("input", { id: "c-rpm", type: "number", placeholder: "e.g. 15" })),
            el("div", { class: "field" }, el("label", { class: "lbl", text: "TPM Limit (blank = none)" }), el("input", { id: "c-tpm", type: "number", placeholder: "e.g. 15000" })),
            el("div", { class: "field" }, el("label", { class: "lbl", text: "Context Window" }), el("input", { id: "c-ctx", type: "number", value: "16384" }))
          ),
          el(
            "div",
            { style: "display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 6px" },
            el(
              "label",
              { style: "display: flex; gap: 6px; align-items: center; font-size: 14px; color: var(--sage)" },
              el("input", { id: "c-free", type: "checkbox" }),
              "Treat as Free-Tier / Rate-Limited key"
            ),
            el(
              "div",
              { style: "display: flex; gap: 8px" },
              el("button", { class: "btn ghost sm", type: "button", onclick: () => { showCustomForm = false; render(); } }, "Back to Presets"),
              el("button", { class: "btn sm", type: "submit" }, "Save Custom Connection")
            )
          )
        )
      : el(
          "form",
          {
            class: "conn-card",
            onsubmit: async (e: Event) => {
              e.preventDefault();
              const keyInput = ($("#preset-key", modal) as HTMLInputElement | null)?.value.trim() || "";
              const modelOverride = ($("#preset-model", modal) as HTMLInputElement | null)?.value.trim() || selectedPreset.model;
              const urlOverride = ($("#preset-url", modal) as HTMLInputElement | null)?.value.trim() || selectedPreset.baseUrl;
              if (selectedPreset.requiresKey && !keyInput) {
                toast("Please paste an API key for " + selectedPreset.label);
                return;
              }
              const conn = await ctx.keyring.addFromPreset(
                { ...selectedPreset, model: modelOverride, baseUrl: urlOverride },
                keyInput
              );
              if (conn) {
                toast(`Added ${conn.label} to your model pool.`);
              }
              applyAndSync();
            }
          },
          el("div", { style: "display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px" },
            el("b", { text: `Add: ${selectedPreset.label}` }),
            el("button", { class: "btn ghost sm", type: "button", onclick: () => { showCustomForm = true; render(); } }, "Custom Endpoint…")
          ),
          el(
            "div",
            { style: "display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px" },
            el(
              "div",
              { class: "field" },
              el("label", { class: "lbl", text: selectedPreset.requiresKey ? "API Key" : "API Key (Optional)" }),
              el("input", {
                id: "preset-key",
                type: "password",
                autocomplete: "off",
                placeholder: selectedPreset.keyPlaceholder
              })
            ),
            el(
              "div",
              { class: "field" },
              el("label", { class: "lbl", text: "Model ID" }),
              el("input", { id: "preset-model", value: selectedPreset.model })
            ),
            el(
              "div",
              { class: "field" },
              el("label", { class: "lbl", text: "Endpoint URL" }),
              el("input", { id: "preset-url", value: selectedPreset.baseUrl || "" })
            )
          ),
          el(
            "div",
            { style: "display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap" },
            el("span", {
              class: "muted",
              style: "font-size: 12.5px",
              text: "Keys stay exclusively in your local browser/PC keyring and are never included in exported campaign saves."
            }),
            el("button", { class: "btn sm", type: "submit" }, "+ Add to Pool")
          )
        );

    const pinTasks: Array<[TaskKind, string]> = [
      ["world_prep", "Campaign Prep"],
      ["story_turn", "Regular Story Turn"],
      ["story_strong", "Stronger Story Turn"],
      ["memory_fold", "Memory Fold"]
    ];

    put(
      modal,
      el(
        "div",
        { class: "modal-head" },
        el(
          "div",
          {},
          el("h2", { text: "API Pool, Free-Tier Limits & Portraits" }),
          el("div", {
            class: "muted",
            style: "font-size: 13.5px",
            text: "Connect one or multiple models. Solo Tales balances RPM/TPM limits, fails over on 429s, and sizes prompts to fit."
          })
        ),
        el("button", { class: "btn ghost sm", type: "button", disabled: benchRunning, onclick: close }, "Done")
      ),

      el("div", { style: "display: flex; flex-direction: column; gap: 8px" },
        el("span", { class: "lbl", text: `Connected Models (${connections.length})` }),
        connNodes
      ),

      el("div", { style: "display: flex; flex-direction: column; gap: 10px" },
        el("span", { class: "lbl", text: "Quick-Add Provider Preset" }),
        el("div", { class: "preset-grid" }, presetButtons),
        addSection
      ),

      /* Economy Mode & Task Pinning */
      el(
        "div",
        { class: "conn-card" },
        el("div", { class: "lbl", text: "Free-Tier & Rate-Limit Conservation" }),
        el(
          "div",
          { style: "display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; align-items: end" },
          el(
            "div",
            { class: "field" },
            el("label", { class: "lbl", text: `Economy Mode (${economyNow ? "Active" : "Standard"})` }),
            el(
              "select",
              {
                onchange: async (e: Event) => {
                  const val = (e.target as HTMLSelectElement).value as EconomyModeSetting;
                  await ctx.keyring.updateRoutingConfig({ economyMode: val });
                  applyAndSync();
                }
              },
              el("option", { value: "auto", selected: routing.economyMode === "auto" }, "Auto (On when using Free-Tier / <=15 RPM)"),
              el("option", { value: "on", selected: routing.economyMode === "on" }, "Always On (Conserve calls & tokens)"),
              el("option", { value: "off", selected: routing.economyMode === "off" }, "Off (Narrate every combat round)")
            )
          ),
          ...pinTasks.map(([task, label]) =>
            el(
              "div",
              { class: "field" },
              el("label", { class: "lbl", text: `Pin: ${label}` }),
              el(
                "select",
                {
                  onchange: async (e: Event) => {
                    const v = (e.target as HTMLSelectElement).value;
                    const pins = { ...routing.pins };
                    if (v) pins[task] = v;
                    else delete pins[task];
                    await ctx.keyring.updateRoutingConfig({ pins });
                    applyAndSync();
                  }
                },
                el("option", { value: "", selected: !routing.pins[task] }, "Automatic Best Fit"),
                ...connections.map(c =>
                  el("option", { value: c.id, selected: routing.pins[task] === c.id }, c.label)
                )
              )
            )
          )
        ),
        el("div", {
          class: "muted",
          style: "font-size: 12.5px",
          text: "Economy Mode skips optional per-round combat prose (deterministic dice cards still show), folds memory every 16 beats instead of 10, and trims packet budgets for low-TPM models."
        })
      ),

      /* Dedicated Portrait Image Endpoint */
      el(
        "div",
        { class: "conn-card" },
        el("div", { class: "lbl", text: "Character & NPC Portrait Generation" }),
        el(
          "div",
          { style: "display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px" },
          el(
            "div",
            { class: "field" },
            el("label", { class: "lbl", text: "Portrait Source" }),
            el(
              "select",
              {
                id: "img-mode",
                onchange: async (e: Event) => {
                  const mode = (e.target as HTMLSelectElement).value as DedicatedImageProvider;
                  await ctx.keyring.updateImageConfig({ mode });
                  applyAndSync();
                }
              },
              el("option", { value: "auto", selected: imgCfg.mode === "auto" }, "Auto (Use Pool Key or Heraldic Crest)"),
              el("option", { value: "heraldic-only", selected: imgCfg.mode === "heraldic-only" }, "Built-in Heraldic Crests Only (Zero API)"),
              el("option", { value: "local-sd", selected: imgCfg.mode === "local-sd" }, "Local Stable Diffusion (A1111 /sdapi/v1)"),
              el("option", { value: "openai", selected: imgCfg.mode === "openai" }, "Dedicated OpenAI Images Key"),
              el("option", { value: "gemini", selected: imgCfg.mode === "gemini" }, "Dedicated Gemini Image Key"),
              el("option", { value: "openrouter", selected: imgCfg.mode === "openrouter" }, "Dedicated OpenRouter FLUX Key")
            )
          ),
          imgCfg.mode !== "auto" && imgCfg.mode !== "heraldic-only"
            ? el(
                "div",
                { class: "field" },
                el("label", { class: "lbl", text: "Image Base URL (optional)" }),
                el("input", {
                  value: imgCfg.baseUrl || "",
                  placeholder: imgCfg.mode === "local-sd" ? "http://127.0.0.1:7860" : "Default provider URL",
                  onchange: async (e: Event) => {
                    await ctx.keyring.updateImageConfig({ baseUrl: (e.target as HTMLInputElement).value.trim() || undefined });
                    applyAndSync();
                  }
                })
              )
            : null,
          imgCfg.mode !== "auto" && imgCfg.mode !== "heraldic-only" && imgCfg.mode !== "local-sd"
            ? el(
                "div",
                { class: "field" },
                el("label", { class: "lbl", text: "Dedicated Image API Key" }),
                el("input", {
                  type: "password",
                  placeholder: ctx.keyring.hasSecret(imgCfg.apiKeyRef || "") ? "Saved (enter new to replace)" : "Paste API key",
                  onchange: async (e: Event) => {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) {
                      await ctx.keyring.updateImageConfig({}, val);
                      toast("Dedicated image API key saved.");
                      applyAndSync();
                    }
                  }
                })
              )
            : null
        )
      ),

      /* Optional Passphrase Encryption & 5-Scene Narrator Benchmark */
      el(
        "div",
        { style: "display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center" },
        el(
          "form",
          {
            style: "display: flex; gap: 8px; align-items: center; flex-wrap: wrap",
            onsubmit: async (e: Event) => {
              e.preventDefault();
              const pass = ($("#enc-pass", modal) as HTMLInputElement | null)?.value || "";
              await ctx.keyring.setEncryptionPassphrase(pass || null);
              toast(pass.trim() ? "Keyring encrypted with passphrase." : "Passphrase lock removed.");
              render();
            }
          },
          el("input", {
            id: "enc-pass",
            type: "password",
            placeholder: "Optional keyring passphrase",
            style: "background: #0a120e; color: var(--ink); border: 1px solid var(--line-2); border-radius: 6px; padding: 6px 10px; font-size: 13.5px;"
          }),
          el("button", { class: "btn ghost sm", type: "submit" }, "Set Lock")
        ),
        el(
          "div",
          { style: "display: flex; gap: 8px; align-items: center" },
          benchRunning
            ? el(
                "button",
                {
                  class: "btn danger sm",
                  type: "button",
                  onclick: () => {
                    benchAbort?.abort();
                    benchRunning = false;
                    render();
                  }
                },
                "Stop Benchmark"
              )
            : el(
                "button",
                {
                  class: "btn ghost sm",
                  type: "button",
                  disabled: ctx.router.getEnabledConnections().length === 0,
                  onclick: async () => {
                    benchRunning = true;
                    benchResults = [];
                    benchAbort = new AbortController();
                    render();
                    try {
                      await runFullNarratorBenchmark(ctx.router, {
                        signal: benchAbort.signal,
                        onSceneDone: res => {
                          benchResults.push(res);
                          render();
                        }
                      });
                    } catch (err: any) {
                      toast(err?.message || "Benchmark stopped.");
                    }
                    benchRunning = false;
                    render();
                  }
                },
                "Run 5-Scene Narrator Benchmark"
              )
        )
      ),

      benchResults.length
        ? el(
            "div",
            { style: "display: flex; flex-direction: column; gap: 8px" },
            el("span", { class: "lbl", text: "Benchmark Results (Nothing Saved to Campaigns)" }),
            benchResults.map(r => {
              const allOk = r.checks.every(c => c.ok);
              return el(
                "div",
                { class: "conn-card" },
                el(
                  "div",
                  { style: "display: flex; justify-content: space-between; gap: 8px" },
                  el("b", { text: `${r.name} · ${r.model}` }),
                  el("span", { class: allOk ? "ok" : "bad", text: allOk ? "PASS" : "CHECK WARNINGS" })
                ),
                r.checks.map(c =>
                  el(
                    "div",
                    { style: "font-size: 13px" },
                    el("span", { class: c.ok ? "ok" : "bad", text: c.ok ? "✓ " : "✗ " }),
                    c.what,
                    c.why ? el("span", { class: "muted", text: " · " + c.why }) : null
                  )
                )
              );
            })
          )
        : null,

      el(
        "div",
        { "data-slot": "theme-switcher", style: "display: flex; flex-direction: column; gap: 10px; padding-top: 12px; border-top: 1px solid var(--st-rule-light)" },
        el("h3", { class: "st-h", text: "Theme & Appearance" }),
        el(
          "div",
          { class: "st-theme-grid" },
          ...THEMES.map(t => {
            const active = getActiveThemeId() === t.id;
            return el(
              "button",
              {
                type: "button",
                class: "st-theme-card",
                "aria-pressed": active ? "true" : "false",
                "data-theme-option": t.id,
                onclick: () => {
                  setActiveThemeId(t.id);
                  render();
                }
              },
              el(
                "div",
                { style: "display:flex;justify-content:space-between;align-items:center;gap:8px" },
                el("strong", { class: "st-fr", style: "font-size:18px", text: t.name }),
                active ? el("span", { class: "st-pl", text: "Active" }) : null
              ),
              el("span", { class: "st-pl", text: t.tagline }),
              el(
                "div",
                { class: "st-theme-swatches", "aria-hidden": "true" },
                ...t.swatches.map(hex => el("span", { class: "st-theme-swatch", style: `background:${hex}` }))
              )
            );
          })
        )
      ),

      el(
        "details",
        {
          "data-slot": "advanced-dev-drawer",
          style: "margin-top:8px;padding-top:10px;border-top:1px solid var(--st-rule-light)"
        },
        el("summary", {
          class: "st-pl",
          style: "cursor:pointer;font-size:13px;opacity:0.72;user-select:none",
          text: "Advanced · Developer Mode"
        }),
        el(
          "div",
          { style: "display:flex;flex-direction:column;gap:10px;padding-top:10px" },
          el(
            "label",
            { style: "display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer" },
            el("input", {
              type: "checkbox",
              checked: isDevModeEnabled(),
              style: "width:16px;height:16px;accent-color:var(--st-accent-player)",
              onchange: (e: Event) => {
                setDevModeEnabled((e.target as HTMLInputElement).checked);
                ctx.onChanged();
                render();
              }
            }),
            "Enable Developer Mode (live parameter editor, event injector & outcome overrides)"
          ),
          isDevModeEnabled() && ctx.onOpenDevConsole
            ? el(
                "button",
                {
                  type: "button",
                  class: "st-btn-quiet sm",
                  style: "align-self:flex-start",
                  onclick: () => {
                    close();
                    ctx.onOpenDevConsole?.();
                  }
                },
                "Open Developer Console"
              )
            : null
        )
      )
    );
  }

  render();
}
