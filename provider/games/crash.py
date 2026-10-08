"""Crash: crash point = RTP / (1 - r), floored to 0.01x, minimum 1.00x.

P(crash >= m) = RTP / m for every m >= 1, so cashing out at any target returns exactly RTP
in expectation. The flight curve is m(t) = e^(growth * t).
"""

import math

from .base import GameEngine

MAX_X100 = 100_000_000  # 1,000,000x hard cap


def crash_point_x100(r: float, rtp: float) -> int:
    raw = rtp / (1 - r)
    return max(100, min(MAX_X100, int(math.floor(raw * 100 + 1e-9))))


def multiplier_at(seconds: float, growth: float) -> float:
    return math.exp(growth * max(0.0, seconds))


def seconds_to(mult: float, growth: float) -> float:
    return math.log(max(1.0, mult)) / growth


class Crash(GameEngine):
    id = "crash"
    name = "Aviator"
    kind = "realtime"
    category = "Crash"
    tagline = "Cash out before the plane flies away."
    default_min_bet = 10
    default_max_bet = 50_000

    def describe(self, rtp):
        return {"max_multiplier": MAX_X100 / 100}

    def theoretical_rtp(self, params, rtp):
        target = float(params.get("cashout", 2.0))
        return min(1.0, rtp / target) * target
