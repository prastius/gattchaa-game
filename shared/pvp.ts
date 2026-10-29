// Open PVP: in the Wildlands, players may fight each other without asking.
//
// Strike a player who isn't an Outlaw and you become one for a while; anyone
// may hit an Outlaw without becoming one. Beaten by a player, you lose nothing
// and simply wake up in town, unless you were an Outlaw: then you lose EXP
// like any knock-out, and a bounty out of your gold goes to whoever beat you.
//
// Rules shared by the server (which runs every fight) and the client (who can
// be clicked to attack, the red names and the warnings).

import { fieldAt } from "./rpg";

/** Players below this level can't fight other players, or be fought, even in the Wildlands. */
export const PVP_MIN_LEVEL = 20;
/** Attacking a player who isn't an Outlaw makes you one for this long (from your latest such attack). */
export const OUTLAW_MS = 180_000;
/** An Outlaw beaten by a player hands this share of their gold to the winner… */
export const BOUNTY_SHARE = 0.05;
/** …up to this much. */
export const BOUNTY_MAX = 5_000;
/** Leaving the game this soon after a player's hit counts as being beaten by them. */
export const PVP_COMBAT_MS = 10_000;
/** Beating the same player again this soon doesn't count towards titles (no farming a friend). */
export const PVP_RECOUNT_MS = 10 * 60_000;

/** Inside a field where players may fight each other. */
export const inPvpZone = (px: number, py: number) => Boolean(fieldAt(px, py)?.pvp);

/** What both the server and the client know about a player, enough for the rules below. */
export interface PvpSide {
  x: number;
  y: number;
  lv: number;
  dead?: boolean;
  /** Their duel opponent ("" or missing: none). Duelists only fight each other. */
  duel?: string;
}

/** Why `a` can't attack `b` right now ("" if they can). */
export function pvpBlock(a: PvpSide, b: PvpSide): string {
  if (a.dead || b.dead) return "Nobody to fight";
  if (a.duel || b.duel) return a.duel ? "Finish your duel first" : "They're in a duel";
  if (!inPvpZone(a.x, a.y)) return "Players can only fight in the Wildlands";
  if (!inPvpZone(b.x, b.y)) return "They're outside the Wildlands";
  if (a.lv < PVP_MIN_LEVEL) return `You can fight players from level ${PVP_MIN_LEVEL}`;
  if (b.lv < PVP_MIN_LEVEL) return `Players under level ${PVP_MIN_LEVEL} are protected`;
  return "";
}

/** What an Outlaw carrying `gold` pays whoever beats them. */
export const bountyOf = (gold: number) => Math.min(BOUNTY_MAX, Math.floor(Math.max(0, gold) * BOUNTY_SHARE));
