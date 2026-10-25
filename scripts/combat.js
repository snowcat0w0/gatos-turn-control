import { MODULE_ID, FLAGS } from "./constants.js";
import { getSetting } from "./settings.js";
import { isExcluded, getBlockers, isConfused } from "./rules.js";
import { getDelay, doResume } from "./delay.js";
import { runAsGM } from "./socket.js";
import { adapter } from "./systems/index.js";
import { postBlocked, rollConfusion, postDelayLost } from "./chat.js";

/** Turn starts already handled on this client, so re-entrant updates do not double-post. */
const handledStarts = new Set();

/**
 * Extend the system's Combat class so every way of advancing the tracker (sidebar, HUDs, macros)
 * passes over combatants that have no turn.
 */
export function createCombatClass(Base) {
  return class TurnControlCombat extends Base {
    /** Silently passed over, never becomes the current turn. */
    _gtcSkip(combatant) {
      if (isExcluded(combatant)) return true;
      return !!this.settings?.skipDefeated && combatant.isDefeated;
    }

    _gtcFirst(from = 0) {
      for (let i = from; i < this.turns.length; i++) if (!this._gtcSkip(this.turns[i])) return i;
      return null;
    }

    _gtcLast(before = this.turns.length) {
      for (let i = before - 1; i >= 0; i--) if (!this._gtcSkip(this.turns[i])) return i;
      return null;
    }

    async startCombat() {
      this._playCombatSound("startEncounter");
      const updateData = { round: 1, turn: this._gtcFirst() ?? 0 };
      Hooks.callAll("combatStart", this, updateData);
      await this.update(updateData);
      return this;
    }

    async nextRound() {
      let turn = this.turn === null || this.turns.length === 0 ? null : 0;
      if (turn !== null) {
        turn = this._gtcFirst();
        if (turn === null) {
          ui.notifications.warn("COMBAT.NoneRemaining", { localize: true });
          turn = 0;
        }
      }
      const nextRound = this.round + 1;
      const advanceTime = this.getTimeDelta(this.round, this.turn, nextRound, turn);
      const updateData = { round: nextRound, turn };
      const updateOptions = { direction: 1, worldTime: { delta: advanceTime } };
      Hooks.callAll("combatRound", this, updateData, updateOptions);
      await this.update(updateData, updateOptions);
      return this;
    }

    async previousRound() {
      if (this.round === 0) return this;
      let turn = this.round === 1 || this.turn === null || this.turns.length === 0 ? null : this.turns.length - 1;
      if (turn !== null) turn = this._gtcLast() ?? turn;
      const previousRound = this.round - 1;
      const advanceTime = this.getTimeDelta(this.round, this.turn, previousRound, turn);
      const updateData = { round: previousRound, turn };
      const updateOptions = { direction: -1, worldTime: { delta: advanceTime } };
      Hooks.callAll("combatRound", this, updateData, updateOptions);
      await this.update(updateData, updateOptions);
      return this;
    }

    async nextTurn() {
      if (this.round === 0) return this.nextRound();

      // A delaying combatant asked to act right after the current one.
      const current = this.combatant;
      if (current) {
        const queued = this.turns.find((c) => c !== current && getDelay(c)?.after === current.id);
        if (queued) {
          const data = { combatId: this.id, combatantId: queued.id, mode: "after", anchorId: current.id };
          if (game.user.isGM) await doResume(data, game.user);
          else await runAsGM("resume", data);
          return this;
        }
      }

      const next = this._gtcFirst((this.turn ?? -1) + 1);
      if (next === null) return this.nextRound();
      const advanceTime = this.getTimeDelta(this.round, this.turn, this.round, next);
      const updateData = { round: this.round, turn: next };
      const updateOptions = { direction: 1, worldTime: { delta: advanceTime } };
      Hooks.callAll("combatTurn", this, updateData, updateOptions);
      await this.update(updateData, updateOptions);
      return this;
    }

    async previousTurn() {
      if (this.round === 0) return this;
      const prev = this._gtcLast(this.turn ?? this.turns.length);
      if (prev === null) return this.previousRound();
      const advanceTime = this.getTimeDelta(this.round, this.turn, this.round, prev);
      const updateData = { round: this.round, turn: prev };
      const updateOptions = { direction: -1, worldTime: { delta: advanceTime } };
      Hooks.callAll("combatTurn", this, updateData, updateOptions);
      await this.update(updateData, updateOptions);
      return this;
    }

    /* ------------------------------------------ */
    /*  PF1: CombatPF turn upkeep hooks            */
    /* ------------------------------------------ */

    /** Resume transitions are handled by the updateCombat hook instead of the system's turn logic. */
    async _onNewTurn(changed, options, userId) {
      if (options?.[MODULE_ID]?.resume) return;
      // The system only runs end-of-turn upkeep when the turn index right before the new one was not
      // skipped, so jumping over an excluded combatant would drop the ending combatant's upkeep.
      if (this._gtcEndTurnDropped(changed, options)) {
        try {
          await this._processEndTurn(options.pf1.from, options);
        } catch (err) {
          console.error(`${MODULE_ID} | end turn upkeep failed`, err);
        }
      }
      return super._onNewTurn(changed, options, userId);
    }

    /** Mirrors CombatPF#_detectSkippedTurns to tell whether the system will omit _processEndTurn. */
    _gtcEndTurnDropped(changed, options) {
      const from = options?.pf1?.from;
      if (!from || !Number.isInteger(from.turn) || !Number.isInteger(this.turn)) return false;
      if (!this._isForwardTime?.(changed, options)) return false;
      const roundChanged = this.round !== from.round;
      if (!roundChanged && from.turn + 1 === this.turn) return false;
      const isSkipped = (i) => !(!roundChanged && i <= from.turn) && (i < this.turn || (roundChanged && i > from.turn));
      const len = this.turns.length;
      const prevIdx = (((this.turn - 1) % len) + len) % len;
      // Ending combatant counted as skipped is already handled by _handleSkippedTurns.
      return isSkipped(prevIdx) && !isSkipped(from.turn);
    }

    /** Runs on the active owner of the current actor once the system's turn-start upkeep is done. */
    async _processTurnStart(changed, options) {
      if (typeof super._processTurnStart === "function") await super._processTurnStart(changed, options);
      try {
        await onTurnStart(this, options);
      } catch (err) {
        console.error(`${MODULE_ID} | turn start handling failed`, err);
      }
    }

    /* ------------------------------------------ */
    /*  Other systems: core turn events (active GM) */
    /* ------------------------------------------ */

    async _onStartTurn(combatant, context) {
      await super._onStartTurn(combatant, context);
      if (adapter().turnStartUpkeep || context?.skipped || combatant !== this.combatant) return;
      // Not awaited: advancing the turn from inside the core turn-event loop would nest it.
      onTurnStart(this, {}, { gm: true }).catch((err) => console.error(`${MODULE_ID} | turn start handling failed`, err));
    }

    /** The system's own turn-start handler, without this module's checks. */
    async _gtcSystemStartTurn(combatant, context) {
      return super._onStartTurn(combatant, context);
    }
  };
}

function canAnyoneAct(combat, except) {
  return combat.turns.some((c) => c !== except && !combat._gtcSkip(c) && !getBlockers(c.actor).length);
}

async function pause() {
  const ms = getSetting("autoEndPause");
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/** True when the combat still sits on the same turn we started handling. */
function stillCurrent(combat, combatant, round, turn) {
  return game.combats.has(combat.id) && combat.round === round && combat.turn === turn && combat.combatant === combatant;
}

/**
 * @param {object} [runner]
 * @param {boolean} [runner.gm]  Runs on the active GM (core turn events) instead of the actor's active owner (PF1).
 */
async function onTurnStart(combat, options = {}, { gm = false } = {}) {
  const combatant = combat.combatant;
  const actor = combatant?.actor;
  if (!combatant || !actor) return;
  if (gm ? !game.user.isActiveGM : !actor.activeOwner?.isSelf) return;

  const { round, turn } = combat;
  const key = `${combat.id}.${round}.${turn}.${combatant.id}.${options?.[MODULE_ID]?.resume ? "r" : "n"}`;
  if (handledStarts.has(key)) return;
  handledStarts.add(key);
  if (handledStarts.size > 500) handledStarts.clear();

  // Reaching the regular turn while still delaying forfeits the delayed action.
  const delay = getDelay(combatant);
  if (delay) {
    await combatant.unsetFlag(MODULE_ID, FLAGS.delay);
    if (getSetting("announceDelay") && !options?.[MODULE_ID]?.resume) await postDelayLost(combatant);
  }

  // Excluded combatants should never be current; move on quietly if one is (e.g. flagged mid-turn).
  if (combat._gtcSkip(combatant)) {
    if (combat.turns.some((c) => !combat._gtcSkip(c))) await combat.nextTurn();
    return;
  }

  if (!getSetting("autoEndTurn")) return;

  const blockers = getBlockers(actor);
  if (blockers.length) {
    const advance = canAnyoneAct(combat, combatant);
    await postBlocked(combatant, blockers, { advanced: advance });
    if (!advance) return;
    await pause();
    if (stillCurrent(combat, combatant, round, turn)) await combat.nextTurn();
    return;
  }

  if (getSetting("confusion") && isConfused(actor)) {
    const result = await rollConfusion(combatant);
    if (!result.skip) return;
    await pause();
    if (stillCurrent(combat, combatant, round, turn)) await combat.nextTurn();
  }
}

/** Turn start / end upkeep for a delayed combatant re-entering the order (see doResume). */
export async function onResumeUpdate(combat, changed, options) {
  const info = options?.[MODULE_ID];
  if (!info?.resume) return;

  if (!adapter().turnStartUpkeep) {
    if (!game.user.isActiveGM) return;
    const ctx = { round: combat.round, turn: combat.turn, skipped: false };
    const ended = info.ended ? combat.combatants.get(info.ended) : null;
    try {
      if (ended) await combat._onEndTurn(ended, ctx);
      if (combat.combatant) await combat._gtcSystemStartTurn(combat.combatant, ctx);
    } catch (err) {
      console.error(err);
    }
    return onTurnStart(combat, options, { gm: true });
  }

  if (info.ended) {
    const idx = combat.turns.findIndex((c) => c.id === info.ended);
    if (idx >= 0) {
      try {
        await combat._processEndTurn({ turn: idx, round: combat.round }, options);
      } catch (err) {
        console.error(err);
      }
    }
  }
  await combat._processTurnStart(changed, options);
}
