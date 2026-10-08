"""Game-client API used by the game iframe. Auth: ``Authorization: Bearer <session token>``."""

import time

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..db import SessionLocal, get_db
from ..games import GAMES
from ..models import GameSession
from ..services import crash_room, ledger, players, rounds
from ..services.configs import GLOBAL, effective_config
from ..services.errors import GameError
from ..wallet import WalletError
from .deps import game_session
from .schemas import ActionIn, BetIn, SeedRotateIn

router = APIRouter(prefix="/api/v1/client", tags=["game client"])


@router.get("/init")
def init(s: GameSession = Depends(game_session), db: Session = Depends(get_db)):
    engine = GAMES[s.game_id]
    cfg = effective_config(db, GLOBAL if s.game_id == "crash" else s.operator_id, s.game_id)
    limits = effective_config(db, s.operator_id, s.game_id)
    p = s.player
    open_round = rounds.open_round(db, s) if engine.kind == "stateful" else None
    return {
        "player": {"nickname": p.nickname, "currency": p.currency, "demo": s.is_demo},
        "balance": ledger.balance(db, p, s.is_demo),
        "game": engine.meta() | {"rtp": cfg.rtp, "min_bet": limits.min_bet, "max_bet": limits.max_bet, "max_win": limits.max_win, "enabled": limits.enabled, "data": engine.describe(cfg.rtp)},
        "fairness": players.seed_view(players.active_seed(db, p)),
        "open_round": rounds.stateful_view(open_round) if open_round else None,
        "return_url": s.return_url,
    }


@router.get("/balance")
def balance(s: GameSession = Depends(game_session), db: Session = Depends(get_db)):
    return {"balance": ledger.balance(db, s.player, s.is_demo), "currency": s.player.currency}


@router.post("/bet")
def bet(body: BetIn, s: GameSession = Depends(game_session), db: Session = Depends(get_db)):
    return rounds.play_instant(db, s, body.amount, body.params)


@router.post("/round/start")
def round_start(body: BetIn, s: GameSession = Depends(game_session), db: Session = Depends(get_db)):
    return rounds.round_start(db, s, body.amount, body.params)


@router.post("/round/act")
def round_act(body: ActionIn, s: GameSession = Depends(game_session), db: Session = Depends(get_db)):
    return rounds.round_act(db, s, body.action)


@router.post("/round/cashout")
def round_cashout(s: GameSession = Depends(game_session), db: Session = Depends(get_db)):
    return rounds.round_cashout(db, s)


@router.get("/history")
def history(limit: int = Query(default=20, le=100), s: GameSession = Depends(game_session), db: Session = Depends(get_db)):
    return {"rounds": rounds.history(db, s.player_id, s.game_id, limit)}


@router.get("/seeds")
def seeds(s: GameSession = Depends(game_session), db: Session = Depends(get_db)):
    return players.seed_view(players.active_seed(db, s.player))


@router.post("/seeds/rotate")
def rotate(body: SeedRotateIn, s: GameSession = Depends(game_session), db: Session = Depends(get_db)):
    return players.rotate_seed(db, s.player, body.client_seed)


def _ws_session(token: str):
    with SessionLocal() as db:
        s = players.resolve_session(db, token)
        if s.game_id != "crash":
            raise GameError("WRONG_GAME", "Session is not for the crash room", 403)
        return crash_room.Conn(None, s.token, s.player_id, s.player.nickname, s.player.currency, s.is_demo), ledger.balance(db, s.player, s.is_demo)


@router.websocket("/crash/ws")
async def crash_ws(ws: WebSocket, token: str = Query(...)):
    room = crash_room.room
    try:
        conn, bal = await run_in_threadpool(_ws_session, token)
    except (GameError, WalletError) as exc:
        await ws.close(code=4401, reason=getattr(exc, "message", "unauthorized")[:120])
        return
    if room is None:
        await ws.close(code=4503, reason="Crash room is not running")
        return
    await ws.accept()
    conn.ws = ws
    key = id(ws)
    room.conns[key] = conn
    await ws.send_json(room.snapshot() | {"type": "hello", "balance": bal, "server_time": time.time()})
    try:
        while True:
            msg = await ws.receive_json()
            req = msg.get("req")
            action = msg.get("action")
            try:
                if action == "bet":
                    b, bal = await room.place_bet(conn, int(msg.get("slot", 0)), int(msg.get("amount", 0)), msg.get("auto_cashout"))
                    reply = {"ok": True, "slot": b.slot, "round_id": b.round_id, "balance": bal}
                elif action == "cancel":
                    bal = await room.cancel_bet(conn, int(msg.get("slot", 0)))
                    reply = {"ok": True, "balance": bal}
                elif action == "cashout":
                    b = await room.cashout(conn, int(msg.get("slot", 0)))
                    reply = {"ok": True, "slot": b.slot, "cashout": b.cashed_x100 / 100}
                elif action == "ping":
                    reply = {"ok": True}
                else:
                    raise GameError("BAD_ACTION", f"Unknown action '{action}'")
            except (GameError, WalletError) as exc:
                reply = {"ok": False, "code": exc.code, "message": exc.message}
            except (TypeError, ValueError):
                reply = {"ok": False, "code": "BAD_REQUEST", "message": "Malformed message"}
            await ws.send_json({"type": "reply", "req": req} | reply)
    except WebSocketDisconnect:
        pass
    finally:
        room.conns.pop(key, None)
