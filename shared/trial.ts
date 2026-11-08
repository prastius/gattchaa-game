// The Trial of Mastery: the way to a second job, Ragnarok style.
//
// From level 45 a Knight, Mage or Archer can ask Orin the Job Master about
// their second job. He asks for proof from Frostfell first: loot from its
// monsters, different for each job. Once it's handed over, and from level 50,
// he sends them to the Isle of Trials far out in the western sea, where Vesna
// the Trial Keeper raises a Shade of the job they want: a mirror of what they
// could become, and it fights only them. Beat it before the time runs out and
// they're taken back to Orin, who gives them their second job. Fall, run out
// of time or give up and they can try again, without bringing the proof twice.
//
// Rules shared by the server (which runs the trial) and the client (Orin's and
// the Keeper's windows).

import type { ItemId } from "./items";
import type { ClassId, MonsterId } from "./rpg";

/** How far along the trial a character is (saved with them; back to None once they have their second job). */
export const Trial = {
  /** Not asked yet. */
  None: 0,
  /** Orin asked for the proof. */
  Asked: 1,
  /** The proof is handed over: the trial is open to them from level 50. */
  Proven: 2,
  /** The Shade is beaten: Orin gives them their second job. */
  Passed: 3,
} as const;
export type Trial = (typeof Trial)[keyof typeof Trial];
export const isTrial = (n: unknown): n is Trial => Number.isInteger(n) && (n as number) >= Trial.None && (n as number) <= Trial.Passed;

/** Orin tells you about the trial from this level (the trial itself needs SECOND_JOB_LEVEL). */
export const TRIAL_ASK_LEVEL = 45;

/** The proof each first job brings from Frostfell. */
export const TRIAL_PROOF: Partial<Record<ClassId, [ItemId, number][]>> = {
  knight: [["wightChain", 20], ["drakeScale", 20]],
  mage: [["frozenTear", 20], ["drakeScale", 20]],
  archer: [["ramHorn", 20], ["yetiFur", 20]],
};

/** The Shade each first job faces: its second job. */
export const TRIAL_SHADE: Partial<Record<ClassId, MonsterId>> = {
  knight: "shadeLordKnight",
  mage: "shadeWizard",
  archer: "shadeHunter",
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
