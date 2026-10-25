import { mod } from "./constants.js";
import { esc, postCard, speakerFor } from "./lib.js";
import { getHealth } from "./rules.js";
import { adapter } from "./systems/index.js";

const L = mod.L;

/**
 * Chat card: `<div class="gatos-card gtc-card"><header><i class="…" inert></i> <span>title</span></header>
 * <div class="gtc-body">…</div></div>` — 0.2.0 markup plus the library's `gatos-card` class / `inert`.
 * Hidden combatants only report to the GMs. Speaker: actor + token + combatant name (lib speakerFor).
 */
async function post(combatant, { icon, title, body, flags = {}, rolls }) {
  const hidden = combatant.hidden || combatant.token?.hidden;
  return postCard(mod, {
    speaker: speakerFor(combatant),
    icon,
    title: `<span>${title}</span>`,
    body: `<div class="gtc-body">${body}</div>`,
    cls: "gtc-card",
    rolls,
    flags: { kind: flags.kind ?? "info", combatantId: combatant.id, ...flags },
    whisper: hidden ? "gm" : null
  });
}

export function postBlocked(combatant, blockers, { advanced }) {
  const items = blockers
    .map((b) => `<li><strong>${esc(b.label)}</strong>${b.hint ? ` — ${esc(b.hint)}` : ""}</li>`)
    .join("");
  let body = `<p>${L("Chat.BlockedBody", { name: esc(combatant.name) })}</p><ul>${items}</ul>`;

  const dying = adapter().stabilize && blockers.find((b) => b.dying);
  if (dying) {
    const h = getHealth(combatant.actor);
    const bleeding = combatant.actor?.statuses?.has("bleed");
    body += `<p class="gtc-dying">${L("Chat.DyingCheck", { penalty: h ? h.value : "?" })}</p>`;
    if (bleeding) body += `<p class="gtc-dying">${L("Chat.DyingBleed")}</p>`;
    body += `<button type="button" class="gtc-stabilize" data-actor-uuid="${combatant.actor.uuid}">
      <i class="fa-solid fa-heart-pulse"></i> ${L("Chat.StabilizeButton")}</button>`;
  }
  if (!advanced) body += `<p class="gtc-warn">${L("Chat.NoneCanAct")}</p>`;

  return post(combatant, {
    icon: "fa-solid fa-forward-fast",
    title: L("Chat.BlockedTitle"),
    body,
    flags: { kind: "blocked", blockers: blockers.map((b) => b.id) }
  });
}

const CONFUSION_TABLE = [
  { max: 25, key: "Normal", skip: false },
  { max: 50, key: "Babble", skip: true },
  { max: 75, key: "Self", skip: false },
  { max: 100, key: "Attack", skip: false }
];

/** Roll the confusion table for this turn and post it. */
export async function rollConfusion(combatant) {
  const roll = await new Roll("1d100").evaluate();
  const row = CONFUSION_TABLE.find((r) => roll.total <= r.max);
  const rows = CONFUSION_TABLE.map((r, i) => {
    const min = i === 0 ? 1 : CONFUSION_TABLE[i - 1].max + 1;
    const cls = r === row ? ` class="gtc-hit"` : "";
    return `<tr${cls}><td>${String(min).padStart(2, "0")}–${String(r.max).padStart(2, "0")}</td><td>${L(`Confusion.${r.key}`)}</td></tr>`;
  }).join("");
  let body = `<p>${L("Chat.ConfusionBody", { name: esc(combatant.name) })}</p>
    <p class="gtc-roll">d% = <strong>${roll.total}</strong></p>
    <table class="gtc-table">${rows}</table>
    <p class="hint">${L("Confusion.Attacked")}</p>`;
  if (row.key === "Self") {
    const str = combatant.actor?.system?.abilities?.str?.mod ?? 0;
    const formula = str ? `1d8 ${str < 0 ? "-" : "+"} ${Math.abs(str)}` : "1d8";
    body += `<p>${L("Confusion.SelfFormula", { formula })}</p>`;
  }
  if (row.skip) body += `<p class="gtc-warn">${L("Chat.ConfusionSkip")}</p>`;
  await post(combatant, {
    icon: "fa-solid fa-shuffle",
    title: L("Chat.ConfusionTitle"),
    body,
    rolls: [roll],
    flags: { kind: "confusion", result: roll.total }
  });
  return { total: roll.total, skip: row.skip };
}

export function postDelay(combatant) {
  return post(combatant, {
    icon: "fa-solid fa-hourglass-half",
    title: L("Chat.DelayTitle"),
    body: `<p>${L("Chat.DelayBody", { name: esc(combatant.name) })}</p>`,
    flags: { kind: "delay" }
  });
}

export function postResume(combatant, { initiative, anchorName, mode }) {
  const key = mode === "after" ? "Chat.ResumeAfter" : "Chat.ResumeBefore";
  return post(combatant, {
    icon: "fa-solid fa-play",
    title: L("Chat.ResumeTitle"),
    body: `<p>${L(key, {
      name: esc(combatant.name),
      anchor: esc(anchorName),
      init: String(Number(Number(initiative).toFixed(4)))
    })}</p>`,
    flags: { kind: "resume" }
  });
}

export function postDelayLost(combatant) {
  return post(combatant, {
    icon: "fa-solid fa-hourglass-end",
    title: L("Chat.DelayLostTitle"),
    body: `<p>${L("Chat.DelayLostBody", { name: esc(combatant.name) })}</p>`,
    flags: { kind: "delayLost" }
  });
}

/** Stabilization check button on dying cards. */
export function onRenderChatMessage(message, html) {
  const btn = html.querySelector?.("button.gtc-stabilize");
  if (!btn) return;
  btn.addEventListener("click", async (event) => {
    event.preventDefault();
    const actor = await fromUuid(btn.dataset.actorUuid);
    if (!actor?.isOwner) return mod.notify.warn("Warn.NotOwner");
    await adapter().rollStabilize?.(actor, getHealth(actor));
  });
}
