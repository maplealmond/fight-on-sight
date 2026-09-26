# Fight on Sight

A Foundry VTT module that lets a GM place combat trigger regions on a scene. When a PC steps into one, combat starts automatically and pulls in every nearby NPC and every PC in the party.

## Usage

Open the **Fight on Sight Macros** compendium and run **Create Combat Region** (drag it to your hotbar for quick access) as a GM. Pick an anchor:

- **Location** — click on the map to place a 30 ft circular region.
- **Token** — click a token; the region follows that token and is clipped by sight-blocking walls and darkness the target can't see through.

The region self-disables the first time a PC crosses it, so it fires exactly once.

## Bonus features

- When every combatant has rolled initiative, combat advances to round one and the game unpauses.
- If an NPC that belongs to another (still-enabled) trigger region gets pulled into a fight, that region fires too — combats cascade.
