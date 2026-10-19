/**
 * A tiny procedural soundscape: wind through needles, a few distant crickets
 * and the occasional soft pop from the wood stove. No audio files required.
 */
export class AmbientSound {
  constructor() {
    this.context = null;
    this.master = null;
    this.nodes = [];
    this.timers = new Set();
    this.enabled = false;
    this.night = 0;
    this.generation = 0;
  }

  setNight(night) {
    this.night = night;
  }

  async toggle() {
    if (this.enabled) {
      this.disable();
      return false;
    }
    await this.enable();
    return true;
  }

  async enable() {
    if (this.enabled) return;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) throw new Error('Web Audio is not supported');

    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioCtor();
      this.buildGraph();
    }
    await this.context.resume();
    this.enabled = true;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), now);
    this.master.gain.exponentialRampToValueAtTime(0.72, now + 1.8);
    this.scheduleCricket(0.4);
    this.scheduleCrackle(1.2);
  }

  disable() {
    if (!this.context || this.context.state === 'closed') {
      this.enabled = false;
      return;
    }
    this.enabled = false;
    this.generation++;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(Math.max(0.0001, this.master.gain.value), now);
    this.master.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    const ctx = this.context;
    setTimeout(() => {
      if (!this.enabled && this.context === ctx) {
        for (const node of this.nodes) {
          try {
            node.stop?.();
            node.disconnect?.();
          } catch {
            /* already disconnected */
          }
        }
        this.nodes = [];
        ctx.close().catch(() => {});
        this.context = null;
        this.master = null;
      }
    }, 900);
  }

  buildGraph() {
    const ctx = this.context;
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    this.master = master;

    // Broad, slow wind.
    const windBuffer = this.noiseBuffer(6.2);
    const wind = ctx.createBufferSource();
    wind.buffer = windBuffer;
    wind.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 430;
    windFilter.Q.value = 0.55;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.075;
    const windPan = ctx.createStereoPanner();
    windPan.pan.value = -0.18;
    wind.connect(windFilter).connect(windGain).connect(windPan).connect(master);
    wind.start();

    const windLfo = ctx.createOscillator();
    windLfo.type = 'sine';
    windLfo.frequency.value = 0.045;
    const windLfoGain = ctx.createGain();
    windLfoGain.gain.value = 0.028;
    windLfo.connect(windLfoGain).connect(windGain.gain);
    windLfo.start();

    // Fine leaf/needle rustle, slowly breathing.
    const rustle = ctx.createBufferSource();
    rustle.buffer = this.noiseBuffer(5.5);
    rustle.loop = true;
    const rustleFilter = ctx.createBiquadFilter();
    rustleFilter.type = 'bandpass';
    rustleFilter.frequency.value = 1650;
    rustleFilter.Q.value = 0.7;
    const rustleGain = ctx.createGain();
    rustleGain.gain.value = 0.014;
    const rustlePan = ctx.createStereoPanner();
    rustlePan.pan.value = 0.32;
    rustle.connect(rustleFilter).connect(rustleGain).connect(rustlePan).connect(master);
    rustle.start();

    const rustleLfo = ctx.createOscillator();
    rustleLfo.type = 'sine';
    rustleLfo.frequency.value = 0.07;
    const rustleLfoGain = ctx.createGain();
    rustleLfoGain.gain.value = 0.008;
    rustleLfo.connect(rustleLfoGain).connect(rustleGain.gain);
    rustleLfo.start();

    // A quiet low bed, almost felt more than heard.
    const low = ctx.createOscillator();
    low.type = 'sine';
    low.frequency.value = 54.5;
    const lowGain = ctx.createGain();
    lowGain.gain.value = 0.009;
    low.connect(lowGain).connect(master);
    low.start();

    this.nodes.push(
      wind,
      windFilter,
      windGain,
      windPan,
      windLfo,
      windLfoGain,
      rustle,
      rustleFilter,
      rustleGain,
      rustlePan,
      rustleLfo,
      rustleLfoGain,
      low,
      lowGain
    );
  }

  noiseBuffer(seconds) {
    const ctx = this.context;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        last = last * 0.985 + white * 0.015;
        data[i] = last * 2.4 + white * 0.18;
      }
    }
    return buffer;
  }

  scheduleCricket(initialDelay = null) {
    if (!this.enabled && initialDelay === null) return;
    const gen = this.generation;
    const delay = initialDelay ?? (this.night > 0.5 ? 1600 + Math.random() * 3300 : 3300 + Math.random() * 5000);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.enabled || gen !== this.generation) return;
      this.chirp();
      this.scheduleCricket();
    }, delay);
    this.timers.add(timer);
  }

  chirp() {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime + 0.02;
    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.7 + Math.random() * 1.4;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    pan.connect(gain).connect(this.master);
    const pulses = 2 + Math.floor(Math.random() * 3);
    const base = 3650 + Math.random() * 850;
    for (let i = 0; i < pulses; i++) {
      const start = now + i * 0.085;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base, start);
      osc.frequency.exponentialRampToValueAtTime(base * (0.94 + Math.random() * 0.08), start + 0.045);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(0.016, start + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 0.052);
      osc.connect(env).connect(gain);
      osc.start(start);
      osc.stop(start + 0.07);
    }
    setTimeout(() => {
      gain.disconnect();
      pan.disconnect();
    }, 800);
  }

  scheduleCrackle(initialDelay = null) {
    if (!this.enabled && initialDelay === null) return;
    const gen = this.generation;
    const delay = initialDelay ?? 1300 + Math.random() * 4200;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (!this.enabled || gen !== this.generation) return;
      this.crackle();
      this.scheduleCrackle();
    }, delay);
    this.timers.add(timer);
  }

  crackle() {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime + 0.01;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer(0.055);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 640 + Math.random() * 1300;
    filter.Q.value = 2.2;
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.16 + Math.random() * 0.22;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.038, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    source.connect(filter).connect(gain).connect(pan).connect(this.master);
    source.start(now);
    source.stop(now + 0.08);
    setTimeout(() => {
      filter.disconnect();
      gain.disconnect();
      pan.disconnect();
    }, 500);
  }
}
