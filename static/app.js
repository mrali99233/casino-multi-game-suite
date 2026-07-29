// Casino Matrix Pro - Multi-Game Suite Controller

let balance = 1000.00;
let soundEnabled = true;
let audioCtx = null;
let activeGameId = null;

const userBalanceEl = document.getElementById('user-balance');
const dashboardView = document.getElementById('dashboard-view');
const stageView = document.getElementById('stage-view');
const stageGameTitle = document.getElementById('stage-game-title');
const gameContainer = document.getElementById('game-container');
const gamesGrid = document.getElementById('games-grid');
const btnBackHub = document.getElementById('btn-back-hub');
const btnSound = document.getElementById('btn-sound');

function updateWalletDisplay() {
    userBalanceEl.textContent = `$${balance.toFixed(2)}`;
}

// Audio FX Synthesizer
function playWinChime() {
    if (!soundEnabled) return;
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.1);
        osc.frequency.setValueAtTime(783.99, now + 0.2);

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.4);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.4);
    } catch (e) {}
}

function playLossBoom() {
    if (!soundEnabled) return;
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.3);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.35);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
    } catch (e) {}
}

btnSound.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    btnSound.textContent = `🔊 SOUND ${soundEnabled ? 'ON' : 'OFF'}`;
});

btnBackHub.addEventListener('click', () => {
    stageView.style.display = 'none';
    dashboardView.style.display = 'block';
    gameContainer.innerHTML = '';
    activeGameId = null;
});

// Load & Render Games List
async function loadGamesList() {
    try {
        const resp = await fetch('/api/games');
        const games = await resp.json();
        renderGamesGrid(games);
    } catch (e) {
        console.error('Failed to load games registry:', e);
    }
}

function renderGamesGrid(games) {
    gamesGrid.innerHTML = '';
    games.forEach(g => {
        const card = document.createElement('div');
        card.className = 'game-card';
        card.innerHTML = `
            <div class="card-top">
                <span class="card-icon">${g.icon}</span>
                <span class="card-tag" style="background:${g.color}">${g.tag}</span>
            </div>
            <div class="card-bottom">
                <h4>${g.name}</h4>
                <span class="play-lbl">PLAY NOW →</span>
            </div>
        `;
        card.addEventListener('click', () => openGameStage(g));
        gamesGrid.appendChild(card);
    });
}

function openGameStage(game) {
    activeGameId = game.id;
    dashboardView.style.display = 'none';
    stageView.style.display = 'flex';
    stageGameTitle.textContent = `${game.icon} ${game.name.toUpperCase()}`;
    gameContainer.innerHTML = '';

    if (game.id === 'mines') renderMinesStage();
    else if (game.id === 'dice') renderDiceStage();
    else if (game.id === 'slots') renderSlotsStage();
    else if (game.id === 'wheel') renderWheelStage();
    else if (game.id === 'hilo') renderHiLoStage();
    else renderPlaceholderStage(game);
}

// 1. MINES STAGE RENDERER (5x5 Grid)
let minesGameState = { active: false, bet: 10, count: 3, mult: 1.00 };

function renderMinesStage() {
    gameContainer.innerHTML = `
        <div style="text-align: center; width: 100%; max-width: 450px;">
            <div class="mines-grid-container" id="mines-grid">
                ${Array(25).fill(0).map((_, i) => `<div class="mine-tile" data-idx="${i}">❓</div>`).join('')}
            </div>

            <div style="display: flex; gap: 12px; justify-content: center; align-items: center; margin-bottom: 16px;">
                <div style="background: rgba(0,0,0,0.5); padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border-color);">
                    <span style="font-size:0.7rem; color:var(--text-muted); display:block;">MULTIPLIER</span>
                    <strong id="mines-mult-val" style="font-size:1.2rem; color:var(--accent-emerald);">1.00x</strong>
                </div>
                <div style="background: rgba(0,0,0,0.5); padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border-color);">
                    <span style="font-size:0.7rem; color:var(--text-muted); display:block;">PROFIT</span>
                    <strong id="mines-profit-val" style="font-size:1.2rem; color:var(--accent-gold);">$0.00</strong>
                </div>
            </div>

            <div style="display: flex; gap: 10px; justify-content: center;">
                <input type="number" id="mines-bet-input" value="10.00" style="width: 100px; background:#000; border:1px solid var(--border-color); border-radius:8px; padding:10px; color:#fff; font-weight:800; text-align:center;">
                <select id="mines-count-select" style="background:#000; border:1px solid var(--border-color); border-radius:8px; padding:10px; color:#fff; font-weight:800;">
                    <option value="1">1 Mine</option>
                    <option value="3" selected>3 Mines</option>
                    <option value="5">5 Mines</option>
                    <option value="10">10 Mines</option>
                </select>
                <button id="btn-start-mines" style="background:linear-gradient(135deg,#10b981,#059669); border:none; border-radius:8px; color:#fff; font-weight:800; padding:10px 20px; cursor:pointer;">BET</button>
                <button id="btn-cashout-mines" style="background:linear-gradient(135deg,#f59e0b,#d97706); border:none; border-radius:8px; color:#000; font-weight:900; padding:10px 20px; cursor:pointer; display:none;">CASH OUT</button>
            </div>
        </div>
    `;

    const btnStart = document.getElementById('btn-start-mines');
    const btnCashout = document.getElementById('btn-cashout-mines');
    const betInput = document.getElementById('mines-bet-input');
    const countSelect = document.getElementById('mines-count-select');
    const multVal = document.getElementById('mines-mult-val');
    const profitVal = document.getElementById('mines-profit-val');
    const tiles = document.querySelectorAll('.mine-tile');

    btnStart.addEventListener('click', async () => {
        let amt = parseFloat(betInput.value) || 10;
        let count = parseInt(countSelect.value);
        if (balance >= amt) {
            balance -= amt;
            updateWalletDisplay();
            minesGameState = { active: true, bet: amt, count: count, mult: 1.00 };

            try {
                const resp = await fetch('/api/mines/start', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ session_id: 'demo_user', bet: amt, mines_count: count })
                });
                const data = await resp.json();
                
                tiles.forEach(t => {
                    t.className = 'mine-tile';
                    t.textContent = '❓';
                });
                btnStart.style.display = 'none';
                btnCashout.style.display = 'inline-block';
                multVal.textContent = '1.00x';
                profitVal.textContent = '$0.00';
            } catch (e) { alert('Failed to start Mines game'); }
        }
    });

    tiles.forEach(t => {
        t.addEventListener('click', async () => {
            if (!minesGameState.active) return;
            const idx = parseInt(t.getAttribute('data-idx'));

            try {
                const resp = await fetch('/api/mines/reveal', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ session_id: 'demo_user', tile_index: idx })
                });
                const data = await resp.json();

                if (data.status === 'crashed') {
                    minesGameState.active = false;
                    playLossBoom();
                    t.className = 'mine-tile mine';
                    t.textContent = '💥';
                    btnStart.style.display = 'inline-block';
                    btnCashout.style.display = 'none';

                    (data.all_mines || []).forEach(mIdx => {
                        const mTile = document.querySelector(`.mine-tile[data-idx="${mIdx}"]`);
                        if (mTile) {
                            mTile.className = 'mine-tile mine';
                            mTile.textContent = '💣';
                        }
                    });
                } else if (data.status === 'safe') {
                    playWinChime();
                    t.className = 'mine-tile safe';
                    t.textContent = '💎';
                    multVal.textContent = `${data.current_multiplier.toFixed(2)}x`;
                    profitVal.textContent = `$${data.current_win.toFixed(2)}`;
                }
            } catch (e) {}
        });
    });

    btnCashout.addEventListener('click', async () => {
        if (!minesGameState.active) return;
        try {
            const resp = await fetch('/api/mines/cashout', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ session_id: 'demo_user' })
            });
            const data = await resp.json();
            if (data.status === 'cashed_out') {
                playWinChime();
                minesGameState.active = false;
                balance += data.win_amount;
                updateWalletDisplay();
                btnStart.style.display = 'inline-block';
                btnCashout.style.display = 'none';

                (data.all_mines || []).forEach(mIdx => {
                    const mTile = document.querySelector(`.mine-tile[data-idx="${mIdx}"]`);
                    if (mTile && !mTile.classList.contains('safe')) {
                        mTile.className = 'mine-tile mine';
                        mTile.textContent = '💣';
                    }
                });
            }
        } catch (e) {}
    });
}

// 2. DICE STAGE RENDERER (Target 1-98)
function renderDiceStage() {
    gameContainer.innerHTML = `
        <div class="dice-stage-box">
            <div class="dice-roll-display" id="dice-roll-val">50.00</div>
            <input type="range" min="2" max="98" value="50" class="dice-slider" id="dice-target-slider">
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted); margin-bottom:20px;">
                <span>Target: <strong id="dice-target-lbl">50.00</strong></span>
                <span>Win Chance: <strong id="dice-chance-lbl">50%</strong></span>
                <span>Multiplier: <strong id="dice-mult-lbl">1.94x</strong></span>
            </div>

            <div style="display: flex; gap: 10px; justify-content: center;">
                <input type="number" id="dice-bet-input" value="10.00" style="width: 120px; background:#000; border:1px solid var(--border-color); border-radius:8px; padding:10px; color:#fff; font-weight:800; text-align:center;">
                <button id="btn-roll-dice" style="background:linear-gradient(135deg,#38bdf8,#0284c7); border:none; border-radius:8px; color:#fff; font-weight:900; padding:10px 30px; cursor:pointer; font-size:1.1rem;">ROLL DICE</button>
            </div>
        </div>
    `;

    const slider = document.getElementById('dice-target-slider');
    const rollVal = document.getElementById('dice-roll-val');
    const targetLbl = document.getElementById('dice-target-lbl');
    const chanceLbl = document.getElementById('dice-chance-lbl');
    const multLbl = document.getElementById('dice-mult-lbl');
    const btnRoll = document.getElementById('btn-roll-dice');
    const betInput = document.getElementById('dice-bet-input');

    slider.addEventListener('input', () => {
        let target = parseFloat(slider.value);
        let winChance = 100 - target;
        let mult = (97.0 / winChance).toFixed(2);
        targetLbl.textContent = target.toFixed(2);
        chanceLbl.textContent = `${winChance.toFixed(0)}%`;
        multLbl.textContent = `${mult}x`;
    });

    btnRoll.addEventListener('click', async () => {
        let amt = parseFloat(betInput.value) || 10;
        let target = parseFloat(slider.value);
        if (balance >= amt) {
            balance -= amt;
            updateWalletDisplay();

            try {
                const resp = await fetch('/api/play/dice', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ bet: amt, target: target, mode: 'over' })
                });
                const data = await resp.json();

                rollVal.textContent = data.roll.toFixed(2);
                if (data.is_win) {
                    playWinChime();
                    rollVal.style.color = '#10b981';
                    balance += data.win_amount;
                    updateWalletDisplay();
                } else {
                    playLossBoom();
                    rollVal.style.color = '#ef4444';
                }
            } catch (e) {}
        }
    });
}

// 3. 3x3 SLOTS STAGE RENDERER
function renderSlotsStage() {
    gameContainer.innerHTML = `
        <div style="text-align:center;">
            <div class="slots-reels-container">
                <div class="slot-reel" id="reel-1">🎰</div>
                <div class="slot-reel" id="reel-2">🎰</div>
                <div class="slot-reel" id="reel-3">🎰</div>
            </div>
            <div style="display:flex; gap:10px; justify-content:center; margin-top:20px;">
                <input type="number" id="slots-bet-input" value="10.00" style="width:120px; background:#000; border:1px solid var(--border-color); border-radius:8px; padding:10px; color:#fff; font-weight:800; text-align:center;">
                <button id="btn-spin-slots" style="background:linear-gradient(135deg,#eab308,#ca8a04); border:none; border-radius:8px; color:#000; font-weight:900; padding:10px 30px; cursor:pointer; font-size:1.1rem;">SPIN REELS</button>
            </div>
        </div>
    `;

    const btnSpin = document.getElementById('btn-spin-slots');
    const r1 = document.getElementById('reel-1');
    const r2 = document.getElementById('reel-2');
    const r3 = document.getElementById('reel-3');
    const betInput = document.getElementById('slots-bet-input');

    btnSpin.addEventListener('click', async () => {
        let amt = parseFloat(betInput.value) || 10;
        if (balance >= amt) {
            balance -= amt;
            updateWalletDisplay();

            try {
                const resp = await fetch('/api/play/slots', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ bet: amt })
                });
                const data = await resp.json();

                r1.textContent = data.reels[0];
                r2.textContent = data.reels[1];
                r3.textContent = data.reels[2];

                if (data.is_win) {
                    playWinChime();
                    balance += data.win_amount;
                    updateWalletDisplay();
                } else {
                    playLossBoom();
                }
            } catch (e) {}
        }
    });
}

// 4. HILO STAGE RENDERER
function renderHiLoStage() {
    gameContainer.innerHTML = `
        <div style="text-align:center;">
            <div class="hilo-card-box" id="hilo-card">7️⃣</div>
            <div style="display:flex; gap:12px; justify-content:center; margin-bottom:20px;">
                <button id="btn-hilo-higher" style="background:#10b981; border:none; border-radius:8px; color:#fff; font-weight:900; padding:10px 24px; cursor:pointer;">HIGHER ▲</button>
                <button id="btn-hilo-lower" style="background:#ef4444; border:none; border-radius:8px; color:#fff; font-weight:900; padding:10px 24px; cursor:pointer;">LOWER ▼</button>
            </div>
        </div>
    `;

    const cardBox = document.getElementById('hilo-card');
    const btnHigher = document.getElementById('btn-hilo-higher');
    const btnLower = document.getElementById('btn-hilo-lower');
    let currentRank = 7;

    const playGuess = async (guess) => {
        if (balance >= 10) {
            balance -= 10;
            updateWalletDisplay();

            try {
                const resp = await fetch('/api/play/hilo', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ bet: 10, current_rank: currentRank, guess: guess })
                });
                const data = await resp.json();

                cardBox.textContent = `${data.next_suit} ${data.next_rank}`;
                currentRank = data.next_rank;

                if (data.is_win) {
                    playWinChime();
                    balance += data.win_amount;
                    updateWalletDisplay();
                } else {
                    playLossBoom();
                }
            } catch (e) {}
        }
    };

    btnHigher.addEventListener('click', () => playGuess('higher'));
    btnLower.addEventListener('click', () => playGuess('lower'));
}

// 5. WHEEL STAGE RENDERER
function renderWheelStage() {
    gameContainer.innerHTML = `
        <div style="text-align:center;">
            <div style="font-size:5rem; margin:20px;" id="wheel-icon">🎡</div>
            <button id="btn-spin-wheel" style="background:linear-gradient(135deg,#c084fc,#9333ea); border:none; border-radius:8px; color:#fff; font-weight:900; padding:12px 30px; cursor:pointer; font-size:1.1rem;">SPIN WHEEL</button>
        </div>
    `;

    document.getElementById('btn-spin-wheel').addEventListener('click', async () => {
        if (balance >= 10) {
            balance -= 10;
            updateWalletDisplay();
            try {
                const resp = await fetch('/api/play/wheel', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ bet: 10 })
                });
                const data = await resp.json();

                if (data.multiplier > 0) {
                    playWinChime();
                    balance += data.win_amount;
                    updateWalletDisplay();
                    alert(`🎡 Wheel landed on ${data.segment.label}! Win: $${data.win_amount.toFixed(2)}`);
                } else {
                    playLossBoom();
                    alert('🎡 Wheel landed on 0.0x! Better luck next time.');
                }
            } catch (e) {}
        }
    });
}

function renderPlaceholderStage(game) {
    gameContainer.innerHTML = `
        <div style="text-align:center;">
            <span style="font-size:4rem;">${game.icon}</span>
            <h3>${game.name} Engine Active</h3>
            <p style="color:var(--text-muted); margin-top:8px;">Running live on FastAPI WebSocket Stream.</p>
        </div>
    `;
}

window.addEventListener('DOMContentLoaded', () => {
    updateWalletDisplay();
    loadGamesList();
});
