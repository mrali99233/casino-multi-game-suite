// Animation toolkit: one RAF ticker, tweens, a particle system and canvas helpers.

export const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

export const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuart: (t) => 1 - Math.pow(1 - t, 4),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  outBack: (t, s = 1.70158) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  outElastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outBounce: (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const pickOne = (arr) => arr[(Math.random() * arr.length) | 0];

const hexCache = new Map();
export function rgb(hex) {
  if (hexCache.has(hex)) return hexCache.get(hex);
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => parseInt(c + c, 16)) : [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  hexCache.set(hex, v);
  return v;
}
export const alpha = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
export function mix(h1, h2, t) {
  const a = rgb(h1), b = rgb(h2);
  return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;
}

// ---------- ticker ----------
const subs = new Set();
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  subs.forEach((fn) => fn(dt, now / 1000));
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
export const ticker = { add: (fn) => { subs.add(fn); return () => subs.delete(fn); } };

// ---------- tweens ----------
const tweens = new Set();
ticker.add((dt) => {
  tweens.forEach((tw) => {
    if (tw.delay > 0) { tw.delay -= dt; return; }
    if (!tw.started) { tw.started = true; tw.from = {}; for (const k in tw.to) tw.from[k] = tw.obj[k]; }
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const e = tw.ease(tw.t);
    for (const k in tw.to) tw.obj[k] = lerp(tw.from[k], tw.to[k], e);
    tw.onUpdate && tw.onUpdate(tw.obj, e);
    if (tw.t >= 1) { tweens.delete(tw); tw.resolve(); }
  });
});
export function tween(obj, to, { dur = 0.4, ease: e = ease.outCubic, delay = 0, onUpdate } = {}) {
  return new Promise((resolve) => {
    tweens.add({ obj, to, dur: REDUCED ? Math.min(dur, 0.12) : Math.max(0.001, dur), ease: e, delay, onUpdate, resolve, t: 0, started: false });
  });
}
export const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

// ---------- stage ----------
export class Stage {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fx';
    container.prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1;
    this.drawers = [];
    this.shakeT = 0; this.shakePow = 0;
    this.particles = new Particles();
    this.time = 0;
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    ticker.add((dt, t) => this.frame(dt, t));
  }
  resize() {
    const r = this.container.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.onResize && this.onResize(this.w, this.h);
  }
  draw(fn) { this.drawers.push(fn); }
  shake(power = 8, dur = 0.4) { if (REDUCED) return; this.shakePow = Math.max(this.shakePow, power); this.shakeT = Math.max(this.shakeT, dur); }
  frame(dt, t) {
    if (!this.w) return;
    this.time = t;
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    let sx = 0, sy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const p = this.shakePow * Math.max(0, this.shakeT) * 2.2;
      sx = rand(-p, p); sy = rand(-p, p);
      if (this.shakeT <= 0) this.shakePow = 0;
    }
    ctx.save();
    ctx.translate(sx, sy);
    for (const fn of this.drawers) fn(ctx, dt, this.w, this.h, t);
    this.particles.update(dt);
    this.particles.draw(ctx);
    ctx.restore();
  }
}

// ---------- particles ----------
export class Particles {
  constructor() { this.list = []; }
  add(p) { if (this.list.length < 1400) this.list.push(p); }
  spark(x, y, { count = 24, color = '#ffc53d', speed = 260, life = 0.7, size = 2.6, gravity = 380, angle = -Math.PI / 2, spread = Math.PI * 2, drag = 0.9 } = {}) {
    if (REDUCED) count = Math.min(count, 6);
    for (let i = 0; i < count; i++) {
      const a = angle + rand(-spread / 2, spread / 2), v = speed * rand(0.35, 1);
      this.add({ k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * rand(0.6, 1.1), max: life, size: size * rand(0.6, 1.3), color, gravity, drag });
    }
  }
  confetti(x, y, { count = 80, colors = ['#ffc53d', '#ff3d81', '#22d3ee', '#8b5cf6', '#1fe58f'], speed = 520 } = {}) {
    if (REDUCED) count = Math.min(count, 12);
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + rand(-1.1, 1.1), v = speed * rand(0.45, 1);
      this.add({ k: 'conf', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(1.6, 2.6), max: 2.6, w: rand(5, 10), h: rand(3, 6), rot: rand(0, 6), vr: rand(-12, 12), color: pickOne(colors), gravity: 620, drag: 0.985 });
    }
  }
  coins(x, y, { count = 30, speed = 560 } = {}) {
    if (REDUCED) count = Math.min(count, 8);
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + rand(-0.9, 0.9), v = speed * rand(0.5, 1.05);
      this.add({ k: 'coin', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(1.6, 2.4), max: 2.4, r: rand(7, 12), spin: rand(0, 6), vs: rand(6, 14), gravity: 900, drag: 0.99 });
    }
  }
  ring(x, y, { color = '#22d3ee', r0 = 4, r1 = 60, life = 0.5, width = 3 } = {}) {
    this.add({ k: 'ring', x, y, r0, r1, life, max: life, color, width });
  }
  text(x, y, str, { color = '#1fe58f', size = 20, life = 1.1, rise = 70, font = '"Chakra Petch", sans-serif' } = {}) {
    this.add({ k: 'text', x, y, str, color, size, life, max: life, rise, font, y0: y });
  }
  smoke(x, y, { color = '#ffffff', size = 10, life = 0.9, vx = -40, vy = 10 } = {}) {
    this.add({ k: 'smoke', x, y, vx: vx + rand(-12, 12), vy: vy + rand(-10, 10), size, life, max: life, color });
  }
  update(dt) {
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const p = L[i];
      p.life -= dt;
      if (p.life <= 0) { L.splice(i, 1); continue; }
      if (p.vx !== undefined) {
        p.vy += (p.gravity || 0) * dt;
        if (p.drag) { const d = Math.pow(p.drag, dt * 60); p.vx *= d; p.vy *= d; }
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      if (p.vr) p.rot += p.vr * dt;
      if (p.vs) p.spin += p.vs * dt;
    }
  }
  draw(ctx) {
    for (const p of this.list) {
      const a = Math.max(0, Math.min(1, p.life / p.max));
      switch (p.k) {
        case 'spark': {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = alpha(p.color, a);
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, 7); ctx.fill();
          ctx.fillStyle = alpha(p.color, a * 0.25);
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 3, 0, 7); ctx.fill();
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'conf': {
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.rot * 1.7));
          ctx.globalAlpha = Math.min(1, a * 2); ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore(); ctx.globalAlpha = 1;
          break;
        }
        case 'coin': {
          const sx = Math.abs(Math.cos(p.spin));
          ctx.save(); ctx.translate(p.x, p.y); ctx.globalAlpha = Math.min(1, a * 2);
          const g = ctx.createLinearGradient(-p.r, -p.r, p.r, p.r);
          g.addColorStop(0, '#fff2b0'); g.addColorStop(0.5, '#ffc53d'); g.addColorStop(1, '#c97a10');
          ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, p.r * Math.max(0.15, sx), p.r, 0, 0, 7); ctx.fill();
          ctx.strokeStyle = 'rgba(120,60,0,0.6)'; ctx.lineWidth = 1.2; ctx.stroke();
          ctx.restore(); ctx.globalAlpha = 1;
          break;
        }
        case 'ring': {
          const t = 1 - a;
          ctx.strokeStyle = alpha(p.color, a * 0.9); ctx.lineWidth = p.width * a + 0.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, lerp(p.r0, p.r1, ease.outCubic(t)), 0, 7); ctx.stroke();
          break;
        }
        case 'text': {
          const t = 1 - a;
          ctx.globalAlpha = Math.min(1, a * 2.5);
          ctx.font = `700 ${p.size * (1 + 0.25 * ease.outBack(Math.min(1, t * 4)) - 0.25)}px ${p.font}`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.shadowColor = p.color; ctx.shadowBlur = 14; ctx.fillStyle = p.color;
          ctx.fillText(p.str, p.x, p.y0 - p.rise * ease.outCubic(t));
          ctx.shadowBlur = 0; ctx.globalAlpha = 1;
          break;
        }
        case 'smoke': {
          const t = 1 - a;
          ctx.fillStyle = alpha(p.color, a * 0.18);
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.6 + t * 1.8), 0, 7); ctx.fill();
          break;
        }
      }
    }
  }
}

// ---------- canvas helpers ----------
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}
export function glow(ctx, x, y, r, color, a = 0.6) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, alpha(color, a)); g.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
}
// Slowly drifting star field used as stage ambience.
export function starfield(count = 90) {
  const stars = Array.from({ length: count }, () => ({ x: Math.random(), y: Math.random(), r: rand(0.4, 1.6), tw: rand(0, 6), sp: rand(0.2, 1) }));
  return (ctx, dt, w, h, t, drift = 0) => {
    for (const s of stars) {
      const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * s.sp * 2 + s.tw));
      const x = ((s.x - drift * s.sp * 0.02) % 1 + 1) % 1;
      ctx.fillStyle = `rgba(200,210,255,${a})`;
      ctx.beginPath(); ctx.arc(x * w, s.y * h, s.r, 0, 7); ctx.fill();
    }
  };
}
