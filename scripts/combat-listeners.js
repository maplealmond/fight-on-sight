// Optional feature: when everyone in an active combat has rolled initiative,
// jump to round one and unpause the game.

import { MODULE_ID, SETTINGS } from "./constants.js";

export function registerCombatListeners() {
  Hooks.on("updateCombatant", (combatant, changes) => {
    if (!game.user.isActiveGM) return;
    if (!("initiative" in changes)) return;
    if (!game.settings.get(MODULE_ID, SETTINGS.initiativeAdvance)) return;

    const combat = combatant.combat;
    if (!combat?.active) return;

    // Already started this round? Nothing to do.
    if (combat.round >= 1) return;

    const everyoneRolled = combat.combatants.size > 0 &&
      combat.combatants.every(c => c.initiative !== null && c.initiative !== undefined);
    if (!everyoneRolled) return;

    advanceToRoundOne(combat).catch(err => console.error(`${MODULE_ID} | advance failed`, err));
  });
}

async function advanceToRoundOne(combat) {
  if (!combat.started) {
    await combat.startCombat();
  } else if (combat.round < 1) {
    await combat.nextRound();
  }
  if (game.paused) await game.togglePause(false, true);
}
