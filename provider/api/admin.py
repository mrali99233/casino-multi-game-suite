"""Provider back-office API (X-Admin-Token)."""

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..db import get_db
from ..games import GAMES
from ..models import GameConfig, Operator, Round
from ..security import new_api_key, new_api_secret
from ..services import rounds
from ..services.configs import GLOBAL, effective_config, set_config
from ..services.errors import GameError
from ..sim import simulate
from .deps import admin_auth
from .schemas import ConfigIn, OperatorCreate, SimulateIn

router = APIRouter(prefix="/api/v1/admin", tags=["admin"], dependencies=[Depends(admin_auth)])


@router.get("/operators")
def operators(db: Session = Depends(get_db)):
    return {"operators": [
        {"id": o.id, "name": o.name, "api_key": o.api_key, "wallet_mode": o.wallet_mode, "wallet_url": o.wallet_url, "active": o.active}
        for o in db.scalars(select(Operator))
    ]}


@router.post("/operators")
def create_operator(body: OperatorCreate, db: Session = Depends(get_db)):
    if db.get(Operator, body.id):
        raise GameError("EXISTS", "Operator id already exists", 409)
    if body.wallet_mode == "seamless" and not body.wallet_url:
        raise GameError("BAD_WALLET", "Seamless operators need a wallet_url")
    op = Operator(id=body.id, name=body.name, api_key=new_api_key(), api_secret=new_api_secret(),
                  wallet_mode=body.wallet_mode, wallet_url=body.wallet_url, default_currency=body.default_currency.upper())
    db.add(op)
    db.commit()
    return {"id": op.id, "api_key": op.api_key, "api_secret": op.api_secret, "wallet_mode": op.wallet_mode}


@router.get("/games")
def games(db: Session = Depends(get_db)):
    overrides = db.scalars(select(GameConfig).where(GameConfig.operator_id != GLOBAL)).all()
    return {"games": [
        g.meta() | {
            "config": effective_config(db, GLOBAL, g.id).as_dict(),
            "overrides": [{"operator_id": o.operator_id, "rtp": o.rtp, "enabled": o.enabled} for o in overrides if o.game_id == g.id],
        }
        for g in GAMES.values()
    ]}


@router.put("/games/{game_id}/config")
def update_config(game_id: str, body: ConfigIn, operator_id: str = GLOBAL, db: Session = Depends(get_db)):
    return set_config(db, operator_id, game_id, **body.model_dump()).as_dict()


@router.get("/stats")
def stats(operator_id: str | None = None, include_demo: bool = True, db: Session = Depends(get_db)):
    q = select(
        Round.game_id,
        func.count(Round.id),
        func.coalesce(func.sum(Round.bet), 0),
        func.coalesce(func.sum(Round.payout), 0),
        func.coalesce(func.sum(case((Round.payout > Round.bet, 1), else_=0)), 0),
    ).where(Round.status.in_(("settled", "credit_pending")))
    if operator_id:
        q = q.where(Round.operator_id == operator_id)
    if not include_demo:
        q = q.where(Round.is_demo.is_(False))
    rows = {g: (n, w, p, wins) for g, n, w, p, wins in db.execute(q.group_by(Round.game_id))}
    out = []
    for gid, engine in GAMES.items():
        n, w, p, wins = rows.get(gid, (0, 0, 0, 0))
        cfg = effective_config(db, operator_id or GLOBAL, gid)
        out.append({
            "game_id": gid, "name": engine.name, "rounds": n, "wagered": int(w), "paid": int(p), "ggr": int(w) - int(p),
            "actual_rtp": (p / w) if w else None, "configured_rtp": cfg.rtp, "win_rate": (wins / n) if n else None,
        })
    pending = db.scalar(select(func.count(Round.id)).where(Round.status == "credit_pending"))
    return {"games": out, "credit_pending": pending}


@router.post("/simulate")
async def run_simulation(body: SimulateIn):
    engine = GAMES.get(body.game_id)
    if engine is None:
        raise GameError("UNKNOWN_GAME", "Unknown game", 404)
    try:
        return await run_in_threadpool(simulate, body.game_id, body.params, body.rounds, body.rtp or engine.default_rtp)
    except ValueError as exc:
        raise GameError("BAD_PARAMS", str(exc)) from None


@router.post("/rounds/{round_id}/retry-credit")
def retry_credit(round_id: str, db: Session = Depends(get_db)):
    r = db.get(Round, round_id)
    if r is None:
        raise GameError("UNKNOWN_ROUND", "Round not found", 404)
    return rounds.round_view(rounds.retry_credit(db, r))
