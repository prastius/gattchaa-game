import type { MapSchema } from "@colyseus/schema";
import { ITEMS } from "../../../shared/items";
import { aClass, isClassId, type ClassId } from "../../../shared/rpg";
import { TRIAL_ARRIVAL, TILE, onTrialIsle } from "../../../shared/town";
import { TRIALS, TRIAL_HOME_MS, TRIAL_MS, Trial } from "../../../shared/trial";
import type { Combat } from "./Combat";
import type { Player } from "./WorldState";

export interface TrialHooks {
  /** Moves a player somewhere else entirely. */
  move(id: string, x: number, y: number): void;
  notice(id: string, text: string): void;
}

/** Where Orin's travellers come home to: in front of him, just inside the south gate (pixels). */
const HOME = { x: 196.5 * TILE, y: 241.6 * TILE };

const proofText = (cls: ClassId) => (TRIALS[cls]?.proof ?? []).map(([item, n]) => `${n} ${ITEMS[item].name}`).join(" and ");

/**
 * The Trial of Mastery (see shared/trial.ts), step by step: Orin's part (the
 * proof, then the trip out), Vesna's (raising the Shade), and the trip home.
 * Combat runs the fight itself and remembers how far along everyone is.
 */
export class Trials {
  /** Winners waiting to be taken back to Orin, and when. */
  private homeAt = new Map<string, number>();

  constructor(
    private players: MapSchema<Player>,
    private combat: Combat,
    private hooks: TrialHooks,
  ) {}

  /** At Orin's: ask about the trial, hand over the proof, or set off for the island. */
  orin(id: string, step: unknown) {
    const p = this.players.get(id);
    const trial = p && isClassId(p.cls) ? TRIALS[p.cls] : undefined;
    if (!p || p.dead || !trial || !isClassId(p.cls)) return;
    const next = aClass(trial.next);
    if (step === "ask") {
      if (this.combat.askTrial(id)) this.hooks.notice(id, `Orin: "Bring me proof from ${trial.from}: ${proofText(p.cls)}. Then we'll see if you're ready to become ${next}."`);
    } else if (step === "prove") {
      if (this.combat.proveTrial(id)) {
        this.hooks.notice(
          id,
          p.lv >= trial.at
            ? `Orin: "Good. Now the real test: a Shade of ${next}, on the Isle of Trials. Tell me when you're ready to go."`
            : `Orin: "Good. Reach level ${trial.at} and I'll send you to the Isle of Trials."`,
        );
      }
    } else if (step === "go") {
      if (this.combat.trial(id) !== Trial.Proven) return;
      if (p.lv < trial.at) return this.hooks.notice(id, `Come back at level ${trial.at}.`);
      this.hooks.move(id, TRIAL_ARRIVAL.x, TRIAL_ARRIVAL.y);
      this.hooks.notice(id, "Orin sends you across the sea to the Isle of Trials. Talk to Vesna when you're ready.");
    }
  }

  /** At Vesna's: raise the Shade, give up, or go home. */
  keeper(id: string, step: unknown) {
    const p = this.players.get(id);
    if (!p || p.dead || !isClassId(p.cls)) return;
    if (step === "begin") {
      const trial = TRIALS[p.cls];
      if (!trial || this.combat.trial(id) !== Trial.Proven || p.lv < trial.at) return;
      if (!this.combat.raiseShade(id, trial.shade)) return;
      this.hooks.notice(id, `A Shade of ${aClass(trial.next)} rises in the circle! Beat it within ${TRIAL_MS / 60_000} minutes.`);
    } else if (step === "quit") {
      if (!this.combat.hasShade(id)) return;
      this.combat.removeShade(id);
      this.hooks.notice(id, "The Shade fades away. Talk to Vesna when you're ready to try again.");
    } else if (step === "home") {
      this.combat.removeShade(id);
      this.goHome(id);
    }
  }

  /** Combat says the Shade is gone. */
  over(id: string, how: "won" | "fell" | "time") {
    const p = this.players.get(id);
    if (!p) return;
    if (how === "won") {
      const next = isClassId(p.cls) ? TRIALS[p.cls]?.next : undefined;
      this.homeAt.set(id, Date.now() + TRIAL_HOME_MS);
      this.hooks.notice(id, `You beat the Shade! You've passed the Trial of Mastery. Orin is waiting to make you ${next ? aClass(next) : "stronger"}.`);
    } else if (how === "fell") {
      this.hooks.notice(id, "The Shade beat you. Nothing is lost: Orin can send you back whenever you're ready.");
    } else {
      this.hooks.notice(id, "Time's up: the Shade fades away. Talk to Vesna to try again.");
    }
  }

  tick(now: number) {
    for (const [id, at] of this.homeAt) {
      if (now < at) continue;
      this.homeAt.delete(id);
      const p = this.players.get(id);
      if (p && !p.dead && onTrialIsle(p.x, p.y)) this.goHome(id);
    }
  }

  leave(id: string) {
    this.homeAt.delete(id);
  }

  private goHome(id: string) {
    this.homeAt.delete(id);
    this.hooks.move(id, HOME.x, HOME.y);
    const p = this.players.get(id);
    const next = p && isClassId(p.cls) && this.combat.trial(id) === Trial.Passed ? TRIALS[p.cls]?.next : undefined;
    this.hooks.notice(id, next ? `Back in town. Talk to Orin to become ${aClass(next)}!` : "Back in town, in front of Orin.");
  }
}
