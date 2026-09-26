// When a PC drops the Avoid Notice exploration activity, wipe their stored
// Stealth roll — a fresh pre-roll (or auto-roll on next region entry) will
// be required.

import { clearStoredResult, hasAvoidNotice } from "./avoid-notice.js";

export function registerAvoidNoticeHooks() {
  Hooks.on("updateActor", async (actor, changes) => {
    // PF2E stores exploration activity item IDs in system.exploration; if
    // that array wasn't touched, nothing to do.
    if (!changes?.system || !("exploration" in changes.system)) return;
    if (hasAvoidNotice(actor)) return;
    await clearStoredResult(actor);
  });
}
