// Parties, Ragnarok style: up to six players who hunt together. Monster EXP
// the party earns is shared evenly among the members close by (with a bonus
// for each of them), party members may pick up each other's loot straight
// away, never attack each other in the Wildlands, and talk on their own channel.
//
// Rules shared by the server (which keeps every party) and the client (the
// party panel, green names, the invite buttons).

/** The most players in one party. */
export const PARTY_MAX = 6;
/** An invite waits this long for an answer. */
export const PARTY_INVITE_MS = 30_000;
/** Members alive and this close to a monster when it falls share its EXP, even if they never hit it. */
export const PARTY_SHARE_PX = 960;
/** Even sharing needs everyone sharing a kill within this many levels of each other; otherwise it goes by damage as usual. */
export const PARTY_LEVEL_GAP = 15;
/** Each member sharing a kill after the first adds this much to the party's EXP (+10% each: +50% for a full party). */
export const PARTY_BONUS = 0.1;
/** How often the server sends each member where the others are and how they're doing. */
export const PARTY_UPDATE_MS = 1000;

/** EXP a party shares out of a monster worth `exp` to it, split `n` ways: what each one gets (before their own level penalty). */
export const partyShare = (exp: number, n: number) => (exp * (1 + PARTY_BONUS * (n - 1))) / n;

/** One member, as the party panel shows them. */
export interface PartyMember {
  id: string;
  name: string;
  cls: string;
  lv: number;
  hp: number;
  mhp: number;
  x: number;
  y: number;
  dead: boolean;
}

/** server -> client: your party (sent when it changes, and every PARTY_UPDATE_MS); `null` when you're not in one. */
export interface PartyMessage {
  id: string;
  /** Session id of the leader: the only one who may invite and remove members. */
  leader: string;
  members: PartyMember[];
}

/** server -> client: someone invites you to their party. */
export interface PartyAskEvent {
  from: string;
  name: string;
  lv: number;
  cls: string;
  /** How many are in their party already (1 = just them). */
  size: number;
  ms: number;
}

/** client -> server */
export interface PartyInviteMessage {
  t: string;
}
export interface PartyAnswerMessage {
  from: string;
  yes: boolean;
}
export interface PartyKickMessage {
  t: string;
}
