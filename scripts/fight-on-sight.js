// Fight on Sight — Foundry VTT module entrypoint.

import { MODULE_ID, SETTINGS } from "./constants.js";
import { registerBehavior } from "./behavior.js";
import { createCombatRegionLocation, createCombatRegionToken } from "./create-region.js";
import { enableAllRegions } from "./enable-regions.js";
import { registerCombatListeners } from "./combat-listeners.js";
import { registerCombatantHook } from "./combatant-hook.js";
import { registerAvoidNoticeHooks } from "./avoid-notice-hooks.js";
import { rollAvoidNoticePreset } from "./avoid-notice.js";
import { registerPromptHandler } from "./prompt.js";

const API = {
  createCombatRegionLocation,
  createCombatRegionToken,
  enableAllRegions,
  rollAvoidNotice: rollAvoidNoticePreset
};

Hooks.once("init", () => {
  registerSettings();
  registerBehavior();
  registerCombatListeners();
  registerCombatantHook();
  registerAvoidNoticeHooks();
  registerPromptHandler();
  attachApi();
});

Hooks.once("setup", attachApi);
Hooks.once("ready", attachApi);

function attachApi() {
  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = API;
}

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
  game.settings.register(MODULE_ID, SETTINGS.deleteAfterTrigger, {
    name: "FIGHT_ON_SIGHT.settings.deleteAfterTrigger.name",
    hint: "FIGHT_ON_SIGHT.settings.deleteAfterTrigger.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });
  game.settings.register(MODULE_ID, SETTINGS.avoidNoticeTtl, {
    name: "FIGHT_ON_SIGHT.settings.avoidNoticeTtl.name",
    hint: "FIGHT_ON_SIGHT.settings.avoidNoticeTtl.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 6
  });
}
