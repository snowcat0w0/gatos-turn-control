import { mod } from "./constants.js";
import { libActive, onAll } from "./lib.js";
import { registerSettings } from "./settings.js";
import { initSocket } from "./socket.js";
import { createCombatClass, onResumeUpdate } from "./combat.js";
import { registerDelayHandlers, api } from "./delay.js";
import { onRenderCombatTracker, onGetContextOptions } from "./tracker.js";
import { onRenderChatMessage } from "./chat.js";
import { getExclusion, getBlockers } from "./rules.js";
import { registerVisibilityHooks } from "./visibility.js";

Hooks.once("init", () => {
  // Installed-but-disabled library = "half state" (gatos-lib PLAN §5.6): code imports fine, but the library's
  // lang/css/api are missing. Foundry blocks activation when the library is missing entirely (relationships.requires).
  if (!libActive()) {
    Hooks.once("ready", () =>
      ui.notifications.error("Gato's Turn Control: gatos-lib 모듈을 활성화해야 합니다. / Enable the gatos-lib module.", { permanent: true }),
    );
  }
  registerSettings();
  CONFIG.Combat.documentClass = createCombatClass(CONFIG.Combat.documentClass);
  registerDelayHandlers();
  registerVisibilityHooks();

  mod.exposeApi({ ...api, getExclusion, getBlockers });
});

Hooks.once("ready", () => {
  initSocket();
});

Hooks.on("renderCombatTracker", onRenderCombatTracker);
Hooks.on("getCombatTrackerContextOptions", onGetContextOptions);
Hooks.on("renderChatMessageHTML", onRenderChatMessage);

Hooks.on("updateCombat", (combat, changed, options) => {
  onResumeUpdate(combat, changed, options);
});

// Conditions and HP changes alter exclusion / blocked badges.
const rerenderTracker = foundry.utils.debounce(() => ui.combat?.render(), 100);
Hooks.on("updateActor", (actor) => {
  if (game.combat?.combatants.some((c) => c.actor === actor)) rerenderTracker();
});
onAll(["createActiveEffect", "deleteActiveEffect", "updateActiveEffect"], (effect) => {
  const actor = effect.parent;
  if (actor instanceof Actor && game.combat?.combatants.some((c) => c.actor === actor)) rerenderTracker();
});
