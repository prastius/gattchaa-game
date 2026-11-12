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
import { BagPanel } from "./ui/bag";
import { SkillsUI } from "./ui/skills";
import { TitlesUI } from "./ui/titles";
import { HelpUI } from "./ui/help";
import { DuelUI } from "./ui/duel";
import { PartyUI } from "./ui/party";
import { GuildUI } from "./ui/guild";
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

// ---------------------------------------------------------------- Gattchaa account (required)
//
// The town is played with a Gattchaa Oripa account: its money is the player's
// Gattchaa Points (shared/points.ts), so there are no guests. A dev build keeps
// a guest button for test servers started with ALLOW_GUESTS=1.

const auth = new Auth();
const accountEl = $("account");
const accountStatus = $("account-status");
const signInBtn = $<HTMLButtonElement>("signin-btn");
const signOutBtn = $<HTMLButtonElement>("signout-btn");
/** The game server is linked to Gattchaa, so signing in works. */
let canSignIn = false;

function renderAccount() {
  accountEl.hidden = false;
  signInBtn.hidden = auth.signedIn;
  signInBtn.disabled = !canSignIn;
  signOutBtn.hidden = !auth.signedIn;
  // No account, no town: only a dev build may walk in as a guest (on a test server that allows it).
  joinBtn.hidden = !auth.signedIn && !import.meta.env.DEV;
  if (!joinBtn.disabled) joinBtn.textContent = auth.signedIn ? "Enter town" : "Enter as guest (test server)";
  if (auth.signedIn) {
    const who = document.createElement("strong");
    who.textContent = auth.displayName || "your Gattchaa account";
    accountStatus.replaceChildren("Signed in as ", who, ". Your level and items are saved to your account, and you pay with your Gattchaa Points.");
  } else if (canSignIn) {
    accountStatus.textContent = "Gattchaa Town is played with your Gattchaa Oripa account: sign in to enter. Your level and items are saved to it, and everything in town is paid for with your Gattchaa Points.";
  } else {
    accountStatus.textContent = "Signing in with Gattchaa isn't available right now. Please try again in a little while.";
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
    const why = String((err as Error)?.message ?? "");
    if (why.includes("SIGN_IN_EXPIRED")) {
      auth.forget();
      errorEl.textContent = "Your Gattchaa sign-in has expired. Please sign in again.";
    } else if (why.includes("SIGN_IN_REQUIRED")) errorEl.textContent = "Please sign in with your Gattchaa Oripa account to enter the town.";
    else errorEl.textContent = "Could not reach the game server. Please try again in a moment.";
    joinBtn.disabled = false;
    renderAccount();
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
    chat.addSystem("Your Gattchaa sign-in has expired. Sign in again on the start screen.");
  });
  const vending = new Vending(room, auth);
  const dialog = new TownDialog(shop, vending, net);
  const bag = new BagPanel(net);
  const skills = new SkillsUI(net);
  const titles = new TitlesUI(net);
  // Help (H, or the ? button): the Guide, the Rules, the Terms and the Privacy Policy.
  const help = new HelpUI();
  $("help-btn").addEventListener("click", () => help.toggle());
  window.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement | null;
    const typing = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || Boolean(t?.isContentEditable);
    if ((e.key === "h" || e.key === "H") && !e.repeat && !typing) help.toggle();
  });
  const duel = new DuelUI(net, chat);
  const party = new PartyUI(net);
  const guild = new GuildUI(net);
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
  const data: WorldSceneData = { world, room, net, chat, hud, shop, dialog, vending, status, bag, skills, titles, duel, party, guild };
  game.scene.add("world", WorldScene, true, data);
  game.events.once(Phaser.Core.Events.READY, () => {
    const scene = game.scene.getScene("world") as WorldScene;
    new Diagnostics(game, room, () => scene.netStats());
  });
  if (import.meta.env.DEV) Object.assign(window, { __game: game, __room: room, __net: net });
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
