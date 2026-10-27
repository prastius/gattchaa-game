// Message contract between client and server.

export const ROOM_NAME = "world";

export const NAME_MAX = 16;
export const CHAT_MAX = 200;
export const CHAT_HISTORY = 50;
/** One world-chat message per player every this many ms. */
export const CHAT_COOLDOWN_MS = 5000;
export const NET_SEND_HZ = 12;

/** Server only syncs players within this many pixels (per axis) of you. */
export const VIEW_RADIUS = 1100;

/** Facing direction; matches the LPC sprite sheet row order. */
export const Dir = { Up: 0, Left: 1, Down: 2, Right: 3 } as const;
export type Dir = (typeof Dir)[keyof typeof Dir];

export interface JoinOptions {
  name: string;
  look: string;
  /** Game session from a Gattchaa sign-in (POST /api/auth/ticket); guests have none. */
  token?: string;
}

/** server -> client, on joining: whether the Gattchaa sign-in was accepted. */
export interface AuthInfo {
  signedIn: boolean;
  /** A token was sent but is no longer valid (expired, or signed out). */
  expired?: boolean;
}

/** client -> server: local player position (client-predicted, server-validated) */
export interface MoveMessage {
  x: number;
  y: number;
  dir: number;
  moving: boolean;
}

/** client -> server: change appearance */
export interface LookMessage {
  look: string;
}

/** client -> server: sit down where you stand, or get up (walking also gets you up) */
export interface SitMessage {
  on: boolean;
}

/** Emotes, Ragnarok style: a picture pops up over your head (keys 1-9 and 0 in this order). */
export const EMOTES = ["👋", "😄", "😂", "😍", "😮", "😢", "😡", "👍", "❗", "❓"] as const;
export const EMOTE_NAMES = ["Wave", "Happy", "LOL", "Love", "Wow", "Sad", "Angry", "Nice", "!", "?"] as const;
/** One emote per player this often (ms). */
export const EMOTE_COOLDOWN_MS = 1000;

/** client -> server: show an emote (index into EMOTES) */
export interface EmoteMessage {
  e: number;
}

/** server -> client: someone showed an emote */
export interface EmoteEvent {
  from: string;
  e: number;
}

/** client -> server */
export interface ChatSend {
  text: string;
}

/** server -> client */
export interface ChatMessage {
  id: number;
  from: string; // sessionId, empty for system messages
  name: string;
  text: string;
  ts: number;
  system?: boolean;
}

/** server -> client: the server moved you (rejected move, or you went through a door) */
export interface CorrectMessage {
  x: number;
  y: number;
  /** Set when this is a door teleport: face this way afterwards. */
  dir?: number;
}

/** client -> server: walk through a door (see DOORS in town.ts) */
export interface DoorMessage {
  id: string;
}

/** client -> server: auto-attack this monster while it's in reach ("" stops). */
export interface TargetMessage {
  id: string;
}

/** server -> client: your own character sheet (nobody else gets it). HP is in the synced state. */
export interface StatsMessage {
  cls: string;
  lv: number;
  exp: number;
  mp: number;
  mmp: number;
  gold: number;
  /** Signed in, so progress is saved. Guests start over next visit. */
  saved: boolean;
}

/**
 * server -> client: fighting near you, batched once per server tick.
 * Ids are player session ids or monster ids (see MONSTER_ID_PREFIX).
 */
export type FxEvent =
  | { k: "hit"; a: string; t: string; d: number; crit?: 1 }
  | { k: "miss"; a: string; t: string }
  /** A monster was defeated, or a player was knocked out. */
  | { k: "down"; t: string }
  | { k: "lvup"; t: string; lv: number }
  /** Only to the player who earned it. */
  | { k: "gain"; exp: number; gold: number };

/** Monster ids start with this; player session ids never do. */
export const MONSTER_ID_PREFIX = "~";

/** Read-only shape of a synced player as seen by the client. */
export interface PlayerView {
  name: string;
  look: string;
  x: number;
  y: number;
  dir: number;
  moving: boolean;
  /** Players only (NPCs never sit). */
  sit?: boolean;
  /** Players only: level and health. */
  lv?: number;
  hp?: number;
  mhp?: number;
  /** Knocked out, waiting to return to town. */
  dead?: boolean;
}

/** Read-only shape of a synced monster. Its max HP and name come from MONSTERS. */
export interface MonsterView {
  kind: string;
  x: number;
  y: number;
  dir: number;
  moving: boolean;
  ts: number;
  hp: number;
}

export function sanitizeName(raw: unknown): string {
  const name = String(raw ?? "")
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
  return name || `Guest${Math.floor(1000 + Math.random() * 9000)}`;
}

export function sanitizeChat(raw: unknown): string {
  return (
    String(raw ?? "")
      // control chars + bidi overrides (keeps emoji joiners intact)
      .replace(/[\p{Cc}​‪-‮⁦-⁩]/gu, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, CHAT_MAX)
  );
}
