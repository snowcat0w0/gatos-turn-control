import { MODULE_ID, FLAGS } from "./constants.js";
import { getSetting, enabledBlockingConditions } from "./settings.js";
import { adapter } from "./systems/index.js";

/** @returns {{value:number, deathAt:number, nonlethal?:number}|null} */
export function getHealth(actor) {
  return adapter().getHealth(actor);
}

/** Hit points at or below the death threshold, for actors the "death by HP" setting applies to. */
export function isHpDead(actor) {
  const mode = getSetting("hpDeath");
  if (!actor || mode === "off") return false;
  if (mode === "npc" && actor.hasPlayerOwner) return false;
  const h = getHealth(actor);
  return !!h && h.value <= h.deathAt;
}

/**
 * Why this combatant gets no turn at all (silently skipped), or null.
 * The combatant stays in the encounter, so experience is still awarded for it.
 * @returns {"manual"|"defeated"|"hpDead"|null}
 */
export function getExclusion(combatant) {
  if (!combatant) return null;
  if (combatant.getFlag(MODULE_ID, FLAGS.noTurn)) return "manual";
  if (getSetting("excludeDefeated") && combatant.isDefeated) return "defeated";
  if (isHpDead(combatant.actor)) return "hpDead";
  return null;
}

export function isExcluded(combatant) {
  return getExclusion(combatant) !== null;
}

function conditionInfo() {
  return new Map(adapter().conditions().map((c) => [c.id, c]));
}

/**
 * Conditions that keep the actor from taking any action this turn.
 * @returns {{id:string, label:string, hint:string, dying?:boolean}[]}
 */
export function getBlockers(actor) {
  if (!actor) return [];
  const rules = adapter();
  const enabled = enabledBlockingConditions();
  const info = conditionInfo();
  const out = [];
  const seen = new Set();
  const add = (id, extra = {}) => {
    if (seen.has(id) || !enabled.has(id)) return;
    seen.add(id);
    out.push({ id, label: info.get(id)?.label ?? id, hint: rules.hint(id), ...extra });
  };

  for (const id of info.keys()) {
    if (actor.statuses?.has(id)) add(id, { dying: id === "dying" });
  }

  if (rules.hpStates && getSetting("hpStates")) {
    const h = getHealth(actor);
    if (h && h.value <= h.deathAt) add("dead");
    for (const b of rules.hpStateBlockers(actor, h)) add(b.id, b);
  }
  return out;
}

export function isConfused(actor) {
  return adapter().confusion && !!actor?.statuses?.has("confused");
}
