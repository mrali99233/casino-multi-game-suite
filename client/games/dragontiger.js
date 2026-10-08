// Dragon Tiger client: one card each, higher rank wins.
import { deal, felt } from '../sdk/cards.js';
import { wait } from '../sdk/fx.js';
import { beadRoad, chipTable } from '../sdk/table.js';

export const rules = `
<p>One card is dealt to <b>Dragon</b> and one to <b>Tiger</b>; the higher rank wins (Ace low, King high, suits don't matter). Bet on Dragon, Tiger or Tie.</p>
<p>On a tie, Dragon and Tiger bets get half their stake back. Payouts are tuned to the game's RTP.</p>`;

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const ret = init.game.data.returns;
  const st = { busy: false };
  felt(stage, '#4a1f5a');

  document.head.append(h('style', {}, `
    .dt { position: absolute; inset: 52px 14px 14px; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 14px; justify-items: center; z-index: 1; }
    .dt .duel { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: clamp(14px, 4vw, 50px); align-self: center; }
    .dt .side { display: grid; justify-items: center; gap: 12px; }
    .dt .side h3 { margin: 0; font-family: var(--f-display); font-size: clamp(18px, 3vw, 30px); letter-spacing: .14em; }
    .dt .dragon h3 { color: #ff6b4a; text-shadow: 0 0 20px rgba(255,107,74,.6); }
    .dt .tiger h3 { color: #4ad7ff; text-shadow: 0 0 20px rgba(74,215,255,.6); }
    .dt .slot { width: var(--cw); aspect-ratio: 5 / 7; border-radius: 12px; border: 2px dashed rgba(255,255,255,.25); display: grid; place-items: center; }
    .dt .vs { font-family: var(--f-display); font-weight: 700; font-size: clamp(26px, 5vw, 54px); color: var(--gold); text-shadow: 0 0 24px rgba(255,197,61,.7); }
    .dt .side.won .slot .card .f { box-shadow: 0 0 0 4px var(--gold), 0 0 40px rgba(255,197,61,.8); }
    .dt .spots { grid-template-columns: 1.3fr 1fr 1.3fr; }
  `));

  const dSlot = h('div', { class: 'slot' }), tSlot = h('div', { class: 'slot' });
  const dSide = h('div', { class: 'side dragon' }, h('h3', {}, 'DRAGON'), dSlot);
  const tSide = h('div', { class: 'side tiger' }, h('h3', {}, 'TIGER'), tSlot);
  const ct = chipTable({ money, init, sound, ui, onChange: (t) => { info.set('total', money.fmt(t)); btn.disabled = st.busy || !t; },
    spots: [
      { key: 'dragon', label: 'Dragon', sub: `${ret.dragon}×`, style: 'border-color:#ff6b4a' },
      { key: 'tie', label: 'Tie', sub: `${ret.tie}×`, style: 'border-color:#1fe58f' },
      { key: 'tiger', label: 'Tiger', sub: `${ret.tiger}×`, style: 'border-color:#4ad7ff' },
    ] });
  const box = h('div', { class: 'dt' }, h('div', { class: 'duel' }, dSide, h('div', { class: 'vs' }, 'VS'), tSide), h('div', { class: 'spots' }, ct.spotNodes));
  shell.stage.append(box);
  const btn = h('button', { class: 'btn btn-bet', type: 'button', disabled: true }, 'Deal');
  const info = ui.stats([['total', 'Total bet'], ['last', 'Last result']]);
  const road = beadRoad({ dragon: '#d9481f', tiger: '#1f8fd9', tie: '#0a8f58' });
  info.set('total', money.fmt(0));
  shell.controls.append(...ct.controls, btn, info.el, road.el);

  const cw = () => Math.max(80, Math.min(150, stage.w / 5.5, stage.h / 3.4));
  box.style.setProperty('--cw', `${cw()}px`);
  async function play() {
    const amount = ct.total();
    if (!amount || st.busy) return;
    if (amount > shell.wallet.available) { ui.toast('Not enough balance for these chips', 'err'); return; }
    st.busy = true; ct.lock(true); btn.disabled = true; sound.bet();
    [dSide, tSide].forEach((s) => s.classList.remove('won'));
    dSlot.replaceChildren(); tSlot.replaceChildren();
    let r;
    try { r = await api.bet(amount, { chips: ct.chips() }); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; ct.lock(false); btn.disabled = false; return; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    const w = cw(); box.style.setProperty('--cw', `${w}px`);
    sound.flip(); await deal(dSlot, r.result.dragon, { w, dx: 160, dy: -240 });
    await wait(0.35);
    sound.flip(); await deal(tSlot, r.result.tiger, { w, dx: -160, dy: -240 });
    await wait(0.25);
    const win = r.result.winner;
    if (win !== 'tie') {
      const side = win === 'dragon' ? dSide : tSide;
      side.classList.add('won');
      const rc = side.getBoundingClientRect(), sr = shell.stage.getBoundingClientRect();
      stage.particles.spark(rc.left - sr.left + rc.width / 2, rc.top - sr.top + rc.height / 2, { count: 50, color: win === 'dragon' ? '#ff6b4a' : '#4ad7ff', speed: 340 });
    } else stage.particles.confetti(stage.w / 2, stage.h * 0.4, { count: 60 });
    ct.mark([win]);
    road.push(win, win[0].toUpperCase());
    info.set('last', win);
    if (r.payout > 0) { sound.win(win === 'tie' ? 2 : 1); stage.particles.text(stage.w / 2, stage.h * 0.62, `+${money.fmt(r.payout)}`, { color: '#1fe58f', size: 28 }); }
    else sound.lose();
    if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
    shell.wallet.release(r.payout);
    ui.pushResult(shell.strip, r.multiplier, r.payout > r.bet ? 'win' : 'loss');
    st.busy = false; ct.lock(false); btn.disabled = !ct.total();
  }
  btn.addEventListener('click', play);
}
