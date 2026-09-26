// GM flows for creating combat trigger regions. Two entry points on the API:
//
//   createCombatRegionLocation()  → shipped as the "Create Combat Region
//                                    (Location)" macro. Uses Foundry's native
//                                    region placement flow.
//   createCombatRegionToken()     → shipped as the "Create Combat Region
//                                    (Token)" macro. Deselects any current
//                                    token, activates the Select Tokens
//                                    control, and attaches the region to the
//                                    next token the GM clicks.

import { BEHAVIOR_TYPE, MODULE_ID, SETTINGS } from "./constants.js";

export async function createCombatRegionLocation() {
  const scene = requireGMAndScene();
  if (!scene) return;
  const radiusFeet = defaultRadiusFeet();
  await placeLocationRegion({ scene, radiusFeet });
}

export async function createCombatRegionToken() {
  const scene = requireGMAndScene();
  if (!scene) return;
  const radiusFeet = defaultRadiusFeet();
  const tokenDoc = await selectTokenViaClick();
  if (!tokenDoc) return notifyCancelled();
  await placeTokenRegion({ tokenDoc, radiusFeet });
}

function requireGMAndScene() {
  if (!game.user.isGM) {
    ui.notifications?.warn?.(game.i18n.localize("FIGHT_ON_SIGHT.notify.notGm"));
    return null;
  }
  const scene = canvas?.scene;
  if (!scene) {
    ui.notifications?.warn?.(game.i18n.localize("FIGHT_ON_SIGHT.notify.noScene"));
    return null;
  }
  return scene;
}

function defaultRadiusFeet() {
  return game.settings.get(MODULE_ID, SETTINGS.radius) || 30;
}

function commonRegionData() {
  return {
    name: game.i18n.localize("FIGHT_ON_SIGHT.behavior.label"),
    color: "#c62828",
    visibility: CONST.REGION_VISIBILITY?.GAMEMASTER ?? 2,
    behaviors: [
      {
        name: game.i18n.localize("FIGHT_ON_SIGHT.behavior.label"),
        type: BEHAVIOR_TYPE,
        disabled: false
      }
    ]
  };
}

async function placeLocationRegion({ scene, radiusFeet }) {
  const radiusPx = radiusFeet * canvas.dimensions.distancePixels;

  ui.notifications?.info?.(game.i18n.localize("FIGHT_ON_SIGHT.prompt.clickLocation"));
  const region = await canvas.regions.placeRegion({
    ...commonRegionData(),
    shapes: [{ type: "circle", x: 0, y: 0, radius: radiusPx, gridBased: true }],
    levels: [canvas.level.id],
    restriction: { enabled: true, type: "move", priority: 0 }
  });

  if (!region) return notifyCancelled();
  ui.notifications?.info?.(game.i18n.format("FIGHT_ON_SIGHT.notify.created", { radius: radiusFeet }));
}

async function placeTokenRegion({ tokenDoc, radiusFeet }) {
  // Despite the JSDoc saying "grid units", `createTokenEmanation` internally
  // computes `radius = range * (grid.size / grid.distance)`, so `range` must
  // be in scene distance units (feet), not grid squares.
  await foundry.documents.RegionDocument.createTokenEmanation(
    tokenDoc,
    radiusFeet,
    {
      ...commonRegionData(),
      restriction: { enabled: true, type: "sight", priority: 0 }
    },
    { excludeToken: false }
  );

  ui.notifications?.info?.(game.i18n.format("FIGHT_ON_SIGHT.notify.created", { radius: radiusFeet }));
}

function notifyCancelled() {
  ui.notifications?.info?.(game.i18n.localize("FIGHT_ON_SIGHT.notify.cancelled"));
}

// Deselect whatever is currently selected, activate the Token layer's default
// Select Tokens tool, and wait for the next token the GM clicks. Guarantees
// exactly one click — never zero (from an existing selection) and never
// two (from having to activate the tool first).
function selectTokenViaClick() {
  canvas.tokens?.releaseAll?.();
  canvas.tokens?.activate?.();
  ui.notifications?.info?.(game.i18n.localize("FIGHT_ON_SIGHT.prompt.clickToken"));

  return new Promise(resolve => {
    const onControl = (token, controlled) => {
      if (!controlled) return;
      cleanup();
      resolve(token.document);
    };
    const onKey = event => {
      if (event.key === "Escape") {
        cleanup();
        resolve(null);
      }
    };
    const cleanup = () => {
      Hooks.off("controlToken", onControl);
      window.removeEventListener("keydown", onKey, true);
    };
    Hooks.on("controlToken", onControl);
    window.addEventListener("keydown", onKey, true);
  });
}
