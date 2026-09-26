// When any token becomes a combatant — whether we added them, the GM dragged
// them into the combat tracker, or another module did — check if the token
// currently stands inside an enabled combat-trigger region. If so, fire that
// region's trigger. This is the cascade path: it makes our own additions
// pull in adjacent regions, and it lets a manually-added monster or PC set
// off any zone they happen to be standing in.

import { findTriggerBehavior, runCombatTrigger } from "./trigger.js";

export function registerCombatantHook() {
  Hooks.on("createCombatant", combatant => {
    if (!game.user.isActiveGM) return;
    const tokenDoc = combatant.token;
    const scene = tokenDoc?.parent;
    if (!scene) return;

    for (const region of scene.regions) {
      const behavior = findTriggerBehavior(region);
      if (!behavior || behavior.disabled) continue;
      if (!region.tokens?.has(tokenDoc)) continue;
      runCombatTrigger({ behavior, region, triggeringToken: tokenDoc });
    }
  });
}
