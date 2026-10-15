import { Client, type Room } from "@colyseus/sdk";
import {
  ROOM_NAME,
  type ChatMessage,
  type ChatSend,
  type CorrectMessage,
  type JoinOptions,
} from "../../shared/protocol";
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

  constructor(
    readonly room: Room,
    chat: ChatUI,
    hud: HUD,
    onClosed: (reason: string) => void,
  ) {
    room.onMessage("chat:history", (history: ChatMessage[]) => {
      for (const msg of history) chat.add(msg);
    });
    room.onMessage("chat", (msg: ChatMessage) => {
      chat.add(msg);
      if (msg.from) this.onBubble?.(msg.from, msg.text);
    });
    room.onMessage("correct", (pos: CorrectMessage) => this.onCorrect?.(pos));

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

  sendChat(text: string) {
    this.room.send("chat", { text } satisfies ChatSend);
  }
}
