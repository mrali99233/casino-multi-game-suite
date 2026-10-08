// Plinko client: server decides the path; the board animates it hop by hop.
import { fmtMult } from '../sdk/api.js';
import { alpha, ease, glow, mix, rand, roundRect, starfield } from '../sdk/fx.js';

export const rules = `
<p>Drop a ball through the peg board. At every peg it bounces left or right with equal chance, and lands in one of the buckets at the bottom. The bucket's multiplier is your payout.</p>
<p>Centre buckets are hit most often and pay little; edge buckets are rare and pay the most. With <b>R</b> rows, bucket <b>k</b> is hit with probability C(R, k) / 2<sup>R</sup>.</p>
<p>Risk changes how steep the payout curve is. More rows means more buckets and bigger edge multipliers.</p>`;

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const data = init.game.data;
  const st = { rows: 12, risk: 'medium', balls: [], flash: new Map(), pulse: [], inFlight: 0 };
  const table = () => data.tables[String(st.rows)][st.risk];
  const resetPulse = () => { st.pulse = Array(st.rows + 1).fill(0); };
  resetPulse();

  // ---------- controls ----------
  const { h } = ui;
  const mode = ui.segmented(null, [['manual', 'Manual'], ['auto', 'Auto']], 'manual', (v) => { autoBox.hidden = v !== 'auto'; syncButton(); });
  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const risk = ui.segmented('Risk', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']], st.risk, (v) => { st.risk = v; });
  const rows = ui.segmented('Rows', data.rows.map((r) => [r, String(r)]), st.rows, (v) => { st.rows = v; resetPulse(); });
  const auto = ui.autoPanel(money);
  const autoBox = h('div', { hidden: true }, auto.el);
  const btn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Drop ball');
  const info = ui.stats([['edge', 'Edge bucket'], ['rtp', 'RTP']]);
  shell.controls.append(mode.el, amount.el, risk.el, rows.el, autoBox, btn, info.el);

  const updateInfo = () => {
    const t = table();
    info.set('edge', fmtMult(t[0] / 100));
    info.set('rtp', `${(init.game.rtp * 100).toFixed(2)}%`);
  };
  updateInfo();
  [risk, rows].forEach((s) => s.el.addEventListener('click', updateInfo));

  const lock = () => { const busy = st.inFlight > 0 || auto.running; risk.disabled = busy; rows.disabled = busy; };
  function syncButton() {
    if (mode.value === 'auto') { btn.textContent = auto.running ? 'Stop auto' : 'Start auto'; btn.className = `btn ${auto.running ? 'btn-cancel' : 'btn-bet'}`; }
    else { btn.textContent = 'Drop ball'; btn.className = 'btn btn-bet'; }
  }

  async function drop() {
    if (st.inFlight >= 25) return null;
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return null; }
    st.inFlight++; lock();
    sound.bet();
    try {
      const r = await api.bet(bet, { rows: st.rows, risk: st.risk });
      shell.wallet.sync(r.balance);
      shell.wallet.hold(r.payout);
      spawn(r);
      return r;
    } catch (e) {
      st.inFlight--; lock();
      ui.toast(e.message, 'err');
      return null;
    }
  }

  btn.addEventListener('click', () => {
    if (mode.value === 'manual') { drop(); return; }
    if (auto.running) { auto.stop(); return; }
    auto.run(drop, { delay: 0.28, onState: () => { syncButton(); lock(); } });
    syncButton();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName) && mode.value === 'manual') { e.preventDefault(); drop(); }
  });

  // ---------- geometry ----------
  function geom() {
    const R = st.rows, W = stage.w, H = stage.h;
    const top = 58, bottom = 18;
    const s = Math.min((W - 28) / (R + 2), (H - top - bottom) / (R + 1.55));
    const dy = s * 0.94;
    const boardH = (R - 1) * dy + s * 1.25;
    const y0 = Math.max(top + s * 0.4, (H - boardH) / 2 + s * 0.15);
    return { R, s, dy, y0, cx: W / 2, pegR: Math.max(2.2, s * 0.095), ballR: Math.max(4, s * 0.22), bucketY: y0 + (R - 1) * dy + s * 0.9, bw: s * 0.9, bh: s * 0.66 };
  }
  function point(g, i, cum) {
    if (i < 0) return { x: g.cx, y: g.y0 - g.dy * 1.4 };
    if (i === g.R) return { x: g.cx + (cum[i] - g.R / 2) * g.s, y: g.bucketY - g.bh * 0.25 };
    return { x: g.cx + (cum[i] - i / 2) * g.s, y: g.y0 + i * g.dy - g.pegR - g.ballR * 0.9 };
  }
  function bucketColor(k, R) {
    const d = Math.abs(k - R / 2) / (R / 2);
    return d < 0.5 ? mix('#ffc53d', '#ff8a1f', d / 0.5) : mix('#ff8a1f', '#ff3d6e', (d - 0.5) / 0.5);
  }

  function spawn(r) {
    const path = r.result.path, cum = [0];
    path.forEach((p) => cum.push(cum[cum.length - 1] + p));
    st.balls.push({ r, cum, seg: 0, t: 0, hop: path.map(() => rand(0.36, 0.5)), trail: [], rows: st.rows, jitter: rand(-0.18, 0.18) });
  }

  function land(b) {
    const g = geom(), k = b.r.result.bucket, mult = b.r.multiplier;
    st.inFlight--; lock();
    st.pulse[k] = 1;
    const x = g.cx + (k - g.R / 2) * g.s, y = g.bucketY;
    stage.particles.spark(x, y - g.bh / 2, { count: mult >= 2 ? 30 : 10, color: mult >= 2 ? '#ffc53d' : '#9aa6ff', speed: 220, spread: 1.6 });
    stage.particles.ring(x, y, { color: mult >= 1 ? '#ffc53d' : '#8b5cf6', r0: g.bw * 0.3, r1: g.bw * 1.3, life: 0.45 });
    if (b.r.payout > 0) stage.particles.text(x, y - g.bh, `${fmtMult(mult)}`, { color: mult >= 1 ? '#1fe58f' : '#b8bfff', size: Math.max(13, g.s * 0.38), rise: g.s * 1.6 });
    sound.land(mult >= 10 ? 3 : mult >= 2 ? 2 : mult >= 1 ? 1 : 0);
    shell.wallet.release(b.r.payout);
    ui.pushResult(shell.strip, mult);
    if (mult >= 10) { stage.shake(5, 0.35); ui.bigWin(shell, stage, { mult, amount: b.r.payout, money }); }
  }

  // ---------- render ----------
  const stars = starfield(70);
  stage.draw((ctx, dt, W, H, t) => {
    stars(ctx, dt, W, H, t);
    const g = geom(), tbl = table();
    glow(ctx, g.cx, g.y0 + g.R * g.dy * 0.55, Math.max(W, H) * 0.45, '#8b5cf6', 0.16);

    // decay
    for (const [k, v] of st.flash) { const nv = v - dt * 3.2; nv <= 0 ? st.flash.delete(k) : st.flash.set(k, nv); }
    st.pulse = st.pulse.map((p) => Math.max(0, p - dt * 2.4));

    // pegs
    for (let r = 0; r < g.R; r++) {
      const n = r + 3, y = g.y0 + r * g.dy;
      for (let j = 0; j < n; j++) {
        const x = g.cx + (j - (n - 1) / 2) * g.s;
        const f = st.flash.get(r * 100 + j) || 0;
        if (f > 0) glow(ctx, x, y, g.pegR * (3 + 5 * f), '#22d3ee', 0.55 * f);
        ctx.fillStyle = f > 0 ? mix('#e9ecff', '#7ff0ff', f) : 'rgba(225,230,255,0.88)';
        ctx.beginPath(); ctx.arc(x, y, g.pegR * (1 + f * 0.35), 0, 7); ctx.fill();
      }
    }

    // buckets
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let k = 0; k <= g.R; k++) {
      const p = st.pulse[k] || 0;
      const x = g.cx + (k - g.R / 2) * g.s;
      const y = g.bucketY + ease.outBack(p) * g.s * 0.14 * (p > 0 ? 1 : 0) * p;
      const col = bucketColor(k, g.R);
      if (p > 0) glow(ctx, x, y, g.bw * 1.6, '#ffc53d', 0.45 * p);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      roundRect(ctx, x - g.bw / 2, y - g.bh / 2 + 4, g.bw, g.bh, Math.max(3, g.s * 0.14)); ctx.fill();
      ctx.fillStyle = col;
      roundRect(ctx, x - g.bw / 2, y - g.bh / 2, g.bw, g.bh, Math.max(3, g.s * 0.14)); ctx.fill();
      const shade = ctx.createLinearGradient(0, y - g.bh / 2, 0, y + g.bh / 2);
      shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(60,0,20,0.28)');
      ctx.fillStyle = shade; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      roundRect(ctx, x - g.bw / 2 + 2, y - g.bh / 2 + 2, g.bw - 4, g.bh * 0.38, Math.max(2, g.s * 0.1)); ctx.fill();
      const m = tbl[k] / 100;
      ctx.fillStyle = '#2a0a12';
      ctx.font = `700 ${Math.max(8, Math.min(g.s * 0.27, g.bw / (m >= 100 ? 2.6 : 3)))}px "Chakra Petch", sans-serif`;
      ctx.fillText(m >= 100 ? m.toFixed(0) : m >= 10 ? m.toFixed(1) : String(+m.toFixed(2)), x, y + 1);
    }

    // balls
    for (const b of st.balls) {
      if (b.rows !== g.R) { b.done = true; continue; }
      const dur = b.seg === 0 ? 0.3 : Math.max(0.1, 0.15 - g.R * 0.002);
      b.t += dt / dur;
      while (b.t >= 1 && !b.done) {
        b.t -= 1;
        const i = b.seg;
        if (i < g.R) { st.flash.set(i * 100 + b.cum[i] + 1, 1); sound.peg(i); }
        else { b.done = true; land(b); break; }
        b.seg++;
      }
      if (b.done) continue;
      const i = b.seg, a = point(g, i - 1, b.cum), z = point(g, i, b.cum), t2 = Math.min(1, b.t);
      let x, y;
      if (i === 0) { x = a.x + b.jitter * g.s * (1 - ease.inQuad(t2)); y = a.y + (z.y - a.y) * ease.inQuad(t2); }
      else {
        x = a.x + (z.x - a.x) * ease.inOutCubic(t2);
        y = a.y + (z.y - a.y) * t2 - g.dy * b.hop[i - 1] * 4 * t2 * (1 - t2);
      }
      b.trail.push(x, y); if (b.trail.length > 16) b.trail.splice(0, 2);
      for (let q = 0; q < b.trail.length; q += 2) {
        const f = q / b.trail.length;
        ctx.fillStyle = alpha('#ff3d81', f * 0.35);
        ctx.beginPath(); ctx.arc(b.trail[q], b.trail[q + 1], g.ballR * (0.35 + f * 0.6), 0, 7); ctx.fill();
      }
      glow(ctx, x, y, g.ballR * 3, '#ff3d81', 0.35);
      const grd = ctx.createRadialGradient(x - g.ballR * 0.35, y - g.ballR * 0.4, g.ballR * 0.1, x, y, g.ballR);
      grd.addColorStop(0, '#fff0f6'); grd.addColorStop(0.35, '#ff7aa8'); grd.addColorStop(1, '#d1124f');
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(x, y, g.ballR, 0, 7); ctx.fill();
    }
    st.balls = st.balls.filter((b) => !b.done);
  });
}
