// Digitify's other two original menu themes (D-174), composed for the app and generated live with
// Web Audio like "Morning Lounge": nothing is downloaded, sampled or licensed, and the melodies are
// Digitify's own.
//
// - "Digitify Settings Music": light and bouncy, in the spirit of a handheld console's settings
//   screen: soft electric-piano chords, a kalimba melody, a bouncing bass, a woodblock on two and
//   four, a shaker, and a glockenspiel now and then.
// - "Digitify Big Picture Music": spacious and warm for the TV: a slow pad, rippling
//   electric-piano arpeggios, a deep bass, a soft pulse, and a bell melody with an echo.
//
// Both share the main menu theme's beat and key (D-175): F major, 92 BPM with the same light swing,
// and each starts in step with the one playing, so moving between menus changes the instruments
// and the tune, never the groove. Like the lounge, every other 8-bar pass plays the fixed theme
// and the passes between improvise from the chord tones.

import { EIGHTH, SWING, type Clock, type Synth, type VoiceOptions } from "./lounge";

/** A piece the engine can fade in and out (the lounge and these themes). */
export interface Piece {
  readonly running: boolean;
  start(at?: Clock | null): void;
  stop(): void;
  /** Where it is, while it plays, so another can start in step. */
  clock(): Clock | null;
}

interface Chord {
  keys: number[];
  bass: number;
  /** Notes the improvised passes may choose from. */
  tones: number[];
}

const LOOKAHEAD = 0.25;

/** Schedules eighth notes a little ahead of the audio clock, the usual Web Audio pattern. */
abstract class Theme implements Piece {
  private step = 0;
  private next = 0;
  private timer = 0;

  constructor(
    protected readonly synth: Synth,
    protected readonly output: AudioNode,
    private readonly eighth: number,
    private readonly swing = 1,
  ) {}

  get running(): boolean {
    return this.timer !== 0;
  }

  start(at?: Clock | null) {
    if (this.timer) return;
    if (at) {
      this.step = at.step;
      this.next = at.next;
    } else {
      this.next = this.synth.ctx.currentTime + 0.1;
    }
    this.timer = window.setInterval(() => this.schedule(), 40);
    this.schedule();
  }

  clock(): Clock | null {
    return this.timer ? { step: this.step, next: this.next } : null;
  }

  /** Stops scheduling; notes already queued ring out under the engine's fade. */
  stop() {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  private schedule() {
    const now = this.synth.ctx.currentTime;
    // After a stall, skip the missed steps instead of playing them all at once.
    while (this.next < now) this.advance();
    while (this.next < now + LOOKAHEAD) {
      this.play(this.step, this.next);
      this.advance();
    }
  }

  private advance() {
    this.next += this.eighth * (this.step % 2 === 0 ? this.swing : 2 - this.swing);
    this.step++;
  }

  protected abstract play(step: number, t: number): void;
}

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

// ------------------------------------------------------------------------------------------------
// "Digitify Settings Music"

// Fmaj7, Dm7, Gm7, C7, Am7, D7, Gm7, C7sus4.
const SETTINGS_CHORDS: Chord[] = [
  { keys: [57, 60, 64, 67], bass: 41, tones: [69, 72, 76, 77, 79] },
  { keys: [57, 60, 62, 65], bass: 50, tones: [65, 69, 72, 74, 77] },
  { keys: [58, 62, 65, 69], bass: 43, tones: [67, 70, 74, 77, 79] },
  { keys: [58, 60, 64, 67], bass: 48, tones: [64, 67, 70, 72, 76] },
  { keys: [55, 60, 64, 69], bass: 45, tones: [69, 72, 76, 79, 81] },
  { keys: [57, 60, 62, 66], bass: 50, tones: [66, 69, 72, 74, 78] },
  { keys: [58, 62, 65, 69], bass: 43, tones: [67, 70, 74, 77, 79] },
  { keys: [58, 60, 65, 67], bass: 48, tones: [65, 67, 72, 77, 79] },
];

// Eight eighth-notes per bar, 0 = rest.
const SETTINGS_THEME = [
  [69, 0, 72, 0, 76, 74, 72, 0],
  [69, 0, 65, 0, 0, 67, 69, 0],
  [70, 0, 74, 0, 77, 0, 74, 72],
  [70, 0, 67, 0, 64, 0, 0, 0],
  [72, 0, 76, 0, 79, 77, 76, 0],
  [74, 0, 72, 0, 69, 0, 66, 0],
  [67, 0, 70, 0, 74, 72, 70, 0],
  [67, 0, 0, 0, 65, 0, 0, 0],
];

const S_KEYS: VoiceOptions = { gain: 0.049, attack: 0.01, decay: 1.1, lowpass: 2800, partials: [[1, 1], [2, 0.15], [3, 0.04]] };
const S_BASS: VoiceOptions = { type: "triangle", gain: 0.27, attack: 0.008, decay: 0.42, lowpass: 600 };
const S_BASS_LIGHT: VoiceOptions = { type: "triangle", gain: 0.155, attack: 0.008, decay: 0.26, lowpass: 600 };
const S_KALIMBA: VoiceOptions = { gain: 0.12, attack: 0.003, decay: 0.8, lowpass: 5200, partials: [[1, 1], [3.9, 0.16], [6.8, 0.05]] };
const S_GLOCK: VoiceOptions = { gain: 0.031, attack: 0.002, decay: 1.5, partials: [[1, 1], [2.76, 0.35], [5.4, 0.12]] };
const S_BLOCK: VoiceOptions = { gain: 0.038, attack: 0.001, decay: 0.045, partials: [[1, 1], [2.3, 0.4]] };
const S_PAD: VoiceOptions = { gain: 0.009, attack: 0.6, decay: EIGHTH * 8 };

export class SettingsTheme extends Theme {
  constructor(synth: Synth, output: AudioNode) {
    super(synth, output, EIGHTH, SWING);
  }

  protected play(step: number, t: number) {
    const bar = Math.floor(step / 8) % 8;
    const position = step % 8;
    const pass = Math.floor(step / 64);
    const chord = SETTINGS_CHORDS[bar];
    const { synth, output } = this;

    // Chords on the one and, syncopated, on the "and" of two; a lighter touch late in the bar.
    if (position === 0 || position === 3) for (const key of chord.keys) synth.voice(t, key, S_KEYS, output);
    if (position === 6) for (const key of chord.keys.slice(2)) synth.voice(t, key + 12, { ...S_KEYS, gain: 0.029 }, output);
    if (position === 0) for (const key of chord.keys) synth.voice(t, key + 12, S_PAD, output);
    // The bass bounces: root, fifth, octave.
    if (position === 0) synth.voice(t, chord.bass, S_BASS, output);
    if (position === 4) synth.voice(t, chord.bass + 7, S_BASS_LIGHT, output);
    if (position === 6) synth.voice(t, chord.bass + 12, S_BASS_LIGHT, output);
    // Woodblock on two and four, a softer one sometimes after.
    if (position === 2 || position === 6) synth.voice(t, 84, S_BLOCK, output);
    if (position === 7 && Math.random() < 0.3) synth.voice(t, 88, { ...S_BLOCK, gain: 0.014 }, output);
    synth.shaker(t, position % 2 ? 0.022 : 0.011, output);

    let note = 0;
    if (pass % 2 === 0) note = SETTINGS_THEME[bar][position];
    else if (position % 2 === 0 && Math.random() < 0.38) note = pick(chord.tones);
    if (note) synth.voice(t, note, S_KALIMBA, output);
    // A little glockenspiel sparkle at the start of every other bar on the improvised passes.
    if (pass % 2 === 1 && position === 0 && bar % 2 === 0) synth.voice(t + EIGHTH * 0.5, pick(chord.tones) + 12, S_GLOCK, output);
  }
}

// ------------------------------------------------------------------------------------------------
// "Digitify Big Picture Music"

// Fmaj7, Dm7, Bbmaj7, Csus2, Gm7, Am7, Bbmaj7, Csus4.
const BP_CHORDS: Chord[] = [
  { keys: [57, 60, 64, 67], bass: 41, tones: [76, 79, 81, 84, 88] },
  { keys: [57, 60, 62, 65], bass: 38, tones: [74, 77, 81, 84, 86] },
  { keys: [58, 62, 65, 69], bass: 46, tones: [74, 77, 81, 82, 86] },
  { keys: [55, 60, 62, 67], bass: 48, tones: [74, 76, 79, 84, 86] },
  { keys: [55, 58, 62, 65], bass: 43, tones: [74, 77, 79, 82, 86] },
  { keys: [55, 60, 64, 67], bass: 45, tones: [76, 79, 81, 84, 88] },
  { keys: [57, 62, 65, 69], bass: 46, tones: [74, 77, 81, 82, 86] },
  { keys: [58, 60, 65, 67], bass: 48, tones: [72, 77, 79, 84, 89] },
];

const BP_THEME = [
  [84, 0, 0, 0, 81, 0, 79, 0],
  [81, 0, 0, 0, 0, 0, 77, 79],
  [77, 0, 0, 0, 74, 0, 77, 0],
  [79, 0, 0, 0, 0, 0, 0, 0],
  [82, 0, 0, 0, 81, 0, 79, 0],
  [79, 0, 0, 0, 76, 0, 79, 0],
  [81, 0, 0, 0, 77, 0, 74, 0],
  [79, 0, 0, 0, 77, 0, 0, 0],
];

// Which chord note each eighth of an arpeggio plays (0–3), rising and falling.
const RIPPLE = [0, 1, 2, 3, 2, 1, 2, 3];
const B_PAD: VoiceOptions = { gain: 0.012, attack: 1.2, decay: EIGHTH * 10, lowpass: 1800, partials: [[1, 1], [2, 0.35], [3, 0.1]] };
const B_ARP: VoiceOptions = { gain: 0.028, attack: 0.006, decay: 0.95, lowpass: 3000, partials: [[1, 1], [2, 0.2], [4, 0.05]] };
const B_BASS: VoiceOptions = { gain: 0.185, attack: 0.02, decay: 1.7, lowpass: 400 };
const B_PULSE: VoiceOptions = { gain: 0.09, attack: 0.004, decay: 0.3 };
const B_BELL: VoiceOptions = { gain: 0.055, attack: 0.02, decay: 2.4, lowpass: 4200, partials: [[1, 1], [2, 0.25], [3, 0.1], [4.2, 0.04]] };
const B_SHIMMER: VoiceOptions = { gain: 0.014, attack: 0.004, decay: 1.6, partials: [[1, 1], [2.76, 0.3]] };

export class BigPictureTheme extends Theme {
  /** The bell's echo: a dotted-eighth delay feeding back softly into the room. */
  private readonly echo: AudioNode;

  constructor(synth: Synth, output: AudioNode) {
    super(synth, output, EIGHTH, SWING);
    const { ctx } = synth;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = EIGHTH * 1.5;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(output);
    const send = ctx.createGain();
    send.connect(output);
    send.connect(delay);
    this.echo = send;
  }

  protected play(step: number, t: number) {
    const bar = Math.floor(step / 8) % 8;
    const position = step % 8;
    const pass = Math.floor(step / 64);
    const chord = BP_CHORDS[bar];
    const { synth, output, echo } = this;

    if (position === 0) {
      for (const key of chord.keys) synth.voice(t, key, B_PAD, output);
      synth.voice(t, chord.bass, B_BASS, output);
    }
    if (position === 5) synth.voice(t, chord.bass + 12, { ...B_BASS, gain: 0.08, decay: 0.8 }, output);
    // A soft pulse on one and three, like a slow heartbeat.
    if (position === 0 || position === 4) synth.voice(t, 29, B_PULSE, output);
    // The arpeggio ripples through the chord an octave up.
    synth.voice(t, chord.keys[RIPPLE[position]] + 12, { ...B_ARP, gain: position % 2 ? 0.02 : 0.028 }, output);

    let note = 0;
    if (pass % 2 === 0) note = BP_THEME[bar][position];
    else if (position % 4 === 0 && Math.random() < 0.55) note = pick(chord.tones);
    if (note) synth.voice(t, note, B_BELL, echo);
    // High shimmer now and then.
    if (position === 7 && Math.random() < 0.25) synth.voice(t, pick(chord.tones) + 12, B_SHIMMER, echo);
  }
}
