import pf1 from "./pf1.js";
import generic from "./generic.js";

/** Rules adapter for the running game system. */
export function adapter() {
  return game.system?.id === "pf1" ? pf1 : generic;
}

export function isPF1() {
  return game.system?.id === "pf1";
}
