// The combat-trigger logic: create/join a combat, add tokens, cascade.

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
  const pcsInside = inside.filter(isPC);
  console.debug(`${MODULE_ID} | runCombatTrigger`, {
    region: region.name,
    triggeringToken: triggeringToken?.name,
    insideCount: inside.length,
    pcsInside: pcsInside.map(t => t.name)
  });
  if (!pcsInside.length) return;

  // If a PC triggered us, disable this behavior so it does not fire again.
  if (triggeringToken && isPC(triggeringToken)) {
    await behavior.update({ disabled: true });
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
  let created = [];
  if (additions.length) {
    created = await combat.createEmbeddedDocuments("Combatant", additions);
  }

  // Cascade: any NPC we just added may itself be inside another enabled trigger
  // region — fire those too.
  if (game.settings.get(MODULE_ID, SETTINGS.cascade)) {
    await cascadeFromCombatants(scene, created.filter(c => !c.actor?.hasPlayerOwner), region);
  }

  ui.notifications?.info?.(`Fight on Sight: combat updated (${additions.length} added).`);
}

async function cascadeFromCombatants(scene, npcCombatants, sourceRegion) {
  if (!npcCombatants?.length) return;
  const visited = new Set([sourceRegion.id]);
  const queue = [];

  for (const c of npcCombatants) {
    const tokenDoc = scene.tokens.get(c.tokenId);
    if (!tokenDoc) continue;
    for (const region of scene.regions) {
      if (visited.has(region.id)) continue;
      const behavior = findTriggerBehavior(region);
      if (!behavior || behavior.disabled) continue;
      if (!region.tokens?.has(tokenDoc)) continue;
      visited.add(region.id);
      queue.push({ region, behavior, tokenDoc });
    }
  }

  for (const item of queue) {
    await runCombatTrigger({
      behavior: item.behavior,
      region: item.region,
      triggeringToken: item.tokenDoc
    });
  }
}

export function findTriggerBehavior(regionDoc) {
  if (!regionDoc?.behaviors) return null;
  for (const b of regionDoc.behaviors) {
    if (b.type === BEHAVIOR_TYPE) return b;
  }
  return null;
}
