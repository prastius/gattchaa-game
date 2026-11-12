import { audio } from "../audio";

// The Help window (H, or the ? button): the Guide, the Town Rules, the Terms and
// the Privacy Policy. They're plain pages in client/public/info/, at their own
// addresses too (/guide, /rules, /terms, /privacy), shown here in a frame.

export type HelpTab = "guide" | "rules" | "terms" | "privacy";
export const HELP_TABS: [HelpTab, string][] = [
  ["guide", "Guide"],
  ["rules", "Rules"],
  ["terms", "Terms"],
  ["privacy", "Privacy"],
];
export const helpUrl = (tab: HelpTab, embed = false) => `/${tab}${embed ? "?embed=1" : ""}`;

const $ = (id: string) => document.getElementById(id)!;

export class HelpUI {
  private root = $("help");
  private frame = $("help-frame") as HTMLIFrameElement;
  private tabs = $("help-tabs");
  private tab: HelpTab = "guide";

  constructor() {
    $("help-close").addEventListener("click", () => this.close());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
    for (const [tab, label] of HELP_TABS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "help-tab";
      b.textContent = label;
      b.dataset.tab = tab;
      b.addEventListener("click", () => this.show(tab));
      this.tabs.append(b);
    }
  }

  get isOpen() {
    return !this.root.hidden;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(tab: HelpTab = this.tab) {
    this.root.hidden = false;
    this.show(tab);
    audio.blip();
  }

  close() {
    this.root.hidden = true;
  }

  private show(tab: HelpTab) {
    this.tab = tab;
    for (const b of this.tabs.querySelectorAll<HTMLButtonElement>("button")) b.classList.toggle("on", b.dataset.tab === tab);
    const url = helpUrl(tab, true);
    if (this.frame.getAttribute("src") !== url) this.frame.setAttribute("src", url);
  }
}
