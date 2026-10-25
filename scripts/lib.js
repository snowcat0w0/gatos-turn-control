/**
 * Library shim (gatos-lib PLAN §5.1): the only place this module names the library path.
 * Import everything from "./lib.js" inside the module. System-agnostic module: gatos-lib only
 * (the PF1 rules adapter in systems/pf1.js stays local on purpose, PLAN §5.0 rule 3).
 */
export * from "../../gatos-lib/scripts/index.js";
