"use strict";

// Audio scheduling uses the audio clock; the UI never determines when a click sounds.
window.MetronomeAudio = (() => {
  const sounds = {
    click: { type: "square", frequency: 1200, duration: 0.025, peak: 0.35 },
    wood: { type: "triangle", frequency: 650, duration: 0.045, peak: 0.7 },
    beep: { type: "sine", frequency: 880, duration: 0.06, peak: 0.65 }
  };

  function rhythm(subdivision, beats) {
    const bars = { "bars-2": 2, "bars-4": 4, "bars-8": 8 }[subdivision];
    if (bars) return { divisions: 1, pulseEvery: beats * bars, steps: beats * bars, bars };
    if (subdivision < 1) {
      const pulseEvery = 1 / subdivision;
      let a = beats, b = pulseEvery;
      while (b) [a, b] = [b, a % b];
      // Use a full common cycle so long notes stay aligned across odd-length bars.
      return { divisions: 1, pulseEvery, steps: beats * pulseEvery / a, bars: 1 };
    }
    return { divisions: subdivision, pulseEvery: 1, steps: beats * subdivision, bars: 1 };
  }

  function position(step, subdivision, beats) {
    const pattern = rhythm(subdivision, beats);
    const part = step % pattern.divisions;
    const beat = Math.floor(step / pattern.divisions) % beats;
    return { onbeat: part === 0, accent: beat === 0 && part === 0, beat, part,
      bar: Math.floor(step / (beats * pattern.divisions)), audible: step % pattern.pulseEvery === 0 };
  }

  function click(context, destination, time, sound, accent) {
    const voice = sounds[sound] || sounds.click;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = voice.type;
    oscillator.frequency.setValueAtTime(voice.frequency * (accent ? 1.5 : 1), time);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(voice.peak, time + 0.001);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + voice.duration);
    envelope.gain.setValueAtTime(0, time + voice.duration + 0.002);
    oscillator.connect(envelope);
    envelope.connect(destination);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    oscillator.start(time);
    oscillator.stop(time + voice.duration + 0.005);
    return oscillator;
  }

  class Engine {
    constructor(settings, onTick, onInterrupted) {
      this.settings = settings;
      this.onTick = onTick;
      this.onInterrupted = onInterrupted;
      this.context = null;
      this.playing = false;
      this.generation = 0;
      this.sources = new Set();
      this.visuals = [];
    }

    initialize() {
      if (this.context && this.context.state !== "closed") return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) throw new Error("このブラウザでは音声再生に対応していません。");
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.onbeat = this.context.createGain();
      this.offbeat = this.context.createGain();
      this.onbeat.connect(this.master);
      this.offbeat.connect(this.master);
      this.master.connect(this.context.destination);
      this.context.onstatechange = () => {
        if (this.playing && this.context.state !== "running") {
          this.stop();
          this.onInterrupted();
        }
      };
    }

    updateVolumes(immediate = false) {
      if (!this.context) return;
      for (const name of ["master", "onbeat", "offbeat"]) {
        const parameter = this[name].gain;
        parameter.cancelScheduledValues(this.context.currentTime);
        if (immediate) parameter.setValueAtTime(this.settings[name] / 100, this.context.currentTime);
        else parameter.setTargetAtTime(this.settings[name] / 100, this.context.currentTime, 0.008);
      }
    }

    setTempo(value) {
      if (this.playing) {
        // Preserve progress through the current interval; already queued sounds keep their time.
        const anchor = Math.max(this.context.currentTime, this.lastScheduledTime ?? -Infinity);
        this.nextTime = anchor + Math.max(0, this.nextTime - anchor) * this.settings.tempo / value;
      }
      this.settings.tempo = value;
    }

    async start() {
      const generation = ++this.generation;
      this.initialize();
      await this.context.resume();
      if (generation !== this.generation) return false;
      if (this.context.state !== "running") throw new Error("音声を開始できませんでした。再生ボタンをもう一度押してください。");
      this.playing = true;
      this.step = 0;
      this.lastScheduledTime = null;
      this.nextTime = this.context.currentTime + 0.05;
      this.updateVolumes(true);
      this.schedule();
      this.timer = setInterval(() => this.schedule(), 25);
      this.frame = requestAnimationFrame(() => this.draw());
      return true;
    }

    schedule() {
      if (!this.playing) return;
      const now = this.context.currentTime;
      const pattern = rhythm(this.settings.subdivision, this.settings.beats);
      const duration = 60 / this.settings.tempo / pattern.divisions;
      const steps = pattern.steps;
      // Skip missed subdivisions after throttling rather than playing them in a burst.
      if (this.nextTime < now) {
        const skipped = Math.ceil((now + 0.01 - this.nextTime) / duration);
        this.step = (this.step + skipped) % steps;
        this.nextTime += skipped * duration;
      }
      // A hidden tab may not paint for a long time. Retain only the latest visual tick.
      while (this.visuals.length > 1 && this.visuals[1].time <= now) this.visuals.shift();
      while (this.nextTime < now + 0.12) {
        const tick = position(this.step, this.settings.subdivision, this.settings.beats);
        if (tick.audible) {
          const source = click(this.context, tick.onbeat ? this.onbeat : this.offbeat,
            this.nextTime, this.settings.sound, tick.accent && this.settings.accent);
          this.sources.add(source);
          source.addEventListener("ended", () => this.sources.delete(source), { once: true });
        }
        // Silent quarter notes still advance the visual beat and the long rhythm's phase.
        this.visuals.push({ ...tick, time: this.nextTime });
        this.lastScheduledTime = this.nextTime;
        this.step = (this.step + 1) % steps;
        this.nextTime += duration;
      }
    }

    draw() {
      if (!this.playing) return;
      const latency = this.context.outputLatency || this.context.baseLatency || 0;
      const now = this.context.currentTime - latency;
      let latest;
      while (this.visuals.length && this.visuals[0].time <= now) latest = this.visuals.shift();
      if (latest) this.onTick(latest);
      this.frame = requestAnimationFrame(() => this.draw());
    }

    stop() {
      ++this.generation;
      this.playing = false;
      clearInterval(this.timer);
      cancelAnimationFrame(this.frame);
      if (this.context && this.master) {
        this.master.gain.cancelScheduledValues(this.context.currentTime);
        this.master.gain.setValueAtTime(0, this.context.currentTime);
      }
      for (const source of this.sources) {
        try { source.stop(); } catch { /* A finished source may already be stopped. */ }
      }
      this.sources.clear();
      this.visuals.length = 0;
    }
  }

  return { Engine, position, rhythm, click };
})();
