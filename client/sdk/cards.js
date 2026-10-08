// Playing cards (DOM) and a felt table backdrop shared by the card games.
// Card id 0..51: rank = id % 13 (A..K), suit = floor(id / 13) (♠ ♥ ♦ ♣).
import { glow } from './fx.js';

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['♠', '♥', '♦', '♣'];
export const label = (id) => RANKS[id % 13] + SUITS[Math.floor(id / 13)];

let styled = false;
function injectCss() {
  if (styled) return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = `
    .card { width: var(--w, 90px); aspect-ratio: 5 / 7; border-radius: calc(var(--w, 90px) * .09); position: relative; transform-style: preserve-3d; transition: transform .5s cubic-bezier(.3,1.3,.5,1), box-shadow .3s; flex: none; }
    .card .f, .card .b { position: absolute; inset: 0; border-radius: inherit; backface-visibility: hidden; }
    .card .f { background: linear-gradient(160deg, #ffffff, #eceefe); color: #161935; box-shadow: 0 10px 22px -8px rgba(0,0,0,.75), inset 0 0 0 1px rgba(0,0,0,.08); }
    .card .f.red { color: #e3123f; }
    .card .f .r { position: absolute; top: 6%; left: 9%; font-family: var(--f-display); font-weight: 700; font-size: calc(var(--w, 90px) * .22); line-height: .95; text-align: center; }
    .card .f .r small { display: block; font-size: .78em; }
    .card .f .r2 { top: auto; left: auto; bottom: 6%; right: 9%; transform: rotate(180deg); }
    .card .f .s { position: absolute; inset: 0; display: grid; place-items: center; font-size: calc(var(--w, 90px) * .46); }
    .card .b { transform: rotateY(180deg); background: repeating-linear-gradient(45deg, #5b3fd6 0 7px, #4a2fc0 7px 14px); box-shadow: inset 0 0 0 calc(var(--w, 90px) * .045) #fff, 0 10px 22px -8px rgba(0,0,0,.75); }
    .card.down { transform: rotateY(180deg); }
    .card.win .f { box-shadow: 0 0 0 3px var(--gold), 0 0 26px rgba(255,197,61,.7); }
    .card.hot .f { box-shadow: 0 0 0 3px var(--green), 0 0 26px rgba(31,229,143,.7); }
    .card.dim { filter: brightness(.55) saturate(.6); }
    .card.side { transform: rotate(90deg); margin-inline: calc(var(--w, 90px) * .2); }
  `;
  document.head.append(s);
}

function faceHtml(id) {
  if (id === null || id === undefined) return '<div class="f"></div><div class="b"></div>';
  const r = RANKS[id % 13], s = SUITS[Math.floor(id / 13)], red = s === '♥' || s === '♦';
  return `<div class="f ${red ? 'red' : ''}"><div class="r">${r}<small>${s}</small></div><div class="s">${s}</div><div class="r r2">${r}<small>${s}</small></div></div><div class="b"></div>`;
}

export function card(id, { w = 90, down = false, cls = '' } = {}) {
  injectCss();
  const el = document.createElement('div');
  el.className = `card ${down ? 'down' : ''} ${cls}`;
  el.style.setProperty('--w', `${w}px`);
  el.innerHTML = faceHtml(down ? id ?? null : id);
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', id === null || id === undefined || down ? 'Face-down card' : label(id));
  return el;
}

/** Turn a face-down card face up (optionally revealing which card it is). */
export function flip(el, id) {
  if (id !== undefined) { el.innerHTML = faceHtml(id); el.setAttribute('aria-label', label(id)); }
  requestAnimationFrame(() => el.classList.remove('down'));
}

/** Append a card that flies in from (dx, dy) relative to its final spot. Resolves when it lands. */
export function deal(container, id, { w = 90, down = false, dx = 0, dy = -220, delay = 0, cls = '' } = {}) {
  const el = card(id, { w, down, cls });
  container.append(el);
  const end = down ? 'rotateY(180deg)' : '';
  const anim = el.animate([
    { transform: `translate(${dx}px, ${dy}px) rotate(-14deg) rotateY(180deg)`, opacity: 0.2 },
    { transform: end || 'none', opacity: 1 },
  ], { duration: 420, delay: delay * 1000, easing: 'cubic-bezier(.2,1,.35,1)', fill: 'backwards' });
  return anim.finished.then(() => el);
}

/** Felt table backdrop for the stage canvas. */
export function felt(stage, tint = '#0f5a3c') {
  stage.draw((ctx, dt, W, H) => {
    const g = ctx.createRadialGradient(W / 2, H * 0.35, 10, W / 2, H * 0.5, Math.max(W, H) * 0.75);
    g.addColorStop(0, tint); g.addColorStop(0.65, '#073323'); g.addColorStop(1, '#03170f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,215,120,.18)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(W / 2, H * 0.08, W * 0.62, H * 0.75, 0, 0.12 * Math.PI, 0.88 * Math.PI); ctx.stroke();
    glow(ctx, W / 2, H * 0.4, Math.max(W, H) * 0.4, '#1fe58f', 0.05);
  });
}
