// Galaxy Riches client: 5x3 reels, 20 lines, scatter-triggered free spins at 3x.
import { fmtMult } from '../sdk/api.js';
import { alpha, clamp, ease, glow, roundRect, starfield, tween, wait } from '../sdk/fx.js';
import { drawSymbol as classic } from './slots.js';

export const rules = `
<p>Five reels, three rows, twenty fixed lines. A line pays for three, four or five matching symbols from the leftmost reel. <b>WILD</b> (reels 2–4) stands in for any paying symbol.</p>
<p>Three or more <b>BONUS</b> scatters anywhere pay and award <b>10 free spins</b> where every line win is tripled.</p>`;

const LETTER = { ten: ['10', '#4aa8ff'], jack: ['J', '#2fd67a'], queen: ['Q', '#b18cff'], king: ['K', '#ff9f3d'], ace: ['A', '#ff4766'] };
const LINE_COLORS = ['#22d3ee', '#ffc53d', '#ff3d81', '#1fe58f', '#b18cff', '#ff8a1f', '#4aa8ff', '#ff6b81', '#7dffb3', '#ffe28a'];
const NAME = { ten: '10', jack: 'J', queen: 'Q', king: 'K', ace: 'A', bell: 'Bell', star: 'Star', diamond: 'Diamond', seven: 'Seven' };

export function drawSlotSymbol(ctx, name, x, y, s) {
  if (LETTER[name]) {
    const [t, c] = LETTER[name];
    ctx.save(); ctx.translate(x, y);
    ctx.font = `700 ${s * (t.length > 1 ? 0.62 : 0.78)}px "Chakra Petch", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = s * 0.08; ctx.strokeStyle = 'rgba(10,12,40,.85)'; ctx.strokeText(t, 0, s * 0.04);
    const g = ctx.createLinearGradient(0, -s * 0.4, 0, s * 0.4); g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, c); g.addColorStop(1, alpha(c, 0.8));
    ctx.fillStyle = g; ctx.fillText(t, 0, s * 0.04);
    ctx.restore();
    return;
  }
  if (name === 'scatter') {
    ctx.save(); ctx.translate(x, y);
    glow(ctx, 0, 0, s * 0.7, '#ff3d81', 0.6);
    const g = ctx.createRadialGradient(-s * 0.12, -s * 0.12, s * 0.04, 0, 0, s * 0.34);
    g.addColorStop(0, '#ffe0f0'); g.addColorStop(0.5, '#ff3d81'); g.addColorStop(1, '#6b0f3a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s * 0.32, 0, 7); ctx.fill();
    ctx.strokeStyle = '#ffc53d'; ctx.lineWidth = s * 0.05; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.48, s * 0.14, -0.35, 0, 7); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `700 ${s * 0.16}px "Chakra Petch", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('BONUS', 0, s * 0.02);
    ctx.restore();
    return;
  }
  classic(ctx, name, x, y, s);
}

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const data = init.game.data, STRIPS = data.strips, L = STRIPS[0].length, LINES = data.lines;
  const st = { pos: STRIPS.map(() => Math.random() * L), blur: [0, 0, 0, 0, 0], spinning: false, showWins: [], winIdx: 0, winT: 0,
    fs: null, banner: null, bannerT: 0, total: 0, scatterGlow: 0 };

  const mode = ui.segmented(null, [['manual', 'Manual'], ['auto', 'Auto']], 'manual', (v) => { autoBox.hidden = v !== 'auto'; syncBtn(); });
  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100), label: 'Total bet (20 lines)' });
  const auto = ui.autoPanel(money);
  const autoBox = h('div', { hidden: true }, auto.el);
  const btn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Spin');
  const table = h('div', { class: 'vpt' });
  shell.controls.append(mode.el, amount.el, autoBox, btn, h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Pays × total bet', h('em', {}, '3 · 4 · 5 of a kind')), table));
  document.head.append(h('style', {}, `
    .vpt { display: grid; gap: 4px; }
    .vpt .r { display: grid; grid-template-columns: 30px minmax(0, 1fr) repeat(3, 46px); align-items: center; gap: 4px; padding: 3px 8px; border-radius: 9px; background: var(--bg-0); border: 1px solid var(--line); font-size: 12px; font-variant-numeric: tabular-nums; }
    .vpt .r canvas { width: 28px; height: 28px; }
    .vpt .r b { font-family: var(--f-display); text-align: right; font-size: 12px; }
    .vpt .r span { color: var(--muted); }
    .vpt .r.hit { border-color: var(--gold); background: rgba(255,197,61,.12); }
  `));
  const rows = {};
  const icon = (name) => { const c = h('canvas', { width: 56, height: 56 }); drawSlotSymbol(c.getContext('2d'), name, 28, 28, 46); return c; };
  ['seven', 'diamond', 'star', 'bell', 'ace', 'king', 'queen', 'jack', 'ten'].forEach((s) => {
    rows[s] = h('div', { class: 'r' }, icon(s), h('span', {}, NAME[s]), ...data.paytable[s].map((m) => h('b', {}, fmtMult(m))));
    table.append(rows[s]);
  });
  table.append(h('div', { class: 'r' }, icon('scatter'), h('span', {}, 'Bonus · 10 FS'), ...['3', '4', '5'].map((n) => h('b', {}, fmtMult(data.scatter[n])))));
  table.append(h('div', { class: 'r' }, icon('wild'), h('span', { style: 'grid-column: span 4' }, 'Substitutes on reels 2–4')));

  function syncBtn() {
    if (mode.value === 'auto') { btn.textContent = auto.running ? 'Stop auto' : 'Start auto'; btn.className = `btn ${auto.running ? 'btn-cancel' : 'btn-bet'}`; btn.disabled = false; }
    else { btn.textContent = st.spinning ? (st.fs ? `Free spin ${st.fs.n}/${st.fs.of}` : 'Spinning…') : 'Spin'; btn.className = 'btn btn-bet'; btn.disabled = st.spinning; }
  }

  async function spinReels(stops, fast) {
    await Promise.all(stops.map((stop, i) => {
      const start = st.pos[i];
      const target = Math.floor(start / L) * L + (2 + i) * L + stop + (stop < (start % L) ? L : 0);
      const box = { p: start };
      return tween(box, { p: target }, { dur: (fast ? 0.55 : 0.8) + i * (fast ? 0.12 : 0.22), ease: (t) => ease.outBack(t, 0.8), onUpdate: (_, e) => {
        const prev = st.pos[i]; st.pos[i] = box.p; st.blur[i] = Math.min(1, Math.abs(box.p - prev) / 1.1);
        if (Math.floor(prev) !== Math.floor(box.p) && e > 0.9) sound.tick(0.5 + i * 0.12);
      } }).then(() => { st.pos[i] = target; st.blur[i] = 0; sound.land(0); });
    }));
  }

  async function presentSpin(res, bet, fast) {
    st.showWins = res.wins; st.winIdx = 0; st.winT = 0;
    Object.values(rows).forEach((r) => r.classList.remove('hit'));
    res.wins.forEach((w) => rows[w.symbol]?.classList.add('hit'));
    const won = Math.round(res.total * bet);
    if (res.scatters >= 3) { st.scatterGlow = 1; sound.win(2); }
    if (won > 0) {
      st.total += won;
      sound.win(res.total >= 5 ? 2 : 1);
      stage.particles.text(stage.w / 2, stage.h * 0.5, `+${money.fmt(won)}`, { color: '#1fe58f', size: 28, life: 1.2 });
      if (res.total >= 5) stage.particles.coins(stage.w / 2, stage.h, { count: 24 });
      await wait(fast ? 0.5 : Math.min(2.2, 0.6 + res.wins.length * 0.45));
    } else await wait(fast ? 0.15 : 0.3);
  }

  async function spin() {
    if (st.spinning) return null;
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return null; }
    st.spinning = true; st.showWins = []; st.total = 0; st.banner = null; st.fs = null; syncBtn(); sound.bet();
    let r;
    try { r = await api.bet(bet, {}); } catch (e) { ui.toast(e.message, 'err'); st.spinning = false; syncBtn(); return null; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    const fast = mode.value === 'auto';
    await spinReels(r.result.base.stops, fast);
    await presentSpin(r.result.base, bet, fast);
    const free = r.result.free_spins;
    if (free.length) {
      st.banner = 'FREE SPINS!'; st.bannerT = 0;
      stage.particles.confetti(stage.w / 2, stage.h * 0.4, { count: 120 });
      await wait(1.8);
      st.banner = null;
      for (let n = 0; n < free.length; n++) {
        st.fs = { n: n + 1, of: free.length }; st.showWins = []; syncBtn();
        await spinReels(free[n].stops, true);
        await presentSpin(free[n], bet, fast);
      }
      st.banner = `FREE SPINS WIN ${money.fmt(st.total)}`; st.bannerT = 0;
      await wait(1.6);
      st.banner = null; st.fs = null;
    }
    shell.wallet.release(r.payout);
    ui.pushResult(shell.strip, r.multiplier, r.payout > r.bet ? 'win' : 'loss');
    if (r.multiplier >= 10) await ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
    st.spinning = false; syncBtn();
    return r;
  }

  btn.addEventListener('click', () => {
    if (mode.value === 'manual') { spin(); return; }
    if (auto.running) { auto.stop(); return; }
    auto.run(spin, { delay: 0.4, onState: syncBtn });
    syncBtn();
  });

  const stars = starfield(90);
  stage.draw((ctx, dt, W, H, t) => {
    stars(ctx, dt, W, H, t);
    st.winT += dt; st.bannerT += dt; st.scatterGlow = Math.max(0, st.scatterGlow - dt * 0.4);
    const cell = clamp(Math.min((W - 50) / 5.4, (H - 130) / 3.4), 52, 150);
    const gap = cell * 0.06, bw = cell * 5 + gap * 6, bh = cell * 3 + gap * 2;
    const x0 = W / 2 - bw / 2, y0 = H / 2 - bh / 2 + 18;
    glow(ctx, W / 2, H / 2, bw * 0.8, st.fs ? '#ff3d81' : '#8b5cf6', st.fs ? 0.32 : 0.22);
    const frame = ctx.createLinearGradient(0, y0 - 20, 0, y0 + bh + 20);
    frame.addColorStop(0, st.fs ? '#d6338a' : '#5a4bd6'); frame.addColorStop(0.5, '#1c2050'); frame.addColorStop(1, st.fs ? '#9b1f6a' : '#3b2e9e');
    ctx.fillStyle = frame; roundRect(ctx, x0 - 14, y0 - 14, bw + 28, bh + 28, 22); ctx.fill();
    for (let i = 0; i < 5; i++) {
      const rx = x0 + gap + i * (cell + gap);
      ctx.save(); roundRect(ctx, rx, y0, cell, bh, 12); ctx.clip();
      const bg = ctx.createLinearGradient(0, y0, 0, y0 + bh);
      bg.addColorStop(0, '#0b0c22'); bg.addColorStop(0.5, '#1a1d48'); bg.addColorStop(1, '#0b0c22');
      ctx.fillStyle = bg; ctx.fillRect(rx, y0, cell, bh);
      const p = st.pos[i], base = Math.floor(p), frac = p - base;
      for (let row = -1; row <= 3; row++) {
        const sym = STRIPS[i][(((base + row) % L) + L) % L];
        const cy = y0 + (row - frac) * (cell + gap / 2) + cell / 2;
        if (st.blur[i] > 0.3) { ctx.globalAlpha = 0.4; drawSlotSymbol(ctx, sym, rx + cell / 2, cy - cell * 0.15, cell * 0.66); drawSlotSymbol(ctx, sym, rx + cell / 2, cy + cell * 0.15, cell * 0.66); ctx.globalAlpha = 1; }
        else {
          const pulse = sym === 'scatter' && st.scatterGlow > 0 ? 1 + 0.12 * Math.sin(t * 10) : 1;
          drawSlotSymbol(ctx, sym, rx + cell / 2, cy, cell * 0.74 * pulse);
        }
      }
      ctx.restore();
    }
    // cycle through winning lines one at a time
    if (st.showWins.length && !st.blur.some((b) => b > 0)) {
      const idx = Math.floor(st.winT / 0.8) % st.showWins.length;
      const w = st.showWins[idx], col = LINE_COLORS[w.line % LINE_COLORS.length];
      const pts = LINES[w.line].map((row, reel) => [x0 + gap + reel * (cell + gap) + cell / 2, y0 + row * (cell + gap / 2) + cell / 2]);
      for (let k = 0; k < w.count; k++) { const [x, y] = pts[k]; ctx.strokeStyle = col; ctx.lineWidth = 3; roundRect(ctx, x - cell / 2 + 4, y - cell / 2 + 4, cell - 8, cell - 8, 10); ctx.stroke(); }
      ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowColor = col; ctx.shadowBlur = 14;
      ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x - cell * 0.5, y))); ctx.lineTo(pts[4][0] + cell * 0.5, pts[4][1]); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(7,8,26,.85)'; roundRect(ctx, W / 2 - 120, y0 + bh + 18, 240, 30, 15); ctx.fill();
      ctx.fillStyle = '#ffc53d'; ctx.font = '700 15px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`LINE ${w.line + 1} · ${w.count} × ${NAME[w.symbol]} · ${fmtMult(w.multiplier)}`, W / 2, y0 + bh + 33);
    }
    // header
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${clamp(W / 32, 15, 24)}px "Chakra Petch", sans-serif`;
    if (st.fs) { ctx.fillStyle = '#ff3d81'; ctx.fillText(`FREE SPIN ${st.fs.n} / ${st.fs.of}  ·  WINS ×3  ·  ${money.fmt(st.total)}`, W / 2, y0 - 34); }
    else { ctx.fillStyle = st.total ? '#ffc53d' : 'rgba(241,242,255,.7)'; ctx.fillText(st.total ? `WIN ${money.fmt(st.total)}` : '20 LINES · 3 BONUS = 10 FREE SPINS', W / 2, y0 - 34); }
    if (st.banner) {
      const s = 0.8 + 0.2 * ease.outBack(Math.min(1, st.bannerT * 2.5));
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(s, s);
      ctx.fillStyle = 'rgba(7,8,26,.82)'; roundRect(ctx, -Math.min(W * 0.42, 300), -46, Math.min(W * 0.84, 600), 92, 22); ctx.fill();
      ctx.strokeStyle = '#ffc53d'; ctx.lineWidth = 3; ctx.stroke();
      ctx.font = `700 ${clamp(W / 18, 22, 44)}px "Chakra Petch", sans-serif`; ctx.fillStyle = '#ffc53d'; ctx.shadowColor = '#ffc53d'; ctx.shadowBlur = 24;
      ctx.fillText(st.banner, 0, 2); ctx.shadowBlur = 0;
      ctx.restore();
    }
  });
}
