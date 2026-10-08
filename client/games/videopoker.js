// Video Poker (Jacks or Better): deal five, tap to hold, draw once.
import { deal, felt } from '../sdk/cards.js';
import { wait } from '../sdk/fx.js';

export const rules = `
<p>You are dealt five cards. Tap the cards you want to <b>hold</b>, then draw: the others are replaced from the same deck. Your final hand pays according to the table, from a pair of Jacks or better up to a Royal Flush.</p>
<p>The paytable sets the return. Played perfectly, 9/6 returns 99.54%, 8/5 returns 97.30%; this table uses the variant shown at the top.</p>`;

const LABEL = { royal_flush: 'Royal Flush', straight_flush: 'Straight Flush', four_kind: 'Four of a Kind', full_house: 'Full House', flush: 'Flush', straight: 'Straight', three_kind: 'Three of a Kind', two_pair: 'Two Pair', jacks_or_better: 'Jacks or Better', nothing: 'No win' };

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const data = init.game.data, pt = data.paytable;
  const st = { round: null, busy: false, hold: [false, false, false, false, false] };
  felt(stage, '#14325e');

  document.head.append(h('style', {}, `
    .vp { position: absolute; inset: 52px 14px 14px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 12px; justify-items: center; z-index: 1; }
    .vp .pay { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 18px; padding: 10px 16px; border-radius: 14px; background: rgba(0,0,30,.55); border: 2px solid rgba(255,197,61,.5); width: min(100%, 420px); font-family: var(--f-display); font-size: clamp(11px, 1.6vw, 14px); letter-spacing: .04em; }
    .vp .pay span { color: #ffd88a; text-transform: uppercase; }
    .vp .pay b { color: #fff; text-align: right; font-variant-numeric: tabular-nums; }
    .vp .pay .on { color: #04130b; background: var(--gold); border-radius: 4px; padding-inline: 6px; }
    .vp .hand { display: flex; gap: clamp(6px, 1.4vw, 14px); align-self: center; }
    .vp .slot { display: grid; justify-items: center; gap: 8px; cursor: pointer; }
    .vp .slot .tag { font-family: var(--f-display); font-weight: 700; font-size: 13px; letter-spacing: .12em; padding: 2px 10px; border-radius: 999px; background: var(--gold); color: #2b1400; visibility: hidden; }
    .vp .slot.held .tag { visibility: visible; }
    .vp .slot.held .card { transform: translateY(-10px); }
    .vp .slot .card { width: var(--cw); }
    .vp .slot .empty { width: var(--cw); aspect-ratio: 5/7; border-radius: 10px; border: 2px dashed rgba(255,255,255,.25); }
    .vp .msg { font-family: var(--f-display); font-weight: 700; font-size: clamp(18px, 3vw, 30px); letter-spacing: .08em; color: var(--gold); min-height: 36px; text-shadow: 0 0 18px rgba(255,197,61,.5); }
  `));

  const payRows = {};
  const pay = h('div', { class: 'pay', 'aria-label': `Paytable ${data.variant}` });
  data.hands.filter((k) => k !== 'nothing').forEach((k) => { const s = h('span', {}, LABEL[k]), b = h('b', {}, String(pt[k])); payRows[k] = [s, b]; pay.append(s, b); });
  const slots = Array.from({ length: 5 }, (_, i) => {
    const el = h('div', { class: 'slot', role: 'button', tabindex: '0', 'aria-label': `Card ${i + 1}, tap to hold` }, h('div', { class: 'empty' }), h('span', { class: 'tag' }, 'HELD'));
    const toggle = () => { if (!st.round || st.busy) return; st.hold[i] = !st.hold[i]; el.classList.toggle('held', st.hold[i]); sound.click(); };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); } });
    return el;
  });
  const msg = h('div', { class: 'msg', role: 'status' }, `JACKS OR BETTER ${data.variant}`);
  const box = h('div', { class: 'vp' }, pay, h('div', { class: 'hand' }, slots), msg);
  shell.stage.append(box);

  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const btn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Deal');
  const info = ui.stats([['variant', 'Paytable'], ['rtp', 'Optimal RTP']]);
  info.set('variant', data.variant); info.set('rtp', `${(init.game.rtp * 100).toFixed(2)}%`);
  shell.controls.append(amount.el, btn, info.el);

  const cw = () => Math.max(56, Math.min(120, (stage.w - 80) / 5.6, stage.h / 3.6));
  box.style.setProperty('--cw', `${cw()}px`);
  new ResizeObserver(() => box.style.setProperty('--cw', `${cw()}px`)).observe(shell.stage);
  const highlight = (k) => Object.entries(payRows).forEach(([key, els]) => els.forEach((e) => e.classList.toggle('on', key === k)));

  async function show(hand, replaceMask, animate = true) {
    const w = cw(); box.style.setProperty('--cw', `${w}px`);
    for (let i = 0; i < 5; i++) {
      if (!replaceMask[i]) continue;
      const el = slots[i];
      el.querySelector('.card, .empty')?.remove();
      const holder = document.createElement('div');
      el.prepend(holder);
      if (animate) { sound.flip(); await deal(holder, hand[i], { w, dy: -220 }); await wait(0.04); }
      else await deal(holder, hand[i], { w, dy: 0 });
      holder.replaceWith(holder.firstChild);
    }
  }

  function render() {
    const live = !!st.round;
    amount.disabled = live || st.busy;
    btn.disabled = st.busy;
    btn.className = `btn ${live ? 'btn-cash' : 'btn-bet'}`;
    btn.textContent = live ? 'Draw' : 'Deal';
  }

  async function dealHand() {
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return; }
    st.busy = true; render(); highlight(null); msg.textContent = ''; sound.bet();
    st.hold = [false, false, false, false, false];
    slots.forEach((s) => s.classList.remove('held'));
    let r;
    try { r = await api.roundStart(bet, {}); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; render(); return; }
    shell.wallet.sync(r.balance);
    await show(r.result.hand, [true, true, true, true, true]);
    st.round = r;
    if (r.result.dealt !== 'nothing') { highlight(r.result.dealt); msg.textContent = `YOU HAVE ${LABEL[r.result.dealt].toUpperCase()}`; }
    else msg.textContent = 'TAP CARDS TO HOLD';
    st.busy = false; render();
  }

  async function draw() {
    st.busy = true; render();
    let r;
    try { r = await api.roundAct({ hold: st.hold }); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; render(); return; }
    await show(r.result.final, st.hold.map((x) => !x));
    st.round = null;
    const k = r.result.result;
    highlight(k === 'nothing' ? null : k);
    msg.textContent = k === 'nothing' ? 'NO WIN' : `${LABEL[k].toUpperCase()} · ${money.fmt(r.payout)}`;
    msg.style.color = k === 'nothing' ? 'var(--red)' : 'var(--gold)';
    shell.wallet.sync(r.balance);
    if (r.payout > 0) {
      sound.win(r.multiplier >= 25 ? 3 : r.multiplier >= 4 ? 2 : 1);
      stage.particles.spark(stage.w / 2, stage.h * 0.55, { count: 40, color: '#ffc53d', speed: 320 });
      if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
    } else sound.lose();
    ui.pushResult(shell.strip, r.multiplier, r.payout > r.bet ? 'win' : r.payout === r.bet ? 'mid' : 'loss');
    st.busy = false; render();
    setTimeout(() => { if (!st.round) msg.style.color = ''; }, 2500);
  }

  btn.addEventListener('click', () => (st.round ? draw() : dealHand()));
  if (init.open_round) {
    st.round = init.open_round;
    show(st.round.result.hand, [true, true, true, true, true], false).then(() => { msg.textContent = 'TAP CARDS TO HOLD'; render(); });
  }
  render();
}
