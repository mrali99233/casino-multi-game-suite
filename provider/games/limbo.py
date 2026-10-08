"""Limbo: pick a target multiplier T; the game draws X = RTP / (1 - r) (same law as crash).

P(X >= T) = RTP / T, so a win paying T returns exactly RTP in expectation for every target.
"""

from .base import GameEngine, Outcome, ParamError
from .crash import MAX_X100, crash_point_x100


class Limbo(GameEngine):
    id = "limbo"
    name = "Limbo"
    category = "Crash"
    tagline = "Set a target. Beat it."
    default_rtp = 0.99

    def validate(self, params):
        try:
            target_x100 = round(float(params.get("target", 2)) * 100)
        except (TypeError, ValueError):
            raise ParamError("'target' must be a number") from None
        if not 101 <= target_x100 <= MAX_X100:
            raise ParamError(f"'target' must be between 1.01 and {MAX_X100 // 100:,}")
        return {"target": target_x100 / 100}

    def resolve(self, floats, params, rtp):
        target_x100 = round(params["target"] * 100)
        drawn = crash_point_x100(floats[0], rtp)
        win = drawn >= target_x100
        return Outcome(target_x100 if win else 0, {"result": drawn / 100, "win": win})

    def describe(self, rtp):
        return {"min_target": 1.01, "max_target": MAX_X100 / 100}

    def theoretical_rtp(self, params, rtp):
        return rtp
