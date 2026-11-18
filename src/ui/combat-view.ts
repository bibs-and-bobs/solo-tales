/* Decoupled Grid Combat View, Ruling Card, Combat Sheet, Combat Abilities Panel & Fight Log Card. */

import type { ModelRouter } from "../adapters/llm";
import type { GameStore } from "../adapters/storage";
import {
  ABIL_NAME,
  Combat,
  R_COST,
  R_FAIL,
  R_FAIL_OUT,
  absorbCombatResult,
  addCombatFlavour,
  armourClass,
  attacksOf,
  checkBonus,
  clamp,
  commitBundleInPlace,
  d,
  hurtWord,
  leaveFightInBundle,
  mod,
  newRoundEntry,
  nice,
  prof,
  rulingBonus,
  rulingEffectText,
  sign,
  str,
  type ActiveCombat,
  type CampaignBundle,
  type CombatActor,
  type CombatCommand,
  type CombatRoundEntry,
  type CombatState,
  type FightLogSummary,
  type RulingProposal
} from "../engine";
import { narrateCombatRound, pk, requestCombatRuling } from "../narrator";
import { $, el, put, renderAvatarNode, type PortraitUrlCache } from "./dom";
import { heraldicShieldSvg, quillSvg } from "./chrome";
import { svgIcon } from "./icons";

export interface CombatUiState {
  entered: string | null;
  target: string | null;
  aim: { cmd: CombatCommand; pv: any; flavour: string } | null;
  msg: string;
  notes: string[];
  rulingInFlightCid: string | null;
}

export function createCombatUiState(): CombatUiState {
  return {
    entered: null,
    target: null,
    aim: null,
    msg: "",
    notes: [],
    rulingInFlightCid: null
  };
}

export interface CombatViewDeps {
  getBundle: () => CampaignBundle | null;
  cui: CombatUiState;
  router: ModelRouter;
  store: GameStore;
  portraits: PortraitUrlCache;
  isConflicted: () => boolean;
  onRenderAll: () => void;
  onRenderCombatOnly: () => void;
  onSave: () => void;
  onSetMobileView: (v: "sheet" | "story" | "bag") => void;
  onAftermathTurn: (note: string) => void;
  onHeroDied: (campaignId: string) => void;
  renderHighlight: (text: string) => HTMLElement;
  renderSpeechSeg: (who: string, text: string) => HTMLElement;
}

const SHOUT: Readonly<Record<string, string>> = {
  "critical hit": "CRITICAL",
  hit: "HIT",
  "natural 1, miss": "NATURAL 1",
  miss: "MISS",
  "critical success": "CRITICAL",
  success: "SUCCESS",
  failure: "FAILED"
};

export function lineView(l: string, heroName: string): HTMLElement {
  const shot = (who: string, word: string, head: string, sum: string, after?: string | null) =>
    el(
      "div",
      {
        class: `shot ${who === heroName ? "mine" : "theirs"}${/hit|success/.test(word) ? " yes" : ""}${
          /critical/.test(word) ? " crit" : ""
        }`
      },
      el("div", { class: "big", text: SHOUT[word] || word.toUpperCase() }),
      el(
        "div",
        {},
        el("div", { text: head }),
        el("div", { class: "sum", text: sum }),
        after ? el("div", { text: after }) : null
      )
    );

  let m = l.match(
    /^(.+?) (attacks|makes an opportunity attack on) (.+?) with (.+?): (.+? vs AC \d+), (critical hit|hit|natural 1, miss|miss)( with Sneak Attack)?(?:, (.+?) \((.+)\))?$/
  );
  if (m) {
    return shot(
      m[1],
      m[6],
      `${m[1]} → ${m[3]} · ${m[4]}${m[2] === "attacks" ? "" : " · opportunity attack"}`,
      m[5],
      m[8] ? `${m[8]}${m[7] ? " with Sneak Attack" : ""} · ${m[9]}` : null
    );
  }
  m = l.match(/^(.+?) tries (.+?): (.+? vs [AD]C \d+), (critical success|success|failure)$/);
  if (m) {
    return shot(m[1], m[4], `${m[1]} · ${m[2]}`, m[3]);
  }
  return el("div", { text: l });
}

export function renderRulingCard(opts: {
  bundle: CampaignBundle;
  rl: { ruling: RulingProposal; line?: string; capped?: string[] };
  info: any;
  inFight: boolean;
  onRoll: () => void;
  onChange: () => void;
}): HTMLElement {
  const G = opts.bundle.campaign;
  const r = opts.rl.ruling;
  const { bonus, why } = rulingBonus(G.char, r);
  const tgt = opts.info?.targetName || r.target;
  const adv = opts.inFight
    ? opts.info?.adv || 0
    : clamp((r.check.adv || 0) + (G.nextAdv ? 1 : 0), -1, 1);

  const row = (a: string, b: string, dim?: boolean) =>
    el(
      "div",
      { style: "display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap" },
      el("span", { style: dim ? "color: #d2c08e" : "", text: a }),
      el("span", { style: dim ? "" : "color: #d2c08e", text: b })
    );

  const timeMins = r.time || 10;
  const costText = opts.inFight
    ? R_COST[r.cost]
    : `${timeMins >= 60 ? timeMins / 60 + " h" : timeMins + " min"}`;
  const checkText =
    r.check.kind === "attack"
      ? `${r.check.label} vs AC${tgt ? " · " + tgt : ""}`
      : `${r.check.label} check`;
  const blocked = opts.inFight && opts.info && !opts.info.ok ? opts.info.msg : "";

  return el(
    "div",
    { class: "roll ruling", style: "flex-direction: column; align-items: stretch" },
    el(
      "div",
      { style: "display: flex; align-items: center; gap: 8px; flex-wrap: wrap" },
      el("span", { class: "rbadge", text: "Creative action" }),
      el("span", { style: "color: #d2c08e; font-size: 13px", text: "Narrator's ruling, checked by the rules" })
    ),
    opts.rl.line ? el("p", { class: "narr", style: "font-size: 16px", text: opts.rl.line }) : null,
    el(
      "div",
      { style: "display: flex; flex-direction: column; gap: 6px; font-size: 14px" },
      row(`1 · ${r.name}`, `${checkText} · ${costText}`),
      row("On success", rulingEffectText(r, opts.info?.targetName), true),
      row(
        "On failure",
        (opts.inFight ? R_FAIL : R_FAIL_OUT)[r.failure] || "nothing worse happens",
        true
      ),
      r.follow
        ? row(
            `2 · ${r.follow.text}`,
            "then, if it works" + (r.success.effect?.k === "adv" ? " · with Advantage" : "")
          )
        : null
    ),
    el("div", {
      class: "s",
      text: `d20 ${bonus >= 0 ? "+" : "−"} ${Math.abs(bonus)}${
        adv > 0
          ? " · Advantage, roll two and keep the higher"
          : adv < 0
          ? " · Disadvantage, roll two and keep the lower"
          : ""
      }`
    }),
    G.learn
      ? el("div", {
          class: "why",
          text:
            why +
            " Creative moves use the same menu as everything else: a clever plan earns an easier DC, not a bigger effect."
        })
      : null,
    G.learn && opts.rl.capped?.length
      ? el("div", { class: "why", text: "The rules trimmed this ruling: " + opts.rl.capped.join("; ") + "." })
      : null,
    blocked ? el("div", { class: "cmsg", text: blocked }) : null,
    el(
      "div",
      { style: "display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end" },
      el("button", { class: "btn ghost", id: "rchange", type: "button", onclick: opts.onChange }, "Change plan"),
      el(
        "button",
        { class: "btn", id: "rroll", type: "button", disabled: Boolean(blocked), onclick: opts.onRoll },
        svgIcon("dice-twenty-faces-twenty", "#1a160e", 20),
        ` Roll ${r.check.kind === "attack" ? "attack" : r.check.label}`
      )
    )
  );
}

export function renderFightLogCard(
  f: FightLogSummary,
  heroName: string,
  renderHighlight: (t: string) => HTMLElement
): HTMLElement {
  const head =
    f.result === "victory" ? "won" : f.result === "fled" ? "got away" : f.dead ? "killed" : "fell";
  return el(
    "div",
    { class: "fightlog" },
    el("div", {
      class: "lbl",
      text: `Fight · ${f.foes} · ${head} after ${f.rounds.length} round${f.rounds.length === 1 ? "" : "s"}`
    }),
    f.rounds.filter(r => r.narr).map(r => renderHighlight(r.narr!.line)),
    el(
      "details",
      {},
      el("summary", { text: "What happened, roll by roll" }),
      el(
        "div",
        { class: "lines", style: "margin-top: 8px" },
        f.rounds.map(r => [
          el("div", { class: "lbl", style: "margin-top: 6px", text: "Round " + r.round }),
          r.lines.map(l => lineView(l, heroName))
        ])
      )
    )
  );
}

function attackHead(lines: string[]): { what: string; roll: string; result: string } {
  const redirect = lines.find(l => /shoves .* into the way/.test(l));
  for (const l of lines) {
    const m = l.match(/^(.*?): (.*? vs AC \d+), (critical hit|hit|natural 1, miss|miss)/);
    if (m) {
      return { what: (redirect ? redirect + ". " : "") + m[1], roll: m[2], result: m[3] };
    }
  }
  return { what: "", roll: "", result: "" };
}

export function createCombatController(deps: CombatViewDeps) {
  function dispatchClosedRounds(combatId: string, closedRounds: number[]): void {
    const bundle = deps.getBundle();
    if (!bundle || !closedRounds.length) return;
    const gid = bundle.campaign.id;
    for (const roundNum of closedRounds) {
      setTimeout(async () => {
        const cur = deps.getBundle();
        if (!cur || cur.campaign.id !== gid) return;
        await narrateCombatRound(cur, deps.router, combatId, roundNum);
        if (deps.getBundle()?.campaign.id === gid) {
          deps.onRenderAll();
          deps.onSave();
        }
      }, 0);
    }
  }

  function rollInitiative(): void {
    const bundle = deps.getBundle();
    if (!bundle?.campaign.combat || bundle.campaign.combat.phase !== "init" || deps.isConflicted()) return;
    const cid = bundle.campaign.combat.id;
    let closedRounds: number[] = [];

    const res = commitBundleInPlace(bundle, "initiative", draft => {
      const c = draft.campaign.combat!;
      const dice = [d(20), d(20)];
      const r = Combat.start(
        { pc: draft.campaign.char, ...c.spec, seed: c.seed, foeRoster: draft.foeRoster },
        dice
      );
      if (!r.ok || !r.cs) throw new Error(r.msg);
      c.cs = r.cs;
      c.phase = "fight";
      c.feed = [newRoundEntry(1)];
      const mine = r.rolls.filter(x => x.why === "initiative " + r.cs!.actors.pc.name).map(x => x.v);
      c.feed[0].init = { dice: mine, total: r.cs.actors.pc.init };
      const ab = absorbCombatResult(draft, r, {
        skipRoundNarration: deps.router.isEconomyActive(),
        onDead: deps.onHeroDied
      });
      closedRounds = ab.closedRounds;
    });

    if (!res.ok) {
      deps.cui.msg = "Something went wrong rolling initiative; nothing changed.";
      deps.onRenderAll();
      return;
    }
    deps.cui.aim = null;
    deps.cui.msg = "";
    deps.cui.notes = [];
    deps.onRenderAll();
    deps.onSave();
    dispatchClosedRounds(cid, closedRounds);
  }

  function commitAttack(cmd: CombatCommand, script: number[], flavour: string): void {
    const bundle = deps.getBundle();
    if (!bundle?.campaign.combat?.cs) return;
    const cid = bundle.campaign.combat.id;
    const r = Combat.act(bundle.campaign.combat.cs, cmd, script);
    if (!r.ok) {
      commitBundleInPlace(bundle, "attack refused", draft => {
        if (draft.campaign.combat) draft.campaign.combat.roll = null;
      });
      deps.cui.msg = r.msg;
      deps.onRenderAll();
      deps.onSave();
      return;
    }

    let closedRounds: number[] = [];
    const res = commitBundleInPlace(bundle, "attack", draft => {
      draft.campaign.combat!.roll = null;
      addCombatFlavour(draft, flavour);
      closedRounds = absorbCombatResult(draft, r, {
        skipRoundNarration: deps.router.isEconomyActive(),
        onDead: deps.onHeroDied
      }).closedRounds;
    });

    if (!res.ok) {
      deps.cui.msg = "Something went wrong applying that attack; nothing changed.";
      deps.onRenderAll();
      return;
    }
    deps.onRenderAll();
    deps.onSave();
    dispatchClosedRounds(cid, closedRounds);
  }

  function rollAttack(): void {
    const bundle = deps.getBundle();
    const c = bundle?.campaign.combat;
    const aim = deps.cui.aim;
    if (!bundle || !c || c.phase !== "fight" || !c.cs || !aim || c.roll || deps.isConflicted()) return;

    const dry = Combat.act(c.cs, aim.cmd, [d(20), d(20)]);
    if (!dry.ok) {
      deps.cui.aim = null;
      deps.cui.msg = dry.msg;
      deps.onRenderCombatOnly();
      return;
    }

    let n = 0;
    while (n < dry.rolls.length && dry.rolls[n].why === "attack") n++;
    const atk = dry.rolls.slice(0, n).map(x => x.v);
    const dmg: Array<{ d: number; why: "damage" | "sneak attack" }> = [];
    for (let i = n; i < dry.rolls.length && /^(damage|sneak attack)$/.test(dry.rolls[i].why); i++) {
      dmg.push({ d: dry.rolls[i].d, why: dry.rolls[i].why as "damage" | "sneak attack" });
    }
    const head = attackHead(dry.lines);
    const label = `${aim.pv.weapon} → ${aim.pv.targetName}`;
    deps.cui.aim = null;

    if (!dmg.length) {
      commitAttack(aim.cmd, atk, aim.flavour);
      return;
    }

    const res = commitBundleInPlace(bundle, "attack roll", draft => {
      draft.campaign.combat!.roll = {
        cmd: aim.cmd,
        flavour: aim.flavour,
        atk,
        dmg,
        head,
        label,
        dmgText: `${aim.pv.dmg} ${aim.pv.type}${
          aim.pv.sneak && dmg.some(x => x.why === "sneak attack") ? ` + ${aim.pv.sneak} Sneak Attack` : ""
        }`
      };
    });
    if (res.ok) {
      deps.onRenderAll();
      deps.onSave();
    }
  }

  function rollDamage(): void {
    const bundle = deps.getBundle();
    const c = bundle?.campaign.combat;
    const roll = c?.roll;
    if (!roll || !c || c.phase !== "fight" || deps.isConflicted()) return;
    const dice = roll.dmg.map(x => d(x.d));
    commitAttack(roll.cmd, [...roll.atk, ...dice], roll.flavour);
  }

  function combatCmd(cmd: CombatCommand, flavour = ""): void {
    const bundle = deps.getBundle();
    const c = bundle?.campaign.combat;
    if (!bundle || !c || c.phase !== "fight" || !c.cs || deps.isConflicted() || c.roll || c.ruling || !cmd) return;
    const cid = c.id;

    deps.cui.msg = "";
    deps.cui.notes = [];
    deps.cui.aim = null;

    if ((cmd.type === "move" && cmd.dir === "toward") || cmd.type === "attack" || cmd.type === "offhand") {
      cmd = { ...cmd, target: cmd.target || deps.cui.target || undefined };
    }

    if (cmd.type === "attack" || cmd.type === "offhand") {
      let pv: any = null;
      try {
        pv = Combat.preview(c.cs, cmd);
      } catch {
        pv = null;
      }
      const test = Combat.act(c.cs, cmd, [1, 1]);
      if (!test.ok || !pv?.ok) {
        deps.cui.msg = (!test.ok ? test.msg : pv?.msg) || "Pick a target that's still fighting.";
        deps.cui.notes = test.notes || [];
        deps.onRenderCombatOnly();
        return;
      }
      deps.cui.aim = { cmd, pv, flavour: str(flavour, 200) };
      deps.cui.target = pv.target;
      deps.onRenderCombatOnly();
      return;
    }

    const r = Combat.act(c.cs, cmd);
    if (!r.ok) {
      deps.cui.msg = r.msg;
      deps.cui.notes = r.notes || [];
      deps.onRenderCombatOnly();
      return;
    }

    let closedRounds: number[] = [];
    const res = commitBundleInPlace(bundle, "combat " + cmd.type, draft => {
      addCombatFlavour(draft, flavour);
      closedRounds = absorbCombatResult(draft, r, {
        skipRoundNarration: deps.router.isEconomyActive(),
        onDead: deps.onHeroDied
      }).closedRounds;
    });
    if (!res.ok) {
      deps.cui.msg = "Something went wrong applying that move.";
      deps.onRenderAll();
      return;
    }
    deps.onRenderAll();
    deps.onSave();
    dispatchClosedRounds(cid, closedRounds);
  }

  async function askRuling(text: string): Promise<void> {
    const bundle = deps.getBundle();
    const c = bundle?.campaign.combat;
    if (!bundle || !c || c.phase !== "fight" || !c.cs) return;
    const gid = bundle.campaign.id;
    const cid = c.id;
    deps.cui.rulingInFlightCid = cid;
    deps.cui.msg = "";
    deps.cui.notes = [];
    deps.onRenderCombatOnly();

    const res = await requestCombatRuling(bundle, deps.router, text);
    if (deps.cui.rulingInFlightCid === cid) {
      deps.cui.rulingInFlightCid = null;
    }
    if (deps.getBundle()?.campaign.id !== gid) return;
    if (!res.applied && res.note) {
      deps.cui.notes = [res.note];
    }
    deps.onRenderAll();
    deps.onSave();
  }

  function submitCombat(rawText: string | undefined): void {
    const bundle = deps.getBundle();
    const c = bundle?.campaign.combat;
    const text = str(rawText, 300);
    if (!bundle || !c || !text) return;
    const box = $("#cact") as HTMLInputElement | null;
    if (box) box.value = "";

    if (!text.startsWith("/")) {
      if (c.phase !== "fight" || !c.cs || c.roll || c.ruling) return;
      if (deps.router.getEnabledConnections().length > 0 && c.cs.turn?.id === "pc" && !deps.cui.rulingInFlightCid) {
        askRuling(text);
        return;
      }
      commitBundleInPlace(bundle, "flavour", draft => addCombatFlavour(draft, text));
      deps.cui.msg = "";
      deps.cui.notes = [
        deps.cui.rulingInFlightCid
          ? "The narrator is still weighing your last idea; these words colour the round."
          : "Noted: your words colour this round's narration."
      ];
      deps.onRenderCombatOnly();
      deps.onSave();
      return;
    }

    const p = Combat.parse(text);
    if (!p) return;
    if (p.error || !p.cmd) {
      deps.cui.msg = (p.error || "Unknown command.") + " The chips below list what you can do.";
      deps.onRenderCombatOnly();
      return;
    }
    combatCmd(p.cmd, p.flavour);
  }

  function changePlan(): void {
    const bundle = deps.getBundle();
    const rl = bundle?.campaign.combat?.ruling;
    if (!bundle || !rl || deps.isConflicted()) return;
    const res = commitBundleInPlace(bundle, "change plan", draft => {
      if (draft.campaign.combat) draft.campaign.combat.ruling = null;
    });
    if (!res.ok) return;
    deps.cui.msg = "";
    deps.cui.notes = [];
    deps.onRenderAll();
    const box = $("#cact") as HTMLInputElement | null;
    if (box) {
      box.value = rl.text;
      box.focus();
    }
    deps.onSave();
  }

  function rollRuling(): void {
    const bundle = deps.getBundle();
    const c = bundle?.campaign.combat;
    const rl = c?.ruling;
    if (!bundle || !c || !c.cs || !rl || c.phase !== "fight" || c.roll || deps.isConflicted()) return;
    const cid = c.id;

    const { bonus } = rulingBonus(bundle.campaign.char, rl.ruling);
    const info = Combat.rulingInfo(c.cs, rl.ruling, bonus);
    if (!info.ok) {
      deps.cui.msg = info.msg || "Cannot perform that action right now.";
      deps.onRenderCombatOnly();
      return;
    }
    const cmd: CombatCommand = { type: "ruling", ruling: rl.ruling, bonus };
    const chk = info.adv ? [d(20), d(20)] : [d(20)];
    const dry = Combat.act(c.cs, cmd, chk);
    if (!dry.ok) {
      deps.cui.msg = dry.msg;
      deps.onRenderCombatOnly();
      return;
    }
    const extra = dry.rolls
      .slice(chk.length)
      .filter(x => x.why === "ruling damage" || x.why === "setback")
      .map(x => d(x.d));
    const r = Combat.act(c.cs, cmd, [...chk, ...extra]);
    if (!r.ok) {
      deps.cui.msg = r.msg;
      deps.onRenderCombatOnly();
      return;
    }

    let closedRounds: number[] = [];
    const txRes = commitBundleInPlace(bundle, "ruling roll", draft => {
      draft.campaign.combat!.ruling = null;
      addCombatFlavour(draft, rl.text);
      closedRounds = absorbCombatResult(draft, r, {
        skipRoundNarration: deps.router.isEconomyActive(),
        onDead: deps.onHeroDied
      }).closedRounds;
    });
    if (!txRes.ok) return;

    deps.cui.msg = "";
    deps.cui.notes = [];
    const cAfter = bundle.campaign.combat;
    if (r.res?.win && rl.ruling.follow && cAfter?.phase === "fight" && cAfter.cs?.turn?.id === "pc") {
      combatCmd(rl.ruling.follow.cmd);
      if (!deps.cui.aim) deps.onRenderAll();
    } else {
      if (rl.ruling.follow && !r.res?.win) {
        deps.cui.notes = ["The move didn't come off, so the follow-up is off too."];
      }
      deps.onRenderAll();
    }
    deps.onSave();
    dispatchClosedRounds(cid, closedRounds);
  }

  function leaveFight(): void {
    const bundle = deps.getBundle();
    if (!bundle?.campaign.combat || bundle.campaign.combat.phase !== "over" || deps.isConflicted()) return;
    let aftermath = "";
    const res = commitBundleInPlace(bundle, "fight over", draft => {
      aftermath = leaveFightInBundle(draft, pk).aftermathNote;
    });
    if (!res.ok) return;
    Object.assign(deps.cui, createCombatUiState());
    deps.onRenderAll();
    deps.onSave();
    if (
      aftermath &&
      bundle.campaign.status === "active" &&
      !bundle.campaign.char.dying &&
      deps.router.getEnabledConnections().length > 0
    ) {
      setTimeout(() => deps.onAftermathTurn(aftermath), 0);
    }
  }

  function foeChip(f: CombatActor, live: boolean, m: number): HTMLElement {
    const down = live && f.status !== "active";
    const word = hurtWord(f.hp, f.maxHp);
    const state = !live
      ? ""
      : f.status === "active"
      ? [
          nice(word),
          `${m} m`,
          f.fleeing ? "fleeing" : "",
          ...f.cond,
          f.fx.some(e => e.k === "sap") ? "sapped" : "",
          f.fx.some(e => e.k === "slow") ? "slowed" : ""
        ]
          .filter(Boolean)
          .join(" · ")
      : ({ dead: "Dead", out: "Knocked out", fled: "Fled", surrendered: "Surrendered" } as Record<string, string>)[
          f.status
        ] || "Down";

    return el(
      "button",
      {
        class: "o foe" + (down ? " gone" : ""),
        type: "button",
        "data-id": f.id,
        "aria-pressed": String(deps.cui.target === f.id),
        disabled: down || !live,
        onclick: () => {
          deps.cui.target = f.id;
          deps.cui.msg = "";
          deps.onRenderCombatOnly();
        }
      },
      live ? el("span", { text: f.init }) : null,
      el("b", { text: f.name }),
      state
        ? el("span", {
            class: "st " + (down ? "down" : word === "near death" ? "bloodied" : word),
            text: state
          })
        : null
    );
  }

  function gridView(bundle: CampaignBundle, cs: CombatState, open: boolean): HTMLElement {
    const { w, h, cells } = cs.map;
    const S = 36;
    const at = (x: number, y: number) => `left:${(x - 1) * S}px;top:${(y - 1) * S}px;width:${S}px;height:${S}px;`;
    const can = open ? Combat.reach(cs) : {};
    const kids: HTMLElement[] = [];

    for (let y = 1; y <= h; y++) {
      for (let x = 1; x <= w; x++) {
        const k = `${x},${y}`;
        if (can[k] != null) {
          kids.push(
            el("button", {
              type: "button",
              class: "st-grid-cell-reach",
              style: at(x, y),
              "data-xy": k,
              "aria-label": `Move to ${x}, ${y} (${can[k]} m)`,
              title: `Move to ${x},${y} · ${can[k]} m`
            })
          );
        }
        if (cells[k] === "wall") {
          kids.push(el("div", { class: "st-grid-wall", style: at(x, y), title: `${k} · wall` }));
        } else if (cells[k] === "rough") {
          kids.push(el("div", { class: "st-grid-rough", style: at(x, y), title: `${k} · rough ground, double cost` }));
        } else if (cells[k] === "cover") {
          kids.push(el("div", { class: "st-grid-cover", style: at(x, y), title: `${k} · cover, +2 AC against shots` }));
        }
      }
    }

    for (const a of Object.values(cs.actors)) {
      if (a.side !== "pc" && a.status !== "active") continue;
      if (a.side === "pc") {
        kids.push(
          el("span", {
            class: "st-grid-token is-pc",
            style: at(a.x, a.y),
            title: `${a.name}, you`,
            "aria-label": `${a.name}, you, at ${a.x},${a.y}`,
            text: a.name[0]
          })
        );
      } else {
        const aimed = deps.cui.target === a.id;
        const low = a.hp <= a.maxHp / 2;
        const word = hurtWord(a.hp, a.maxHp);
        const mark = a.name.match(/\d+$/)?.[0] || a.name[0];
        kids.push(
          el("button", {
            type: "button",
            class: `st-grid-token is-foe${low ? " is-low" : ""}${aimed ? " is-aimed" : ""}`,
            style: at(a.x, a.y),
            "data-id": a.id,
            "aria-pressed": aimed ? "true" : "false",
            "aria-label": `${a.name}, ${word}${aimed ? ", aimed at" : ""}`,
            title: `${a.name} (${word})`,
            text: mark
          })
        );
      }
    }

    return el(
      "div",
      {
        class: "st-grid-board",
        id: "grid",
        style: `width:${w * S}px;height:${h * S}px;background-size:${S}px ${S}px;`,
        role: "group",
        "aria-label": `Map of ${w} by ${h} squares, each 1.5 m`,
        onclick: (e: MouseEvent) => {
          const targetEl = e.target as HTMLElement | null;
          const foe = targetEl?.closest<HTMLElement>("[data-id]");
          const cell = targetEl?.closest<HTMLElement>("[data-xy]");
          if (foe?.dataset.id) {
            deps.cui.target = foe.dataset.id;
            deps.cui.msg = "";
            deps.onRenderCombatOnly();
          } else if (cell?.dataset.xy && open) {
            const [cx, cy] = cell.dataset.xy.split(",").map(Number);
            combatCmd({ type: "move", to: [cx, cy] });
          }
        }
      },
      kids
    );
  }

  function roundView(bundle: CampaignBundle, rd: CombatRoundEntry, c: ActiveCombat): HTMLElement {
    const G = bundle.campaign;
    const hero = c.cs?.actors.pc.name || G.char.name;
    const kids: (HTMLElement | null)[] = [el("span", { class: "lbl", text: "Round " + rd.round })];

    if (rd.init) {
      const dexm = mod(G.char.abil.dex);
      const kept = rd.init.total - dexm;
      const diceNodes = rd.init.dice.map(v =>
        el("div", {
          class: "die" + (rd.init!.dice.length > 1 && v !== kept ? " dim" : ""),
          style: "width: 36px; height: 36px; font-size: 17px",
          text: v
        })
      );
      kids.push(
        el(
          "div",
          { class: "roll done" },
          el(
            "div",
            { style: "display: flex; gap: 12px; align-items: center" },
            el("div", { style: "display: flex; gap: 6px; flex-wrap: wrap" }, diceNodes),
            el(
              "div",
              {},
              el("div", { class: "t", text: "Initiative" }),
              el("div", {
                class: "s",
                text: `${kept} ${dexm >= 0 ? "+" : "−"} ${Math.abs(dexm)} = ${rd.init.total}`
              })
            )
          )
        )
      );
    }

    if (rd.flavour) kids.push(el("div", { class: "you", text: rd.flavour }));
    if (rd.lines.length || (G.learn && rd.notes.length)) {
      kids.push(
        el(
          "div",
          { class: "lines" },
          rd.lines.map(l => lineView(l, hero)),
          G.learn ? rd.notes.map(n => el("div", { class: "note", text: n })) : null
        )
      );
    }

    if (rd.narr) {
      kids.push(deps.renderHighlight(rd.narr.line));
      if (rd.narr.sfx) {
        kids.push(
          el("div", { class: "sfx", role: "img", "aria-label": "Sound: " + rd.narr.sfx }, el("b", { text: rd.narr.sfx }))
        );
      }
      if (rd.narr.say) {
        const isFoe =
          c.cs && Object.values(c.cs.actors).some(a => a.side === "foe" && a.name === rd.narr!.say!.who);
        kids.push(
          isFoe
            ? el(
                "div",
                { class: "say hostile" },
                el("div", { class: "av", "aria-hidden": "true", text: rd.narr.say.who[0] }),
                el(
                  "div",
                  { style: "max-width: 86%" },
                  el("div", { class: "who", text: rd.narr.say.who }),
                  el("div", { class: "bub", text: "“" + rd.narr.say.text + "”" })
                )
              )
            : deps.renderSpeechSeg(rd.narr.say.who, rd.narr.say.text)
        );
      }
    } else if (rd.status === "narrating") {
      kids.push(el("div", { class: "thinking wait" }, "The narrator writes", el("i"), el("i"), el("i")));
    }
    if (rd.status === "failed" && rd.lines.length) {
      kids.push(
        el("div", {
          class: "muted",
          style: "font-size: 13px",
          text: "No narration for this round; the lines above are what happened."
        })
      );
    }
    return el("div", { class: "rnd" }, kids);
  }

  function chipList(c: ActiveCombat) {
    if (c.phase !== "fight" || !c.cs) return [];
    const av = Combat.available(c.cs);
    if (!av.mine) return [];
    const tgt =
      deps.cui.target && c.cs.actors[deps.cui.target]?.status === "active"
        ? c.cs.actors[deps.cui.target]
        : null;
    const list: Array<{ key: string; label: string; cmd: CombatCommand; alt?: boolean }> = [];
    const add = (key: string, label: string, cmd: CombatCommand, alt?: boolean) =>
      list.push({ key, label, cmd, alt });
    const has = (k: string) => av.commands.includes(k);

    if (has("attack")) add("attack", "/attack" + (tgt ? " " + tgt.name.toLowerCase() : ""), { type: "attack" });
    if (has("offhand")) add("offhand", "/offhand", { type: "offhand" });
    if (has("second_wind")) add("second_wind", "/second_wind", { type: "second_wind" });
    if (has("use")) add("use", "/drink potion", { type: "use" });
    if (has("move") && av.targets.some(f => f.m > Combat.SQ)) {
      const tgtFar = tgt && (av.targets.find(f => f.id === tgt.id)?.m ?? 0) > Combat.SQ;
      add(
        "move",
        "/move toward" + (tgtFar ? " " + tgt!.name.toLowerCase() : ""),
        { type: "move", dir: "toward" },
        true
      );
    }
    if (has("move")) add("retreat", "/retreat", { type: "move", dir: "away" }, true);
    for (const k of ["stand", "dash", "disengage", "dodge", "hide", "end"]) {
      if (has(k)) add(k, "/" + k, { type: k }, true);
    }
    return list;
  }

  function combatCards(bundle: CampaignBundle, c: ActiveCombat): HTMLElement[] {
    const G = bundle.campaign;
    const out: HTMLElement[] = [];

    if (c.phase === "init") {
      const dexm = mod(G.char.abil.dex);
      const dis = c.spec.surprise === "pc" || armourClass(G.char).untrained;
      out.push(
        el(
          "div",
          { class: "roll" },
          el(
            "div",
            {},
            el("div", { class: "t", text: "Roll initiative" + (dis ? " · disadvantage" : "") }),
            el("div", {
              class: "s",
              text:
                `d20 ${dexm >= 0 ? "+" : "−"} ${Math.abs(dexm)}` +
                (dis ? " · roll two, keep the lower" : "") +
                (c.spec.surprise === "foes" ? " · the foes are surprised" : "")
            }),
            G.learn
              ? el("div", {
                  class: "why",
                  text:
                    "Initiative sets the turn order: a d20 plus your Dexterity modifier. Each kind of monster rolls once for its whole group." +
                    (c.spec.surprise === "pc"
                      ? " You were surprised, so you roll with Disadvantage."
                      : c.spec.surprise === "foes"
                      ? " The foes were surprised, so they roll with Disadvantage."
                      : "")
                })
              : null
          ),
          el(
            "button",
            { class: "btn", id: "rollinit", type: "button", onclick: rollInitiative },
            svgIcon("dice-twenty-faces-twenty", "#1a160e", 20),
            " Roll initiative"
          )
        )
      );
    }

    if (c.phase === "fight" && deps.cui.rulingInFlightCid === c.id) {
      out.push(el("div", { class: "thinking", id: "rthink" }, "The narrator weighs your idea", el("i"), el("i"), el("i")));
    }

    if (c.phase === "fight" && c.cs && c.ruling && !c.roll) {
      const { bonus } = rulingBonus(G.char, c.ruling.ruling);
      out.push(
        renderRulingCard({
          bundle,
          rl: c.ruling,
          info: Combat.rulingInfo(c.cs, c.ruling.ruling, bonus),
          inFight: true,
          onRoll: rollRuling,
          onChange: changePlan
        })
      );
    }

    if (c.phase === "fight" && c.roll) {
      const r = c.roll;
      const crit = /critical/.test(r.head.result);
      const faces: Record<number, number> = {};
      for (const x of r.dmg) faces[x.d] = (faces[x.d] || 0) + 1;
      out.push(
        el(
          "div",
          { class: "roll" },
          el(
            "div",
            {},
            el(
              "div",
              { class: "shot mine yes" + (crit ? " crit" : ""), style: "border: 0; padding: 0" },
              el("div", { class: "big", text: crit ? "CRITICAL" : "HIT" }),
              el("div", {}, el("div", { class: "t", text: r.head.what || r.label }), el("div", { class: "s", text: r.head.roll }))
            ),
            el("div", {
              class: "s",
              style: "margin-top: 4px",
              text: `Damage ${r.dmgText} · roll ${Object.entries(faces)
                .map(([f, n]) => `${n > 1 ? n : ""}d${f}`)
                .join(" + ")}`
            }),
            G.learn && crit
              ? el("div", {
                  class: "why",
                  text: "A natural 20 is a critical hit: roll every damage die twice, then add the modifier once."
                })
              : null
          ),
          el(
            "button",
            { class: "btn", id: "rolldmg", type: "button", onclick: rollDamage },
            svgIcon("dice-twenty-faces-twenty", "#1a160e", 20),
            " Roll damage"
          )
        )
      );
    } else if (c.phase === "fight" && deps.cui.aim) {
      const p = deps.cui.aim.pv;
      const mode =
        p.adv > 0
          ? ` · Advantage (${p.advWhy.join(", ")})`
          : p.adv < 0
          ? ` · Disadvantage (${p.disWhy.join(", ")})`
          : p.advWhy.length && p.disWhy.length
          ? " · Advantage and Disadvantage cancel out"
          : "";
      out.push(
        el(
          "div",
          { class: "roll" },
          el(
            "div",
            {},
            el("div", {
              class: "t",
              text: `${deps.cui.aim.cmd.type === "offhand" ? "Off-hand attack" : "Attack"}: ${p.weapon} → ${p.targetName}`
            }),
            el("div", { class: "s", text: `d20 ${p.bonus >= 0 ? "+" : "−"} ${Math.abs(p.bonus)} vs AC ${p.ac}${mode}` }),
            el("div", {
              class: "s",
              text: `Damage ${p.dmg} ${p.type}${p.sneak ? ` + ${p.sneak} Sneak Attack` : ""}`
            }),
            G.learn
              ? el("div", {
                  class: "why",
                  text:
                    p.why +
                    (p.adv
                      ? p.adv > 0
                        ? " With Advantage you roll two d20s and keep the higher."
                        : " With Disadvantage you roll two d20s and keep the lower."
                      : "")
                })
              : null
          ),
          el(
            "div",
            { style: "display: flex; gap: 8px; flex-wrap: wrap" },
            el(
              "button",
              {
                class: "btn ghost",
                type: "button",
                onclick: () => {
                  deps.cui.aim = null;
                  deps.onRenderCombatOnly();
                }
              },
              "Cancel"
            ),
            el(
              "button",
              { class: "btn", id: "rollatk", type: "button", onclick: rollAttack },
              svgIcon("dice-twenty-faces-twenty", "#1a160e", 20),
              " Roll attack"
            )
          )
        )
      );
    }

    if (c.phase === "over") {
      const head =
        c.result === "victory"
          ? "The fight is won"
          : c.result === "fled"
          ? "You got away"
          : c.dead
          ? `${G.char.name} is killed`
          : `${G.char.name} falls`;
      out.push(
        el(
          "div",
          { class: "roll" },
          el(
            "div",
            {},
            el("div", { class: "t", text: head }),
            el(
              "div",
              { class: "chips", style: "margin-top: 6px" },
              c.chips.map(([t, k]) => el("span", { class: "chip " + (k || ""), text: t }))
            ),
            c.result === "defeat" && !c.dead && G.learn
              ? el("div", {
                  class: "why",
                  text: "At 0 HP you fall unconscious and start making death saving throws. Back in the story, roll them until you stabilise or die."
                })
              : null
          ),
          el(
            "button",
            { class: "btn", id: "fightdone", type: "button", onclick: leaveFight },
            c.result === "defeat" && !c.dead ? "Continue to your death saves" : "Back to the story"
          )
        )
      );
    }

    return out;
  }

  function renderCombat(): void {
    const host = $("#cstage");
    const bundle = deps.getBundle();
    const c = bundle?.campaign.combat;
    if (!host || !bundle || !c) return;
    const G = bundle.campaign;

    const keep = ($("#cact") as HTMLInputElement | null)?.value || "";
    const focused = document.activeElement?.id === "cact";
    const live = Boolean(c.cs);
    const open = c.phase === "fight" && !c.roll && !c.ruling && !deps.isConflicted();

    const cs =
      c.cs ||
      Combat.start({ pc: G.char, ...c.spec, seed: c.seed, foeRoster: bundle.foeRoster }, [10, 10]).cs!;
    const av = Combat.available(cs);
    const pc = cs.actors.pc;
    const placeName = G.place && bundle.entities[G.place] ? bundle.entities[G.place].name : "The skirmish";

    const mapSection = el(
      "section",
      { "aria-label": "Map", "data-slot": "battle-map" },
      gridView(bundle, cs, open && live),
      el(
        "div",
        { style: "display:flex;justify-content:space-between;align-items:center;gap:12px;color:var(--st-map-ink-deep)" },
        el("span", { class: "st-fr", style: "font-size:19px;font-style:italic;font-weight:500", text: placeName }),
        el("span", { style: "font-size:14px", text: "one square is 1.5 m" })
      ),
      el(
        "div",
        { style: "display:flex;flex-wrap:wrap;gap:6px 16px;font-size:14px;color:var(--st-ink-muted)" },
        el("span", { style: "display:flex;align-items:center;gap:6px" }, el("span", { style: "width:14px;height:14px;background:repeating-linear-gradient(45deg,var(--st-map-ink) 0 3px,rgba(134,163,221,.55) 3px 6px)" }), "wall"),
        el("span", { style: "display:flex;align-items:center;gap:6px" }, el("span", { style: "width:14px;height:14px;background-image:radial-gradient(var(--st-map-ink) 1.2px,transparent 1.6px);background-size:7px 7px" }), "rough ground, double cost"),
        el("span", { style: "display:flex;align-items:center;gap:6px" }, el("span", { style: "width:12px;height:12px;border-radius:50%;border:2px solid var(--st-map-ink)" }), "cover, +2 armour against shots"),
        el("span", { style: "display:flex;align-items:center;gap:6px" }, el("span", { style: "width:14px;height:14px;background:rgba(220,174,74,.45)" }), "you can reach")
      )
    );

    const logSection = el(
      "section",
      { class: "st-combat-log", "aria-label": "What happened", id: "cfeed", "data-slot": "combat-log" },
      c.feed.map(rd =>
        el(
          "div",
          { style: "display:flex;flex-direction:column;gap:10px" },
          el("div", { class: "st-h", text: `Round ${rd.round}` }),
          roundView(bundle, rd, c)
        )
      ),
      combatCards(bundle, c)
    );

    const econRow = (label: string, val: string, ready: boolean) =>
      el(
        "div",
        { style: "display:flex;align-items:center;gap:10px" },
        el("span", { class: `st-econ-dot${ready ? "" : " is-spent"}`, "aria-hidden": "true" }),
        el(
          "span",
          null,
          el("span", { style: "display:block;font-size:14px;color:var(--st-ink-muted)", text: label }),
          el("span", { class: "st-fr", style: `display:block;font-size:19px;font-weight:600;color:${ready ? "var(--st-ink)" : "var(--st-ink-muted)"}`, text: val })
        )
      );

    const turn =
      live && av.mine
        ? el(
            "div",
            { class: "st-econ-grid", id: "turn", "aria-label": "Left this turn", "data-slot": "turn-economy" },
            econRow("Action", av.action ? "Ready" : av.attacksLeft > 0 ? `${av.attacksLeft} left` : "Spent", Boolean(av.action || av.attacksLeft > 0)),
            econRow("Bonus action", av.bonus ? "Ready" : "Spent", Boolean(av.bonus)),
            econRow("Movement", `${av.move} of ${pc.speed} m`, av.move >= Combat.SQ),
            econRow("Reaction", av.reaction ? "Ready" : "Spent", Boolean(av.reaction))
          )
        : null;

    const aimedFoe = deps.cui.target ? cs.actors[deps.cui.target] : null;
    const aimedLine =
      aimedFoe && aimedFoe.status === "active"
        ? el(
            "div",
            { style: "font-size:15px;color:var(--st-ink-muted)", "data-slot": "aim-readout" },
            "Aiming at ",
            el("b", { style: "color:var(--st-accent-foe)", text: aimedFoe.name }),
            `, ${Combat.SQ * Math.max(Math.abs(aimedFoe.x - pc.x), Math.abs(aimedFoe.y - pc.y))} m away, ${hurtWord(aimedFoe.hp, aimedFoe.maxHp)}.`
          )
        : null;

    const locked = !open;
    const chips = chipList(c).map(x =>
      el(
        "button",
        {
          class: x.alt ? "st-btn-quiet" : "st-btn-ink",
          type: "button",
          "data-slot": "combat-action",
          "data-cmd": x.key,
          disabled: locked,
          onclick: () => combatCmd(x.cmd)
        },
        x.label
      )
    );

    const msg =
      deps.cui.msg || (G.learn ? deps.cui.notes : []).length
        ? el(
            "div",
            { class: "st-pl", role: "status", style: "color:var(--st-accent-foe)" },
            deps.cui.msg || null,
            (G.learn ? deps.cui.notes : []).map(n => el("div", { class: "st-pl", text: n }))
          )
        : null;

    const bar = el(
      "form",
      {
        class: "st-combat-controls",
        id: "cform",
        "data-slot": "combat-controls",
        onsubmit: (e: Event) => {
          e.preventDefault();
          submitCombat(($("#cact") as HTMLInputElement | null)?.value);
        }
      },
      turn,
      aimedLine,
      chips.length ? el("div", { style: "display:flex;flex-wrap:wrap;gap:8px" }, chips) : null,
      msg,
      el(
        "div",
        { style: "display:flex;align-items:flex-end;gap:12px" },
        el("span", { style: "color:var(--st-accent-player);margin-bottom:12px" }, quillSvg(18)),
        el("label", { for: "cact", class: "sr-only" }, "Say it your way"),
        el("input", {
          id: "cact",
          class: "st-hand-input",
          autocomplete: "off",
          maxlength: "300",
          disabled: locked,
          placeholder:
            c.phase === "init"
              ? "Roll initiative first"
              : c.roll
              ? "Roll damage first"
              : c.ruling
              ? "Roll, or change your plan"
              : c.phase === "over"
              ? "The fight is over"
              : "or say it your way: kick the brazier at the boss"
        }),
        el("button", { class: "st-btn-primary", type: "submit", disabled: locked }, "Send")
      ),
      el("div", {
        class: "st-pl",
        text: "Tap a gold square to move there, a foe to aim at it. Anything the buttons don't cover, write it (or use /commands) and the narrator rules on it."
      })
    );

    put(
      host,
      el(
        "div",
        { "data-slot": "page-running-head" },
        el("span", { class: "st-gd", style: "font-style:italic;font-size:16px", text: "Solo Tales" }),
        el("span", { class: "st-gd", style: "font-variant:small-caps;letter-spacing:.06em;font-size:16px", text: placeName }),
        el("span", { text: `round ${cs.round}` })
      ),
      el("div", { class: "st-fight-split" }, mapSection, logSection),
      bar
    );
    const box = $("#cact") as HTMLInputElement | null;
    if (box) {
      box.value = keep;
      if (focused && !box.disabled) box.focus();
    }
    const sc = $("#cfeed");
    if (sc) requestAnimationFrame(() => (sc.scrollTop = sc.scrollHeight));
  }

  function renderCombatSheet(box: HTMLElement): void {
    const bundle = deps.getBundle();
    const c = bundle?.campaign.combat;
    if (!bundle || !c) return;
    const ch = bundle.campaign.char;
    const pc = c.cs?.actors.pc;
    const t = c.cs?.turn?.id === "pc" && !c.cs?.over;
    const hp = pc ? pc.hp : ch.hp;
    const AC = armourClass(ch);
    const conds = pc && c.phase !== "over" ? pc.cond : ch.conditions;
    const heroUrl = deps.portraits.getUrl(ch.portraitId, deps.store, () => renderCombatSheet(box));
    const pct = Math.max(0, Math.min(100, Math.round((hp / Math.max(1, ch.maxHp)) * 100)));

    put(
      box,
      el(
        "div",
        { class: "st-hero-identity" },
        heroUrl
          ? el("img", { src: heroUrl, alt: ch.name, class: "st-portrait-thumb" })
          : heraldicShieldSvg(),
        el(
          "div",
          null,
          el("div", { class: "st-fr", style: "font-size:26px;font-weight:600;line-height:1.1;color:var(--st-rail-ink-bright)", text: ch.name }),
          el("div", {
            class: "st-rl",
            text: `${ch.cls} ${ch.level} · ${
              c.phase === "init" ? "initiative" : c.phase === "over" ? "fight over" : t ? "your turn" : "waiting"
            }`
          })
        )
      ),
      el(
        "div",
        { style: "display:flex;flex-direction:column;gap:8px" },
        el(
          "div",
          { style: "display:flex;justify-content:space-between;align-items:baseline" },
          el("span", { class: "st-rl", text: "Hit points" }),
          el("span", null, el("span", { class: "st-fr", style: "font-size:24px;font-weight:600;color:var(--st-rail-ink-bright)", text: String(hp) }), el("span", { class: "st-rl", text: ` of ${ch.maxHp}` }))
        ),
        el("div", { class: "st-bar-track", role: "img", "aria-label": `${hp} of ${ch.maxHp} hit points` }, el("div", { class: "st-bar-fill-hp", style: `width:${pct}%` }))
      ),
      el(
        "div",
        { class: "st-rail-stats2" },
        el("div", { title: AC.why }, el("div", { class: "st-fr", style: "font-size:24px;font-weight:600;color:var(--st-rail-ink-bright)", text: String(pc ? pc.ac : AC.ac) }), el("div", { class: "st-rl", text: "Armour" })),
        el("div", null, el("div", { class: "st-fr", style: "font-size:24px;font-weight:600;color:var(--st-rail-ink-bright)", text: `${pc ? pc.speed : ch.speed} m` }), el("div", { class: "st-rl", text: "Speed" }))
      ),
      el(
        "div",
        { style: "display:flex;flex-direction:column;gap:10px;font-size:15px" },
        pc?.res?.second_wind
          ? (() => {
              const sw = pc.res!.second_wind!;
              return el(
                "div",
                { style: "display:flex;justify-content:space-between;align-items:center" },
                el("span", { text: "Second Wind" }),
                el(
                  "span",
                  { class: "st-dot-pips" },
                  ...Array.from({ length: sw.max }, (_, i) =>
                    el("span", { class: `st-dot-pip${i < sw.left ? "" : " is-spent"}` })
                  )
                )
              );
            })()
          : null,
        el(
          "div",
          { style: "display:flex;justify-content:space-between" },
          el("span", { text: "Conditions" }),
          el("span", { class: "st-rl", text: conds.map(nice).join(", ") || "None" })
        )
      )
    );
  }

  function renderCombatPanel(host: HTMLElement): void {
    const bundle = deps.getBundle();
    const c = bundle?.campaign.combat;
    if (!bundle || !c) return;
    const cs =
      c.cs ||
      Combat.start({ pc: bundle.campaign.char, ...c.spec, seed: c.seed, foeRoster: bundle.foeRoster }, [10, 10]).cs!;
    const live = Boolean(c.cs);
    const pc = cs.actors.pc;
    const orderIds = live ? cs.order : Object.keys(cs.actors).filter(id => id !== "pc");

    put(
      host,
      el("h2", { class: "st-fr", style: "margin:0 0 8px;font-size:22px;font-style:italic;font-weight:500;color:var(--st-rail-ink-bright)", text: "Who acts when" }),
      ...orderIds.map(id => {
        const a = cs.actors[id];
        const isPc = a.side === "pc";
        const isCurrent = live && cs.turn?.id === id && !cs.over;
        const isAimed = !isPc && deps.cui.target === id;
        const dist = Combat.SQ * Math.max(Math.abs(a.x - pc.x), Math.abs(a.y - pc.y));
        const note = isPc
          ? isCurrent
            ? "acting now"
            : "ready"
          : a.status !== "active"
          ? a.status
          : `${hurtWord(a.hp, a.maxHp)}, ${dist} m${isAimed ? ", aimed at" : ""}`;
        return el(
          "button",
          {
            type: "button",
            class: `st-init-row${isCurrent ? " is-current" : ""}${isAimed ? " is-aimed" : ""}`,
            disabled: isPc || a.status !== "active" || !live,
            onclick: () => {
              if (!isPc && a.status === "active") {
                deps.cui.target = id;
                deps.onRenderCombatOnly();
              }
            }
          },
          el("span", { class: "st-fr", style: "flex:0 0 26px;font-size:18px;font-weight:600;color:var(--st-rail-gold)", text: live ? String(a.init) : "–" }),
          el(
            "span",
            { style: "flex:1;min-width:0" },
            el(
              "span",
              { style: "display:flex;align-items:center;gap:8px;font-weight:700" },
              el("span", {
                "aria-hidden": "true",
                style: isPc
                  ? "flex:0 0 auto;width:11px;height:11px;border-radius:3px;background:var(--st-rail-player)"
                  : "flex:0 0 auto;width:11px;height:11px;border-radius:50%;background:var(--st-rail-foe)"
              }),
              isPc ? `${a.name.split(" ")[0]}, you` : a.name
            ),
            el("span", { class: "st-rl", style: "display:block", text: note })
          )
        );
      }),
      el("div", { class: "st-rl", style: "margin-top:10px", text: "Foes show how they stand, never their exact hit points." })
    );
  }

  return {
    renderCombat,
    renderCombatSheet,
    renderCombatPanel
  };
}
