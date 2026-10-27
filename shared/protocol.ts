// Message contract between client and server.

import type { Slot } from "./items";
import type { SkillId, SkillLevels } from "./skills";

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
  /** Attack and defence, equipment and buffs included. */
  atk: number;
  def: number;
  /** How close (px, feet to feet, plus the monster's size) you hit from: more with a bow or staff. */
  range: number;
  /** Learned skills, and skill points not spent yet. */
  skills: SkillLevels;
  points: number;
  /** Buffs running on you, and how long each has left (ms). */
  buffs: { id: SkillId; ms: number }[];
  /** Signed in, so progress is saved. Guests start over next visit. */
  saved: boolean;
}

/** client -> server: use a bag slot (wear it, or drink it). */
export interface ItemUseMessage {
  slot: number;
}

/** client -> server: take off what's worn in a slot. */
export interface UnequipMessage {
  slot: Slot;
}

/** client -> server: put some of a bag slot on the ground (all of it when n is missing). */
export interface ItemDropMessage {
  slot: number;
  n?: number;
}

/**
 * client -> server: put the card in bag slot `card` into a piece of equipment,
 * in the bag (`bag`) or worn (`gear`). For good: cards never come back out.
 */
export interface CardInsertMessage {
  card: number;
  bag?: number;
  gear?: Slot;
}

/** client -> server: ask the Blacksmith to upgrade a piece of equipment, in the bag (`bag`) or worn (`gear`). */
export interface UpgradeMessage {
  npc: string;
  bag?: number;
  gear?: Slot;
}

/** client -> server: become a Knight, Mage or Archer (at the Job Master, from level 10). */
export interface JobMessage {
  npc: string;
  cls: string;
}

/** client -> server: spend a skill point. */
export interface SkillLearnMessage {
  id: string;
}

/** client -> server: use a skill (on `t`, a monster id, or your current target). */
export interface SkillUseMessage {
  id: string;
  t?: string;
}

/** client -> server: pick up an item lying on the ground. */
export interface PickupMessage {
  id: string;
}

/** client -> server: buy from an NPC merchant. */
export interface NpcBuyMessage {
  npc: string;
  item: string;
  n: number;
}

/** client -> server: sell to an NPC merchant: some of one bag slot, or every piece of monster loot. */
export type NpcSellMessage = { npc: string; slot: number; n: number } | { npc: string; loot: true };

/**
 * server -> client: fighting near you, batched once per server tick.
 * Ids are player session ids or monster ids (see MONSTER_ID_PREFIX).
 */
export type FxEvent =
  /** thorn: damage reflected back by a card (no swing, no slash). skill: a skill's hit (drawn its way). */
  | { k: "hit"; a: string; t: string; d: number; crit?: 1; thorn?: 1; skill?: SkillId }
  | { k: "miss"; a: string; t: string }
  /** A monster was defeated, or a player was knocked out. */
  | { k: "down"; t: string }
  | { k: "lvup"; t: string; lv: number }
  /** Only to the player who earned it. */
  | { k: "gain"; exp: number; gold: number }
  /** Only to the player who picked it up (or bought it). */
  | { k: "loot"; item: string; n: number }
  /** A potion (or anything else) healed someone. */
  | { k: "heal"; t: string; d: number }
  /** Someone put a card into their equipment. */
  | { k: "card"; t: string }
  /** The Blacksmith upgraded someone's gear (ok) or failed; `up` is its level now, `item` its name. */
  | { k: "forge"; t: string; ok: 0 | 1; up: number; item: string }
  /** Someone earned a title (a TitleId). */
  | { k: "title"; t: string; title: string }
  /** Someone used a skill (at monster `t`, for the ones aimed at something). Its hits follow. */
  | { k: "cast"; a: string; s: SkillId; t?: string }
  /** A monster can't move or bite for `ms`. */
  | { k: "freeze"; t: string; ms: number }
  /** Someone became a Knight, Mage or Archer. */
  | { k: "job"; t: string; cls: string }
  /** Only to you: why a skill didn't go off ("Not enough MP"). */
  | { k: "fail"; why: string };

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
  /** Visible equipment (see gearString in items.ts). */
  gear?: string;
  /** Class id ("novice", "knight"…). */
  cls?: string;
  /** Aura from gear (see auraOf in items.ts) or the shown title (titles.ts); 0 = none. */
  aura?: number;
  /** The title shown under the name (a TitleId; "" = none). */
  title?: string;
}

/** Read-only shape of an item lying on the ground. */
export interface DropView {
  item: string;
  n: number;
  x: number;
  y: number;
  /** Session id of whoever has first pick ("" = anyone may take it). */
  owner: string;
  /** Cards in a dropped piece of equipment (see cardString in items.ts). */
  cards?: string;
  /** How far a dropped piece of equipment was upgraded (0 = not). */
  up?: number;
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
