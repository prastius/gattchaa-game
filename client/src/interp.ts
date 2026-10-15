// Snapshot interpolation for everything the server moves (other players, NPCs).
//
// Each position update carries the server time it happened at. We render other
// entities a little in the past (`delay`) and blend between the two snapshots
// around that moment, so motion stays smooth even when packets arrive in
// bursts or a bit late. Your own character never waits: it moves locally.

export interface Snapshot {
  t: number;
  x: number;
  y: number;
  dir: number;
  moving: boolean;
}

const BASE_DELAY_MS = 150; // ~ one send interval (83 ms) + one patch (50 ms) + jitter
const MAX_DELAY_MS = 400;
const TELEPORT_PX = 320;

/** Estimates the server's clock from snapshot timestamps. */
export class ServerClock {
  private offset: number | undefined; // server time - local time, from the fastest packet seen
  /** How far in the past other entities are drawn; grows on bad connections, then eases back. */
  delay = BASE_DELAY_MS;
  starvedFrames = 0;

  observe(serverTs: number, localNow: number) {
    const sample = serverTs - localNow;
    // Jump up immediately (a faster packet), or reset on a big drop (server restarted).
    if (this.offset === undefined || sample > this.offset || sample < this.offset - 5000) this.offset = sample;
  }

  /** Call once per frame. `starved` = some moving entity ran out of snapshots. */
  update(dtMs: number, starved: boolean) {
    // Slowly forget the fastest packet so clock drift can't build up.
    if (this.offset !== undefined) this.offset -= dtMs * 0.002;
    if (starved) {
      this.starvedFrames++;
      this.delay = Math.min(MAX_DELAY_MS, this.delay + 2);
    } else {
      this.delay = Math.max(BASE_DELAY_MS, this.delay - dtMs * 0.004);
    }
  }

  renderTime(localNow: number): number {
    return localNow + (this.offset ?? 0) - this.delay;
  }
}

export class Interpolator {
  private buf: Snapshot[] = [];

  push(s: Snapshot) {
    const last = this.buf[this.buf.length - 1];
    if (last && s.t <= last.t) {
      if (s.t < last.t - 5000) this.buf = []; // server restarted: start over
      else return;
    }
    this.buf.push(s);
    if (this.buf.length > 40) this.buf.shift();
  }

  /** Position at server time `t`; `starved` when a moving entity has no newer data yet. */
  sample(t: number): (Snapshot & { starved: boolean }) | undefined {
    const buf = this.buf;
    if (buf.length === 0) return undefined;
    if (t <= buf[0].t) return { ...buf[0], starved: false };

    let i = buf.length - 1;
    while (i > 0 && buf[i].t > t) i--;
    // Drop snapshots we'll never need again (keep the one we're blending from).
    if (i > 1) {
      buf.splice(0, i - 1);
      i = 1;
    }
    const a = buf[i];
    const b = buf[i + 1];
    // Only a *recent* gap counts; a player who vanished mid-walk shouldn't slow everyone down.
    if (!b) return { ...a, starved: a.moving && t - a.t < 400 };

    if (Math.hypot(b.x - a.x, b.y - a.y) > TELEPORT_PX) return { ...b, starved: false };
    const k = (t - a.t) / (b.t - a.t);
    return {
      t,
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      dir: k < 0.5 ? a.dir : b.dir,
      moving: a.moving || b.moving,
      starved: false,
    };
  }
}
