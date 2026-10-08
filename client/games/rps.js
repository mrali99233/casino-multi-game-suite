// Rock Paper Scissors client: shake, reveal, and double the streak on every win.
import { fmtMult } from '../sdk/api.js';
import { glow, starfield, wait } from '../sdk/fx.js';

export const rules = `
<p>Start a round, then pick rock, paper or scissors against the house. A win doubles your multiplier, a draw replays, a loss ends the round. Cash out whenever you like.</p>
<p>Decisive throws are won half the time, so after <b>k</b> wins the multiplier is RTP × 2<sup>k</sup> (up to 20 wins).</p>`;

const SVG = {
  rock: '<svg viewBox="0 0 100 100"><path d="M24 44c0-10 6-16 14-16 3-6 9-8 15-6 4-3 11-3 15 2 7-1 12 4 12 11v20c0 16-12 27-28 27S24 72 24 58z" fill="#ffd9b8" stroke="#8a4b2a" stroke-width="3"/><path d="M38 28v18M53 22v22M68 24v20" stroke="#8a4b2a" stroke-width="3" stroke-linecap="round"/><path d="M24 50c6 4 14 4 18-2" stroke="#8a4b2a" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
  paper: '<svg viewBox="0 0 100 100"><path d="M30 92V48l-8-12c-3-5 3-10 8-6l8 10V14c0-6 9-6 9 0v26V8c0-6 9-6 9 0v32V12c0-6 9-6 9 0v30V22c0-6 9-6 9 0v44c0 16-10 26-26 26z" fill="#ffd9b8" stroke="#8a4b2a" stroke-width="3" stroke-linejoin="round"/></svg>',
  scissors: '<svg viewBox="0 0 100 100"><path d="M34 92V58l-6-8c-3-5 3-10 8-6l6 8L30 14c-1-6 7-8 9-2l13 36 6-38c1-6 10-5 9 1l-5 40c8 0 14 6 14 14v4c0 16-10 23-26 23z" fill="#ffd9b8" stroke="#8a4b2a" stroke-width="3" stroke-linejoin="round"/><path d="M50 62c6-2 12 0 14 6" stroke="#8a4b2a" stroke-width="3" fill="none" stroke-linecap="round"/></svg>',
};
const NAMES = ['rock', 'paper', 'scissors'];

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const ladder = init.game.data.ladder;
  const st = { round: null, busy: false };

  document.head.append(h('style', {}, `
    .rps { position: absolute; inset: 52px 14px 14px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 12px; justify-items: center; z-index: 1; }
    .rps .duel { display: grid; grid-template-columns: 1fr auto 1fr; gap: clamp(16px, 5vw, 60px); align-items: center; align-self: center; }
    .rps .side { display: grid; justify-items: center; gap: 10px; }
    .rps .side h3 { margin: 0; font-family: var(--f-display); letter-spacing: .14em; font-size: clamp(14px, 2.2vw, 20px); }
    .rps .hand { width: clamp(110px, 18vw, 190px); aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center; background: radial-gradient(circle at 40% 35%, #2c3180, #12143a 70%); border: 3px solid var(--line-strong); transition: border-color .3s, box-shadow .3s; }
    .rps .hand svg { width: 66%; }
    .rps .house .hand svg { transform: scaleX(-1); }
    .rps .hand.shake { animation: shake .9s ease-in-out; }
    @keyframes shake { 0%, 100% { transform: translateY(0); } 16%, 50%, 83% { transform: translateY(-26px) rotate(-8deg); } 33%, 66% { transform: translateY(6px); } }
    .rps .hand.win { border-color: var(--green); box-shadow: 0 0 40px rgba(31,229,143,.55); }
    .rps .hand.lose { border-color: var(--red); box-shadow: 0 0 40px rgba(255,71,102,.55); }
    .rps .hand.draw { border-color: var(--cyan); }
    .rps .vs { font-family: var(--f-display); font-size: clamp(22px, 4vw, 44px); color: var(--gold); }
    .rps .msg { font-family: var(--f-display); font-weight: 700; font-size: clamp(18px, 3vw, 30px); letter-spacing: .08em; min-height: 36px; text-align: center; }
    .rps .lad { display: flex; gap: 6px; overflow-x: auto; max-width: 100%; padding: 2px; scrollbar-width: none; }
    .rps .lad .s { flex: none; padding: 5px 10px; border-radius: 10px; background: rgba(20,23,55,.85); border: 1px solid var(--line); font-family: var(--f-display); font-size: 13px; }
    .rps .lad .s.done { border-color: rgba(31,229,143,.5); color: var(--green); }
    .rps .lad .s.next { border-color: var(--gold); color: var(--gold); }
    .picks { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .picks button { border: 1px solid var(--line); background: var(--bg-2); border-radius: 14px; padding: 8px 4px; display: grid; justify-items: center; gap: 4px; font-weight: 700; font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; transition: transform .12s, border-color .15s; }
    .picks button svg { width: 46px; height: 46px; }
    .picks button:hover:not(:disabled) { transform: translateY(-2px); border-color: var(--violet); color: var(--text); }
    .picks button:disabled { opacity: .45; }
  `));

  const lad = h('div', { class: 'lad', 'aria-label': 'Multiplier ladder' });
  const you = h('div', { class: 'hand', html: SVG.rock }), house = h('div', { class: 'hand', html: SVG.rock });
  const msg = h('div', { class: 'msg', role: 'status' }, 'Start a round to play');
  shell.stage.append(h('div', { class: 'rps' }, lad, h('div', { class: 'duel' }, h('div', { class: 'side' }, h('h3', { style: 'color:var(--cyan)' }, 'YOU'), you), h('div', { class: 'vs' }, 'VS'), h('div', { class: 'side house' }, h('h3', { style: 'color:var(--pink)' }, 'HOUSE'), house)), msg));
  stage.canvas.style.zIndex = '2'; stage.canvas.style.pointerEvents = 'none';

  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const pickBtns = NAMES.map((n) => { const b = h('button', { type: 'button', html: `${SVG[n]}<span>${n}</span>`, 'aria-label': n }); b.addEventListener('click', () => play(n)); return b; });
  const main = h('button', { class: 'btn btn-bet', type: 'button' }, 'Bet');
  shell.controls.append(amount.el, main, h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Your throw'), h('div', { class: 'picks' }, pickBtns)));

  function renderLadder() {
    const k = st.round ? st.round.result.wins : 0;
    lad.replaceChildren(...ladder.slice(0, Math.max(8, k + 4)).map((m, i) => h('span', { class: `s ${i < k ? 'done' : i === k && st.round ? 'next' : ''}` }, fmtMult(m))));
  }
  function render() {
    const r = st.round, live = !!r;
    amount.disabled = live || st.busy;
    pickBtns.forEach((b) => { b.disabled = !live || st.busy; });
    if (live) {
      main.className = 'btn btn-cash';
      main.innerHTML = r.cashout_amount ? `Cash out<small class="num">${money.fmt(r.cashout_amount)}</small>` : 'Cash out<small>Win a throw first</small>';
      main.disabled = st.busy || !r.cashout_amount;
    } else { main.className = 'btn btn-bet'; main.textContent = 'Bet'; main.disabled = st.busy; }
    renderLadder();
  }

  async function start() {
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return; }
    st.busy = true; render();
    try { const r = await api.roundStart(bet, {}); st.round = r; shell.wallet.sync(r.balance); sound.bet(); msg.textContent = 'Pick your throw'; msg.style.color = ''; }
    catch (e) { ui.toast(e.message, 'err'); }
    st.busy = false; render();
  }

  async function play(pick) {
    if (!st.round || st.busy) return;
    st.busy = true; render();
    [you, house].forEach((x) => { x.classList.remove('win', 'lose', 'draw'); x.innerHTML = SVG.rock; });
    const req = api.roundAct({ pick });
    [you, house].forEach((x) => { x.classList.remove('shake'); void x.offsetWidth; x.classList.add('shake'); });
    sound.whoosh();
    let r;
    try { [r] = await Promise.all([req, wait(0.9)]); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; render(); return; }
    const last = r.result.history[r.result.history.length - 1];
    you.innerHTML = SVG[last.pick]; house.innerHTML = SVG[last.house];
    you.classList.add(last.outcome === 'win' ? 'win' : last.outcome === 'lose' ? 'lose' : 'draw');
    house.classList.add(last.outcome === 'win' ? 'lose' : last.outcome === 'lose' ? 'win' : 'draw');
    const rc = you.getBoundingClientRect(), sr = shell.stage.getBoundingClientRect();
    st.busy = false;
    if (last.outcome === 'win') {
      sound.gem(r.result.wins);
      stage.particles.spark(rc.left - sr.left + rc.width / 2, rc.top - sr.top + rc.height / 2, { count: 36, color: '#1fe58f', speed: 280 });
      msg.textContent = `${last.pick.toUpperCase()} BEATS ${last.house.toUpperCase()} · ${fmtMult(r.cashout_multiplier)}`; msg.style.color = 'var(--green)';
    } else if (last.outcome === 'draw') { sound.tick(); msg.textContent = 'DRAW · THROW AGAIN'; msg.style.color = 'var(--cyan)'; }
    else { sound.lose(); stage.shake(8, 0.4); msg.textContent = `${last.house.toUpperCase()} BEATS ${last.pick.toUpperCase()}`; msg.style.color = 'var(--red)'; }
    if (r.status === 'settled') {
      st.round = null; shell.wallet.sync(r.balance);
      if (r.payout > 0) finishWin(r); else ui.pushResult(shell.strip, 0, 'loss');
    } else st.round = r;
    render();
  }

  function finishWin(r) {
    sound.cashout();
    stage.particles.coins(stage.w / 2, stage.h, { count: 24 });
    msg.textContent = `CASHED OUT ${fmtMult(r.multiplier)} · ${money.fmt(r.payout)}`; msg.style.color = 'var(--gold)';
    ui.pushResult(shell.strip, r.multiplier);
    if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
  }

  async function cashout() {
    if (!st.round || st.busy) return;
    st.busy = true; render();
    try { const r = await api.roundCashout(); st.round = null; shell.wallet.sync(r.balance); finishWin(r); } catch (e) { ui.toast(e.message, 'err'); }
    st.busy = false; render();
  }
  main.addEventListener('click', () => (st.round ? cashout() : start()));
  if (init.open_round) { st.round = init.open_round; msg.textContent = 'Pick your throw'; }
  render();

  const stars = starfield(60);
  stage.draw((ctx, dt, W, H, t) => { stars(ctx, dt, W, H, t); glow(ctx, W / 2, H / 2, Math.max(W, H) * 0.45, '#8b5cf6', 0.14); });
}
