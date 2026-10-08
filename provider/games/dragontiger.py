"""Dragon Tiger: one card each to Dragon and Tiger from an infinite shoe; higher rank wins
(Ace low, King high). P(tie) = 1/13, P(Dragon) = P(Tiger) = 6/13.

On a tie, Dragon and Tiger bets get half back. Their win return and the Tie return are fitted
to the RTP: win = (RTP - 0.5 x 1/13) / (6/13), tie = 13 x RTP, both rounded down to 0.01x.
"""

import math

from .base import GameEngine, Outcome
from .cards import rank, shoe
from .chips import check_total, settle, validate_chips

SPOTS = ("dragon", "tiger", "tie")
P_TIE, P_WIN = 1 / 13, 6 / 13
HALF_BACK_X100 = 50


def returns_x100(rtp: float) -> dict[str, int]:
    return {
        "win": int(math.floor((rtp - P_TIE * HALF_BACK_X100 / 100) / P_WIN * 100 + 1e-9)),
        "tie": int(math.floor(rtp / P_TIE * 100 + 1e-9)),
    }


class DragonTiger(GameEngine):
    id = "dragontiger"
    name = "Dragon Tiger"
    category = "Cards"
    tagline = "Two cards. Higher one wins."
    default_rtp = 0.97

    def validate(self, params):
        return validate_chips(params, SPOTS)

    def check_amount(self, params, amount):
        check_total(params, amount)

    def floats_needed(self, params):
        return 2

    def resolve(self, floats, params, rtp):
        dragon, tiger = shoe(floats[:2])
        d, t = rank(dragon), rank(tiger)
        winner = "dragon" if d > t else "tiger" if t > d else "tie"
        r = returns_x100(rtp)
        ret = {
            "dragon": r["win"] if winner == "dragon" else HALF_BACK_X100 if winner == "tie" else 0,
            "tiger": r["win"] if winner == "tiger" else HALF_BACK_X100 if winner == "tie" else 0,
            "tie": r["tie"] if winner == "tie" else 0,
        }
        payout = settle(params["chips"], ret)
        total = sum(c["amount"] for c in params["chips"])
        return Outcome(payout * 100 // total, {"dragon": dragon, "tiger": tiger, "winner": winner}, payout=payout)

    def describe(self, rtp):
        r = returns_x100(rtp)
        return {"spots": list(SPOTS), "returns": {"dragon": r["win"] / 100, "tiger": r["win"] / 100, "tie": r["tie"] / 100, "tie_refund": 0.5}}

    def theoretical_rtp(self, params, rtp):
        r = returns_x100(rtp)
        main = r["win"] / 100 * P_WIN + 0.5 * P_TIE
        tie = r["tie"] / 100 * P_TIE
        chips = params.get("chips") or [{"type": "dragon", "amount": 1}]
        total = sum(c["amount"] for c in chips)
        return sum(c["amount"] * (tie if c["type"] == "tie" else main) for c in chips) / total

    def simulate_once(self, rand, params, rtp):
        p = self.validate(params if params.get("chips") else {"chips": [{"type": "dragon", "amount": 100}]})
        out = self.resolve([rand(), rand()], p, rtp)
        return out.payout / sum(c["amount"] for c in p["chips"])
