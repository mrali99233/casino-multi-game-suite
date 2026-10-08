"""Players, launch sessions and seed pairs."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .. import rng
from ..config import get_settings
from ..models import GameSession, Operator, Player, Round, SeedPair, as_utc, utcnow
from ..security import new_token
from ..wallet.internal import ensure_account
from .configs import engine_or_404
from .errors import GameError


def get_or_create_player(
    db: Session, operator: Operator, external_id: str, *, currency: str, nickname: str | None, is_demo: bool
) -> Player:
    player = db.scalar(
        select(Player).where(
            Player.operator_id == operator.id, Player.external_id == external_id, Player.is_demo == is_demo
        )
    )
    if player is None:
        player = Player(
            operator_id=operator.id,
            external_id=external_id,
            currency=currency,
            nickname=(nickname or f"Player{external_id[-4:]}")[:64],
            is_demo=is_demo,
        )
        db.add(player)
        db.commit()
        if is_demo:
            ensure_account(db, player, get_settings().demo_start_balance)
    elif nickname and nickname != player.nickname:
        player.nickname = nickname[:64]
        db.commit()
    return player


def create_session(
    db: Session,
    operator: Operator,
    *,
    player_external_id: str,
    game_id: str,
    currency: str | None = None,
    nickname: str | None = None,
    is_demo: bool = False,
    return_url: str | None = None,
) -> GameSession:
    engine_or_404(game_id)
    player = get_or_create_player(
        db,
        operator,
        player_external_id,
        currency=(currency or operator.default_currency).upper(),
        nickname=nickname,
        is_demo=is_demo,
    )
    if not is_demo and operator.wallet_mode == "transfer":
        ensure_account(db, player)
    ttl = timedelta(minutes=get_settings().session_ttl_minutes)
    session = GameSession(
        token=new_token(),
        player_id=player.id,
        operator_id=operator.id,
        game_id=game_id,
        is_demo=is_demo,
        return_url=return_url,
        expires_at=datetime.now(timezone.utc) + ttl,
    )
    db.add(session)
    db.commit()
    return session


def resolve_session(db: Session, token: str | None) -> GameSession:
    if not token:
        raise GameError("NO_SESSION", "Missing session token", 401)
    session = db.get(GameSession, token)
    if session is None:
        raise GameError("BAD_SESSION", "Unknown session token", 401)
    if as_utc(session.expires_at) < datetime.now(timezone.utc):
        raise GameError("SESSION_EXPIRED", "Session expired. Relaunch the game from the casino.", 401)
    if not session.player.operator.active:
        raise GameError("OPERATOR_DISABLED", "Operator is disabled", 403)
    return session


# ---- seeds -------------------------------------------------------------------------------


def active_seed(db: Session, player: Player) -> SeedPair:
    pair = db.scalar(select(SeedPair).where(SeedPair.player_id == player.id, SeedPair.active.is_(True)))
    if pair is None:
        seed = rng.new_server_seed()
        pair = SeedPair(
            player_id=player.id, server_seed=seed, server_seed_hash=rng.hash_seed(seed), client_seed=rng.new_client_seed()
        )
        db.add(pair)
        db.commit()
    return pair


def next_nonce(db: Session, player: Player) -> tuple[SeedPair, int]:
    """Atomically reserve the next nonce for this player's active seed pair."""
    pair = active_seed(db, player)
    nonce = db.execute(
        update(SeedPair).where(SeedPair.id == pair.id).values(nonce=SeedPair.nonce + 1).returning(SeedPair.nonce)
    ).scalar_one()
    db.commit()
    db.refresh(pair)
    return pair, nonce


def seed_view(pair: SeedPair) -> dict:
    return {"server_seed_hash": pair.server_seed_hash, "client_seed": pair.client_seed, "nonce": pair.nonce}


def rotate_seed(db: Session, player: Player, client_seed: str | None) -> dict:
    open_round = db.scalar(select(Round.id).where(Round.player_id == player.id, Round.status == "open"))
    if open_round:
        raise GameError("ROUND_OPEN", "Finish the open round before changing seeds")
    if client_seed is not None:
        client_seed = client_seed.strip()
        if not 1 <= len(client_seed) <= 64:
            raise GameError("BAD_CLIENT_SEED", "Client seed must be 1 to 64 characters")
    old = active_seed(db, player)
    old.active = False
    old.revealed_at = utcnow()
    seed = rng.new_server_seed()
    new = SeedPair(
        player_id=player.id,
        server_seed=seed,
        server_seed_hash=rng.hash_seed(seed),
        client_seed=client_seed or rng.new_client_seed(),
    )
    db.add(new)
    db.commit()
    return {
        "previous": {
            "server_seed": old.server_seed,
            "server_seed_hash": old.server_seed_hash,
            "client_seed": old.client_seed,
            "nonce": old.nonce,
        },
        "current": seed_view(new),
    }
