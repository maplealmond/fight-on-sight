// GM flow for creating a combat trigger region. Exposed via
// `game.modules.get("fight-on-sight").api.createCombatRegion()` and invoked
// by the "Create Combat Region" macro shipped in the module's compendium.

import { BEHAVIOR_TYPE, MODULE_ID, SETTINGS } from "./constants.js";

export async function createCombatRegion() {
  if (!game.user.isGM) {
    ui.notifications?.warn?.(game.i18n.localize("FIGHT_ON_SIGHT.notify.notGm"));
    return;
  }
  const scene = canvas?.scene;
  if (!scene) {
    ui.notifications?.warn?.(game.i18n.localize("FIGHT_ON_SIGHT.notify.noScene"));
    return;
  }

  const choice = await promptAnchorChoice();
  if (!choice) return;

  const radiusFeet = game.settings.get(MODULE_ID, SETTINGS.radius) || 30;

  if (choice === "location") {
    await placeLocationRegion({ scene, radiusFeet });
  } else {
    const tokenDoc = await promptTokenClick(game.i18n.localize("FIGHT_ON_SIGHT.prompt.clickToken"));
    if (!tokenDoc) return notifyCancelled();
    await placeTokenRegion({ tokenDoc, radiusFeet });
  }
}

function commonRegionData() {
  return {
    name: `Combat Trigger`,
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
    name: `Combat Trigger (${radiusFeet} ft)`,
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
      name: `Combat Trigger (${radiusFeet} ft, attached)`,
      restriction: { enabled: true, type: "sight", priority: 0 }
    },
    { excludeToken: false }
  );

  ui.notifications?.info?.(game.i18n.format("FIGHT_ON_SIGHT.notify.created", { radius: radiusFeet }));
}

function notifyCancelled() {
  ui.notifications?.info?.(game.i18n.localize("FIGHT_ON_SIGHT.notify.cancelled"));
}

async function promptAnchorChoice() {
  const D = foundry.applications?.api?.DialogV2 ?? Dialog;
  if (D === Dialog) {
    return new Promise(resolve => {
      new Dialog({
        title: game.i18n.localize("FIGHT_ON_SIGHT.dialog.anchor.title"),
        content: `<p>${game.i18n.localize("FIGHT_ON_SIGHT.dialog.anchor.content")}</p>`,
        buttons: {
          location: { label: game.i18n.localize("FIGHT_ON_SIGHT.dialog.anchor.location"), callback: () => resolve("location") },
          token: { label: game.i18n.localize("FIGHT_ON_SIGHT.dialog.anchor.token"), callback: () => resolve("token") },
          cancel: { label: game.i18n.localize("FIGHT_ON_SIGHT.dialog.anchor.cancel"), callback: () => resolve(null) }
        },
        default: "location",
        close: () => resolve(null)
      }).render(true);
    });
  }

  return D.wait({
    window: { title: game.i18n.localize("FIGHT_ON_SIGHT.dialog.anchor.title") },
    content: `<p>${game.i18n.localize("FIGHT_ON_SIGHT.dialog.anchor.content")}</p>`,
    buttons: [
      { action: "location", label: game.i18n.localize("FIGHT_ON_SIGHT.dialog.anchor.location"), default: true },
      { action: "token", label: game.i18n.localize("FIGHT_ON_SIGHT.dialog.anchor.token") },
      { action: "cancel", label: game.i18n.localize("FIGHT_ON_SIGHT.dialog.anchor.cancel") }
    ],
    rejectClose: false
  }).then(action => (action && action !== "cancel" ? action : null));
}

// Prompt the GM to click a token. If they already have one controlled, use it.
function promptTokenClick(message) {
  const already = canvas.tokens?.controlled?.[0]?.document;
  if (already) return Promise.resolve(already);

  ui.notifications?.info?.(message);
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
