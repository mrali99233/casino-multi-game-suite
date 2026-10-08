"""Effective game configuration: operator override -> provider default ("*") -> engine default."""

from dataclasses import asdict, dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..games import GAMES
from ..models import GameConfig
from .errors import GameError

GLOBAL = "*"


@dataclass
class EffectiveConfig:
    game_id: str
    rtp: float
    enabled: bool
    min_bet: int
    max_bet: int
    max_win: int
    source: str

    def as_dict(self) -> dict:
        return asdict(self)


def engine_or_404(game_id: str):
    engine = GAMES.get(game_id)
    if engine is None:
        raise GameError("UNKNOWN_GAME", f"Unknown game '{game_id}'", 404)
    return engine


def effective_config(db: Session, operator_id: str, game_id: str) -> EffectiveConfig:
    engine = engine_or_404(game_id)
    rows = {
        c.operator_id: c
        for c in db.scalars(
            select(GameConfig).where(GameConfig.game_id == game_id, GameConfig.operator_id.in_([operator_id, GLOBAL]))
        )
    }
    row = rows.get(operator_id) or rows.get(GLOBAL)
    if row is None:
        return EffectiveConfig(
            game_id, engine.default_rtp, True, engine.default_min_bet, engine.default_max_bet, engine.default_max_win, "default"
        )
    return EffectiveConfig(
        game_id, row.rtp, row.enabled, row.min_bet, row.max_bet, row.max_win, "operator" if row.operator_id != GLOBAL else "provider"
    )


def set_config(db: Session, operator_id: str, game_id: str, **changes) -> EffectiveConfig:
    engine = engine_or_404(game_id)
    current = effective_config(db, operator_id, game_id)
    values = {k: v for k, v in changes.items() if v is not None}
    merged = current.as_dict() | values
    if not engine.min_rtp <= merged["rtp"] <= engine.max_rtp:
        raise GameError("RTP_OUT_OF_RANGE", f"RTP for {engine.name} must be between {engine.min_rtp} and {engine.max_rtp}")
    if not 0 < merged["min_bet"] <= merged["max_bet"]:
        raise GameError("BAD_LIMITS", "min_bet must be positive and not above max_bet")
    if merged["max_win"] < merged["max_bet"]:
        raise GameError("BAD_LIMITS", "max_win must be at least max_bet")
    row = db.get(GameConfig, (operator_id, game_id))
    if row is None:
        row = GameConfig(operator_id=operator_id, game_id=game_id)
        db.add(row)
    for key in ("rtp", "enabled", "min_bet", "max_bet", "max_win"):
        setattr(row, key, merged[key])
    db.commit()
    return effective_config(db, operator_id, game_id)
