import { describe, expect, it } from "vitest";
import {
  ARMOUR,
  Combat,
  HEROES,
  MONSTERS,
  SCHEMA,
  WEAPONS,
  absorbCombatResult,
  armourClass,
  attacksOf,
  cleanFoeTemplate,
  cleanRuling,
  clone,
  createCampaignBundle,
  migrate,
  newRoundEntry,
  resolveMonsterDef,
  transactBundle
} from "../src/engine";

describe("Headless 2024 5e Engine Parity & Hardening", () => {
  it("freezes SRD tables and computes 2024 weapon masteries & AC accurately", () => {
    expect(Object.isFrozen(MONSTERS)).toBe(true);
    expect(Object.isFrozen(WEAPONS)).toBe(true);
    expect(Object.isFrozen(ARMOUR)).toBe(true);

    const fighter = createCampaignBundle({ heroKey: "fighter" }).campaign.char;
    const ac = armourClass(fighter);
    // Chain shirt (13) + Dex +2 (max 2) + Shield (+2) = 17, or starter fighter gear
    expect(ac.ac).toBeGreaterThanOrEqual(15);

    const atks = attacksOf(fighter);
    expect(atks.length).toBeGreaterThan(0);
    expect(atks.some(a => a.mastery !== null)).toBe(true);

    const rogue = createCampaignBundle({ heroKey: "rogue" }).campaign.char;
    const rogueAtks = attacksOf(rogue);
    const finesseAtk = rogueAtks.find(a => a.props.includes("finesse"));
    expect(finesseAtk?.abil).toBe("dex");
  });

  it("enforces grid terrain (walls block LoS, cover grants +2 AC, rough costs double move) and Opportunity Attacks", () => {
    const pc = createCampaignBundle({ heroKey: "fighter" }).campaign.char;
    const startRes = Combat.start(
      {
        pc,
        hero: [2, 3],
        foes: [{ ref: "goblin_warrior", n: 1, at: [[5, 3]], name: "Goblin Scout" }],
        map: {
          w: 8,
          h: 6,
          rough: [[3, 3]],
          cover: [[4, 3]]
        },
        seed: 42
      },
      [20, 1] // PC wins initiative (roll 20 vs 1)
    );

    expect(startRes.ok).toBe(true);
    const cs0 = startRes.cs!;
    expect(cs0.order[cs0.cur]).toBe("pc");

    // Moving onto rough terrain (3,3) should cost 3m (double 1.5m square) instead of 1.5m
    const moveRough = Combat.act(cs0, { type: "move", to: [3, 3] });
    expect(moveRough.ok).toBe(true);
    expect(moveRough.cs!.turn!.move).toBeCloseTo(pc.speed - 3.0, 2);

    // Wall blocking Line of Sight for ranged attacks
    const wallFight = Combat.start(
      {
        pc: createCampaignBundle({ heroKey: "rogue" }).campaign.char,
        hero: [2, 2],
        foes: [{ ref: "bandit", n: 1, at: [[6, 2]], name: "Archer" }],
        map: {
          w: 8,
          h: 6,
          wall: [[4, 2]]
        },
        seed: 7
      },
      [20, 1]
    ).cs!;
    const archerId = Object.values(wallFight.actors).find(a => a.side === "foe")!.id;

    const pvBlocked = Combat.preview(wallFight, {
      type: "attack",
      weapon: "shortbow",
      target: archerId
    });
    expect(pvBlocked).not.toBeNull();
    expect(pvBlocked!.ok).toBe(false);
    expect((pvBlocked!.msg || "").toLowerCase()).toContain("wall");

    // Opportunity Attack triggered when leaving adjacent foe's reach without Disengage
    const oaStart = Combat.start(
      {
        pc: createCampaignBundle({ heroKey: "fighter" }).campaign.char,
        hero: [2, 3],
        foes: [{ ref: "bandit", n: 1, at: [[3, 3]], name: "Cutthroat" }],
        map: { w: 8, h: 6 },
        seed: 99
      },
      [20, 1]
    ).cs!;

    const retreatStep = Combat.act(oaStart, { type: "move", to: [1, 3] });
    expect(retreatStep.ok).toBe(true);
    expect(retreatStep.lines.some(l => l.includes("opportunity attack"))).toBe(true);
  });

  it("caps Creative Rulings strictly to the rules menu and character level", () => {
    const char = createCampaignBundle({ heroKey: "fighter" }).campaign.char; // Level 1
    const rawOverpowered = {
      name: "Chandelier Drop",
      cost: "free action",
      check: { skill: "acrobatics", dc: 14 },
      success: {
        damage: "8d10+20",
        type: "bludgeoning",
        condition: "paralyzed",
        push: true
      },
      failure: "prone"
    };

    const cleaned = cleanRuling(rawOverpowered, true, char);
    expect(cleaned).not.toBeNull();
    // Free action that deals damage is upgraded to 'action'
    expect(cleaned!.cost).toBe("action");
    // DC 14 snaps to nearest scale value (13 or 15)
    expect([13, 15]).toContain(cleaned!.check.dc);
    // Damage 8d10+20 is capped to Level 1 capDice (2d6)
    expect(cleaned!.success.damage).toBe(Combat.capDice(1));
    // Paralyzed is not on the allowed condition menu; push remains as the single allowed effect
    expect(cleaned!.success.effect).toEqual({ k: "push" });
    expect(cleaned!.capped.length).toBeGreaterThanOrEqual(3);
  });

  it("rolls back CampaignBundle atomically when transactBundle throws mid-mutation", () => {
    const bundle = createCampaignBundle({ name: "Oakvale", heroKey: "rogue" });
    const initialHp = bundle.campaign.char.hp;
    const initialTurn = bundle.campaign.turn;

    const failed = transactBundle(bundle, "faulty mutation", draft => {
      draft.campaign.char.hp = 1;
      draft.campaign.turn = 99;
      draft.entities.npc_ghost = { id: "npc_ghost", kind: "npc", name: "Corrupted" };
      throw new Error("Simulated mid-turn crash");
    });

    expect(failed.ok).toBe(false);
    expect(bundle.campaign.char.hp).toBe(initialHp);
    expect(bundle.campaign.turn).toBe(initialTurn);
    expect(bundle.entities.npc_ghost).toBeUndefined();
  });

  it("migrates legacy v8 saves (including ZONE8 combat) cleanly to Schema v10", () => {
    const legacyV8 = {
      v: 8,
      id: "camp_old",
      name: "Old Brookhollow",
      char: {
        name: "Bram",
        cls: "Fighter",
        species: "Human",
        level: 2,
        hp: 16,
        maxHp: 20,
        abil: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
        inv: [{ id: "i1", name: "Longsword", qty: 1, eq: true }]
      },
      combat: {
        id: "c_legacy",
        phase: "init",
        seed: 123,
        spec: {
          foes: [{ ref: "goblin_warrior", n: 2, zone: 1 }]
        }
      }
    };

    const migrated = migrate(legacyV8);
    expect(migrated).not.toBeNull();
    expect(migrated!.v).toBe(SCHEMA);
    expect(migrated!.name).toBe("Old Brookhollow");
    expect(migrated!.char.level).toBe(2);
    expect(migrated!.combat).not.toBeNull();
    expect(migrated!.combat!.spec.map.w).toBe(20);
    expect(migrated!.combat!.spec.foes[0].d).toBe(6);
  });

  it("resolves setting-flavoured FoeTemplates and syncs slain named NPC foes (PT-030 fix)", () => {
    const bundle = createCampaignBundle({ name: "Redbriar", heroKey: "fighter" });
    bundle.entities.npc_skab = {
      id: "npc_skab",
      kind: "npc",
      name: "Skabgrim",
      role: "Forager Chief",
      loc: "place_mill",
      met: 1,
      att: -2
    };

    const tpl = cleanFoeTemplate({
      id: "skabgrim_boss",
      name: "Skabgrim",
      baseRef: "goblin_warrior",
      npcId: "npc_skab"
    })!;
    bundle.foeRoster.skabgrim_boss = tpl;

    const resolved = resolveMonsterDef("skabgrim_boss", bundle.foeRoster);
    expect(resolved).not.toBeNull();
    expect(resolved!.name).toBe("Skabgrim");
    expect(resolved!.ac).toBe(MONSTERS.goblin_warrior.ac);

    // Start a 1 HP duel so PC slays Skabgrim cleanly and verify PT-030 entity sync
    const start = Combat.start(
      {
        pc: bundle.campaign.char,
        hero: [2, 2],
        foes: [{ ref: "skabgrim_boss", n: 1, at: [[3, 2]], name: "Skabgrim", npcId: "npc_skab" }],
        map: { w: 6, h: 6 },
        foeRoster: bundle.foeRoster,
        seed: 11
      },
      [20, 1]
    );
    const cs = start.cs!;
    const foeActor = Object.values(cs.actors).find(a => a.side === "foe")!;
    foeActor.hp = 1; // 1 HP left

    bundle.campaign.combat = {
      v: 1,
      id: "fight_pt030",
      phase: "fight",
      place: "place_mill",
      started: 1,
      seed: 11,
      spec: {
        map: { w: 6, h: 6, wall: [], rough: [], cover: [] },
        hero: [2, 2],
        surprise: null,
        foes: [{ ref: "skabgrim_boss", n: 1, at: [[3, 2]], name: "Skabgrim", npcId: "npc_skab" }]
      },
      cs,
      feed: [newRoundEntry(1)],
      roll: null,
      ruling: null,
      result: null,
      dead: false,
      reward: null,
      chips: []
    };

    const atkWeapon = attacksOf(bundle.campaign.char)[0].key;
    const step = Combat.act(
      cs,
      { type: "attack", weapon: atkWeapon, target: foeActor.id },
      [20, 20, 8, 8] // Natural 20 crit -> lethal kill
    );
    expect(step.cs!.over?.result).toBe("victory");

    absorbCombatResult(bundle, step, { skipRoundNarration: true });

    expect(bundle.entities.npc_skab.combatStatus).toBe("dead");
    expect(bundle.entities.npc_skab.loc).toBeNull();
    expect(
      Object.values(bundle.facts).some(
        f => f.known.includes("player") && f.text.includes("Skabgrim was slain in battle")
      )
    ).toBe(true);
  });
});
