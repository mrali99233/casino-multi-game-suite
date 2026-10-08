// Keno client: 40-number board, up to 10 picks, ten-ball draw revealed one by one.
import { fmtMult } from '../sdk/api.js';
import { glow, starfield, wait } from '../sdk/fx.js';

export const rules = `
<p>Pick between 1 and 10 numbers from 1 to 40, then bet. Ten numbers are drawn; your payout depends on how many of your picks were drawn (hits) and the risk level.</p>
<p>The chance of <b>h</b> hits with <b>p</b> picks is C(p, h) × C(40 − p, 10 − h) ÷ C(40, 10). The payout row under the board shows every outcome for your current picks.</p>`;

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const data = init.game.data;
  const st = { picks: new Set(), risk: 'medium', busy: false, drawn: new Set(), hits: new Set() };

  document.head.append(h('style', {}, `
    .keno { position: absolute; inset: 52px 14px 14px; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 12px; justify-items: center; z-index: 1; }
    .kgrid { display: grid; grid-template-columns: repeat(8, 1fr); gap: clamp(5px, 1vw, 9px); width: min(100%, 720px); align-self: center; }
    .kn { aspect-ratio: 1; border: 0; border-radius: 12px; font-family: var(--f-display); font-weight: 700; font-size: clamp(14px, 2vw, 20px); color: var(--text); background: linear-gradient(160deg, #31367f, #20245a); box-shadow: inset 0 2px 0 rgba(255,255,255,.12), 0 4px 0 #10133a; transition: transform .12s, background .2s, box-shadow .2s; position: relative; }
    .kn:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.15); }
    .kn.pick { background: linear-gradient(160deg, var(--violet-2), var(--violet)); box-shadow: inset 0 2px 0 rgba(255,255,255,.3), 0 4px 0 #4a2aa8, 0 0 18px rgba(139,92,246,.5); }
    .kn.miss { background: #12142f; color: var(--dim); box-shadow: inset 0 0 0 2px rgba(255,71,102,.55); }
    .kn.hit { background: radial-gradient(circle, #5dffb6, var(--green) 60%, var(--green-deep)); color: #04130b; box-shadow: 0 0 22px rgba(31,229,143,.7), 0 4px 0 #066b3f; animation: khit .45s cubic-bezier(.2,1.6,.4,1); }
    .kn.dim { opacity: .45; }
    @keyframes khit { from { transform: scale(.6); } }
    .kpay { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; max-width: 720px; }
    .kpay .c { display: grid; justify-items: center; min-width: 56px; padding: 6px 8px; border-radius: 10px; background: rgba(20,23,55,.85); border: 1px solid var(--line); font-variant-numeric: tabular-nums; }
    .kpay .c b { font-family: var(--f-display); font-size: 14px; }
    .kpay .c span { font-size: 10px; color: var(--dim); }
    .kpay .c.on { border-color: var(--gold); background: rgba(255,197,61,.12); }
    .kpay .c.on b { color: var(--gold); }
    .kpay .empty { color: var(--muted); font-size: 13px; padding: 8px; }
  `));

  const nums = [];
  const grid = h('div', { class: 'kgrid', role: 'grid', 'aria-label': 'Keno numbers' });
  for (let n = 1; n <= data.numbers; n++) {
    const b = h('button', { class: 'kn', type: 'button', 'aria-pressed': 'false' }, String(n));
    b.addEventListener('click', () => toggle(n));
    nums[n] = b; grid.append(b);
  }
  const pay = h('div', { class: 'kpay', 'aria-label': 'Payouts by hits' });
  shell.stage.append(h('div', { class: 'keno' }, grid, pay));
  stage.canvas.style.zIndex = '2'; stage.canvas.style.pointerEvents = 'none';

  const mode = ui.segmented(null, [['manual', 'Manual'], ['auto', 'Auto']], 'manual', (v) => { autoBox.hidden = v !== 'auto'; syncBtn(); });
  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const risk = ui.segmented('Risk', data.risks.map((r) => [r, r[0].toUpperCase() + r.slice(1)]), st.risk, (v) => { st.risk = v; renderPay(); });
  const quick = h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' },
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => autoPick() }, 'Auto pick'),
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => clearPicks() }, 'Clear'));
  const auto = ui.autoPanel(money);
  const autoBox = h('div', { hidden: true }, auto.el);
  const btn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Bet');
  const info = ui.stats([['picks', 'Picks'], ['top', 'Top prize']]);
  shell.controls.append(mode.el, amount.el, risk.el, quick, autoBox, btn, info.el);

  function resetBoard() {
    st.drawn.clear(); st.hits.clear();
    for (let n = 1; n <= data.numbers; n++) nums[n].className = `kn ${st.picks.has(n) ? 'pick' : ''}`;
  }
  function toggle(n) {
    if (st.busy || auto.running) return;
    if (st.drawn.size) resetBoard();
    if (st.picks.has(n)) st.picks.delete(n);
    else if (st.picks.size < 10) st.picks.add(n);
    else { ui.toast('You can pick up to 10 numbers'); return; }
    sound.click();
    nums[n].classList.toggle('pick', st.picks.has(n));
    nums[n].setAttribute('aria-pressed', String(st.picks.has(n)));
    renderPay();
  }
  function autoPick() {
    if (st.busy || auto.running) return;
    const want = st.picks.size || 10;
    st.picks.clear();
    while (st.picks.size < want) st.picks.add(1 + Math.floor(Math.random() * data.numbers));
    resetBoard(); renderPay(); sound.bet();
  }
  function clearPicks() { if (st.busy || auto.running) return; st.picks.clear(); resetBoard(); renderPay(); }
  function renderPay(hits) {
    const p = st.picks.size;
    info.set('picks', `${p} / 10`);
    if (!p) { pay.replaceChildren(h('div', { class: 'empty' }, 'Pick 1 to 10 numbers to see the payouts')); info.set('top', '—'); return; }
    const t = data.tables[st.risk][String(p)];
    info.set('top', fmtMult(t[p] / 100));
    pay.replaceChildren(...t.map((m, i) => h('div', { class: `c ${hits === i ? 'on' : ''}` }, h('b', {}, fmtMult(m / 100)), h('span', {}, `${i} hit${i === 1 ? '' : 's'}`))));
  }
  renderPay();

  function syncBtn() {
    if (mode.value === 'auto') { btn.textContent = auto.running ? 'Stop auto' : 'Start auto'; btn.className = `btn ${auto.running ? 'btn-cancel' : 'btn-bet'}`; btn.disabled = false; }
    else { btn.textContent = st.busy ? 'Drawing…' : 'Bet'; btn.className = 'btn btn-bet'; btn.disabled = st.busy; }
    risk.disabled = st.busy || auto.running;
  }

  async function play() {
    if (st.busy) return null;
    if (!st.picks.size) { ui.toast('Pick at least one number first'); return null; }
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return null; }
    st.busy = true; syncBtn(); resetBoard(); sound.bet();
    let r;
    try { r = await api.bet(bet, { numbers: [...st.picks], risk: st.risk }); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; syncBtn(); return null; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    const hitSet = new Set(r.result.hits);
    let k = 0;
    for (const n of r.result.drawn) {
      await wait(mode.value === 'auto' ? 0.06 : 0.13);
      st.drawn.add(n);
      const el = nums[n];
      if (hitSet.has(n)) {
        k++; el.className = 'kn hit'; sound.gem(k);
        const rc = el.getBoundingClientRect(), sr = shell.stage.getBoundingClientRect();
        stage.particles.spark(rc.left - sr.left + rc.width / 2, rc.top - sr.top + rc.height / 2, { count: 16, color: '#1fe58f', speed: 180, life: 0.5 });
      } else { el.className = 'kn miss'; sound.tick(0.8); }
    }
    for (let n = 1; n <= data.numbers; n++) if (!st.drawn.has(n) && !st.picks.has(n)) nums[n].classList.add('dim');
    renderPay(r.result.hits.length);
    if (r.payout > r.bet) {
      sound.win(r.multiplier >= 10 ? 3 : 1);
      stage.particles.confetti(stage.w / 2, stage.h * 0.4, { count: 50 });
      if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
    } else if (!r.payout) sound.lose();
    shell.wallet.release(r.payout);
    ui.pushResult(shell.strip, r.multiplier, r.payout >= r.bet && r.payout > 0 ? 'win' : 'loss');
    st.busy = false; syncBtn();
    return r;
  }

  btn.addEventListener('click', () => {
    if (mode.value === 'manual') { play(); return; }
    if (auto.running) { auto.stop(); return; }
    if (!st.picks.size) { ui.toast('Pick at least one number first'); return; }
    auto.run(play, { delay: 0.6, onState: syncBtn });
    syncBtn();
  });

  const stars = starfield(60);
  stage.draw((ctx, dt, W, H, t) => { stars(ctx, dt, W, H, t); glow(ctx, W / 2, H / 2, Math.max(W, H) * 0.5, '#8b5cf6', 0.12); });
}
