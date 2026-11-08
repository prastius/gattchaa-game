// The Trial of Mastery: the way to a second job, and later a third, Ragnarok style.
//
// From level 45 a Knight, Mage or Archer can ask Orin the Job Master about
// their second job (and from level 75 a Lord Knight, Wizard or Hunter about
// their third). He asks for proof first: loot from Frostfell's monsters (for
// a third job, Ashpeak's), different for each job. Once it's handed over, and
// from the new job's level (50, or 80), he sends them to the Isle of Trials far
// out in the western sea, where Vesna the Trial Keeper raises a Shade of the
// job they want: a mirror of what they could become, and it fights only them.
// Beat it before the time runs out and they're taken back to Orin, who gives
// them the job. Fall, run out of time or give up and they can try again,
// without bringing the proof twice.
//
// Rules shared by the server (which runs the trial) and the client (Orin's and
// the Keeper's windows).

import type { ItemId } from "./items";
import type { ClassId, MonsterId } from "./rpg";

/** How far along the trial a character is (saved with them; back to None once they have their next job). */
export const Trial = {
  /** Not asked yet. */
  None: 0,
  /** Orin asked for the proof. */
  Asked: 1,
  /** The proof is handed over: the trial is open to them from the next job's level. */
  Proven: 2,
  /** The Shade is beaten: Orin gives them their next job. */
  Passed: 3,
} as const;
export type Trial = (typeof Trial)[keyof typeof Trial];
export const isTrial = (n: unknown): n is Trial => Number.isInteger(n) && (n as number) >= Trial.None && (n as number) <= Trial.Passed;

/** One trial: for a job, what it leads to and when, the proof and where it's found, and the Shade. */
export interface TrialDef {
  next: ClassId;
  /** Orin sets the trial from this level, and sends you to the island from `at` (the next job's level). */
  ask: number;
  at: number;
  proof: [ItemId, number][];
  /** Where the proof is found (the land just below the next job's level). */
  from: string;
  shade: MonsterId;
}

/** Each job's trial, by the job you have now: first jobs to their second, second jobs to their third. */
export const TRIALS: Partial<Record<ClassId, TrialDef>> = {
  knight: { next: "lordKnight", ask: 45, at: 50, proof: [["wightChain", 20], ["drakeScale", 20]], from: "Frostfell", shade: "shadeLordKnight" },
  mage: { next: "wizard", ask: 45, at: 50, proof: [["frozenTear", 20], ["drakeScale", 20]], from: "Frostfell", shade: "shadeWizard" },
  archer: { next: "hunter", ask: 45, at: 50, proof: [["ramHorn", 20], ["yetiFur", 20]], from: "Frostfell", shade: "shadeHunter" },
  lordKnight: { next: "paladin", ask: 75, at: 80, proof: [["obsidianShard", 20], ["magmaCore", 20]], from: "Ashpeak", shade: "shadePaladin" },
  wizard: { next: "archmage", ask: 75, at: 80, proof: [["salamanderScale", 20], ["magmaCore", 20]], from: "Ashpeak", shade: "shadeArchmage" },
  hunter: { next: "ranger", ask: 75, at: 80, proof: [["impHorn", 20], ["cinderVeil", 20]], from: "Ashpeak", shade: "shadeRanger" },
};

/** How long you have to beat the Shade. */
export const TRIAL_MS = 3 * 60_000;
/** After winning, this long on the island before you're taken back to Orin. */
export const TRIAL_HOME_MS = 4000;

/** client -> server: at Orin's (`npc`): ask about the trial, hand over the proof, or go to the island. */
export interface TrialMessage {
  npc: string;
  step: "ask" | "prove" | "go";
}

/** client -> server: at the Keeper's (`npc`): raise the Shade, give up, or go home. */
export interface TrialKeeperMessage {
  npc: string;
  step: "begin" | "quit" | "home";
}
