"""Runtime settings, read from environment variables prefixed with ``CMP_`` (or a ``.env`` file)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="CMP_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./casino_matrix.db"
    public_base_url: str = "http://127.0.0.1:8090"
    admin_token: str = "change-me-admin-token"

    # Demo lobby: a built-in operator with an internal wallet and play-money balance.
    demo_enabled: bool = True
    demo_operator_id: str = "demo"
    demo_start_balance: int = 100_000  # minor units (1,000.00)

    session_ttl_minutes: int = 240
    signature_tolerance_seconds: int = 300
    wallet_timeout_seconds: float = 5.0
    wallet_credit_retries: int = 3

    # Crash room timing. Multiplier curve: m(t) = e^(growth * t).
    crash_enabled: bool = True
    crash_betting_seconds: float = 7.0
    crash_cooldown_seconds: float = 3.0
    crash_growth: float = 0.11
    crash_tick_hz: int = 10
    crash_salt: str = "casino-matrix-crash-v1"


@lru_cache
def get_settings() -> Settings:
    return Settings()
