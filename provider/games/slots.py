"""3x3 Classic Slots: three reels of 24 symbols, five paylines (3 rows + 2 diagonals).

A line pays when its three symbols match (WILD substitutes for any symbol; three WILDs pay
the WILD prize) or when the first two are cherries. The expected number of paying lines per
symbol is computed exactly over all 24^3 reel stops, so the paytable can be fitted to the RTP.
"""

import math
import random
from functools import lru_cache

from ..rtp import expected_return, fit_table
from .base import GameEngine, Outcome

SYMBOLS = ("cherry", "lemon", "bell", "bar", "star", "diamond", "seven", "wild")
FREQ = {"cherry": 6, "lemon": 5, "bell": 4, "bar": 3, "star": 2, "diamond": 2, "seven": 1, "wild": 1}
PRIZES = ("cherry_pair", "cherry", "lemon", "bell", "bar", "star", "diamond", "seven", "wild")
SHAPE = {"cherry_pair": 0.4, "cherry": 1.5, "lemon": 2, "bell": 4, "bar": 8, "star": 15, "diamond": 30, "seven": 100, "wild": 250}
LINES = (((0, 0), (1, 0), (2, 0)), ((0, 1), (1, 1), (2, 1)), ((0, 2), (1, 2), (2, 2)), ((0, 0), (1, 1), (2, 2)), ((0, 2), (1, 1), (2, 0)))


def _strip(seed: int) -> list[str]:
    s = [sym for sym, n in FREQ.items() for _ in range(n)]
    random.Random(seed).shuffle(s)
    return s


REELS = [_strip(7), _strip(19), _strip(41)]
STRIP = len(REELS[0])


def window(stops: list[int]) -> list[list[str]]:
    """window[reel][row]"""
    return [[REELS[r][(stops[r] + i) % STRIP] for i in range(3)] for r in range(3)]


def line_prize(a: str, b: str, c: str) -> str | None:
    syms = (a, b, c)
    if all(s == "wild" for s in syms):
        return "wild"
    real = {s for s in syms if s != "wild"}
    if len(real) == 1:
        return real.pop()
    if {a, b} <= {"cherry", "wild"}:
        return "cherry_pair"
    return None


@lru_cache
def prize_rates() -> tuple[float, ...]:
    """Expected number of winning lines per spin for each prize."""
    counts = dict.fromkeys(PRIZES, 0)
    for s0 in range(STRIP):
        for s1 in range(STRIP):
            for s2 in range(STRIP):
                w = window([s0, s1, s2])
                for line in LINES:
                    p = line_prize(*(w[r][row] for r, row in line))
                    if p:
                        counts[p] += 1
    total = STRIP**3
    return tuple(counts[p] / total for p in PRIZES)


def paytable(rtp: float) -> dict[str, int]:
    return dict(zip(PRIZES, fit_table([SHAPE[p] for p in PRIZES], prize_rates(), rtp)))


class Slots(GameEngine):
    id = "slots"
    name = "Fruit Slots"
    category = "Slots"
    tagline = "Classic 3×3 reels, five lines, wilds."
    default_rtp = 0.96

    def floats_needed(self, params):
        return 3

    def resolve(self, floats, params, rtp):
        stops = [int(math.floor(f * STRIP)) for f in floats[:3]]
        w = window(stops)
        pt = paytable(rtp)
        wins = []
        total = 0
        for i, line in enumerate(LINES):
            prize = line_prize(*(w[r][row] for r, row in line))
            if prize and pt[prize] > 0:
                wins.append({"line": i, "prize": prize, "multiplier": pt[prize] / 100})
                total += pt[prize]
        return Outcome(total, {"stops": stops, "window": w, "wins": wins})

    def describe(self, rtp):
        return {"reels": REELS, "lines": [list(map(list, l)) for l in LINES], "paytable": paytable(rtp), "symbols": list(SYMBOLS)}

    def theoretical_rtp(self, params, rtp):
        pt = paytable(rtp)
        return expected_return([pt[p] for p in PRIZES], prize_rates())
