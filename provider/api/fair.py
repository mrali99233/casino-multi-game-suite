"""Public verification endpoints: anyone can recompute an outcome from revealed seeds."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import rng
from ..db import get_db
from ..games import GAMES, ParamError
from ..games.crash import crash_point_x100
from ..models import CrashGame
from ..services.errors import GameError
from .schemas import VerifyIn

router = APIRouter(prefix="/api/v1/fair", tags=["fairness"])


@router.post("/verify")
def verify(body: VerifyIn):
    engine = GAMES.get(body.game_id)
    if engine is None or engine.kind == "realtime":
        raise GameError("UNKNOWN_GAME", "Use /fair/crash/{game_id} for crash rounds", 404)
    try:
        params = engine.validate(body.params)
    except ParamError as exc:
        raise GameError("BAD_PARAMS", str(exc)) from None
    rtp = body.rtp or engine.default_rtp
    floats = rng.floats(body.server_seed, body.client_seed, body.nonce, engine.floats_needed(params))
    out = {"server_seed_hash": rng.hash_seed(body.server_seed), "floats": floats, "params": params, "rtp": rtp}
    if engine.kind == "stateful":
        secret, _ = engine.start(floats, params, rtp)
        out["secret"] = secret
    else:
        o = engine.resolve(floats, params, rtp)
        out |= {"multiplier": o.multiplier_x100 / 100, "result": o.result}
    return out


@router.get("/crash/{game_id}")
def crash_round(game_id: int, db: Session = Depends(get_db)):
    g = db.get(CrashGame, game_id)
    if g is None:
        raise GameError("UNKNOWN_ROUND", "Crash round not found", 404)
    view = {"game_id": g.id, "server_seed_hash": g.server_seed_hash, "salt": g.salt, "status": g.status, "rtp": g.rtp}
    if g.status == "crashed":
        r = rng.floats(g.server_seed, g.salt, g.id, 1)[0]
        view |= {"server_seed": g.server_seed, "float": r, "crash": g.crash_point_x100 / 100, "recomputed": crash_point_x100(r, g.rtp) / 100}
    return view
