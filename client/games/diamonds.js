// Diamonds client: five faceted gems drop onto pedestals; matching colours light up.
import { fmtMult } from '../sdk/api.js';
import { alpha, clamp, ease, glow, starfield, tween } from '../sdk/fx.js';

export const rules = `
<p>Five gems are drawn, each one of seven colours with equal chance. Your payout depends on how the colours match, like a poker hand: five of a kind, four of a kind, full house, three of a kind, two pair, one pair.</p>
<p>The odds of every pattern are computed exactly over all 16,807 possible draws.</p>`;

const GEM_COLORS = ['#ff4766', '#ff8a1f', '#ffc53d', '#1fe58f', '#22d3ee', '#8b5cf6', '#ff3d81'];
const NAMES = { five: 'Five of a kind', four: 'Four of a kind', full: 'Full house', three: 'Three of a kind', two_pair: 'Two pair', pair: 'Pair', none: 'No match' };
const ORDER = ['five', 'four', 'full', 'three', 'two_pair', 'pair', 'none'];

export function drawGem(ctx, x, y, s, color, lit = 0) {
  if (lit > 0) glow(ctx, x, y, s * 1.6, color, 0.55 * lit);
  ctx.save(); ctx.translate(x, y);
  const top = -s * 0.55, girdle = -s * 0.12, bottom = s * 0.62, w = s * 0.62, tw = s * 0.36;
  const g = ctx.createLinearGradient(-w, top, w, bottom);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, color); g.addColorStop(1, alpha(color, 0.75));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(-tw, top); ctx.lineTo(tw, top); ctx.lineTo(w, girdle); ctx.lineTo(0, bottom); ctx.lineTo(-w, girdle); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-w, girdle); ctx.lineTo(w, girdle); ctx.moveTo(-tw, top); ctx.lineTo(-tw * 0.4, girdle); ctx.lineTo(0, bottom); ctx.lineTo(tw * 0.4, girdle); ctx.lineTo(tw, top); ctx.moveTo(-tw * 0.4, girdle); ctx.lineTo(0, top); ctx.lineTo(tw * 0.4, girdle); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath(); ctx.moveTo(-tw * 0.85, top + 2); ctx.lineTo(-tw * 0.2, top + 2); ctx.lineTo(-tw * 0.55, girdle - 2); ctx.closePath(); ctx.fill();
  ctx.restore();
}

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const pt = init.game.data.paytable, odds = init.game.data.odds;
  const st = { gems: [], pattern: null, busy: false };

  const mode = ui.segmented(null, [['manual', 'Manual'], ['auto', 'Auto']], 'manual', (v) => { autoBox.hidden = v !== 'auto'; syncBtn(); });
  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const auto = ui.autoPanel(money);
  const autoBox = h('div', { hidden: true }, auto.el);
  const btn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Bet');
  const table = h('div', { class: 'paytable' }, ORDER.map((p) => h('div', { class: 'pr', 'data-p': p }, h('span', {}, NAMES[p]), h('em', {}, `${(odds[p] * 100).toFixed(2)}%`), h('b', {}, fmtMult(pt[p] / 100)))));
  shell.controls.append(mode.el, amount.el, autoBox, btn, h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Payouts', h('em', {}, 'chance')), table));
  document.head.append(h('style', {}, `
    .paytable { display: grid; gap: 4px; }
    .paytable .pr { display: grid; grid-template-columns: minmax(0, 1fr) auto 64px; gap: 10px; align-items: center; padding: 7px 10px; border-radius: 9px; background: var(--bg-0); border: 1px solid var(--line); font-size: 13px; transition: all .25s; }
    .paytable .pr em { font-style: normal; color: var(--dim); font-variant-numeric: tabular-nums; font-size: 12px; }
    .paytable .pr b { font-family: var(--f-display); text-align: right; }
    .paytable .pr.hit { border-color: var(--gold); background: rgba(255,197,61,.1); transform: translateX(4px); }
    .paytable .pr.hit b { color: var(--gold); }
  `));

  function syncBtn() {
    if (mode.value === 'auto') { btn.textContent = auto.running ? 'Stop auto' : 'Start auto'; btn.className = `btn ${auto.running ? 'btn-cancel' : 'btn-bet'}`; btn.disabled = false; }
    else { btn.textContent = 'Bet'; btn.className = 'btn btn-bet'; btn.disabled = st.busy; }
  }

  async function play() {
    if (st.busy) return null;
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return null; }
    st.busy = true; syncBtn(); sound.bet();
    let r;
    try { r = await api.bet(bet, {}); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; syncBtn(); return null; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    table.querySelectorAll('.pr').forEach((el) => el.classList.remove('hit'));
    const counts = {};
    r.result.gems.forEach((g) => { counts[g] = (counts[g] || 0) + 1; });
    st.pattern = null;
    st.gems = r.result.gems.map((c) => ({ c, y: -1.4, lit: 0, match: counts[c] > 1, scale: 1 }));
    await Promise.all(st.gems.map((g, i) => tween(g, { y: 0 }, { dur: 0.45, delay: i * 0.12, ease: ease.outBounce }).then(() => sound.tick(1 + i * 0.12))));
    st.pattern = r.result.pattern;
    st.gems.forEach((g) => { if (g.match) { tween(g, { lit: 1 }, { dur: 0.3 }); tween(g, { scale: 1.15 }, { dur: 0.35, ease: ease.outBack }); } });
    table.querySelector(`[data-p="${st.pattern}"]`).classList.add('hit');
    const W = stage.w, H = stage.h;
    if (r.payout > r.bet) {
      sound.win(r.multiplier >= 4 ? 2 : 1);
      stage.particles.confetti(W / 2, H * 0.45, { count: r.multiplier >= 4 ? 90 : 40, colors: GEM_COLORS });
      if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
    } else if (r.payout > 0) sound.land(1); else sound.lose();
    shell.wallet.release(r.payout);
    ui.pushResult(shell.strip, r.multiplier, r.payout >= r.bet ? 'win' : 'loss');
    st.busy = false; syncBtn();
    return r;
  }

  btn.addEventListener('click', () => {
    if (mode.value === 'manual') { play(); return; }
    if (auto.running) { auto.stop(); return; }
    auto.run(play, { delay: 0.5, onState: syncBtn });
    syncBtn();
  });

  const stars = starfield(80);
  stage.draw((ctx, dt, W, H, t) => {
    stars(ctx, dt, W, H, t);
    const n = 5, gap = Math.min(W / (n + 0.6), 150), s = clamp(gap * 0.42, 26, 62);
    const y0 = H * 0.5;
    glow(ctx, W / 2, y0, Math.max(W, H) * 0.45, '#8b5cf6', 0.15);
    for (let i = 0; i < n; i++) {
      const x = W / 2 + (i - 2) * gap;
      // pedestal
      const pg = ctx.createLinearGradient(0, y0 + s * 0.7, 0, y0 + s * 1.6);
      pg.addColorStop(0, '#2c3180'); pg.addColorStop(1, '#141737');
      ctx.fillStyle = pg; ctx.beginPath(); ctx.ellipse(x, y0 + s * 0.85, s * 0.95, s * 0.28, 0, 0, 7); ctx.fill();
      ctx.fillRect(x - s * 0.95, y0 + s * 0.85, s * 1.9, s * 0.55);
      ctx.fillStyle = '#3a3f94'; ctx.beginPath(); ctx.ellipse(x, y0 + s * 0.85, s * 0.95, s * 0.28, 0, 0, 7); ctx.fill();
      const g = st.gems[i];
      if (g) {
        const bob = g.lit ? Math.sin(t * 4 + i) * 3 : 0;
        ctx.save(); ctx.translate(x, y0 + g.y * H * 0.5 + bob); ctx.scale(g.scale, g.scale);
        drawGem(ctx, 0, 0, s, GEM_COLORS[g.c], g.lit);
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(141,150,255,.25)'; ctx.font = `700 ${s * 0.6}px "Chakra Petch", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('?', x, y0);
      }
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${clamp(W / 22, 20, 36)}px "Chakra Petch", sans-serif`;
    if (st.pattern) {
      const m = pt[st.pattern] / 100;
      ctx.fillStyle = m >= 1 ? '#ffc53d' : m > 0 ? '#b8bfff' : '#ff4766';
      ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 18;
      ctx.fillText(`${NAMES[st.pattern].toUpperCase()}  ${fmtMult(m)}`, W / 2, H * 0.2);
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = 'rgba(241,242,255,.8)'; ctx.fillText(st.busy ? 'DRAWING…' : 'MATCH THE GEMS', W / 2, H * 0.2);
    }
  });
}
