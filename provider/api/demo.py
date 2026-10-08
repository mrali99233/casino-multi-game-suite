"""Public demo lobby endpoint (play money, built-in operator). Disable with CMP_DEMO_ENABLED=false."""

import secrets

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..games import GAMES
from ..models import Operator
from ..services import players
from ..services.errors import GameError
from .schemas import DemoSessionIn

router = APIRouter(prefix="/api/v1/demo", tags=["demo"])


@router.get("/games")
def games():
    return {"games": [g.meta() for g in GAMES.values()]}


@router.post("/sessions")
def demo_session(body: DemoSessionIn, db: Session = Depends(get_db)):
    s = get_settings()
    if not s.demo_enabled:
        raise GameError("DEMO_DISABLED", "Demo play is disabled", 403)
    op = db.get(Operator, s.demo_operator_id)
    player_id = body.player_id if body.player_id and body.player_id.isalnum() else "d" + secrets.token_hex(6)
    session = players.create_session(db, op, player_external_id=player_id, game_id=body.game_id, nickname=f"Guest{player_id[-4:]}", is_demo=True, return_url="/")
    # relative URL: the lobby and the game are served from the same origin, whatever host it runs on
    return {"token": session.token, "launch_url": f"/play/{session.game_id}?token={session.token}", "player_id": player_id}
