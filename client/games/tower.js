// Dragon Tower client: nine floors of tiles; find the egg on each floor, avoid the dragon.
import { fmtMult } from '../sdk/api.js';
import { glow, starfield } from '../sdk/fx.js';

export const rules = `
<p>Climb the tower one floor at a time by picking a tile on the current floor. Eggs are safe; a dragon ends the round. Cash out at any floor.</p>
<p>Difficulty sets tiles and eggs per floor (Easy 3 of 4, Medium 2 of 3, Hard 1 of 2, Expert 1 of 3, Master 1 of 4). After <b>k</b> floors the multiplier is RTP × (tiles ÷ eggs)<sup>k</sup>.</p>`;

const EGG = '<svg viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="eg" cx=".35" cy=".3"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#9dffd0"/><stop offset="1" stop-color="#0aa864"/></radialGradient></defs><path d="M32 6C20 6 12 26 12 38a20 20 0 0 0 40 0C52 26 44 6 32 6z" fill="url(#eg)"/><path d="M20 36l6-5 6 5 6-5 6 5" stroke="#05603a" stroke-width="2.5" fill="none" opacity=".6"/></svg>';
const DRAGON = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 14l12 8M54 14l-12 8" stroke="#ffc53d" stroke-width="4" stroke-linecap="round"/><path d="M32 12c14 0 22 10 22 22 0 10-8 18-22 22-14-4-22-12-22-22 0-12 8-22 22-22z" fill="#ff4766"/><circle cx="24" cy="32" r="5" fill="#ffe28a"/><circle cx="40" cy="32" r="5" fill="#ffe28a"/><path d="M24 32h0M40 32h0" stroke="#3a0c18" stroke-width="3" stroke-linecap="round"/><path d="M24 46l4-4 4 4 4-4 4 4" stroke="#3a0c18" stroke-width="2.5" fill="none"/></svg>';

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const D = init.game.data.difficulties, ROWS = init.game.data.rows;
  const st = { diff: 'medium', round: null, busy: false };

  document.head.append(h('style', {}, `
    .tower { position: absolute; inset: 52px 14px 14px; display: grid; place-items: center; z-index: 1; }
    .floors { display: grid; gap: clamp(5px, 1vh, 9px); width: min(100%, 560px); }
    .floor { display: grid; grid-template-columns: 74px minmax(0, 1fr); gap: 10px; align-items: center; transition: opacity .3s; }
    .floor .m { font-family: var(--f-display); font-weight: 700; font-size: 14px; color: var(--dim); text-align: right; font-variant-numeric: tabular-nums; }
    .floor.cur .m { color: var(--gold); }
    .floor.done .m { color: var(--green); }
    .floor .tiles { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 8px; }
    .tt { height: clamp(30px, calc((100vh - 300px) / 11), 54px); border: 0; border-radius: 10px; background: linear-gradient(160deg, #31367f, #20245a); box-shadow: inset 0 2px 0 rgba(255,255,255,.1), 0 4px 0 #10133a; display: grid; place-items: center; transition: transform .12s, filter .15s, box-shadow .2s; }
    .tt svg { height: 80%; }
    .floor.cur .tt:not(:disabled) { box-shadow: inset 0 2px 0 rgba(255,255,255,.2), 0 4px 0 #10133a, 0 0 0 2px rgba(255,197,61,.55), 0 0 22px rgba(255,197,61,.25); animation: breathe 1.6s ease-in-out infinite; }
    .floor.cur .tt:not(:disabled):hover { transform: translateY(-3px); filter: brightness(1.2); }
    .tt.egg { background: radial-gradient(circle, rgba(31,229,143,.35), #0e2a26 75%); box-shadow: inset 0 0 0 2px rgba(31,229,143,.6); animation: popin .4s cubic-bezier(.2,1.6,.4,1); }
    .tt.dragon { background: radial-gradient(circle, rgba(255,71,102,.5), #2a0a14 75%); box-shadow: inset 0 0 0 2px rgba(255,71,102,.8), 0 0 26px rgba(255,71,102,.5); animation: popin .4s cubic-bezier(.2,1.6,.4,1); }
    .tt.ghost { opacity: .35; animation: none; }
    .floor.dim { opacity: .5; }
    @keyframes breathe { 50% { filter: brightness(1.18); } }
    @keyframes popin { from { transform: scale(.6); } }
  `));

  const floorsEl = h('div', { class: 'floors', 'aria-label': 'Tower floors' });
  shell.stage.append(h('div', { class: 'tower' }, floorsEl));
  stage.canvas.style.zIndex = '2'; stage.canvas.style.pointerEvents = 'none';

  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const diff = ui.segmented('Difficulty', Object.keys(D).map((d) => [d, d === 'medium' ? 'Med' : d[0].toUpperCase() + d.slice(1)]), st.diff, (v) => { st.diff = v; build(); });
  const btn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Bet');
  const random = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Random pick');
  const info = ui.stats([['next', 'Next floor'], ['chance', 'Safe chance']]);
  shell.controls.append(amount.el, diff.el, btn, random, info.el);

  let rows = [];
  function build() {
    const { tiles, ladder } = D[st.diff];
    floorsEl.replaceChildren();
    rows = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      const btns = Array.from({ length: tiles }, (_, c) => {
        const b = h('button', { class: 'tt', type: 'button', 'aria-label': `Floor ${r + 1} tile ${c + 1}` });
        b.addEventListener('click', () => pick(c));
        return b;
      });
      const row = h('div', { class: 'floor' }, h('div', { class: 'm' }, fmtMult(ladder[r] / 100)), h('div', { class: 'tiles' }, btns));
      rows[r] = { row, btns };
      floorsEl.append(row);
    }
    render();
  }

  function render() {
    const r = st.round, live = !!r && r.status === 'open', cur = live ? r.result.row : -1;
    rows.forEach((f, i) => {
      f.row.classList.toggle('cur', i === cur);
      f.row.classList.toggle('done', live && i < cur);
      f.btns.forEach((b) => { b.disabled = !(live && i === cur) || st.busy; });
    });
    amount.disabled = live; diff.disabled = live;
    random.hidden = !live; random.disabled = st.busy;
    const { tiles, good, ladder } = D[r ? r.params.difficulty : st.diff];
    const k = live ? cur : 0;
    info.set('next', k < ROWS ? fmtMult(ladder[k] / 100) : '—');
    info.set('chance', `${((good / tiles) * 100).toFixed(1)}%`);
    if (live) {
      btn.className = 'btn btn-cash';
      btn.innerHTML = r.cashout_amount ? `Cash out<small class="num">${money.fmt(r.cashout_amount)}</small>` : 'Cash out<small>Clear a floor first</small>';
      btn.disabled = st.busy || !r.cashout_amount;
    } else { btn.className = 'btn btn-bet'; btn.textContent = 'Bet'; btn.disabled = st.busy; }
  }

  function revealAll(result) {
    const safe = result.safe || [];
    rows.forEach((f, i) => f.btns.forEach((b, c) => {
      if (b.classList.contains('egg') || b.classList.contains('dragon')) return;
      const good = (safe[i] || []).includes(c);
      b.innerHTML = good ? EGG : DRAGON;
      b.classList.add(good ? 'egg' : 'dragon', 'ghost');
    }));
  }
  function center(b) { const rc = b.getBoundingClientRect(), sr = shell.stage.getBoundingClientRect(); return { x: rc.left - sr.left + rc.width / 2, y: rc.top - sr.top + rc.height / 2 }; }

  async function start() {
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return; }
    st.busy = true; render();
    try {
      const r = await api.roundStart(bet, { difficulty: st.diff });
      build(); st.round = r; shell.wallet.sync(r.balance); sound.bet();
    } catch (e) { ui.toast(e.message, 'err'); }
    st.busy = false; render();
  }

  async function pick(col) {
    if (!st.round || st.busy) return;
    const rowIdx = st.round.result.row;
    st.busy = true; render(); sound.flip();
    let r;
    try { r = await api.roundAct({ column: col }); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; render(); return; }
    st.busy = false;
    const b = rows[rowIdx].btns[col], c = center(b);
    if (r.result.lost_at !== undefined) {
      b.innerHTML = DRAGON; b.classList.add('dragon');
      sound.explode(); stage.shake(10, 0.45);
      stage.particles.spark(c.x, c.y, { count: 60, color: '#ff4766', speed: 360 });
      stage.particles.spark(c.x, c.y, { count: 30, color: '#ffc53d', speed: 260 });
      st.round = null; shell.wallet.sync(r.balance);
      ui.pushResult(shell.strip, 0, 'loss');
      setTimeout(() => revealAll(r.result), 450);
    } else {
      b.innerHTML = EGG; b.classList.add('egg');
      sound.gem(rowIdx + 1);
      stage.particles.spark(c.x, c.y, { count: 22, color: '#1fe58f', speed: 200, life: 0.5 });
      if (r.status === 'settled') { st.round = null; shell.wallet.sync(r.balance); finishWin(r); revealAll(r.result); } else st.round = r;
    }
    render();
  }

  function finishWin(r) {
    sound.cashout();
    stage.particles.coins(stage.w / 2, stage.h, { count: 26 });
    stage.particles.text(stage.w / 2, stage.h * 0.4, `${fmtMult(r.multiplier)}  +${money.fmt(r.payout)}`, { color: '#1fe58f', size: 28, life: 1.6 });
    ui.pushResult(shell.strip, r.multiplier);
    if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
  }

  async function cashout() {
    if (!st.round || st.busy) return;
    st.busy = true; render();
    try { const r = await api.roundCashout(); st.round = null; shell.wallet.sync(r.balance); finishWin(r); revealAll(r.result); } catch (e) { ui.toast(e.message, 'err'); }
    st.busy = false; render();
  }

  btn.addEventListener('click', () => (st.round ? cashout() : start()));
  random.addEventListener('click', () => { if (st.round) pick(Math.floor(Math.random() * D[st.round.params.difficulty].tiles)); });

  if (init.open_round) {
    st.diff = init.open_round.params.difficulty; diff.set(st.diff);
    build();
    st.round = init.open_round;
    st.round.result.picks.forEach((c, i) => { const b = rows[i].btns[c]; b.innerHTML = EGG; b.classList.add('egg'); });
  } else build();
  render();

  const stars = starfield(60);
  stage.draw((ctx, dt, W, H, t) => { stars(ctx, dt, W, H, t); glow(ctx, W / 2, H * 0.2, Math.max(W, H) * 0.5, '#ff8a1f', 0.08); glow(ctx, W / 2, H, Math.max(W, H) * 0.5, '#8b5cf6', 0.14); });
}
