"""Database schema. All money columns are integer minor units (cents)."""

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(dt: datetime) -> datetime:
    """SQLite drops tzinfo on read; treat naive values as UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class Operator(Base):
    __tablename__ = "operators"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    api_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    api_secret: Mapped[str] = mapped_column(String(128))
    # "transfer": provider holds balances (operator deposits/withdraws).
    # "seamless": provider calls the operator's wallet for every debit/credit.
    wallet_mode: Mapped[str] = mapped_column(String(16), default="transfer")
    wallet_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    default_currency: Mapped[str] = mapped_column(String(8), default="USD")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Player(Base):
    __tablename__ = "players"
    __table_args__ = (UniqueConstraint("operator_id", "external_id", "is_demo"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    operator_id: Mapped[str] = mapped_column(ForeignKey("operators.id"))
    external_id: Mapped[str] = mapped_column(String(128))
    nickname: Mapped[str] = mapped_column(String(64), default="Player")
    currency: Mapped[str] = mapped_column(String(8), default="USD")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    operator: Mapped[Operator] = relationship(lazy="joined")


class WalletAccount(Base):
    """Balance held by the provider (transfer-mode operators and demo play)."""

    __tablename__ = "wallet_accounts"

    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), primary_key=True)
    balance: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class GameSession(Base):
    __tablename__ = "game_sessions"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), index=True)
    operator_id: Mapped[str] = mapped_column(ForeignKey("operators.id"))
    game_id: Mapped[str] = mapped_column(String(32))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    return_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    player: Mapped[Player] = relationship(lazy="joined")


class SeedPair(Base):
    __tablename__ = "seed_pairs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), index=True)
    server_seed: Mapped[str] = mapped_column(String(64))
    server_seed_hash: Mapped[str] = mapped_column(String(64))
    client_seed: Mapped[str] = mapped_column(String(64))
    nonce: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    revealed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Round(Base):
    __tablename__ = "rounds"
    __table_args__ = (Index("ix_rounds_player_created", "player_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    operator_id: Mapped[str] = mapped_column(ForeignKey("operators.id"), index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"))
    game_id: Mapped[str] = mapped_column(String(32), index=True)
    session_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    currency: Mapped[str] = mapped_column(String(8))
    bet: Mapped[int] = mapped_column(BigInteger)
    payout: Mapped[int] = mapped_column(BigInteger, default=0)
    multiplier_x100: Mapped[int] = mapped_column(Integer, default=0)
    # open -> settled | cancelled | credit_pending
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    rtp: Mapped[float] = mapped_column(Float)
    seed_pair_id: Mapped[int | None] = mapped_column(ForeignKey("seed_pairs.id"), nullable=True)
    server_seed_hash: Mapped[str] = mapped_column(String(64))
    client_seed: Mapped[str] = mapped_column(String(64))
    nonce: Mapped[int] = mapped_column(Integer)
    params: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    secret: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    round_id: Mapped[str | None] = mapped_column(ForeignKey("rounds.id"), nullable=True, index=True)
    player_id: Mapped[int] = mapped_column(ForeignKey("players.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # debit | credit | rollback | deposit | withdraw
    amount: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending | ok | rejected | unknown
    balance_after: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    reference_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class GameConfig(Base):
    """Per-operator game settings. operator_id "*" holds the provider-wide default."""

    __tablename__ = "game_configs"

    operator_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    game_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    rtp: Mapped[float] = mapped_column(Float)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    min_bet: Mapped[int] = mapped_column(BigInteger)
    max_bet: Mapped[int] = mapped_column(BigInteger)
    max_win: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class CrashGame(Base):
    """One shared multiplayer crash round. Seed is published as a hash before betting closes."""

    __tablename__ = "crash_games"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    server_seed: Mapped[str] = mapped_column(String(64))
    server_seed_hash: Mapped[str] = mapped_column(String(64))
    salt: Mapped[str] = mapped_column(String(64))
    rtp: Mapped[float] = mapped_column(Float)
    crash_point_x100: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="betting")  # betting | running | crashed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    crashed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
