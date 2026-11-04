import type { MapSchema } from "@colyseus/schema";
import type { Player } from "./WorldState";
import { PARTY_INVITE_MS, PARTY_MAX, PARTY_UPDATE_MS, type PartyAskEvent, type PartyMessage } from "../../../shared/party";

// Parties: who's with whom, invites, leaving and removing, and keeping every
// member up to date on the others. The party id sits on each member's synced
// Player (so everyone can colour their names, and Combat can share EXP and
// loot); nothing is saved: leaving the game leaves the party.

interface Party {
  id: string;
  /** Session id of the leader. */
  leader: string;
  /** Session ids, in the order they joined. */
  members: string[];
}

export interface PartyHooks {
  send(id: string, type: string, msg: unknown): void;
  notice(id: string, text: string): void;
}

export class Parties {
  private parties = new Map<string, Party>();
  /** Invites waiting for an answer, by whoever was invited. */
  private invites = new Map<string, { from: string; until: number }>();
  private nextId = 0;
  private updateAt = 0;

  constructor(
    private players: MapSchema<Player>,
    private hooks: PartyHooks,
  ) {}

  /** The party someone is in. */
  private of(id: string): Party | undefined {
    const p = this.players.get(id)?.party;
    return p ? this.parties.get(p) : undefined;
  }

  /** Everyone in someone's party (them included), or nobody. */
  members(id: string): string[] {
    return this.of(id)?.members ?? [];
  }

  /** `from` invites `to`: the leader of a party with room, or anyone not in one yet. */
  invite(from: string, to: string) {
    const a = this.players.get(from);
    const b = this.players.get(to);
    if (!a || !b || from === to) return;
    const party = this.of(from);
    if (party && party.leader !== from) return this.hooks.notice(from, "Only your party's leader can invite players.");
    if (party && party.members.length >= PARTY_MAX) return this.hooks.notice(from, `Your party is full: ${PARTY_MAX} is the most.`);
    if (b.party) return this.hooks.notice(from, b.party === a.party ? `${b.name} is already in your party.` : `${b.name} is already in a party.`);
    const waiting = this.invites.get(to);
    if (waiting?.from === from && waiting.until > Date.now()) return this.hooks.notice(from, `You've already invited ${b.name}. Give them a moment.`);
    this.invites.set(to, { from, until: Date.now() + PARTY_INVITE_MS });
    this.hooks.send(to, "party:ask", { from, name: a.name, lv: a.lv, cls: a.cls, size: party?.members.length ?? 1, ms: PARTY_INVITE_MS } satisfies PartyAskEvent);
    this.hooks.notice(from, `You invited ${b.name} to your party.`);
  }

  /** `id` answers `from`'s invite. Yes starts a party with them, or joins theirs. */
  answer(id: string, from: string, yes: boolean) {
    const inv = this.invites.get(id);
    if (!inv || inv.from !== from) return;
    this.invites.delete(id);
    const me = this.players.get(id);
    const host = this.players.get(from);
    if (!me) return;
    if (!host || Date.now() > inv.until) return this.hooks.notice(id, "That invite has run out.");
    if (!yes) return this.hooks.notice(from, `${me.name} said no to your party.`);
    if (me.party) return this.hooks.notice(id, "Leave your party first.");
    let party = this.of(from);
    if (party && party.leader !== from) return this.hooks.notice(id, `${host.name} isn't their party's leader any more.`);
    if (party && party.members.length >= PARTY_MAX) return this.hooks.notice(id, `${host.name}'s party is full.`);
    if (!party) {
      party = { id: `p${++this.nextId}`, leader: from, members: [from] };
      this.parties.set(party.id, party);
      host.party = party.id;
    }
    party.members.push(id);
    me.party = party.id;
    for (const m of party.members) this.hooks.notice(m, m === id ? `You joined ${host.name}'s party. Type /p and a message to talk to it.` : `${me.name} joined the party.`);
    this.sendAll(party);
  }

  /** Out of the party: they left, the leader removed them, or they left the game. */
  leave(id: string, why: "left" | "removed" | "gone" = "left") {
    this.invites.delete(id);
    for (const [to, inv] of this.invites) if (inv.from === id) this.invites.delete(to);
    const party = this.of(id);
    if (!party) return;
    const p = this.players.get(id);
    const name = p?.name ?? "Someone";
    party.members = party.members.filter((m) => m !== id);
    if (p) p.party = "";
    if (why !== "gone") {
      this.hooks.send(id, "party", null);
      this.hooks.notice(id, why === "removed" ? "You were removed from the party." : "You left the party.");
    }
    // A party of one is no party.
    if (party.members.length < 2) {
      for (const m of party.members) {
        const q = this.players.get(m);
        if (q) q.party = "";
        this.hooks.send(m, "party", null);
        this.hooks.notice(m, `${name} ${why === "removed" ? "is out" : "left"}, so your party broke up.`);
      }
      this.parties.delete(party.id);
      return;
    }
    const newLeader = party.leader === id;
    if (newLeader) party.leader = party.members[0];
    const lead = this.players.get(party.leader)?.name ?? "";
    const what = why === "removed" ? "was removed from the party" : why === "gone" ? "left the game" : "left the party";
    for (const m of party.members) this.hooks.notice(m, `${name} ${what}.${newLeader ? ` ${m === party.leader ? "You're" : `${lead} is`} the leader now.` : ""}`);
    this.sendAll(party);
  }

  /** The leader removes someone. */
  remove(by: string, t: string) {
    const party = this.of(by);
    if (!party || party.leader !== by || t === by || !party.members.includes(t)) return;
    this.leave(t, "removed");
  }

  /** Invites run out, and every member hears how the others are doing, now and then. */
  tick(now: number) {
    for (const [to, inv] of this.invites) if (now > inv.until) this.invites.delete(to);
    if (now < this.updateAt) return;
    this.updateAt = now + PARTY_UPDATE_MS;
    for (const party of this.parties.values()) this.sendAll(party);
  }

  private sendAll(party: Party) {
    const msg: PartyMessage = {
      id: party.id,
      leader: party.leader,
      members: party.members.flatMap((id) => {
        const p = this.players.get(id);
        return p ? [{ id, name: p.name, cls: p.cls, lv: p.lv, hp: p.hp, mhp: p.mhp, x: p.x, y: p.y, dead: p.dead }] : [];
      }),
    };
    for (const m of party.members) this.hooks.send(m, "party", msg);
  }
}
