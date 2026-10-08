"""Mines: 25 tiles, n hidden mines placed by a Fisher-Yates shuffle driven by 24 floats.

After k safe picks the survival probability is C(25-n, k) / C(25, k), so paying
RTP * C(25, k) / C(25-n, k) (rounded down to 0.01x) keeps every cash-out point at <= RTP.
"""

import math
from math import comb

from .base import ParamError, StatefulEngine, Step

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


class Mines(StatefulEngine):
    id = "mines"
    name = "Mines"
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

    def start(self, floats, params, rtp):
        return {"mines": layout(floats, params["mines"])}, {"revealed": []}

    def act(self, secret, state, params, rtp, action):
        tile = action.get("tile")
        if not isinstance(tile, int) or not 0 <= tile < TILES:
            raise ParamError("'tile' must be 0..24")
        revealed = list(state["revealed"])
        if tile in revealed:
            raise ParamError("Tile already revealed")
        if tile in secret["mines"]:
            return Step({"revealed": revealed, "mine_hit": tile}, "lost")
        revealed.append(tile)
        new = {"revealed": revealed}
        mult = multiplier_x100(params["mines"], len(revealed), rtp)
        return Step(new, "cashout" if len(revealed) == TILES - params["mines"] else "continue", mult)

    def multiplier_x100(self, state, params, rtp):
        k = len(state["revealed"])
        return multiplier_x100(params["mines"], k, rtp) if k else 0

    def view(self, state, params, rtp):
        n, k = params["mines"], len(state["revealed"])
        return {"next_multiplier": multiplier_x100(n, k + 1, rtp) / 100 if k < TILES - n else None}

    def describe(self, rtp):
        return {
            "tiles": TILES,
            "ladders": {str(n): [multiplier_x100(n, k, rtp) for k in range(1, TILES - n + 1)] for n in range(1, 25)},
        }

    def theoretical_rtp(self, params, rtp):
        n = self.validate(params)["mines"]
        picks = int(params.get("picks", 1))
        return multiplier_x100(n, picks, rtp) / 100 * comb(TILES - n, picks) / comb(TILES, picks)

    def simulate_once(self, rand, params, rtp):
        p = self.validate(params)
        n, picks = p["mines"], int(params.get("picks", 3))
        if not 1 <= picks <= TILES - n:
            raise ValueError(f"picks must be 1..{TILES - n}")
        mines = set(layout([rand() for _ in range(24)], n))
        order = list(range(TILES))
        for i in range(TILES - 1, 0, -1):  # player picks a random distinct order
            j = int(rand() * (i + 1))
            order[i], order[j] = order[j], order[i]
        if any(t in mines for t in order[:picks]):
            return 0.0
        return multiplier_x100(n, picks, rtp) / 100
