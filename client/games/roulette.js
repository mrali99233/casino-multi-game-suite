// European roulette client: canvas wheel with ball physics-style landing, DOM betting table.
import { clamp, ease, glow, starfield, tween } from '../sdk/fx.js';

export const rules = `
<p>European single-zero roulette. Place chips on numbers or outside bets, then spin. Payouts include your stake: straight number 36×, dozens and columns 3×, red/black, odd/even, 1–18/19–36 2×. Zero loses all outside bets.</p>
<p>The return is fixed by the rules at 36/37 = 97.30%. Your chips stay on the table after each spin so you can repeat the bet.</p>`;

const TAU = Math.PI * 2;
const CHIP_COLORS = { 10: '#8d93c7', 100: '#22d3ee', 500: '#ff3d81', 2500: '#1fe58f', 10000: '#ffc53d' };

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const { wheel: WHEEL, red } = init.game.data;
  const RED = new Set(red);
  const SEG = TAU / WHEEL.length;
  const colourOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
  const st = { wa: 0, ba: -Math.PI / 2, br: 0.88, spinning: false, result: null, glowT: 0, chips: new Map(), undo: [], chip: 100 };

  document.head.append(h('style', {}, `
    .roul { position: absolute; left: 12px; right: 12px; bottom: 12px; top: 54%; display: grid; place-items: center; z-index: 1; }
    .rtable { display: grid; grid-template-columns: 1.15fr repeat(12, 1fr) 1.15fr; grid-template-rows: repeat(3, minmax(30px, 1fr)) minmax(28px, .8fr) minmax(28px, .8fr); gap: 3px; width: min(100%, 860px); height: 100%; max-height: 300px; padding: 8px; border-radius: 16px; background: radial-gradient(120% 120% at 50% 0%, #0f5a3c, #083726); box-shadow: inset 0 0 0 2px rgba(255,197,61,.35), 0 18px 40px -20px rgba(0,0,0,.9); }
    .rc { position: relative; border: 0; border-radius: 6px; color: #fff; font-family: var(--f-display); font-weight: 700; font-size: clamp(11px, 1.6vw, 16px); background: rgba(255,255,255,.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,.18); transition: filter .15s, box-shadow .2s, transform .1s; padding: 0; min-width: 0; }
    .rc:hover:not(:disabled) { filter: brightness(1.3); }
    .rc:active:not(:disabled) { transform: scale(.96); }
    .rc.red { background: linear-gradient(180deg, #ff4766, #c4123a); }
    .rc.black { background: linear-gradient(180deg, #2b2f4a, #11131f); }
    .rc.green { background: linear-gradient(180deg, #1fe58f, #0a8f58); color: #04130b; }
    .rc.out { font-size: clamp(10px, 1.3vw, 13px); letter-spacing: .04em; }
    .rc.win { box-shadow: inset 0 0 0 3px #ffc53d, 0 0 22px rgba(255,197,61,.8); animation: rwin .8s ease-in-out 3; z-index: 2; }
    @keyframes rwin { 50% { filter: brightness(1.6); } }
    .rc .chip { position: absolute; right: -4px; top: -6px; min-width: 24px; height: 24px; padding: 0 4px; border-radius: 999px; display: grid; place-items: center; font-size: 10px; color: #0d0f27; border: 2px dashed rgba(255,255,255,.8); box-shadow: 0 3px 6px rgba(0,0,0,.6); pointer-events: none; animation: chipin .25s cubic-bezier(.2,1.6,.4,1); z-index: 3; }
    @keyframes chipin { from { transform: translateY(-14px) scale(.5); opacity: 0; } }
    .chips { display: flex; gap: 8px; flex-wrap: wrap; }
    .chips button { width: 46px; height: 46px; border-radius: 50%; border: 3px dashed rgba(255,255,255,.85); font-family: var(--f-display); font-weight: 700; font-size: 12px; color: #0d0f27; box-shadow: 0 4px 10px rgba(0,0,0,.5); transition: transform .15s; }
    .chips button[aria-pressed="true"] { transform: translateY(-4px) scale(1.08); box-shadow: 0 0 0 3px var(--bg-1), 0 0 0 5px #fff, 0 6px 14px rgba(0,0,0,.6); }
    .rrow { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    @media (max-width: 560px) { .roul { top: 50%; } .rtable { gap: 2px; padding: 5px; } .rc .chip { min-width: 18px; height: 18px; font-size: 8px; } }
  `));

  // ---------- table ----------
  const cells = new Map();
  const table = h('div', { class: 'rtable', role: 'grid', 'aria-label': 'Roulette table' });
  const addCell = (key, bet, label, cls, col, row, colSpan = 1, rowSpan = 1) => {
    const b = h('button', { class: `rc ${cls}`, type: 'button', style: `grid-column:${col} / span ${colSpan};grid-row:${row} / span ${rowSpan}`, 'aria-label': `Bet on ${label}` }, label);
    b.addEventListener('click', () => place(key, bet));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); remove(key); });
    cells.set(key, { el: b, bet });
    table.append(b);
  };
  addCell('n0', { type: 'straight', value: 0 }, '0', 'green', 1, 1, 1, 3);
  for (let n = 1; n <= 36; n++) addCell(`n${n}`, { type: 'straight', value: n }, String(n), colourOf(n), Math.ceil(n / 3) + 1, 3 - ((n - 1) % 3));
  [3, 2, 1].forEach((c, i) => addCell(`c${c}`, { type: 'column', value: c }, '2:1', 'out', 14, i + 1));
  [1, 2, 3].forEach((d) => addCell(`d${d}`, { type: 'dozen', value: d }, `${d === 1 ? '1st' : d === 2 ? '2nd' : '3rd'} 12`, 'out', 2 + (d - 1) * 4, 4, 4));
  [['low', '1–18', 'out'], ['even', 'EVEN', 'out'], ['red', '◆', 'red'], ['black', '◆', 'black'], ['odd', 'ODD', 'out'], ['high', '19–36', 'out']]
    .forEach(([t, label, cls], i) => addCell(t, { type: t }, label, cls, 2 + i * 2, 5, 2));
  shell.stage.append(h('div', { class: 'roul' }, table));

  // ---------- controls ----------
  const values = [10, 100, 500, 2500, 10000].filter((v) => v >= init.game.min_bet && v <= init.game.max_bet);
  st.chip = values.includes(100) ? 100 : values[0];
  const chipBtns = values.map((v) => {
    const b = h('button', { type: 'button', style: `background:${CHIP_COLORS[v]}`, 'aria-pressed': String(v === st.chip), 'aria-label': `Chip ${money.plain(v)}` }, money.plain(v).replace(/\.00$/, ''));
    b.addEventListener('click', () => { st.chip = v; chipBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); sound.click(); });
    return b;
  });
  const undoBtn = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Undo');
  const clearBtn = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Clear');
  const btn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Spin');
  const info = ui.stats([['total', 'Total bet'], ['last', 'Last number']]);
  shell.controls.append(h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Chip value', h('em', {}, 'right-click a spot to remove')), h('div', { class: 'chips' }, chipBtns)),
    h('div', { class: 'rrow' }, undoBtn, clearBtn), btn, info.el);

  const total = () => [...st.chips.values()].reduce((a, c) => a + c, 0);
  function renderChips() {
    cells.forEach(({ el }, key) => {
      el.querySelector('.chip')?.remove();
      const amt = st.chips.get(key);
      if (amt) {
        const top = values.filter((v) => v <= amt).pop() || values[0];
        el.append(h('span', { class: 'chip', style: `background:${CHIP_COLORS[top]}` }, money.plain(amt).replace(/\.00$/, '')));
      }
    });
    info.set('total', money.fmt(total()));
    btn.disabled = st.spinning || !total();
    undoBtn.disabled = st.spinning || !st.undo.length;
    clearBtn.disabled = st.spinning || !st.chips.size;
  }
  function place(key, bet) {
    if (st.spinning) return;
    if (total() + st.chip > init.game.max_bet) { ui.toast(`Table limit is ${money.fmt(init.game.max_bet)}`); return; }
    st.chips.set(key, (st.chips.get(key) || 0) + st.chip);
    st.undo.push([key, st.chip]);
    cells.forEach(({ el }) => el.classList.remove('win'));
    sound.click(); renderChips();
  }
  function remove(key) {
    if (st.spinning || !st.chips.has(key)) return;
    st.chips.delete(key); st.undo = st.undo.filter(([k]) => k !== key); renderChips();
  }
  undoBtn.addEventListener('click', () => {
    const last = st.undo.pop(); if (!last) return;
    const [key, v] = last, left = (st.chips.get(key) || 0) - v;
    left > 0 ? st.chips.set(key, left) : st.chips.delete(key);
    renderChips();
  });
  clearBtn.addEventListener('click', () => { st.chips.clear(); st.undo = []; renderChips(); });
  renderChips();

  function pushNumber(n) {
    shell.strip.prepend(h('span', { class: 'pill', style: `color:#fff;background:${n === 0 ? '#0a8f58' : RED.has(n) ? '#c4123a' : '#20233a'};border-color:transparent` }, String(n)));
    while (shell.strip.children.length > 18) shell.strip.lastChild.remove();
  }

  async function spin() {
    const amount = total();
    if (!amount || st.spinning) return;
    if (amount > shell.wallet.available) { ui.toast('Not enough balance for these chips', 'err'); return; }
    const chips = [...st.chips.entries()].map(([key, amt]) => ({ ...cells.get(key).bet, amount: amt }));
    st.spinning = true; st.result = null; renderChips(); sound.bet();
    cells.forEach(({ el }) => el.classList.remove('win'));
    let r;
    try { r = await api.bet(amount, { chips }); } catch (e) { ui.toast(e.message, 'err'); st.spinning = false; renderChips(); return; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    const n = r.result.number, idx = WHEEL.indexOf(n);
    const dur = 5.2;
    const waEnd = st.wa + TAU * 1.6 + Math.random() * TAU * 0.4;
    let baEnd = waEnd + idx * SEG + SEG / 2;
    while (st.ba - baEnd < TAU * 6) baEnd -= TAU;
    const w = { a: st.wa }, b = { a: st.ba };
    sound.whoosh();
    let lastPocket = -1;
    const p1 = tween(w, { a: waEnd }, { dur, ease: ease.outCubic, onUpdate: () => { st.wa = w.a; } });
    const p2 = tween(b, { a: baEnd }, { dur, ease: ease.outQuart, onUpdate: (_, e) => {
      st.ba = b.a;
      if (e > 0.75) { const pk = Math.floor((st.ba - st.wa) / SEG); if (pk !== lastPocket) { lastPocket = pk; sound.tick(0.9); } }
    } });
    const drop = { r: 0.88 };
    setTimeout(() => tween(drop, { r: 0.7 }, { dur: 1.4, ease: ease.outBounce, onUpdate: () => { st.br = drop.r; } }), dur * 0.62 * 1000);
    await Promise.all([p1, p2]);
    st.br = 0.7; st.result = n; st.glowT = 1;
    sound.land(r.payout > 0 ? 2 : 0);
    pushNumber(n); info.set('last', `${n} ${colourOf(n)}`);
    const winners = new Set(r.result.winning_chips.map((i) => chips[i]));
    [...st.chips.keys()].forEach((key) => { const c = cells.get(key); if ([...winners].some((wc) => wc.type === c.bet.type && wc.value === c.bet.value)) c.el.classList.add('win'); });
    cells.get(`n${n}`).el.classList.add('win');
    const cx = stage.w / 2, cy = wheelCenter().y;
    if (r.payout > 0) {
      sound.win(r.multiplier >= 10 ? 3 : r.payout > r.bet ? 2 : 1);
      stage.particles.spark(cx, cy, { count: 50, color: '#ffc53d', speed: 320 });
      stage.particles.text(cx, cy - 20, `+${money.fmt(r.payout)}`, { color: '#1fe58f', size: 28, life: 1.6 });
      if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
    } else sound.lose();
    shell.wallet.release(r.payout);
    st.spinning = false; renderChips();
  }
  btn.addEventListener('click', spin);

  // ---------- wheel ----------
  const wheelCenter = () => { const top = 52, bottom = stage.h * (stage.w < 560 ? 0.5 : 0.54) - 8; const R = Math.max(60, Math.min(stage.w * 0.42, (bottom - top) / 2)); return { x: stage.w / 2, y: top + (bottom - top) / 2, R }; };
  const stars = starfield(50);
  stage.draw((ctx, dt, W, H, t) => {
    stars(ctx, dt, W, H, t);
    const { x: cx, y: cy, R } = wheelCenter();
    st.glowT = Math.max(0, st.glowT - dt * 0.4);
    glow(ctx, cx, cy, R * 1.7, '#8b5cf6', 0.2);
    ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(cx, cy + 8, R * 1.02, 0, TAU); ctx.fill();
    // wooden/metal rim
    const rim = ctx.createRadialGradient(cx, cy - R * 0.3, R * 0.2, cx, cy, R);
    rim.addColorStop(0, '#6b3d1f'); rim.addColorStop(0.85, '#3a1f0e'); rim.addColorStop(1, '#22120a');
    ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffc53d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R * 0.97, 0, TAU); ctx.stroke();
    // ball track
    ctx.fillStyle = '#1b1d33'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.93, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2a2d4d'; ctx.beginPath(); ctx.arc(cx, cy, R * 0.81, 0, TAU); ctx.fill();
    // pockets
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(st.wa);
    for (let i = 0; i < WHEEL.length; i++) {
      const n = WHEEL[i], a0 = -Math.PI / 2 + i * SEG;
      ctx.fillStyle = n === 0 ? '#0a8f58' : RED.has(n) ? '#c4123a' : '#151726';
      ctx.beginPath(); ctx.arc(0, 0, R * 0.8, a0, a0 + SEG); ctx.arc(0, 0, R * 0.6, a0 + SEG, a0, true); ctx.closePath(); ctx.fill();
      if (st.result === n && !st.spinning) { ctx.fillStyle = `rgba(255,197,61,${0.25 + 0.25 * Math.sin(t * 6)})`; ctx.fill(); }
      ctx.strokeStyle = 'rgba(255,215,120,.55)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.save(); ctx.rotate(a0 + SEG / 2 + Math.PI / 2);
      ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.max(8, R * 0.075)}px "Chakra Petch", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(n), 0, -R * 0.73);
      ctx.restore();
    }
    // cone + turret
    const cone = ctx.createRadialGradient(0, -R * 0.15, R * 0.05, 0, 0, R * 0.6);
    cone.addColorStop(0, '#8a5a32'); cone.addColorStop(1, '#3a1f0e');
    ctx.fillStyle = cone; ctx.beginPath(); ctx.arc(0, 0, R * 0.6, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffc53d'; ctx.lineWidth = Math.max(2, R * 0.025); ctx.lineCap = 'round';
    for (let k = 0; k < 4; k++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -R * 0.3); ctx.stroke(); ctx.fillStyle = '#ffe28a'; ctx.beginPath(); ctx.arc(0, -R * 0.3, R * 0.035, 0, TAU); ctx.fill(); }
    ctx.restore();
    const hub = ctx.createRadialGradient(cx - R * 0.04, cy - R * 0.04, 1, cx, cy, R * 0.12);
    hub.addColorStop(0, '#fff2b0'); hub.addColorStop(1, '#b8740c');
    ctx.fillStyle = hub; ctx.beginPath(); ctx.arc(cx, cy, R * 0.11, 0, TAU); ctx.fill();
    // ball
    const ba = -Math.PI / 2 + st.ba, br = R * st.br;
    const bx = cx + Math.cos(ba) * br, by = cy + Math.sin(ba) * br, bs = Math.max(4, R * 0.045);
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.arc(bx + 2, by + 3, bs, 0, TAU); ctx.fill();
    const bg = ctx.createRadialGradient(bx - bs * 0.4, by - bs * 0.4, 1, bx, by, bs);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, '#a9b0d6');
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(bx, by, bs, 0, TAU); ctx.fill();
    // result badge
    if (st.result !== null && !st.spinning) {
      const c = colourOf(st.result);
      const bxp = cx + R * 1.25, size = clamp(R * 0.42, 34, 64);
      if (bxp + size < W) {
        ctx.fillStyle = c === 'green' ? '#0a8f58' : c === 'red' ? '#c4123a' : '#20233a';
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 24 * (0.5 + st.glowT);
        ctx.beginPath(); ctx.arc(bxp, cy, size, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffc53d'; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = `700 ${size * 0.9}px "Chakra Petch", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(st.result), bxp, cy + 2);
      }
    }
  });
}
