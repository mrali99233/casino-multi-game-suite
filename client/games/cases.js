// Cases client: a horizontal reel of items spins and slows down onto the won item.
import { fmtMult } from '../sdk/api.js';
import { ease, glow, starfield, tween } from '../sdk/fx.js';

export const rules = `
<p>Pick a case and open it: the reel spins through items and stops on your prize. Every case holds seven items, from common to a rare jackpot; harder cases have bigger jackpots and more empty items.</p>
<p>Item chances are fixed per case and the multipliers are set so the case returns its RTP.</p>`;

const TIER_COLORS = ['#5d6299', '#4aa8ff', '#1fe58f', '#b18cff', '#ff3d81', '#ff8a1f', '#ffc53d'];
const TIER_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Mythic', 'Legendary', 'Jackpot'];

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const D = init.game.data;
  const st = { diff: 'medium', busy: false };

  document.head.append(h('style', {}, `
    .cs { position: absolute; inset: 52px 14px 14px; display: grid; grid-template-rows: auto auto auto; gap: 18px; align-content: center; justify-items: center; z-index: 1; }
    .cs .chest { width: 120px; height: 90px; position: relative; }
    .cs .window { position: relative; width: min(100%, 900px); height: 150px; overflow: hidden; border-radius: 16px; background: rgba(7,8,26,.7); border: 1px solid var(--line-strong); mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent); }
    .cs .track { position: absolute; top: 15px; left: 0; display: flex; gap: 10px; will-change: transform; }
    .cs .item { width: 110px; height: 120px; flex: none; border-radius: 12px; display: grid; place-items: center; align-content: center; gap: 6px; background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(0,0,0,.25)); border-bottom: 4px solid var(--c); box-shadow: inset 0 0 30px -10px var(--c); }
    .cs .item b { font-family: var(--f-display); font-size: 22px; }
    .cs .item span { font-size: 11px; font-weight: 700; letter-spacing: .08em; color: var(--c); text-transform: uppercase; }
    .cs .item i { width: 34px; height: 34px; border-radius: 9px; background: radial-gradient(circle at 35% 35%, #fff, var(--c) 60%); box-shadow: 0 0 18px var(--c); transform: rotate(45deg); }
    .cs .item.won { animation: wonitem 1s ease-in-out 3; }
    @keyframes wonitem { 50% { transform: scale(1.08); box-shadow: inset 0 0 40px -6px var(--c), 0 0 30px var(--c); } }
    .cs .marker { position: absolute; top: 0; bottom: 0; left: 50%; width: 3px; transform: translateX(-50%); background: var(--gold); box-shadow: 0 0 14px var(--gold); z-index: 2; }
    .cs .marker::before, .cs .marker::after { content: ""; position: absolute; left: 50%; transform: translateX(-50%); border: 9px solid transparent; }
    .cs .marker::before { top: 0; border-top-color: var(--gold); }
    .cs .marker::after { bottom: 0; border-bottom-color: var(--gold); }
    .cs .res { font-family: var(--f-display); font-weight: 700; font-size: clamp(20px, 3vw, 32px); letter-spacing: .06em; min-height: 40px; }
    .ctab { display: grid; gap: 4px; }
    .ctab .r { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto 64px; gap: 8px; align-items: center; padding: 6px 10px; border-radius: 9px; background: var(--bg-0); border: 1px solid var(--line); font-size: 12px; }
    .ctab .r i { width: 10px; height: 10px; border-radius: 3px; }
    .ctab .r em { font-style: normal; color: var(--dim); font-variant-numeric: tabular-nums; }
    .ctab .r b { font-family: var(--f-display); text-align: right; }
  `));

  const track = h('div', { class: 'track' });
  const res = h('div', { class: 'res', role: 'status' }, 'Open a case');
  shell.stage.append(h('div', { class: 'cs' }, h('div', { class: 'window' }, track, h('div', { class: 'marker' })), res));

  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100), label: 'Case price' });
  const diff = ui.segmented('Case', Object.keys(D).map((d) => [d, d[0].toUpperCase() + d.slice(1)]), st.diff, (v) => { st.diff = v; renderTable(); idle(); });
  const btn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Open case');
  const table = h('div', { class: 'ctab' });
  shell.controls.append(amount.el, diff.el, btn, h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Contents', h('em', {}, 'chance')), table));

  function renderTable() {
    const t = D[st.diff];
    table.replaceChildren(...t.multipliers.map((m, i) => h('div', { class: 'r' }, h('i', { style: `background:${TIER_COLORS[i]}` }), h('span', {}, TIER_NAMES[i]), h('em', {}, `${+(t.odds[i] * 100).toFixed(2)}%`), h('b', {}, fmtMult(m)))).reverse());
  }
  const itemEl = (i) => h('div', { class: 'item', style: `--c:${TIER_COLORS[i]}` }, h('i'), h('b', {}, fmtMult(D[st.diff].multipliers[i])), h('span', {}, TIER_NAMES[i]));
  function randomTier() { const o = D[st.diff].odds; let r = Math.random(), i = 0; while (i < o.length - 1 && r >= o[i]) { r -= o[i]; i++; } return i; }
  // cosmetic reel: weight rarer items up a little so the reel looks exciting
  function filler() { const r = Math.random(); return r < 0.15 ? 4 + Math.floor(Math.random() * 3) : randomTier(); }
  function idle() { track.style.transform = 'translateX(0)'; track.replaceChildren(...Array.from({ length: 14 }, () => itemEl(filler()))); }
  renderTable(); idle();

  async function open() {
    if (st.busy) return;
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this case', 'err'); return; }
    st.busy = true; btn.disabled = true; diff.disabled = true; amount.disabled = true; res.textContent = ''; sound.bet();
    let r;
    try { r = await api.bet(bet, { difficulty: st.diff }); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; btn.disabled = false; diff.disabled = false; amount.disabled = false; return; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    const WIN = 48, items = Array.from({ length: 56 }, (_, i) => (i === WIN ? r.result.item : filler()));
    track.style.transform = 'translateX(0)';
    track.replaceChildren(...items.map(itemEl));
    const win = track.children[WIN];
    const winCenter = win.offsetLeft + win.offsetWidth / 2;
    const view = track.parentElement.clientWidth;
    const jitter = (Math.random() - 0.5) * win.offsetWidth * 0.7;
    const end = -(winCenter - view / 2 + jitter);
    const box = { x: 0 };
    let lastIdx = -1;
    const step = win.offsetWidth + 10;
    await tween(box, { x: end }, { dur: 5.4, ease: ease.outQuint, onUpdate: () => {
      track.style.transform = `translateX(${box.x}px)`;
      const idx = Math.floor((-box.x + view / 2) / step);
      if (idx !== lastIdx) { lastIdx = idx; sound.tick(1.1); }
    } });
    await tween(box, { x: end + jitter }, { dur: 0.45, ease: ease.inOutCubic, onUpdate: () => { track.style.transform = `translateX(${box.x}px)`; } });
    win.classList.add('won');
    const tier = r.result.item;
    res.textContent = `${TIER_NAMES[tier].toUpperCase()} · ${fmtMult(r.multiplier)} · ${money.fmt(r.payout)}`;
    res.style.color = TIER_COLORS[tier];
    if (r.payout > r.bet) {
      sound.win(tier >= 5 ? 3 : 1);
      stage.particles.spark(stage.w / 2, stage.h / 2, { count: 60, color: TIER_COLORS[tier], speed: 360 });
      if (tier >= 4) stage.particles.confetti(stage.w / 2, stage.h * 0.45, { count: 100 });
      if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
    } else sound.lose();
    shell.wallet.release(r.payout);
    ui.pushResult(shell.strip, r.multiplier, r.payout > r.bet ? 'win' : 'loss');
    st.busy = false; btn.disabled = false; diff.disabled = false; amount.disabled = false;
  }
  btn.addEventListener('click', open);

  const stars = starfield(70);
  stage.draw((ctx, dt, W, H, t) => { stars(ctx, dt, W, H, t); glow(ctx, W / 2, H / 2, Math.max(W, H) * 0.5, '#ffc53d', 0.08); });
}
