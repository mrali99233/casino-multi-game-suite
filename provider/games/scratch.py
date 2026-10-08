"""Scratch Card: nine panels; three matching symbols win that symbol's prize.

The prize is drawn first from fixed odds; the card is then built to show it (three of the
winning symbol and at most two of every other symbol, so a card never shows two wins).
The prize shape is fitted to the RTP over those odds.
"""

import math

from ..rtp import expected_return, fit_table
from .base import GameEngine, Outcome

SYMBOLS = ("cherry", "lemon", "bell", "star", "diamond", "seven")
ODDS = {"cherry": 0.10, "lemon": 0.05, "bell": 0.025, "star": 0.01, "diamond": 0.0035, "seven": 0.001}
SHAPE = {"cherry": 1, "lemon": 2, "bell": 5, "star": 15, "diamond": 50, "seven": 250}
OUTCOMES = SYMBOLS + ("none",)
PROBS = tuple(ODDS.get(o, 1 - sum(ODDS.values())) for o in OUTCOMES)


def prizes(rtp: float) -> dict[str, int]:
    return dict(zip(OUTCOMES, fit_table([SHAPE.get(o, 0) for o in OUTCOMES], PROBS, rtp)))


def build_card(floats: list[float]) -> tuple[str, list[str]]:
    it = iter(floats)
    r, acc, prize = next(it), 0.0, "none"
    for o, p in zip(OUTCOMES, PROBS):
        acc += p
        if r < acc:
            prize = o
            break
    counts = dict.fromkeys(SYMBOLS, 0)
    cells: list[str] = []
    if prize != "none":
        cells += [prize] * 3
        counts[prize] = 3
    while len(cells) < 9:
        options = [s for s in SYMBOLS if counts[s] < 2]
        s = options[int(math.floor(next(it) * len(options)))]
        counts[s] += 1
        cells.append(s)
    for i in range(8, 0, -1):
        j = int(math.floor(next(it) * (i + 1)))
        cells[i], cells[j] = cells[j], cells[i]
    return prize, cells


class Scratch(GameEngine):
    id = "scratch"
    name = "Scratch Card"
    category = "Instant"
    tagline = "Scratch nine panels. Match three."
    default_rtp = 0.97

    def floats_needed(self, params):
        return 18

    def resolve(self, floats, params, rtp):
        prize, cells = build_card(floats)
        return Outcome(prizes(rtp)[prize], {"cells": cells, "prize": prize})

    def describe(self, rtp):
        p = prizes(rtp)
        return {"prizes": {s: p[s] / 100 for s in SYMBOLS}, "odds": ODDS}

    def theoretical_rtp(self, params, rtp):
        p = prizes(rtp)
        return expected_return([p[o] for o in OUTCOMES], PROBS)
