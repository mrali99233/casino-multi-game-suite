"""Galaxy Riches: 5x3 video slot, 20 fixed lines, WILD on reels 2-4, SCATTER free spins.

Exact math (no enumeration of 32^5 stops is needed):
* A line reads one cell per reel, and each reel stops uniformly, so the cell on reel i shows
  symbol s with probability freq_i(s) / 32, independently across reels. Reel 1 has no WILD,
  so a line pays symbol s with k in a row with probability
  f1(s) * prod_{i=2..k} (f_i(s) + f_i(W)) * (1 - f_{k+1}(s) - f_{k+1}(W)).
* Each reel holds one SCATTER, visible in its 3-row window with probability 3/32.
  Scatter counts are binomial over the five reels.
* 3+ scatters pay and award 10 free spins with line wins x3 (no retrigger).
RTP = L + S + P(trigger) * 10 * (3L + S); the line paytable shape is fitted so this hits target.
"""

import math
import random
from functools import lru_cache
from math import comb

from ..rtp import expected_return, fit_table
from .base import GameEngine, Outcome

REELS, ROWS, STRIP = 5, 3, 32
PAYING = ("ten", "jack", "queen", "king", "ace", "bell", "star", "diamond", "seven")
WILD, SCATTER = "wild", "scatter"
EDGE_FREQ = {"ten": 5, "jack": 5, "queen": 4, "king": 4, "ace": 4, "bell": 3, "star": 2, "diamond": 2, "seven": 2, WILD: 0, SCATTER: 1}
MID_FREQ = {"ten": 5, "jack": 4, "queen": 4, "king": 4, "ace": 4, "bell": 3, "star": 2, "diamond": 2, "seven": 1, WILD: 2, SCATTER: 1}
SHAPE = {  # relative pays for 3, 4, 5 of a kind
    "ten": (0.1, 0.25, 1), "jack": (0.1, 0.25, 1), "queen": (0.15, 0.4, 1.5), "king": (0.2, 0.5, 2), "ace": (0.25, 0.75, 2.5),
    "bell": (0.4, 1, 4), "star": (0.5, 1.5, 6), "diamond": (0.75, 2.5, 10), "seven": (1, 5, 25),
}
SCATTER_PAY_X100 = {3: 200, 4: 1000, 5: 5000}  # x total bet
FREE_SPINS, FS_MULT = 10, 3
LINES = (
    (1, 1, 1, 1, 1), (0, 0, 0, 0, 0), (2, 2, 2, 2, 2), (0, 1, 2, 1, 0), (2, 1, 0, 1, 2),
    (0, 0, 1, 2, 2), (2, 2, 1, 0, 0), (1, 0, 0, 0, 1), (1, 2, 2, 2, 1), (0, 1, 1, 1, 0),
    (2, 1, 1, 1, 2), (1, 0, 1, 2, 1), (1, 2, 1, 0, 1), (0, 1, 0, 1, 0), (2, 1, 2, 1, 2),
    (1, 1, 0, 1, 1), (1, 1, 2, 1, 1), (0, 0, 2, 0, 0), (2, 2, 0, 2, 2), (0, 2, 0, 2, 0),
)
PRIZES = tuple((s, k) for s in PAYING for k in (3, 4, 5))


def _strip(freq: dict[str, int], seed: int) -> list[str]:
    syms = [s for s, n in freq.items() for _ in range(n)]
    rnd = random.Random(seed)
    while True:  # keep the scatter away from the strip ends' wrap for a tidy layout
        rnd.shuffle(syms)
        if syms.index(SCATTER) not in (0, STRIP - 1):
            return list(syms)


FREQS = [EDGE_FREQ, MID_FREQ, MID_FREQ, MID_FREQ, EDGE_FREQ]
STRIPS = [_strip(f, 101 + i) for i, f in enumerate(FREQS)]


def _f(i: int, s: str) -> float:
    return FREQS[i][s] / STRIP


@lru_cache
def line_rates() -> tuple[float, ...]:
    """Expected number of the 20 lines paying each (symbol, count) prize per spin."""
    out = []
    for s, k in PRIZES:
        p = _f(0, s)
        for i in range(1, k):
            p *= _f(i, s) + _f(i, WILD)
        if k < REELS:
            p *= 1 - _f(k, s) - _f(k, WILD)
        out.append(p * len(LINES))
    return tuple(out)


@lru_cache
def scatter_probs() -> dict[int, float]:
    q = ROWS / STRIP
    return {n: comb(REELS, n) * q**n * (1 - q) ** (REELS - n) for n in range(REELS + 1)}


def scatter_ev() -> float:
    p = scatter_probs()
    return sum(p[n] * SCATTER_PAY_X100[n] / 100 for n in SCATTER_PAY_X100)


def trigger_prob() -> float:
    p = scatter_probs()
    return sum(p[n] for n in (3, 4, 5))


@lru_cache(maxsize=64)
def paytable(rtp: float) -> dict[tuple[str, int], int]:
    s, pt = scatter_ev(), trigger_prob()
    # small margin so float error in the combined formula can never push the total above target
    line_target = (rtp - s * (1 + FREE_SPINS * pt)) / (1 + FREE_SPINS * FS_MULT * pt) - 1e-6
    shape = [SHAPE[sym][k - 3] for sym, k in PRIZES]
    return dict(zip(PRIZES, fit_table(shape, line_rates(), line_target)))


def theoretical(rtp: float) -> float:
    pt = paytable(rtp)
    line = expected_return([pt[p] for p in PRIZES], line_rates())
    s, trig = scatter_ev(), trigger_prob()
    return line + s + trig * FREE_SPINS * (FS_MULT * line + s)


def window(stops: list[int]) -> list[list[str]]:
    return [[STRIPS[r][(stops[r] + row) % STRIP] for row in range(ROWS)] for r in range(REELS)]


def spin(stops: list[int], pt: dict, mult: int) -> dict:
    w = window(stops)
    wins, total = [], 0
    for i, line in enumerate(LINES):
        cells = [w[r][line[r]] for r in range(REELS)]
        s = cells[0]
        if s not in PAYING:
            continue
        k = 1
        while k < REELS and cells[k] in (s, WILD):
            k += 1
        if k >= 3 and pt[(s, k)]:
            amount = pt[(s, k)] * mult
            wins.append({"line": i, "symbol": s, "count": k, "multiplier": amount / 100})
            total += amount
    scatters = sum(col.count(SCATTER) for col in w)
    scatter_win = SCATTER_PAY_X100.get(scatters, 0)
    return {"stops": stops, "window": w, "wins": wins, "scatters": scatters, "scatter_win": scatter_win / 100, "total": (total + scatter_win) / 100, "_x100": total + scatter_win}


class VideoSlot(GameEngine):
    id = "videoslot"
    name = "Galaxy Riches"
    category = "Slots"
    tagline = "5 reels, 20 lines, free spins at 3×."
    default_rtp = 0.96
    default_max_win = 50_000_000

    def floats_needed(self, params):
        return REELS * (1 + FREE_SPINS)

    def resolve(self, floats, params, rtp):
        pt = paytable(rtp)
        stops = [int(math.floor(f * STRIP)) for f in floats]
        base = spin(stops[:REELS], pt, 1)
        total = base.pop("_x100")
        free = []
        if base["scatters"] >= 3:
            for n in range(FREE_SPINS):
                fs = spin(stops[REELS * (n + 1): REELS * (n + 2)], pt, FS_MULT)
                total += fs.pop("_x100")
                free.append(fs)
        return Outcome(total, {"base": base, "free_spins": free})

    def describe(self, rtp):
        pt = paytable(rtp)
        return {"strips": STRIPS, "lines": LINES, "rows": ROWS,
                "paytable": {s: [pt[(s, k)] / 100 for k in (3, 4, 5)] for s in PAYING},
                "scatter": {str(n): v / 100 for n, v in SCATTER_PAY_X100.items()},
                "free_spins": FREE_SPINS, "free_spin_multiplier": FS_MULT}

    def theoretical_rtp(self, params, rtp):
        return theoretical(rtp)
