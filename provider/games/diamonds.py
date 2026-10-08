"""Diamonds: five gems drawn from seven colours with replacement; pay by poker-style pattern.

Pattern probabilities come from enumerating all 7^5 = 16,807 draws, then the pattern payout
shape is fitted to the RTP.
"""

import itertools
import math
from collections import Counter
from functools import lru_cache

from ..rtp import expected_return, fit_table
from .base import GameEngine, Outcome

COLOURS = 7
PATTERNS = ("five", "four", "full", "three", "two_pair", "pair", "none")
SHAPE = {"five": 50, "four": 5, "full": 4, "three": 3, "two_pair": 2, "pair": 0.1, "none": 0}


def pattern(gems: list[int]) -> str:
    counts = sorted(Counter(gems).values(), reverse=True)
    if counts[0] == 5:
        return "five"
    if counts[0] == 4:
        return "four"
    if counts[:2] == [3, 2]:
        return "full"
    if counts[0] == 3:
        return "three"
    if counts[:2] == [2, 2]:
        return "two_pair"
    if counts[0] == 2:
        return "pair"
    return "none"


@lru_cache
def pattern_probs() -> tuple[float, ...]:
    c = Counter(pattern(list(g)) for g in itertools.product(range(COLOURS), repeat=5))
    total = COLOURS**5
    return tuple(c[p] / total for p in PATTERNS)


def table(rtp: float) -> dict[str, int]:
    return dict(zip(PATTERNS, fit_table([SHAPE[p] for p in PATTERNS], pattern_probs(), rtp)))


class Diamonds(GameEngine):
    id = "diamonds"
    name = "Diamonds"
    category = "Instant"
    tagline = "Five gems. Match colours to win."
    default_rtp = 0.98

    def floats_needed(self, params):
        return 5

    def resolve(self, floats, params, rtp):
        gems = [int(math.floor(f * COLOURS)) for f in floats[:5]]
        pat = pattern(gems)
        return Outcome(table(rtp)[pat], {"gems": gems, "pattern": pat})

    def describe(self, rtp):
        return {"colours": COLOURS, "paytable": table(rtp), "odds": dict(zip(PATTERNS, pattern_probs()))}

    def theoretical_rtp(self, params, rtp):
        t = table(rtp)
        return expected_return([t[p] for p in PATTERNS], pattern_probs())
