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
  /** Their party ("" or missing: none). Party members never fight each other out here. */
  party?: string;
  /** Their guild ("" or missing: none). Nor do guild mates. */
  guild?: string;
}

/** Why `a` can't attack `b` right now ("" if they can). */
export function pvpBlock(a: PvpSide, b: PvpSide): string {
  if (a.dead || b.dead) return "Nobody to fight";
  if (a.duel || b.duel) return a.duel ? "Finish your duel first" : "They're in a duel";
  if (a.party && a.party === b.party) return "They're in your party";
  if (a.guild && a.guild === b.guild) return "They're in your guild";
  if (!inPvpZone(a.x, a.y)) return "Players can only fight in the Wildlands";
  if (!inPvpZone(b.x, b.y)) return "They're outside the Wildlands";
  if (a.lv < PVP_MIN_LEVEL) return `You can fight players from level ${PVP_MIN_LEVEL}`;
  if (b.lv < PVP_MIN_LEVEL) return `Players under level ${PVP_MIN_LEVEL} are protected`;
  return "";
}

/** What an Outlaw carrying `gold` pays whoever beats them. */
export const bountyOf = (gold: number) => Math.min(BOUNTY_MAX, Math.floor(Math.max(0, gold) * BOUNTY_SHARE));

// ---------------------------------------------------------------- Sable's board: the best hunters, and who's wanted

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** The weekly board starts again every Monday at midnight, Batam time (UTC+7). */
const BATAM_MS = 7 * 3_600_000;
/** The week a moment falls in, counted in Mondays (1 January 1970 was a Thursday). */
export const weekOf = (ms: number) => Math.floor((ms + BATAM_MS + 3 * DAY_MS) / WEEK_MS);
/** When that week's board starts again: the next Monday at midnight, Batam time. */
export const weekEndsAt = (week: number) => (week + 1) * WEEK_MS - 3 * DAY_MS - BATAM_MS;
/** The town hears about a new top hunter of the week once they have at least this many wins. */
export const TOP_HUNTER_NEWS = 3;

/** A hunter on the board: players beaten in the Wildlands, and how many of them were Outlaws (with the bounty gold). */
export interface WildRow {
  name: string;
  wins: number;
  bounties: number;
  gold: number;
}
/** Someone who's an Outlaw right now, and what they're worth to whoever beats them. */
export interface WantedRow {
  name: string;
  lv: number;
  bounty: number;
  /** How long until their name is clean again. */
  ms: number;
  /** It's you. */
  you?: true;
}
/** server -> client (Sable): who's wanted, and the best hunters this week and of all time. */
export interface WildBoard {
  wanted: WantedRow[];
  week: WildRow[];
  all: WildRow[];
  /** Your own lines and places (signed-in players with a win on the board). */
  me?: { week?: WildRow & { rank: number }; all?: WildRow & { rank: number } };
  /** When the weekly board starts again (ms since 1970). */
  resetAt: number;
  saved: boolean;
}
