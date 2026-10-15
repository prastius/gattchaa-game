import { Client, type Room } from "@colyseus/sdk";
import {
  ROOM_NAME,
  sanitizeChat,
  type ChatMessage,
  type ChatSend,
  type CorrectMessage,
  type JoinOptions,
  type LookMessage,
} from "../../shared/protocol";
import type { Announcement, NpcSay } from "../../shared/gattchaa";
import type { ChatUI } from "./ui/chat";
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
  readonly onAnnounce = new Set<(a: Announcement) => void>();

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
      if (msg.from) this.onBubble?.(msg.from, msg.text);
    });
    room.onMessage("correct", (pos: CorrectMessage) => this.onCorrect?.(pos));
    room.onMessage("npc:say", (msg: NpcSay) => this.onNpcSay?.(msg));
    room.onMessage("announce", (a: Announcement) => {
      for (const fn of this.onAnnounce) fn(a);
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

  sendChat(raw: string) {
    const text = sanitizeChat(raw);
    if (!text) return;
    this.room.send("chat", { text } satisfies ChatSend);
    // Local echo: no waiting for the server round trip.
    this.chat.add({ id: 0, from: this.room.sessionId, name: this.myName, text, ts: Date.now() });
    this.onBubble?.(this.room.sessionId, text);
  }

  sendLook(look: string) {
    this.room.send("look", { look } satisfies LookMessage);
  }
}
