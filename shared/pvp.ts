// Fighting other players outside a duel: only in the Battle Pit, a cave
// through the portal by the Arena (and inside Crownhold during a siege, see
// shared/siege.ts). Monster lands are never PVP.
//
// Down in the pit, anyone from level 20 may attack anyone but their party
// and guild mates. Beaten, you lose nothing and wake up by the Arena. A win
// earns Glory (signed-in players only), spent at the Arena Master.
//
// Rules shared by the server (which runs every fight) and the client (who can
// be clicked to attack, and the warnings).

import { fieldAt } from "./rpg";
import type { ItemId } from "./items";
import { inCastle } from "./town";

/** Players below this level can't fight other players, or be fought, even in the Battle Pit. */
export const PVP_MIN_LEVEL = 20;
/** Leaving the game this soon after a player's hit counts as being beaten by them. */
export const PVP_COMBAT_MS = 10_000;
/** Beating the same player again this soon doesn't count towards Glory, the board or titles (no farming a friend). */
export const PVP_RECOUNT_MS = 10 * 60_000;

/** Inside the Battle Pit, where players may fight each other. */
export const inPvpZone = (px: number, py: number) => Boolean(fieldAt(px, py)?.pvp);

/** What both the server and the client know about a player, enough for the rules below. */
export interface PvpSide {
  x: number;
  y: number;
  lv: number;
  dead?: boolean;
  /** Their duel opponent ("" or missing: none). Duelists only fight each other. */
  duel?: string;
  /** Their party ("" or missing: none). Party members never fight each other. */
  party?: string;
  /** Their guild ("" or missing: none). Nor do guild mates. */
  guild?: string;
}

/**
 * Why `a` can't attack `b` right now ("" if they can). `siege`: Crownhold is
 * under siege, and inside its walls guild members fight any other guild's,
 * at any level (see shared/siege.ts).
 */
export function pvpBlock(a: PvpSide, b: PvpSide, siege = false): string {
  if (a.dead || b.dead) return "Nobody to fight";
  if (a.duel || b.duel) return a.duel ? "Finish your duel first" : "They're in a duel";
  if (a.party && a.party === b.party) return "They're in your party";
  if (a.guild && a.guild === b.guild) return "They're in your guild";
  if (siege && inCastle(a.x, a.y) && inCastle(b.x, b.y)) return a.guild && b.guild ? "" : "Only guilds fight in the siege";
  if (!inPvpZone(a.x, a.y)) return "Players can only fight in the Battle Pit, by the Arena";
  if (!inPvpZone(b.x, b.y)) return "They're outside the Battle Pit";
  if (a.lv < PVP_MIN_LEVEL) return `You can fight players from level ${PVP_MIN_LEVEL}`;
  if (b.lv < PVP_MIN_LEVEL) return `Players under level ${PVP_MIN_LEVEL} are protected`;
  return "";
}

// ---------------------------------------------------------------- Sable's board: the Battle Pit's best fighters

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** The weekly board starts again every Monday at midnight, Batam time (UTC+7). */
const BATAM_MS = 7 * 3_600_000;
/** The week a moment falls in, counted in Mondays (1 January 1970 was a Thursday). */
export const weekOf = (ms: number) => Math.floor((ms + BATAM_MS + 3 * DAY_MS) / WEEK_MS);
/** When that week's board starts again: the next Monday at midnight, Batam time. */
export const weekEndsAt = (week: number) => (week + 1) * WEEK_MS - 3 * DAY_MS - BATAM_MS;
/** The town hears about a new top fighter of the week once they have at least this many wins in the Battle Pit. */
export const TOP_FIGHTER_NEWS = 3;

/** A fighter on the board: players beaten in the Battle Pit. */
export interface PitRow {
  name: string;
  wins: number;
}
/** server -> client (Sable): the best fighters this week and of all time. */
export interface PitBoard {
  week: PitRow[];
  all: PitRow[];
  /** Your own lines and places (signed-in players with a win on the board). */
  me?: { week?: PitRow & { rank: number }; all?: PitRow & { rank: number } };
  /** When the weekly board starts again (ms since 1970). */
  resetAt: number;
  saved: boolean;
}

// ---------------------------------------------------------------- Glory: what PVP wins are worth

/** Glory for beating a player in the Battle Pit, and for winning a ranked duel in the Arena's ring. */
export const GLORY_PIT_WIN = 2;
export const GLORY_DUEL_WIN = 3;

/** What the Arena Master gives for Glory: `n` of an item, for `glory` points. */
export interface GloryWare {
  item: ItemId;
  n: number;
  glory: number;
}
export const GLORY_SHOP: GloryWare[] = [
  { item: "whitePotion", n: 10, glory: 2 },
  { item: "goldenPotion", n: 10, glory: 5 },
  { item: "mithril", n: 1, glory: 4 },
  { item: "starCrystal", n: 1, glory: 20 },
  { item: "gladiatorMedal", n: 1, glory: 40 },
  { item: "championRing", n: 1, glory: 80 },
  { item: "conquerorCrest", n: 1, glory: 150 },
];

/** client -> server: buy GLORY_SHOP[i] from the Arena Master. */
export interface GloryBuyMessage {
  npc: string;
  i: number;
}
