// Blackjack client: dealer and player hands on felt, hit / stand / double / split.
import { card, deal, felt, flip } from '../sdk/cards.js';
import { wait } from '../sdk/fx.js';

export const rules = `
<p>Get closer to 21 than the dealer without going over. Number cards count their value, faces 10, aces 1 or 11. A two-card 21 is a <b>Blackjack</b>.</p>
<p>Dealer peeks for blackjack and stands on all 17s. You can <b>double</b> on any first two cards (one more card, stake doubled) and <b>split</b> a pair once; split aces get one card each. Wins pay 1:1.</p>`;

const RESULT = { win: ['WIN', 'var(--green)'], blackjack: ['BLACKJACK', 'var(--gold)'], push: ['PUSH', 'var(--cyan)'], lose: ['LOSE', 'var(--red)'], bust: ['BUST', 'var(--red)'] };

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const pays = init.game.data.blackjack_pays;
  const st = { round: null, busy: false, shown: { dealer: [], hands: [] } };
  felt(stage);

  document.head.append(h('style', {}, `
    .bj { position: absolute; inset: 52px 14px 14px; display: grid; grid-template-rows: 1fr auto 1fr; gap: 10px; justify-items: center; align-items: center; z-index: 1; }
    .bj .area { display: grid; justify-items: center; gap: 8px; }
    .bj .row { display: flex; min-height: calc(var(--cw) * 1.4); align-items: center; }
    .bj .row .card + .card { margin-left: calc(var(--cw) * -.45); }
    .bj .tot { font-family: var(--f-display); font-weight: 700; font-size: 16px; padding: 3px 12px; border-radius: 999px; background: rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.25); min-width: 46px; text-align: center; }
    .bj .hands { display: flex; gap: clamp(16px, 5vw, 60px); }
    .bj .hand { display: grid; justify-items: center; gap: 8px; padding: 8px 12px; border-radius: 16px; border: 2px solid transparent; transition: border-color .25s, box-shadow .25s; }
    .bj .hand.active { border-color: rgba(255,197,61,.7); box-shadow: 0 0 24px rgba(255,197,61,.25); }
    .bj .res { font-family: var(--f-display); font-weight: 700; letter-spacing: .1em; font-size: 14px; min-height: 18px; }
    .bj .msg { font-family: var(--f-display); font-weight: 700; font-size: clamp(20px, 3.4vw, 34px); letter-spacing: .08em; color: var(--gold); text-shadow: 0 0 20px rgba(255,197,61,.5); min-height: 40px; text-align: center; }
    .bj .lbl2 { font-size: 12px; letter-spacing: .14em; color: rgba(255,255,255,.6); font-weight: 700; }
    .acts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .acts .btn { padding: 12px 6px; font-size: 15px; }
  `));

  const dRow = h('div', { class: 'row' }), dTot = h('div', { class: 'tot' }, '–');
  const handsEl = h('div', { class: 'hands' });
  const msg = h('div', { class: 'msg', role: 'status' }, `BLACKJACK PAYS ${pays}`);
  const box = h('div', { class: 'bj' }, h('div', { class: 'area' }, h('div', { class: 'lbl2' }, 'DEALER'), dRow, dTot), msg, h('div', { class: 'area' }, handsEl, h('div', { class: 'lbl2' }, 'YOU')));
  shell.stage.append(box);

  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const mk = (label, cls) => h('button', { class: `btn ${cls}`, type: 'button', disabled: true }, label);
  const B = { hit: mk('Hit', 'btn-bet'), stand: mk('Stand', 'btn-cancel'), double: mk('Double', 'btn-cash'), split: mk('Split', 'btn-ghost') };
  const dealBtn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Deal');
  const info = ui.stats([['stake', 'In play'], ['rule', 'Blackjack pays']]);
  info.set('rule', pays); info.set('stake', money.fmt(0));
  shell.controls.append(amount.el, dealBtn, h('div', { class: 'acts' }, B.hit, B.stand, B.double, B.split), info.el);

  const cw = () => Math.max(60, Math.min(104, stage.w / 9, stage.h / 5.2));
  const fmtTot = ([t, soft]) => (soft && t < 21 ? `${t - 10}/${t}` : String(t));

  function handEl(i) {
    let el = handsEl.children[i];
    if (!el) { el = h('div', { class: 'hand' }, h('div', { class: 'row' }), h('div', { class: 'tot' }, '–'), h('div', { class: 'res' })); handsEl.append(el); }
    return el;
  }

  function controls() {
    const r = st.round, live = r && r.status === 'open';
    Object.entries(B).forEach(([k, b]) => { b.disabled = !live || st.busy || !(r.actions || []).includes(k); });
    dealBtn.disabled = live || st.busy;
    amount.disabled = live || st.busy;
    info.set('stake', money.fmt(live ? r.bet : 0));
    [...handsEl.children].forEach((el, i) => el.classList.toggle('active', !!live && r.result.hands.length > 1 && i === r.result.active));
  }

  async function sync(r, animate = true) {
    const S = r.result, w = cw();
    box.style.setProperty('--cw', `${w}px`);
    // split: move the second card into a new hand
    if (S.hands.length === 2 && st.shown.hands.length === 1) {
      const first = handEl(0), second = handEl(1);
      const moved = first.querySelector('.row').children[1];
      second.querySelector('.row').append(moved);
      st.shown.hands = [[S.hands[0].cards[0]], [S.hands[1].cards[0]]];
      sound.flip();
    }
    // opening deal: P, D, P, D(hole)
    if (!st.shown.hands.length) {
      st.shown.hands = [[]];
      const p = S.hands[0].cards, prow = handEl(0).querySelector('.row');
      const seq = [[prow, p[0], false], [dRow, S.dealer[0], false], [prow, p[1], false], [dRow, null, true]];
      for (const [row, id, down] of seq) {
        sound.tick();
        if (animate) await deal(row, id, { w, down, dy: -260, dx: 60 }); else row.append(card(id, { w, down }));
      }
      st.shown.hands[0] = [p[0], p[1]];
      st.shown.dealer = [S.dealer[0], null];
    }
    // new player cards
    for (let i = 0; i < S.hands.length; i++) {
      const el = handEl(i), row = el.querySelector('.row');
      const have = st.shown.hands[i] || (st.shown.hands[i] = []);
      for (let k = have.length; k < S.hands[i].cards.length; k++) {
        sound.tick();
        const opts = { w, dy: -260, dx: 40, cls: S.hands[i].doubled && k === 2 ? 'side' : '' };
        if (animate) await deal(row, S.hands[i].cards[k], opts); else row.append(card(S.hands[i].cards[k], opts));
        have.push(S.hands[i].cards[k]);
      }
      el.querySelector('.tot').textContent = fmtTot(r.totals ? r.totals[i] : [0, false]);
      const res = RESULT[S.hands[i].result];
      el.querySelector('.res').textContent = res ? res[0] : '';
      el.querySelector('.res').style.color = res ? res[1] : '';
    }
    // dealer
    if (S.phase === 'done') {
      const hole = dRow.children[1];
      if (hole && st.shown.dealer[1] === null) { flip(hole, S.dealer[1]); sound.flip(); st.shown.dealer[1] = S.dealer[1]; if (animate) await wait(0.5); }
      for (let k = st.shown.dealer.length; k < S.dealer.length; k++) {
        sound.tick();
        if (animate) { await deal(dRow, S.dealer[k], { w, dy: -260, dx: -40 }); await wait(0.15); } else dRow.append(card(S.dealer[k], { w }));
        st.shown.dealer.push(S.dealer[k]);
      }
      dTot.textContent = String(S.dealer_total);
    } else dTot.textContent = fmtTot(r.dealer_total);
  }

  function reset() {
    dRow.replaceChildren(); handsEl.replaceChildren(); dTot.textContent = '–';
    st.shown = { dealer: [], hands: [] };
  }

  function finish(r) {
    const results = r.result.hands.map((x) => x.result);
    let text = 'DEALER WINS';
    if (results.includes('blackjack')) text = 'BLACKJACK!';
    else if (r.payout > r.bet) text = r.result.dealer_total > 21 ? 'DEALER BUSTS!' : 'YOU WIN!';
    else if (r.payout === r.bet && r.payout > 0) text = 'PUSH';
    else if (r.payout > 0) text = 'SPLIT DECISION';
    else if (results.every((x) => x === 'bust')) text = 'BUST';
    msg.textContent = text;
    msg.style.color = r.payout > r.bet ? 'var(--gold)' : r.payout === r.bet ? 'var(--cyan)' : 'var(--red)';
    shell.wallet.sync(r.balance);
    if (r.payout > r.bet) {
      sound.win(results.includes('blackjack') ? 2 : 1);
      stage.particles.coins(stage.w / 2, stage.h, { count: 24 });
      stage.particles.text(stage.w / 2, stage.h * 0.5, `+${money.fmt(r.payout)}`, { color: '#1fe58f', size: 30 });
    } else if (r.payout === 0) sound.lose();
    ui.pushResult(shell.strip, r.multiplier, r.payout > r.bet ? 'win' : 'loss');
  }

  async function start() {
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return; }
    st.busy = true; controls(); reset(); msg.textContent = ''; sound.bet();
    let r;
    try { r = await api.roundStart(bet, {}); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; controls(); return; }
    shell.wallet.sync(r.balance ?? shell.wallet.server - bet);
    await sync(r);
    st.round = r.status === 'open' ? r : null;
    if (!st.round) finish(r);
    st.busy = false; controls();
  }

  async function act(move) {
    if (!st.round || st.busy) return;
    st.busy = true; controls();
    let r;
    try { r = await api.roundAct({ move }); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; controls(); return; }
    if (r.balance !== undefined && r.status === 'open') shell.wallet.sync(r.balance);
    await sync(r);
    if (r.status === 'open') st.round = r; else { st.round = null; finish(r); }
    st.busy = false; controls();
  }

  dealBtn.addEventListener('click', start);
  Object.entries(B).forEach(([k, b]) => b.addEventListener('click', () => act(k)));
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const key = { h: 'hit', s: 'stand', d: 'double', p: 'split' }[e.key.toLowerCase()];
    if (key && st.round) act(key);
  });

  if (init.open_round) {
    const r = init.open_round;
    sync(r, false).then(() => { st.round = r; msg.textContent = ''; controls(); });
  }
  controls();
}
