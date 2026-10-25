/**
 * GM relay (gatos-lib createSocket). Handlers run on the active GM only; the sender is the user the Foundry
 * server reports, never one named in the payload (0.2.0 trusted `msg.userId`). Unknown senders are dropped.
 */
import { mod } from "./constants.js";
import { createSocket } from "./lib.js";

const socket = createSocket(mod, { noGMKey: "Warn.NoGM" });

/** Register a GM-side handler. `fn(data, user)` runs on the active GM. */
export const registerHandler = (action, fn) => socket.registerHandler(action, fn);

export const initSocket = () => socket.init();

/**
 * Run an action with GM authority: directly when this client is a GM, otherwise relayed to the active GM.
 * Resolves to a boolean (relayed / run) — callers here ignore the result.
 */
export const runAsGM = (action, data) => socket.runAsGM(action, data);
