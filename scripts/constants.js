import { defineModule } from "./lib.js";

export const MODULE_ID = "gatos-turn-control";

/** Library handle: mod.L("Tracker.Delay") → "GTC.Tracker.Delay", settings name/hint keys under "GTC.Settings". */
export const mod = defineModule(MODULE_ID, { langPrefix: "GTC" });

/** Combatant flag keys */
export const FLAGS = {
  noTurn: "noTurn",
  delay: "delay",
  hiddenDead: "hiddenDead",
  groupRemains: "groupRemains"
};

/** Initiative spacing used when a delaying combatant re-enters the order. */
export const INIT_STEP = 0.01;
export const INIT_TIE_EPSILON = 0.0002;
