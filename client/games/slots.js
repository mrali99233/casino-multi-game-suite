// Fruit Slots client: three spinning reels with motion blur, staggered stops and glowing paylines.
import { fmtMult } from '../sdk/api.js';
import { alpha, clamp, ease, glow, roundRect, starfield, tween } from '../sdk/fx.js';

export const rules = `
<p>Three reels, three rows, five fixed lines (three rows and two diagonals). A line pays when it shows three of the same symbol; <b>WILD</b> stands in for any symbol and three WILDs pay the top prize. Two cherries starting a line also pay.</p>
<p>Your total win is the sum of all winning lines, as a multiple of your bet.</p>`;

const LINE_COLORS = ['#22d3ee', '#ffc53d', '#ff3d81', '#1fe58f', '#b18cff'];
const LABEL = { cherry_pair: 'Cherry pair', cherry: 'Cherry', lemon: 'Lemon', bell: 'Bell', bar: 'BAR', star: 'Star', diamond: 'Diamond', seven: 'Seven', wild: 'Wild' };

export function drawSymbol(ctx, name, x, y, s) {
  ctx.save(); ctx.translate(x, y);
  const k = s / 100;
  ctx.scale(k, k);
  switch (name) {
    case 'cherry': {
      ctx.strokeStyle = '#2fbf5b'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-14, 10); ctx.quadraticCurveTo(-4, -30, 12, -36); ctx.moveTo(16, 14); ctx.quadraticCurveTo(14, -16, 12, -36); ctx.stroke();
      ctx.fillStyle = '#3ddc6e'; ctx.beginPath(); ctx.ellipse(22, -34, 14, 6, -0.4, 0, 7); ctx.fill();
      for (const [cx, cy] of [[-16, 20], [16, 24]]) {
        const g = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 18); g.addColorStop(0, '#ff9aa9'); g.addColorStop(0.5, '#ff1f4b'); g.addColorStop(1, '#8a0020');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 17, 0, 7); ctx.fill();
      }
      break;
    }
    case 'lemon': {
      const g = ctx.createRadialGradient(-10, -10, 4, 0, 0, 40); g.addColorStop(0, '#fffbd0'); g.addColorStop(0.5, '#ffe14d'); g.addColorStop(1, '#c99a00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(0, 0, 38, 28, -0.25, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-37, 9, 7, 5, -0.25, 0, 7); ctx.ellipse(37, -9, 7, 5, -0.25, 0, 7); ctx.fill();
      break;
    }
    case 'bell': {
      const g = ctx.createLinearGradient(-30, -30, 30, 30); g.addColorStop(0, '#fff2b0'); g.addColorStop(0.5, '#ffc53d'); g.addColorStop(1, '#b8740c');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, -38); ctx.bezierCurveTo(26, -38, 26, -6, 30, 18); ctx.lineTo(38, 26); ctx.lineTo(-38, 26); ctx.lineTo(-30, 18); ctx.bezierCurveTo(-26, -6, -26, -38, 0, -38); ctx.fill();
      ctx.fillStyle = '#8a5200'; ctx.beginPath(); ctx.arc(0, 32, 8, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.beginPath(); ctx.ellipse(-12, -14, 5, 14, 0.2, 0, 7); ctx.fill();
      break;
    }
    case 'bar': {
      const g = ctx.createLinearGradient(0, -24, 0, 24); g.addColorStop(0, '#3b3f6e'); g.addColorStop(1, '#0d0f27');
      ctx.fillStyle = g; roundRect(ctx, -42, -24, 84, 48, 8); ctx.fill();
      ctx.strokeStyle = '#ffc53d'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#ffc53d'; ctx.font = '700 30px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('BAR', 0, 2);
      break;
    }
    case 'star': {
      const g = ctx.createRadialGradient(0, -6, 4, 0, 0, 42); g.addColorStop(0, '#f0e6ff'); g.addColorStop(0.5, '#b18cff'); g.addColorStop(1, '#5b2fd6');
      ctx.fillStyle = g; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 17 : 40, a = -Math.PI / 2 + (i * Math.PI) / 5; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'diamond': {
      const g = ctx.createLinearGradient(-30, -30, 30, 40); g.addColorStop(0, '#e6fdff'); g.addColorStop(0.4, '#22d3ee'); g.addColorStop(1, '#0a7c99');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-22, -28); ctx.lineTo(22, -28); ctx.lineTo(38, -8); ctx.lineTo(0, 38); ctx.lineTo(-38, -8); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,40,60,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-38, -8); ctx.lineTo(38, -8); ctx.moveTo(-10, -8); ctx.lineTo(0, 38); ctx.lineTo(10, -8); ctx.stroke();
      break;
    }
    case 'seven': {
      ctx.font = '700 86px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 8; ctx.strokeStyle = '#ffc53d'; ctx.strokeText('7', 0, 4);
      const g = ctx.createLinearGradient(0, -36, 0, 36); g.addColorStop(0, '#ff8199'); g.addColorStop(1, '#c4002f');
      ctx.fillStyle = g; ctx.fillText('7', 0, 4);
      break;
    }
    case 'wild': {
      const g = ctx.createLinearGradient(-40, -30, 40, 30); g.addColorStop(0, '#ff3d81'); g.addColorStop(0.5, '#8b5cf6'); g.addColorStop(1, '#22d3ee');
      ctx.fillStyle = g; roundRect(ctx, -44, -30, 88, 60, 12); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '700 28px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('WILD', 0, 2);
      break;
    }
  }
  ctx.restore();
}

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const data = init.game.data, REELS = data.reels, L = REELS[0].length, LINES = data.lines, pt = data.paytable;
  const st = { pos: [Math.random() * L, Math.random() * L, Math.random() * L], blur: [0, 0, 0], spinning: false, wins: [], winT: 0, stops: null };

  const mode = ui.segmented(null, [['manual', 'Manual'], ['auto', 'Auto']], 'manual', (v) => { autoBox.hidden = v !== 'auto'; syncBtn(); });
  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const auto = ui.autoPanel(money);
  const autoBox = h('div', { hidden: true }, auto.el);
  const btn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Spin');
  const table = h('div', { class: 'spt' });
  shell.controls.append(mode.el, amount.el, autoBox, btn, h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Paytable', h('em', {}, 'per line, × bet')), table));
  document.head.append(h('style', {}, `
    .spt { display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; }
    .spt .row { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 9px; background: var(--bg-0); border: 1px solid var(--line); transition: all .25s; }
    .spt .row canvas { width: 30px; height: 30px; flex: none; }
    .spt .row span { font-size: 12px; color: var(--muted); flex: 1; min-width: 0; }
    .spt .row b { font-family: var(--f-display); font-size: 14px; }
    .spt .row.hit { border-color: var(--gold); background: rgba(255,197,61,.12); }
  `));
  const order = ['wild', 'seven', 'diamond', 'star', 'bar', 'bell', 'lemon', 'cherry', 'cherry_pair'];
  const rowsByPrize = {};
  order.forEach((p) => {
    const c = h('canvas', { width: 60, height: 60 }), cx = c.getContext('2d');
    if (p === 'cherry_pair') { drawSymbol(cx, 'cherry', 20, 30, 34); drawSymbol(cx, 'cherry', 40, 30, 34); } else drawSymbol(cx, p, 30, 30, 50);
    rowsByPrize[p] = h('div', { class: 'row' }, c, h('span', {}, p === 'cherry_pair' ? '2 cherries' : `3 × ${LABEL[p]}`), h('b', {}, fmtMult(pt[p] / 100)));
    table.append(rowsByPrize[p]);
  });

  function syncBtn() {
    if (mode.value === 'auto') { btn.textContent = auto.running ? 'Stop auto' : 'Start auto'; btn.className = `btn ${auto.running ? 'btn-cancel' : 'btn-bet'}`; btn.disabled = false; }
    else { btn.textContent = st.spinning ? 'Spinning…' : 'Spin'; btn.className = 'btn btn-bet'; btn.disabled = st.spinning; }
  }

  async function spin() {
    if (st.spinning) return null;
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return null; }
    st.spinning = true; st.wins = []; syncBtn(); sound.bet();
    Object.values(rowsByPrize).forEach((r) => r.classList.remove('hit'));
    let r;
    try { r = await api.bet(bet, {}); } catch (e) { ui.toast(e.message, 'err'); st.spinning = false; syncBtn(); return null; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    const fast = mode.value === 'auto';
    // reel i shows strip[pos + row]; land so that floor(pos) == stop, after several full loops
    await Promise.all(r.result.stops.map((stop, i) => {
      const loops = (fast ? 2 : 3) + i * (fast ? 1 : 2);
      const start = st.pos[i];
      const target = Math.floor(start / L) * L + loops * L + stop + (stop < (start % L) ? L : 0);
      const box = { p: start };
      return tween(box, { p: target }, { dur: (fast ? 0.7 : 1.1) + i * (fast ? 0.18 : 0.38), ease: (t) => ease.outBack(t, 0.9), onUpdate: (_, e) => {
        const prev = st.pos[i]; st.pos[i] = box.p; st.blur[i] = Math.min(1, Math.abs(box.p - prev) / 1.2);
        if (Math.floor(prev) !== Math.floor(box.p) && e > 0.85) sound.tick(0.6 + i * 0.15);
      } }).then(() => { st.pos[i] = target; st.blur[i] = 0; sound.land(0); stage.shake(2, 0.12); });
    }));
    st.wins = r.result.wins; st.winT = 0;
    st.wins.forEach((w) => rowsByPrize[w.prize].classList.add('hit'));
    if (r.payout > 0) {
      sound.win(r.multiplier >= 10 ? 3 : r.multiplier >= 2 ? 2 : 1);
      stage.particles.text(stage.w / 2, stage.h * 0.5, `+${money.fmt(r.payout)}`, { color: '#1fe58f', size: 30, life: 1.5 });
      if (r.multiplier >= 3) stage.particles.coins(stage.w / 2, stage.h, { count: 30 });
      if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
    }
    shell.wallet.release(r.payout);
    ui.pushResult(shell.strip, r.multiplier, r.payout > r.bet ? 'win' : 'loss');
    st.spinning = false; syncBtn();
    return r;
  }

  btn.addEventListener('click', () => {
    if (mode.value === 'manual') { spin(); return; }
    if (auto.running) { auto.stop(); return; }
    auto.run(spin, { delay: 0.5, onState: syncBtn });
    syncBtn();
  });

  const stars = starfield(60);
  stage.draw((ctx, dt, W, H, t) => {
    stars(ctx, dt, W, H, t);
    st.winT += dt;
    const cell = clamp(Math.min((W - 60) / 3.3, (H - 120) / 3.3), 70, 170);
    const gap = cell * 0.08, bw = cell * 3 + gap * 4, bh = cell * 3 + gap * 2;
    const x0 = W / 2 - bw / 2, y0 = H / 2 - bh / 2 + 14;
    glow(ctx, W / 2, H / 2, bw, '#8b5cf6', 0.2);
    // cabinet
    const frame = ctx.createLinearGradient(0, y0 - 24, 0, y0 + bh + 24);
    frame.addColorStop(0, '#5a4bd6'); frame.addColorStop(0.5, '#2a2f78'); frame.addColorStop(1, '#4a3bc4');
    ctx.fillStyle = frame; roundRect(ctx, x0 - 18, y0 - 18, bw + 36, bh + 36, 26); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 2; ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const rx = x0 + gap + i * (cell + gap);
      // reel window
      ctx.save();
      roundRect(ctx, rx, y0, cell, bh, 14); ctx.clip();
      const bg = ctx.createLinearGradient(0, y0, 0, y0 + bh);
      bg.addColorStop(0, '#d8dcf5'); bg.addColorStop(0.12, '#f7f8ff'); bg.addColorStop(0.88, '#f7f8ff'); bg.addColorStop(1, '#d8dcf5');
      ctx.fillStyle = bg; ctx.fillRect(rx, y0, cell, bh);
      const p = st.pos[i], base = Math.floor(p), frac = p - base;
      for (let row = -1; row <= 3; row++) {
        const sym = REELS[i][(((base + row) % L) + L) % L];
        const cy = y0 + gap + (row - frac) * (cell + gap / 2) + cell / 2;
        if (st.blur[i] > 0.3) {
          ctx.globalAlpha = 0.35;
          drawSymbol(ctx, sym, rx + cell / 2, cy - cell * 0.18, cell * 0.66);
          drawSymbol(ctx, sym, rx + cell / 2, cy + cell * 0.18, cell * 0.66);
          ctx.globalAlpha = 1;
        } else {
          drawSymbol(ctx, sym, rx + cell / 2, cy, cell * 0.72);
        }
      }
      const shade = ctx.createLinearGradient(0, y0, 0, y0 + bh);
      shade.addColorStop(0, 'rgba(10,12,40,.45)'); shade.addColorStop(0.18, 'rgba(10,12,40,0)'); shade.addColorStop(0.82, 'rgba(10,12,40,0)'); shade.addColorStop(1, 'rgba(10,12,40,.45)');
      ctx.fillStyle = shade; ctx.fillRect(rx, y0, cell, bh);
      ctx.restore();
    }
    // winning lines
    st.wins.forEach((w, n) => {
      const pulse = 0.55 + 0.45 * Math.sin(st.winT * 6 + n);
      const pts = LINES[w.line].map(([reel, row]) => [x0 + gap + reel * (cell + gap) + cell / 2, y0 + gap + row * (cell + gap / 2) + cell / 2]);
      const col = LINE_COLORS[w.line];
      pts.forEach(([x, y]) => { ctx.strokeStyle = alpha(col, pulse); ctx.lineWidth = 4; roundRect(ctx, x - cell / 2 + 4, y - cell / 2 + 4, cell - 8, cell - 8, 12); ctx.stroke(); });
      ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.shadowColor = col; ctx.shadowBlur = 16; ctx.lineCap = 'round';
      ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x - cell * 0.55, y))); ctx.lineTo(pts[2][0] + cell * 0.55, pts[2][1]); ctx.stroke();
      ctx.shadowBlur = 0;
    });
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${clamp(W / 30, 16, 26)}px "Chakra Petch", sans-serif`;
    const total = st.wins.reduce((a, w) => a + w.multiplier, 0);
    ctx.fillStyle = total ? '#ffc53d' : 'rgba(241,242,255,.75)';
    ctx.fillText(st.spinning ? 'GOOD LUCK!' : total ? `${st.wins.length} LINE${st.wins.length > 1 ? 'S' : ''} · ${fmtMult(total)}` : '5 LINES · WILDS SUBSTITUTE', W / 2, y0 - 40);
  });
}
