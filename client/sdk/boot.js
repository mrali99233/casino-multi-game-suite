// Game page entry: authenticate the launch token, build the shell and mount the game module.
import { Api, makeMoney } from './api.js';
import { Stage } from './fx.js';
import { sound } from './sound.js';
import * as ui from './ui.js';

function fatal(message) {
  document.getElementById('app').replaceChildren(ui.h('div', { class: 'fatal' },
    ui.h('div', { class: 'logo' }, 'CM'), ui.h('h1', {}, 'Game unavailable'), ui.h('p', {}, message),
    ui.h('a', { href: '/', class: 'btn btn-ghost' }, 'Open lobby')));
}

async function main() {
  const token = new URLSearchParams(location.search).get('token');
  if (!token) { fatal('This page needs a launch token. Start the game from the casino lobby.'); return; }
  const api = new Api(token);
  let init;
  try { init = await api.init(); } catch (e) { fatal(e.message); return; }
  document.title = `${init.game.name} · Casino Matrix`;
  const money = makeMoney(init.player.currency);
  const shell = ui.buildShell(document.getElementById('app'), { name: init.game.name, demo: init.player.demo, returnUrl: init.return_url, money });
  shell.wallet.sync(init.balance);
  const stage = new Stage(shell.stage);
  const mod = await import(`../games/${init.game.id}.js`);
  shell.fairBtn.addEventListener('click', () => ui.openFairness(api, init));
  shell.histBtn.addEventListener('click', () => ui.openHistory(api, money));
  shell.infoBtn.addEventListener('click', () => ui.openRules(init, money, mod.rules || ''));
  mod.mount({ api, init, money, shell, stage, sound, ui, token });
}

main();
