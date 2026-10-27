import type { SkillFx } from "../../shared/skills";

// Music and sound effects, synthesised with Web Audio: no audio files to load
// or license. The music is a gentle, slowly varying lo-fi chiptune loop (drums
// drop out at night and indoors); effects are tiny one-shot synths.

const MUSIC_KEY = "gattchaa-town:music";
const SFX_KEY = "gattchaa-town:sfx";

const BPM = 84;
const EIGHTH = 60 / BPM / 2;
const LOOKAHEAD_S = 0.2;
// Fmaj7 – Em7 – Dm7 – Cmaj7, two bars each (MIDI notes).
const CHORDS = [
  [53, 57, 60, 64],
  [52, 55, 59, 62],
  [50, 53, 57, 60],
  [48, 52, 55, 59],
];
const PENTATONIC = [72, 74, 76, 79, 81, 84, 86, 88]; // C major pentatonic, two octaves

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

function setting(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function save(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* private mode */
  }
}

/** Tiny seeded RNG so each 8-bar phrase is varied but repeatable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class SoundSystem {
  private ctx?: AudioContext;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;

  private step = 0; // eighth notes since the music started
  private nextAt = 0;
  private melody: (number | null)[] = [];
  musicOn = setting(MUSIC_KEY, true);
  sfxOn = setting(SFX_KEY, true);
  /** Night or indoors: softer arrangement without drums. */
  calm = false;

  /** Must be called from a user gesture (click/tap/key), per browser autoplay rules. */
  start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.22 : 0;
    this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxOn ? 0.5 : 0;
    this.sfxBus.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.nextAt = ctx.currentTime + 0.1;
    window.setInterval(() => this.schedule(), 50);
    // A hidden tab can't keep time; pause and pick up again on return.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) void ctx.suspend();
      else {
        void ctx.resume();
        this.nextAt = Math.max(this.nextAt, ctx.currentTime + 0.05);
      }
    });
  }

  setMusic(on: boolean) {
    this.musicOn = on;
    save(MUSIC_KEY, on);
    if (this.ctx) this.musicBus.gain.setTargetAtTime(on ? 0.22 : 0, this.ctx.currentTime, 0.2);
  }

  setSfx(on: boolean) {
    this.sfxOn = on;
    save(SFX_KEY, on);
    if (this.ctx) this.sfxBus.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05);
  }

  // ---------------------------------------------------------------- music

  private schedule() {
    const ctx = this.ctx!;
    if (ctx.state !== "running") return;
    while (this.nextAt < ctx.currentTime + LOOKAHEAD_S) {
      if (this.musicOn) this.playStep(this.step, this.nextAt);
      this.step++;
      this.nextAt += EIGHTH;
    }
  }

  private playStep(step: number, t: number) {
    const inBar = step % 8;
    const bar = Math.floor(step / 8);
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];

    if (step % 64 === 0) this.composeMelody(Math.floor(step / 64) % 4);
    if (inBar === 0 && bar % 2 === 0) this.pad(chord, t, EIGHTH * 16);
    if (inBar === 0 || inBar === 4 || inBar === 7) this.bass(chord[0] - 12, t, inBar === 7 ? EIGHTH : EIGHTH * 2.5);
    const note = this.melody[step % 64];
    if (note) this.pluck(note, t);

    if (!this.calm) {
      if (inBar === 0 || inBar === 4) this.kick(t);
      if (inBar === 2 || inBar === 6) this.snare(t);
      if (inBar % 2 === 1) this.hat(t, 0.5);
    } else if (inBar % 4 === 2) {
      this.hat(t, 0.25);
    }
  }

  /** 64 eighth notes of melody that wander up and down the scale, with plenty of rests. */
  private composeMelody(variation: number) {
    const rand = rng(1013 + variation * 7919);
    let at = 2 + Math.floor(rand() * 3);
    this.melody = [];
    for (let i = 0; i < 64; i++) {
      const phraseEnd = i % 16 >= 13;
      if (!phraseEnd && rand() < (i % 2 === 0 ? 0.55 : 0.25)) {
        at = Math.max(0, Math.min(PENTATONIC.length - 1, at + Math.floor(rand() * 5) - 2));
        this.melody.push(PENTATONIC[at]);
      } else {
        this.melody.push(null);
      }
    }
  }

  private env(gain: GainNode, t: number, peak: number, attack: number, release: number) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  private pad(notes: number[], t: number, length: number) {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = this.calm ? 900 : 1300;
    filter.connect(this.musicBus);
    for (const n of notes) {
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = midiHz(n);
        osc.detune.value = detune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.045, t + 0.8);
        g.gain.setValueAtTime(0.045, t + length - 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + length + 0.4);
        osc.connect(g).connect(filter);
        osc.start(t);
        osc.stop(t + length + 0.5);
      }
    }
  }

  private bass(n: number, t: number, length: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = midiHz(n);
    const g = ctx.createGain();
    this.env(g, t, 0.28, 0.01, length);
    osc.connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  private pluck(n: number, t: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = midiHz(n);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2600, t);
    filter.frequency.exponentialRampToValueAtTime(700, t + 0.25);
    const g = ctx.createGain();
    this.env(g, t, this.calm ? 0.035 : 0.05, 0.005, 0.32);
    osc.connect(filter).connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  private kick(t: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain();
    this.env(g, t, 0.35, 0.003, 0.16);
    osc.connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, peak: number, length: number, bus: GainNode) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    this.env(g, t, peak, 0.002, length);
    src.connect(filter).connect(g).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + length + 0.05);
  }

  private snare(t: number) {
    this.noiseHit(t, "bandpass", 1800, 0.06, 0.12, this.musicBus);
  }

  private hat(t: number, level: number) {
    this.noiseHit(t, "highpass", 7500, 0.035 * level, 0.035, this.musicBus);
  }

  // ---------------------------------------------------------------- effects

  private tone(freq: number, t: number, length: number, type: OscillatorType, peak: number, glideTo?: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + length);
    const g = ctx.createGain();
    this.env(g, t, peak, 0.005, length);
    osc.connect(g).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  private ready(): number | undefined {
    if (!this.ctx || !this.sfxOn || this.ctx.state !== "running") return undefined;
    return this.ctx.currentTime + 0.01;
  }

  /** Opening a dialog or using something. */
  blip() {
    const t = this.ready();
    if (t === undefined) return;
    this.tone(880, t, 0.06, "square", 0.08);
    this.tone(1320, t + 0.06, 0.09, "square", 0.07);
  }

  /** Someone else's chat message. */
  pop() {
    const t = this.ready();
    if (t === undefined) return;
    this.tone(620, t, 0.07, "sine", 0.12, 900);
  }

  /** Walking through a door. */
  door() {
    const t = this.ready();
    if (t === undefined) return;
    this.noiseHit(t, "lowpass", 900, 0.18, 0.25, this.sfxBus);
    this.tone(110, t + 0.05, 0.18, "sine", 0.3, 70);
  }

  /** Your attack: a short whoosh. */
  swing() {
    const t = this.ready();
    if (t === undefined) return;
    this.noiseHit(t, "bandpass", 2400, 0.07, 0.09, this.sfxBus);
  }

  /** Your hit lands. */
  hit(crit = false) {
    const t = this.ready();
    if (t === undefined) return;
    this.noiseHit(t, "lowpass", 1400, 0.16, 0.07, this.sfxBus);
    this.tone(crit ? 420 : 240, t, 0.08, "square", 0.07, crit ? 180 : 110);
  }

  /** A bow string, or a bolt of magic leaving a staff. */
  shoot(magic = false) {
    const t = this.ready();
    if (t === undefined) return;
    if (magic) this.tone(880, t, 0.14, "sine", 0.06, 1500);
    else this.tone(420, t, 0.07, "triangle", 0.1, 140);
  }

  /** A skill going off, by how it looks. */
  skill(fx: SkillFx) {
    const t = this.ready();
    if (t === undefined) return;
    switch (fx) {
      case "bash":
        this.noiseHit(t, "lowpass", 900, 0.3, 0.16, this.sfxBus);
        this.tone(130, t, 0.16, "square", 0.1, 60);
        break;
      case "whirl":
        this.noiseHit(t, "bandpass", 1800, 0.22, 0.3, this.sfxBus);
        this.tone(300, t, 0.3, "sawtooth", 0.04, 900);
        break;
      case "guard":
        [60, 67, 72].forEach((n, i) => this.tone(midiHz(n), t + i * 0.05, 0.35, "square", 0.05));
        break;
      case "fire":
        this.noiseHit(t, "lowpass", 1400, 0.25, 0.32, this.sfxBus);
        this.tone(240, t, 0.25, "sawtooth", 0.05, 110);
        break;
      case "nova":
        [88, 91, 95, 100].forEach((n, i) => this.tone(midiHz(n), t + i * 0.03, 0.4, "sine", 0.05));
        this.noiseHit(t, "highpass", 5000, 0.1, 0.45, this.sfxBus);
        break;
      case "heal":
        [72, 76, 79, 84].forEach((n, i) => this.tone(midiHz(n), t + i * 0.06, 0.3, "triangle", 0.07));
        break;
      case "arrows":
        this.tone(420, t, 0.07, "triangle", 0.1, 140);
        this.tone(460, t + 0.09, 0.07, "triangle", 0.1, 150);
        break;
      case "rain":
        for (let i = 0; i < 5; i++) this.noiseHit(t + 0.12 + i * 0.05, "highpass", 3000, 0.07, 0.05, this.sfxBus);
        break;
      case "eagle":
        this.tone(1200, t, 0.12, "sine", 0.06, 1800);
        this.tone(1500, t + 0.12, 0.25, "sine", 0.05, 2200);
        break;
    }
  }

  /** Something hits you. */
  hurt() {
    const t = this.ready();
    if (t === undefined) return;
    this.tone(330, t, 0.12, "sawtooth", 0.06, 150);
    this.noiseHit(t, "lowpass", 700, 0.12, 0.08, this.sfxBus);
  }

  /** A monster you fought is defeated. */
  defeat() {
    const t = this.ready();
    if (t === undefined) return;
    this.tone(523, t, 0.07, "triangle", 0.1);
    this.tone(784, t + 0.07, 0.12, "triangle", 0.1);
  }

  /** Level up: a rising arpeggio with a shimmer. */
  /** Picked something up. Rarer finds ring a little brighter. */
  pickup(rare = false) {
    const t = this.ready();
    if (t === undefined) return;
    this.tone(rare ? 988 : 660, t, 0.07, "triangle", 0.1);
    this.tone(rare ? 1480 : 990, t + 0.07, 0.12, "triangle", 0.09);
    if (rare) this.tone(1976, t + 0.14, 0.2, "triangle", 0.07);
  }

  /** A monster card: a bright little fanfare. */
  card() {
    const t = this.ready();
    if (t === undefined) return;
    [76, 79, 83, 88].forEach((n, i) => this.tone(midiHz(n), t + i * 0.07, 0.28, "triangle", 0.1));
    this.tone(midiHz(95), t + 0.3, 0.4, "sine", 0.05);
  }

  /** The Blacksmith's hammer: two clangs, then a chime when the upgrade worked or a dull clunk when it didn't. */
  forge(ok: boolean) {
    const t = this.ready();
    if (t === undefined) return;
    for (const dt of [0, 0.22]) {
      this.noiseHit(t + dt, "bandpass", 3200, 0.16, 0.05, this.sfxBus);
      this.tone(1240, t + dt, 0.25, "square", 0.035);
      this.tone(1860, t + dt, 0.2, "sine", 0.04);
    }
    if (ok) [79, 83, 86, 91].forEach((n, i) => this.tone(midiHz(n), t + 0.5 + i * 0.07, 0.3, "triangle", 0.1));
    else {
      this.tone(180, t + 0.5, 0.3, "square", 0.07, 90);
      this.noiseHit(t + 0.5, "lowpass", 600, 0.18, 0.2, this.sfxBus);
    }
  }

  /** Gold changed hands. */
  coin() {
    const t = this.ready();
    if (t === undefined) return;
    this.tone(1568, t, 0.05, "square", 0.05);
    this.tone(2093, t + 0.05, 0.14, "square", 0.05);
  }

  /** Glug, then a little sparkle. */
  potion() {
    const t = this.ready();
    if (t === undefined) return;
    this.tone(330, t, 0.09, "sine", 0.12, 520);
    this.tone(392, t + 0.1, 0.09, "sine", 0.1, 620);
    this.tone(1320, t + 0.2, 0.18, "triangle", 0.06);
  }

  levelUp() {
    const t = this.ready();
    if (t === undefined) return;
    [60, 64, 67, 72, 76, 79, 84].forEach((n, i) => this.tone(midiHz(n), t + i * 0.06, 0.4, "triangle", 0.13));
    this.noiseHit(t + 0.35, "highpass", 7000, 0.05, 0.8, this.sfxBus);
  }

  /** A big pull on Gattchaa: a bright little fanfare. */
  fanfare() {
    const t = this.ready();
    if (t === undefined) return;
    [72, 76, 79, 84, 88].forEach((n, i) => this.tone(midiHz(n), t + i * 0.08, 0.35, "triangle", 0.14));
    this.noiseHit(t + 0.4, "highpass", 6000, 0.05, 0.6, this.sfxBus);
  }
}

export const audio = new SoundSystem();
