// Procedural sound design (WebAudio). No audio files: every effect is synthesised.

class SoundBoard {
  constructor() {
    this.enabled = true;
    try { this.enabled = localStorage.getItem('cm-sound') !== 'off'; } catch (e) { /* storage blocked */ }
    this.ctx = null;
    this.lastTick = 0;
    this.engine = null;
    const unlock = () => { this.ensure(); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('pointerdown', unlock);
  }

  ensure() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp).connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { return null; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem('cm-sound', this.enabled ? 'on' : 'off'); } catch (e) { /* ignore */ }
    if (!this.enabled) this.engineStop();
    return this.enabled;
  }

  tone(freq, dur = 0.1, { type = 'sine', vol = 0.2, when = 0, to = null, attack = 0.005 } = {}) {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dur = 0.3, { vol = 0.3, freq = 1200, q = 0.8, type = 'lowpass', when = 0, to = null } = {}) {
    const c = this.ensure(); if (!c) return;
    const t = c.currentTime + when;
    const src = c.createBufferSource(); src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  // ---- palette ----
  click() { this.tone(1400, 0.04, { type: 'triangle', vol: 0.06 }); }
  bet() { this.tone(520, 0.08, { type: 'triangle', vol: 0.12, to: 880 }); this.noise(0.08, { vol: 0.05, freq: 4000, type: 'highpass' }); }
  peg(row = 0) {
    const now = performance.now(); if (now - this.lastTick < 22) return; this.lastTick = now;
    this.tone(900 + row * 55 + Math.random() * 60, 0.05, { type: 'sine', vol: 0.05 });
  }
  tick(pitch = 1) {
    const now = performance.now(); if (now - this.lastTick < 25) return; this.lastTick = now;
    this.tone(1800 * pitch, 0.025, { type: 'square', vol: 0.025 });
    this.noise(0.02, { vol: 0.04, freq: 5000, type: 'highpass' });
  }
  land(level = 0) {
    const base = [330, 392, 523, 659][Math.min(3, level)];
    this.tone(base, 0.18, { type: 'triangle', vol: 0.12 });
    this.tone(base * 1.5, 0.22, { type: 'sine', vol: 0.06, when: 0.03 });
  }
  win(level = 1) {
    const notes = level >= 3 ? [523, 659, 784, 1047, 1319, 1568] : level === 2 ? [523, 659, 784, 1047] : [659, 988];
    notes.forEach((f, i) => { this.tone(f, 0.28, { type: 'triangle', vol: 0.14, when: i * 0.075 }); this.tone(f * 2, 0.2, { type: 'sine', vol: 0.04, when: i * 0.075 }); });
    if (level >= 2) this.noise(0.6, { vol: 0.05, freq: 6000, type: 'highpass', when: 0.1 });
  }
  lose() { this.tone(220, 0.35, { type: 'sawtooth', vol: 0.06, to: 110 }); }
  cashout() { this.tone(880, 0.12, { type: 'triangle', vol: 0.12 }); this.tone(1320, 0.25, { type: 'triangle', vol: 0.12, when: 0.07 }); this.noise(0.25, { vol: 0.06, freq: 7000, type: 'highpass', when: 0.05 }); }
  gem(i = 0) { const f = 880 * Math.pow(2, Math.min(i, 14) / 12); this.tone(f, 0.25, { type: 'sine', vol: 0.12 }); this.tone(f * 2.01, 0.3, { type: 'sine', vol: 0.05, when: 0.02 }); }
  flip() { this.noise(0.09, { vol: 0.12, freq: 2200, to: 600, type: 'bandpass', q: 1.2 }); }
  explode() { this.noise(0.9, { vol: 0.5, freq: 900, to: 80 }); this.tone(90, 0.6, { type: 'sine', vol: 0.3, to: 40 }); }
  whoosh() { this.noise(0.5, { vol: 0.14, freq: 400, to: 2400, type: 'bandpass', q: 0.9 }); }
  roll() { for (let i = 0; i < 6; i++) this.noise(0.04, { vol: 0.05, freq: 3000 + i * 300, type: 'bandpass', when: i * 0.05 }); }

  engineStart() {
    const c = this.ensure(); if (!c || this.engine) return;
    const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o.type = 'sawtooth'; o2.type = 'square'; o.frequency.value = 70; o2.frequency.value = 35;
    f.type = 'lowpass'; f.frequency.value = 500;
    g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.045, c.currentTime + 0.4);
    o.connect(f); o2.connect(f); f.connect(g).connect(this.master);
    o.start(); o2.start();
    this.engine = { o, o2, g, f };
  }
  engineSet(mult) {
    if (!this.engine || !this.ctx) return;
    const k = Math.log(Math.max(1, mult));
    this.engine.o.frequency.setTargetAtTime(70 + k * 55, this.ctx.currentTime, 0.1);
    this.engine.o2.frequency.setTargetAtTime(35 + k * 27, this.ctx.currentTime, 0.1);
    this.engine.f.frequency.setTargetAtTime(500 + k * 400, this.ctx.currentTime, 0.1);
  }
  engineStop() {
    if (!this.engine || !this.ctx) return;
    const { o, o2, g } = this.engine;
    g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08);
    o.stop(this.ctx.currentTime + 0.4); o2.stop(this.ctx.currentTime + 0.4);
    this.engine = null;
  }
}

export const sound = new SoundBoard();
