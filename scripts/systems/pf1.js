/**
 * Pathfinder 1e rules (Core Rulebook, Appendix 2: Conditions and Injury and Death).
 * Conditions that leave a creature unable to take actions; `default` = ends the turn out of the box.
 */
const CONDITIONS = [
  { id: "dead", default: true },
  { id: "dying", default: true },
  { id: "petrified", default: true },
  { id: "unconscious", default: true },
  { id: "sleep", default: true },
  { id: "stunned", default: true },
  { id: "dazed", default: true },
  { id: "cowering", default: true },
  { id: "paralyzed", default: true },
  { id: "helpless", default: false },
  { id: "panicked", default: false },
  { id: "nauseated", default: false },
  { id: "staggered", default: false },
  { id: "disabled", default: false }
];

const LIVING_TYPES = new Set(["character", "npc"]);

function usesWoundsAndVigor(actor) {
  try {
    const cfg = game.settings.get("pf1", "healthConfig");
    const kind = actor.type === "character" ? "pc" : "npc";
    return !!cfg?.[kind]?.rules?.useWoundsAndVigor;
  } catch {
    return false;
  }
}

/** Diehard / ferocity let a creature keep acting while at negative hit points. */
function ignoresDying(actor) {
  return actor.items.some((i) => {
    if (!["feat", "buff"].includes(i.type)) return false;
    if (i.type === "buff" && !i.isActive) return false;
    const tag = i.system?.tag ?? "";
    return /^(diehard|ferocity)$/i.test(tag) || /diehard|ferocity|불굴|흉포/i.test(i.name);
  });
}

export default {
  id: "pf1",
  /** Uses CombatPF's turn-start upkeep (buff expiry) on the actor owner's client. */
  turnStartUpkeep: true,
  hpStates: true,
  confusion: true,
  stabilize: true,

  conditions() {
    return CONDITIONS.map((c) => {
      const reg = pf1.registry?.conditions?.get(c.id);
      return { ...c, label: reg ? game.i18n.localize(reg.name) : c.id, img: reg?.texture };
    });
  },

  hint(id) {
    const key = `GTC.Condition.${id}`;
    return game.i18n.has(key) ? game.i18n.localize(key) : "";
  },

  /**
   * Standard (non wounds/vigor) hit points. PF1 stores damage as an offset; `hp.value` is the current total.
   * Creatures without a Constitution score (undead, constructs) are destroyed at 0.
   */
  getHealth(actor) {
    if (!actor || !LIVING_TYPES.has(actor.type) || usesWoundsAndVigor(actor)) return null;
    const hp = actor.system?.attributes?.hp;
    if (!hp || !Number.isFinite(hp.value)) return null;
    const conTotal = actor.system?.abilities?.con?.total;
    const con = Number.isFinite(conTotal) && conTotal > 0 ? conTotal : 0;
    return { value: hp.value, nonlethal: hp.nonlethal || 0, deathAt: -con };
  },

  /** Dying (negative HP, not stable) and unconscious from nonlethal damage. */
  hpStateBlockers(actor, health) {
    if (!health || health.value <= health.deathAt) return [];
    if (health.value < 0 && !actor.statuses.has("stable") && !ignoresDying(actor)) {
      return [{ id: "dying", dying: true }];
    }
    if (health.value > 0 && health.nonlethal > health.value) {
      return [{ id: "unconscious", hint: game.i18n.localize("GTC.Condition.nonlethal") }];
    }
    return [];
  },

  async rollStabilize(actor, health) {
    const bonus = health && health.value < 0 ? String(health.value) : "";
    return actor.rollAbilityTest("con", { bonus, dc: 10, skipDialog: true });
  }
};
