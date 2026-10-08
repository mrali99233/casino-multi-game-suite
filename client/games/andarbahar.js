// Andar Bahar client: joker card, then fast alternating deal until the matching rank appears.
import { card, deal, felt } from '../sdk/cards.js';
import { wait } from '../sdk/fx.js';
import { beadRoad, chipTable } from '../sdk/table.js';

export const rules = `
<p>A joker card is turned face up. Cards are then dealt one at a time, alternately to <b>Andar</b> (first) and <b>Bahar</b>, until a card of the same rank as the joker appears. Bet on the side that receives it.</p>
<p>Andar wins slightly more often because it gets the first card, so it pays a little less. Payouts are tuned to the game's RTP.</p>`;

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const ret = init.game.data.returns, odds = init.game.data.odds;
  const st = { busy: false };
  felt(stage, '#5a3a0f');

  document.head.append(h('style', {}, `
    .ab { position: absolute; inset: 52px 14px 14px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 12px; justify-items: center; z-index: 1; }
    .ab .joker { display: flex; align-items: center; gap: 14px; font-family: var(--f-display); font-weight: 700; letter-spacing: .14em; color: var(--gold); }
    .ab .lanes { display: grid; gap: 12px; width: min(100%, 820px); align-self: center; }
    .ab .lane { display: grid; grid-template-columns: 86px minmax(0, 1fr); align-items: center; gap: 10px; padding: 8px; border-radius: 14px; background: rgba(0,0,0,.2); border: 1px solid rgba(255,215,120,.25); }
    .ab .lane h3 { margin: 0; font-family: var(--f-display); letter-spacing: .1em; font-size: 16px; text-align: center; }
    .ab .lane .fan { display: flex; min-height: calc(var(--cw) * 1.4); align-items: center; overflow: hidden; }
    .ab .lane .fan .card + .card { margin-left: calc(var(--cw) * -.62); }
    .ab .lane.won { border-color: var(--gold); box-shadow: 0 0 26px rgba(255,197,61,.35); }
    .ab .spots { grid-template-columns: 1fr 1fr; }
    .ab .count { color: rgba(255,255,255,.7); font-size: 13px; font-weight: 600; }
  `));

  const jokerSlot = h('div', { style: 'min-height:80px;display:grid;place-items:center' });
  const count = h('span', { class: 'count' }, '');
  const andarFan = h('div', { class: 'fan' }), baharFan = h('div', { class: 'fan' });
  const andar = h('div', { class: 'lane' }, h('h3', { style: 'color:#ff8a1f' }, 'ANDAR'), andarFan);
  const bahar = h('div', { class: 'lane' }, h('h3', { style: 'color:#22d3ee' }, 'BAHAR'), baharFan);
  const ct = chipTable({ money, init, sound, ui, onChange: (t) => { info.set('total', money.fmt(t)); btn.disabled = st.busy || !t; },
    spots: [
      { key: 'andar', label: 'Andar', sub: `${ret.andar}× · ${(odds.andar * 100).toFixed(1)}%`, style: 'border-color:#ff8a1f' },
      { key: 'bahar', label: 'Bahar', sub: `${ret.bahar}× · ${(odds.bahar * 100).toFixed(1)}%`, style: 'border-color:#22d3ee' },
    ] });
  const box = h('div', { class: 'ab' }, h('div', { class: 'joker' }, 'JOKER', jokerSlot, count), h('div', { class: 'lanes' }, andar, bahar), h('div', { class: 'spots' }, ct.spotNodes));
  shell.stage.append(box);
  const btn = h('button', { class: 'btn btn-bet', type: 'button', disabled: true }, 'Deal');
  const info = ui.stats([['total', 'Total bet'], ['last', 'Last result']]);
  const road = beadRoad({ andar: '#d9741f', bahar: '#1f9fb9' });
  info.set('total', money.fmt(0));
  shell.controls.append(...ct.controls, btn, info.el, road.el);

  const cw = () => Math.max(48, Math.min(78, stage.w / 12, stage.h / 7));
  box.style.setProperty('--cw', `${cw()}px`);
  jokerSlot.append(card(null, { w: cw(), down: true }));

  async function play() {
    const amount = ct.total();
    if (!amount || st.busy) return;
    if (amount > shell.wallet.available) { ui.toast('Not enough balance for these chips', 'err'); return; }
    st.busy = true; ct.lock(true); btn.disabled = true; sound.bet();
    [andar, bahar].forEach((l) => l.classList.remove('won'));
    andarFan.replaceChildren(); baharFan.replaceChildren(); count.textContent = '';
    let r;
    try { r = await api.bet(amount, { chips: ct.chips() }); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; ct.lock(false); btn.disabled = false; return; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    const w = cw(); box.style.setProperty('--cw', `${w}px`);
    const res = r.result;
    jokerSlot.replaceChildren();
    sound.flip(); await deal(jokerSlot, res.joker, { w, dy: -120, cls: 'win' });
    await wait(0.4);
    const seq = [];
    for (let i = 0; i < Math.max(res.andar.length, res.bahar.length); i++) {
      if (res.andar[i] !== undefined) seq.push([andarFan, res.andar[i]]);
      if (res.bahar[i] !== undefined) seq.push([baharFan, res.bahar[i]]);
    }
    const step = Math.max(0.06, Math.min(0.22, 2.4 / seq.length));
    for (let i = 0; i < seq.length; i++) {
      const [fan, c] = seq[i];
      const last = i === seq.length - 1;
      sound.tick(fan === andarFan ? 1 : 1.2);
      count.textContent = `${i + 1} card${i ? 's' : ''}`;
      deal(fan, c, { w, dy: -160, cls: last ? 'hot' : '' });
      while (fan.children.length > 14) fan.firstChild.remove();
      await wait(last ? 0.45 : step);
    }
    const lane = res.winner === 'andar' ? andar : bahar;
    lane.classList.add('won');
    const rc = lane.getBoundingClientRect(), sr = shell.stage.getBoundingClientRect();
    stage.particles.spark(rc.right - sr.left - 60, rc.top - sr.top + rc.height / 2, { count: 40, color: '#ffc53d', speed: 300 });
    ct.mark([res.winner]);
    road.push(res.winner, res.winner[0].toUpperCase());
    info.set('last', `${res.winner} · ${seq.length} cards`);
    if (r.payout > 0) { sound.win(1); stage.particles.text(stage.w / 2, stage.h * 0.5, `+${money.fmt(r.payout)}`, { color: '#1fe58f', size: 28 }); }
    else sound.lose();
    shell.wallet.release(r.payout);
    ui.pushResult(shell.strip, r.multiplier, r.payout > r.bet ? 'win' : 'loss');
    st.busy = false; ct.lock(false); btn.disabled = !ct.total();
  }
  btn.addEventListener('click', play);
}
