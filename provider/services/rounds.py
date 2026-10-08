"""Round lifecycle for instant and stateful (Mines) games.

open round -> debit -> resolve with HMAC floats -> credit -> settled.
A failed debit cancels the round. A failed credit leaves it ``credit_pending`` so the win is
never lost; ``retry_credit`` pays it later.
"""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import rng
from ..games import GAMES, ParamError
from ..models import GameSession, Round, Transaction, utcnow
from ..wallet import WalletError
from . import ledger
from .configs import effective_config, engine_or_404
from .errors import GameError
from .players import next_nonce


def round_view(rnd: Round, balance: int | None = None, reveal: bool = False) -> dict[str, Any]:
    view = {
        "round_id": rnd.id,
        "game_id": rnd.game_id,
        "status": rnd.status,
        "currency": rnd.currency,
        "bet": rnd.bet,
        "payout": rnd.payout,
        "multiplier": rnd.multiplier_x100 / 100,
        "rtp": rnd.rtp,
        "params": rnd.params,
        "result": dict(rnd.result or {}),
        "fairness": {"server_seed_hash": rnd.server_seed_hash, "client_seed": rnd.client_seed, "nonce": rnd.nonce},
        "created_at": rnd.created_at.isoformat(),
    }
    if reveal and rnd.secret:
        view["result"] |= {k: v for k, v in rnd.secret.items() if not k.startswith("_")}
    if balance is not None:
        view["balance"] = balance
    return view


def _validate(engine, params: dict) -> dict:
    try:
        return engine.validate(params or {})
    except ParamError as exc:
        raise GameError("BAD_PARAMS", str(exc)) from None


def _check_bet(cfg, amount: int) -> None:
    if not cfg.enabled:
        raise GameError("GAME_DISABLED", "This game is currently disabled", 403)
    if not isinstance(amount, int) or amount < cfg.min_bet or amount > cfg.max_bet:
        raise GameError("BET_LIMIT", f"Bet must be between {cfg.min_bet} and {cfg.max_bet} (minor units)")


def _open_round(db: Session, session: GameSession, amount: int, params: dict, cfg) -> tuple[Round, Any]:
    player = session.player
    pair, nonce = next_nonce(db, player)
    rnd = Round(
        id=str(uuid.uuid4()),
        operator_id=session.operator_id,
        player_id=player.id,
        game_id=session.game_id,
        session_token=session.token,
        is_demo=session.is_demo,
        currency=player.currency,
        bet=amount,
        rtp=cfg.rtp,
        seed_pair_id=pair.id,
        server_seed_hash=pair.server_seed_hash,
        client_seed=pair.client_seed,
        nonce=nonce,
        params=params,
        result={},
        status="open",
    )
    db.add(rnd)
    db.commit()
    return rnd, pair


def _debit(db: Session, session: GameSession, rnd: Round) -> int:
    try:
        bal, _ = ledger.debit(db, session.player, session.is_demo, rnd, rnd.bet)
    except WalletError:
        rnd.status = "cancelled"
        rnd.settled_at = utcnow()
        db.commit()
        raise
    return bal


def _debit_tx_id(db: Session, rnd: Round) -> str | None:
    return db.scalar(select(Transaction.id).where(Transaction.round_id == rnd.id, Transaction.kind == "debit", Transaction.status == "ok"))


def settle(db: Session, session: GameSession, rnd: Round, payout: int, balance: int | None = None) -> int:
    """Credit the payout and close the round. Seamless operators also receive 0-amount
    credits so every round they debited is explicitly closed."""
    rnd.payout = payout
    db.commit()
    needs_call = payout > 0 or (not session.is_demo and session.player.operator.wallet_mode == "seamless")
    if needs_call:
        try:
            balance = ledger.credit(db, session.player, session.is_demo, rnd, payout, _debit_tx_id(db, rnd))
        except WalletError:
            rnd.status = "credit_pending"
            db.commit()
            raise GameError("CREDIT_PENDING", "Your win is recorded and will be paid shortly", 502) from None
    elif balance is None:
        balance = ledger.balance(db, session.player, session.is_demo)
    rnd.status = "settled"
    rnd.settled_at = utcnow()
    db.commit()
    return balance


def retry_credit(db: Session, rnd: Round) -> Round:
    if rnd.status != "credit_pending":
        raise GameError("NOT_PENDING", "Round is not waiting for a credit")
    session = db.get(GameSession, rnd.session_token)
    if session is None:
        raise GameError("NO_SESSION", "Original session not found", 404)
    settle(db, session, rnd, rnd.payout)
    return rnd


# ---- instant games ---------------------------------------------------------------------


def play_instant(db: Session, session: GameSession, amount: int, params: dict) -> dict:
    engine = engine_or_404(session.game_id)
    if engine.kind != "instant":
        raise GameError("WRONG_ENDPOINT", f"{engine.name} is not an instant game")
    params = _validate(engine, params)
    try:
        engine.check_amount(params, amount)
    except ParamError as exc:
        raise GameError("BAD_PARAMS", str(exc)) from None
    cfg = effective_config(db, session.operator_id, session.game_id)
    _check_bet(cfg, amount)
    rnd, pair = _open_round(db, session, amount, params, cfg)
    balance = _debit(db, session, rnd)
    out = engine.resolve(rng.floats(pair.server_seed, pair.client_seed, rnd.nonce, engine.floats_needed(params)), params, cfg.rtp)
    gross = out.payout if out.payout is not None else amount * out.multiplier_x100 // 100
    payout = min(gross, cfg.max_win)
    rnd.multiplier_x100 = out.multiplier_x100
    rnd.result = out.result
    balance = settle(db, session, rnd, payout, balance)
    return round_view(rnd, balance)


# ---- stateful games (Mines, HiLo, Dragon Tower) -----------------------------------------


def open_round(db: Session, session: GameSession) -> Round | None:
    return db.scalar(
        select(Round).where(Round.player_id == session.player_id, Round.game_id == session.game_id, Round.status == "open")
    )


def _unit(rnd: Round) -> int:
    """Opening stake. Multi-step games quote multipliers against it, even after extra stakes."""
    return (rnd.secret or {}).get("_unit", rnd.bet)


def stateful_view(rnd: Round, balance: int | None = None) -> dict:
    engine = GAMES[rnd.game_id]
    finished = rnd.status != "open"
    view = round_view(rnd, balance, reveal=finished)
    view |= engine.view(rnd.result, rnd.params, rnd.rtp)
    view["unit"] = _unit(rnd)
    if finished:
        view["cashout_multiplier"], view["cashout_amount"] = rnd.multiplier_x100 / 100, rnd.payout
    else:
        m = engine.multiplier_x100(rnd.result, rnd.params, rnd.rtp)
        view["cashout_multiplier"], view["cashout_amount"] = m / 100, _unit(rnd) * m // 100
    return view


def _stateful_engine(session: GameSession):
    engine = engine_or_404(session.game_id)
    if engine.kind != "stateful":
        raise GameError("WRONG_ENDPOINT", f"{engine.name} is not a multi-step game")
    return engine


def round_start(db: Session, session: GameSession, amount: int, params: dict) -> dict:
    engine = _stateful_engine(session)
    if open_round(db, session):
        raise GameError("ROUND_OPEN", "Finish the current round first", 409)
    params = _validate(engine, params)
    cfg = effective_config(db, session.operator_id, session.game_id)
    _check_bet(cfg, amount)
    rnd, pair = _open_round(db, session, amount, params, cfg)
    secret, state = engine.start(rng.floats(pair.server_seed, pair.client_seed, rnd.nonce, engine.floats_needed(params)), params, cfg.rtp)
    rnd.secret, rnd.result = {**secret, "_unit": amount}, state
    db.commit()
    balance = _debit(db, session, rnd)
    step = engine.settle_on_start(secret, state, params, cfg.rtp)
    if step is not None:
        rnd.result = step.state
        return _close(db, session, rnd, step.multiplier_x100 if step.status != "lost" else 0)
    return stateful_view(rnd, balance)


def _require_open(db: Session, session: GameSession) -> Round:
    rnd = open_round(db, session)
    if rnd is None:
        raise GameError("NO_ROUND", "No round in progress", 409)
    return rnd


def _close(db: Session, session: GameSession, rnd: Round, mult_x100: int) -> dict:
    """Settle a multi-step round. ``mult_x100`` is in units of the opening bet; the stored
    multiplier is payout / total staked so reports stay comparable across games."""
    cfg = effective_config(db, session.operator_id, session.game_id)
    payout = min(_unit(rnd) * mult_x100 // 100, cfg.max_win)
    rnd.multiplier_x100 = payout * 100 // rnd.bet if rnd.bet else 0
    balance = settle(db, session, rnd, payout)
    return stateful_view(rnd, balance)


def round_act(db: Session, session: GameSession, action: dict) -> dict:
    engine = _stateful_engine(session)
    rnd = _require_open(db, session)
    action = action or {}
    balance = None
    try:
        extra = engine.extra_units(rnd.result, rnd.params, action)
    except ParamError as exc:
        raise GameError("BAD_ACTION", str(exc)) from None
    if extra:
        cfg = effective_config(db, session.operator_id, session.game_id)
        stake = extra * _unit(rnd)
        if not cfg.enabled:
            raise GameError("GAME_DISABLED", "This game is currently disabled", 403)
        balance, _ = ledger.debit(db, session.player, session.is_demo, rnd, stake)
        rnd.bet += stake
        db.commit()
    try:
        step = engine.act(rnd.secret, rnd.result, rnd.params, rnd.rtp, action)
    except ParamError as exc:
        raise GameError("BAD_ACTION", str(exc)) from None
    rnd.result = step.state
    if step.status == "lost":
        return _close(db, session, rnd, 0)
    if step.status == "cashout":
        return _close(db, session, rnd, step.multiplier_x100)
    rnd.multiplier_x100 = step.multiplier_x100
    db.commit()
    return stateful_view(rnd, balance)


def round_cashout(db: Session, session: GameSession) -> dict:
    engine = _stateful_engine(session)
    rnd = _require_open(db, session)
    mult = engine.multiplier_x100(rnd.result, rnd.params, rnd.rtp)
    if mult <= 0:
        raise GameError("NOTHING_TO_CASH", "Make at least one winning move first")
    rnd.result = {**rnd.result, "cashed_out": True}
    return _close(db, session, rnd, mult)


# ---- history ---------------------------------------------------------------------------


def history(db: Session, player_id: int, game_id: str | None = None, limit: int = 20, operator_id: str | None = None) -> list[dict]:
    q = select(Round).where(Round.player_id == player_id, Round.status.in_(("settled", "credit_pending")))
    if game_id:
        q = q.where(Round.game_id == game_id)
    if operator_id:
        q = q.where(Round.operator_id == operator_id)
    rows = db.scalars(q.order_by(Round.created_at.desc()).limit(max(1, min(limit, 100))))
    return [round_view(r, reveal=True) for r in rows]
