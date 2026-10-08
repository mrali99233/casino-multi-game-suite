// Wheel client: 30-segment wheel with chase lights, spring pointer and result celebration.
import { fmtMult } from '../sdk/api.js';
import { alpha, clamp, ease, glow, rand, starfield, tween } from '../sdk/fx.js';

export const rules = `
<p>Spin the wheel. It stops on one of 30 equal segments and pays that segment's multiplier.</p>
<p>Each segment has a 1 in 30 chance. Risk changes the layout: <b>Low</b> pays often with small multipliers, <b>High</b> has a single jackpot segment and 29 empty ones.</p>`;

const TAU = Math.PI * 2;

export function segColor(m) {
  if (m <= 0) return ['#20244c', '#5d6299'];
  if (m < 1.5) return ['#2f6bff', '#eaf0ff'];
  if (m < 2) return ['#16b9d6', '#04121a'];
  if (m < 3) return ['#8b5cf6', '#f4efff'];
  if (m < 6) return ['#ffc53d', '#2b1400'];
  return ['#ff3d81', '#ffffff'];
}

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const data = init.game.data, N = data.segments, SEG = TAU / N;
  const st = { risk: 'medium', angle: 0, spinning: false, result: null, glowT: 0, pointer: 0, pointerV: 0, lastSeg: -1, bulbsWin: 0, hubPop: 0 };
  const table = () => data.tables[st.risk];

  const mode = ui.segmented(null, [['manual', 'Manual'], ['auto', 'Auto']], 'manual', (v) => { autoBox.hidden = v !== 'auto'; syncBtn(); });
  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const risk = ui.segmented('Risk', data.risks.map((r) => [r, r[0].toUpperCase() + r.slice(1)]), st.risk, (v) => { st.risk = v; st.result = null; legend(); });
  const auto = ui.autoPanel(money);
  const autoBox = h('div', { hidden: true }, auto.el);
  const btn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Spin');
  const legendBox = h('div', { class: 'legend' });
  shell.controls.append(mode.el, amount.el, risk.el, autoBox, btn, h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Payouts', h('em', {}, 'segments of 30')), legendBox));
  document.head.append(h('style', {}, `
    .legend { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
    .legend .lg { display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 7px 9px; border-radius: 9px; background: var(--bg-0); border: 1px solid var(--line); font-variant-numeric: tabular-nums; font-size: 12px; }
    .legend .lg i { width: 10px; height: 10px; border-radius: 3px; flex: none; }
    .legend .lg b { font-family: var(--f-display); font-size: 14px; }
    .legend .lg span { color: var(--muted); }
    .legend .lg.hit { border-color: var(--gold); box-shadow: 0 0 0 2px rgba(255,197,61,.2); }
  `));

  function legend(hitMult) {
    const counts = new Map();
    table().forEach((m) => counts.set(m, (counts.get(m) || 0) + 1));
    legendBox.replaceChildren(...[...counts.entries()].sort((a, b) => a[0] - b[0]).map(([m, c]) =>
      h('div', { class: `lg ${hitMult === m ? 'hit' : ''}` }, h('i', { style: `background:${segColor(m / 100)[0]}` }), h('b', {}, fmtMult(m / 100)), h('span', {}, `${c}/30`))));
  }
  legend();

  function syncBtn() {
    if (mode.value === 'auto') { btn.textContent = auto.running ? 'Stop auto' : 'Start auto'; btn.className = `btn ${auto.running ? 'btn-cancel' : 'btn-bet'}`; btn.disabled = false; }
    else { btn.textContent = st.spinning ? 'Spinning…' : 'Spin'; btn.className = 'btn btn-bet'; btn.disabled = st.spinning; }
    risk.disabled = st.spinning || auto.running;
  }

  async function spin() {
    if (st.spinning) return null;
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return null; }
    st.spinning = true; st.result = null; syncBtn(); legend();
    sound.bet();
    let r;
    try { r = await api.bet(bet, { risk: st.risk }); } catch (e) { ui.toast(e.message, 'err'); st.spinning = false; syncBtn(); return null; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    const idx = r.result.segment;
    const jitter = rand(-0.32, 0.32);
    const cur = ((st.angle % TAU) + TAU) % TAU;
    const want = (((-(idx + 0.5 + jitter) * SEG - cur) % TAU) + TAU) % TAU;
    const turns = 5 + Math.floor(rand(0, 2));
    const target = st.angle + want + turns * TAU;
    const over = SEG * rand(0.25, 0.45);
    sound.whoosh();
    await tween(st, { angle: target + over }, { dur: 4.1, ease: ease.outQuart });
    await tween(st, { angle: target }, { dur: 0.55, ease: ease.inOutCubic });
    st.spinning = false; st.result = idx; st.glowT = 1; st.hubPop = 0;
    tween(st, { hubPop: 1 }, { dur: 0.6, ease: ease.outElastic });
    const mult = r.multiplier, W = stage.w, H = stage.h, R = radius();
    shell.wallet.release(r.payout);
    ui.pushResult(shell.strip, mult);
    legend(Math.round(mult * 100));
    if (mult > 0) {
      st.bulbsWin = 1.6;
      stage.particles.spark(W / 2, H / 2 + 8 - R, { count: 40, color: segColor(mult)[0], speed: 320, angle: -Math.PI / 2, spread: 2.2 });
      stage.particles.text(W / 2, H / 2 + 8 - R * 0.55, `+${money.fmt(r.payout)}`, { color: '#1fe58f', size: 22, rise: 46 });
      if (mult >= 2) stage.particles.confetti(W / 2, H * 0.4, { count: mult >= 5 ? 120 : 60 });
      sound.win(mult >= 5 ? 2 : 1);
      if (mult >= 10) { stage.shake(6, 0.4); ui.bigWin(shell, stage, { mult, amount: r.payout, money }); }
    } else sound.lose();
    syncBtn();
    return r;
  }

  btn.addEventListener('click', () => {
    if (mode.value === 'manual') { spin(); return; }
    if (auto.running) { auto.stop(); return; }
    auto.run(spin, { delay: 0.6, onState: syncBtn });
    syncBtn();
  });

  // ---------- render ----------
  const radius = () => Math.min(stage.w, stage.h - 70) * 0.42;
  const stars = starfield(60);
  stage.draw((ctx, dt, W, H, t) => {
    stars(ctx, dt, W, H, t);
    const R = radius(), cx = W / 2, cy = H / 2 + 18, tbl = table();
    st.glowT = Math.max(0, st.glowT - dt * 0.6);
    st.bulbsWin = Math.max(0, st.bulbsWin - dt);

    // pointer spring: kicked whenever a segment boundary passes the top
    const segNow = Math.floor((((-st.angle) % TAU) + TAU) % TAU / SEG);
    if (segNow !== st.lastSeg) { if (st.spinning) { st.pointerV -= 9; sound.tick(1.1); } st.lastSeg = segNow; }
    st.pointerV += (-st.pointer * 160 - st.pointerV * 12) * dt;
    st.pointer = clamp(st.pointer + st.pointerV * dt, -0.6, 0.15);

    glow(ctx, cx, cy, R * 1.6, '#8b5cf6', 0.22);
    // drop shadow & rim
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(cx, cy + 10, R + 22, 0, TAU); ctx.fill();
    const rim = ctx.createLinearGradient(cx, cy - R, cx, cy + R);
    rim.addColorStop(0, '#5a4bd6'); rim.addColorStop(0.5, '#262a6a'); rim.addColorStop(1, '#3b2e9e');
    ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(cx, cy, R + 20, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R + 19, 0, TAU); ctx.stroke();

    // bulbs
    const bulbs = 30, chase = st.spinning ? t * 18 : t * 3;
    for (let i = 0; i < bulbs; i++) {
      const a = (i / bulbs) * TAU, on = st.bulbsWin > 0 ? Math.floor(t * 8) % 2 === i % 2 : (i + Math.floor(chase)) % 5 === 0;
      const bx = cx + Math.cos(a) * (R + 10), by = cy + Math.sin(a) * (R + 10);
      if (on) glow(ctx, bx, by, 9, '#ffc53d', 0.8);
      ctx.fillStyle = on ? '#fff3c4' : 'rgba(255,197,61,0.25)';
      ctx.beginPath(); ctx.arc(bx, by, 3, 0, TAU); ctx.fill();
    }

    // segments
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(st.angle);
    for (let i = 0; i < N; i++) {
      const a0 = -Math.PI / 2 + i * SEG, m = tbl[i] / 100, [bg, fg] = segColor(m);
      const g = ctx.createRadialGradient(0, 0, R * 0.25, 0, 0, R);
      g.addColorStop(0, alpha(bg.length === 7 ? bg : '#20244c', 0.55)); g.addColorStop(1, bg);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a0 + SEG); ctx.closePath(); ctx.fill();
      if (st.result === i && !st.spinning) {
        ctx.fillStyle = `rgba(255,255,255,${0.18 + 0.22 * Math.abs(Math.sin(t * 5))})`; ctx.fill();
      }
      ctx.strokeStyle = 'rgba(7,8,26,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
      if (R > 110) {
        ctx.save(); ctx.rotate(a0 + SEG / 2);
        ctx.fillStyle = fg; ctx.font = `700 ${Math.max(9, R * 0.052)}px "Chakra Petch", sans-serif`;
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(m > 0 ? fmtMult(m) : '0', R - 10, 0);
        ctx.restore();
      }
    }
    // gloss
    const gloss = ctx.createLinearGradient(0, -R, 0, R);
    gloss.addColorStop(0, 'rgba(255,255,255,0.14)'); gloss.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.restore();
    ctx.fillStyle = gloss; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();

    // hub
    const hr = R * 0.27;
    const hg = ctx.createRadialGradient(cx - hr * 0.3, cy - hr * 0.4, hr * 0.1, cx, cy, hr);
    hg.addColorStop(0, '#2c3180'); hg.addColorStop(1, '#0d0f27');
    ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(cx, cy, hr, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffc53d'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (st.result !== null && !st.spinning) {
      const m = tbl[st.result] / 100, s = 0.6 + 0.4 * st.hubPop;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
      ctx.fillStyle = m > 0 ? '#1fe58f' : '#ff4766'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 18;
      ctx.font = `700 ${hr * 0.5}px "Chakra Petch", sans-serif`; ctx.fillText(fmtMult(m), 0, 0);
      ctx.restore(); ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = '#ffc53d'; ctx.font = `700 ${hr * 0.42}px "Chakra Petch", sans-serif`; ctx.fillText('CM', cx, cy);
    }

    // pointer (pivot above the wheel)
    const px = cx, py = cy - R - 24;
    ctx.save(); ctx.translate(px, py); ctx.rotate(st.pointer);
    glow(ctx, 0, 18, 26, '#ff3d81', 0.45);
    ctx.fillStyle = '#ff3d81';
    ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(13, 0); ctx.lineTo(0, 38); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.moveTo(-13, 0); ctx.lineTo(0, 0); ctx.lineTo(0, 38); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 4, 5, 0, TAU); ctx.fill();
    ctx.restore();
  });
}
