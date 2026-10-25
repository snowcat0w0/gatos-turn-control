import { MODULE_ID, mod } from "./constants.js";
import { scheduleSync } from "./visibility.js";
import { adapter, isPF1 } from "./systems/index.js";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export function getSetting(key) {
  return mod.setting(key);
}

export function defaultBlockingConditions() {
  return Object.fromEntries(adapter().conditions().map((c) => [c.id, c.default]));
}

/** @returns {Set<string>} condition ids that end the turn automatically */
export function enabledBlockingConditions() {
  const stored = getSetting("blockingConditions") ?? {};
  const merged = { ...defaultBlockingConditions(), ...stored };
  return new Set(Object.entries(merged).filter(([, on]) => on).map(([id]) => id));
}

/**
 * Settings, unchanged from 0.2.0 (keys, scopes, types, defaults, choices, onChange, name/hint keys and order).
 * name/hint default to `GTC.Settings.<PascalKey>.Name/.Hint`; the four PF1-conditional entries spell them out
 * because the library only derives them for `config: true` settings.
 */
export function registerSettings() {
  const t = (k) => `GTC.Settings.${k}`;
  const pf1 = isPF1();
  const rerender = () => ui.combat?.render();
  const resync = () => game.combats.forEach(scheduleSync);

  mod.registerSettings({
    excludeDefeated: { type: Boolean, default: true, onChange: rerender },
    hpDeath: {
      hintKey: t(pf1 ? "HpDeath.Hint" : "HpDeath.HintGeneric"),
      type: String,
      choices: { off: t("HpDeath.Off"), npc: t("HpDeath.Npc"), all: t("HpDeath.All") },
      default: "npc",
      onChange: rerender
    },
    // Other systems: where hit points live and at what value a creature counts as dead.
    hpPath: { name: t("HpPath.Name"), hint: t("HpPath.Hint"), config: !pf1, type: String, default: "system.attributes.hp.value", onChange: rerender },
    hpDeathAt: { name: t("HpDeathAt.Name"), hint: t("HpDeathAt.Hint"), config: !pf1, type: Number, default: 0, onChange: rerender },
    hideDeadTokens: { type: Boolean, default: true, onChange: resync },
    revealOnCombatEnd: { type: Boolean, default: true },
    groupSwap: { type: Boolean, default: true, onChange: resync },
    hpStates: { name: t("HpStates.Name"), hint: t("HpStates.Hint"), config: pf1, type: Boolean, default: true, onChange: rerender },
    autoEndTurn: { type: Boolean, default: true },
    confusion: { name: t("Confusion.Name"), hint: t("Confusion.Hint"), config: pf1, type: Boolean, default: true },
    announceDelay: { type: Boolean, default: true },
    autoEndPause: { type: Number, range: { min: 0, max: 3000, step: 100 }, default: 600 },
    blockingConditions: { hidden: true, type: Object, default: {}, onChange: rerender },
    blockingConditionsMenu: {
      nameKey: t("BlockingMenu.Name"),
      labelKey: t("BlockingMenu.Label"),
      hintKey: t("BlockingMenu.Hint"),
      menu: { icon: "fa-solid fa-face-dizzy", type: BlockingConditionsConfig, restricted: true }
    }
  });
}

class BlockingConditionsConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "gtc-blocking-conditions",
    tag: "form",
    classes: ["gtc-config"],
    window: { title: "GTC.Settings.BlockingMenu.Name", icon: "fa-solid fa-face-dizzy" },
    position: { width: 460 },
    form: {
      handler: BlockingConditionsConfig.#onSubmit,
      closeOnSubmit: true
    },
    actions: {
      reset: BlockingConditionsConfig.#onReset
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/blocking-conditions.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  async _prepareContext() {
    const enabled = enabledBlockingConditions();
    const rules = adapter();
    const conditions = rules.conditions().map((c) => ({
      id: c.id,
      label: c.label,
      img: c.img,
      checked: enabled.has(c.id),
      hint: rules.hint(c.id)
    }));
    const buttons = [
      { type: "button", action: "reset", icon: "fa-solid fa-arrow-rotate-left", label: "GTC.Settings.BlockingMenu.Reset" },
      { type: "submit", icon: "fa-solid fa-floppy-disk", label: "SETTINGS.Save" }
    ];
    return { conditions, buttons };
  }

  static async #onSubmit(event, form) {
    // Status ids may contain dots, so read the checkboxes directly instead of expanding form data.
    const value = {};
    for (const input of form.querySelectorAll("input[data-condition]")) value[input.dataset.condition] = input.checked;
    await mod.setSetting("blockingConditions", value);
  }

  static async #onReset() {
    await mod.setSetting("blockingConditions", defaultBlockingConditions());
    this.render();
  }
}
