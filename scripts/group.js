import { MODULE_ID, FLAGS, mod } from "./constants.js";
import { getSetting } from "./settings.js";
import { isHpDead } from "./rules.js";

/** Same dead test as visibility.js, but for a bare token (no combatant). */
function tokenIsDead(token) {
  const actor = token.actor;
  if (!actor) return true;
  if (actor.statuses?.has("dead") || actor.statuses?.has(CONFIG.specialStatusEffects.DEFEATED)) return true;
  return isHpDead(actor);
}

/**
 * Living tokens of the same kind (same base actor, unlinked) on the scene that are not in this combat,
 * nearest first, visible ones before hidden ones.
 */
function findSuccessor(combat, combatant) {
  const dead = combatant.token;
  const scene = dead?.parent;
  if (!scene || dead.actorLink || !dead.actorId) return null;
  const inCombat = new Set(combat.combatants.map((c) => c.tokenId));
  const candidates = scene.tokens.filter(
    (t) => t.actorId === dead.actorId && !t.actorLink && !inCombat.has(t.id) && !tokenIsDead(t)
  );
  if (!candidates.length) return null;
  const dist = (t) => Math.hypot(t.x - dead.x, t.y - dead.y);
  candidates.sort((a, b) => Number(a.hidden) - Number(b.hidden) || dist(a) - dist(b));
  return candidates[0];
}

/**
 * When a representative combatant's token dies while others of its kind still live, move the combatant
 * (initiative, turn position) onto a living token and keep the dead token in the encounter as its own
 * turnless combatant so experience still counts it.
 * @returns {Promise<boolean>} whether anything changed
 */
export async function swapDeadRepresentatives(combat, isDead) {
  if (!getSetting("groupSwap")) return false;
  let changed = false;
  for (const combatant of [...combat.combatants]) {
    if (!combatant.token || combatant.getFlag(MODULE_ID, FLAGS.groupRemains)) continue;
    if (!isDead(combatant)) continue;
    const successor = findSuccessor(combat, combatant);
    if (!successor) continue;

    const deadToken = combatant.token;
    const hiddenByUs = !!combatant.getFlag(MODULE_ID, FLAGS.hiddenDead);
    await combat.createEmbeddedDocuments("Combatant", [
      {
        tokenId: deadToken.id,
        sceneId: deadToken.parent.id,
        actorId: deadToken.actorId,
        initiative: null,
        defeated: combatant.defeated,
        hidden: combatant.hidden,
        flags: { [MODULE_ID]: { [FLAGS.groupRemains]: true, [FLAGS.noTurn]: true, [FLAGS.hiddenDead]: hiddenByUs } }
      }
    ]);
    await combatant.update({
      tokenId: successor.id,
      actorId: successor.actorId,
      defeated: false,
      hidden: successor.hidden,
      [mod.flagDeleteKey(FLAGS.hiddenDead)]: null,
      [mod.flagDeleteKey(FLAGS.noTurn)]: null
    });
    ui.notifications.info(mod.L("Notify.GroupSwap", { dead: deadToken.name, next: successor.name }));
    changed = true;
  }
  return changed;
}
