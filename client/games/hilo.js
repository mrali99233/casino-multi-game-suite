// HiLo client: dealt cards flip in from the deck; guess higher or lower to grow the multiplier.
import { fmtMult } from '../sdk/api.js';
import { glow, starfield } from '../sdk/fx.js';

export const rules = `
<p>A card is dealt face up. Guess whether the next card is <b>higher</b> or <b>lower</b> (Ace is lowest, King highest; an equal rank loses). Every correct guess multiplies your win; cash out whenever you like.</p>
<p>A guess with chance <b>p</b> multiplies the payout by 1/p, and RTP is applied once to the total. You can skip a card without risk.</p>`;

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const st = { round: null, busy: false, lastCard: Math.floor(Math.random() * 52) };

  document.head.append(h('style', {}, `
    .hilo { position: absolute; inset: 52px 14px 14px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 14px; justify-items: center; z-index: 1; }
    .hist { display: flex; gap: 6px; overflow-x: auto; max-width: 100%; padding: 4px; min-height: 76px; scrollbar-width: none; }
    .hist::-webkit-scrollbar { display: none; }
    .hist .mini { position: relative; flex: none; }
    .hist .mini .tag { position: absolute; left: 50%; bottom: -6px; transform: translateX(-50%); font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: var(--bg-3); white-space: nowrap; }
    .hist .mini .tag.ok { background: var(--green); color: #04130b; }
    .hist .mini .tag.bad { background: var(--red); color: #fff; }
    .table { position: relative; display: flex; align-items: center; justify-content: center; gap: clamp(20px, 5vw, 60px); align-self: center; }
    .pcard { width: var(--w, 150px); aspect-ratio: 5 / 7; border-radius: calc(var(--w, 150px) * .09); position: relative; transform-style: preserve-3d; transition: transform .55s cubic-bezier(.3,1.3,.5,1); }
    .pcard .f, .pcard .b { position: absolute; inset: 0; border-radius: inherit; backface-visibility: hidden; }
    .pcard .f { background: linear-gradient(160deg, #ffffff, #e9ebff); color: #161935; box-shadow: 0 14px 30px -10px rgba(0,0,0,.8), inset 0 0 0 1px rgba(0,0,0,.08); }
    .pcard .f.red { color: #e3123f; }
    .pcard .f .r { position: absolute; top: 7%; left: 9%; font-family: var(--f-display); font-weight: 700; font-size: calc(var(--w, 150px) * .2); line-height: 1; text-align: center; }
    .pcard .f .r small { display: block; font-size: .8em; }
    .pcard .f .r2 { top: auto; left: auto; bottom: 7%; right: 9%; transform: rotate(180deg); }
    .pcard .f .s { position: absolute; inset: 0; display: grid; place-items: center; font-size: calc(var(--w, 150px) * .5); }
    .pcard .b { transform: rotateY(180deg); background: repeating-linear-gradient(45deg, #5b3fd6 0 8px, #4a2fc0 8px 16px); box-shadow: inset 0 0 0 5px #fff, 0 14px 30px -10px rgba(0,0,0,.8); }
    .pcard.down { transform: rotateY(180deg); }
    .pcard.deal { animation: deal .55s cubic-bezier(.2,1.2,.4,1); }
    @keyframes deal { from { transform: translateX(160%) rotateY(180deg) rotate(8deg); opacity: .4; } }
    .pcard.win .f { box-shadow: 0 0 0 4px var(--green), 0 0 40px rgba(31,229,143,.6); }
    .pcard.lose .f { box-shadow: 0 0 0 4px var(--red), 0 0 40px rgba(255,71,102,.6); }
    .deck { position: relative; }
    .deck .pcard { position: absolute; inset: 0; }
    .now { text-align: center; }
    .now b { display: block; font-family: var(--f-display); font-size: clamp(26px, 4vw, 40px); }
    .now span { color: var(--muted); font-weight: 600; }
    .guess { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .guess .btn { padding: 12px 8px; font-size: 15px; }
    .guess .btn small { font-family: var(--f-display); }
    .btn-hi { background: linear-gradient(180deg, #8ff1ff, var(--cyan) 50%, #0a93ad); color: #021318; box-shadow: 0 8px 22px -10px rgba(34,211,238,.9); }
    .btn-lo { background: linear-gradient(180deg, #ffa3c2, var(--pink) 50%, #c10f55); color: #fff; box-shadow: 0 8px 22px -10px rgba(255,61,129,.9); }
  `));

  const cardHtml = (idx) => {
    const r = RANKS[idx % 13], s = SUITS[Math.floor(idx / 13)], red = s === '♥' || s === '♦';
    return `<div class="f ${red ? 'red' : ''}"><div class="r">${r}<small>${s}</small></div><div class="s">${s}</div><div class="r r2">${r}<small>${s}</small></div></div><div class="b"></div>`;
  };
  const makeCard = (idx, w, down = false) => { const el = h('div', { class: `pcard ${down ? 'down' : ''}`, style: `--w:${w}px`, html: cardHtml(idx) }); return el; };

  const hist = h('div', { class: 'hist', 'aria-label': 'Cards this round' });
  const slot = h('div', { 'aria-live': 'polite' });
  const deck = h('div', { class: 'deck', style: 'width:110px;aspect-ratio:5/7' }, makeCard(0, 110, true), makeCard(0, 110, true));
  deck.children[1].style.transform = 'rotateY(180deg) translate(4px,-4px)';
  const now = h('div', { class: 'now' }, h('b', { class: 'num' }, '1.00×'), h('span', {}, 'Place a bet to deal'));
  shell.stage.append(h('div', { class: 'hilo' }, hist, h('div', { class: 'table' }, slot, deck), now));
  stage.canvas.style.zIndex = '2'; stage.canvas.style.pointerEvents = 'none';

  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const hi = h('button', { class: 'btn btn-hi', type: 'button' }, 'Higher');
  const lo = h('button', { class: 'btn btn-lo', type: 'button' }, 'Lower');
  const skip = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Skip card');
  const main = h('button', { class: 'btn btn-bet', type: 'button' }, 'Bet');
  shell.controls.append(amount.el, h('div', { class: 'guess' }, hi, lo), skip, main);

  const cardW = () => Math.max(110, Math.min(170, stage.h * 0.32, stage.w * 0.3));
  function showCard(idx, deal = true, cls = '') {
    const el = makeCard(idx, cardW());
    if (deal) el.classList.add('deal');
    if (cls) el.classList.add(cls);
    slot.replaceChildren(el);
    st.lastCard = idx;
  }
  showCard(st.lastCard, false);

  function pushHist(entry) {
    const m = h('div', { class: 'mini' }, makeCard(entry.card, 52));
    if (entry.guess) m.append(h('span', { class: `tag ${entry.guess === 'skip' ? '' : entry.won ? 'ok' : 'bad'}` }, entry.guess === 'higher' ? '▲' : entry.guess === 'lower' ? '▼' : 'skip'));
    hist.append(m);
    hist.scrollTo({ left: hist.scrollWidth, behavior: 'smooth' });
  }

  function render() {
    const r = st.round, live = !!r && r.status === 'open';
    amount.disabled = live;
    [hi, lo, skip].forEach((b) => { b.disabled = !live || st.busy; });
    if (live) {
      const o = r.options;
      hi.innerHTML = `Higher ▲<small>${o.higher.multiplier ? `${fmtMult(o.higher.multiplier)} · ${(o.higher.chance * 100).toFixed(1)}%` : 'not possible'}</small>`;
      lo.innerHTML = `Lower ▼<small>${o.lower.multiplier ? `${fmtMult(o.lower.multiplier)} · ${(o.lower.chance * 100).toFixed(1)}%` : 'not possible'}</small>`;
      hi.disabled ||= !o.higher.multiplier; lo.disabled ||= !o.lower.multiplier;
      skip.disabled ||= !r.skips_left;
      main.className = 'btn btn-cash';
      main.innerHTML = r.cashout_amount ? `Cash out<small class="num">${money.fmt(r.cashout_amount)}</small>` : 'Cash out<small>Win a guess first</small>';
      main.disabled = st.busy || !r.cashout_amount;
      now.firstChild.textContent = fmtMult(r.cashout_multiplier || 1);
      now.lastChild.textContent = r.result.streak ? `Streak ${r.result.streak} · profit ${money.fmt(r.cashout_amount - r.bet)}` : 'Make your first guess';
    } else {
      hi.innerHTML = 'Higher ▲'; lo.innerHTML = 'Lower ▼';
      main.className = 'btn btn-bet'; main.textContent = 'Bet'; main.disabled = st.busy;
    }
  }

  async function start() {
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return; }
    st.busy = true; render();
    try {
      const r = await api.roundStart(bet, {});
      st.round = r; shell.wallet.sync(r.balance); sound.bet(); sound.flip();
      hist.replaceChildren(); showCard(r.result.card); pushHist({ card: r.result.card });
    } catch (e) { ui.toast(e.message, 'err'); }
    st.busy = false; render();
  }

  async function act(guess) {
    if (!st.round || st.busy) return;
    st.busy = true; render(); sound.flip();
    let r;
    try { r = await api.roundAct({ guess }); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; render(); return; }
    const entry = r.result.history[r.result.history.length - 1];
    const won = entry.won !== false;
    showCard(entry.card, true, guess === 'skip' ? '' : won ? 'win' : 'lose');
    pushHist(entry);
    const rc = slot.getBoundingClientRect(), sr = shell.stage.getBoundingClientRect();
    const cx = rc.left - sr.left + rc.width / 2, cy = rc.top - sr.top + rc.height / 2;
    st.busy = false;
    if (r.status === 'settled') {
      st.round = null;
      shell.wallet.sync(r.balance);
      if (r.payout > 0) finishWin(r); else {
        sound.lose(); stage.shake(8, 0.4);
        stage.particles.spark(cx, cy, { count: 40, color: '#ff4766', speed: 300 });
        now.firstChild.textContent = 'BUST'; now.lastChild.textContent = `The card was ${guess === 'higher' ? 'not higher' : 'not lower'}`;
        ui.pushResult(shell.strip, 0, 'loss');
      }
    } else {
      st.round = r;
      if (guess !== 'skip') { sound.gem(r.result.streak); stage.particles.spark(cx, cy, { count: 20, color: '#1fe58f', speed: 220, life: 0.5 }); }
    }
    render();
  }

  function finishWin(r) {
    sound.cashout();
    stage.particles.coins(stage.w / 2, stage.h, { count: 24 });
    stage.particles.text(stage.w / 2, stage.h * 0.45, `${fmtMult(r.multiplier)}  +${money.fmt(r.payout)}`, { color: '#1fe58f', size: 28, life: 1.6 });
    now.firstChild.textContent = fmtMult(r.multiplier); now.lastChild.textContent = `Cashed out ${money.fmt(r.payout)}`;
    ui.pushResult(shell.strip, r.multiplier);
    if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
  }

  async function cashout() {
    if (!st.round || st.busy) return;
    st.busy = true; render();
    try { const r = await api.roundCashout(); st.round = null; shell.wallet.sync(r.balance); finishWin(r); } catch (e) { ui.toast(e.message, 'err'); }
    st.busy = false; render();
  }

  hi.addEventListener('click', () => act('higher'));
  lo.addEventListener('click', () => act('lower'));
  skip.addEventListener('click', () => act('skip'));
  main.addEventListener('click', () => (st.round ? cashout() : start()));

  if (init.open_round) {
    st.round = init.open_round;
    showCard(st.round.result.card, false);
    (st.round.result.history.length ? [{ card: st.round.result.history[0].from }, ...st.round.result.history] : [{ card: st.round.result.card }]).forEach(pushHist);
  }
  render();

  const stars = starfield(60);
  stage.draw((ctx, dt, W, H, t) => { stars(ctx, dt, W, H, t); glow(ctx, W / 2, H / 2, Math.max(W, H) * 0.45, '#22d3ee', 0.1); });
}
