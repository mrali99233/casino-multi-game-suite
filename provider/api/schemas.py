from typing import Any, Literal

from pydantic import BaseModel, Field


class SessionCreate(BaseModel):
    player_id: str = Field(min_length=1, max_length=128, description="Operator's player id")
    game_id: str
    currency: str | None = Field(default=None, min_length=3, max_length=8)
    nickname: str | None = Field(default=None, max_length=64)
    mode: Literal["real", "demo"] = "real"
    return_url: str | None = None


class TransferIn(BaseModel):
    amount: int = Field(gt=0, description="Minor units")
    transfer_id: str = Field(min_length=1, max_length=64, description="Idempotency key")


class ConfigIn(BaseModel):
    rtp: float | None = None
    enabled: bool | None = None
    min_bet: int | None = None
    max_bet: int | None = None
    max_win: int | None = None


class BetIn(BaseModel):
    amount: int = Field(description="Bet in minor units")
    params: dict[str, Any] = Field(default_factory=dict)


class ActionIn(BaseModel):
    action: dict[str, Any] = Field(default_factory=dict)


class SeedRotateIn(BaseModel):
    client_seed: str | None = None


class VerifyIn(BaseModel):
    game_id: str
    server_seed: str
    client_seed: str
    nonce: int
    params: dict[str, Any] = Field(default_factory=dict)
    rtp: float | None = None


class OperatorCreate(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9_-]{2,64}$")
    name: str
    wallet_mode: Literal["transfer", "seamless"] = "transfer"
    wallet_url: str | None = None
    default_currency: str = "USD"


class SimulateIn(BaseModel):
    game_id: str
    params: dict[str, Any] = Field(default_factory=dict)
    rounds: int = Field(default=100_000, ge=1000, le=1_000_000)
    rtp: float | None = None


class DemoSessionIn(BaseModel):
    game_id: str
    player_id: str | None = Field(default=None, max_length=64)
