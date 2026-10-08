// Teen Patti client: Player A vs Player B, three cards each, hand names and Pair Plus.
import { deal, felt, flip } from '../sdk/cards.js';
import { wait } from '../sdk/fx.js';
import { beadRoad, chipTable } from '../sdk/table.js';

export const rules = `
<p>Two hands of three cards are dealt: <b>Player A</b> and <b>Player B</b>. The better Teen Patti hand wins: Trail (three of a kind) &gt; Pure Sequence &gt; Sequence &gt; Colour &gt; Pair &gt; High Card. A-K-Q is the top sequence, A-2-3 the second. Identical hands are split by suit.</p>
<p><b>Pair Plus</b> is a side bet on Player A's hand: it pays for a pair or better whoever wins.</p>`;

const NAMES = { trail: 'Trail', pure_sequence: 'Pure Sequence', sequence: 'Sequence', colour: 'Colour', pair: 'Pair', high_card: 'High Card' };

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const data = init.game.data;
  const st = { busy: false };
  felt(stage, '#5a0f2c');

  document.head.append(h('style', {}, `
    .tp { position: absolute; inset: 52px 14px 14px; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 14px; justify-items: center; z-index: 1; }
    .tp .players { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(14px, 5vw, 60px); align-self: center; }
    .tp .pl { display: grid; justify-items: center; gap: 10px; padding: 14px; border-radius: 18px; border: 1px solid rgba(255,215,120,.25); background: rgba(0,0,0,.18); transition: box-shadow .3s, border-color .3s; }
    .tp .pl h3 { margin: 0; font-family: var(--f-display); letter-spacing: .12em; font-size: clamp(15px, 2.4vw, 22px); }
    .tp .pl .row { display: flex; gap: 6px; min-height: calc(var(--cw) * 1.4); }
    .tp .pl .hn { font-weight: 700; color: rgba(255,255,255,.8); min-height: 20px; }
    .tp .pl.won { border-color: var(--gold); box-shadow: 0 0 34px rgba(255,197,61,.45); }
    .tp .pl.won .hn { color: var(--gold); }
    .tp .spots { grid-template-columns: 1.2fr 1fr 1.2fr; }
    .pp { display: grid; gap: 4px; }
    .pp div { display: flex; justify-content: space-between; padding: 6px 10px; border-radius: 9px; background: var(--bg-0); border: 1px solid var(--line); font-size: 13px; }
    .pp div b { font-family: var(--f-display); }
    .pp div.hit { border-color: var(--gold); background: rgba(255,197,61,.12); }
  `));

  const mk = (name, color) => { const row = h('div', { class: 'row' }), hn = h('div', { class: 'hn' }); return { row, hn, el: h('div', { class: 'pl' }, h('h3', { style: `color:${color}` }, name), row, hn) }; };
  const A = mk('PLAYER A', '#ffc53d'), B = mk('PLAYER B', '#b18cff');
  const ct = chipTable({ money, init, sound, ui, onChange: (t) => { info.set('total', money.fmt(t)); btn.disabled = st.busy || !t; },
    spots: [
      { key: 'a', label: 'Player A', sub: `${data.main}×`, style: 'border-color:#ffc53d' },
      { key: 'pair_plus', label: 'Pair Plus', sub: 'on A' },
      { key: 'b', label: 'Player B', sub: `${data.main}×`, style: 'border-color:#b18cff' },
    ] });
  const box = h('div', { class: 'tp' }, h('div', { class: 'players' }, A.el, B.el), h('div', { class: 'spots' }, ct.spotNodes));
  shell.stage.append(box);
  const ppRows = {};
  const pp = h('div', { class: 'pp' }, ['trail', 'pure_sequence', 'sequence', 'colour', 'pair'].map((k) => (ppRows[k] = h('div', {}, h('span', {}, NAMES[k]), h('b', {}, `${data.pair_plus[k]}×`)))));
  const btn = h('button', { class: 'btn btn-bet', type: 'button', disabled: true }, 'Deal');
  const info = ui.stats([['total', 'Total bet'], ['last', 'Last winner']]);
  const road = beadRoad({ a: '#c99a00', b: '#6b3fd6' });
  info.set('total', money.fmt(0));
  shell.controls.append(...ct.controls, btn, info.el, h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Pair Plus pays'), pp), road.el);

  const cw = () => Math.max(56, Math.min(100, stage.w / 9, stage.h / 4.6));
  box.style.setProperty('--cw', `${cw()}px`);
  async function play() {
    const amount = ct.total();
    if (!amount || st.busy) return;
    if (amount > shell.wallet.available) { ui.toast('Not enough balance for these chips', 'err'); return; }
    st.busy = true; ct.lock(true); btn.disabled = true; sound.bet();
    [A, B].forEach((p) => { p.el.classList.remove('won'); p.row.replaceChildren(); p.hn.textContent = ''; });
    Object.values(ppRows).forEach((x) => x.classList.remove('hit'));
    let r;
    try { r = await api.bet(amount, { chips: ct.chips() }); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; ct.lock(false); btn.disabled = false; return; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    const w = cw(); box.style.setProperty('--cw', `${w}px`);
    const res = r.result, els = { a: [], b: [] };
    for (let i = 0; i < 3; i++) {
      for (const [p, key] of [[A, 'a'], [B, 'b']]) { sound.tick(); els[key].push(await deal(p.row, res[key][i], { w, down: true, dy: -200, dx: key === 'a' ? 140 : -140 })); }
    }
    await wait(0.3);
    for (const key of ['a', 'b']) {
      els[key].forEach((el) => { flip(el); });
      sound.flip();
      (key === 'a' ? A : B).hn.textContent = NAMES[res[`${key}_hand`]];
      await wait(0.5);
    }
    const win = res.winner === 'a' ? A : B;
    win.el.classList.add('won');
    const winners = [res.winner];
    if (data.pair_plus[res.a_hand] > 0) { winners.push('pair_plus'); ppRows[res.a_hand]?.classList.add('hit'); }
    ct.mark(winners);
    road.push(res.winner, res.winner.toUpperCase());
    info.set('last', `Player ${res.winner.toUpperCase()} · ${NAMES[res[`${res.winner}_hand`]]}`);
    const rc = win.el.getBoundingClientRect(), sr = shell.stage.getBoundingClientRect();
    stage.particles.spark(rc.left - sr.left + rc.width / 2, rc.top - sr.top + 20, { count: 40, color: '#ffc53d', speed: 300 });
    if (r.payout > 0) { sound.win(r.multiplier >= 5 ? 2 : 1); stage.particles.text(stage.w / 2, stage.h * 0.55, `+${money.fmt(r.payout)}`, { color: '#1fe58f', size: 28 }); }
    else sound.lose();
    if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
    shell.wallet.release(r.payout);
    ui.pushResult(shell.strip, r.multiplier, r.payout > r.bet ? 'win' : 'loss');
    st.busy = false; ct.lock(false); btn.disabled = !ct.total();
  }
  btn.addEventListener('click', play);
}
