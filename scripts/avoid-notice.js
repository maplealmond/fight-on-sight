// Native PF2E Avoid Notice integration.
//
// Contract:
//   * Every PC's Avoid Notice roll is stored on the actor as a flag. The
//     number persists across region re-entries, scene changes, and any number
//     of separate combat regions — one roll rides the whole session until it
//     is replaced or cleared.
//   * When a combat region needs a check and no stored result exists, we
//     roll instantly as a blind (GM-only) secret check, no dialog popup.
//     The number is then stored.
//   * A player can pre-roll at any time via the "Roll Avoid Notice" macro.
//     That roll is also a blind secret and overwrites any previous stored
//     result — the newest roll always wins.
//   * When a PC ends the Avoid Notice exploration activity, the stored
//     result is cleared automatically (see registerAvoidNoticeHooks).

import { MODULE_ID, SETTINGS } from "./constants.js";

const AVOID_NOTICE_SLUG = "avoid-notice";
const AVOID_NOTICE_NAME = "Avoid Notice";
const STORAGE_KEY = "avoidNoticeResult";

function getTtlSeconds() {
  const configured = game.settings?.get?.(MODULE_ID, SETTINGS.avoidNoticeTtl);
  return Number.isFinite(configured) && configured > 0 ? configured : 6;
}

// Master toggle: when off, all Avoid Notice behavior (region prompt, stored
// roll ride, pre-roll macro) is inert.
export function avoidNoticeEnabled() {
  return game.settings?.get?.(MODULE_ID, SETTINGS.avoidNoticeEnabled) !== false;
}

export function hasAvoidNotice(actor) {
  const exploration = actor?.system?.exploration;
  if (!Array.isArray(exploration)) return false;
  for (const id of exploration) {
    const item = actor.items?.get?.(id);
    if (!item) continue;
    if (item.slug === AVOID_NOTICE_SLUG) return true;
    if (item.name === AVOID_NOTICE_NAME) return true;
  }
  return false;
}

export function getStoredResult(actor) {
  const stored = actor?.getFlag?.(MODULE_ID, STORAGE_KEY);
  if (!Number.isFinite(stored?.total)) return null;
  if (!Number.isFinite(stored?.worldTime)) return stored.total; // legacy entries
  const age = (game.time?.worldTime ?? 0) - stored.worldTime;
  // Strict less-than: a roll made exactly TTL seconds ago is already invalid.
  if (age >= getTtlSeconds()) return null;
  return stored.total;
}

export async function setStoredResult(actor, total) {
  if (!actor?.setFlag) return;
  await actor.setFlag(MODULE_ID, STORAGE_KEY, {
    total,
    worldTime: game.time?.worldTime ?? 0
  });
}

export async function clearStoredResult(actor) {
  if (!actor?.unsetFlag) return;
  if (actor.getFlag(MODULE_ID, STORAGE_KEY) == null) return;
  await actor.unsetFlag(MODULE_ID, STORAGE_KEY);
}

// Fires PF2E's built-in Avoid Notice action so the chat card is rendered
// with the system's usual header, exploration tag, and success/failure notes.
// Awaits Dice So Nice's 3D dice animation so callers can chain follow-up
// work without racing the roll on-screen. Returns null if the player closes
// the roll dialog without committing.
async function rollAvoidNoticeAction(actor, { dc } = {}) {
  const difficultyClass = Number.isFinite(dc) ? { value: dc, visible: true } : undefined;
  const results = await game.pf2e.actions.get("avoid-notice").use({
    actors: [actor],
    difficultyClass,
    rollOptions: [`${MODULE_ID}:region-entry`]
  });
  await waitForDsn(extractMessageId(results));
  return extractRollTotal(results);
}

function extractRollTotal(results) {
  const first = Array.isArray(results) ? results[0] : results;
  if (!first) return null;
  return first.roll?.total
    ?? first.rolls?.[0]?.total
    ?? first.message?.rolls?.[0]?.total
    ?? first.total
    ?? null;
}

function extractMessageId(results) {
  const first = Array.isArray(results) ? results[0] : results;
  return first?.message?.id ?? first?.messageId ?? null;
}

async function waitForDsn(messageId) {
  if (!messageId) return;
  const dsn = game.dice3d;
  if (typeof dsn?.waitFor3DAnimationByMessageID !== "function") return;
  try { await dsn.waitFor3DAnimationByMessageID(messageId); } catch (_) {}
}

// Player-facing: pre-roll (or re-roll) Avoid Notice for the controlled
// PC. Overwrites any previously stored result.
export async function rollAvoidNoticePreset() {
  if (!avoidNoticeEnabled()) {
    ui.notifications?.warn?.(game.i18n.localize("FIGHT_ON_SIGHT.avoidNotice.disabled"));
    return;
  }
  const token = canvas.tokens?.controlled?.[0]?.document
    ?? game.user?.character?.getActiveTokens?.(true, true)?.[0]?.document
    ?? null;
  const actor = token?.actor ?? game.user?.character ?? null;
  if (!actor) {
    ui.notifications?.warn?.(game.i18n.localize("FIGHT_ON_SIGHT.avoidNotice.noActor"));
    return;
  }
  if (!hasAvoidNotice(actor)) {
    ui.notifications?.warn?.(game.i18n.format(
      "FIGHT_ON_SIGHT.avoidNotice.notActive",
      { name: actor.name }
    ));
    return;
  }
  const total = await rollAvoidNoticeAction(actor);
  if (total == null) return;
  await setStoredResult(actor, total);
  ui.notifications?.info?.(game.i18n.format(
    "FIGHT_ON_SIGHT.avoidNotice.stored",
    { name: actor.name }
  ));
}

// Used by the trigger flow: does this PC beat every NPC's Perception DC?
// Uses the stored roll if present; otherwise rolls a blind secret check and
// stores the result.
export async function attemptAvoidNotice(pcToken, npcTokens) {
  const actor = pcToken.actor;
  if (!actor) return { rolled: false, success: false, total: null, highestDC: null };

  const perceptions = npcTokens
    .map(n => n.actor?.perception?.dc?.value)
    .filter(Number.isFinite);
  const highestDC = perceptions.length ? Math.max(...perceptions) : 10;

  let total = getStoredResult(actor);
  let rolled = false;
  if (total == null) {
    total = await rollAvoidNoticeAction(actor, { dc: highestDC });
    rolled = total != null;
    if (rolled) await setStoredResult(actor, total);
  }

  return {
    rolled,
    success: total != null && total >= highestDC,
    total,
    highestDC
  };
}
