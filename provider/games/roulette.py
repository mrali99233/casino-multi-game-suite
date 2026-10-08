"""European roulette: 37 pockets (0-36), standard payouts.

RTP is fixed by the rules (36/37 = 97.30%) and is not adjustable: a straight-up bet always
returns 36x the chip, even-money bets 2x, dozens and columns 3x.
"""

import math

from .base import GameEngine, Outcome, ParamError

POCKETS = 37
RED = {1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36}
WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
PAYS = {"straight": 36, "red": 2, "black": 2, "odd": 2, "even": 2, "low": 2, "high": 2, "dozen": 3, "column": 3}
MAX_CHIPS = 60


def wins(chip: dict, n: int) -> bool:
    t, v = chip["type"], chip.get("value")
    if t == "straight":
        return n == v
    if n == 0:
        return False
    return {
        "red": n in RED, "black": n not in RED, "odd": n % 2 == 1, "even": n % 2 == 0,
        "low": n <= 18, "high": n >= 19, "dozen": (n - 1) // 12 + 1 == v, "column": (n - 1) % 3 + 1 == v,
    }[t]


class Roulette(GameEngine):
    id = "roulette"
    name = "Roulette"
    category = "Table"
    tagline = "European single-zero wheel."
    default_rtp = min_rtp = max_rtp = 0.973
    default_max_win = 10_000_000

    def validate(self, params):
        chips = params.get("chips")
        if not isinstance(chips, list) or not 1 <= len(chips) <= MAX_CHIPS:
            raise ParamError(f"Place between 1 and {MAX_CHIPS} chips")
        out = []
        for c in chips:
            if not isinstance(c, dict) or c.get("type") not in PAYS:
                raise ParamError(f"Chip type must be one of {list(PAYS)}")
            try:
                amount = int(c.get("amount", 0))
            except (TypeError, ValueError):
                raise ParamError("Chip amount must be an integer") from None
            if amount <= 0:
                raise ParamError("Chip amounts must be positive")
            chip = {"type": c["type"], "amount": amount}
            if c["type"] == "straight":
                if not isinstance(c.get("value"), int) or not 0 <= c["value"] <= 36:
                    raise ParamError("Straight bets need a number 0-36")
                chip["value"] = c["value"]
            elif c["type"] in ("dozen", "column"):
                if c.get("value") not in (1, 2, 3):
                    raise ParamError("Dozen and column bets need value 1, 2 or 3")
                chip["value"] = c["value"]
            out.append(chip)
        return {"chips": out}

    def check_amount(self, params, amount):
        if sum(c["amount"] for c in params["chips"]) != amount:
            raise ParamError("Bet amount must equal the sum of the chips")

    def resolve(self, floats, params, rtp):
        n = int(math.floor(floats[0] * POCKETS))
        total = sum(c["amount"] for c in params["chips"])
        won = [i for i, c in enumerate(params["chips"]) if wins(c, n)]
        payout = sum(params["chips"][i]["amount"] * PAYS[params["chips"][i]["type"]] for i in won)
        colour = "green" if n == 0 else "red" if n in RED else "black"
        return Outcome(payout * 100 // total, {"number": n, "colour": colour, "winning_chips": won}, payout=payout)

    def describe(self, rtp):
        return {"wheel": WHEEL, "red": sorted(RED), "pays": PAYS}

    def theoretical_rtp(self, params, rtp):
        return 36 / 37

    def simulate_once(self, rand, params, rtp):
        p = self.validate(params if params.get("chips") else {"chips": [{"type": "red", "amount": 100}]})
        out = self.resolve([rand()], p, rtp)
        return out.payout / sum(c["amount"] for c in p["chips"])
