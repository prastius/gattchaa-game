import {
  TITLES,
  cleanDeeds,
  isTitleId,
  newTitles,
  titleProgress,
  type Deeds,
  type TitleDef,
  type TitleId,
  type TitlesMessage,
} from "../../../shared/titles";

const parse = (json: string | null | undefined): unknown => {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
};

/**
 * A character's deeds and titles. Only bookkeeping: Combat says what
 * happened, and the room hands out Pioneer (which needs the whole server).
 */
export class TitleBook {
  deeds: Deeds;
  earned: TitleId[] = [];
  shown: TitleId | "" = "";

  private constructor(deeds: Deeds) {
    this.deeds = deeds;
  }

  /** From the saved JSON. Unknown titles are dropped; a shown title must be earned. */
  static load(deedsJson: string | null | undefined, titlesJson: string | null | undefined): TitleBook {
    const book = new TitleBook(cleanDeeds(parse(deedsJson)));
    const t = parse(titlesJson) as { earned?: unknown; shown?: unknown } | null;
    if (t && Array.isArray(t.earned)) book.earned = [...new Set(t.earned.filter(isTitleId))];
    if (t && isTitleId(t.shown) && book.earned.includes(t.shown)) book.shown = t.shown;
    return book;
  }

  /** For the database (null when there's nothing yet). */
  save(): { deeds: string | null; titles: string | null } {
    const d = this.deeds;
    const empty = !Object.keys(d.kills).length && !d.cards.length && !d.legendary && !d.bestUp && !d.upFails && !d.shop;
    return {
      deeds: empty ? null : JSON.stringify(d),
      titles: this.earned.length ? JSON.stringify({ earned: this.earned, shown: this.shown }) : null,
    };
  }

  /** Titles just earned by deeds and level (added to `earned`). */
  check(level: number): TitleId[] {
    const fresh = newTitles(this.deeds, level, this.earned);
    this.earned.push(...fresh);
    return fresh;
  }

  /** Gives a title outright (Pioneer). False if it was already earned. */
  grant(id: TitleId): boolean {
    if (this.earned.includes(id)) return false;
    this.earned.push(id);
    return true;
  }

  /** Shows an earned title under the name ("" hides it). False if it isn't earned. */
  show(id: TitleId | ""): boolean {
    if (id && !this.earned.includes(id)) return false;
    this.shown = id;
    return true;
  }

  /** The aura the shown title gives, if any. */
  aura(): number | undefined {
    return this.shown ? (TITLES[this.shown] as TitleDef).aura : undefined;
  }

  message(level: number): TitlesMessage {
    const progress: TitlesMessage["progress"] = {};
    for (const t of Object.values(TITLES) as (TitleDef & { id: TitleId })[]) progress[t.id] = titleProgress(t, this.deeds, level);
    return { earned: this.earned, shown: this.shown, progress };
  }
}
