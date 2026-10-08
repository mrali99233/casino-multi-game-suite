// DOM building blocks shared by every game: shell, inputs, modals, big-win overlay, auto-bet.
import { fmtMult } from './api.js';
import { ease, tween, wait } from './fx.js';
import { sound } from './sound.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(kid));
  return el;
}

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  sound: svg('<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'),
  shield: svg('<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  close: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
};

// ---------- toasts ----------
let toastBox;
export function toast(msg, kind = '') {
  toastBox ||= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = toastBox.appendChild(h('div', { class: `toast ${kind}` }, msg));
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2600);
}

// ---------- modal ----------
export function modal(title, body) {
  const back = h('div', { class: 'modal-back' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('header', {}, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', html: ICON.close, onclick: close })),
    h('div', { class: 'body' }, body));
  back.append(box);
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  return { close, body: box.querySelector('.body') };
}

// ---------- shell ----------
export function buildShell(root, { name, demo, returnUrl, money }) {
  const balanceEl = h('strong', { class: 'num' }, '—');
  const btn = (icon, label, onclick, pressed) => h('button', { class: 'icon-btn', 'aria-label': label, title: label, html: icon, onclick, 'aria-pressed': pressed });
  const soundBtn = btn(ICON.sound, 'Sound', () => { soundBtn.setAttribute('aria-pressed', sound.toggle()); }, String(sound.enabled));
  const fairBtn = btn(ICON.shield, 'Provably fair');
  const histBtn = btn(ICON.history, 'My bets');
  const infoBtn = btn(ICON.info, 'Game rules');
  const top = h('header', { class: 'topbar' },
    returnUrl ? h('a', { class: 'icon-btn', href: returnUrl, 'aria-label': 'Back to lobby', html: ICON.back }) : null,
    h('div', { class: 'brand' }, h('div', { class: 'logo' }, 'CM'), h('h1', {}, name), demo ? h('span', { class: 'badge' }, 'Demo') : null),
    h('div', { class: 'spacer' }),
    h('div', { class: 'balance' }, h('span', {}, 'Balance'), balanceEl),
    soundBtn, fairBtn, histBtn, infoBtn);
  const controls = h('aside', { class: 'controls', 'aria-label': 'Bet controls' });
  const strip = h('div', { class: 'strip', 'aria-label': 'Recent results' });
  const overlay = h('div', { class: 'overlay' });
  const stage = h('section', { class: 'stage', 'aria-label': `${name} game area` }, strip, overlay);
  root.append(h('div', { class: 'shell' }, top, h('div', { class: 'main' }, controls, stage)));

  // Wallet display: server balance minus winnings still "in flight" in an animation.
  const wallet = {
    server: 0, held: 0, shown: 0, gen: 0,
    sync(balance) { if (typeof balance === 'number') { this.server = balance; this.render(); } },
    hold(amount) { this.held += amount; this.render(); },
    release(amount) { this.held = Math.max(0, this.held - amount); this.render(true); },
    get available() { return this.server - this.held; },
    render(celebrate = false) {
      const target = this.server - this.held;
      const from = this.shown;
      this.shown = target;
      const box = { v: from };
      const gen = ++this.gen;  // a newer update cancels any count-up still running
      if (target > from && celebrate) { balanceEl.classList.add('up'); setTimeout(() => balanceEl.classList.remove('up'), 700); }
      tween(box, { v: target }, { dur: target > from ? 0.6 : 0.2, ease: ease.outCubic, onUpdate: () => { if (gen === this.gen) balanceEl.textContent = money.fmt(Math.round(box.v)); } });
    },
  };

  return { root, controls, stage, strip, overlay, wallet, fairBtn, histBtn, infoBtn };
}

// ---------- inputs ----------
export function betAmount({ money, min, max, value, label = 'Bet amount' }) {
  const input = h('input', { type: 'text', inputmode: 'decimal', value: money.plain(value), 'aria-label': label });
  const clampV = (v) => Math.max(min, Math.min(max, Number.isFinite(v) ? v : min));
  const set = (v) => { input.value = money.plain(clampV(v)); sound.click(); };
  const half = h('button', { class: 'chip-btn', type: 'button', onclick: () => set(Math.floor(api.value / 2)) }, '½');
  const dbl = h('button', { class: 'chip-btn', type: 'button', onclick: () => set(api.value * 2) }, '2×');
  input.addEventListener('blur', () => { input.value = money.plain(clampV(money.toMinor(input.value))); });
  const el = h('div', { class: 'field' }, h('div', { class: 'lbl' }, label, h('em', {}, `${money.plain(min)} – ${money.plain(max)}`)),
    h('div', { class: 'input' }, input, h('span', { class: 'unit' }, money.currency), half, dbl));
  const api = {
    el,
    get value() { return clampV(money.toMinor(input.value)); },
    set value(v) { input.value = money.plain(clampV(v)); },
    set disabled(d) { input.disabled = d; half.disabled = d; dbl.disabled = d; },
  };
  return api;
}

export function segmented(label, options, value, onChange) {
  let current = value;
  const buttons = options.map(([v, text]) => h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => api.set(v, true) }, text));
  const el = h('div', { class: 'field' }, label ? h('div', { class: 'lbl' }, label) : null, h('div', { class: 'seg', role: 'group', 'aria-label': label }, buttons));
  const api = {
    el,
    get value() { return current; },
    set(v, user = false) {
      current = v;
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === v)));
      if (user) { sound.click(); onChange && onChange(v); }
    },
    set disabled(d) { buttons.forEach((b) => { b.disabled = d; }); },
  };
  return api;
}

export function numberField(label, { value, step = 'any', suffix = '', hint = '' } = {}) {
  const input = h('input', { type: 'text', inputmode: 'decimal', value: String(value), 'aria-label': label, step });
  const el = h('div', { class: 'field' }, h('label', {}, label, hint ? h('em', {}, hint) : null), h('div', { class: 'input' }, input, suffix ? h('span', { class: 'unit' }, suffix) : null));
  return { el, input, get value() { return parseFloat(input.value.replace(',', '.')); }, set value(v) { input.value = v; }, set disabled(d) { input.disabled = d; } };
}

export function switchField(label, checked = false) {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = checked;
  return { el: h('label', { class: 'switch' }, label, input), input, get checked() { return input.checked; }, set disabled(d) { input.disabled = d; } };
}

export function stats(items) {
  const refs = {};
  const el = h('div', { class: 'stat-row' }, items.map(([key, label]) => { refs[key] = h('b', {}, '—'); return h('div', { class: 'stat' }, h('span', {}, label), refs[key]); }));
  return { el, set: (key, text) => { refs[key].textContent = text; } };
}

// ---------- result strip ----------
export function pushResult(strip, mult, cls) {
  strip.prepend(h('span', { class: `pill ${cls || (mult >= 10 ? 'hi' : mult >= 2 ? 'mid' : mult >= 1 ? 'win' : 'loss')}` }, fmtMult(mult)));
  while (strip.children.length > 18) strip.lastChild.remove();
}

// ---------- big win ----------
export async function bigWin(shell, stage, { mult, amount, money }) {
  if (mult < 10) return;
  const tier = mult >= 100 ? ['EPIC WIN', 'mega', 3] : mult >= 30 ? ['MEGA WIN', 'mega', 3] : ['BIG WIN', '', 2];
  const amt = h('div', { class: 'amount' }, money.fmt(0));
  const node = h('div', { class: 'bigwin', role: 'status' }, h('div', { class: 'card' }, h('div', { class: `title ${tier[1]}` }, tier[0]), amt, h('div', { class: 'mult' }, fmtMult(mult))));
  shell.overlay.append(node);
  sound.win(tier[2]);
  const P = stage.particles, cx = stage.w / 2, by = stage.h;
  P.coins(cx, by + 10, { count: 40 });
  P.confetti(cx, by * 0.55, { count: 90 });
  setTimeout(() => P.coins(cx * 0.6, by + 10, { count: 25 }), 350);
  setTimeout(() => P.coins(cx * 1.4, by + 10, { count: 25 }), 600);
  const box = { v: 0 };
  await tween(box, { v: amount }, { dur: 1.6, ease: ease.outQuart, onUpdate: () => { amt.textContent = money.fmt(Math.round(box.v)); } });
  await wait(1.4);
  node.classList.add('out');
  await wait(0.4);
  node.remove();
}

// ---------- auto bet (instant games) ----------
export function autoPanel(money) {
  const count = numberField('Number of bets', { value: 10, hint: '0 = until stopped' });
  const profit = numberField('Stop on profit', { value: 0, suffix: money.currency, hint: '0 = off' });
  const loss = numberField('Stop on loss', { value: 0, suffix: money.currency, hint: '0 = off' });
  const el = h('div', { class: 'field', style: 'gap:12px' }, count.el, profit.el, loss.el);
  let running = false, stopRequested = false;
  return {
    el,
    get running() { return running; },
    stop() { stopRequested = true; },
    async run(playOnce, { onState, delay = 0.25 } = {}) {
      running = true; stopRequested = false; onState && onState(true);
      [count, profit, loss].forEach((f) => { f.disabled = true; });
      const n = Math.max(0, Math.floor(count.value || 0));
      const stopWin = money.toMinor(profit.value || 0), stopLoss = money.toMinor(loss.value || 0);
      let done = 0, net = 0;
      try {
        while (!stopRequested && (n === 0 || done < n)) {
          const r = await playOnce();
          if (!r) break;
          done++; net += r.payout - r.bet;
          if (n) count.value = String(n - done);
          if ((stopWin > 0 && net >= stopWin) || (stopLoss > 0 && -net >= stopLoss)) { toast(`Auto bet stopped: ${net >= 0 ? 'profit' : 'loss'} ${money.fmt(Math.abs(net))}`, net >= 0 ? 'ok' : ''); break; }
          await wait(delay);
        }
      } finally {
        if (n) count.value = String(n);
        running = false; [count, profit, loss].forEach((f) => { f.disabled = false; }); onState && onState(false);
      }
    },
  };
}

// ---------- standard modals ----------
export async function openHistory(api, money) {
  const body = h('div', {}, h('p', {}, 'Loading…'));
  modal('My bets', body);
  try {
    const { rounds } = await api.history(30);
    body.replaceChildren(rounds.length ? h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Time'), h('th', {}, 'Bet'), h('th', {}, 'Multiplier'), h('th', {}, 'Payout'))),
      h('tbody', {}, rounds.map((r) => h('tr', {},
        h('td', {}, new Date(r.created_at + (r.created_at.endsWith('Z') || r.created_at.includes('+') ? '' : 'Z')).toLocaleTimeString()),
        h('td', { class: 'num' }, money.fmt(r.bet)),
        h('td', { class: 'num', style: `color:${r.payout > r.bet ? 'var(--green)' : 'var(--muted)'}` }, fmtMult(r.multiplier)),
        h('td', { class: 'num' }, money.fmt(r.payout)))))) : h('p', {}, 'No settled bets yet.'));
  } catch (e) { body.replaceChildren(h('p', {}, e.message)); }
}

export async function openFairness(api, init) {
  const isCrash = init.game.id === 'crash';
  const body = h('div', { style: 'display:flex;flex-direction:column;gap:14px' });
  modal('Provably fair', body);
  const render = async (reveal) => {
    if (isCrash) {
      body.replaceChildren(
        h('p', {}, 'Every Aviator round publishes SHA-256(server seed) before betting opens. When the plane flies away the seed is revealed and the crash point is crash = RTP / (1 − r), where r comes from HMAC-SHA256(server seed, salt:round).'),
        h('h3', {}, 'Recent rounds'), h('div', { id: 'fair-list' }, h('p', {}, 'Loading…')));
      const { rounds } = await api.history(8);
      const ids = [...new Set(rounds.map((r) => r.params.crash_game_id))].slice(0, 6);
      const rows = await Promise.all(ids.map((id) => api.crashRound(id).catch(() => null)));
      body.querySelector('#fair-list').replaceChildren(rows.filter(Boolean).length ? h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Round'), h('th', {}, 'Crash'), h('th', {}, 'Recomputed'), h('th', {}, 'Seed'))),
        h('tbody', {}, rows.filter(Boolean).map((g) => h('tr', {}, h('td', {}, `#${g.game_id}`), h('td', { class: 'num' }, g.crash ? fmtMult(g.crash) : '…'),
          h('td', { class: 'num', style: 'color:var(--green)' }, g.recomputed ? `${fmtMult(g.recomputed)} ✓` : 'pending'), h('td', {}, h('code', {}, (g.server_seed || g.server_seed_hash).slice(0, 16) + '…')))))) : h('p', {}, 'Place a bet to see your rounds here.'));
      return;
    }
    const seeds = await api.seeds();
    const clientInput = h('input', { value: seeds.client_seed, 'aria-label': 'Client seed', maxlength: 64 });
    const rotateBtn = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Reveal server seed & rotate');
    rotateBtn.addEventListener('click', async () => {
      rotateBtn.disabled = true;
      try { render(await api.rotate(clientInput.value.trim())); } catch (e) { toast(e.message, 'err'); rotateBtn.disabled = false; }
    });
    body.replaceChildren(
      h('p', {}, 'Each result comes from HMAC-SHA256(server seed, client seed:nonce). You see the server seed hash before betting; rotating reveals the seed so you can recompute every past round.'),
      h('dl', { class: 'kv' }, h('dt', {}, 'Server seed hash'), h('dd', {}, h('code', {}, seeds.server_seed_hash)), h('dt', {}, 'Nonce'), h('dd', { class: 'num' }, String(seeds.nonce))),
      h('div', { class: 'field' }, h('label', {}, 'Client seed', h('em', {}, 'applies after rotating')), h('div', { class: 'input' }, clientInput)),
      rotateBtn,
      reveal ? h('div', { class: 'field', id: 'reveal' }) : null);
    if (reveal) {
      const box = body.querySelector('#reveal');
      const prev = reveal.previous;
      box.append(h('h3', {}, 'Revealed seed'), h('dl', { class: 'kv' },
        h('dt', {}, 'Server seed'), h('dd', {}, h('code', {}, prev.server_seed)),
        h('dt', {}, 'Client seed'), h('dd', {}, h('code', {}, prev.client_seed)),
        h('dt', {}, 'Bets with it'), h('dd', { class: 'num' }, String(prev.nonce))));
      const { rounds } = await api.history(50);
      const mine = rounds.filter((r) => r.fairness.server_seed_hash === prev.server_seed_hash).slice(0, 6);
      if (mine.length) {
        const checks = await Promise.all(mine.map((r) => api.verify({ game_id: r.game_id, server_seed: prev.server_seed, client_seed: r.fairness.client_seed, nonce: r.fairness.nonce, params: r.params, rtp: r.rtp }).then((v) => [r, v]).catch(() => [r, null])));
        box.append(h('h3', {}, 'Recomputed from the revealed seed'), h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Nonce'), h('th', {}, 'Your result'), h('th', {}, 'Recomputed'))),
          h('tbody', {}, checks.map(([r, v]) => {
            const recomputed = v ? (v.secret ? 'same hidden layout' : fmtMult(v.multiplier)) : 'error';
            const same = v && (v.secret
              ? Object.entries(v.secret).every(([k, val]) => JSON.stringify(val) === JSON.stringify(r.result[k]))
              : JSON.stringify(v.result) === JSON.stringify(r.result) && v.multiplier === r.multiplier);
            return h('tr', {}, h('td', { class: 'num' }, String(r.fairness.nonce)), h('td', { class: 'num' }, fmtMult(r.multiplier)), h('td', { class: 'num', style: `color:${same ? 'var(--green)' : 'var(--red)'}` }, `${recomputed} ${same ? '✓' : '✗'}`));
          }))));
      }
    }
  };
  render(null).catch((e) => body.replaceChildren(h('p', {}, e.message)));
}

export function openRules(init, money, rulesHtml) {
  const g = init.game;
  modal(`${g.name} rules`, h('div', { style: 'display:flex;flex-direction:column;gap:12px' },
    h('div', { html: rulesHtml }),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Return to player'), h('dd', { class: 'num' }, `${(g.rtp * 100).toFixed(2)}%`),
      h('dt', {}, 'Bet range'), h('dd', { class: 'num' }, `${money.fmt(g.min_bet)} – ${money.fmt(g.max_bet)}`),
      h('dt', {}, 'Max win per bet'), h('dd', { class: 'num' }, money.fmt(g.max_win)))));
}
