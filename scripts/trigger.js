// The combat-trigger logic: create/join a combat and add tokens. Cascade to
// other regions is handled via the `createCombatant` hook (any combatant
// added anywhere re-checks the regions it stands inside), not by explicit
// recursion here.

import { BEHAVIOR_TYPE, MODULE_ID, SETTINGS } from "./constants.js";

// A "PC" for our purposes = a token whose actor is a member of the primary
// party (Foundry v13 introduces `game.actors.party` in systems that support
// it, notably PF2E). This means a GM controlling a party character still
// counts as a PC. Falls back to `hasPlayerOwner` in systems without a party
// actor.
export function isPC(tokenDoc) {
  const actor = tokenDoc?.actor;
  if (!actor) return false;
  const party = game.actors?.party;
  if (party?.members?.length) {
    for (const member of party.members) {
      if (member === actor || member.id === actor.id) return true;
    }
    return false;
  }
  return actor.hasPlayerOwner;
}

// A token whose actor carries the "undetected" status (PF2E's undetected
// condition, and any other system that registers the same status id) does
// not count as a triggering presence — invisible / sneaking PCs can slip
// through without setting off the combat trigger.
export function isUndetected(tokenDoc) {
  return tokenDoc?.actor?.statuses?.has("undetected") ?? false;
}

// A PC that would actually spring the trap: is a PC and is not undetected.
export function isTriggeringPC(tokenDoc) {
  return isPC(tokenDoc) && !isUndetected(tokenDoc);
}

function tokensInsideRegion(region) {
  return Array.from(region.tokens ?? []).filter(t => t.actor);
}

// Serialize all trigger work through a single promise chain. Foundry can
// dispatch several region events for the same movement (TOKEN_ENTER followed
// by TOKEN_MOVE_IN, cascades from other regions, etc.) without awaiting
// between them, and two concurrent triggers would both see "no combat yet"
// and each create one. The queue guarantees each run completes before the
// next starts.
let triggerQueue = Promise.resolve();

export function runCombatTrigger(args) {
  const next = triggerQueue.then(() => _runCombatTrigger(args).catch(err => {
    console.error(`${MODULE_ID} | trigger failed`, err);
  }));
  triggerQueue = next;
  return next;
}

async function _runCombatTrigger({ behavior, region, triggeringToken }) {
  if (!game.user.isActiveGM) return;
  if (!region || behavior?.disabled) return;

  const scene = region.parent;
  if (!scene) return;

  const inside = tokensInsideRegion(region);
  const triggeringPCs = inside.filter(isTriggeringPC);
  console.debug(`${MODULE_ID} | runCombatTrigger`, {
    region: region.name,
    triggeringToken: triggeringToken?.name,
    insideCount: inside.length,
    triggeringPCs: triggeringPCs.map(t => t.name)
  });
  if (!triggeringPCs.length) return;

  // If a detected PC triggered us, retire this trigger so it doesn't fire
  // again. The world setting decides whether to disable the behavior (keep
  // the region on the map for later re-enable) or delete the whole region
  // outright. Undetected PCs never trip it — they walk through invisibly.
  if (triggeringToken && isTriggeringPC(triggeringToken)) {
    if (game.settings.get(MODULE_ID, SETTINGS.deleteAfterTrigger)) {
      await region.delete();
    } else {
      await behavior.update({ disabled: true });
    }
  }

  // If ANY combat already exists — active or not, started or not — add to it.
  // A combat that was just created but has not yet rolled initiative is still
  // a combat and should be reused, not duplicated.
  let combat = game.combats.contents[0] ?? null;
  if (!combat) {
    combat = await Combat.create({ scene: scene.id, active: true });
    if (!game.paused) await game.togglePause(true, { broadcast: true });
  }

  // Add every NPC currently inside the region (skip PCs — they get added below
  // regardless of position).
  const npcTokensInRegion = inside.filter(t => !isPC(t));
  const npcAdds = npcTokensInRegion
    .filter(t => !combat.combatants.some(c => c.tokenId === t.id))
    .map(t => ({ tokenId: t.id, sceneId: scene.id, actorId: t.actor.id, hidden: t.hidden }));

  // Add every PC in the world (any scene) — spec: "add every PC to the combat
  // no matter where they are".
  const pcAdds = [];
  for (const tokenDoc of scene.tokens) {
    if (!isPC(tokenDoc)) continue;
    if (combat.combatants.some(c => c.tokenId === tokenDoc.id)) continue;
    pcAdds.push({ tokenId: tokenDoc.id, sceneId: scene.id, actorId: tokenDoc.actor.id, hidden: tokenDoc.hidden });
  }

  const additions = [...npcAdds, ...pcAdds];
  if (additions.length) {
    await combat.createEmbeddedDocuments("Combatant", additions);
  }

  ui.notifications?.info?.(`Fight on Sight: combat updated (${additions.length} added).`);
}

export function findTriggerBehavior(regionDoc) {
  if (!regionDoc?.behaviors) return null;
  for (const b of regionDoc.behaviors) {
    if (b.type === BEHAVIOR_TYPE) return b;
  }
  return null;
}
