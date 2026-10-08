// Chicken Road client: a chicken hops across traffic lanes; each lane cleared raises the multiplier.
import { fmtMult } from '../sdk/api.js';
import { clamp, ease, roundRect, tween } from '../sdk/fx.js';

export const rules = `
<p>Help the chicken cross the road one lane at a time. Each lane cleared raises your multiplier; get hit by a car and the bet is lost. Cash out whenever you like.</p>
<p>Difficulty sets the chance to survive each lane (Easy 90%, Medium 80%, Hard 70%, Daredevil 55%). After <b>k</b> lanes the multiplier is RTP ÷ p<sup>k</sup>.</p>`;

const CAR_COLORS = ['#ff4766', '#22d3ee', '#ffc53d', '#8b5cf6', '#1fe58f', '#ff8a1f'];

export function mount({ api, init, money, shell, stage, sound, ui }) {
  const { h } = ui;
  const D = init.game.data.difficulties;
  const st = { diff: 'medium', round: null, busy: false, pos: 0, hop: 0, cam: 0, dead: null, splatT: 0, hitCar: null, cars: [], cleared: 0 };

  const amount = ui.betAmount({ money, min: init.game.min_bet, max: init.game.max_bet, value: Math.max(init.game.min_bet, 100) });
  const diff = ui.segmented('Difficulty', Object.keys(D).map((d) => [d, d === 'daredevil' ? 'Dare' : d[0].toUpperCase() + d.slice(1)]), st.diff, (v) => { st.diff = v; resetScene(); render(); });
  const go = h('button', { class: 'btn btn-bet', type: 'button' }, 'Bet');
  const cash = h('button', { class: 'btn btn-cash', type: 'button', hidden: true }, 'Cash out');
  const info = ui.stats([['next', 'Next lane'], ['chance', 'Survive']]);
  shell.controls.append(amount.el, diff.el, go, cash, info.el);

  const lanes = () => D[st.round ? st.round.params.difficulty : st.diff].lanes;
  const ladder = () => D[st.round ? st.round.params.difficulty : st.diff].ladder;

  function resetScene() { st.pos = 0; st.cam = 0; st.dead = null; st.hitCar = null; st.cleared = 0; st.cars = []; }

  function render() {
    const r = st.round, live = !!r;
    amount.disabled = live || st.busy; diff.disabled = live || st.busy;
    const k = live ? r.result.lane : 0;
    go.className = 'btn btn-bet';
    go.textContent = live ? (k < lanes() ? 'Go' : 'Done') : 'Bet';
    go.disabled = st.busy;
    cash.hidden = !live;
    cash.disabled = st.busy || !r?.cashout_amount;
    cash.innerHTML = r?.cashout_amount ? `Cash out<small class="num">${money.fmt(r.cashout_amount)}</small>` : 'Cash out<small>Cross a lane first</small>';
    const lad = ladder();
    info.set('next', k < lad.length ? fmtMult(lad[k] / 100) : '—');
    info.set('chance', `${(D[r ? r.params.difficulty : st.diff].survive * 100).toFixed(0)}%`);
  }

  async function start() {
    const bet = amount.value;
    if (bet > shell.wallet.available) { ui.toast('Not enough balance for this bet', 'err'); return; }
    st.busy = true; render();
    try { const r = await api.roundStart(bet, { difficulty: st.diff }); resetScene(); st.round = r; shell.wallet.sync(r.balance); sound.bet(); }
    catch (e) { ui.toast(e.message, 'err'); }
    st.busy = false; render();
  }

  async function step() {
    if (!st.round || st.busy) return;
    st.busy = true; render();
    let r;
    try { r = await api.roundAct({ move: 'go' }); } catch (e) { ui.toast(e.message, 'err'); st.busy = false; render(); return; }
    const from = st.pos, to = from + 1;
    sound.whoosh();
    if (r.result.hit !== undefined) {
      // a car comes down the lane as the chicken lands
      st.hitCar = { lane: from, y: -0.4, color: CAR_COLORS[(to * 7) % CAR_COLORS.length] };
      const hop = { p: from };
      await tween(hop, { p: from + 0.85 }, { dur: 0.35, ease: ease.outQuad, onUpdate: () => { st.pos = hop.p; st.hop = Math.sin((hop.p - from) / 0.85 * Math.PI); } });
      const car = { y: -0.4 };
      await tween(car, { y: 0.5 }, { dur: 0.22, ease: ease.inQuad, onUpdate: () => { st.hitCar.y = car.y; } });
      st.dead = { lane: from + 0.85 }; st.splatT = 0;
      sound.explode(); stage.shake(12, 0.5);
      const g = geom(), x = g.chickenX(from + 0.85) - st.cam, y = g.roadMid;
      stage.particles.spark(x, y, { count: 50, color: '#ffffff', speed: 320, gravity: 500, size: 3 });
      stage.particles.spark(x, y, { count: 30, color: '#ffc53d', speed: 260 });
      tween(car, { y: 1.6 }, { dur: 0.5, ease: ease.linear, onUpdate: () => { st.hitCar.y = car.y; } });
      st.round = null; shell.wallet.sync(r.balance);
      ui.pushResult(shell.strip, 0, 'loss');
    } else {
      const hop = { p: from };
      await tween(hop, { p: to }, { dur: 0.42, ease: ease.inOutCubic, onUpdate: () => { st.pos = hop.p; st.hop = Math.sin((hop.p - from) * Math.PI); } });
      st.pos = to; st.hop = 0; st.cleared = to;
      sound.gem(to);
      const g = geom();
      stage.particles.spark(g.chickenX(to) - st.cam, g.roadMid + 10, { count: 16, color: '#1fe58f', speed: 160, life: 0.5 });
      if (r.status === 'settled') { st.round = null; shell.wallet.sync(r.balance); win(r); } else st.round = r;
    }
    st.busy = false; render();
  }

  function win(r) {
    sound.cashout();
    stage.particles.coins(stage.w / 2, stage.h, { count: 26 });
    stage.particles.text(stage.w / 2, stage.h * 0.35, `${fmtMult(r.multiplier)}  +${money.fmt(r.payout)}`, { color: '#1fe58f', size: 30, life: 1.6 });
    ui.pushResult(shell.strip, r.multiplier);
    if (r.multiplier >= 10) ui.bigWin(shell, stage, { mult: r.multiplier, amount: r.payout, money });
  }

  async function cashout() {
    if (!st.round || st.busy) return;
    st.busy = true; render();
    try { const r = await api.roundCashout(); st.round = null; shell.wallet.sync(r.balance); win(r); } catch (e) { ui.toast(e.message, 'err'); }
    st.busy = false; render();
  }

  go.addEventListener('click', () => (st.round ? step() : start()));
  cash.addEventListener('click', cashout);
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && st.round && !['INPUT', 'SELECT'].includes(document.activeElement?.tagName)) { e.preventDefault(); step(); } });

  if (init.open_round) { st.round = init.open_round; st.diff = st.round.params.difficulty; diff.set(st.diff); st.pos = st.cleared = st.round.result.lane; }
  render();

  // ---------- scene ----------
  function geom() {
    const W = stage.w, H = stage.h;
    const laneW = clamp(W / 6.2, 90, 170);
    const top = 50, bottom = H - 18, roadMid = top + (bottom - top) * 0.55;
    const laneX = (i) => laneW * 0.9 + i * laneW + laneW / 2;
    const spot = (p) => (p <= 0 ? laneW * 0.45 : laneX(p - 1));  // where the chicken stands after p lanes
    const chickenX = (p) => { const lo = Math.floor(p), f = p - lo; return spot(lo) + (spot(lo + 1) - spot(lo)) * f; };
    return { laneW, top, bottom, roadMid, laneX, chickenX, sidewalk: laneW * 0.9 };
  }

  function drawChicken(ctx, x, y, s, dead) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    if (dead) { ctx.rotate(Math.PI / 2); ctx.globalAlpha = 0.85; }
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(0, 26, 20, 6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff9f1c'; ctx.fillRect(-8, 14, 3, 12); ctx.fillRect(5, 14, 3, 12);
    const body = ctx.createRadialGradient(-6, -6, 3, 0, 0, 26); body.addColorStop(0, '#ffffff'); body.addColorStop(1, '#e3e6f5');
    ctx.fillStyle = body; ctx.beginPath(); ctx.ellipse(0, 2, 20, 18, 0, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(10, -14, 11, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff4766'; ctx.beginPath(); ctx.arc(8, -26, 4, 0, 7); ctx.arc(13, -25, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffb21c'; ctx.beginPath(); ctx.moveTo(20, -14); ctx.lineTo(28, -11); ctx.lineTo(20, -8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#161935'; ctx.beginPath(); ctx.arc(13, -16, dead ? 0 : 2, 0, 7); ctx.fill();
    if (dead) { ctx.strokeStyle = '#161935'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(11, -18); ctx.lineTo(15, -14); ctx.moveTo(15, -18); ctx.lineTo(11, -14); ctx.stroke(); }
    ctx.fillStyle = '#d4d8ee'; ctx.beginPath(); ctx.ellipse(-4, 4, 10, 7, -0.4, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawCar(ctx, x, y, w, color) {
    const len = w * 1.25;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; roundRect(ctx, -w / 2 + 4, -len / 2 + 6, w, len, 10); ctx.fill();
    ctx.fillStyle = color; roundRect(ctx, -w / 2, -len / 2, w, len, 10); ctx.fill();
    ctx.fillStyle = 'rgba(200,235,255,.85)'; roundRect(ctx, -w * 0.36, len * 0.08, w * 0.72, len * 0.2, 5); ctx.fill();
    roundRect(ctx, -w * 0.36, -len * 0.3, w * 0.72, len * 0.16, 5); ctx.fill();
    ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(-w * 0.3, len * 0.46, 4, 0, 7); ctx.arc(w * 0.3, len * 0.46, 4, 0, 7); ctx.fill();
    ctx.restore();
  }

  stage.draw((ctx, dt, W, H, t) => {
    const g = geom(), n = lanes(), lad = ladder();
    const target = Math.max(0, g.chickenX(st.pos) - W * 0.35);
    st.cam += (target - st.cam) * Math.min(1, dt * 5);
    ctx.fillStyle = '#20233a'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(-st.cam, 0);
    // sidewalk start + finish
    ctx.fillStyle = '#3a3f6e'; ctx.fillRect(-W, 0, g.sidewalk + W, H);
    for (let y = 0; y < H; y += 26) { ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(0, y, g.sidewalk, 2); }
    const endX = g.laneX(n - 1) + g.laneW / 2;
    ctx.fillStyle = '#2f6b4a'; ctx.fillRect(endX, 0, W * 2, H);
    // lanes
    for (let i = 0; i < n; i++) {
      const x = g.laneX(i) - g.laneW / 2;
      ctx.fillStyle = i % 2 ? '#2a2d4d' : '#272a48'; ctx.fillRect(x, 0, g.laneW, H);
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 3; ctx.setLineDash([22, 18]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]);
      // ambient traffic in lanes ahead
      if (i >= st.cleared && !(st.hitCar && st.hitCar.lane === i)) {
        const speed = 0.35 + ((i * 37) % 10) / 20, off = ((t * speed + i * 0.37) % 1.6) - 0.3;
        if (i > st.cleared || !st.round) drawCar(ctx, g.laneX(i), off * H, g.laneW * 0.5, CAR_COLORS[i % CAR_COLORS.length]);
      }
      // manhole cover with multiplier
      const cx = g.laneX(i), cy = g.roadMid, r = g.laneW * 0.36;
      const passed = i < st.cleared;
      ctx.fillStyle = passed ? '#0e5a3c' : '#3b3f66'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.fill();
      ctx.strokeStyle = passed ? '#1fe58f' : i === st.cleared && st.round ? '#ffc53d' : 'rgba(255,255,255,.25)'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = passed ? '#1fe58f' : '#f1f2ff'; ctx.font = `700 ${Math.max(11, r * 0.42)}px "Chakra Petch", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(fmtMult(lad[i] / 100), cx, cy);
      if (passed) { ctx.fillStyle = '#ffc53d'; roundRect(ctx, cx - g.laneW * 0.4, cy - r - 30, g.laneW * 0.8, 10, 5); ctx.fill(); }
    }
    if (st.hitCar) drawCar(ctx, g.laneX(st.hitCar.lane), g.top + st.hitCar.y * H, g.laneW * 0.55, st.hitCar.color);
    // chicken
    drawChicken(ctx, g.chickenX(st.pos), g.roadMid - st.hop * 34, clamp(g.laneW / 110, 0.8, 1.4), !!st.dead);
    ctx.restore();
    if (!st.round && !st.dead && !st.cleared) {
      ctx.fillStyle = 'rgba(7,8,26,.7)'; roundRect(ctx, W / 2 - 150, 60, 300, 38, 19); ctx.fill();
      ctx.fillStyle = '#ffc53d'; ctx.font = '700 16px "Chakra Petch", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(`${n} LANES · UP TO ${fmtMult(lad[n - 1] / 100)}`, W / 2, 80);
    }
  });
}
