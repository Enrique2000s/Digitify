// Ambient music and interface sounds (decision D-016). One engine lives for the whole session:
// "Morning Lounge" and the interface sounds are synthesized with Web Audio; the user's own music
// streams through an <audio> element from the core's `ambient/` route.

import { onLinux } from "../api";
import { MorningLounge, Synth, type VoiceOptions } from "./lounge";

export type MusicMode = "lounge" | "custom";

export interface CustomTrack {
  generation: number;
  id: number;
  title: string;
  artist: string | null;
  url: string;
}

export interface EngineState {
  /** False while the WebView refuses to start audio before a click or key press. */
  unlocked: boolean;
  /** Music is running (it may still be muted). */
  playing: boolean;
  /** The current track of the user's music. */
  track: CustomTrack | null;
  /** Every track of the user's music failed to play. */
  failed: boolean;
}

export interface EngineSettings {
  play: boolean;
  mode: MusicMode;
  /** 0–100. */
  volume: number;
  muted: boolean;
}

/** Gain of the lounge mix at full volume. */
const LOUNGE_LEVEL = 0.9;
/** The audio context sleeps after this long without music or interface sounds. */
const IDLE_SUSPEND_MS = 5000;

const HOVER: VoiceOptions[] = [
  { gain: 0.05, attack: 0.004, decay: 0.07 },
  { gain: 0.04, attack: 0.004, decay: 0.09 },
];
const PRESS: VoiceOptions[] = [
  { gain: 0.08, attack: 0.004, decay: 0.12, partials: [[1, 1], [2, 0.3]] },
  { gain: 0.07, attack: 0.004, decay: 0.16, partials: [[1, 1], [2, 0.3]] },
];

interface Graph {
  ctx: AudioContext;
  synth: Synth;
  music: GainNode;
  ui: GainNode;
  lounge: MorningLounge;
}

class AmbientEngine {
  private graph: Graph | null = null;
  private element: HTMLAudioElement | null = null;
  private fadeTimer = 0;
  private idleTimer = 0;
  private unlockArmed = false;
  private settings: EngineSettings = { play: false, mode: "lounge", volume: 40, muted: false };
  private tracks: CustomTrack[] = [];
  private shuffle = true;
  private queue: number[] = [];
  private errors = 0;
  private listeners = new Set<() => void>();
  private state: EngineState = { unlocked: true, playing: false, track: null, failed: false };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  private set(change: Partial<EngineState>) {
    const next = { ...this.state, ...change };
    if ((Object.keys(change) as (keyof EngineState)[]).every((key) => next[key] === this.state[key])) return;
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  private audioGraph(): Graph {
    if (this.graph) return this.graph;
    const ctx = new AudioContext();
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 6800;
    tone.connect(ctx.destination);
    const music = ctx.createGain();
    music.gain.value = 0;
    music.connect(tone);
    // A soft room: a decaying noise impulse through a convolver, mixed in under the dry sound.
    const length = Math.floor(ctx.sampleRate * 2.8);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    reverb.connect(wet).connect(music);
    const bus = ctx.createGain();
    bus.connect(music);
    bus.connect(reverb);
    const ui = ctx.createGain();
    ui.gain.value = 0.7;
    ui.connect(ctx.destination);
    ctx.onstatechange = () => {
      if (ctx.state === "running") this.set({ unlocked: true });
    };
    const synth = new Synth(ctx);
    this.graph = { ctx, synth, music, ui, lounge: new MorningLounge(synth, bus) };
    return this.graph;
  }

  /** Applies what the music should be doing now. Cheap to call repeatedly. */
  configure(settings: EngineSettings) {
    this.settings = settings;
    this.apply();
  }

  /** The user's music, resolved by the core. A new list restarts playback from a fresh track. */
  setPlaylist(tracks: CustomTrack[]) {
    const same = tracks.length === this.tracks.length && tracks.every((track, i) => track.url === this.tracks[i].url);
    if (same) return;
    this.tracks = tracks;
    this.queue = [];
    this.errors = 0;
    if (this.element) {
      this.stopFade();
      this.element.pause();
      this.element.removeAttribute("src");
      this.element.load();
    }
    this.set({ track: null, failed: false });
    this.apply();
  }

  setShuffle(shuffle: boolean) {
    if (shuffle === this.shuffle) return;
    this.shuffle = shuffle;
    this.queue = [];
  }

  /** Skips to the next track of the user's music. */
  skip() {
    if (!this.tracks.length) return;
    this.loadNext();
    if (this.customActive()) this.playElement();
  }

  uiSound(kind: "hover" | "press") {
    const { ctx, synth, ui } = this.audioGraph();
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
    const t = ctx.currentTime + 0.01;
    const [first, second] = kind === "hover" ? HOVER : PRESS;
    const [low, high] = kind === "hover" ? [88, 95] : [76, 83];
    synth.voice(t, low, first, ui);
    synth.voice(t + (kind === "hover" ? 0.035 : 0.05), high, second, ui);
    this.scheduleIdle();
  }

  /**
   * Big Picture's startup sound (D-070), original and made here: a rising whoosh of filtered noise
   * that opens into a soft major-ninth chord with a little sparkle on top, about three seconds.
   */
  introSound() {
    const { ctx, synth, ui } = this.audioGraph();
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
    const t = ctx.currentTime + 0.03;
    // The whoosh: noise through a band-pass that sweeps up, swelling then falling away.
    const length = Math.floor(ctx.sampleRate * 1.6);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(260, t);
    band.frequency.exponentialRampToValueAtTime(3600, t + 1.05);
    const swell = ctx.createGain();
    swell.gain.setValueAtTime(0.0001, t);
    swell.gain.exponentialRampToValueAtTime(0.22, t + 0.85);
    swell.gain.exponentialRampToValueAtTime(0.0001, t + 1.55);
    noise.connect(band).connect(swell).connect(ui);
    noise.start(t);
    noise.stop(t + 1.6);
    noise.onended = () => [noise, band, swell].forEach((n) => n.disconnect());
    // A small echo so the chord rings in the room.
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.23;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    echo.connect(feedback).connect(echo);
    echo.connect(wet).connect(ui);
    const out = ctx.createGain();
    out.connect(ui);
    out.connect(echo);
    window.setTimeout(() => [echo, feedback, wet, out].forEach((n) => n.disconnect()), 6000);
    // The chord: D major add 9, warm low notes first, then the top.
    const hit = t + 0.9;
    const pad = { attack: 0.06, decay: 2.6, lowpass: 3200, partials: [[1, 1], [2, 0.25], [3, 0.08]] as [number, number][] };
    [
      [38, 0.07],
      [50, 0.09],
      [57, 0.08],
      [62, 0.07],
      [66, 0.06],
      [76, 0.045],
    ].forEach(([midi, gain], index) => synth.voice(hit + index * 0.018, midi, { ...pad, gain }, out));
    // The sparkle: a quick rising arpeggio high up.
    [81, 86, 90, 93].forEach((midi, index) => synth.voice(hit + 0.12 + index * 0.075, midi, { gain: 0.03, attack: 0.005, decay: 0.5 }, out));
    this.scheduleIdle();
  }

  private customActive(): boolean {
    const { play, mode } = this.settings;
    return play && mode === "custom" && this.tracks.length > 0 && !this.state.failed;
  }

  private apply() {
    const { play, mode } = this.settings;
    const lounge = play && mode === "lounge";
    const custom = this.customActive();
    this.setLounge(lounge);
    this.setCustom(custom);
    this.set({ playing: lounge || custom });
    this.scheduleIdle();
  }

  private loungeLevel(): number {
    const { volume, muted } = this.settings;
    return muted ? 0 : (volume / 100) * LOUNGE_LEVEL;
  }

  /** Recorded music is mastered much louder than the lounge, so its volume follows a curve. */
  private customLevel(): number {
    const { volume, muted } = this.settings;
    return muted ? 0 : (volume / 100) ** 2;
  }

  private setLounge(on: boolean) {
    if (on) {
      const { ctx, music, lounge } = this.audioGraph();
      this.resume(ctx);
      const starting = !lounge.running;
      lounge.start();
      ramp(ctx, music.gain, this.loungeLevel(), starting ? 1.5 : 0.25);
    } else if (this.graph?.lounge.running) {
      const { ctx, music, lounge } = this.graph;
      lounge.stop();
      ramp(ctx, music.gain, 0, 0.8);
    }
  }

  private setCustom(on: boolean) {
    const element = this.element;
    if (on) {
      const audio = this.audio();
      if (!this.state.track) this.loadNext();
      this.fadeElement(this.customLevel(), audio.paused ? 1.2 : 0.25);
      if (audio.paused) this.playElement();
    } else if (element && !element.paused) {
      this.fadeElement(0, 0.8, () => element.pause());
    }
  }

  private audio(): HTMLAudioElement {
    if (this.element) return this.element;
    const element = new Audio();
    element.preload = "auto";
    element.volume = 0;
    element.addEventListener("ended", () => this.skip());
    element.addEventListener("error", () => {
      if (element.getAttribute("src")) this.trackFailed();
    });
    element.addEventListener("playing", () => {
      this.errors = 0;
      this.set({ unlocked: true });
    });
    this.element = element;
    return element;
  }

  private playElement() {
    const element = this.audio();
    element.play().catch((error: unknown) => {
      // AbortError only means the source changed while loading; errors surface via "error".
      if (error instanceof DOMException && error.name === "NotAllowedError") this.blocked();
    });
  }

  private loadNext() {
    if (!this.queue.length) this.queue = this.order();
    const track = this.tracks[this.queue.shift() ?? 0];
    this.audio().src = track.url;
    this.set({ track });
  }

  private order(): number[] {
    const indices = this.tracks.map((_, i) => i);
    const current = this.state.track ? this.tracks.findIndex((track) => track.url === this.state.track?.url) : -1;
    if (!this.shuffle) return [...indices.slice(current + 1), ...indices.slice(0, current + 1)];
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    // Don't play the same track twice in a row when a new shuffle starts.
    if (indices.length > 1 && indices[0] === current) indices.push(indices.shift()!);
    return indices;
  }

  private trackFailed() {
    this.errors++;
    if (this.errors >= this.tracks.length) {
      this.stopFade();
      this.element?.pause();
      this.set({ failed: true, playing: false });
      return;
    }
    this.skip();
  }

  private fadeElement(target: number, seconds: number, done?: () => void) {
    const element = this.audio();
    this.stopFade();
    const start = element.volume;
    const began = performance.now();
    const step = () => {
      const progress = Math.min(1, (performance.now() - began) / (seconds * 1000));
      element.volume = Math.max(0, Math.min(1, start + (target - start) * progress));
      if (progress >= 1) {
        this.stopFade();
        done?.();
      }
    };
    this.fadeTimer = window.setInterval(step, 30);
    step();
  }

  private stopFade() {
    window.clearInterval(this.fadeTimer);
    this.fadeTimer = 0;
  }

  private resume(ctx: AudioContext) {
    if (ctx.state === "running") return;
    void ctx.resume().catch(() => {});
    // WebView2 normally allows audio right away; if it doesn't, start on the first interaction.
    window.setTimeout(() => {
      if (ctx.state !== "running" && this.settings.play) this.blocked();
    }, 400);
  }

  private blocked() {
    this.set({ unlocked: false });
    if (this.unlockArmed) return;
    this.unlockArmed = true;
    const unlock = () => {
      this.unlockArmed = false;
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      if (this.graph) void this.graph.ctx.resume().catch(() => {});
      if (this.customActive()) this.playElement();
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
  }

  /**
   * Lets the audio context sleep while nothing synthesized is playing (saves CPU and battery).
   * Not on Linux: WebKitGTK wakes a sleeping context by waiting on GStreamer inside the page's
   * thread, and that wait can last forever (it froze the whole player at the first click sound
   * after a video had played for a few seconds), so there the context stays awake.
   */
  private scheduleIdle() {
    window.clearTimeout(this.idleTimer);
    const graph = this.graph;
    if (!graph || graph.lounge.running || onLinux) return;
    this.idleTimer = window.setTimeout(() => {
      if (!graph.lounge.running && graph.ctx.state === "running") void graph.ctx.suspend();
    }, IDLE_SUSPEND_MS);
  }
}

function ramp(ctx: AudioContext, param: AudioParam, value: number, seconds: number) {
  const now = ctx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + seconds);
}

export const ambientEngine = new AmbientEngine();
