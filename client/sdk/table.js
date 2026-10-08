// Chip-on-spot betting for table games (Baccarat, Dragon Tiger, Andar Bahar, Teen Patti).
import { h } from './ui.js';

const CHIP_COLORS = { 10: '#8d93c7', 100: '#22d3ee', 500: '#ff3d81', 2500: '#1fe58f', 10000: '#ffc53d' };
let styled = false;

function injectCss() {
  if (styled) return;
  styled = true;
  document.head.append(h('style', {}, `
    .spots { display: grid; gap: 8px; width: min(100%, 760px); }
    .spot { position: relative; border: 2px solid rgba(255,215,120,.45); border-radius: 14px; background: rgba(0,0,0,.18); color: #fff; padding: 10px 6px; display: grid; justify-items: center; gap: 2px; transition: background .15s, box-shadow .25s, transform .1s; min-width: 0; }
    .spot:hover:not(:disabled) { background: rgba(255,255,255,.08); }
    .spot:active:not(:disabled) { transform: scale(.98); }
    .spot b { font-family: var(--f-display); font-size: clamp(13px, 2vw, 18px); letter-spacing: .06em; text-transform: uppercase; }
    .spot span { font-size: 12px; color: rgba(255,255,255,.7); font-weight: 600; font-variant-numeric: tabular-nums; }
    .spot.win { box-shadow: 0 0 0 3px var(--gold), 0 0 28px rgba(255,197,61,.6); background: rgba(255,197,61,.14); animation: spotwin .8s ease-in-out 3; }
    .spot.lose { opacity: .55; }
    @keyframes spotwin { 50% { background: rgba(255,197,61,.3); } }
    .spot .stack { position: absolute; top: -10px; right: -8px; min-width: 30px; height: 30px; padding: 0 5px; border-radius: 999px; display: grid; place-items: center; font-family: var(--f-display); font-weight: 700; font-size: 11px; color: #0d0f27; border: 2px dashed rgba(255,255,255,.85); box-shadow: 0 4px 8px rgba(0,0,0,.6); animation: stackin .25s cubic-bezier(.2,1.6,.4,1); }
    @keyframes stackin { from { transform: translateY(-16px) scale(.5); opacity: 0; } }
    .rack { display: flex; gap: 8px; flex-wrap: wrap; }
    .rack button { width: 46px; height: 46px; border-radius: 50%; border: 3px dashed rgba(255,255,255,.85); font-family: var(--f-display); font-weight: 700; font-size: 12px; color: #0d0f27; box-shadow: 0 4px 10px rgba(0,0,0,.5); transition: transform .15s; }
    .rack button[aria-pressed="true"] { transform: translateY(-4px) scale(1.08); box-shadow: 0 0 0 3px var(--bg-1), 0 0 0 5px #fff, 0 6px 14px rgba(0,0,0,.6); }
    .duo { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .road { display: grid; grid-template-columns: repeat(12, 1fr); gap: 4px; }
    .road i { aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center; font-style: normal; font-size: 10px; font-weight: 700; color: #fff; background: var(--bg-0); border: 1px solid var(--line); }
  `));
}

export function chipTable({ money, init, sound, ui, spots, onChange }) {
  injectCss();
  const values = [10, 100, 500, 2500, 10000].filter((v) => v >= init.game.min_bet && v <= init.game.max_bet);
  let chip = values.includes(100) ? 100 : values[0];
  const bets = new Map();
  const undo = [];
  let locked = false;

  const spotEls = new Map();
  const spotNodes = spots.map((s) => {
    const el = h('button', { class: `spot ${s.cls || ''}`, type: 'button', style: s.style || '', 'aria-label': `Bet on ${s.label}` }, h('b', {}, s.label), h('span', {}, s.sub || ''));
    el.addEventListener('click', () => place(s.key));
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!locked && bets.delete(s.key)) render(); });
    spotEls.set(s.key, el);
    return el;
  });

  const rackBtns = values.map((v) => {
    const b = h('button', { type: 'button', style: `background:${CHIP_COLORS[v]}`, 'aria-pressed': String(v === chip), 'aria-label': `Chip ${money.plain(v)}` }, money.plain(v).replace(/\.00$/, ''));
    b.addEventListener('click', () => { chip = v; rackBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); sound.click(); });
    return b;
  });
  const undoBtn = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Undo');
  const clearBtn = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Clear');
  undoBtn.addEventListener('click', () => {
    const last = undo.pop(); if (!last || locked) return;
    const left = (bets.get(last[0]) || 0) - last[1];
    left > 0 ? bets.set(last[0], left) : bets.delete(last[0]);
    render();
  });
  clearBtn.addEventListener('click', () => { if (locked) return; bets.clear(); undo.length = 0; render(); });

  const total = () => [...bets.values()].reduce((a, b) => a + b, 0);
  function place(key) {
    if (locked) return;
    if (total() + chip > init.game.max_bet) { ui.toast(`Table limit is ${money.fmt(init.game.max_bet)}`); return; }
    bets.set(key, (bets.get(key) || 0) + chip);
    undo.push([key, chip]);
    clearMarks(); sound.click(); render();
  }
  function render(notify = true) {
    spotEls.forEach((el, key) => {
      el.querySelector('.stack')?.remove();
      const amt = bets.get(key);
      if (amt) {
        const top = values.filter((v) => v <= amt).pop() || values[0];
        el.append(h('span', { class: 'stack', style: `background:${CHIP_COLORS[top]}` }, money.plain(amt).replace(/\.00$/, '')));
      }
      el.disabled = locked;
    });
    undoBtn.disabled = locked || !undo.length;
    clearBtn.disabled = locked || !bets.size;
    if (notify && onChange) onChange(total());
  }
  function clearMarks() { spotEls.forEach((el) => el.classList.remove('win', 'lose')); }
  render(false);

  return {
    spotNodes,
    controls: [h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Chip value', h('em', {}, 'right-click a spot to remove')), h('div', { class: 'rack' }, rackBtns)), h('div', { class: 'duo' }, undoBtn, clearBtn)],
    total,
    chips: () => [...bets.entries()].map(([type, amount]) => ({ type, amount })),
    lock(v) { locked = v; render(); },
    mark(winners) { spotEls.forEach((el, key) => { if (bets.has(key) || winners.includes(key)) el.classList.add(winners.includes(key) ? 'win' : 'lose'); }); },
    clearMarks,
  };
}

export function beadRoad(colors, max = 36) {
  injectCss();
  const el = h('div', { class: 'road', 'aria-label': 'Results road' });
  return {
    el: h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Road', h('em', {}, 'latest last')), el),
    push(key, text) {
      el.append(h('i', { style: `background:${colors[key] || '#20233a'}` }, text));
      while (el.children.length > max) el.firstChild.remove();
    },
  };
}
