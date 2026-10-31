// "Morning Lounge": Digitify's own ambient theme (decision D-016), composed for the app and
// generated live with Web Audio, so nothing is downloaded, sampled or licensed.
//
// A light lounge groove in F major at 92 BPM: electric-piano chords, bass, a soft pad, a shaker
// and a marimba-like melody. Every other 8-bar pass plays the fixed theme; the passes in between
// improvise from chord tones, so it never loops exactly the same way twice.

export interface VoiceOptions {
  gain: number;
  attack: number;
  decay: number;
  type?: OscillatorType;
  lowpass?: number;
  /** Harmonics as [multiple of the fundamental, level]. */
  partials?: [number, number][];
}

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** A tiny additive synth shared by the music and the interface sounds. */
export class Synth {
  private readonly noise: AudioBuffer;

  constructor(readonly ctx: AudioContext) {
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  voice(t: number, midi: number, options: VoiceOptions, destination: AudioNode) {
    const { ctx } = this;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, t);
    envelope.gain.exponentialRampToValueAtTime(options.gain, t + options.attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + options.attack + options.decay);
    const nodes: AudioNode[] = [envelope];
    let output: AudioNode = envelope;
    if (options.lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = options.lowpass;
      envelope.connect(filter);
      nodes.push(filter);
      output = filter;
    }
    output.connect(destination);
    const end = t + options.attack + options.decay + 0.05;
    (options.partials ?? [[1, 1]]).forEach(([multiple, level], index) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = options.type ?? "sine";
      oscillator.frequency.value = frequency(midi) * multiple;
      const gain = ctx.createGain();
      gain.gain.value = level;
      oscillator.connect(gain).connect(envelope);
      nodes.push(gain);
      oscillator.start(t);
      oscillator.stop(end);
      // Release the whole voice once it has sounded, so long sessions don't accumulate nodes.
      if (index === 0) oscillator.onended = () => nodes.forEach((node) => node.disconnect());
    });
  }

  shaker(t: number, level: number, destination: AudioNode) {
    const { ctx } = this;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 0.9 + Math.random() * 0.3;
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 7000;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, t);
    envelope.gain.exponentialRampToValueAtTime(level, t + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    source.connect(highpass).connect(envelope).connect(destination);
    source.onended = () => {
      highpass.disconnect();
      envelope.disconnect();
    };
    source.start(t, Math.random() * 0.5, 0.1);
  }
}

interface Chord {
  keys: number[];
  bass: number;
  /** Notes the improvised passes may choose from. */
  tones: number[];
}

// MIDI note numbers, one chord per bar: Fmaj7, Em7, Dm7, Cmaj7, Bbmaj7, Am7, Gm7, C7sus4.
const CHORDS: Chord[] = [
  { keys: [53, 57, 60, 64], bass: 41, tones: [69, 72, 74, 76, 79] },
  { keys: [52, 55, 59, 62], bass: 40, tones: [67, 71, 74, 76, 79] },
  { keys: [50, 53, 57, 60], bass: 38, tones: [69, 72, 74, 76, 77] },
  { keys: [52, 55, 59, 60], bass: 36, tones: [67, 71, 72, 74, 76] },
  { keys: [50, 53, 57, 58], bass: 34, tones: [69, 70, 72, 74, 77] },
  { keys: [52, 55, 57, 60], bass: 45, tones: [69, 72, 74, 76, 79] },
  { keys: [50, 53, 55, 58], bass: 43, tones: [67, 70, 72, 74, 77] },
  { keys: [53, 55, 58, 60], bass: 36, tones: [67, 70, 72, 74, 77] },
];

// The theme: eight eighth-notes per bar, 0 = rest.
const THEME = [
  [69, 0, 72, 0, 76, 0, 74, 72],
  [71, 0, 67, 0, 0, 76, 74, 0],
  [77, 0, 76, 0, 74, 0, 69, 0],
  [67, 0, 0, 0, 0, 0, 76, 0],
  [74, 0, 77, 0, 81, 0, 79, 77],
  [76, 0, 72, 0, 0, 69, 67, 0],
  [70, 0, 74, 0, 77, 0, 76, 74],
  [72, 0, 0, 0, 67, 0, 0, 0],
];

const EIGHTH = 60 / 92 / 2;
const SWING = 1.12;
const LOOKAHEAD = 0.25;

const ELECTRIC_PIANO: VoiceOptions = { gain: 0.05, attack: 0.012, decay: 1.6, lowpass: 3200, partials: [[1, 1], [2, 0.18], [3, 0.05]] };
const BASS: VoiceOptions = { type: "triangle", gain: 0.22, attack: 0.01, decay: 0.9, lowpass: 420 };
const BASS_FIFTH: VoiceOptions = { type: "triangle", gain: 0.14, attack: 0.01, decay: 0.6, lowpass: 420 };
const PAD: VoiceOptions = { gain: 0.012, attack: 0.5, decay: EIGHTH * 8 };
const MELODY: VoiceOptions = { gain: 0.09, attack: 0.006, decay: 1.1, partials: [[1, 1], [4, 0.12], [10, 0.02]] };

/** Schedules the piece a little ahead of the audio clock, the usual Web Audio pattern. */
export class MorningLounge {
  private step = 0;
  private next = 0;
  private timer = 0;

  constructor(
    private readonly synth: Synth,
    private readonly output: AudioNode,
  ) {}

  get running(): boolean {
    return this.timer !== 0;
  }

  start() {
    if (this.timer) return;
    this.next = this.synth.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 40);
    this.schedule();
  }

  /** Stops scheduling; notes already queued ring out under the caller's fade. */
  stop() {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  private schedule() {
    const now = this.synth.ctx.currentTime;
    // After a stall (a busy main thread or a suspended context), skip the missed steps instead
    // of playing them all at once, and stay on the beat.
    while (this.next < now) this.advance();
    while (this.next < now + LOOKAHEAD) {
      this.play(this.step, this.next);
      this.advance();
    }
  }

  private advance() {
    this.next += EIGHTH * (this.step % 2 === 0 ? SWING : 2 - SWING);
    this.step++;
  }

  private play(step: number, t: number) {
    const bar = Math.floor(step / 8) % 8;
    const position = step % 8;
    const pass = Math.floor(step / 64);
    const chord = CHORDS[bar];
    const { synth, output } = this;

    if (position === 0 || position === 3) {
      for (const key of chord.keys) synth.voice(t, key, ELECTRIC_PIANO, output);
    }
    if (position === 0) {
      synth.voice(t, chord.bass, BASS, output);
      for (const key of chord.keys) synth.voice(t, key + 12, PAD, output);
    }
    if (position === 5) synth.voice(t, chord.bass + 7, BASS_FIFTH, output);

    let note = 0;
    if (pass % 2 === 0) note = THEME[bar][position];
    else if (position % 2 === 0 && Math.random() < 0.32) note = chord.tones[Math.floor(Math.random() * chord.tones.length)];
    if (note) synth.voice(t, note, MELODY, output);

    synth.shaker(t, position % 2 ? 0.035 : 0.018, output);
  }
}
