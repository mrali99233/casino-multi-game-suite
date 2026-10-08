"""Keno: 10 numbers drawn from 40; the player picks 1-10.

Hits follow the hypergeometric law P(h) = C(p, h) C(40 - p, 10 - h) / C(40, 10). Each risk level
has a payout shape (minimum hits to win, steepness, cap) that is fitted to the RTP per pick count.
"""

import math
from functools import lru_cache
from math import comb

from ..rtp import expected_return, fit_table
from .base import GameEngine, Outcome, ParamError, pick

NUMBERS, DRAWN = 40, 10
RISKS = ("low", "medium", "high")
# (share of picks needed to win, steepness exponent, multiplier cap before fitting)
PROFILE = {"low": (0.3, 0.55, 1_000), "medium": (0.45, 0.75, 10_000), "high": (0.55, 0.95, 100_000)}


@lru_cache
def hit_probs(picks: int) -> tuple[float, ...]:
    return tuple(comb(picks, h) * comb(NUMBERS - picks, DRAWN - h) / comb(NUMBERS, DRAWN) for h in range(picks + 1))


def shape(picks: int, risk: str) -> list[float]:
    share, steep, cap = PROFILE[risk]
    probs = hit_probs(picks)
    first = max(1, math.ceil(picks * share))
    base = [0.0 if h < first else min(cap, (1 / probs[h]) ** steep) for h in range(picks + 1)]
    for h in range(first + 1, picks + 1):  # strictly increasing pay for more hits
        base[h] = max(base[h], base[h - 1] * 1.6)
    return base


def table(picks: int, risk: str, rtp: float) -> list[int]:
    return fit_table(shape(picks, risk), hit_probs(picks), rtp)


class Keno(GameEngine):
    id = "keno"
    name = "Keno"
    category = "Numbers"
    tagline = "Pick up to 10 numbers. Watch the draw."
    default_rtp = 0.97

    def validate(self, params):
        nums = params.get("numbers")
        if not isinstance(nums, list) or not 1 <= len(nums) <= 10:
            raise ParamError("Pick between 1 and 10 numbers")
        try:
            nums = sorted({int(n) for n in nums})
        except (TypeError, ValueError):
            raise ParamError("Numbers must be integers") from None
        if len(nums) != len(params["numbers"]) or not all(1 <= n <= NUMBERS for n in nums):
            raise ParamError(f"Numbers must be distinct and between 1 and {NUMBERS}")
        return {"numbers": nums, "risk": pick(params, "risk", RISKS, "medium")}

    def floats_needed(self, params):
        return DRAWN

    def resolve(self, floats, params, rtp):
        pool = list(range(1, NUMBERS + 1))
        for i in range(DRAWN):
            j = i + int(math.floor(floats[i] * (NUMBERS - i)))
            pool[i], pool[j] = pool[j], pool[i]
        drawn = pool[:DRAWN]
        hits = sorted(set(drawn) & set(params["numbers"]))
        mult = table(len(params["numbers"]), params["risk"], rtp)[len(hits)]
        return Outcome(mult, {"drawn": drawn, "hits": hits})

    def describe(self, rtp):
        return {"numbers": NUMBERS, "drawn": DRAWN, "risks": list(RISKS),
                "tables": {r: {str(p): table(p, r, rtp) for p in range(1, 11)} for r in RISKS}}

    def theoretical_rtp(self, params, rtp):
        p = self.validate(params)
        n = len(p["numbers"])
        return expected_return(table(n, p["risk"], rtp), hit_probs(n))

    def simulate_once(self, rand, params, rtp):
        return self.resolve([rand() for _ in range(DRAWN)], self.validate(params), rtp).multiplier_x100 / 100
