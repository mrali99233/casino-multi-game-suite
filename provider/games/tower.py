"""Dragon Tower: climb 9 rows; each row hides good and bad tiles depending on difficulty.

With g good tiles out of t per row, surviving k rows has probability (g/t)^k, so the cash-out
multiplier is RTP x (t/g)^k rounded down to 0.01x.
"""

import math

from .base import ParamError, StatefulEngine, Step, pick

ROWS = 9
DIFFICULTY = {"easy": (4, 3), "medium": (3, 2), "hard": (2, 1), "expert": (3, 1), "master": (4, 1)}


def multiplier_x100(difficulty: str, rows: int, rtp: float) -> int:
    if rows == 0:
        return 100
    tiles, good = DIFFICULTY[difficulty]
    return int(math.floor(rtp * (tiles / good) ** rows * 100 + 1e-9))


class Tower(StatefulEngine):
    id = "tower"
    name = "Dragon Tower"
    category = "Grid risk"
    tagline = "Climb nine floors without waking the dragon."
    default_rtp = 0.97

    def validate(self, params):
        return {"difficulty": pick(params, "difficulty", tuple(DIFFICULTY), "medium")}

    def floats_needed(self, params):
        return ROWS * (DIFFICULTY[params["difficulty"]][0] - 1)

    def start(self, floats, params, rtp):
        tiles, good = DIFFICULTY[params["difficulty"]]
        it = iter(floats)
        rows = []
        for _ in range(ROWS):
            order = list(range(tiles))
            for i in range(tiles - 1, 0, -1):
                j = int(math.floor(next(it) * (i + 1)))
                order[i], order[j] = order[j], order[i]
            rows.append(sorted(order[:good]))
        return {"safe": rows}, {"row": 0, "picks": []}

    def act(self, secret, state, params, rtp, action):
        tiles, _ = DIFFICULTY[params["difficulty"]]
        col = action.get("column")
        if not isinstance(col, int) or not 0 <= col < tiles:
            raise ParamError(f"'column' must be 0..{tiles - 1}")
        row = state["row"]
        picks = state["picks"] + [col]
        if col not in secret["safe"][row]:
            return Step({"row": row, "picks": picks, "lost_at": row}, "lost")
        new = {"row": row + 1, "picks": picks}
        mult = multiplier_x100(params["difficulty"], row + 1, rtp)
        return Step(new, "cashout" if row + 1 == ROWS else "continue", mult)

    def multiplier_x100(self, state, params, rtp):
        return multiplier_x100(params["difficulty"], state["row"], rtp) if state["row"] else 0

    def view(self, state, params, rtp):
        r = state["row"]
        return {"next_multiplier": multiplier_x100(params["difficulty"], r + 1, rtp) / 100 if r < ROWS else None}

    def describe(self, rtp):
        return {"rows": ROWS, "difficulties": {d: {"tiles": t, "good": g, "ladder": [multiplier_x100(d, k, rtp) for k in range(1, ROWS + 1)]} for d, (t, g) in DIFFICULTY.items()}}

    def theoretical_rtp(self, params, rtp):
        d = self.validate(params)["difficulty"]
        k = int(params.get("rows", 3))
        t, g = DIFFICULTY[d]
        return multiplier_x100(d, k, rtp) / 100 * (g / t) ** k

    def simulate_once(self, rand, params, rtp):
        p = self.validate(params)
        k = int(params.get("rows", 3))
        secret, state = self.start([rand() for _ in range(self.floats_needed(p))], p, rtp)
        tiles = DIFFICULTY[p["difficulty"]][0]
        for _ in range(k):
            step = self.act(secret, state, p, rtp, {"column": int(rand() * tiles)})
            if step.status == "lost":
                return 0.0
            state = step.state
        return multiplier_x100(p["difficulty"], k, rtp) / 100
