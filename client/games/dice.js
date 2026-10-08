// Dice client: draggable target on a 0–100 track, rolling counter and sliding result marker.
import { fmtMult } from '../sdk/api.js';
import { ease, glow, starfield, tween } from '../sdk/fx.js';

export const rules = `
<p>Pick a target and whether the roll must land <b>over</b> or <b>under</b> it. The roll is a number from 0.00 to 100.00 with 10,001 equally likely values.</p>
<p>Your multiplier is set by your win chance: multiplier = RTP ÷ chance. Lower chance, bigger payout. Win chance can be anything from 1% to 98%.</p>`;

const OUTCOMES = 10001;

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const rtp = init.game.rtp;
  const st = { target: 50.5, condition: 'over', last: null, rolling: false };

  const winCount = () => { const t = Math.round(st.target * 100); return st.condition === 'under' ? t : 10000 - t; };
  const chance = () => winCount() / OUTCOMES;
  const mult = () => Math.floor((rtp * OUTCOMES) / winCount() * 100 + 1e-9) / 100;
  const clampTarget = (t, cond = st.condition) => {
    // keep win chance within 1%..98% (100..9800 winning outcomes)
    const lo = cond === 'under' ? 1.0 : 2.0, hi = cond === 'under' ? 98.0 : 99.0;
    return Math.min(hi, Math.max(lo, Math.round(t * 100) / 100));
  };

  document.head.append(h('style', {}, `
    .dice { position: absolute; inset: 52px 16px 16px; display: grid; grid-template-rows: minmax(0, 1fr) auto auto; gap: clamp(8px, 2.5vh, 22px); align-content: center; max-width: 760px; margin: 0 auto; z-index: 1; }
    .dice .readout { display: grid; place-items: center; text-align: center; }
    .dice .roll { font-family: var(--f-display); font-weight: 700; font-size: clamp(64px, 12vw, 132px); line-height: 1; font-variant-numeric: tabular-nums; color: var(--text); text-shadow: 0 0 30px rgba(139,92,246,.5); transition: color .2s, text-shadow .2s; }
    .dice .roll.win { color: var(--green); text-shadow: 0 0 34px rgba(31,229,143,.6); }
    .dice .roll.loss { color: var(--red); text-shadow: 0 0 34px rgba(255,71,102,.5); }
    .dice .sub { color: var(--muted); font-weight: 600; margin-top: 8px; min-height: 20px; }
    .track-wrap { position: relative; padding: 46px 6px 26px; }
    .track { position: relative; height: 14px; border-radius: 999px; background: var(--bg-3); box-shadow: inset 0 2px 4px rgba(0,0,0,.5), 0 0 0 6px rgba(20,23,55,.9); }
    .track .zone { position: absolute; top: 0; bottom: 0; border-radius: 999px; transition: left .15s, width .15s; }
    .track .lose { background: linear-gradient(180deg, #ff6e86, var(--red)); }
    .track .win { background: linear-gradient(180deg, #5dffb6, var(--green)); box-shadow: 0 0 18px rgba(31,229,143,.45); }
    .track input[type=range] { position: absolute; inset: -14px 0; width: 100%; margin: 0; appearance: none; background: transparent; cursor: ew-resize; }
    .track input[type=range]::-webkit-slider-thumb { appearance: none; width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(180deg, #fff, #c9ccff); border: 3px solid var(--violet); box-shadow: 0 4px 14px rgba(0,0,0,.5); }
    .track input[type=range]::-moz-range-thumb { width: 30px; height: 30px; border-radius: 10px; background: linear-gradient(180deg, #fff, #c9ccff); border: 3px solid var(--violet); }
    .scale { display: flex; justify-content: space-between; margin-top: 16px; color: var(--dim); font-family: var(--f-display); font-size: 12px; }
    .marker { position: absolute; top: -2px; width: 0; transform: translateX(0); transition: left .55s cubic-bezier(.2,1.25,.35,1), opacity .2s; opacity: 0; pointer-events: none; }
    .marker .hex { position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); padding: 6px 10px; border-radius: 10px; font-family: var(--f-display); font-weight: 700; font-size: 15px; background: var(--bg-4); border: 2px solid var(--violet-2); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .marker .hex::after { content: ""; position: absolute; left: 50%; bottom: -8px; transform: translateX(-50%); border: 6px solid transparent; border-top-color: inherit; }
    .marker.win .hex { background: #0f3b2a; border-color: var(--green); color: var(--green); }
    .marker.loss .hex { background: #3b0f1b; border-color: var(--red); color: #ffb3c0; }
    .dice-fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .dice-fields .input input { font-size: 15px; }
    .flip { border: 0; background: var(--bg-3); color: var(--muted); padding: 0 10px; border-left: 1px solid var(--line); }
    .flip:hover { color: var(--text); }
    @media (max-width: 560px) { .dice-fields { grid-template-columns: 1fr 1fr; } .dice-fields .field:last-child { grid-column: span 2; } }
  `));

  // ---------- stage DOM ----------
  const rollEl = h('div', { class: 'roll', 'aria-live': 'polite' }, '50.50');
  const subEl = h('div', { class: 'sub' }, 'Drag the slider to set your odds');
  const lose = h('div', { class: 'zone lose' }), win = h('div', { class: 'zone win' });
  const range = h('input', { type: 'range', min: '0', max: '100', step: '0.01', value: String(st.target), 'aria-label': 'Target' });
  const hex = h('div', { class: 'hex' }, '');
  const marker = h('div', { class: 'marker' }, hex);
  const track = h('div', { class: 'track' }, lose, win, marker, range);
  const multIn = ui.numberField('Multiplier', { suffix: '×' });
  const targetIn = ui.numberField('Roll over', {});
  const flip = h('button', { class: 'flip', type: 'button', title: 'Switch over / under', 'aria-label': 'Switch over or under' }, '⇄');
  targetIn.el.querySelector('.input').append(flip);
  const chanceIn = ui.numberField('Win chance', { suffix: '%' });
  shell.stage.append(h('div', { class: 'dice' },
    h('div', { class: 'readout' }, h('div', {}, rollEl, subEl)),
    h('div', { class: 'track-wrap' }, track, h('div', { class: 'scale' }, ...[0, 25, 50, 75, 100].map((v) => h('span', {}, String(v))))),
    h('div', { class: 'dice-fields' }, multIn.el, targetIn.el, chanceIn.el)));
  stage.canvas.style.zIndex = '2';
  stage.canvas.style.pointerEvents = 'none';

  // ---------- controls ----------
  const mode = ui.segmented(null, [['manual', 'Manual'], ['auto', 'Auto']], 'manual', (v) => { autoBox.hidden = v !== 'auto'; syncBtn(); });
  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const auto = ui.autoPanel(money);
  const autoBox = h('div', { hidden: true }, auto.el);
  const btn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Roll dice');
  const info = ui.stats([['profit', 'Profit on win'], ['rtp', 'RTP']]);
  shell.controls.append(mode.el, amount.el, autoBox, btn, info.el);
  info.set('rtp', `${(rtp * 100).toFixed(2)}%`);

  function render(skip) {
    const t = st.target;
    if (st.condition === 'over') { lose.style.left = '0%'; lose.style.width = `${t}%`; win.style.left = `${t}%`; win.style.width = `${100 - t}%`; }
    else { win.style.left = '0%'; win.style.width = `${t}%`; lose.style.left = `${t}%`; lose.style.width = `${100 - t}%`; }
    if (skip !== 'range') range.value = String(t);
    if (skip !== 'mult') multIn.value = mult().toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    if (skip !== 'target') targetIn.value = t.toFixed(2);
    if (skip !== 'chance') chanceIn.value = (chance() * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    targetIn.el.querySelector('label').firstChild.textContent = st.condition === 'over' ? 'Roll over' : 'Roll under';
    info.set('profit', money.fmt(Math.floor(amount.value * mult()) - amount.value));
  }

  let lastTickV = 0;
  range.addEventListener('input', () => {
    st.target = clampTarget(parseFloat(range.value));
    if (Math.abs(st.target - lastTickV) >= 1) { sound.tick(0.7 + st.target / 200); lastTickV = st.target; }
    render();
  });
  targetIn.input.addEventListener('change', () => { st.target = clampTarget(targetIn.value || 50); render(); });
  chanceIn.input.addEventListener('change', () => {
    const c = Math.min(98, Math.max(1, chanceIn.value || 49.5)) / 100;
    const n = Math.round(c * OUTCOMES);
    st.target = clampTarget(st.condition === 'under' ? n / 100 : (10000 - n) / 100);
    render();
  });
  multIn.input.addEventListener('change', () => {
    const m = Math.max(1.0102, multIn.value || 2);
    const n = Math.round((rtp * OUTCOMES) / m);
    st.target = clampTarget(st.condition === 'under' ? n / 100 : (10000 - n) / 100);
    render();
  });
  flip.addEventListener('click', () => { st.condition = st.condition === 'over' ? 'under' : 'over'; st.target = clampTarget(100 - st.target); sound.click(); render(); });
  amount.el.addEventListener('click', () => setTimeout(render));
  amount.el.addEventListener('input', () => render());

  function syncBtn() {
    if (mode.value === 'auto') { btn.textContent = auto.running ? 'Stop auto' : 'Start auto'; btn.className = `btn ${auto.running ? 'btn-cancel' : 'btn-bet'}`; btn.disabled = false; }
    else { btn.textContent = 'Roll dice'; btn.className = 'btn btn-bet'; btn.disabled = st.rolling; }
    const lock = auto.running; range.disabled = lock; [multIn, targetIn, chanceIn].forEach((f) => { f.disabled = lock; }); flip.disabled = lock;
  }

  async function roll() {
    if (st.rolling) return null;
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return null; }
    st.rolling = true; syncBtn(); sound.roll();
    let r;
    try { r = await api.bet(bet, { target: st.target, condition: st.condition }); } catch (e) { ui.toast(e.message, 'err'); st.rolling = false; syncBtn(); return null; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    const value = r.result.roll, won = r.result.win;
    // counter spins through random values, then settles on the roll
    rollEl.className = 'roll';
    const box = { v: 0 };
    const from = st.last ?? 50;
    await tween(box, { v: 1 }, { dur: 0.5, ease: ease.outCubic, onUpdate: () => { rollEl.textContent = (from + (value - from) * box.v + (1 - box.v) * (Math.random() * 20 - 10)).toFixed(2).padStart(5, '0'); } });
    rollEl.textContent = value.toFixed(2);
    rollEl.className = `roll ${won ? 'win' : 'loss'}`;
    marker.style.opacity = '1'; marker.style.left = `${value}%`;
    marker.className = `marker ${won ? 'win' : 'loss'}`; hex.textContent = value.toFixed(2);
    subEl.textContent = won ? `Won ${money.fmt(r.payout)} at ${fmtMult(r.multiplier)}` : `Needed ${st.condition} ${st.target.toFixed(2)}`;
    st.last = value;
    const tr = track.getBoundingClientRect(), sr = shell.stage.getBoundingClientRect();
    const px = tr.left - sr.left + (tr.width * value) / 100, py = tr.top - sr.top;
    setTimeout(() => {
      if (won) {
        sound.win(r.multiplier >= 5 ? 2 : 1);
        stage.particles.spark(px, py, { count: 36, color: '#1fe58f', speed: 280, angle: -Math.PI / 2, spread: 2 });
        stage.particles.ring(px, py + 7, { color: '#1fe58f', r0: 4, r1: 46, life: 0.4 });
        if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
      } else {
        sound.lose();
        stage.particles.spark(px, py, { count: 14, color: '#ff4766', speed: 160, angle: -Math.PI / 2, spread: 1.6 });
      }
      shell.wallet.release(r.payout);
      ui.pushResult(shell.strip, r.multiplier, won ? 'win' : 'loss');
    }, 380);
    st.rolling = false; syncBtn();
    return r;
  }

  btn.addEventListener('click', () => {
    if (mode.value === 'manual') { roll(); return; }
    if (auto.running) { auto.stop(); return; }
    auto.run(roll, { delay: 0.5, onState: syncBtn });
    syncBtn();
  });

  render();
  const stars = starfield(60);
  stage.draw((ctx, dt, W, H, t) => { stars(ctx, dt, W, H, t); glow(ctx, W / 2, H * 0.35, Math.max(W, H) * 0.45, '#8b5cf6', 0.14); });
}
