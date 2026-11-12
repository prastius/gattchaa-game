// Gattchaa Points: the game's only money.
//
// The town has no currency of its own. Every price (Bram's potions, the
// Blacksmith's fees, the ferries, guilds and guardians, other players' shops)
// is paid in the player's Gattchaa Oripa Points, which live in their account
// on gattchaaoripa.com and are bought or earned there. The game never makes
// Points: monsters drop items and cards, never money, and no NPC buys anything
// back. Points only move through the Gattchaa API (docs/gattchaa-town-api.md):
// charged for a purchase, refunded if it couldn't be delivered, or passed from
// buyer to seller in a player shop.

/** "12,345". */
export const pointsText = (n: number) => Math.floor(n).toLocaleString("en-US");
/** "12,345 Points" (or "1 Point"). */
export const pointsLabel = (n: number) => `${pointsText(n)} ${Math.floor(n) === 1 ? "Point" : "Points"}`;
