// Baccarat client: felt table, Player and Banker hands dealt and flipped, bead road.
import { deal, felt } from '../sdk/cards.js';
import { wait } from '../sdk/fx.js';
import { beadRoad, chipTable } from '../sdk/table.js';

export const rules = `
<p>Bet on the hand you think will finish closer to 9: <b>Player</b> or <b>Banker</b>, or on a <b>Tie</b>. Cards count face value, aces 1, tens and faces 0; only the last digit of the total counts.</p>
<p>Third cards follow the standard punto banco table. Player pays 1:1, Banker 0.95:1, Tie 8:1 (Player and Banker bets are returned on a tie). Pair bets pay 11:1 when that hand's first two cards share a rank.</p>`;

const VALUE = (id) => Math.min(id % 13 + 1, 10) % 10;

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const ret = init.game.data.returns;
  const st = { busy: false };
  felt(stage, '#0f4d5a');

  document.head.append(h('style', {}, `
    .bac { position: absolute; inset: 52px 14px 14px; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 14px; justify-items: center; z-index: 1; }
    .bac .hands { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(12px, 4vw, 48px); align-self: center; width: min(100%, 760px); }
    .bac .hand { display: grid; justify-items: center; gap: 10px; }
    .bac .hand header { display: flex; align-items: center; gap: 10px; font-family: var(--f-display); font-weight: 700; letter-spacing: .1em; font-size: clamp(14px, 2vw, 20px); }
    .bac .hand header .tot { min-width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; font-size: 20px; background: rgba(0,0,0,.35); border: 2px solid currentColor; }
    .bac .p { --c: #5aa8ff; } .bac .b { --c: #ff6b81; }
    .bac .hand header { color: var(--c); }
    .bac .row { display: flex; gap: 8px; min-height: calc(var(--cw) * 1.4); align-items: center; }
    .bac .hand.won header .tot { background: var(--c); border-color: var(--c); color: #04130b; box-shadow: 0 0 22px var(--c); }
    .bac .banner { position: absolute; top: 12%; left: 50%; transform: translate(-50%, -50%); font-family: var(--f-display); font-weight: 700; font-size: clamp(22px, 4vw, 40px); letter-spacing: .08em; padding: 10px 26px; border-radius: 16px; background: rgba(4,10,20,.75); border: 2px solid var(--gold); color: var(--gold); white-space: nowrap; animation: pop .4s cubic-bezier(.2,1.5,.4,1); }
    .bac .spots { grid-template-columns: 1fr 1.3fr 1fr 1.3fr 1fr; }
  `));

  const pRow = h('div', { class: 'row' }), bRow = h('div', { class: 'row' });
  const pTot = h('span', { class: 'tot' }, '–'), bTot = h('span', { class: 'tot' }, '–');
  const pHand = h('div', { class: 'hand p' }, h('header', {}, 'PLAYER', pTot), pRow);
  const bHand = h('div', { class: 'hand b' }, h('header', {}, 'BANKER', bTot), bRow);
  const ct = chipTable({ money, init, sound, ui, onChange: (t) => { info.set('total', money.fmt(t)); btn.disabled = st.busy || !t; },
    spots: [
      { key: 'player_pair', label: 'P Pair', sub: `${ret.pair}×` },
      { key: 'player', label: 'Player', sub: `${ret.player}×`, style: 'border-color:#5aa8ff' },
      { key: 'tie', label: 'Tie', sub: `${ret.tie}×`, style: 'border-color:#1fe58f' },
      { key: 'banker', label: 'Banker', sub: `${ret.banker}×`, style: 'border-color:#ff6b81' },
      { key: 'banker_pair', label: 'B Pair', sub: `${ret.pair}×` },
    ] });
  const box = h('div', { class: 'bac' }, h('div', { class: 'hands' }, pHand, bHand), h('div', { class: 'spots' }, ct.spotNodes));
  shell.stage.append(box);

  const btn = h('button', { class: 'btn btn-bet', type: 'button', disabled: true }, 'Deal');
  const info = ui.stats([['total', 'Total bet'], ['last', 'Last result']]);
  const road = beadRoad({ player: '#2f6bff', banker: '#c4123a', tie: '#0a8f58' });
  shell.controls.append(...ct.controls, btn, info.el, road.el);
  info.set('total', money.fmt(0));

  const cw = () => Math.max(56, Math.min(96, stage.w / 10, stage.h / 5.5));
  async function play() {
    const amount = ct.total();
    if (!amount || st.busy) return;
    if (amount > shell.wallet.available) { ui.toast('Not enough balance for these chips', 'err'); return; }
    st.busy = true; ct.lock(true); btn.disabled = true; sound.bet();
    box.querySelector('.banner')?.remove();
    [pHand, bHand].forEach((x) => x.classList.remove('won'));
    pRow.replaceChildren(); bRow.replaceChildren(); pTot.textContent = '–'; bTot.textContent = '–';
    let r;
    try { r = await api.bet(amount, { chips: ct.chips() }); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; ct.lock(false); btn.disabled = false; return; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    const w = cw(); box.style.setProperty('--cw', `${w}px`);
    const res = r.result, P = res.player, B = res.banker;
    const sum = (cs) => cs.reduce((a, c) => a + VALUE(c), 0) % 10;
    const order = [[pRow, P[0]], [bRow, B[0]], [pRow, P[1]], [bRow, B[1]]];
    for (const [row, c] of order) { sound.flip(); await deal(row, c, { w, dy: -260, dx: row === pRow ? 120 : -120 }); }
    pTot.textContent = sum(P.slice(0, 2)); bTot.textContent = sum(B.slice(0, 2));
    if (P[2] !== undefined) { await wait(0.4); sound.flip(); await deal(pRow, P[2], { w, cls: 'side', dy: -260 }); pTot.textContent = sum(P); }
    if (B[2] !== undefined) { await wait(0.4); sound.flip(); await deal(bRow, B[2], { w, cls: 'side', dy: -260 }); bTot.textContent = sum(B); }
    await wait(0.3);
    const label = res.winner === 'tie' ? `TIE ${res.player_total} – ${res.banker_total}` : `${res.winner.toUpperCase()} WINS ${Math.max(res.player_total, res.banker_total)} – ${Math.min(res.player_total, res.banker_total)}`;
    box.append(h('div', { class: 'banner', role: 'status' }, label));
    if (res.winner !== 'tie') (res.winner === 'player' ? pHand : bHand).classList.add('won');
    const winners = [res.winner];
    if (res.player_pair) winners.push('player_pair');
    if (res.banker_pair) winners.push('banker_pair');
    ct.mark(winners);
    road.push(res.winner, res.winner[0].toUpperCase());
    info.set('last', `${res.winner} ${res.player_total}–${res.banker_total}`);
    if (r.payout > 0) {
      sound.win(r.payout > r.bet * 3 ? 2 : 1);
      stage.particles.text(stage.w / 2, stage.h * 0.55, `+${money.fmt(r.payout)}`, { color: '#1fe58f', size: 28, life: 1.6 });
      if (r.payout > r.bet) stage.particles.coins(stage.w / 2, stage.h, { count: 20 });
      if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
    } else sound.lose();
    shell.wallet.release(r.payout);
    ui.pushResult(shell.strip, r.multiplier, r.payout > r.bet ? 'win' : 'loss');
    st.busy = false; ct.lock(false); btn.disabled = !ct.total();
  }
  btn.addEventListener('click', play);
}
