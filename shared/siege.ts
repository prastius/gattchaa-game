// Guild wars, Ragnarok style: twice a week Crownhold, the guild castle on its
// island north-east of the Wildlands, is under siege for an hour. Guilds fight
// their way through its gate and round its keep to the crystal at its heart;
// the guild whose member breaks it takes the castle (and everyone else inside
// is thrown out), and the guild that holds it when the hour is up keeps it
// until the next siege: its emblem flies over the walls, its members collect
// a tribute every day, and its leader and officers can hire guardians.
//
// Rules shared by the server (which runs the siege) and the client (the siege
// bar, who may be attacked, the Herald's window).

import { Dir } from "./protocol";
import type { Rect } from "./town";

export const CASTLE_NAME = "Crownhold";
/** The crystal at the heart of the keep (a MonsterId: it has health, and falls like a monster). */
export const CRYSTAL = "crystal";

/** Sieges start on these weekdays (0 = Sunday) at this hour, Batam time, and last an hour. */
export const SIEGE_DAYS = [3, 6] as const;
export const SIEGE_HOUR = 20;
export const SIEGE_MS = 60 * 60_000;
/** Batam is UTC+7. */
const BATAM_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

/** The siege on now (`on`), or the next one: when it starts and ends (ms since 1970). */
export function siegeAt(now: number): { on: boolean; start: number; end: number } {
  const local = now + BATAM_MS;
  const today = Math.floor(local / DAY_MS);
  for (let d = -1; d <= 7; d++) {
    const day = today + d;
    // 1 January 1970 was a Thursday (weekday 4).
    if (!(SIEGE_DAYS as readonly number[]).includes((day + 4) % 7)) continue;
    const start = day * DAY_MS + SIEGE_HOUR * 3_600_000 - BATAM_MS;
    const end = start + SIEGE_MS;
    if (now < end) return { on: now >= start, start, end };
  }
  return { on: false, start: Infinity, end: Infinity };
}

/** "Wednesday and Saturday, 8 to 9 pm (Batam time)", for the Herald. */
export const SIEGE_WHEN = "every Wednesday and Saturday, 8 to 9 pm Batam time";

/** The day a tribute counts for: one a day per member, from midnight Batam time. */
export const tributeDay = (ms: number) => Math.floor((ms + BATAM_MS) / DAY_MS);

/** What the castle pays each member of its guild once a day. */
export const TRIBUTE = {
  gold: [3_000, 6_000] as [number, number],
  items: [
    ["mithril", 2],
    ["starCrystal", 1],
    ["whitePotion", 10],
  ] as [string, number][],
  /** A second Star Crystal now and then. */
  extraCrystal: 0.25,
  /** Very rarely, a monster card (any but the bosses' legendary ones). */
  card: 0.03,
  /** Free bag slots needed to take it. */
  slots: 4,
  /** Gold the castle also pays into its guild's purse each time a member collects. */
  purse: 2_000,
};

/** Where players wake up after being beaten in the siege, and where everyone else is put when the castle changes hands. */
export const campSpot = (camp: Rect, n: number): { x: number; y: number } => ({
  x: (camp.x + 2 + (n % 8)) * 32 + 16,
  y: (camp.y + 4 + (Math.floor(n / 8) % 4)) * 32 + 16,
});

/** Guardians: knights and archers the castle's guild hires to hold it, at fixed posts (tiles). */
export type GuardianKind = "castleKnight" | "castleArcher";
export interface GuardianPost {
  kind: GuardianKind;
  x: number;
  y: number;
  /** The way they face at their post. */
  dir: number;
  /** Where it is, for the Herald's list. */
  where: string;
}
export const GUARDIAN_POSTS: readonly GuardianPost[] = [
  { kind: "castleKnight", x: 376, y: 78, dir: Dir.Left, where: "Castle gate" },
  { kind: "castleKnight", x: 376, y: 85, dir: Dir.Left, where: "Castle gate" },
  { kind: "castleArcher", x: 382, y: 81, dir: Dir.Left, where: "Castle gate" },
  { kind: "castleKnight", x: 409, y: 74, dir: Dir.Left, where: "Keep gate" },
  { kind: "castleKnight", x: 409, y: 80, dir: Dir.Left, where: "Keep gate" },
  { kind: "castleArcher", x: 412, y: 77, dir: Dir.Left, where: "Keep gate" },
  { kind: "castleKnight", x: 401, y: 74, dir: Dir.Down, where: "Crystal" },
  { kind: "castleArcher", x: 393, y: 78, dir: Dir.Right, where: "Crystal" },
];
/** What one costs to hire, out of the guild's purse. */
export const GUARDIAN_COST: Record<GuardianKind, number> = { castleKnight: 5_000, castleArcher: 4_000 };
export const isGuardian = (kind: string): kind is GuardianKind => kind === "castleKnight" || kind === "castleArcher";

/** server -> client: the castle's guardians, as the Herald lists them for you. */
export interface CastleGuards {
  /** Posts with a guardian on them. */
  posts: number[];
  /** Why you can't hire one right now ("" = you can). */
  why: string;
  /** Gold in the guild's purse (0 unless it's your guild that holds the castle). */
  purse: number;
}

/** server -> client: the Herald's answer to collecting the tribute. */
export interface TributeResult {
  ok: boolean;
  text: string;
}
