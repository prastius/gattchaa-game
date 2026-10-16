// Message contract between client and server.

export const ROOM_NAME = "world";

export const NAME_MAX = 16;
export const CHAT_MAX = 200;
export const CHAT_HISTORY = 50;
export const NET_SEND_HZ = 12;

/** Server only syncs players within this many pixels (per axis) of you. */
export const VIEW_RADIUS = 1100;

/** Facing direction; matches the LPC sprite sheet row order. */
export const Dir = { Up: 0, Left: 1, Down: 2, Right: 3 } as const;
export type Dir = (typeof Dir)[keyof typeof Dir];

export interface JoinOptions {
  name: string;
  look: string;
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

/** Read-only shape of a synced player as seen by the client. */
export interface PlayerView {
  name: string;
  look: string;
  x: number;
  y: number;
  dir: number;
  moving: boolean;
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
