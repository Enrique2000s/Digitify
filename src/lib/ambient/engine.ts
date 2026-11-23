// Ambient music and interface sounds (decision D-016). One engine lives for the whole session:
// Digitify's themes and the interface sounds are synthesized with Web Audio; the user's own music
// streams through <audio> elements from the core's `ambient/` route.
//
// Each menu has a channel of its own (D-174): the main menu, Settings and Big Picture, each
// playing one of Digitify's themes or the user's music. Moving between them crossfades: the one
// leaving fades out while it keeps playing, and the one arriving fades in over it, so there's
// never a hard cut.

import { onLinux } from "../api";
import { MorningLounge, Synth, type VoiceOptions } from "./lounge";
import { BigPictureTheme, SettingsTheme, type Piece } from "./themes";

export type ChannelId = "main" | "settings" | "bigpicture";
export type PieceName = "lounge" | "settings" | "bigpicture";

/** What a menu plays: one of Digitify's themes, or the user's music of that channel. */
export interface ChannelSpec {
  id: ChannelId;
  mode: "piece" | "custom";
  piece: PieceName;
}

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
  /** The current track of the user's music, in the channel playing. */
  track: CustomTrack | null;
  /** Every track of the playing channel's music failed to play. */
  failed: boolean;
}

export interface EngineSettings {
  play: boolean;
  /** 0–100. */
  volume: number;
  muted: boolean;
  active: ChannelSpec;
}

/** Gain of a theme's mix at full volume. */
const THEME_LEVEL = 0.9;
/** The crossfade between menus, in seconds: the arriving music fades in as the leaving one fades out
 *  (D-175: quick, since the themes share their beat and key and the new one starts in step). */
const FADE_IN = 1.2;
const FADE_OUT = 1.1;
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

interface Voice {
  piece: Piece;
  gain: GainNode;
  /** Fading out: it keeps playing until the fade ends, then stops. */
  leaving: number;
}

interface Graph {
  ctx: AudioContext;
  synth: Synth;
  ui: GainNode;
  pieces: Record<PieceName, Voice>;
}

interface Channel {
  tracks: CustomTrack[];
  shuffle: boolean;
  queue: number[];
  errors: number;
  failed: boolean;
  track: CustomTrack | null;
  element: HTMLAudioElement | null;
  fadeTimer: number;
  /** Fading out to a pause (another menu's music is arriving). */
  leaving: boolean;
}

const newChannel = (): Channel => ({ tracks: [], shuffle: true, queue: [], errors: 0, failed: false, track: null, element: null, fadeTimer: 0, leaving: false });

class AmbientEngine {
  private graph: Graph | null = null;
  private idleTimer = 0;
  private unlockArmed = false;
  private settings: EngineSettings = { play: false, volume: 40, muted: false, active: { id: "main", mode: "piece", piece: "lounge" } };
  private channels: Record<ChannelId, Channel> = { main: newChannel(), settings: newChannel(), bigpicture: newChannel() };
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
    reverb.connect(wet).connect(tone);
    const synth = new Synth(ctx);
    // Each theme through its own fader into the room, so two can sound at once while crossfading.
    const voice = (make: (output: AudioNode) => Piece): Voice => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(tone);
      gain.connect(reverb);
      return { piece: make(gain), gain, leaving: 0 };
    };
    const ui = ctx.createGain();
    ui.gain.value = 0.7;
    ui.connect(ctx.destination);
    ctx.onstatechange = () => {
      if (ctx.state === "running") this.set({ unlocked: true });
    };
    this.graph = {
      ctx,
      synth,
      ui,
      pieces: {
        lounge: voice((out) => new MorningLounge(synth, out)),
        settings: voice((out) => new SettingsTheme(synth, out)),
        bigpicture: voice((out) => new BigPictureTheme(synth, out)),
      },
    };
    return this.graph;
  }

  /** Applies what the music should be doing now. Cheap to call repeatedly. */
  configure(settings: EngineSettings) {
    this.settings = settings;
    this.apply();
  }

  /** A channel's music, resolved by the core. A new list restarts that channel from a fresh track. */
  setPlaylist(id: ChannelId, tracks: CustomTrack[]) {
    const channel = this.channels[id];
    const same = tracks.length === channel.tracks.length && tracks.every((track, i) => track.url === channel.tracks[i].url);
    if (same) return;
    channel.tracks = tracks;
    channel.queue = [];
    channel.errors = 0;
    channel.failed = false;
    channel.track = null;
    if (channel.element) {
      this.stopFade(channel);
      channel.element.pause();
      channel.element.removeAttribute("src");
      channel.element.load();
    }
    this.apply();
  }

  setShuffle(id: ChannelId, shuffle: boolean) {
    const channel = this.channels[id];
    if (shuffle === channel.shuffle) return;
    channel.shuffle = shuffle;
    channel.queue = [];
  }

  /** Skips to the next track of the playing channel's music. */
  skip() {
    const { active } = this.settings;
    if (active.mode !== "custom") return;
    this.advance(active.id);
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
   * that opens into a soft major-ninth chord with a little sparkle on top, about three seconds; in
   * F, the menu themes' key, since D-175.
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
    // The chord: F major add 9, warm low notes first, then the top.
    const hit = t + 0.9;
    const pad = { attack: 0.06, decay: 2.6, lowpass: 3200, partials: [[1, 1], [2, 0.25], [3, 0.08]] as [number, number][] };
    [
      [41, 0.07],
      [53, 0.09],
      [60, 0.08],
      [65, 0.07],
      [69, 0.06],
      [79, 0.045],
    ].forEach(([midi, gain], index) => synth.voice(hit + index * 0.018, midi, { ...pad, gain }, out));
    // The sparkle: a quick rising arpeggio high up.
    [84, 89, 93, 96].forEach((midi, index) => synth.voice(hit + 0.12 + index * 0.075, midi, { gain: 0.03, attack: 0.005, decay: 0.5 }, out));
    this.scheduleIdle();
  }

  private customOn(id: ChannelId): boolean {
    const { play, active } = this.settings;
    const channel = this.channels[id];
    return play && active.mode === "custom" && active.id === id && channel.tracks.length > 0 && !channel.failed;
  }

  private apply() {
    const { play, active } = this.settings;
    let playing = false;
    for (const name of ["lounge", "settings", "bigpicture"] as PieceName[]) {
      const on = play && active.mode === "piece" && active.piece === name;
      this.setPiece(name, on);
      playing ||= on;
    }
    for (const id of ["main", "settings", "bigpicture"] as ChannelId[]) {
      const on = this.customOn(id);
      this.setCustom(id, on);
      playing ||= on;
    }
    const channel = this.channels[active.id];
    this.set({ playing, track: active.mode === "custom" ? channel.track : null, failed: active.mode === "custom" && channel.failed });
    this.scheduleIdle();
  }

  private themeLevel(): number {
    const { volume, muted } = this.settings;
    return muted ? 0 : (volume / 100) * THEME_LEVEL;
  }

  /** Recorded music is mastered much louder than the themes, so its volume follows a curve. */
  private customLevel(): number {
    const { volume, muted } = this.settings;
    return muted ? 0 : (volume / 100) ** 2;
  }

  private setPiece(name: PieceName, on: boolean) {
    if (on) {
      const { ctx, pieces } = this.audioGraph();
      const voice = pieces[name];
      this.resume(ctx);
      const arriving = !voice.piece.running || voice.leaving !== 0;
      window.clearTimeout(voice.leaving);
      voice.leaving = 0;
      // In step with the theme leaving (the same bar and beat), so the groove carries on.
      const playing = Object.values(pieces).find((other) => other !== voice && other.piece.running);
      voice.piece.start(playing?.piece.clock() ?? null);
      ramp(ctx, voice.gain.gain, this.themeLevel(), arriving ? FADE_IN : 0.25);
    } else if (this.graph) {
      const { ctx, pieces } = this.graph;
      const voice = pieces[name];
      if (!voice.piece.running || voice.leaving !== 0) return;
      ramp(ctx, voice.gain.gain, 0, FADE_OUT);
      // It keeps playing under the fade, then stops.
      voice.leaving = window.setTimeout(() => {
        voice.leaving = 0;
        voice.piece.stop();
        this.scheduleIdle();
      }, FADE_OUT * 1000 + 150);
    }
  }

  private setCustom(id: ChannelId, on: boolean) {
    const channel = this.channels[id];
    const element = channel.element;
    if (on) {
      const audio = this.audio(id);
      if (!channel.track) this.loadNext(id);
      const arriving = audio.paused || channel.leaving;
      channel.leaving = false;
      this.fadeElement(channel, this.customLevel(), arriving ? FADE_IN : 0.25);
      if (audio.paused) this.playElement(id);
    } else if (element && !element.paused && !channel.leaving) {
      // It keeps playing under the fade, then pauses where it was, to go on from there next time.
      channel.leaving = true;
      this.fadeElement(channel, 0, FADE_OUT, () => {
        channel.leaving = false;
        element.pause();
      });
    }
  }

  private audio(id: ChannelId): HTMLAudioElement {
    const channel = this.channels[id];
    if (channel.element) return channel.element;
    const element = new Audio();
    element.preload = "auto";
    element.volume = 0;
    element.addEventListener("ended", () => this.advance(id));
    element.addEventListener("error", () => {
      if (element.getAttribute("src")) this.trackFailed(id);
    });
    element.addEventListener("playing", () => {
      channel.errors = 0;
      this.set({ unlocked: true });
    });
    channel.element = element;
    return element;
  }

  private playElement(id: ChannelId) {
    this.audio(id)
      .play()
      .catch((error: unknown) => {
        // AbortError only means the source changed while loading; errors surface via "error".
        if (error instanceof DOMException && error.name === "NotAllowedError") this.blocked();
      });
  }

  /** The next track of a channel, playing it if that channel is the one on. */
  private advance(id: ChannelId) {
    if (!this.channels[id].tracks.length) return;
    this.loadNext(id);
    if (this.customOn(id)) this.playElement(id);
  }

  private loadNext(id: ChannelId) {
    const channel = this.channels[id];
    if (!channel.queue.length) channel.queue = this.order(channel);
    const track = channel.tracks[channel.queue.shift() ?? 0];
    this.audio(id).src = track.url;
    channel.track = track;
    if (this.settings.active.id === id) this.set({ track });
  }

  private order(channel: Channel): number[] {
    const indices = channel.tracks.map((_, i) => i);
    const current = channel.track ? channel.tracks.findIndex((track) => track.url === channel.track?.url) : -1;
    if (!channel.shuffle) return [...indices.slice(current + 1), ...indices.slice(0, current + 1)];
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    // Don't play the same track twice in a row when a new shuffle starts.
    if (indices.length > 1 && indices[0] === current) indices.push(indices.shift()!);
    return indices;
  }

  private trackFailed(id: ChannelId) {
    const channel = this.channels[id];
    channel.errors++;
    if (channel.errors >= channel.tracks.length) {
      this.stopFade(channel);
      channel.element?.pause();
      channel.failed = true;
      this.apply();
      return;
    }
    this.advance(id);
  }

  private fadeElement(channel: Channel, target: number, seconds: number, done?: () => void) {
    const element = channel.element;
    if (!element) return;
    this.stopFade(channel);
    const start = element.volume;
    const began = performance.now();
    const step = () => {
      const progress = Math.min(1, (performance.now() - began) / (seconds * 1000));
      // An equal-power curve, so the crossfade doesn't dip in the middle.
      const eased = target > start ? Math.sin((progress * Math.PI) / 2) : 1 - Math.cos((progress * Math.PI) / 2);
      element.volume = Math.max(0, Math.min(1, start + (target - start) * eased));
      if (progress >= 1) {
        this.stopFade(channel);
        done?.();
      }
    };
    channel.fadeTimer = window.setInterval(step, 30);
    step();
  }

  private stopFade(channel: Channel) {
    window.clearInterval(channel.fadeTimer);
    channel.fadeTimer = 0;
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
      const { active } = this.settings;
      if (this.customOn(active.id)) this.playElement(active.id);
    };
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
  }

  private anyPieceRunning(): boolean {
    return !!this.graph && Object.values(this.graph.pieces).some((voice) => voice.piece.running);
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
    if (!graph || this.anyPieceRunning() || onLinux) return;
    this.idleTimer = window.setTimeout(() => {
      if (!this.anyPieceRunning() && graph.ctx.state === "running") void graph.ctx.suspend();
    }, IDLE_SUSPEND_MS);
  }
}

/** A smooth fade of an audio parameter from where it is now (equal-power for the crossfade). */
function ramp(ctx: AudioContext, param: AudioParam, value: number, seconds: number) {
  const now = ctx.currentTime;
  const from = param.value;
  // Ramps (unlike value curves) can always be cancelled mid-way, so a fade can turn around.
  param.cancelScheduledValues(now);
  param.setValueAtTime(from, now);
  if (seconds < 0.5) {
    param.linearRampToValueAtTime(value, now + seconds);
    return;
  }
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const eased = value > from ? Math.sin((p * Math.PI) / 2) : 1 - Math.cos((p * Math.PI) / 2);
    param.linearRampToValueAtTime(from + (value - from) * eased, now + seconds * p);
  }
}

export const ambientEngine = new AmbientEngine();
