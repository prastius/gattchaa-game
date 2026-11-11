// Duels: one player challenges another, and they fight until one of them is
// beaten. Nobody loses EXP or items, and both are healed afterwards. Duels
// fought in the Arena's ring between signed-in players count for the arena
// ranking.
//
// Rules and messages shared by the server (which runs every duel) and the
// client (the challenge, the countdown and the duel bar).

import { ARENA, TILE, inRect } from "./town";

/** You can challenge someone this close (px). */
export const DUEL_ASK_RANGE = 8 * TILE;
/** A challenge waits this long for an answer. */
export const DUEL_ASK_MS = 20_000;
/** One challenge at a time, at most this often. */
export const DUEL_ASK_COOLDOWN_MS = 5_000;
/** "3, 2, 1, fight!" */
export const DUEL_COUNTDOWN_MS = 3_000;
/** After this long it's a draw. */
export const DUEL_MS = 120_000;
/** Duelists more than this far apart (px) call it off. */
export const DUEL_LEASH = 16 * TILE;
/** Player hits on players do this share of the damage, so a duel lasts long enough for skills to matter. */
export const PVP_DAMAGE = 0.5;
/** How "big" a player is when you're reaching for them, like a monster's radius. */
export const PLAYER_RADIUS = 10;

/** Inside the Arena's ring of sand. */
export const inArena = (px: number, py: number) => inRect(ARENA, px / TILE, py / TILE);

/** Everyone's starting arena rating. */
export const RATING_START = 1000;
/** How much one ranked duel can move a rating. */
const RATING_K = 32;

/** Elo: the points the winner takes from the loser (more for beating someone rated higher). */
export function ratingChange(winner: number, loser: number): number {
  const expected = 1 / (1 + 10 ** ((loser - winner) / 400));
  return Math.max(1, Math.round(RATING_K * (1 - expected)));
}

/** client -> server: challenge a player (their session id). */
export interface DuelAskMessage {
  t: string;
}

/** server -> client: someone challenges you. */
export interface DuelAskEvent {
  from: string;
  name: string;
  lv: number;
  cls: string;
  /** You're both in the Arena's ring and signed in: it would count for the ranking. */
  ranked: boolean;
  /** How long you have to answer (ms). */
  ms: number;
}

/** client -> server: yes or no to a challenge. */
export interface DuelAnswerMessage {
  from: string;
  yes: boolean;
}

/** server -> client: your duel has begun (the fighting starts after the countdown). */
export interface DuelStartEvent {
  opp: string;
  name: string;
  ranked: boolean;
  /** Countdown left, then the time limit (ms). */
  countdown: number;
  ms: number;
}

/** server -> client: your duel is over. */
export interface DuelEndEvent {
  result: "win" | "lose" | "draw";
  /** Why, in a few words ("Crimson gave up", "Time's up"). */
  why: string;
  /** Ranked duels: your rating before and after. */
  rating?: [number, number];
}

/** One line of the arena ranking. */
export interface ArenaRow {
  name: string;
  rating: number;
  wins: number;
  losses: number;
}

/** server -> client: the Arena Master's board, and where you stand. */
export interface ArenaBoard {
  top: ArenaRow[];
  /** Your own line and place (none until your first ranked duel; guests never). */
  me?: ArenaRow & { rank: number };
  /** Signed in (guests can duel, but aren't ranked). */
  saved: boolean;
  /** Your Glory to spend (signed-in players; see shared/pvp.ts). */
  glory?: number;
}
