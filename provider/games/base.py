"""Game engine contract.

An engine is pure math: given RNG floats, validated params and an RTP, it returns a
multiplier (integer hundredths) and a result payload the client animates. Engines never
touch the database or the wallet, which keeps them easy to simulate and verify.
"""

from dataclasses import dataclass, field
from typing import Any


class ParamError(ValueError):
    pass


@dataclass
class Outcome:
    multiplier_x100: int
    result: dict[str, Any] = field(default_factory=dict)
    # Games with several independent stakes (roulette chips) return the exact payout.
    payout: int | None = None


@dataclass
class Step:
    """Result of one player action in a stateful round."""

    state: dict[str, Any]
    status: str  # "continue" | "lost" | "cashout" (forced, e.g. board cleared)
    multiplier_x100: int = 0


class GameEngine:
    id: str = ""
    name: str = ""
    kind: str = "instant"  # instant | stateful | realtime
    category: str = ""
    tagline: str = ""
    default_rtp: float = 0.97
    min_rtp: float = 0.90
    max_rtp: float = 0.99
    default_min_bet: int = 10  # 0.10
    default_max_bet: int = 100_000  # 1,000.00
    default_max_win: int = 10_000_000  # 100,000.00

    def validate(self, params: dict[str, Any]) -> dict[str, Any]:
        return {}

    def floats_needed(self, params: dict[str, Any]) -> int:
        return 1

    def resolve(self, floats: list[float], params: dict[str, Any], rtp: float) -> Outcome:
        raise NotImplementedError

    def describe(self, rtp: float) -> dict[str, Any]:
        """Paytables and limits the client needs to render the game."""
        return {}

    def theoretical_rtp(self, params: dict[str, Any], rtp: float) -> float:
        return rtp

    def check_amount(self, params: dict[str, Any], amount: int) -> None:
        """Hook for games whose params carry their own stake breakdown."""

    def simulate_once(self, rand, params: dict[str, Any], rtp: float) -> float:
        """One round with a plain PRNG (``rand()`` -> float in [0, 1)); returns the multiplier."""
        p = self.validate(params)
        return self.resolve([rand() for _ in range(self.floats_needed(p))], p, rtp).multiplier_x100 / 100

    def meta(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "kind": self.kind,
            "category": self.category,
            "tagline": self.tagline,
            "rtp_range": [self.min_rtp, self.max_rtp],
            "default_rtp": self.default_rtp,
        }


def pick(params: dict[str, Any], key: str, allowed, default):
    value = params.get(key, default)
    if value not in allowed:
        raise ParamError(f"'{key}' must be one of {list(allowed)}")
    return value


class StatefulEngine(GameEngine):
    """Multi-step games (Mines, HiLo, Dragon Tower): start -> act* -> cash out or lose.

    The whole round is fixed at ``start`` from the seeded floats (``secret``); actions only
    reveal it. ``state`` is public and stored on the round; ``secret`` is revealed at the end.
    """

    kind = "stateful"

    def start(self, floats: list[float], params: dict[str, Any], rtp: float) -> tuple[dict, dict]:
        raise NotImplementedError

    def act(self, secret: dict, state: dict, params: dict[str, Any], rtp: float, action: dict[str, Any]) -> Step:
        raise NotImplementedError

    def multiplier_x100(self, state: dict, params: dict[str, Any], rtp: float) -> int:
        """Current cash-out multiplier; 0 when cashing out is not allowed yet."""
        raise NotImplementedError

    def view(self, state: dict, params: dict[str, Any], rtp: float) -> dict[str, Any]:
        """Extra public info for the client (next multiplier, odds...)."""
        return {}
