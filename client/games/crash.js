// Aviator (crash) client: shared real-time room over WebSocket, two independent bet slots.
import { CrashSocket, fmtMult } from '../sdk/api.js';
import { clamp, ease, glow, rand, roundRect, starfield } from '../sdk/fx.js';

export const rules = `
<p>A new round starts every few seconds. Place up to two bets while betting is open. When the plane takes off the multiplier climbs from 1.00×; cash out before it flies away to win your bet times the multiplier.</p>
<p>If the plane flies away before you cash out, that bet is lost. Set <b>Auto cash-out</b> to have the server cash out for you the moment the target is reached.</p>
<p>The crash point is fixed before betting opens: its SHA-256 hash is published at the start of each round and the seed is revealed when it ends.</p>`;

const CHIPS = [100, 200, 500, 1000];

export function mount({ init, money, shell, stage, sound, ui, token }) {
  const { h } = ui;
  const sock = new CrashSocket(token);
  const room = { phase: 'connecting', gameId: 0, startedAt: 0, bettingEnds: 0, growth: 0.11, crash: null, mult: 1, crashT: 0, lastTick: 1, bets: [] };
  const minBet = init.game.min_bet, maxBet = init.game.max_bet;

  // ---------- bet slots ----------
  const slots = [0, 1].map((i) => makeSlot(i));
  const list = h('div', { class: 'bets-list' });
  const listHead = h('div', { class: 'lbl' }, 'All bets', h('em', { id: 'bet-count' }, '0'));
  shell.controls.append(...slots.map((s) => s.el), h('div', { class: 'field' }, listHead, list));
  const styleTag = h('style', {}, `
    .slot { grid-template-columns: minmax(0, 1fr); background: var(--bg-0); border: 1px solid var(--line); border-radius: var(--r-lg); padding: 12px; display: grid; gap: 10px; transition: border-color .2s, box-shadow .2s; }
    .slot.live { border-color: rgba(255,197,61,.5); box-shadow: 0 0 0 3px rgba(255,197,61,.08); }
    .slot .row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 10px; align-items: stretch; }
    .slot .chips { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
    .slot .chips button { border: 1px solid var(--line); background: var(--bg-2); border-radius: 7px; padding: 4px 0; font-size: 12px; font-weight: 600; color: var(--muted); }
    .slot .chips button:hover:not(:disabled) { color: var(--text); }
    .slot .btn { padding: 10px 8px; font-size: 16px; line-height: 1.15; }
    .slot .auto { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; align-items: center; }
    .slot .auto .input input { padding: 7px 10px; font-size: 14px; }
    .bets-list { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
    .bets-list .b { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; padding: 6px 10px; border-radius: 8px; background: var(--bg-0); font-size: 13px; font-variant-numeric: tabular-nums; }
    .bets-list .b.won { background: rgba(31,229,143,.08); box-shadow: inset 2px 0 0 var(--green); }
    .bets-list .b span:nth-child(2) { color: var(--muted); }
    .bets-list .b b { font-family: var(--f-display); min-width: 52px; text-align: right; }
    .bets-list .empty { color: var(--dim); font-size: 13px; padding: 6px 2px; }
    .cash-banner { position: absolute; top: 52px; left: 50%; transform: translateX(-50%); background: linear-gradient(180deg, rgba(31,229,143,.25), rgba(10,168,100,.25)); border: 1px solid rgba(31,229,143,.6); color: #eafff4; padding: 8px 16px; border-radius: 999px; font-weight: 700; white-space: nowrap; animation: pop .35s cubic-bezier(.2,1.4,.4,1); z-index: 3; }
    .cash-banner b { font-family: var(--f-display); color: var(--green); margin-left: 6px; }
  `);
  document.head.append(styleTag);

  function makeSlot(i) {
    const s = { i, state: 'idle', amount: null, auto: null, roundBet: 0, cashed: null };
    s.amount = ui.betAmount({ money, min: minBet, max: maxBet, value: Math.max(minBet, i ? 200 : 100), label: `Bet ${i + 1}` });
    const chips = h('div', { class: 'chips' }, CHIPS.map((c) => h('button', { type: 'button', onclick: () => { s.amount.value = c; sound.click(); } }, money.plain(c))));
    s.autoToggle = ui.switchField('Auto cash-out', false);
    s.autoVal = ui.numberField('', { value: '2.00', suffix: '×' });
    s.autoVal.el.querySelector('label')?.remove();
    s.btn = h('button', { class: 'btn btn-bet', type: 'button' });
    s.btn.addEventListener('click', () => onSlotButton(s));
    s.el = h('div', { class: 'slot' }, s.amount.el, chips, h('div', { class: 'auto' }, s.autoToggle.el, s.autoVal.el), s.btn);
    s.chips = chips;
    return s;
  }

  function autoTarget(s) {
    if (!s.autoToggle.checked) return null;
    const v = s.autoVal.value;
    if (!(v >= 1.01)) { s.autoVal.value = '1.01'; return 1.01; }
    return Math.round(v * 100) / 100;
  }

  async function placeBet(s) {
    const amount = s.amount.value;
    if (amount > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); s.state = 'idle'; renderSlot(s); return; }
    s.state = 'placing'; renderSlot(s);
    try {
      const r = await sock.send('bet', { slot: s.i, amount, auto_cashout: autoTarget(s) });
      shell.wallet.sync(r.balance);
      s.roundBet = amount; s.cashed = null; s.state = 'placed';
      sound.bet();
    } catch (e) {
      s.state = 'idle';
      ui.toast(e.message, 'err');
    }
    renderSlot(s);
  }

  async function onSlotButton(s) {
    if (s.state === 'idle' || s.state === 'cashed' || s.state === 'lost') {
      if (room.phase === 'betting') placeBet(s);
      else { s.state = 'queued'; sound.click(); renderSlot(s); }
    } else if (s.state === 'queued') {
      s.state = 'idle'; renderSlot(s);
    } else if (s.state === 'placed') {
      try { const r = await sock.send('cancel', { slot: s.i }); shell.wallet.sync(r.balance); s.state = 'idle'; } catch (e) { ui.toast(e.message, 'err'); }
      renderSlot(s);
    } else if (s.state === 'active') {
      s.btn.disabled = true;
      try { await sock.send('cashout', { slot: s.i }); } catch (e) { ui.toast(e.message, 'err'); s.btn.disabled = false; }
    }
  }

  function renderSlot(s) {
    const b = s.btn;
    const lockInputs = ['placing', 'placed', 'active', 'queued'].includes(s.state);
    s.amount.disabled = lockInputs; s.autoVal.disabled = lockInputs; s.autoToggle.disabled = lockInputs;
    s.chips.querySelectorAll('button').forEach((c) => { c.disabled = lockInputs; });
    s.el.classList.toggle('live', s.state === 'active');
    b.disabled = s.state === 'placing';
    if (s.state === 'active') {
      b.className = 'btn btn-cash';
      b.innerHTML = `Cash out<small class="num">${money.fmt(Math.floor(s.roundBet * room.mult))}</small>`;
    } else if (s.state === 'placed') {
      b.className = 'btn btn-cancel'; b.innerHTML = 'Cancel<small>Waiting for take-off</small>';
    } else if (s.state === 'queued') {
      b.className = 'btn btn-cancel'; b.innerHTML = 'Cancel<small>Bet queued for next round</small>';
    } else if (s.state === 'placing') {
      b.className = 'btn btn-bet'; b.innerHTML = 'Placing…';
    } else {
      b.className = 'btn btn-bet';
      b.innerHTML = `Bet<small class="num">${money.fmt(s.amount.value)}${room.phase === 'betting' ? '' : ' · next round'}</small>`;
    }
  }
  slots.forEach((s) => { renderSlot(s); s.amount.el.addEventListener('input', () => renderSlot(s)); s.amount.el.addEventListener('click', () => setTimeout(() => renderSlot(s))); });

  function renderBets() {
    const bets = room.bets.slice().sort((a, b) => (b.cashout || 0) - (a.cashout || 0) || b.amount - a.amount);
    document.getElementById('bet-count').textContent = String(bets.length);
    list.replaceChildren(...(bets.length ? bets.slice(0, 40).map((b) => h('div', { class: `b ${b.cashout ? 'won' : ''}` },
      h('span', {}, b.name), h('span', {}, money.fmt(b.amount)),
      h('b', { style: `color:${b.cashout ? 'var(--green)' : 'var(--dim)'}` }, b.cashout ? fmtMult(b.cashout) : '—'))) : [h('div', { class: 'empty' }, 'No bets yet this round')]));
  }

  // ---------- socket events ----------
  const histColor = (m) => (m >= 10 ? 'hi' : m >= 2 ? 'mid' : 'lo');
  function setHistory(hist) { shell.strip.replaceChildren(); hist.slice().reverse().forEach((r) => ui.pushResult(shell.strip, r.crash, histColor(r.crash))); }

  function newBettingRound(msg) {
    room.phase = 'betting'; room.gameId = msg.game_id; room.bettingEnds = msg.betting_ends; room.crash = null; room.mult = 1;
    room.bettingTotal = Math.max(1, msg.betting_ends - (msg.server_time || sock.now()));
    room.bets = msg.bets || [];
    sound.engineStop();
    slots.forEach((s) => {
      if (['active', 'cashed', 'lost', 'placed'].includes(s.state)) s.state = 'idle';
      if (s.state === 'queued') placeBet(s);
      renderSlot(s);
    });
    renderBets();
  }

  sock.on('hello', (msg) => {
    shell.wallet.sync(msg.balance);
    setHistory(msg.history || []);
    room.growth = msg.growth;
    room.bets = msg.bets || [];
    if (msg.phase === 'betting') newBettingRound(msg);
    else if (msg.phase === 'running') { room.phase = 'running'; room.startedAt = msg.started_at; room.gameId = msg.game_id; }
    else { room.phase = msg.phase === 'crashed' ? 'crashed' : 'waiting'; room.crash = msg.crash || null; room.mult = msg.crash || 1; }
    renderBets(); slots.forEach(renderSlot);
  });
  sock.on('state', (msg) => { if (msg.phase === 'betting') newBettingRound(msg); });
  sock.on('start', (msg) => {
    room.phase = 'running'; room.startedAt = msg.started_at; room.growth = msg.growth; room.lastTick = 1;
    slots.forEach((s) => { if (s.state === 'placed') s.state = 'active'; renderSlot(s); });
    sound.engineStart(); sound.whoosh();
  });
  sock.on('tick', (msg) => { room.lastTick = msg.m; });
  sock.on('crash', (msg) => {
    room.phase = 'crashed'; room.crash = msg.crash; room.mult = msg.crash; room.crashT = 0;
    sound.engineStop(); sound.explode();
    stage.shake(10, 0.5);
    const p = geomCache.tip;
    if (p) {
      stage.particles.spark(p.x, p.y, { count: 70, color: '#ff4766', speed: 420, life: 0.9, gravity: 260 });
      stage.particles.spark(p.x, p.y, { count: 40, color: '#ffc53d', speed: 300, life: 0.7, gravity: 200 });
      stage.particles.ring(p.x, p.y, { color: '#ff4766', r0: 6, r1: 120, life: 0.6, width: 5 });
      for (let i = 0; i < 10; i++) stage.particles.smoke(p.x, p.y, { size: 16, life: 1.4, vx: rand(-80, 80), vy: rand(-80, 20) });
    }
    slots.forEach((s) => { if (s.state === 'active') { s.state = 'lost'; } renderSlot(s); });
    ui.pushResult(shell.strip, msg.crash, histColor(msg.crash));
  });
  sock.on('bets', (msg) => { room.bets = msg.bets; renderBets(); });
  sock.on('settled', (msg) => {
    if (msg.balance !== null && msg.balance !== undefined) shell.wallet.sync(msg.balance);
    const s = slots[msg.slot];
    if (msg.cashout && msg.game_id === room.gameId) {
      s.state = 'cashed'; s.cashed = msg.cashout;
      sound.cashout();
      const p = geomCache.tip || { x: stage.w / 2, y: stage.h / 2 };
      stage.particles.coins(p.x, p.y, { count: 18, speed: 380 });
      stage.particles.text(stage.w / 2, stage.h * 0.62, `+${money.fmt(msg.payout)}`, { color: '#1fe58f', size: 26, rise: 50, life: 1.4 });
      const banner = h('div', { class: 'cash-banner' }, `You cashed out at ${fmtMult(msg.cashout)}`, h('b', {}, money.fmt(msg.payout)));
      shell.overlay.append(banner);
      setTimeout(() => banner.remove(), 2600);
      if (msg.cashout >= 10) ui.bigWin(shell, stage, { mult: msg.cashout, amount: msg.payout, money });
      renderSlot(s);
    }
  });
  sock.on('close', (ev) => { if (ev.code === 4401) ui.toast('Session expired. Relaunch the game.', 'err'); room.phase = 'connecting'; });

  // ---------- render ----------
  const stars = starfield(110);
  const geomCache = { ox: 0, oy: 0, tip: null };
  let drift = 0;
  const view = { tMax: 10, mMax: 2 };

  function drawPlane(ctx, x, y, ang, sc, t) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(sc, sc);
    glow(ctx, -6, 0, 44, '#ff4766', 0.28);
    // wing (far)
    ctx.fillStyle = '#a3102f';
    ctx.beginPath(); ctx.moveTo(4, -2); ctx.lineTo(-10, -22); ctx.lineTo(-18, -22); ctx.lineTo(-10, -2); ctx.closePath(); ctx.fill();
    // fuselage
    const body = ctx.createLinearGradient(0, -9, 0, 9);
    body.addColorStop(0, '#ff8199'); body.addColorStop(0.45, '#ff3355'); body.addColorStop(1, '#b0102f');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.moveTo(26, 0); ctx.quadraticCurveTo(24, -8, 10, -8); ctx.lineTo(-24, -4); ctx.lineTo(-30, -14); ctx.lineTo(-36, -14); ctx.lineTo(-33, 2); ctx.lineTo(-24, 6); ctx.lineTo(10, 8); ctx.quadraticCurveTo(24, 8, 26, 0); ctx.closePath(); ctx.fill();
    // cockpit
    ctx.fillStyle = 'rgba(200,240,255,0.9)';
    ctx.beginPath(); ctx.ellipse(8, -7, 6, 3.4, -0.15, 0, 7); ctx.fill();
    // wing (near)
    ctx.fillStyle = '#ff4766';
    ctx.beginPath(); ctx.moveTo(6, 2); ctx.lineTo(-6, 24); ctx.lineTo(-15, 24); ctx.lineTo(-8, 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.moveTo(6, 2); ctx.lineTo(-6, 24); ctx.lineTo(-8.5, 24); ctx.lineTo(2, 2); ctx.closePath(); ctx.fill();
    // propeller
    ctx.fillStyle = '#2a0710'; ctx.beginPath(); ctx.arc(27, 0, 3, 0, 7); ctx.fill();
    const blade = Math.sin(t * 60);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.ellipse(28, 0, 2.2, 15 * Math.abs(blade) + 3, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  stage.draw((ctx, dt, W, H, t) => {
    const pad = { l: 40, r: 30, t: 56, b: 34 };
    const ox = pad.l, oy = H - pad.b;
    geomCache.ox = ox; geomCache.oy = oy;

    // live multiplier
    let elapsed = 0;
    if (room.phase === 'running') {
      elapsed = Math.max(0, sock.now() - room.startedAt);
      room.mult = Math.max(1, Math.exp(room.growth * elapsed));
      sound.engineSet(room.mult);
      slots.forEach((s) => { if (s.state === 'active') renderSlot(s); });
    } else if (room.phase === 'crashed') {
      elapsed = Math.log(room.crash || 1) / room.growth;
      room.crashT += dt;
    }
    const m = room.phase === 'running' || room.phase === 'crashed' ? room.mult : 1;

    // background: sunburst + stars
    drift += dt * (room.phase === 'running' ? 4 + Math.log(m) * 10 : 0.6);
    ctx.save(); ctx.translate(ox, oy); ctx.rotate(t * 0.05);
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(139,92,246,0.045)' : 'rgba(34,211,238,0.02)';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, Math.hypot(W, H) * 1.2, (i / 24) * Math.PI * 2, ((i + 1) / 24) * Math.PI * 2); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    stars(ctx, dt, W, H, t, drift);

    // axes (eased auto-zoom)
    const tTarget = Math.max(10, elapsed * 1.22), mTarget = Math.max(1.9, m * 1.28);
    view.tMax += (tTarget - view.tMax) * Math.min(1, dt * 4);
    view.mMax += (mTarget - view.mMax) * Math.min(1, dt * 4);
    if (room.phase === 'betting') { view.tMax = 10; view.mMax = 1.9; }
    const X = (s) => ox + (s / view.tMax) * (W - pad.l - pad.r);
    const Y = (v) => oy - ((v - 1) / (view.mMax - 1)) * (H - pad.t - pad.b);
    ctx.strokeStyle = 'rgba(141,150,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ox, pad.t - 10); ctx.lineTo(ox, oy); ctx.lineTo(W - pad.r + 10, oy); ctx.stroke();
    ctx.fillStyle = 'rgba(141,150,255,0.5)'; ctx.font = '600 11px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const tStep = view.tMax > 40 ? 10 : view.tMax > 20 ? 5 : 2;
    for (let s = tStep; s < view.tMax; s += tStep) { const x = X(s); ctx.fillRect(x, oy, 1, 4); ctx.fillText(`${s}s`, x, oy + 8); }

    // curve
    if (room.phase === 'running' || room.phase === 'crashed') {
      const N = 90, pts = [];
      for (let i = 0; i <= N; i++) { const s = (elapsed * i) / N; pts.push([X(s), Y(Math.min(Math.exp(room.growth * s), m))]); }
      const fill = ctx.createLinearGradient(0, Y(view.mMax), 0, oy);
      fill.addColorStop(0, room.phase === 'crashed' ? 'rgba(120,120,160,0.18)' : 'rgba(255,61,110,0.38)');
      fill.addColorStop(1, 'rgba(255,61,110,0.02)');
      ctx.beginPath(); ctx.moveTo(ox, oy); pts.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.lineTo(pts[N][0], oy); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.strokeStyle = room.phase === 'crashed' ? 'rgba(160,160,200,0.6)' : '#ff3d6e';
      ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (room.phase !== 'crashed') { ctx.shadowColor = '#ff3d6e'; ctx.shadowBlur = 16; }
      ctx.stroke(); ctx.shadowBlur = 0; ctx.lineWidth = 1;
      const tip = { x: pts[N][0], y: pts[N][1] };
      const prev = pts[Math.max(0, N - 4)];
      const ang = Math.atan2(tip.y - prev[1], tip.x - prev[0]);
      const sc = clamp(W / 820, 0.75, 1.35);
      if (room.phase === 'running') {
        geomCache.tip = tip;
        if (Math.random() < 0.5) stage.particles.smoke(tip.x - 30 * sc, tip.y + 4, { size: 6 * sc, life: 0.7, vx: -90, vy: 20 });
        drawPlane(ctx, tip.x, tip.y - 10 * sc + Math.sin(t * 6) * 2, Math.max(-0.75, ang * 0.85), sc, t);
      } else {
        const k = ease.inCubic(Math.min(1, room.crashT / 0.9));
        ctx.globalAlpha = 1 - k;
        drawPlane(ctx, tip.x + k * W * 0.6, tip.y - 10 * sc - k * H * 0.5, -0.55, sc, t);
        ctx.globalAlpha = 1;
      }
    } else {
      geomCache.tip = { x: ox + 40, y: oy - 20 };
      const sc = clamp(W / 820, 0.75, 1.35);
      drawPlane(ctx, ox + 46 * sc, oy - 22 * sc + Math.sin(t * 3) * 2, -0.08, sc, t);
    }

    // centre text
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const big = clamp(W / 7.5, 46, 108);
    if (room.phase === 'running' || room.phase === 'crashed') {
      const crashed = room.phase === 'crashed';
      if (crashed) {
        ctx.font = `700 ${big * 0.28}px "Chakra Petch", sans-serif`;
        ctx.fillStyle = '#ff4766'; ctx.fillText('FLEW AWAY!', W / 2, H * 0.42 - big * 0.72);
      }
      ctx.font = `700 ${big}px "Chakra Petch", sans-serif`;
      ctx.shadowColor = crashed ? '#ff4766' : 'rgba(255,255,255,0.6)'; ctx.shadowBlur = crashed ? 30 : 22;
      ctx.fillStyle = crashed ? '#ff4766' : '#ffffff';
      ctx.fillText(`${m.toFixed(2)}×`, W / 2, H * 0.42);
      ctx.shadowBlur = 0;
    } else if (room.phase === 'betting') {
      const left = Math.max(0, room.bettingEnds - sock.now());
      const total = room.bettingTotal || 7;
      ctx.font = `700 ${big * 0.24}px "Chakra Petch", sans-serif`;
      ctx.fillStyle = '#f1f2ff'; ctx.fillText('WAITING FOR NEXT ROUND', W / 2, H * 0.4 - big * 0.25);
      const bw = Math.min(320, W * 0.55), bx = W / 2 - bw / 2, by = H * 0.4 + big * 0.15;
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; roundRect(ctx, bx, by, bw, 8, 4); ctx.fill();
      const g = ctx.createLinearGradient(bx, 0, bx + bw, 0); g.addColorStop(0, '#ff3d6e'); g.addColorStop(1, '#ff8a1f');
      ctx.fillStyle = g; roundRect(ctx, bx, by, bw * clamp(left / total, 0, 1), 8, 4); ctx.fill();
      ctx.font = `600 ${big * 0.16}px "Outfit", sans-serif`; ctx.fillStyle = 'rgba(141,150,255,0.8)';
      ctx.fillText(`Betting closes in ${left.toFixed(1)}s`, W / 2, by + 30);
    } else {
      ctx.font = `600 18px "Outfit", sans-serif`; ctx.fillStyle = 'rgba(141,150,255,0.8)';
      ctx.fillText('Connecting to the live room…', W / 2, H * 0.45);
    }
    if (room.phase === 'betting' && Math.floor(t * 2) !== Math.floor((t - dt) * 2)) slots.forEach(renderSlot);
  });
}
