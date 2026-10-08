"""Dice: roll = floor(r * 10001) / 100, uniform over 0.00 .. 100.00 (10,001 outcomes).

"under" wins when roll < target, "over" when roll > target. With n winning outcomes the
multiplier is floor(RTP * 10001 / n) to 0.01x, so the expected return never exceeds RTP.
"""

import math

from .base import GameEngine, Outcome, ParamError, pick

OUTCOMES = 10001


def win_count(target_x100: int, condition: str) -> int:
    return target_x100 if condition == "under" else 10000 - target_x100


def multiplier_x100(target_x100: int, condition: str, rtp: float) -> int:
    return int(math.floor(rtp * OUTCOMES / win_count(target_x100, condition) * 100 + 1e-9))


class Dice(GameEngine):
    id = "dice"
    name = "Dice"
    category = "Numbers"
    tagline = "Pick your odds from 1% to 98%."
    default_rtp = 0.99

    def validate(self, params):
        condition = pick(params, "condition", ("under", "over"), "over")
        try:
            target_x100 = round(float(params.get("target", 50.5)) * 100)
        except (TypeError, ValueError):
            raise ParamError("'target' must be a number") from None
        n = win_count(target_x100, condition) if 0 < target_x100 < 10000 else 0
        if not 100 <= n <= 9800:
            raise ParamError("Win chance must be between 1% and 98%")
        return {"target": target_x100 / 100, "condition": condition}

    def resolve(self, floats, params, rtp):
        target_x100 = round(params["target"] * 100)
        roll_x100 = int(math.floor(floats[0] * OUTCOMES))
        win = roll_x100 < target_x100 if params["condition"] == "under" else roll_x100 > target_x100
        mult = multiplier_x100(target_x100, params["condition"], rtp)
        return Outcome(mult if win else 0, {"roll": roll_x100 / 100, "win": win, "payout_multiplier": mult / 100})

    def describe(self, rtp):
        return {"outcomes": OUTCOMES, "min_chance": 1, "max_chance": 98}

    def theoretical_rtp(self, params, rtp):
        p = self.validate(params)
        t = round(p["target"] * 100)
        return multiplier_x100(t, p["condition"], rtp) / 100 * win_count(t, p["condition"]) / OUTCOMES
