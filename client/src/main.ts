import Phaser from "phaser";
import { World } from "../../shared/world";
import { sanitizeName } from "../../shared/protocol";
import { LOOK_KEYS, decodeLook, encodeLook, randomLook } from "../../shared/appearance";
import { joinWorld, Net } from "./net";
import { preloadCharacterArt } from "./character";
import { WorldScene, type WorldSceneData } from "./scenes/WorldScene";
import { CharacterCreator } from "./ui/creator";
import { ChatUI } from "./ui/chat";
import { HUD } from "./ui/hud";
import { Diagnostics } from "./ui/diagnostics";
import { TownDialog } from "./ui/dialog";
import { Announcer } from "./ui/announce";
import { Shop } from "./shop";

const NAME_KEY = "my-world:name";
const LOOK_KEY = "my-world:look";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage unavailable (private mode)
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- login + character creation

const nameInput = $<HTMLInputElement>("name-input");
const joinBtn = $<HTMLButtonElement>("join-btn");
const errorEl = $("login-error");

nameInput.value = stored(NAME_KEY) ?? "";
// Looks saved by an older version (different field count) are discarded.
const savedLook = stored(LOOK_KEY)?.split(".").length === LOOK_KEYS.length ? stored(LOOK_KEY) : null;
const creator = new CharacterCreator($("creator"), savedLook ? decodeLook(savedLook) : randomLook());
preloadCharacterArt();

// Shop data (products, rooms) starts loading right away so the town is stocked on arrival.
const shop = new Shop();

// Generate the world while the player picks their outfit (~0.5 s of CPU).
let world: World | undefined;
setTimeout(() => (world ??= new World()), 50);

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = sanitizeName(nameInput.value);
  const look = creator.encoded;
  joinBtn.disabled = true;
  joinBtn.textContent = "Connecting…";
  errorEl.textContent = "";

  try {
    const room = await joinWorld({ name, look });
    store(NAME_KEY, name);
    store(LOOK_KEY, look);
    creator.destroy();
    start(room, name);
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Could not reach the game server. Is it running?";
    joinBtn.disabled = false;
    joinBtn.textContent = "Enter town";
  }
});

// ---------------------------------------------------------------- game

function start(room: Awaited<ReturnType<typeof joinWorld>>, name: string) {
  world ??= new World();
  const hud = new HUD(world);
  const chat = new ChatUI((text) => net.sendChat(text));
  const net = new Net(room, name, chat, hud, (reason) => {
    $("disconnected-reason").textContent = reason;
    $("disconnected").hidden = false;
  });
  const dialog = new TownDialog(shop);
  const announcer = new Announcer(shop);
  net.onAnnounce.add((a) => announcer.show(a));

  $("login").hidden = true;
  hud.show();
  chat.show();
  setupWardrobe(net, chat);

  // Render at the screen's real pixel density (then CSS-scale back down), so
  // pixel art is never stretched by a fractional factor on HiDPI displays.
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const deviceSize = () => [Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr)] as const;
  const [w, h] = deviceSize();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: "game",
    backgroundColor: "#1f5f7a",
    pixelArt: true,
    scale: { mode: Phaser.Scale.NONE, width: w, height: h, zoom: 1 / dpr },
    input: { activePointers: 2 },
    audio: { noAudio: true },
    banner: false,
  });
  window.addEventListener("resize", () => {
    const [nw, nh] = deviceSize();
    // Resizing clears the canvas; skip no-op resize events.
    if (nw === game.scale.width && nh === game.scale.height) return;
    game.scale.resize(nw, nh);
    game.scale.setZoom(1 / dpr);
  });
  const data: WorldSceneData = { world, room, net, chat, hud, shop, dialog };
  game.scene.add("world", WorldScene, true, data);
  game.events.once(Phaser.Core.Events.READY, () => {
    const scene = game.scene.getScene("world") as WorldScene;
    new Diagnostics(game, room, () => scene.netStats());
  });
  if (import.meta.env.DEV) Object.assign(window, { __game: game, __room: room });
}

function setupWardrobe(net: Net, chat: ChatUI) {
  const panel = $("wardrobe");
  let editor: CharacterCreator | undefined;
  let before = "";

  const close = (save: boolean) => {
    if (!editor) return;
    if (save && editor.encoded !== before) {
      net.sendLook(editor.encoded);
      store(LOOK_KEY, editor.encoded);
    }
    editor.destroy();
    editor = undefined;
    panel.hidden = true;
    chat.setEnabled(true);
  };

  $("wardrobe-btn").hidden = false;
  $("wardrobe-btn").addEventListener("click", () => {
    if (editor) return close(false);
    before = encodeLook(decodeLook(stored(LOOK_KEY)));
    editor = new CharacterCreator($("wardrobe-creator"), decodeLook(before));
    panel.hidden = false;
    chat.setEnabled(false);
  });
  $("wardrobe-save").addEventListener("click", () => close(true));
  $("wardrobe-cancel").addEventListener("click", () => close(false));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editor) close(false);
  });
}
