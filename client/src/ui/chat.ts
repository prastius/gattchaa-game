import { CHAT_COOLDOWN_MS, type ChatMessage } from "../../../shared/protocol";

const MAX_LINES = 100;
const PLACEHOLDER = "Press Enter to chat";

export class ChatUI {
  private root = document.getElementById("chat")!;
  private log = document.getElementById("chat-log") as HTMLUListElement;
  private form = document.getElementById("chat-form") as HTMLFormElement;
  private input = document.getElementById("chat-input") as HTMLInputElement;
  private enabled = true;
  /** Mirrors the server's chat cooldown so we never show a message it will drop. */
  private readyAt = 0;
  private countdown?: number;

  /** onSend returns false if nothing was actually sent (e.g. the text sanitized to empty). */
  constructor(private onSend: (text: string) => boolean) {
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (text && Date.now() < this.readyAt) {
        // Too soon: keep what they typed so they can send it when the timer ends.
        this.root.classList.remove("cooldown");
        void this.root.offsetWidth; // restart the shake animation
        this.root.classList.add("cooldown");
        return;
      }
      if (text && this.onSend(text)) this.startCooldown();
      this.input.value = "";
      this.input.blur();
    });

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.input.blur();
      e.stopPropagation(); // typing must never reach the game controls
    });

    window.addEventListener("keydown", (e) => {
      if (this.enabled && e.key === "Enter" && document.activeElement === document.body) {
        e.preventDefault();
        this.input.focus();
      }
    });
  }

  private startCooldown() {
    this.readyAt = Date.now() + CHAT_COOLDOWN_MS;
    clearInterval(this.countdown);
    const tick = () => {
      const left = Math.ceil((this.readyAt - Date.now()) / 1000);
      if (left > 0) {
        this.input.placeholder = `Wait ${left}s to chat again`;
        return;
      }
      clearInterval(this.countdown);
      this.input.placeholder = PLACEHOLDER;
      this.root.classList.remove("cooldown");
    };
    tick();
    this.countdown = window.setInterval(tick, 250);
  }

  show() {
    this.root.hidden = false;
  }

  /** Disabled while another panel (wardrobe) has focus. */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  isFocused(): boolean {
    const el = document.activeElement;
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  }

  blur() {
    this.input.blur();
  }

  add(msg: ChatMessage) {
    const stick = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 8;

    // textContent only: chat text is user input and must never be parsed as HTML.
    const li = document.createElement("li");
    if (msg.system && msg.name && msg.name !== "System") {
      // Live news from gattchaaoripa.com ("Big hit!", "New purchase"…)
      li.className = "announce";
      const tag = document.createElement("span");
      tag.className = "name";
      tag.textContent = `★ ${msg.name}:`;
      li.append(tag, document.createTextNode(msg.text));
    } else if (msg.system) {
      li.className = "system";
      li.textContent = msg.text;
    } else if (msg.party) {
      // Said to the party only.
      li.className = "party-line";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = `[Party] ${msg.name}:`;
      li.append(name, document.createTextNode(msg.text));
    } else {
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = `${msg.name}:`;
      li.append(name, document.createTextNode(msg.text));
    }
    li.title = new Date(msg.ts).toLocaleTimeString();
    this.log.append(li);

    while (this.log.childElementCount > MAX_LINES) this.log.firstElementChild?.remove();
    if (stick) this.log.scrollTop = this.log.scrollHeight;
  }

  addSystem(text: string) {
    this.add({ id: 0, from: "", name: "", text, ts: Date.now(), system: true });
  }
}
