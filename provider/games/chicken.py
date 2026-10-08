"""Chicken Road: cross lane after lane; each lane is survived with probability p
(by difficulty). The lane where the chicken gets hit is fixed at the start from one float per
lane (first lane whose float >= p). After k lanes the cash-out multiplier is RTP / p^k.
"""

import math

from .base import ParamError, StatefulEngine, Step, pick

DIFFICULTY = {"easy": (0.90, 24), "medium": (0.80, 20), "hard": (0.70, 16), "daredevil": (0.55, 12)}


def multiplier_x100(difficulty: str, lanes: int, rtp: float) -> int:
    if lanes == 0:
        return 100
    p, _ = DIFFICULTY[difficulty]
    return int(math.floor(rtp / p**lanes * 100 + 1e-9))


class ChickenRoad(StatefulEngine):
    id = "chicken"
    name = "Chicken Road"
    category = "Grid risk"
    tagline = "Cross the road, lane by lane."
    default_rtp = 0.97

    def validate(self, params):
        return {"difficulty": pick(params, "difficulty", tuple(DIFFICULTY), "medium")}

    def floats_needed(self, params):
        return DIFFICULTY[params["difficulty"]][1]

    def start(self, floats, params, rtp):
        p, lanes = DIFFICULTY[params["difficulty"]]
        hit = next((i for i, f in enumerate(floats[:lanes]) if f >= p), None)
        return {"hit_lane": hit}, {"lane": 0}

    def act(self, secret, state, params, rtp, action):
        if action.get("move") != "go":
            raise ParamError("'move' must be 'go'")
        lane, total = state["lane"], DIFFICULTY[params["difficulty"]][1]
        if secret["hit_lane"] == lane:
            return Step({"lane": lane, "hit": lane}, "lost")
        new = {"lane": lane + 1}
        mult = multiplier_x100(params["difficulty"], lane + 1, rtp)
        return Step(new, "cashout" if lane + 1 == total else "continue", mult)

    def multiplier_x100(self, state, params, rtp):
        return multiplier_x100(params["difficulty"], state["lane"], rtp) if state["lane"] else 0

    def view(self, state, params, rtp):
        k, total = state["lane"], DIFFICULTY[params["difficulty"]][1]
        return {"next_multiplier": multiplier_x100(params["difficulty"], k + 1, rtp) / 100 if k < total else None}

    def describe(self, rtp):
        return {"difficulties": {d: {"survive": p, "lanes": n, "ladder": [multiplier_x100(d, k, rtp) for k in range(1, n + 1)]} for d, (p, n) in DIFFICULTY.items()}}

    def theoretical_rtp(self, params, rtp):
        d = self.validate(params)["difficulty"]
        k = int(params.get("lanes", 3))
        return multiplier_x100(d, k, rtp) / 100 * DIFFICULTY[d][0] ** k

    def simulate_once(self, rand, params, rtp):
        p = self.validate(params)
        k = int(params.get("lanes", 3))
        surv = DIFFICULTY[p["difficulty"]][0]
        for _ in range(k):
            if rand() >= surv:
                return 0.0
        return multiplier_x100(p["difficulty"], k, rtp) / 100
