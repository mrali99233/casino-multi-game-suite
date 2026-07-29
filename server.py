import asyncio
import json
import random
import time
import hashlib
import hmac
import os
import math
from typing import List, Dict, Optional
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

app = FastAPI(title="Casino Matrix Pro - Multi-Game Engine Suite")

static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
async def get_main_dashboard():
    return FileResponse(os.path.join(static_dir, "index.html"))

# Provably Fair Helper
def generate_hmac_hash(secret_seed: str, message: str) -> str:
    return hmac.new(secret_seed.encode(), message.encode(), hashlib.sha256).hexdigest()

# Games Metadata Registry
GAMES_REGISTRY = [
    {"id": "aviator", "name": "Aviator / Crash", "icon": "✈️", "tag": "HOT", "color": "#ef4444"},
    {"id": "mines", "name": "Mines", "icon": "💣", "tag": "POPULAR", "color": "#10b981"},
    {"id": "plinko", "name": "Plinko", "icon": "🔴", "tag": "HOT", "color": "#f59e0b"},
    {"id": "dice", "name": "Dice", "icon": "🎲", "tag": "FAIR", "color": "#38bdf8"},
    {"id": "wheel", "name": "Wheel of Fortune", "icon": "🎡", "tag": "NEW", "color": "#c084fc"},
    {"id": "slots", "name": "3x3 Classic Slots", "icon": "🎰", "tag": "CASINO", "color": "#eab308"},
    {"id": "hilo", "name": "HiLo Cards", "icon": "🃏", "tag": "NEW", "color": "#ec4899"}
]

@app.get("/api/games")
async def get_games_list():
    return GAMES_REGISTRY

# 1. MINES GAME LOGIC (5x5 Grid)
active_mines_games: Dict[str, dict] = {} # session_id -> game_state

@app.post("/api/mines/start")
async def start_mines_game(data: dict):
    session_id = data.get("session_id", "demo_user")
    bet = float(data.get("bet", 10.0))
    mines_count = int(data.get("mines_count", 3))

    if mines_count < 1 or mines_count > 24:
        raise HTTPException(status_code=400, detail="Mines count must be between 1 and 24")

    # Generate 5x5 grid with mines_count hidden mines
    grid_indices = list(range(25))
    random.shuffle(grid_indices)
    mine_locations = set(grid_indices[:mines_count])

    active_mines_games[session_id] = {
        "bet": bet,
        "mines_count": mines_count,
        "mine_locations": mine_locations,
        "revealed_tiles": set(),
        "current_multiplier": 1.00,
        "status": "active"
    }

    return JSONResponse(content={
        "status": "success",
        "bet": bet,
        "mines_count": mines_count,
        "current_multiplier": 1.00,
        "next_multiplier": calculate_next_mines_multiplier(mines_count, 1)
    })

def calculate_next_mines_multiplier(mines_count: int, revealed_count: int) -> float:
    # Combinatorial odds formula
    total = 25
    safe = total - mines_count
    mult = 1.0
    for i in range(revealed_count):
        mult *= (total - i) / (safe - i)
    return round(mult * 0.97, 2) # 3% house edge

@app.post("/api/mines/reveal")
async def reveal_mines_tile(data: dict):
    session_id = data.get("session_id", "demo_user")
    tile_index = int(data.get("tile_index"))

    if session_id not in active_mines_games:
        raise HTTPException(status_code=400, detail="No active Mines game found")

    game = active_mines_games[session_id]
    if game["status"] != "active":
        raise HTTPException(status_code=400, detail="Game is already finished")

    if tile_index in game["revealed_tiles"]:
        raise HTTPException(status_code=400, detail="Tile already revealed")

    if tile_index in game["mine_locations"]:
        # HIT A MINE! BOOM!
        game["status"] = "crashed"
        all_mines = list(game["mine_locations"])
        del active_mines_games[session_id]
        return JSONResponse(content={
            "status": "crashed",
            "hit_mine": tile_index,
            "all_mines": all_mines,
            "win_amount": 0
        })

    # SAFE TILE!
    game["revealed_tiles"].add(tile_index)
    revealed_count = len(game["revealed_tiles"])
    mult = calculate_next_mines_multiplier(game["mines_count"], revealed_count)
    game["current_multiplier"] = mult
    next_mult = calculate_next_mines_multiplier(game["mines_count"], revealed_count + 1) if (revealed_count + game["mines_count"] < 25) else mult

    return JSONResponse(content={
        "status": "safe",
        "tile_index": tile_index,
        "revealed_count": revealed_count,
        "current_multiplier": mult,
        "current_win": round(game["bet"] * mult, 2),
        "next_multiplier": next_mult
    })

@app.post("/api/mines/cashout")
async def cashout_mines_game(data: dict):
    session_id = data.get("session_id", "demo_user")
    if session_id not in active_mines_games:
        raise HTTPException(status_code=400, detail="No active Mines game found")

    game = active_mines_games[session_id]
    if len(game["revealed_tiles"]) == 0:
        raise HTTPException(status_code=400, detail="Reveal at least 1 tile before cashout")

    win_amount = round(game["bet"] * game["current_multiplier"], 2)
    all_mines = list(game["mine_locations"])
    del active_mines_games[session_id]

    return JSONResponse(content={
        "status": "cashed_out",
        "multiplier": game["current_multiplier"],
        "win_amount": win_amount,
        "all_mines": all_mines
    })

# 2. DICE GAME LOGIC (Target 1-98)
@app.post("/api/play/dice")
async def play_dice_game(data: dict):
    bet = float(data.get("bet", 10.0))
    target = float(data.get("target", 50.0))
    mode = data.get("mode", "over") # over or under

    if target < 1 or target > 98:
        raise HTTPException(status_code=400, detail="Target must be between 1 and 98")

    # Roll 0.00 to 99.99
    roll = round(random.uniform(0.00, 99.99), 2)
    win_chance = (100.0 - target) if mode == "over" else target
    multiplier = round((97.0 / win_chance), 2) # 3% house edge

    is_win = (roll > target) if mode == "over" else (roll < target)
    win_amount = round(bet * multiplier, 2) if is_win else 0.0

    return JSONResponse(content={
        "status": "success",
        "roll": roll,
        "target": target,
        "mode": mode,
        "is_win": is_win,
        "multiplier": multiplier if is_win else 0.0,
        "win_amount": win_amount
    })

# 3. 3x3 CLASSIC SLOTS ENGINE
SLOT_SYMBOLS = ["🍒", "🍋", "🔔", "💎", "7️⃣", "⭐"]
SLOT_PAYOUTS = {
    "🍒": 2.5,
    "🍋": 4.0,
    "🔔": 8.0,
    "💎": 15.0,
    "7️⃣": 50.0,
    "⭐": 100.0
}

@app.post("/api/play/slots")
async def spin_slots(data: dict):
    bet = float(data.get("bet", 10.0))
    # Spin 3 reels
    r1 = random.choice(SLOT_SYMBOLS)
    r2 = random.choice(SLOT_SYMBOLS)
    r3 = random.choice(SLOT_SYMBOLS)

    reels = [r1, r2, r3]
    multiplier = 0.0

    if r1 == r2 == r3:
        multiplier = SLOT_PAYOUTS[r1]
    elif r1 == r2 or r2 == r3 or r1 == r3:
        # 2 matching symbols
        match_sym = r1 if r1 == r2 or r1 == r3 else r2
        multiplier = round(SLOT_PAYOUTS[match_sym] * 0.3, 2)

    win_amount = round(bet * multiplier, 2)
    is_win = multiplier > 0.0

    return JSONResponse(content={
        "status": "success",
        "reels": reels,
        "is_win": is_win,
        "multiplier": multiplier,
        "win_amount": win_amount
    })

# 4. WHEEL OF FORTUNE ENGINE
WHEEL_SEGMENTS = [
    {"label": "1.2x", "mult": 1.2, "color": "#10b981"},
    {"label": "1.5x", "mult": 1.5, "color": "#38bdf8"},
    {"label": "0.0x", "mult": 0.0, "color": "#ef4444"},
    {"label": "2.0x", "mult": 2.0, "color": "#f59e0b"},
    {"label": "1.2x", "mult": 1.2, "color": "#10b981"},
    {"label": "5.0x", "mult": 5.0, "color": "#c084fc"},
    {"label": "0.0x", "mult": 0.0, "color": "#ef4444"},
    {"label": "10.0x", "mult": 10.0, "color": "#eab308"}
]

@app.post("/api/play/wheel")
async def spin_wheel(data: dict):
    bet = float(data.get("bet", 10.0))
    idx = random.randint(0, len(WHEEL_SEGMENTS) - 1)
    seg = WHEEL_SEGMENTS[idx]

    win_amount = round(bet * seg["mult"], 2)
    return JSONResponse(content={
        "status": "success",
        "segment_index": idx,
        "segment": seg,
        "multiplier": seg["mult"],
        "win_amount": win_amount
    })

# 5. HILO CARD ENGINE
CARD_SUITS = ["♠️", "♥️", "♦️", "♣️"]
CARD_RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] # 11=J, 12=Q, 13=K, 14=A

@app.post("/api/play/hilo")
async def play_hilo_guess(data: dict):
    bet = float(data.get("bet", 10.0))
    current_rank = int(data.get("current_rank", 7))
    guess = data.get("guess", "higher") # higher or lower

    next_rank = random.choice(CARD_RANKS)
    next_suit = random.choice(CARD_SUITS)

    is_win = (next_rank >= current_rank) if guess == "higher" else (next_rank <= current_rank)
    
    # Calculate payout odds
    higher_prob = (14.0 - current_rank + 1.0) / 13.0
    lower_prob = (current_rank - 2.0 + 1.0) / 13.0
    prob = higher_prob if guess == "higher" else lower_prob
    multiplier = round((0.97 / prob), 2) if prob > 0 else 1.5

    win_amount = round(bet * multiplier, 2) if is_win else 0.0

    return JSONResponse(content={
        "status": "success",
        "current_rank": current_rank,
        "next_rank": next_rank,
        "next_suit": next_suit,
        "guess": guess,
        "is_win": is_win,
        "multiplier": multiplier if is_win else 0.0,
        "win_amount": win_amount
    })

# AVIATOR WEBSOCKET ENGINE
class AviatorEngine:
    def __init__(self):
        self.state = "waiting"
        self.current_multiplier = 1.00
        self.crash_point = 1.00
        self.countdown = 5.0
        self.active_sockets: List[WebSocket] = []

aviator_engine = AviatorEngine()

@app.websocket("/ws/game/aviator")
async def websocket_aviator(websocket: WebSocket):
    await websocket.accept()
    aviator_engine.active_sockets.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except Exception:
        if websocket in aviator_engine.active_sockets:
            aviator_engine.active_sockets.remove(websocket)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8090, reload=True)
