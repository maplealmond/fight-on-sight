// Custom RegionBehaviorType that fires the combat trigger.

import { BEHAVIOR_TYPE, MODULE_ID } from "./constants.js";
import { runCombatTrigger } from "./trigger.js";

export function registerBehavior() {
  class CombatTriggerBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
    static LOCALIZATION_PREFIXES = ["FIGHT_ON_SIGHT.behavior"];

    static defineSchema() {
      return {};
    }

    // TOKEN_ENTER already covers the "moved in from outside" case — Foundry
    // dispatches TOKEN_ENTER before TOKEN_MOVE_IN for the same entry, and
    // _handleEvent doesn't await between them, so subscribing to both would
    // race two concurrent triggers. TOKEN_MOVE_WITHIN handles a token that
    // was already inside and shifts around, REGION_BOUNDARY handles doors
    // opening or shape changes exposing a PC that was previously outside.
    static events = {
      [CONST.REGION_EVENTS.TOKEN_ENTER]: onRegionEvent,
      [CONST.REGION_EVENTS.TOKEN_MOVE_WITHIN]: onRegionEvent,
      [CONST.REGION_EVENTS.REGION_BOUNDARY]: onRegionEvent
    };
  }

  async function onRegionEvent(event) {
    const token = event?.data?.token ?? null;

    // World state — only the active GM performs it. The game pause on
    // Trouble!/combat is what visibly halts play; we don't touch the
    // token's motion here.
    if (!game.user.isActiveGM) return;
    try {
      await runCombatTrigger({
        // `this` is the RegionBehaviorType (system); the caller works with the
        // RegionBehavior document because that's where `disabled` and
        // `update()` live.
        behavior: this.parent,
        region: this.region,
        triggeringToken: token
      });
    } catch (err) {
      console.error(`${MODULE_ID} | trigger failed`, err);
    }
  }

  CONFIG.RegionBehavior ??= {};
  CONFIG.RegionBehavior.dataModels ??= {};
  CONFIG.RegionBehavior.typeLabels ??= {};
  CONFIG.RegionBehavior.typeIcons ??= {};

  CONFIG.RegionBehavior.dataModels[BEHAVIOR_TYPE] = CombatTriggerBehavior;
  CONFIG.RegionBehavior.typeLabels[BEHAVIOR_TYPE] = "FIGHT_ON_SIGHT.behavior.label";
  CONFIG.RegionBehavior.typeIcons[BEHAVIOR_TYPE] = "fa-solid fa-swords";
}
