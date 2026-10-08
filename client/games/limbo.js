// Limbo client: the drawn multiplier rockets up from 1.00× and either clears the target or not.
import { fmtMult } from '../sdk/api.js';
import { clamp, ease, glow, rand, starfield, tween } from '../sdk/fx.js';

export const rules = `
<p>Set a target multiplier and place your bet. The game draws a result multiplier; if it reaches your target you win bet × target.</p>
<p>The chance of reaching target <b>T</b> is RTP ÷ T, so higher targets are rarer and pay more. Results use the same law as Aviator: result = RTP ÷ (1 − r).</p>`;

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const rtp = init.game.rtp;
  const st = { shown: 1, target: 2, phase: 'idle', win: null, warp: 0, rolling: false };

  const mode = ui.segmented(null, [['manual', 'Manual'], ['auto', 'Auto']], 'manual', (v) => { autoBox.hidden = v !== 'auto'; syncBtn(); });
  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const target = ui.numberField('Target multiplier', { value: '2.00', suffix: '×', hint: '1.01 – 1,000,000' });
  const chance = ui.numberField('Win chance', { value: '', suffix: '%' });
  const auto = ui.autoPanel(money);
  const autoBox = h('div', { hidden: true }, auto.el);
  const btn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Bet');
  const info = ui.stats([['profit', 'Profit on win'], ['rtp', 'RTP']]);
  shell.controls.append(mode.el, amount.el, target.el, chance.el, autoBox, btn, info.el);
  info.set('rtp', `${(rtp * 100).toFixed(2)}%`);

  function sync(from) {
    if (from !== 'chance') {
      const t = clamp(target.value || 2, 1.01, 1e6);
      st.target = Math.round(t * 100) / 100;
      chance.value = (Math.min(1, rtp / st.target) * 100).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    } else {
      const c = clamp(chance.value || 49.5, 0.0001, rtp * 100 / 1.01);
      st.target = Math.max(1.01, Math.round((rtp / (c / 100)) * 100) / 100);
      target.value = st.target.toFixed(2);
    }
    info.set('profit', money.fmt(Math.floor(amount.value * st.target) - amount.value));
  }
  target.input.addEventListener('change', () => { sync('target'); target.value = st.target.toFixed(2); });
  chance.input.addEventListener('change', () => sync('chance'));
  amount.el.addEventListener('click', () => setTimeout(sync));
  amount.el.addEventListener('input', () => sync());
  sync();

  function syncBtn() {
    if (mode.value === 'auto') { btn.textContent = auto.running ? 'Stop auto' : 'Start auto'; btn.className = `btn ${auto.running ? 'btn-cancel' : 'btn-bet'}`; btn.disabled = false; }
    else { btn.textContent = 'Bet'; btn.className = 'btn btn-bet'; btn.disabled = st.rolling; }
    target.disabled = auto.running; chance.disabled = auto.running;
  }

  async function play() {
    if (st.rolling) return null;
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return null; }
    st.rolling = true; syncBtn(); sound.bet();
    let r;
    try { r = await api.bet(bet, { target: st.target }); } catch (e) { ui.toast(e.message, 'err'); st.rolling = false; syncBtn(); return null; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    const result = r.result.result;
    st.phase = 'rolling'; st.win = null; st.shown = 1;
    const dur = clamp(0.45 + Math.log10(result) * 0.35, 0.45, 1.5);
    const box = { k: 0 };
    sound.whoosh();
    await tween(box, { k: 1 }, { dur, ease: ease.outQuart, onUpdate: () => { st.shown = Math.exp(Math.log(result) * box.k); st.warp = 1 - box.k; } });
    st.shown = result; st.phase = 'done'; st.win = r.result.win;
    const cx = stage.w / 2, cy = stage.h * 0.44;
    if (st.win) {
      sound.win(st.target >= 10 ? 2 : 1);
      stage.particles.spark(cx, cy, { count: 50, color: '#1fe58f', speed: 380 });
      stage.particles.ring(cx, cy, { color: '#1fe58f', r0: 20, r1: 180, life: 0.6, width: 4 });
      if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
    } else {
      sound.lose();
      stage.particles.spark(cx, cy, { count: 18, color: '#ff4766', speed: 200 });
    }
    shell.wallet.release(r.payout);
    ui.pushResult(shell.strip, result, st.win ? 'win' : 'loss');
    st.rolling = false; syncBtn();
    return r;
  }

  btn.addEventListener('click', () => {
    if (mode.value === 'manual') { play(); return; }
    if (auto.running) { auto.stop(); return; }
    auto.run(play, { delay: 0.35, onState: syncBtn });
    syncBtn();
  });

  const stars = starfield(120);
  const streaks = Array.from({ length: 50 }, () => ({ a: rand(0, Math.PI * 2), d: rand(0, 1), s: rand(0.5, 1.4) }));
  stage.draw((ctx, dt, W, H, t) => {
    stars(ctx, dt, W, H, t);
    const cx = W / 2, cy = H * 0.44;
    const col = st.phase === 'done' ? (st.win ? '#1fe58f' : '#ff4766') : '#8b5cf6';
    glow(ctx, cx, cy, Math.max(W, H) * 0.42, col, st.phase === 'done' ? 0.22 : 0.16);
    // warp streaks while rolling
    if (st.phase === 'rolling') {
      ctx.lineCap = 'round';
      for (const s of streaks) {
        s.d += dt * s.s * (1.2 + st.warp * 2.5);
        if (s.d > 1) { s.d = 0; s.a = rand(0, Math.PI * 2); }
        const r0 = 30 + s.d * Math.max(W, H) * 0.6, r1 = r0 + 30 + st.warp * 70;
        ctx.strokeStyle = `rgba(180,190,255,${0.5 * (1 - s.d)})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0); ctx.lineTo(cx + Math.cos(s.a) * r1, cy + Math.sin(s.a) * r1); ctx.stroke();
      }
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const big = clamp(W / 6, 56, 150);
    ctx.font = `700 ${big}px "Chakra Petch", sans-serif`;
    ctx.fillStyle = st.phase === 'done' ? col : '#ffffff';
    ctx.shadowColor = st.phase === 'done' ? col : 'rgba(255,255,255,.6)'; ctx.shadowBlur = 30;
    const text = st.shown >= 1e5 ? `${Math.round(st.shown).toLocaleString()}×` : `${st.shown.toFixed(2)}×`;
    ctx.fillText(text, cx, cy);
    ctx.shadowBlur = 0;
    ctx.font = `600 ${clamp(W / 40, 14, 20)}px "Outfit", sans-serif`;
    ctx.fillStyle = 'rgba(141,150,255,0.9)';
    ctx.fillText(`Target ${fmtMult(st.target)}  ·  chance ${(Math.min(1, rtp / st.target) * 100).toFixed(2)}%`, cx, cy + big * 0.7);
  });
}
