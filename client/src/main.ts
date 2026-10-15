import Phaser from "phaser";
import "./style.css";
import { World } from "../../shared/world";
import { sanitizeName } from "../../shared/protocol";
import { joinWorld, Net } from "./net";
import { WorldScene, type WorldSceneData } from "./scenes/WorldScene";
import { ChatUI } from "./ui/chat";
import { HUD } from "./ui/hud";

const NAME_KEY = "my-world:name";

const loginEl = document.getElementById("login")!;
const form = document.getElementById("login-form") as HTMLFormElement;
const nameInput = document.getElementById("name-input") as HTMLInputElement;
const joinBtn = document.getElementById("join-btn") as HTMLButtonElement;
const errorEl = document.getElementById("login-error")!;

try {
  nameInput.value = localStorage.getItem(NAME_KEY) ?? "";
} catch {
  /* storage unavailable (private mode) */
}
nameInput.focus();

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = sanitizeName(nameInput.value);
  joinBtn.disabled = true;
  joinBtn.textContent = "Connecting…";
  errorEl.textContent = "";

  try {
    const room = await joinWorld({ name });
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* ignore */
    }
    start(room);
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Could not reach the game server. Is it running?";
    joinBtn.disabled = false;
    joinBtn.textContent = "Enter world";
  }
});

function start(room: Awaited<ReturnType<typeof joinWorld>>) {
  // Build the world now (deterministic, ~100 ms) so it's ready when Phaser boots.
  const world = new World();
  const hud = new HUD(world);
  const chat = new ChatUI((text) => net.sendChat(text));
  const net = new Net(room, chat, hud, (reason) => {
    document.getElementById("disconnected-reason")!.textContent = reason;
    document.getElementById("disconnected")!.hidden = false;
  });

  loginEl.hidden = true;
  hud.show();
  chat.show();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#1c4a6b",
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    input: { activePointers: 2 },
    audio: { noAudio: true },
    banner: false,
  });
  const data: WorldSceneData = { world, room, net, chat, hud };
  game.scene.add("world", WorldScene, true, data);
}
