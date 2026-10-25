import { MODULE_ID, FLAGS, mod } from "./constants.js";
import { keyedDebounce } from "./lib.js";
import { getSetting } from "./settings.js";
import { isExcluded, isHpDead } from "./rules.js";
import { swapDeadRepresentatives } from "./group.js";

/** Dead by the defeated marker, the Dead condition or hit points at/below the death threshold. */
export function isDead(combatant) {
  if (combatant.isDefeated) return true;
  const actor = combatant.actor;
  if (!actor) return false;
  if (actor.statuses?.has("dead")) return true;
  return isHpDead(actor);
}

function shouldHide(combatant) {
  return getSetting("hideDeadTokens") && isExcluded(combatant) && isDead(combatant);
}

/**
 * Hide tokens of dead, turn-excluded combatants from players (canvas and tracker), and show them again
 * if they come back. Only touches tokens this module hid, so GM-hidden tokens stay as they are.
 */
async function syncCombat(combat) {
  if (!game.user.isActiveGM || !combat || !game.combats.has(combat.id)) return;
  await swapDeadRepresentatives(combat, isDead);
  for (const combatant of combat.combatants) {
    const token = combatant.token;
    if (!token) continue;
    const hiddenByUs = !!combatant.getFlag(MODULE_ID, FLAGS.hiddenDead);
    const hide = shouldHide(combatant);
    if (hide && !hiddenByUs && !token.hidden) {
      await token.update({ hidden: true });
      await combatant.update({ hidden: true, [mod.flagKey(FLAGS.hiddenDead)]: true });
    } else if (!hide && hiddenByUs) {
      await token.update({ hidden: false });
      await combatant.update({ hidden: false, [mod.flagKey(FLAGS.hiddenDead)]: _del });
    }
  }
}

/**
 * Debounced per combat (250 ms, timer restarts on each request); a request that arrives while a sync is
 * running schedules exactly one more run afterwards — the 0.2.0 `pending`/`running` maps, now keyedDebounce.
 */
const scheduledSync = keyedDebounce((combat) => syncCombat(combat), 250, {
  restart: true,
  coalesce: true,
  onError: (err) => console.error(`${MODULE_ID} | token visibility sync failed`, err)
});

export function scheduleSync(combat) {
  if (!game.user.isActiveGM || !combat) return;
  scheduledSync(combat.id, combat);
}

function combatsWithActor(actor) {
  return game.combats.filter((c) => c.combatants.some((cb) => cb.actor === actor || cb.actorId === actor.id));
}

export function registerVisibilityHooks() {
  Hooks.on("updateActor", (actor) => combatsWithActor(actor).forEach(scheduleSync));
  Hooks.on("updateToken", (token) => {
    game.combats.filter((c) => c.combatants.some((cb) => cb.tokenId === token.id)).forEach(scheduleSync);
  });
  for (const hook of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"]) {
    Hooks.on(hook, (effect) => {
      if (effect.parent instanceof Actor) combatsWithActor(effect.parent).forEach(scheduleSync);
    });
  }
  Hooks.on("createCombatant", (combatant) => scheduleSync(combatant.parent));
  Hooks.on("updateCombatant", (combatant, changes) => {
    // Ignore our own visibility writes (a v14 _del deletion also shows up under the plain flag key).
    if (foundry.utils.hasProperty(changes, mod.flagKey(FLAGS.hiddenDead))) return;
    scheduleSync(combatant.parent);
  });
  Hooks.once("ready", () => game.combats.forEach(scheduleSync));

  // Show the bodies again once the encounter is over (e.g. for looting).
  Hooks.on("deleteCombat", async (combat) => {
    if (!game.user.isActiveGM || !getSetting("revealOnCombatEnd")) return;
    for (const combatant of combat.combatants) {
      if (!combatant.getFlag(MODULE_ID, FLAGS.hiddenDead)) continue;
      const token = combatant.token;
      if (token?.hidden && token.parent?.tokens.has(token.id)) await token.update({ hidden: false });
    }
  });
}
