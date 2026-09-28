// The Trouble! chat prompt. Posted when a PC with Avoid Notice trips a
// combat region. Pauses the game and offers two choices:
//
//   • Avoid Notice — run (or reuse) the PC's Stealth roll. The roll runs on
//     the PC-owner's client so the player is the one throwing the dice;
//     success unpauses and clears the prompt, failure runs the combat trigger.
//   • Fight       — skip the roll and start combat immediately.
//
// Cross-client coordination goes through socketlib (required dependency).
// The clicking player rolls locally, then dispatches the result to the GM
// via `socket.executeAsGM(...)`. `game.socket` directly was tried first and
// observed to silently drop messages between clients.

import { attemptAvoidNotice } from "./avoid-notice.js";
import { BEHAVIOR_TYPE, MODULE_ID } from "./constants.js";
import { runCombatTrigger } from "./trigger.js";

const ACTION_ATTR = "data-fos-action";
const PENDING_FLAG = "avoidNoticePromptPending";

// Tokens with an open Trouble! prompt. The trigger consults this before
// posting a new card so subsequent TOKEN_MOVE_WITHIN or bounced events
// (e.g. from a follow-up token.update as we snap to grid) don't stack a
// second card on top of the first. Only populated on the GM's client.
const openPrompts = new Set();

let socket = null;

export function hasOpenPrompt(tokenDoc) {
  return openPrompts.has(tokenDoc?.id);
}

export async function presentAvoidNoticeChoice({ region, triggeringToken }) {
  if (openPrompts.has(triggeringToken.id)) return;
  openPrompts.add(triggeringToken.id);
  if (!game.paused) await game.togglePause(true, { broadcast: true });

  const actor = triggeringToken.actor;
  const targetAttrs =
    `data-region="${region.id}" data-token="${triggeringToken.id}" data-scene="${region.parent.id}"`;

  const content = `
    <div class="pf2e chat-card fight-on-sight-prompt">
      <h4 class="action" style="margin: 0 0 4px 0;">Trouble!</h4>
      <p class="hint" style="font-size: 0.85em; margin: 0 0 6px 0;">
        Ask your GM if you can sneak away unspotted.
      </p>
      <div style="display: flex; gap: 6px;">
        <button type="button" ${ACTION_ATTR}="avoid-notice" ${targetAttrs}>
          <i class="fa-solid fa-user-secret"></i> Avoid Notice
        </button>
        <button type="button" ${ACTION_ATTR}="fight" ${targetAttrs}>
          <i class="fa-solid fa-swords"></i> Fight
        </button>
      </div>
    </div>
  `;

  const message = await ChatMessage.create({
    content,
    // Speak as the PC — the chat card header will show the token image and
    // player name automatically, matching how Avoid Notice's own skill-check
    // card renders.
    speaker: ChatMessage.getSpeaker({ actor, token: triggeringToken })
  });

  if (message) await message.setFlag(MODULE_ID, PENDING_FLAG, true);
}

// Registered at module load — before any Foundry init hook fires — so we're
// guaranteed to be listening when socketlib emits `socketlib.ready` from its
// own init phase.
Hooks.once("socketlib.ready", () => {
  socket = socketlib.registerModule(MODULE_ID);
  socket.register("processTroubleSignal", processTroubleSignal);
});

export function registerPromptHandler() {
  document.addEventListener("click", onPromptClick, true);
}

async function onPromptClick(event) {
  const btn = event.target.closest(`button[${ACTION_ATTR}]`);
  if (!btn) return;

  const action = btn.getAttribute(ACTION_ATTR);
  const sceneId = btn.dataset.scene;
  const regionId = btn.dataset.region;
  const tokenId = btn.dataset.token;
  const messageId = btn.closest("[data-message-id]")?.dataset?.messageId ?? null;
  if (!action || !sceneId || !regionId || !tokenId) return;

  const scene = game.scenes.get(sceneId);
  const token = scene?.tokens?.get?.(tokenId);
  const actor = token?.actor;
  if (!actor) return;
  const isOwner = actor.isOwner === true;
  if (!game.user.isGM && !isOwner) return;

  // Route Avoid Notice to the actor's owner so the roll lands on the player's
  // client. GM falls through only when no non-GM owner is online (solo GM,
  // GM-controlled PC, etc.).
  if (action === "avoid-notice" && game.user.isGM) {
    const hasActivePlayerOwner = game.users?.some?.(u =>
      u.active && !u.isGM && actor.testUserPermission?.(u, "OWNER")
    );
    if (hasActivePlayerOwner) return;
  }

  event.preventDefault();
  event.stopPropagation();

  // Roll on the clicker's client if this is Avoid Notice.
  let success = null;
  if (action === "avoid-notice") {
    const region = scene?.regions?.get?.(regionId);
    const npcs = region ? Array.from(region.tokens ?? []).filter(t => t.actor && !t.actor.hasPlayerOwner) : [];
    const outcome = await attemptAvoidNotice(token, npcs);
    success = outcome.success === true;
  }

  const signal = { action, success, sceneId, regionId, tokenId, messageId };

  // GM as clicker can just run the follow-up locally.
  if (game.user.isActiveGM) {
    await processTroubleSignal(signal);
    return;
  }

  await socket.executeAsGM("processTroubleSignal", signal);
}

// Runs on the active GM. Marks the card resolved, then either unpauses (on
// Avoid Notice success) or starts combat (Fight / failed Avoid Notice).
async function processTroubleSignal(signal) {
  if (!game.user.isActiveGM) return;
  const { action, success, sceneId, regionId, tokenId, messageId } = signal ?? {};

  const scene = game.scenes.get(sceneId);
  const region = scene?.regions?.get?.(regionId);
  const token = scene?.tokens?.get?.(tokenId);
  const message = messageId ? game.messages?.get?.(messageId) : null;

  // Always clear the openPrompts guard — stale entries silently block future
  // prompts for this token.
  openPrompts.delete(tokenId);

  const stillPending = message?.getFlag?.(MODULE_ID, PENDING_FLAG);
  if (stillPending) await markResolved(message, action);

  if (action === "avoid-notice" && success === true) {
    // Roll card itself shows the success and its degree vs the DC. Always
    // toggle to false, don't gate on game.paused — cross-client pause state
    // can be momentarily stale on the receiving side.
    await game.togglePause(false, { broadcast: true });
    return;
  }

  // Fight, or Avoid Notice failure → start / join combat.
  if (!region || !token) {
    console.warn(`${MODULE_ID} | trouble signal target missing`, { sceneId, regionId, tokenId, hasScene: !!scene, hasRegion: !!region, hasToken: !!token });
    return;
  }
  const behavior = region.behaviors ? [...region.behaviors].find(b => b.type === BEHAVIOR_TYPE) : null;
  if (!behavior) {
    console.warn(`${MODULE_ID} | region behavior missing`, { regionId });
    return;
  }
  await runCombatTrigger({
    behavior,
    region,
    triggeringToken: token,
    skipAvoidNotice: true
  });
}

// Rewrite the chat message content so both buttons are visibly locked and
// the chosen action is highlighted. Updating the ChatMessage document means
// every client — not just the GM's local DOM — sees the resolved state.
async function markResolved(message, chosenAction) {
  if (!message) return;
  const chosenLabel = chosenAction === "fight" ? "Fight" : "Avoid Notice";
  const chosenIcon = chosenAction === "fight" ? "fa-swords" : "fa-user-secret";
  const otherLabel = chosenAction === "fight" ? "Avoid Notice" : "Fight";
  const otherIcon = chosenAction === "fight" ? "fa-user-secret" : "fa-swords";

  const chosenBtn = `
    <button type="button" disabled
      style="flex:1; opacity:1; font-weight:bold; background:#3a5a3a; color:#fff; border-color:#254725; cursor:default;">
      <i class="fa-solid ${chosenIcon}"></i> ${chosenLabel} ✓
    </button>`;
  const otherBtn = `
    <button type="button" disabled
      style="flex:1; opacity:0.35; text-decoration:line-through; cursor:not-allowed;">
      <i class="fa-solid ${otherIcon}"></i> ${otherLabel}
    </button>`;

  const buttonsHTML = chosenAction === "fight"
    ? `${otherBtn}${chosenBtn}`
    : `${chosenBtn}${otherBtn}`;

  const content = `
    <div class="pf2e chat-card fight-on-sight-prompt fos-resolved">
      <h4 class="action" style="margin: 0 0 4px 0;">Trouble!</h4>
      <p class="hint" style="font-size: 0.85em; margin: 0 0 6px 0;">
        Chose <strong>${chosenLabel}</strong>.
      </p>
      <div style="display: flex; gap: 6px;">
        ${buttonsHTML}
      </div>
    </div>
  `;

  try {
    await message.update({ content });
    await message.unsetFlag(MODULE_ID, PENDING_FLAG);
  } catch (err) {
    console.warn(`${MODULE_ID} | failed to mark prompt resolved`, err);
  }
}
