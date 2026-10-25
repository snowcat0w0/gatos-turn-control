import { MODULE_ID, mod } from "./constants.js";
import { htmlRoot, makeControlButton } from "./lib.js";
import { getExclusion, getBlockers } from "./rules.js";
import { getDelay, api } from "./delay.js";

const L = mod.L;

/**
 * Tracker row button: the icon classes sit on the button itself (Foundry's `inline-control … icon fa-*` style),
 * so `makeControlButton` gets them as classes rather than as its `icon` option (which would add an inner <i>).
 */
function makeButton({ icon, label, active = false, onClick, cls = "" }) {
  return makeControlButton({
    classes: `inline-control combatant-control icon ${icon} gtc-control ${cls}`.trim(),
    label,
    active,
    onClick
  });
}

function makeBadge(text, cls, tooltip) {
  const span = document.createElement("span");
  span.className = `gtc-badge ${cls}`;
  span.textContent = text;
  if (tooltip) span.dataset.tooltip = tooltip;
  return span;
}

function exclusionText(reason) {
  return L(`Tracker.Excluded.${reason}`);
}

export function onRenderCombatTracker(app, element) {
  const root = htmlRoot(element);
  const combat = app.viewed;
  if (!root || !combat) return;
  const current = combat.started ? combat.combatant : null;

  for (const li of root.querySelectorAll("li.combatant[data-combatant-id]")) {
    const combatant = combat.combatants.get(li.dataset.combatantId);
    if (!combatant) continue;
    li.querySelectorAll(".gtc-control, .gtc-badge").forEach((n) => n.remove());

    const exclusion = getExclusion(combatant);
    const delay = getDelay(combatant);
    const blockers = combat.started && !exclusion ? getBlockers(combatant.actor) : [];
    const isOwner = game.user.isGM || combatant.isOwner;

    li.classList.toggle("gtc-excluded", !!exclusion);
    li.classList.toggle("gtc-delayed", !!delay);
    li.classList.toggle("gtc-blocked", blockers.length > 0);

    const nameEl = li.querySelector(".token-name .name");
    if (nameEl) {
      if (exclusion) nameEl.after(makeBadge(L("Tracker.NoTurnBadge"), "excluded", exclusionText(exclusion)));
      if (delay) {
        const after = delay.after ? combat.combatants.get(delay.after) : null;
        const text = after ? L("Tracker.DelayAfterBadge", { name: after.name }) : L("Tracker.DelayBadge");
        nameEl.after(makeBadge(text, "delayed", L("Tracker.DelayTooltip", { round: delay.round })));
      }
      if (blockers.length) {
        nameEl.after(
          makeBadge(L("Tracker.BlockedBadge"), "blocked", blockers.map((b) => b.label).join(", "))
        );
      }
    }

    const controls = li.querySelector(".combatant-controls");
    if (!controls) continue;
    const anchor = controls.querySelector(".token-effects");
    const insert = (btn) => controls.insertBefore(btn, anchor);

    if (game.user.isGM) {
      insert(
        makeButton({
          icon: "fa-solid fa-user-slash",
          label: L("Tracker.ToggleNoTurn"),
          active: !!combatant.getFlag(MODULE_ID, "noTurn"),
          onClick: () => api.toggleNoTurn(combatant)
        })
      );
    }

    if (!isOwner || !combat.started) continue;

    if (current === combatant && !delay) {
      insert(
        makeButton({
          icon: "fa-solid fa-hourglass-half",
          label: L("Tracker.Delay"),
          onClick: () => api.delay(combatant)
        })
      );
    }

    if (delay && current && current !== combatant) {
      insert(
        makeButton({
          icon: "fa-solid fa-play",
          label: L("Tracker.ResumeNow", { name: current.name }),
          cls: "gtc-resume",
          onClick: () => api.resumeNow(combatant)
        })
      );
      insert(
        makeButton({
          icon: "fa-solid fa-forward",
          label: L("Tracker.QueueAfter", { name: current.name }),
          active: delay.after === current.id,
          onClick: () => api.queueAfterCurrent(combatant)
        })
      );
    }
  }

  // Footer: delay button next to "End Turn" for whoever controls the current combatant.
  const nav = root.querySelector("nav.combat-controls");
  nav?.querySelectorAll(".gtc-footer").forEach((n) => n.remove());
  if (nav && current && (game.user.isGM || current.isOwner) && !getDelay(current)) {
    const btn = makeControlButton({
      classes: "inline-control combat-control icon fa-solid fa-hourglass-half gtc-footer",
      label: L("Tracker.DelayCurrent", { name: current.name }),
      onClick: () => api.delay(current)
    });
    const next = nav.querySelector('[data-action="nextTurn"]');
    if (next) nav.insertBefore(btn, next);
    else nav.append(btn);
  }
}

export function onGetContextOptions(app, entries) {
  const combatantOf = (li) => app.viewed?.combatants.get(htmlRoot(li)?.dataset.combatantId);
  const controls = (c) => !!c && (game.user.isGM || c.isOwner);
  const current = () => (app.viewed?.started ? app.viewed.combatant : null);

  entries.push(
    {
      label: "GTC.Menu.ToggleNoTurn",
      icon: "fa-solid fa-user-slash",
      visible: (li) => game.user.isGM && !!combatantOf(li),
      onClick: (event, li) => api.toggleNoTurn(combatantOf(li))
    },
    {
      label: "GTC.Menu.Delay",
      icon: "fa-solid fa-hourglass-half",
      visible: (li) => {
        const c = combatantOf(li);
        return controls(c) && current() === c && !getDelay(c);
      },
      onClick: (event, li) => api.delay(combatantOf(li))
    },
    {
      label: "GTC.Menu.ResumeNow",
      icon: "fa-solid fa-play",
      visible: (li) => {
        const c = combatantOf(li);
        return controls(c) && !!getDelay(c) && !!current() && current() !== c;
      },
      onClick: (event, li) => api.resumeNow(combatantOf(li))
    },
    {
      label: "GTC.Menu.QueueAfter",
      icon: "fa-solid fa-forward",
      visible: (li) => {
        const c = combatantOf(li);
        return controls(c) && !!getDelay(c) && !!current() && current() !== c;
      },
      onClick: (event, li) => api.queueAfterCurrent(combatantOf(li))
    },
    {
      label: "GTC.Menu.CancelDelay",
      icon: "fa-solid fa-hourglass-end",
      visible: (li) => {
        const c = combatantOf(li);
        return controls(c) && !!getDelay(c);
      },
      onClick: (event, li) => api.cancelDelay(combatantOf(li))
    }
  );
}
