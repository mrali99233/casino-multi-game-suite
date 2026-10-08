"""Mines: 25 tiles, n hidden mines placed by a Fisher-Yates shuffle driven by 24 floats.

After k safe picks the survival probability is C(25-n, k) / C(25, k), so paying
RTP * C(25, k) / C(25-n, k) (rounded down to 0.01x) keeps every cash-out point at <= RTP.
"""

import math
from math import comb

from .base import GameEngine, ParamError

TILES = 25


def layout(floats: list[float], mines: int) -> list[int]:
    tiles = list(range(TILES))
    for i in range(TILES - 1, 0, -1):
        j = int(math.floor(floats[TILES - 1 - i] * (i + 1)))
        tiles[i], tiles[j] = tiles[j], tiles[i]
    return sorted(tiles[:mines])


def multiplier_x100(mines: int, picks: int, rtp: float) -> int:
    if picks == 0:
        return 100
    return int(math.floor(rtp * comb(TILES, picks) / comb(TILES - mines, picks) * 100 + 1e-9))


class Mines(GameEngine):
    id = "mines"
    name = "Mines"
    kind = "stateful"
    category = "Grid risk"
    tagline = "Find gems, dodge mines, cash out any time."

    def validate(self, params):
        try:
            mines = int(params.get("mines", 3))
        except (TypeError, ValueError):
            raise ParamError("'mines' must be a number") from None
        if not 1 <= mines <= 24:
            raise ParamError("'mines' must be between 1 and 24")
        return {"mines": mines}

    def floats_needed(self, params):
        return TILES - 1

    def describe(self, rtp):
        return {
            "tiles": TILES,
            "ladders": {str(n): [multiplier_x100(n, k, rtp) for k in range(1, TILES - n + 1)] for n in range(1, 25)},
        }

    def theoretical_rtp(self, params, rtp):
        n = self.validate(params)["mines"]
        picks = int(params.get("picks", 1))
        return multiplier_x100(n, picks, rtp) / 100 * comb(TILES - n, picks) / comb(TILES, picks)
