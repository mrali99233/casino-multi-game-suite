// Scratch Card client: drag to scratch the foil; three matching symbols win.
import { fmtMult } from '../sdk/api.js';
import { glow, starfield, wait } from '../sdk/fx.js';
import { drawSymbol } from './slots.js';

export const rules = `
<p>Buy a card and scratch the nine panels. Three matching symbols win that symbol's prize. A card can win at most one prize.</p>
<p>The result is fixed when you buy the card; scratching only reveals it. Use <b>Reveal all</b> to skip scratching.</p>`;

const ORDER = ['seven', 'diamond', 'star', 'bell', 'lemon', 'cherry'];

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const prizes = init.game.data.prizes, odds = init.game.data.odds;
  const st = { card: null, busy: false, revealed: false };

  document.head.append(h('style', {}, `
    .sc { position: absolute; inset: 52px 14px 14px; display: grid; place-items: center; z-index: 1; }
    .ticket { position: relative; width: min(100%, 460px, calc(100vh - 220px)); padding: 16px; border-radius: 22px; background: linear-gradient(160deg, #ffd27a, #ff8a1f 45%, #ff3d81); box-shadow: 0 24px 60px -24px rgba(0,0,0,.9); }
    .ticket h3 { margin: 0 0 10px; text-align: center; font-family: var(--f-display); letter-spacing: .1em; color: #2b0a12; font-size: clamp(16px, 2.6vw, 24px); }
    .ticket .face { position: relative; border-radius: 14px; overflow: hidden; background: #fff7e6; aspect-ratio: 1; }
    .ticket .grid { position: absolute; inset: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; padding: 6px; }
    .ticket .cell { border-radius: 10px; background: #fff; display: grid; place-items: center; box-shadow: inset 0 0 0 2px #f2e2c4; transition: box-shadow .3s, background .3s; }
    .ticket .cell canvas { width: 78%; height: 78%; }
    .ticket .cell.win { background: #fff3c4; box-shadow: inset 0 0 0 3px var(--gold), 0 0 22px rgba(255,197,61,.8); animation: cwin .7s ease-in-out 3; }
    @keyframes cwin { 50% { transform: scale(1.06); } }
    .ticket canvas.foil { position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair; touch-action: none; transition: opacity .6s; }
    .ticket .foot { margin-top: 10px; text-align: center; font-weight: 700; color: #2b0a12; font-size: 13px; }
    .sct { display: grid; gap: 4px; }
    .sct .r { display: grid; grid-template-columns: 30px minmax(0, 1fr) auto 56px; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 9px; background: var(--bg-0); border: 1px solid var(--line); font-size: 12px; }
    .sct .r canvas { width: 28px; height: 28px; }
    .sct .r em { font-style: normal; color: var(--dim); font-variant-numeric: tabular-nums; }
    .sct .r b { font-family: var(--f-display); text-align: right; }
    .sct .r.hit { border-color: var(--gold); background: rgba(255,197,61,.12); }
  `));

  const grid = h('div', { class: 'grid' });
  const foil = h('canvas', { class: 'foil', 'aria-label': 'Scratch area' });
  const foot = h('div', { class: 'foot' }, 'Buy a card to start');
  const ticket = h('div', { class: 'ticket' }, h('h3', {}, 'MATCH 3 TO WIN'), h('div', { class: 'face' }, grid, foil), foot);
  shell.stage.append(h('div', { class: 'sc' }, ticket));
  stage.canvas.style.zIndex = '2'; stage.canvas.style.pointerEvents = 'none';

  const mode = ui.segmented(null, [['manual', 'Manual'], ['auto', 'Auto']], 'manual', (v) => { autoBox.hidden = v !== 'auto'; sync(); });
  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100), label: 'Card price' });
  const auto = ui.autoPanel(money);
  const autoBox = h('div', { hidden: true }, auto.el);
  const buy = h('button', { class: 'btn btn-bet', type: 'button' }, 'Buy card');
  const reveal = h('button', { class: 'btn btn-ghost', type: 'button', disabled: true }, 'Reveal all');
  const rows = {};
  const icon = (s) => { const c = h('canvas', { width: 56, height: 56 }); drawSymbol(c.getContext('2d'), s, 28, 28, 46); return c; };
  const table = h('div', { class: 'sct' }, ORDER.map((s) => (rows[s] = h('div', { class: 'r' }, icon(s), h('span', {}, `3 × ${s}`), h('em', {}, `1 in ${Math.round(1 / odds[s]).toLocaleString()}`), h('b', {}, fmtMult(prizes[s]))))));
  shell.controls.append(mode.el, amount.el, autoBox, buy, reveal, h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Prizes', h('em', {}, 'odds per card')), table));

  // ---------- foil ----------
  const fctx = foil.getContext('2d');
  let scratched = 0, strokes = 0;
  function paintFoil() {
    const r = foil.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    foil.width = Math.max(1, r.width * d); foil.height = Math.max(1, r.height * d);
    fctx.setTransform(d, 0, 0, d, 0, 0);
    fctx.globalCompositeOperation = 'source-over';
    const g = fctx.createLinearGradient(0, 0, r.width, r.height);
    g.addColorStop(0, '#c9ccd8'); g.addColorStop(0.5, '#eef0f8'); g.addColorStop(1, '#a9adc0');
    fctx.fillStyle = g; fctx.fillRect(0, 0, r.width, r.height);
    fctx.fillStyle = 'rgba(80,85,120,.25)'; fctx.font = '700 14px "Chakra Petch", sans-serif'; fctx.textAlign = 'center';
    for (let y = 24; y < r.height; y += 34) for (let x = (y / 34) % 2 ? 40 : 90; x < r.width; x += 110) fctx.fillText('SCRATCH', x, y);
    foil.style.opacity = '1'; foil.style.pointerEvents = '';
    scratched = 0; strokes = 0;
  }
  function measure() {
    const img = fctx.getImageData(0, 0, foil.width, foil.height).data;
    let clear = 0, n = 0;
    for (let i = 3; i < img.length; i += 4 * 97) { n++; if (img[i] < 40) clear++; }
    return clear / n;
  }
  let drawing = false, last = null;
  const pt = (e) => { const r = foil.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function scratch(p) {
    fctx.globalCompositeOperation = 'destination-out';
    fctx.lineWidth = Math.max(26, foil.clientWidth * 0.09); fctx.lineCap = 'round';
    fctx.beginPath(); fctx.moveTo((last || p).x, (last || p).y); fctx.lineTo(p.x, p.y); fctx.stroke();
    last = p;
    if (++strokes % 6 === 0) {
      sound.noise(0.06, { vol: 0.05, freq: 3000, type: 'highpass' });
      scratched = measure();
      if (scratched > 0.55) finish();
    }
  }
  foil.addEventListener('pointerdown', (e) => { if (!st.card || st.revealed) return; drawing = true; last = null; foil.setPointerCapture(e.pointerId); scratch(pt(e)); });
  foil.addEventListener('pointermove', (e) => { if (drawing) scratch(pt(e)); });
  foil.addEventListener('pointerup', () => { drawing = false; last = null; });

  function setCard(cells) {
    grid.replaceChildren(...cells.map((s) => { const c = h('canvas', { width: 160, height: 160 }); drawSymbol(c.getContext('2d'), s, 80, 80, 130); return h('div', { class: 'cell' }, c); }));
  }

  async function finish() {
    if (!st.card || st.revealed) return;
    st.revealed = true; drawing = false;
    foil.style.opacity = '0'; foil.style.pointerEvents = 'none';
    reveal.disabled = true;
    const r = st.card;
    await wait(0.4);
    Object.values(rows).forEach((x) => x.classList.remove('hit'));
    if (r.result.prize !== 'none') {
      [...grid.children].forEach((c, i) => { if (r.result.cells[i] === r.result.prize) c.classList.add('win'); });
      rows[r.result.prize].classList.add('hit');
      foot.textContent = `3 × ${r.result.prize.toUpperCase()} · YOU WIN ${money.fmt(r.payout)}`;
      sound.win(r.multiplier >= 10 ? 3 : r.multiplier >= 2 ? 2 : 1);
      stage.particles.confetti(stage.w / 2, stage.h * 0.4, { count: 80 });
      if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
    } else { foot.textContent = 'No match this time'; sound.lose(); }
    shell.wallet.release(r.payout);
    ui.pushResult(shell.strip, r.multiplier, r.payout > r.bet ? 'win' : 'loss');
    st.card = null; sync();
    if (cardDone) { cardDone(r); cardDone = null; }
  }

  let cardDone = null;
  async function buyCard() {
    if (st.busy || st.card) return null;
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this card', 'err'); return null; }
    st.busy = true; sync(); sound.bet();
    let r;
    try { r = await api.bet(bet, {}); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; sync(); return null; }
    shell.wallet.sync(r.balance); shell.wallet.hold(r.payout);
    paintFoil(); setCard(r.result.cells);
    st.card = r; st.revealed = false; st.busy = false;
    foot.textContent = mode.value === 'auto' ? 'Revealing…' : 'Scratch the foil';
    ticket.animate([{ transform: 'translateY(-30px) rotate(-3deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 450, easing: 'cubic-bezier(.2,1.3,.4,1)' });
    sync();
    const done = new Promise((res) => { cardDone = res; });
    if (mode.value === 'auto') { await wait(0.5); finish(); }
    return done;
  }

  function sync() {
    if (mode.value === 'auto') { buy.textContent = auto.running ? 'Stop auto' : 'Start auto'; buy.className = `btn ${auto.running ? 'btn-cancel' : 'btn-bet'}`; buy.disabled = false; }
    else { buy.textContent = 'Buy card'; buy.className = 'btn btn-bet'; buy.disabled = st.busy || !!st.card; }
    reveal.disabled = !st.card || st.revealed;
    amount.disabled = !!st.card || auto.running;
  }
  buy.addEventListener('click', () => {
    if (mode.value === 'manual') { buyCard(); return; }
    if (auto.running) { auto.stop(); return; }
    auto.run(buyCard, { delay: 0.6, onState: sync });
    sync();
  });
  reveal.addEventListener('click', finish);
  new ResizeObserver(() => { if (st.card && !st.revealed) paintFoil(); }).observe(foil);
  setCard(['seven', 'diamond', 'star', 'bell', 'lemon', 'cherry', 'star', 'bell', 'seven']);
  requestAnimationFrame(paintFoil);

  const stars = starfield(60);
  stage.draw((ctx, dt, W, H, t) => { stars(ctx, dt, W, H, t); glow(ctx, W / 2, H / 2, Math.max(W, H) * 0.45, '#ff8a1f', 0.12); });
}
