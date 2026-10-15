import type { ChatMessage } from "../../../shared/protocol";

const MAX_LINES = 100;

export class ChatUI {
  private root = document.getElementById("chat")!;
  private log = document.getElementById("chat-log") as HTMLUListElement;
  private form = document.getElementById("chat-form") as HTMLFormElement;
  private input = document.getElementById("chat-input") as HTMLInputElement;

  constructor(private onSend: (text: string) => void) {
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (text) this.onSend(text);
      this.input.value = "";
      this.input.blur();
    });

    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.input.blur();
      e.stopPropagation();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && document.activeElement !== this.input) {
        e.preventDefault();
        this.input.focus();
      }
    });
  }

  show() {
    this.root.hidden = false;
  }

  isFocused(): boolean {
    return document.activeElement === this.input;
  }

  blur() {
    this.input.blur();
  }

  add(msg: ChatMessage) {
    const stick = this.log.scrollTop + this.log.clientHeight >= this.log.scrollHeight - 8;

    // textContent only: chat text is user input and must never be parsed as HTML.
    const li = document.createElement("li");
    if (msg.system) {
      li.className = "system";
      li.textContent = msg.text;
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
