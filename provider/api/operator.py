"""Server-to-server API for casinos (operators). Every request is HMAC-signed."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..games import GAMES
from ..models import Operator, Player, Round
from ..services import ledger, players, rounds
from ..services.configs import effective_config, set_config
from ..services.errors import GameError
from .deps import operator_auth
from .schemas import ConfigIn, SessionCreate, TransferIn

router = APIRouter(prefix="/api/v1/operator", tags=["operator"])


def launch_url(game_id: str, token: str) -> str:
    return f"{get_settings().public_base_url.rstrip('/')}/play/{game_id}?token={token}"


@router.get("/games")
def list_games(op: Operator = Depends(operator_auth), db: Session = Depends(get_db)):
    return {"games": [g.meta() | {"config": effective_config(db, op.id, g.id).as_dict()} for g in GAMES.values()]}


@router.put("/games/{game_id}/config")
def update_config(game_id: str, body: ConfigIn, op: Operator = Depends(operator_auth), db: Session = Depends(get_db)):
    if game_id == "crash" and body.rtp is not None:
        raise GameError("SHARED_ROOM", "Crash RTP is set provider-wide because all operators share one room")
    return set_config(db, op.id, game_id, **body.model_dump()).as_dict()


@router.post("/sessions")
def create_session(body: SessionCreate, op: Operator = Depends(operator_auth), db: Session = Depends(get_db)):
    s = players.create_session(
        db, op, player_external_id=body.player_id, game_id=body.game_id, currency=body.currency,
        nickname=body.nickname, is_demo=body.mode == "demo", return_url=body.return_url,
    )
    return {"token": s.token, "launch_url": launch_url(s.game_id, s.token), "expires_at": s.expires_at.isoformat(), "mode": body.mode}


def _player(db: Session, op: Operator, external_id: str) -> Player:
    p = db.scalar(select(Player).where(Player.operator_id == op.id, Player.external_id == external_id, Player.is_demo.is_(False)))
    if p is None:
        raise GameError("UNKNOWN_PLAYER", "Player has no sessions yet", 404)
    return p


def _transfer_only(op: Operator) -> None:
    if op.wallet_mode != "transfer":
        raise GameError("WRONG_WALLET_MODE", "Balances live in your seamless wallet", 409)


@router.get("/players/{player_id}/balance")
def player_balance(player_id: str, op: Operator = Depends(operator_auth), db: Session = Depends(get_db)):
    _transfer_only(op)
    p = _player(db, op, player_id)
    return {"player_id": player_id, "balance": ledger.balance(db, p, False), "currency": p.currency}


@router.post("/players/{player_id}/deposit")
def deposit(player_id: str, body: TransferIn, op: Operator = Depends(operator_auth), db: Session = Depends(get_db)):
    _transfer_only(op)
    p = _player(db, op, player_id)
    bal, replay = ledger.transfer(db, p, "deposit", body.amount, body.transfer_id)
    return {"player_id": player_id, "balance": bal, "currency": p.currency, "idempotent_replay": replay}


@router.post("/players/{player_id}/withdraw")
def withdraw(player_id: str, body: TransferIn, op: Operator = Depends(operator_auth), db: Session = Depends(get_db)):
    _transfer_only(op)
    p = _player(db, op, player_id)
    bal, replay = ledger.transfer(db, p, "withdraw", body.amount, body.transfer_id)
    return {"player_id": player_id, "balance": bal, "currency": p.currency, "idempotent_replay": replay}


@router.get("/rounds")
def list_rounds(
    player_id: str,
    game_id: str | None = None,
    limit: int = Query(default=50, le=100),
    op: Operator = Depends(operator_auth),
    db: Session = Depends(get_db),
):
    p = _player(db, op, player_id)
    return {"rounds": rounds.history(db, p.id, game_id, limit, op.id)}


@router.get("/rounds/{round_id}")
def get_round(round_id: str, op: Operator = Depends(operator_auth), db: Session = Depends(get_db)):
    r = db.get(Round, round_id)
    if r is None or r.operator_id != op.id:
        raise GameError("UNKNOWN_ROUND", "Round not found", 404)
    return rounds.round_view(r, reveal=r.status != "open")
