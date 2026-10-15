import { siteLink, type Announcement } from "../../../shared/gattchaa";
import { thumbUrl, type Shop } from "../shop";

const SHOW_MS = 7000;

/** Pops a card at the top of the screen when something happens on gattchaaoripa.com. */
export class Announcer {
  private root = document.getElementById("announce")!;
  private queue: Announcement[] = [];
  private busy = false;

  constructor(private shop: Shop) {}

  show(a: Announcement) {
    this.queue.push(a);
    if (this.queue.length > 5) this.queue.shift();
    if (!this.busy) this.next();
  }

  private next() {
    const a = this.queue.shift();
    if (!a) {
      this.busy = false;
      return;
    }
    this.busy = true;
    const card = document.createElement("a");
    card.className = "announce-card";
    card.target = "_blank";
    card.rel = "noopener";
    card.href = a.url ? siteLink(this.shop.site, new URL(a.url).pathname, "announcement") : siteLink(this.shop.site, "/", "announcement");
    if (a.image) {
      const img = document.createElement("img");
      img.alt = "";
      img.src = thumbUrl(a.image, 128);
      card.append(img);
    }
    const text = document.createElement("div");
    const label = document.createElement("small");
    label.textContent = a.label || "Gattchaa";
    const msg = document.createElement("span");
    msg.textContent = a.message;
    text.append(label, msg);
    card.append(text);

    this.root.replaceChildren(card);
    this.root.hidden = false;
    requestAnimationFrame(() => card.classList.add("in"));
    setTimeout(() => {
      card.classList.remove("in");
      setTimeout(() => {
        this.root.hidden = true;
        this.next();
      }, 300);
    }, SHOW_MS);
  }
}
