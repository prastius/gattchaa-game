// Guilds, Ragnarok style: a name and an emblem everyone sees over your head,
// a leader and officers who invite and run things, a member list that shows
// who's online, a notice for everyone, and their own chat channel. Guild
// mates never attack each other in the Wildlands.
//
// Unlike a party, a guild is kept: it belongs to signed-in players' accounts
// and is still there tomorrow. Rules shared by the server (which keeps every
// guild in the database) and the client (the guild window, the Registrar's
// form, the names over heads).

/** The most members in one guild. */
export const GUILD_MAX = 30;
/** Founding a guild: who may, and what it costs (Bram's best gear costs a few hundred; a +7 upgrade 1,200). */
export const GUILD_FOUND_LV = 20;
export const GUILD_FOUND_GOLD = 10_000;
/** An invite waits this long for an answer. */
export const GUILD_INVITE_MS = 30_000;
export const GUILD_NAME_MIN = 3;
export const GUILD_NAME_MAX = 16;
/** The guild notice: one short message for every member, set by the leader or an officer. */
export const GUILD_NOTICE_MAX = 140;

/** Ranks, lowest first. Officers invite and remove members; only the leader appoints officers or hands over the guild. */
export const GuildRank = { Member: 0, Officer: 1, Leader: 2 } as const;
export type GuildRank = (typeof GuildRank)[keyof typeof GuildRank];
export const RANK_NAMES: Record<GuildRank, string> = { 0: "Member", 1: "Officer", 2: "Leader" };
export const isGuildRank = (n: unknown): n is GuildRank => n === 0 || n === 1 || n === 2;

/** Emblems: a symbol in a colour, packed into one byte (symbol × 16 + colour). */
export const GUILD_SYMBOLS = ["★", "✦", "♛", "♞", "♠", "♣", "♥", "♦", "✿", "☾", "❖", "✠"] as const;
export const GUILD_COLORS = ["#ffd24a", "#ff6b5e", "#ff9f43", "#7ddb6e", "#4fd1c5", "#6fa8ff", "#b48cff", "#ff8ad8", "#f2f2f2"] as const;
export const packEmblem = (symbol: number, color: number) => symbol * 16 + color;
export const isEmblem = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) >= 0 && (n as number) < 256 && Math.floor((n as number) / 16) < GUILD_SYMBOLS.length && (n as number) % 16 < GUILD_COLORS.length;
export function emblemOf(n: number): { symbol: string; color: string } {
  const e = isEmblem(n) ? n : 0;
  return { symbol: GUILD_SYMBOLS[Math.floor(e / 16)], color: GUILD_COLORS[e % 16] };
}

/**
 * A guild name as typed, tidied (single spaces, no edges), or "" when it
 * can't be one: 3 to 16 letters, digits, spaces, apostrophes or dashes,
 * starting and ending with a letter or digit, and not only digits.
 */
export function cleanGuildName(raw: unknown): string {
  const name = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < GUILD_NAME_MIN || name.length > GUILD_NAME_MAX) return "";
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '-]*[\p{L}\p{N}]$/u.test(name) || /^[\p{N} '-]+$/u.test(name)) return "";
  return name;
}

/** The guild notice as typed: one line, trimmed and cut to length. */
export const cleanNotice = (raw: unknown) =>
  String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, GUILD_NOTICE_MAX);

/** One member, as the guild window shows them. */
export interface GuildMember {
  /** Account id: members are accounts, here or not. */
  id: number;
  name: string;
  cls: string;
  lv: number;
  rank: GuildRank;
  online: boolean;
  /** When they were last in town (ms since 1970); 0 while online. */
  seen: number;
}

/** server -> client: your guild (sent on joining, on every change, and when asked); `null` when you're not in one. */
export interface GuildMessage {
  id: number;
  name: string;
  emblem: number;
  notice: string;
  /** Your own account id and rank, so the window knows what you may do. */
  me: number;
  rank: GuildRank;
  /** Leader first, then officers, then members; online ones first within each. */
  members: GuildMember[];
}

/** server -> client: someone invites you to their guild. */
export interface GuildAskEvent {
  from: string;
  name: string;
  guild: string;
  emblem: number;
  /** How many members it has already. */
  size: number;
  ms: number;
}

/** client -> server */
export interface GuildFoundMessage {
  npc: string;
  name: string;
  emblem: number;
}
export interface GuildInviteMessage {
  t: string;
}
export interface GuildAnswerMessage {
  from: string;
  yes: boolean;
}
/** Remove a member, by account id. */
export interface GuildKickMessage {
  id: number;
}
/** The leader makes a member an officer, or an officer a member again. */
export interface GuildRankMessage {
  id: number;
  rank: GuildRank;
}
/** The leader hands the guild over (they become an officer). */
export interface GuildLeadMessage {
  id: number;
}
export interface GuildNoticeMessage {
  text: string;
}

/** Members in the order the window lists them. */
export function sortMembers<T extends { rank: number; online: boolean; name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => b.rank - a.rank || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}
