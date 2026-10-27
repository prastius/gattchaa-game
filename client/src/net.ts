import { Client, type Room } from "@colyseus/sdk";
import {
  ROOM_NAME,
  sanitizeChat,
  type ChatMessage,
  type ChatSend,
  type CorrectMessage,
  type EmoteEvent,
  type EmoteMessage,
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
import type { Announcement, NpcSay } from "../../shared/gattchaa";
import type { ChatUI } from "./ui/chat";
import { audio } from "./audio";
import type { HUD } from "./ui/hud";

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
  /** Your latest character sheet. */
  stats?: StatsMessage;
  /** Your bag and equipment, as of the server's last word. */
  bag?: BagMessage;

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
    // Local echo: no waiting for the server round trip.
    this.chat.add({ id: 0, from: this.room.sessionId, name: this.myName, text, ts: Date.now() });
    this.onBubble?.(this.room.sessionId, text);
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

  /** Shows an emote over your head: locally right away, and to everyone nearby. */
  sendEmote(e: number) {
    this.room.send("emote", { e } satisfies EmoteMessage);
    this.onEmote?.(this.room.sessionId, e);
  }
}
