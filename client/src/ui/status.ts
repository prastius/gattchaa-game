import { CLASSES, LEVEL_CAP, expToNext, isClassId } from "../../../shared/rpg";
import type { StatsMessage } from "../../../shared/protocol";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const pct = (n: number, of: number) => `${Math.max(0, Math.min(100, (n / Math.max(1, of)) * 100))}%`;

/**
 * Your character at a glance (top left): name, class and level, HP, MP, EXP
 * and gold, like Ragnarok's basic info window. Below it, the monster you're
 * fighting. And the "you fainted" screen.
 */
export class StatusPanel {
  private root = $("status");
  private level = $("status-level");
  private hpFill = $("hp-fill");
  private hpText = $("hp-text");
  private mpFill = $("mp-fill");
  private mpText = $("mp-text");
  private expFill = $("exp-fill");
  private expText = $("exp-text");
  private gold = $("gold");
  private note = $("status-note");
  private target = $("target");
  private targetName = $("target-name");
  private targetLevel = $("target-level");
  private targetFill = $("target-fill");
  private knockedOut = $("knocked-out");
  private returnBtn = $<HTMLButtonElement>("return-btn");
  private shown = { hp: -1, mhp: -1, target: "" };

  constructor(name: string) {
    $("status-name").textContent = name;
  }

  show() {
    this.root.hidden = false;
  }

  setSheet(s: StatsMessage) {
    const cls = isClassId(s.cls) ? CLASSES[s.cls].name : s.cls;
    this.level.textContent = `${cls} · Lv ${s.lv}`;
    this.mpFill.style.width = pct(s.mp, s.mmp);
    this.mpText.textContent = `${s.mp} / ${s.mmp}`;
    if (s.lv >= LEVEL_CAP) {
      this.expFill.style.width = "100%";
      this.expText.textContent = "MAX";
      this.expFill.parentElement!.title = "Highest level for now";
    } else {
      const next = expToNext(s.lv);
      this.expFill.style.width = pct(s.exp, next);
      this.expText.textContent = `${((s.exp / next) * 100).toFixed(1)}%`;
      this.expFill.parentElement!.title = `EXP ${s.exp.toLocaleString()} / ${next.toLocaleString()}`;
    }
    this.gold.textContent = s.gold.toLocaleString();
    this.note.hidden = s.saved;
  }

  setHp(hp: number, mhp: number) {
    if (hp === this.shown.hp && mhp === this.shown.mhp) return;
    this.shown.hp = hp;
    this.shown.mhp = mhp;
    this.hpFill.style.width = pct(hp, mhp);
    this.hpFill.classList.toggle("low", hp < mhp * 0.3);
    this.hpText.textContent = `${hp} / ${mhp}`;
  }

  /** The monster (or player) you're fighting: name in its danger colour, level and health. */
  showTarget(name: string, level: number, hp: number, maxHp: number, color: string) {
    const key = `${name}|${level}|${hp}|${color}`;
    if (key === this.shown.target) return;
    this.shown.target = key;
    this.target.hidden = false;
    this.targetName.textContent = name;
    this.targetName.style.color = color;
    this.targetLevel.textContent = `Lv ${level}`;
    this.targetFill.style.width = pct(hp, maxHp);
  }

  hideTarget() {
    this.shown.target = "";
    this.target.hidden = true;
  }

  onReturn(fn: () => void) {
    this.returnBtn.addEventListener("click", () => {
      this.returnBtn.disabled = true;
      fn();
    });
  }

  setKnockedOut(on: boolean) {
    this.knockedOut.hidden = !on;
    this.returnBtn.disabled = false;
  }
}
