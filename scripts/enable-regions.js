// Re-enable every combat-trigger region behavior on the active scene. Handy
// as an "undo" after a fight resolves and the GM wants trip-wires live again.

import { BEHAVIOR_TYPE, MODULE_ID } from "./constants.js";

export async function enableAllRegions() {
  if (!game.user.isGM) {
    ui.notifications?.warn?.(game.i18n.localize("FIGHT_ON_SIGHT.notify.notGm"));
    return;
  }
  const scene = canvas?.scene;
  if (!scene) {
    ui.notifications?.warn?.(game.i18n.localize("FIGHT_ON_SIGHT.notify.noScene"));
    return;
  }

  let count = 0;
  for (const region of scene.regions) {
    const updates = [];
    for (const behavior of region.behaviors) {
      if (behavior.type !== BEHAVIOR_TYPE) continue;
      if (!behavior.disabled) continue;
      updates.push({ _id: behavior.id, disabled: false });
    }
    if (updates.length) {
      await region.updateEmbeddedDocuments("RegionBehavior", updates);
      count += updates.length;
    }
  }

  ui.notifications?.info?.(game.i18n.format("FIGHT_ON_SIGHT.notify.reenabled", { count }));
  console.debug(`${MODULE_ID} | re-enabled ${count} combat trigger behavior(s) on ${scene.name}`);
}
