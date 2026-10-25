import { MODULE_ID, FLAGS, INIT_STEP, INIT_TIE_EPSILON, mod } from "./constants.js";
import { canControl } from "./lib.js";
import { getSetting } from "./settings.js";
import { getBlockers } from "./rules.js";
import { registerHandler, runAsGM } from "./socket.js";
import { postDelay, postResume } from "./chat.js";

export function getDelay(combatant) {
  return combatant?.getFlag(MODULE_ID, FLAGS.delay) ?? null;
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;
const initOf = (c) => (Number.isFinite(c?.initiative) ? c.initiative : null);

/**
 * Initiative updates that move `mover` directly before or after `anchor` in the turn order.
 * Per the Delay rules the delayed action takes place on the anchor's initiative count, so the new
 * value sits right next to it; ties are resolved by nudging the lower group down a hair.
 */
export function computeInsertion(combat, mover, anchor, mode) {
  const order = combat.turns.filter((c) => c !== mover);
  const ai = order.indexOf(anchor);
  if (ai < 0 || initOf(anchor) === null) return null;
  const hi = mode === "before" ? order[ai - 1] : anchor;
  const lo = mode === "before" ? anchor : order[ai + 1];
  const hiV = initOf(hi);
  const loV = initOf(lo);
  const updates = [];
  let value;

  if (!hi || hiV === null) value = loV + INIT_STEP;
  else if (!lo || loV === null) value = hiV - INIT_STEP;
  else if (hiV > loV) {
    const step = Math.min(INIT_STEP, (hiV - loV) / 2);
    value = mode === "before" ? loV + step : hiV - step;
  } else {
    // Tie: push the lower group (and anyone tied after it) down so the mover fits between.
    const li = order.indexOf(lo);
    for (let i = li; i < order.length && initOf(order[i]) === loV; i++) {
      updates.push({ _id: order[i].id, initiative: round6(loV - INIT_TIE_EPSILON) });
    }
    value = loV - INIT_TIE_EPSILON / 2;
  }
  updates.push({ _id: mover.id, initiative: round6(value) });
  return { updates, value: round6(value) };
}

/* -------------------------------------------- */
/*  Actions (GM side)                           */
/* -------------------------------------------- */

async function doDelay({ combatId, combatantId }, user) {
  const combat = game.combats.get(combatId);
  const combatant = combat?.combatants.get(combatantId);
  if (!combatant || !canControl(user, combatant)) return;
  if (!combat.started || combat.combatant?.id !== combatant.id) {
    return mod.notify.warn("Warn.DelayNotYourTurn");
  }
  if (getBlockers(combatant.actor).length) {
    return mod.notify.warn("Warn.DelayBlocked");
  }
  await combatant.setFlag(MODULE_ID, FLAGS.delay, {
    round: combat.round,
    initiative: combatant.initiative,
    after: null
  });
  if (getSetting("announceDelay")) await postDelay(combatant);
  await combat.nextTurn();
}

/**
 * Bring a delaying combatant back into the order and make it the current turn.
 * mode "before": acts now, ahead of the current combatant (who has not acted yet).
 * mode "after": acts right after `anchorId` finishes its turn.
 */
export async function doResume({ combatId, combatantId, mode = "before", anchorId }, user) {
  const combat = game.combats.get(combatId);
  const mover = combat?.combatants.get(combatantId);
  const delay = getDelay(mover);
  if (!mover || !delay) return;
  const anchor = combat.combatants.get(anchorId) ?? combat.combatant;
  if (!anchor || anchor === mover) return;
  // Whoever ends the anchor's turn triggers a delayed action queued after it.
  const queuedOnAnchor = mode === "after" && delay.after === anchor.id && combat.combatant === anchor;
  if (!canControl(user, mover) && !(queuedOnAnchor && canControl(user, anchor))) return;

  const ins = computeInsertion(combat, mover, anchor, mode);
  if (!ins) return mod.notify.warn("Warn.NoAnchorInitiative");
  ins.updates.find((u) => u._id === mover.id)[mod.flagDeleteKey(FLAGS.delay)] = null;

  await combat.updateEmbeddedDocuments("Combatant", ins.updates, { turnEvents: false });
  const newTurn = combat.turns.findIndex((c) => c.id === mover.id);
  if (getSetting("announceDelay")) await postResume(mover, { initiative: ins.value, anchorName: anchor.name, mode });
  // Object marker (not mod.mark()): combat.js reads `options[MODULE_ID].resume / .ended`.
  await combat.update(
    { turn: newTurn, [mod.flagKey("resumeSeq")]: foundry.utils.randomID() },
    { turnEvents: false, [MODULE_ID]: { resume: mover.id, ended: mode === "after" ? anchor.id : null } }
  );
}

async function doQueueAfter({ combatId, combatantId, anchorId }, user) {
  const combat = game.combats.get(combatId);
  const mover = combat?.combatants.get(combatantId);
  const delay = getDelay(mover);
  if (!mover || !delay || !canControl(user, mover)) return;
  const after = delay.after === anchorId ? null : anchorId;
  await mover.setFlag(MODULE_ID, FLAGS.delay, { ...delay, after });
}

async function doCancelDelay({ combatId, combatantId }, user) {
  const combatant = game.combats.get(combatId)?.combatants.get(combatantId);
  if (!combatant || !canControl(user, combatant)) return;
  await combatant.unsetFlag(MODULE_ID, FLAGS.delay);
}

async function doToggleNoTurn({ combatId, combatantId }, user) {
  if (!user?.isGM) return;
  const combatant = game.combats.get(combatId)?.combatants.get(combatantId);
  if (!combatant) return;
  const on = !combatant.getFlag(MODULE_ID, FLAGS.noTurn);
  await combatant.setFlag(MODULE_ID, FLAGS.noTurn, on);
}

export function registerDelayHandlers() {
  registerHandler("delay", doDelay);
  registerHandler("resume", doResume);
  registerHandler("queueAfter", doQueueAfter);
  registerHandler("cancelDelay", doCancelDelay);
  registerHandler("toggleNoTurn", doToggleNoTurn);
}

/* -------------------------------------------- */
/*  Client API                                  */
/* -------------------------------------------- */

const ref = (combatant) => ({ combatId: combatant.parent.id, combatantId: combatant.id });

export const api = {
  delay: (combatant) => runAsGM("delay", ref(combatant)),
  resumeNow: (combatant) =>
    runAsGM("resume", { ...ref(combatant), mode: "before", anchorId: combatant.parent.combatant?.id }),
  queueAfterCurrent: (combatant) =>
    runAsGM("queueAfter", { ...ref(combatant), anchorId: combatant.parent.combatant?.id }),
  cancelDelay: (combatant) => runAsGM("cancelDelay", ref(combatant)),
  toggleNoTurn: (combatant) => runAsGM("toggleNoTurn", ref(combatant))
};
