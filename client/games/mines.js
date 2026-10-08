// Mines client: 5x5 board of flip tiles, multiplier ladder, cash out at any time.
import { fmtMult } from '../sdk/api.js';
import { glow, starfield } from '../sdk/fx.js';

export const rules = `
<p>Choose how many mines hide among 25 tiles and place your bet. Reveal tiles one by one: every gem raises the multiplier, a mine ends the round and the bet is lost.</p>
<p>Cash out whenever you like to take bet × current multiplier. After <b>k</b> gems with <b>n</b> mines the multiplier is RTP × C(25, k) / C(25 − n, k), the fair price of surviving that long.</p>`;

const GEM = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="g1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b6ffe0"/><stop offset=".5" stop-color="#1fe58f"/><stop offset="1" stop-color="#0a8f58"/></linearGradient></defs>
<path d="M14 10h36l10 14-28 32L4 24z" fill="url(#g1)"/><path d="M4 24h56M22 10l10 46 10-46M14 10l8 14m28-14-8 14" stroke="#04301d" stroke-width="1.6" fill="none" opacity=".45"/><path d="M16 13h12l-6 9z" fill="#fff" opacity=".55"/></svg>`;
const BOMB = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><radialGradient id="b1" cx=".35" cy=".35"><stop offset="0" stop-color="#ff9aa9"/><stop offset=".45" stop-color="#ff4766"/><stop offset="1" stop-color="#7a0a22"/></radialGradient></defs>
<circle cx="30" cy="36" r="20" fill="url(#b1)"/><rect x="38" y="8" width="8" height="14" rx="3" transform="rotate(35 42 15)" fill="#3a0c18"/><path d="M48 8c4-4 8-2 9 1" stroke="#ffc53d" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="57" cy="9" r="3.5" fill="#fff3c4"/><circle cx="23" cy="29" r="5" fill="#fff" opacity=".45"/></svg>`;

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const ladders = init.game.data.ladders;
  const st = { round: null, mines: 3, busy: false };

  document.head.append(h('style', {}, `
    .mines-wrap { position: absolute; inset: 52px 12px 12px; display: grid; grid-template-rows: auto 1fr; gap: 12px; justify-items: center; }
    .ladder { display: flex; gap: 6px; overflow-x: auto; max-width: min(100%, 640px); padding: 2px; scrollbar-width: none; }
    .ladder::-webkit-scrollbar { display: none; }
    .ladder .rung { flex: none; display: grid; justify-items: center; padding: 6px 10px; border-radius: 10px; background: rgba(20,23,55,.85); border: 1px solid var(--line); font-variant-numeric: tabular-nums; transition: all .25s; }
    .ladder .rung b { font-family: var(--f-display); font-size: 14px; }
    .ladder .rung span { font-size: 10px; color: var(--dim); }
    .ladder .rung.done { border-color: rgba(31,229,143,.45); background: rgba(31,229,143,.1); }
    .ladder .rung.done b { color: var(--green); }
    .ladder .rung.next { border-color: var(--gold); box-shadow: 0 0 16px rgba(255,197,61,.25); }
    .board { display: grid; grid-template-columns: repeat(5, 1fr); gap: clamp(6px, 1.3vw, 12px); width: min(100%, calc(100vh - 260px), 560px); aspect-ratio: 1; align-self: center; }
    .tile { position: relative; border: 0; padding: 0; background: transparent; perspective: 700px; border-radius: 14px; }
    .tile .in { position: absolute; inset: 0; transform-style: preserve-3d; transition: transform .5s cubic-bezier(.3,1.35,.5,1); }
    .tile.open .in { transform: rotateY(180deg); }
    .tile .face, .tile .back { position: absolute; inset: 0; border-radius: 14px; backface-visibility: hidden; display: grid; place-items: center; }
    .tile .face { background: linear-gradient(160deg, #3a3f94 0%, #262a6a 55%, #1c2050 100%); box-shadow: inset 0 2px 0 rgba(255,255,255,.14), inset 0 -4px 0 rgba(0,0,0,.25), 0 6px 0 #0f1236, 0 10px 18px -8px rgba(0,0,0,.8); transition: transform .15s, filter .15s, box-shadow .15s; }
    .tile .face::after { content: ""; width: 26%; height: 26%; border-radius: 50%; background: radial-gradient(circle, rgba(139,92,246,.55), transparent 70%); }
    .board.live .tile:not(.open):not(:disabled):hover .face { transform: translateY(-3px); filter: brightness(1.2); box-shadow: inset 0 2px 0 rgba(255,255,255,.2), 0 9px 0 #0f1236, 0 0 22px rgba(139,92,246,.55); }
    .tile .back { transform: rotateY(180deg); background: radial-gradient(circle at 50% 45%, #1b2150, #0b0d24 75%); box-shadow: inset 0 0 0 1px var(--line); }
    .tile.gem .back { background: radial-gradient(circle at 50% 45%, rgba(31,229,143,.35), #0b0d24 70%); box-shadow: inset 0 0 0 2px rgba(31,229,143,.55), 0 0 22px rgba(31,229,143,.25); }
    .tile.mine .back { background: radial-gradient(circle at 50% 45%, rgba(255,71,102,.5), #1f0710 70%); box-shadow: inset 0 0 0 2px rgba(255,71,102,.7), 0 0 26px rgba(255,71,102,.4); }
    .tile.ghost .back { opacity: .38; box-shadow: none; }
    .tile svg { width: 62%; height: 62%; }
    .tile.pop svg { animation: gempop .5s cubic-bezier(.2,1.6,.4,1); }
    .tile.boom { animation: boom .5s; z-index: 2; }
    @keyframes gempop { 0% { transform: scale(.2) rotate(-20deg); } 100% { transform: scale(1); } }
    @keyframes boom { 0%, 100% { transform: none; } 20% { transform: translate(-5px, 2px) scale(1.12); } 40% { transform: translate(5px, -2px) scale(1.1); } 60% { transform: translate(-3px, 1px); } }
    .chips5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
    .chips5 button { border: 1px solid var(--line); background: var(--bg-2); border-radius: 7px; padding: 5px 0; font-weight: 700; color: var(--muted); font-family: var(--f-display); }
    .chips5 button:hover:not(:disabled) { color: var(--text); }
  `));

  // ---------- controls ----------
  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const minesSel = h('select', { 'aria-label': 'Mines' }, Array.from({ length: 24 }, (_, i) => h('option', { value: i + 1, selected: i + 1 === st.mines }, String(i + 1))));
  const chips = h('div', { class: 'chips5' }, [1, 3, 5, 10, 24].map((n) => h('button', { type: 'button', onclick: () => { minesSel.value = n; setMines(n); sound.click(); } }, String(n))));
  const minesField = h('div', { class: 'field' }, h('div', { class: 'lbl' }, 'Mines', h('em', {}, 'gems = 25 − mines')), h('div', { class: 'input' }, minesSel), chips);
  const btn = h('button', { class: 'btn btn-bet', type: 'button' }, 'Bet');
  const random = h('button', { class: 'btn btn-ghost', type: 'button', hidden: true }, 'Pick random tile');
  const info = ui.stats([['next', 'Next tile'], ['chance', 'Safe chance'], ['profit', 'Profit now']]);
  shell.controls.append(amount.el, minesField, btn, random, info.el);
  minesSel.addEventListener('change', () => setMines(+minesSel.value));

  // ---------- board ----------
  const ladder = h('div', { class: 'ladder', 'aria-label': 'Multiplier ladder' });
  const board = h('div', { class: 'board', role: 'grid', 'aria-label': 'Mines board' });
  const tiles = Array.from({ length: 25 }, (_, i) => {
    const t = h('button', { class: 'tile', type: 'button', 'aria-label': `Tile ${i + 1}` }, h('div', { class: 'in' }, h('div', { class: 'face' }), h('div', { class: 'back' })));
    t.addEventListener('click', () => reveal(i));
    board.append(t);
    return t;
  });
  shell.stage.append(h('div', { class: 'mines-wrap' }, ladder, board));
  stage.canvas.style.zIndex = '3';
  stage.canvas.style.pointerEvents = 'none';

  function setMines(n) { st.mines = n; renderLadder(); renderInfo(); }

  function renderLadder() {
    const n = st.round ? st.round.params.mines : st.mines;
    const k = st.round ? st.round.result.revealed.length : 0;
    const rungs = ladders[String(n)];
    ladder.replaceChildren(...rungs.map((m, i) => h('div', { class: `rung ${i < k ? 'done' : i === k && st.round ? 'next' : ''}` }, h('b', {}, fmtMult(m / 100)), h('span', {}, `${i + 1} gem${i ? 's' : ''}`))));
    const cur = ladder.children[Math.max(0, k - 1)];
    if (cur) ladder.scrollTo({ left: cur.offsetLeft - ladder.clientWidth / 2 + cur.clientWidth / 2, behavior: 'smooth' });
  }

  function renderInfo() {
    const r = st.round, n = r ? r.params.mines : st.mines, k = r ? r.result.revealed.length : 0;
    const next = ladders[String(n)][k];
    info.set('next', next ? fmtMult(next / 100) : '—');
    info.set('chance', `${(((25 - n - k) / (25 - k)) * 100).toFixed(1)}%`);
    info.set('profit', r && k ? money.fmt(r.cashout_amount - r.bet) : money.fmt(0));
  }

  function renderControls() {
    const live = !!st.round;
    board.classList.toggle('live', live);
    amount.disabled = live; minesSel.disabled = live; chips.querySelectorAll('button').forEach((b) => { b.disabled = live; });
    random.hidden = !live;
    random.disabled = st.busy;
    if (live) {
      const k = st.round.result.revealed.length;
      btn.className = 'btn btn-cash';
      btn.innerHTML = k ? `Cash out<small class="num">${money.fmt(st.round.cashout_amount)}</small>` : 'Cash out<small>Reveal a tile first</small>';
      btn.disabled = !k || st.busy;
    } else { btn.className = 'btn btn-bet'; btn.textContent = 'Bet'; btn.disabled = st.busy; }
    tiles.forEach((t) => { t.disabled = !live || t.classList.contains('open'); });
  }

  function resetBoard() {
    tiles.forEach((t) => { t.className = 'tile'; t.querySelector('.back').innerHTML = ''; });
  }

  function tileCenter(i) {
    const r = tiles[i].getBoundingClientRect(), s = shell.stage.getBoundingClientRect();
    return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2, w: r.width };
  }

  function showGem(i, pop = true) {
    const t = tiles[i];
    t.querySelector('.back').innerHTML = GEM;
    t.classList.add('open', 'gem');
    if (pop) {
      t.classList.add('pop');
      const c = tileCenter(i);
      setTimeout(() => {
        stage.particles.spark(c.x, c.y, { count: 22, color: '#1fe58f', speed: 200, life: 0.6, gravity: 120 });
        stage.particles.ring(c.x, c.y, { color: '#1fe58f', r0: c.w * 0.2, r1: c.w * 0.8, life: 0.45 });
      }, 180);
    }
  }

  function revealAll(result, hit) {
    const mines = new Set(result.mines || []);
    setTimeout(() => {
      tiles.forEach((t, i) => {
        if (t.classList.contains('open')) return;
        t.querySelector('.back').innerHTML = mines.has(i) ? BOMB : GEM;
        t.classList.add('open', mines.has(i) ? 'mine' : 'gem', 'ghost');
      });
    }, hit === undefined ? 150 : 550);
  }

  async function start() {
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return; }
    st.busy = true; renderControls();
    try {
      const r = await api.roundStart(bet, { mines: st.mines });
      resetBoard();
      st.round = r; shell.wallet.sync(r.balance); sound.bet();
      tiles.forEach((t, i) => { t.animate([{ transform: 'scale(.85)', opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 380, delay: (i % 5) * 30 + Math.floor(i / 5) * 30, easing: 'cubic-bezier(.2,1.4,.4,1)', fill: 'backwards' }); });
    } catch (e) { ui.toast(e.message, 'err'); }
    st.busy = false; renderLadder(); renderInfo(); renderControls();
  }

  async function reveal(i) {
    if (!st.round || st.busy || tiles[i].classList.contains('open')) return;
    st.busy = true; renderControls(); sound.flip();
    let r;
    try { r = await api.roundAct({ tile: i }); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; renderControls(); return; }
    st.busy = false;
    if (r.result.mine_hit !== undefined) {
      const t = tiles[i];
      t.querySelector('.back').innerHTML = BOMB;
      t.classList.add('open', 'mine', 'boom', 'pop');
      const c = tileCenter(i);
      sound.explode(); stage.shake(12, 0.5);
      stage.particles.spark(c.x, c.y, { count: 70, color: '#ff4766', speed: 420, life: 0.8, gravity: 300 });
      stage.particles.spark(c.x, c.y, { count: 30, color: '#ffc53d', speed: 300, life: 0.6 });
      stage.particles.ring(c.x, c.y, { color: '#ff4766', r0: 10, r1: c.w * 2.2, life: 0.55, width: 5 });
      st.round = null;
      shell.wallet.sync(r.balance);
      ui.pushResult(shell.strip, 0, 'loss');
      revealAll(r.result, i);
    } else if (r.status === 'settled') {
      showGem(i); sound.gem(r.result.revealed.length);
      finishWin(r);
    } else {
      st.round = r; showGem(i); sound.gem(r.result.revealed.length);
    }
    renderLadder(); renderInfo(); renderControls();
  }

  function finishWin(r) {
    st.round = null;
    shell.wallet.sync(r.balance);
    sound.cashout();
    const c = { x: stage.w / 2, y: stage.h / 2 };
    stage.particles.coins(c.x, stage.h, { count: 26 });
    stage.particles.text(c.x, c.y, `${fmtMult(r.multiplier)}  +${money.fmt(r.payout)}`, { color: '#1fe58f', size: 30, rise: 60, life: 1.6 });
    ui.pushResult(shell.strip, r.multiplier);
    revealAll(r.result);
    if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
  }

  async function cashout() {
    if (!st.round || st.busy) return;
    st.busy = true; renderControls();
    try { finishWin(await api.roundCashout()); } catch (e) { ui.toast(e.message, 'err'); }
    st.busy = false; renderLadder(); renderInfo(); renderControls();
  }

  btn.addEventListener('click', () => (st.round ? cashout() : start()));
  random.addEventListener('click', () => {
    const closed = tiles.map((t, i) => (t.classList.contains('open') ? -1 : i)).filter((i) => i >= 0);
    if (closed.length) reveal(closed[(Math.random() * closed.length) | 0]);
  });

  // resume an unfinished round
  if (init.open_round) {
    st.round = init.open_round;
    st.round.result.revealed.forEach((i) => showGem(i, false));
  }
  renderLadder(); renderInfo(); renderControls();

  const stars = starfield(60);
  stage.draw((ctx, dt, W, H, t) => { stars(ctx, dt, W, H, t); glow(ctx, W / 2, H / 2, Math.max(W, H) * 0.5, '#8b5cf6', 0.12); });
}
