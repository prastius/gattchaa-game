import { Client, type Room } from "@colyseus/sdk";
import {
  ROOM_NAME,
  sanitizeChat,
  type CardInsertMessage,
  type UpgradeMessage,
  type JobMessage,
  type SkillLearnMessage,
  type SkillUseMessage,
  type ChatMessage,
  type ChatSend,
  type CorrectMessage,
  type EmoteEvent,
  type EmoteMessage,
  type FerryMessage,
  type FxEvent,
  type ItemDropMessage,
  type ItemUseMessage,
  type JoinOptions,
  type LookMessage,
  type NpcBuyMessage,
  type NpcSellMessage,
  type PickupMessage,
  type StatsMessage,
  type UnequipMessage,
} from "../../shared/protocol";
import type { BagMessage, ItemId, Slot } from "../../shared/items";
import type { SkillId } from "../../shared/skills";
import type { TitleId, TitleShowMessage, TitlesMessage } from "../../shared/titles";
import type { ArenaBoard, DuelAnswerMessage, DuelAskEvent, DuelAskMessage, DuelEndEvent, DuelStartEvent } from "../../shared/duels";
import type { Announcement, NpcSay } from "../../shared/gattchaa";
import type { ChatUI } from "./ui/chat";
import { audio } from "./audio";
import type { HUD } from "./ui/hud";
import type { WildBoard } from "../../shared/pvp";
import type { PartyAnswerMessage, PartyAskEvent, PartyInviteMessage, PartyKickMessage, PartyMessage } from "../../shared/party";
import type {
  GuildAnswerMessage,
  GuildAskEvent,
  GuildFoundMessage,
  GuildInviteMessage,
  GuildKickMessage,
  GuildLeadMessage,
  GuildMessage,
  GuildNoticeMessage,
  GuildRank,
  GuildRankMessage,
} from "../../shared/guild";
import type { CastleGuards, TributeResult } from "../../shared/siege";

function serverUrl(): string {
  if (import.meta.env.VITE_SERVER_URL) return import.meta.env.VITE_SERVER_URL;
  // Dev: Vite on :5173, game server on :2567. Prod: the game server hosts the client.
  if (import.meta.env.DEV) return `${location.protocol}//${location.hostname}:2567`;
  return location.origin;
}

export async function joinWorld(options: JoinOptions): Promise<Room> {
  const client = new Client(serverUrl());
  return client.joinOrCreate(ROOM_NAME, options);
}

/**
 * Registers every message handler immediately after joining (the server sends
 * chat history right away, before Phaser has booted) and fans messages out to
 * the UI and, once it exists, the scene.
 */
export class Net {
  onBubble?: (sessionId: string, text: string) => void;
  onCorrect?: (pos: CorrectMessage) => void;
  onNpcSay?: (msg: NpcSay) => void;
  onEmote?: (sessionId: string, e: number) => void;
  /** Fighting nearby (only once the scene is listening; earlier events don't matter). */
  onFx?: (events: FxEvent[]) => void;
  readonly onAnnounce = new Set<(a: Announcement) => void>();
  readonly onStats = new Set<(s: StatsMessage) => void>();
  readonly onBag = new Set<(b: BagMessage) => void>();
  readonly onTitles = new Set<(t: TitlesMessage) => void>();
  readonly onDuelAsk = new Set<(ev: DuelAskEvent) => void>();
  readonly onParty = new Set<(p: PartyMessage | null) => void>();
  readonly onPartyAsk = new Set<(ev: PartyAskEvent) => void>();
  readonly onGuild = new Set<(g: GuildMessage | null) => void>();
  readonly onGuildAsk = new Set<(ev: GuildAskEvent) => void>();
  readonly onTribute = new Set<(r: TributeResult) => void>();
  readonly onCastleGuards = new Set<(g: CastleGuards) => void>();
  readonly onDuelStart = new Set<(ev: DuelStartEvent) => void>();
  readonly onDuelEnd = new Set<(ev: DuelEndEvent) => void>();
  readonly onArenaBoard = new Set<(b: ArenaBoard) => void>();
  readonly onWildBoard = new Set<(b: WildBoard) => void>();
  /** Your latest character sheet. */
  stats?: StatsMessage;
  /** Your bag and equipment, as of the server's last word. */
  bag?: BagMessage;
  /** Your titles and how far along the rest are. */
  titles?: TitlesMessage;
  /** Your guild (null: not in one; undefined: no word from the server yet). */
  guild?: GuildMessage | null;

  constructor(
    readonly room: Room,
    private myName: string,
    private chat: ChatUI,
    hud: HUD,
    onClosed: (reason: string) => void,
  ) {
    room.onMessage("chat:history", (history: ChatMessage[]) => {
      for (const msg of history) chat.add(msg);
    });
    room.onMessage("chat", (msg: ChatMessage) => {
      // Our own messages were already shown the moment we sent them.
      if (msg.from === room.sessionId) return;
      chat.add(msg);
      if (msg.from) {
        this.onBubble?.(msg.from, msg.text);
        audio.pop();
      }
    });
    room.onMessage("correct", (pos: CorrectMessage) => this.onCorrect?.(pos));
    room.onMessage("npc:say", (msg: NpcSay) => this.onNpcSay?.(msg));
    room.onMessage("emote", (msg: EmoteEvent) => this.onEmote?.(msg.from, msg.e));
    room.onMessage("announce", (a: Announcement) => {
      for (const fn of this.onAnnounce) fn(a);
    });
    room.onMessage("me", (s: StatsMessage) => {
      this.stats = s;
      for (const fn of this.onStats) fn(s);
    });
    room.onMessage("fx", (events: FxEvent[]) => this.onFx?.(events));
    room.onMessage("bag", (b: BagMessage) => {
      this.bag = b;
      for (const fn of this.onBag) fn(b);
    });
    room.onMessage("titles", (t: TitlesMessage) => {
      this.titles = t;
      for (const fn of this.onTitles) fn(t);
    });
    room.onMessage("duel:ask", (ev: DuelAskEvent) => {
      for (const fn of this.onDuelAsk) fn(ev);
    });
    room.onMessage("duel:start", (ev: DuelStartEvent) => {
      for (const fn of this.onDuelStart) fn(ev);
    });
    room.onMessage("duel:end", (ev: DuelEndEvent) => {
      for (const fn of this.onDuelEnd) fn(ev);
    });
    room.onMessage("arena:board", (b: ArenaBoard) => {
      for (const fn of this.onArenaBoard) fn(b);
    });
    room.onMessage("wild:board", (b: WildBoard) => {
      for (const fn of this.onWildBoard) fn(b);
    });
    room.onMessage("party", (p: PartyMessage | null) => {
      for (const fn of this.onParty) fn(p);
    });
    room.onMessage("party:ask", (ev: PartyAskEvent) => {
      for (const fn of this.onPartyAsk) fn(ev);
    });
    room.onMessage("guild", (g: GuildMessage | null) => {
      this.guild = g;
      for (const fn of this.onGuild) fn(g);
    });
    room.onMessage("guild:ask", (ev: GuildAskEvent) => {
      for (const fn of this.onGuildAsk) fn(ev);
    });
    room.onMessage("castle:tribute", (r: TributeResult) => {
      for (const fn of this.onTribute) fn(r);
    });
    room.onMessage("castle:guards", (g: CastleGuards) => {
      for (const fn of this.onCastleGuards) fn(g);
    });

    room.onDrop((code, reason) => {
      console.warn("connection dropped", code, reason);
      hud.setConnected(false);
      chat.addSystem("Connection lost, reconnecting…");
    });
    room.onReconnect(() => {
      hud.setConnected(true);
      chat.addSystem("Reconnected.");
    });
    room.onLeave((code, reason) => {
      hud.setConnected(false);
      onClosed(reason || `Connection closed (code ${code}).`);
    });
  }

  sendChat(raw: string): boolean {
    const text = sanitizeChat(raw);
    if (!text) return false;
    this.room.send("chat", { text } satisfies ChatSend);
    // Local echo: no waiting for the server round trip. /p is said to your party only, /g to your guild
    // (outside one, the server explains instead).
    const party = /^\/p(?:arty)? +(.+)$/i.exec(text);
    const guild = /^\/g(?:uild)? +(.+)$/i.exec(text);
    if (guild && !this.guild) return true;
    const said = party?.[1] ?? guild?.[1] ?? text;
    this.chat.add({ id: 0, from: this.room.sessionId, name: this.myName, text: said, ts: Date.now(), ...(party && { party: true as const }), ...(guild && { guild: true as const }) });
    this.onBubble?.(this.room.sessionId, said);
    return true;
  }

  sendLook(look: string) {
    this.room.send("look", { look } satisfies LookMessage);
  }

  // ---------------------------------------------------------------- items (the server answers with a new bag)

  useItem(slot: number) {
    this.room.send("item:use", { slot } satisfies ItemUseMessage);
  }

  unequip(slot: Slot) {
    this.room.send("item:unequip", { slot } satisfies UnequipMessage);
  }

  dropItem(slot: number, n?: number) {
    this.room.send("item:drop", { slot, ...(n !== undefined && { n }) } satisfies ItemDropMessage);
  }

  pickup(id: string) {
    this.room.send("item:pickup", { id } satisfies PickupMessage);
  }

  buy(npc: string, item: ItemId, n: number) {
    this.room.send("npc:buy", { npc, item, n } satisfies NpcBuyMessage);
  }

  sell(npc: string, slot: number, n: number) {
    this.room.send("npc:sell", { npc, slot, n } satisfies NpcSellMessage);
  }

  sellLoot(npc: string) {
    this.room.send("npc:sell", { npc, loot: true } satisfies NpcSellMessage);
  }

  /** Asks the Job Master for a job. */
  chooseJob(npc: string, cls: string) {
    this.room.send("job", { npc, cls } satisfies JobMessage);
  }

  learnSkill(id: SkillId) {
    this.room.send("skill:learn", { id } satisfies SkillLearnMessage);
  }

  /** Uses a skill on monster `t` (or your target), or on yourself. */
  useSkill(id: SkillId, t?: string) {
    this.room.send("skill:use", { id, ...(t && { t }) } satisfies SkillUseMessage);
  }

  /** Puts the card in a bag slot into equipment in the bag or worn. */
  insertCard(card: number, at: { bag: number } | { gear: Slot }) {
    this.room.send("item:card", { card, ...at } satisfies CardInsertMessage);
  }

  /** Challenges a player (their session id) to a duel. */
  /** Your session id. */
  get sessionId(): string {
    return this.room.sessionId;
  }

  inviteParty(t: string) {
    this.room.send("party:invite", { t } satisfies PartyInviteMessage);
  }

  answerParty(from: string, yes: boolean) {
    this.room.send("party:answer", { from, yes } satisfies PartyAnswerMessage);
  }

  leaveParty() {
    this.room.send("party:leave");
  }

  kickParty(t: string) {
    this.room.send("party:kick", { t } satisfies PartyKickMessage);
  }

  foundGuild(npc: string, name: string, emblem: number) {
    this.room.send("guild:found", { npc, name, emblem } satisfies GuildFoundMessage);
  }

  inviteGuild(t: string) {
    this.room.send("guild:invite", { t } satisfies GuildInviteMessage);
  }

  answerGuild(from: string, yes: boolean) {
    this.room.send("guild:answer", { from, yes } satisfies GuildAnswerMessage);
  }

  leaveGuild() {
    this.room.send("guild:leave");
  }

  /** Removes a member (their account id). */
  kickGuild(id: number) {
    this.room.send("guild:kick", { id } satisfies GuildKickMessage);
  }

  setGuildRank(id: number, rank: GuildRank) {
    this.room.send("guild:rank", { id, rank } satisfies GuildRankMessage);
  }

  /** Hands your guild to another member. */
  passGuild(id: number) {
    this.room.send("guild:lead", { id } satisfies GuildLeadMessage);
  }

  setGuildNotice(text: string) {
    this.room.send("guild:notice", { text } satisfies GuildNoticeMessage);
  }

  /** Asks the Castle Herald for today's tribute (for the guild holding Crownhold). */
  tribute(npc: string) {
    this.room.send("castle:tribute", { npc });
  }

  /** Asks the Castle Herald which posts have guardians. */
  castleGuards(npc: string) {
    this.room.send("castle:guards", { npc });
  }

  /** Hires a guardian for a post, out of your own gold. */
  hireGuardian(npc: string, post: number) {
    this.room.send("castle:hire", { npc, post });
  }

  /** Asks for a fresh member list (levels and who's online change all the time). */
  getGuild() {
    this.room.send("guild:get");
  }

  askDuel(t: string) {
    this.room.send("duel:ask", { t } satisfies DuelAskMessage);
  }

  answerDuel(from: string, yes: boolean) {
    this.room.send("duel:answer", { from, yes } satisfies DuelAnswerMessage);
  }

  /** Gives up the duel you're in. */
  quitDuel() {
    this.room.send("duel:quit");
  }

  /** Asks the Arena Master for the ranking. */
  arenaBoard(npc: string) {
    this.room.send("arena:board", { npc });
  }

  wildBoard(npc: string) {
    this.room.send("wild:board", { npc });
  }

  ferry(npc: string) {
    this.room.send("ferry", { npc } satisfies FerryMessage);
  }

  /** Shows an earned title under your name ("" hides it). */
  showTitle(id: TitleId | "") {
    this.room.send("title:show", { id } satisfies TitleShowMessage);
  }

  /** Asks the Blacksmith to upgrade equipment in the bag or worn. */
  upgrade(npc: string, at: { bag: number } | { gear: Slot }) {
    this.room.send("smith:upgrade", { npc, ...at } satisfies UpgradeMessage);
  }

  /** Shows an emote over your head: locally right away, and to everyone nearby. */
  sendEmote(e: number) {
    this.room.send("emote", { e } satisfies EmoteMessage);
    this.onEmote?.(this.room.sessionId, e);
  }
}
