// Fight on Sight — Foundry VTT module entrypoint.

import { MODULE_ID, SETTINGS } from "./constants.js";
import { registerBehavior } from "./behavior.js";
import { createCombatRegion } from "./create-region.js";
import { registerCombatListeners } from "./combat-listeners.js";

Hooks.once("init", () => {
  registerSettings();
  registerBehavior();
  registerCombatListeners();

  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = { createCombatRegion };
  }
});

function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.radius, {
    name: "FIGHT_ON_SIGHT.settings.radius.name",
    hint: "FIGHT_ON_SIGHT.settings.radius.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 30
  });
  game.settings.register(MODULE_ID, SETTINGS.initiativeAdvance, {
    name: "FIGHT_ON_SIGHT.settings.initiativeAdvance.name",
    hint: "FIGHT_ON_SIGHT.settings.initiativeAdvance.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, SETTINGS.cascade, {
    name: "FIGHT_ON_SIGHT.settings.cascade.name",
    hint: "FIGHT_ON_SIGHT.settings.cascade.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });
}
