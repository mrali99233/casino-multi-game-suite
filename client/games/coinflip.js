// Coin Flip client: a 3D-looking coin tossed in an arc, landing on the server's side.
import { fmtMult } from '../sdk/api.js';
import { clamp, ease, glow, starfield, tween } from '../sdk/fx.js';

export const rules = `
<p>Call heads or tails and flip. A correct call pays bet × 2 × RTP (1.96× at 98% RTP); a wrong call loses the bet.</p>
<p>Each side has exactly a 50% chance: heads when the round's first float is below 0.5.</p>`;

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const pay = init.game.data.multiplier;
  const st = { angle: 0, lift: 0, flipping: false, side: 'heads', result: null, glowT: 0, streak: 0 };

  const mode = ui.segmented(null, [['manual', 'Manual'], ['auto', 'Auto']], 'manual', (v) => { autoBox.hidden = v !== 'auto'; syncBtn(); });
  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const side = ui.segmented('Your call', [['heads', 'Heads'], ['tails', 'Tails']], 'heads', (v) => { st.side = v; });
  const auto = ui.autoPanel(money);
  const autoBox = h('div', { hidden: true }, auto.el);
  const btn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Flip coin');
  const info = ui.stats([['pay', 'Pays'], ['streak', 'Win streak']]);
  shell.controls.append(mode.el, amount.el, side.el, autoBox, btn, info.el);
  info.set('pay', fmtMult(pay)); info.set('streak', '0');

  function syncBtn() {
    if (mode.value === 'auto') { btn.textContent = auto.running ? 'Stop auto' : 'Start auto'; btn.className = `btn ${auto.running ? 'btn-cancel' : 'btn-bet'}`; btn.disabled = false; }
    else { btn.textContent = st.flipping ? 'Flipping…' : 'Flip coin'; btn.className = 'btn btn-bet'; btn.disabled = st.flipping; }
    side.disabled = st.flipping;
  }

  async function flip() {
    if (st.flipping) return null;
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return null; }
    st.flipping = true; st.result = null; syncBtn(); sound.bet();
    let r;
    try { r = await api.bet(bet, { side: st.side }); } catch (e) { ui.toast(e.message, 'err'); st.flipping = false; syncBtn(); return null; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    // angle 0 = heads up, PI = tails up; add full turns so the coin spins visibly
    const base = Math.ceil(st.angle / (Math.PI * 2)) * Math.PI * 2;
    const end = base + Math.PI * 2 * 5 + (r.result.side === 'tails' ? Math.PI : 0);
    sound.whoosh();
    const box = { k: 0 };
    const from = st.angle;
    await tween(box, { k: 1 }, { dur: 1.35, ease: ease.linear, onUpdate: () => {
      st.angle = from + (end - from) * ease.outCubic(box.k);
      st.lift = Math.sin(Math.PI * box.k) * (1 - 0.15 * box.k);
    } });
    st.angle = end; st.lift = 0; st.result = r.result;
    sound.land(r.result.win ? 2 : 0);
    stage.shake(3, 0.2);
    const cx = stage.w / 2, cy = stage.h * 0.55;
    if (r.result.win) {
      st.streak++; st.glowT = 1;
      sound.win(1);
      stage.particles.spark(cx, cy, { count: 40, color: '#ffc53d', speed: 320 });
      stage.particles.text(cx, cy - 90, `+${money.fmt(r.payout)}`, { color: '#1fe58f', size: 26 });
    } else { st.streak = 0; sound.lose(); }
    info.set('streak', String(st.streak));
    shell.wallet.release(r.payout);
    ui.pushResult(shell.strip, r.multiplier, r.result.win ? 'win' : 'loss');
    st.flipping = false; syncBtn();
    return r;
  }

  btn.addEventListener('click', () => {
    if (mode.value === 'manual') { flip(); return; }
    if (auto.running) { auto.stop(); return; }
    auto.run(flip, { delay: 0.3, onState: syncBtn });
    syncBtn();
  });

  function face(ctx, R, heads) {
    const g = ctx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R);
    if (heads) { g.addColorStop(0, '#fff6c8'); g.addColorStop(0.5, '#ffc53d'); g.addColorStop(1, '#b8740c'); }
    else { g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, '#b9c2e8'); g.addColorStop(1, '#5b6496'); }
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
    ctx.strokeStyle = heads ? 'rgba(120,70,0,.55)' : 'rgba(40,45,90,.55)'; ctx.lineWidth = R * 0.06;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.82, 0, 7); ctx.stroke();
    for (let i = 0; i < 36; i++) { const a = (i / 36) * Math.PI * 2; ctx.fillStyle = heads ? 'rgba(120,70,0,.35)' : 'rgba(40,45,90,.35)'; ctx.fillRect(Math.cos(a) * R * 0.91 - 1, Math.sin(a) * R * 0.91 - 1, 2, 2); }
    ctx.fillStyle = heads ? '#8a5200' : '#2c3366';
    ctx.font = `700 ${R * 0.9}px "Chakra Petch", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(heads ? 'H' : 'T', 0, R * 0.04);
  }

  const stars = starfield(70);
  stage.draw((ctx, dt, W, H, t) => {
    stars(ctx, dt, W, H, t);
    st.glowT = Math.max(0, st.glowT - dt * 0.7);
    const R = clamp(Math.min(W, H) * 0.2, 60, 130);
    const cx = W / 2, floor = H * 0.62, cy = floor - st.lift * H * 0.38;
    glow(ctx, cx, floor, R * 2.4, '#8b5cf6', 0.18);
    if (st.glowT > 0) glow(ctx, cx, floor, R * 2.2, '#ffc53d', 0.4 * st.glowT);
    // shadow
    const sh = 1 - st.lift * 0.6;
    ctx.fillStyle = `rgba(0,0,0,${0.45 * sh})`; ctx.beginPath(); ctx.ellipse(cx, floor + R * 1.05, R * sh, R * 0.18 * sh, 0, 0, 7); ctx.fill();
    // coin: scale Y by cos(angle) to fake rotation around the horizontal axis
    const c = Math.cos(st.angle), heads = c >= 0;
    const sy = Math.max(0.04, Math.abs(c));
    ctx.save(); ctx.translate(cx, cy);
    // edge thickness
    ctx.fillStyle = heads ? '#9a5f08' : '#454d7d';
    ctx.beginPath(); ctx.ellipse(0, R * 0.09 * (1 - sy), R, R * sy, 0, 0, 7); ctx.fill();
    ctx.scale(1, sy);
    face(ctx, R, heads);
    ctx.restore();
    // labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `700 ${clamp(W / 24, 18, 30)}px "Chakra Petch", sans-serif`;
    if (st.result && !st.flipping) {
      ctx.fillStyle = st.result.win ? '#1fe58f' : '#ff4766';
      ctx.fillText(`${st.result.side.toUpperCase()} · ${st.result.win ? 'YOU WIN' : 'YOU LOSE'}`, cx, H * 0.16);
    } else {
      ctx.fillStyle = 'rgba(241,242,255,.85)';
      ctx.fillText(st.flipping ? 'FLIPPING…' : `CALL ${st.side.toUpperCase()}`, cx, H * 0.16);
    }
  });
}
