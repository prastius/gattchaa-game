import Phaser from "phaser";
import { World } from "../../shared/world";
import { sanitizeName, type AuthInfo } from "../../shared/protocol";
import { LOOK_KEYS, decodeLook, encodeLook, randomLook } from "../../shared/appearance";
import { joinWorld, Net } from "./net";
import { Auth } from "./auth";
import { Vending } from "./vending";
import { preloadCharacterArt } from "./character";
import { WorldScene, type WorldSceneData } from "./scenes/WorldScene";
import { CharacterCreator } from "./ui/creator";
import { ChatUI } from "./ui/chat";
import { HUD } from "./ui/hud";
import { StatusPanel } from "./ui/status";
import { Diagnostics } from "./ui/diagnostics";
import { TownDialog } from "./ui/dialog";
import { Announcer } from "./ui/announce";
import { Shop } from "./shop";
import { audio } from "./audio";

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

// No browser "Save image as…" menu or image dragging over the game. Text
// fields and the chat log keep their menu so copy/paste still works.
document.addEventListener("contextmenu", (e) => {
  const el = e.target as Element | null;
  if (!el?.closest("input, textarea, #chat-log, a")) e.preventDefault();
});
document.addEventListener("dragstart", (e) => {
  if (e.target instanceof HTMLImageElement || e.target instanceof HTMLCanvasElement) e.preventDefault();
});

// ---------------------------------------------------------------- login + character creation

const nameInput = $<HTMLInputElement>("name-input");
const joinBtn = $<HTMLButtonElement>("join-btn");
const errorEl = $("login-error");

nameInput.value = stored(NAME_KEY) ?? "";
// Looks saved by an older version (different field count) are discarded.
const validLook = (look: string | null | undefined): look is string => look?.split(".").length === LOOK_KEYS.length;
const savedLook = stored(LOOK_KEY);
let creator = new CharacterCreator($("creator"), validLook(savedLook) ? decodeLook(savedLook) : randomLook());
preloadCharacterArt();

// Shop data (products, rooms) starts loading right away so the town is stocked on arrival.
const shop = new Shop();

// ---------------------------------------------------------------- Gattchaa account (optional)

const auth = new Auth();
const accountEl = $("account");
const accountStatus = $("account-status");
const signInBtn = $<HTMLButtonElement>("signin-btn");
const signOutBtn = $<HTMLButtonElement>("signout-btn");
/** The game server is linked to Gattchaa, so signing in works. */
let canSignIn = false;

function renderAccount() {
  accountEl.hidden = !auth.signedIn && !canSignIn;
  signInBtn.hidden = auth.signedIn;
  signOutBtn.hidden = !auth.signedIn;
  if (auth.signedIn) {
    const who = document.createElement("strong");
    who.textContent = auth.displayName || "your Gattchaa account";
    accountStatus.replaceChildren("Signed in as ", who, ". Your level is saved, and you can open a shop in the Market Square that stays open while you're away.");
  } else {
    accountStatus.textContent = "Playing as a guest. Sign in with your Gattchaa account to keep your level and open your own shop in town.";
  }
}
signInBtn.addEventListener("click", () => (location.href = auth.signInUrl));
signOutBtn.addEventListener("click", async () => {
  signOutBtn.disabled = true;
  await auth.signOut();
  signOutBtn.disabled = false;
  renderAccount();
});
shop.onChange((data) => {
  canSignIn = data.live;
  renderAccount();
});
renderAccount();

// Back from gattchaaoripa.com with ?ticket=…: finish signing in, and bring back the saved character.
auth.completeSignIn().then((result) => {
  if (typeof result === "string") errorEl.textContent = result;
  if (result && typeof result === "object") {
    nameInput.value = result.name || sanitizeName(result.displayName);
    if (validLook(result.look)) {
      creator.destroy();
      creator = new CharacterCreator($("creator"), decodeLook(result.look));
    }
  }
  renderAccount();
});

// Generate the world while the player picks their outfit (~0.5 s of CPU).
let world: World | undefined;
setTimeout(() => (world ??= new World()), 50);

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = sanitizeName(nameInput.value);
  const look = creator.encoded;
  audio.start(); // needs this click (browser autoplay rules)
  joinBtn.disabled = true;
  joinBtn.textContent = "Connecting…";
  errorEl.textContent = "";

  try {
    const room = await joinWorld({ name, look, token: auth.token ?? undefined });
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
  const status = new StatusPanel(name);
  const chat = new ChatUI((text): boolean => net.sendChat(text));
  const net = new Net(room, name, chat, hud, (reason) => {
    $("disconnected-reason").textContent = reason;
    $("disconnected").hidden = false;
  });
  net.onStats.add((s) => status.setSheet(s));
  room.onMessage("auth", (info: AuthInfo) => {
    if (!info.expired) return;
    auth.forget();
    chat.addSystem("Your Gattchaa sign-in has expired. Sign in again on the start screen to open a shop.");
  });
  const vending = new Vending(room, auth);
  const dialog = new TownDialog(shop, vending);
  const announcer = new Announcer(shop);
  net.onAnnounce.add((a) => announcer.show(a));
  const showVending = () => hud.setVending(Boolean(vending.myShop));
  vending.onChange.add(showVending);
  showVending();

  $("login").hidden = true;
  hud.show();
  status.show();
  chat.show();
  setupWardrobe(net, chat);
  setupSoundButtons();

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
  const data: WorldSceneData = { world, room, net, chat, hud, shop, dialog, vending, status };
  game.scene.add("world", WorldScene, true, data);
  game.events.once(Phaser.Core.Events.READY, () => {
    const scene = game.scene.getScene("world") as WorldScene;
    new Diagnostics(game, room, () => scene.netStats());
  });
  if (import.meta.env.DEV) Object.assign(window, { __game: game, __room: room });
}

function setupSoundButtons() {
  const music = $("music-btn");
  const sound = $("sound-btn");
  const render = () => {
    music.classList.toggle("off", !audio.musicOn);
    sound.classList.toggle("off", !audio.sfxOn);
    music.setAttribute("aria-pressed", String(audio.musicOn));
    sound.setAttribute("aria-pressed", String(audio.sfxOn));
  };
  music.addEventListener("click", () => {
    audio.start();
    audio.setMusic(!audio.musicOn);
    render();
  });
  sound.addEventListener("click", () => {
    audio.start();
    audio.setSfx(!audio.sfxOn);
    render();
  });
  render();
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
