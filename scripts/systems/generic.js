/**
 * Any other game system: conditions come from CONFIG.statusEffects, hit points from a configurable path.
 */
import { mod } from "../constants.js";

const DEFAULT_BLOCKING = new Set([
  "dead",
  "unconscious",
  "sleep",
  "asleep",
  "sleeping",
  "stun",
  "stunned",
  "paralysis",
  "paralyzed",
  "paralysed",
  "petrified",
  "incapacitated",
  "dazed",
  "cowering",
  "dying"
]);

export default {
  id: "generic",
  turnStartUpkeep: false,
  hpStates: false,
  confusion: false,
  stabilize: false,

  conditions() {
    const seen = new Set();
    const out = [];
    for (const effect of CONFIG.statusEffects ?? []) {
      if (!effect?.id || seen.has(effect.id)) continue;
      seen.add(effect.id);
      out.push({
        id: effect.id,
        default: DEFAULT_BLOCKING.has(effect.id),
        label: game.i18n.localize(effect.name ?? effect.label ?? effect.id),
        img: effect.img ?? effect.icon
      });
    }
    return out;
  },

  hint() {
    return "";
  },

  /** Reads the hit point value at the configured path (e.g. system.attributes.hp.value). */
  getHealth(actor) {
    const path = mod.setting("hpPath")?.trim();
    if (!actor || !path) return null;
    const raw = foundry.utils.getProperty(actor, path);
    if (raw === null || raw === undefined || raw === "") return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return { value, deathAt: Number(mod.setting("hpDeathAt")) || 0 };
  },

  hpStateBlockers() {
    return [];
  }
};
