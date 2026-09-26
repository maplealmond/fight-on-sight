// The Trouble! chat prompt. Posted when a PC with Avoid Notice trips a
// combat region. Pauses the game and offers the GM two choices:
//
//   • Avoid Notice — run (or reuse) the PC's Stealth roll. Success unpauses
//     and clears the prompt; failure runs the combat trigger.
//   • Fight       — skip the roll and start combat immediately.

import { attemptAvoidNotice } from "./avoid-notice.js";
import { BEHAVIOR_TYPE, MODULE_ID } from "./constants.js";
import { runCombatTrigger } from "./trigger.js";

const ACTION_ATTR = "data-fos-action";
const PENDING_FLAG = "avoidNoticePromptPending";

// Tokens with an open Trouble! prompt. The trigger consults this before
// posting a new card so subsequent TOKEN_MOVE_WITHIN or bounced events
// (e.g. from a follow-up token.update as we snap to grid) don't stack a
// second card on top of the first.
const openPrompts = new Set();

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

export function registerPromptHandler() {
  document.addEventListener("click", async event => {
    const btn = event.target.closest(`button[${ACTION_ATTR}]`);
    if (!btn) return;
    if (!game.user.isGM) return;

    const action = btn.getAttribute(ACTION_ATTR);
    const sceneId = btn.dataset.scene;
    const regionId = btn.dataset.region;
    const tokenId = btn.dataset.token;
    if (!action || !sceneId || !regionId || !tokenId) return;

    event.preventDefault();
    event.stopPropagation();

    const message = ChatMessage.get?.(btn.closest("[data-message-id]")?.dataset?.messageId) ?? null;
    const scene = game.scenes.get(sceneId);
    const region = scene?.regions?.get?.(regionId);
    const token = scene?.tokens?.get?.(tokenId);
    const behavior = region ? [...region.behaviors].find(b => b.type === BEHAVIOR_TYPE) : null;
    if (!region || !token || !behavior) {
      ui.notifications?.warn?.("Fight on Sight: prompt target no longer exists.");
      await markResolved(message, action);
      return;
    }

    // Lock the card immediately so everyone sees "resolved" before the
    // (potentially slow) roll or combat setup runs.
    await markResolved(message, action);
    openPrompts.delete(tokenId);

    try {
      if (action === "fight") {
        await runCombatTrigger({
          behavior,
          region,
          triggeringToken: token,
          skipAvoidNotice: true
        });
      } else if (action === "avoid-notice") {
        const npcs = Array.from(region.tokens ?? []).filter(t => t.actor && !t.actor.hasPlayerOwner);
        const outcome = await attemptAvoidNotice(token, npcs);
        if (outcome.success) {
          // No follow-up chat post — the roll card itself shows the success
          // and its degree vs the DC.
          if (game.paused) await game.togglePause(false, { broadcast: true });
        } else {
          await runCombatTrigger({
            behavior,
            region,
            triggeringToken: token,
            skipAvoidNotice: true
          });
        }
      }
    } catch (err) {
      console.error(`${MODULE_ID} | prompt action failed`, err);
    }
  }, true);
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
