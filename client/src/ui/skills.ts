import { CLASSES, JOB_LEVEL, SECOND_JOBS, SECOND_JOB_LEVEL, aClass, isClassId } from "../../../shared/rpg";
import { TRIAL_ASK_LEVEL } from "../../../shared/trial";
import { WEAPON_NAMES } from "../../../shared/items";
import { GLOBAL_COOLDOWN_MS, SKILLS, SKILL_MAX, skillsOf, type SkillDef, type SkillId } from "../../../shared/skills";
import { packIcon } from "../character";
import type { Net } from "../net";
import { audio } from "../audio";

// Skills: the bar at the bottom of the screen (keys 1, 2, 3…) and the skills
// window (K), where skill points are spent. The server runs every cast; this
// only shows what's ready and starts the cooldown sweeps.

const $ = (id: string) => document.getElementById(id)!;

interface BarSlot {
  skill: SkillDef;
  el: HTMLButtonElement;
  lv: HTMLSpanElement;
  /** The dark wipe that shrinks as the cooldown runs out. */
  cd: HTMLSpanElement;
}

/** Why a skill can't be used right now (undefined: it can). "cooldown" is never shown. */
export type NotReady = "cooldown" | string;

export class SkillsUI {
  private bar = $("skillbar");
  private root = $("skills");
  private list = $("skills-list");
  private head = $("skills-points");
  private slots: BarSlot[] = [];
  private shownCls = "";
  /** When each skill is ready again (performance.now()), and when any skill is. */
  private readyAt = new Map<SkillId, number>();
  private gcdUntil = 0;
  /** A skill was pressed (key or bar): the game scene aims and casts it. */
  onUse?: (id: SkillId) => void;
  /** Unspent skill points changed (for the HUD badge). */
  onPoints?: (n: number) => void;

  constructor(private net: Net) {
    $("skills-close").addEventListener("click", () => this.close());
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isOpen) this.close();
    });
    net.onStats.add(() => this.refresh());
  }

  get isOpen() {
    return !this.root.hidden;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    this.root.hidden = false;
    audio.blip();
    this.renderWindow();
  }

  close() {
    this.root.hidden = true;
  }

  /** Your class's skills, in key order. */
  get mine(): SkillDef[] {
    const cls = this.net.stats?.cls;
    return isClassId(cls) ? skillsOf(cls) : [];
  }

  level(id: SkillId): number {
    return this.net.stats?.skills[id] ?? 0;
  }

  /** Whether a skill can go off now; the reason when not. */
  notReady(id: SkillId): NotReady | undefined {
    const s = SKILLS[id];
    const lv = this.level(id);
    if (lv < 1) return `Learn ${s.name} first (K)`;
    const now = performance.now();
    if (now < this.gcdUntil || now < (this.readyAt.get(id) ?? 0)) return "cooldown";
    if ((this.net.stats?.mp ?? 0) < s.mp(lv)) return "Not enough MP";
    return undefined;
  }

  /** Your cast went off: its cooldown, and a short pause on every other skill. */
  started(id: SkillId) {
    const now = performance.now();
    this.readyAt.set(id, now + SKILLS[id].cooldownMs);
    this.gcdUntil = now + GLOBAL_COOLDOWN_MS;
    for (const slot of this.slots) {
      const left = Math.max(this.gcdUntil, this.readyAt.get(slot.skill.id as SkillId) ?? 0) - now;
      if (slot.skill.id === id || left <= GLOBAL_COOLDOWN_MS) this.sweep(slot, left);
    }
  }

  /** Restarts the cooldown wipe on a slot. */
  private sweep(slot: BarSlot, ms: number) {
    slot.cd.style.animation = "none";
    void slot.cd.offsetWidth;
    slot.cd.style.animation = ms > 0 ? `skill-cd ${Math.round(ms)}ms linear forwards` : "none";
  }

  private refresh() {
    const st = this.net.stats;
    if (!st) return;
    if (st.cls !== this.shownCls) {
      this.shownCls = st.cls;
      this.buildBar();
    }
    this.updateBar();
    this.onPoints?.(st.points);
    if (this.isOpen) this.renderWindow();
  }

  private buildBar() {
    this.bar.replaceChildren();
    this.slots = [];
    const skills = this.mine;
    this.bar.hidden = skills.length === 0;
    skills.forEach((skill, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "skill-slot";
      el.title = `${skill.name} (${i + 1})`;
      const icon = document.createElement("canvas");
      icon.width = icon.height = 32;
      packIcon(skill.icon).then((c) => icon.getContext("2d")!.drawImage(c, 0, 0));
      const key = document.createElement("span");
      key.className = "skill-key";
      key.textContent = String(i + 1);
      const lv = document.createElement("span");
      lv.className = "skill-lv";
      const cd = document.createElement("span");
      cd.className = "skill-cd";
      el.append(icon, cd, key, lv);
      el.addEventListener("click", () => this.onUse?.(skill.id as SkillId));
      this.bar.append(el);
      this.slots.push({ skill, el, lv, cd });
    });
  }

  private updateBar() {
    const st = this.net.stats;
    for (const slot of this.slots) {
      const id = slot.skill.id as SkillId;
      const lv = this.level(id);
      slot.el.classList.toggle("locked", lv === 0);
      slot.el.classList.toggle("no-mp", lv > 0 && (st?.mp ?? 0) < slot.skill.mp(lv));
      slot.el.classList.toggle("buffed", Boolean(st?.buffs.some((b) => b.id === id && b.ms > 0)));
      slot.lv.textContent = lv ? String(lv) : "";
    }
  }

  private renderWindow() {
    const st = this.net.stats;
    this.list.replaceChildren();
    if (!st || !isClassId(st.cls)) return;
    const cls = CLASSES[st.cls];
    this.head.textContent = st.cls === "novice" ? "Novice" : `${cls.name} · ${st.points} skill point${st.points === 1 ? "" : "s"}`;
    this.head.classList.toggle("has-points", st.points > 0);
    if (st.cls === "novice") {
      const p = document.createElement("p");
      p.className = "skills-empty";
      p.textContent =
        st.lv >= JOB_LEVEL
          ? "You're ready for a job! Visit Orin the Job Master, just inside the south gate, and become a Knight, Mage or Archer. Each has its own skills."
          : `Novices have no skills yet. At level ${JOB_LEVEL}, Orin the Job Master (just inside the south gate) will make you a Knight, Mage or Archer, each with its own skills.`;
      this.list.append(p);
      return;
    }
    this.mine.forEach((s, i) => this.list.append(this.row(s, i, st.points)));
    const hint = document.createElement("p");
    hint.className = "skills-hint";
    hint.textContent = `Keys 1–${this.mine.length} (or the skill buttons) use your skills. You get a skill point every level.`;
    this.list.append(hint);
    const next = SECOND_JOBS[st.cls];
    if (next) {
      const more = document.createElement("p");
      more.className = "skills-hint";
      more.textContent = `From level ${TRIAL_ASK_LEVEL}, ask Orin the Job Master about the Trial of Mastery. Pass it (from level ${SECOND_JOB_LEVEL}) and he makes you ${aClass(next)}, with three more skills: ${skillsOf(next).filter((k) => k.cls === next).map((k) => k.name).join(", ")}.`;
      this.list.append(more);
    }
  }

  private row(s: SkillDef, i: number, points: number): HTMLElement {
    const id = s.id as SkillId;
    const lv = this.level(id);
    const row = document.createElement("div");
    row.className = `skill-row${lv ? "" : " unlearned"}`;

    const icon = document.createElement("canvas");
    icon.width = icon.height = 32;
    icon.className = "skill-icon";
    packIcon(s.icon).then((c) => icon.getContext("2d")!.drawImage(c, 0, 0));

    const text = document.createElement("div");
    text.className = "skill-text";
    const name = document.createElement("div");
    name.className = "skill-name";
    name.textContent = `${i + 1}. ${s.name}`;
    const level = document.createElement("span");
    level.className = "skill-level";
    level.textContent = lv ? `Lv ${lv} / ${SKILL_MAX}` : "Not learned";
    name.append(level);
    const now = document.createElement("div");
    now.className = "skill-effect";
    now.textContent = s.effect(Math.max(1, lv));
    const cost = document.createElement("div");
    cost.className = "skill-cost";
    const show = Math.max(1, lv);
    cost.textContent = `${s.mp(show)} MP · ${+(s.cooldownMs / 1000).toFixed(1)} s cooldown${s.weapon ? ` · needs a ${WEAPON_NAMES[s.weapon]}` : ""}`;
    text.append(name, now, cost);
    if (lv > 0 && lv < SKILL_MAX) {
      const next = document.createElement("div");
      next.className = "skill-next";
      next.textContent = `Next level: ${s.effect(lv + 1)}`;
      text.append(next);
    }

    const learn = document.createElement("button");
    learn.type = "button";
    learn.className = "skill-learn";
    learn.textContent = lv >= SKILL_MAX ? "Max" : lv ? "+1" : "Learn";
    learn.disabled = lv >= SKILL_MAX || points <= 0;
    learn.title = learn.disabled ? (lv >= SKILL_MAX ? "Highest level" : "No skill points left: you get one every level") : `Spend a skill point on ${s.name}`;
    learn.addEventListener("click", () => {
      audio.blip();
      this.net.learnSkill(id);
    });
    row.append(icon, text, learn);
    return row;
  }
}
