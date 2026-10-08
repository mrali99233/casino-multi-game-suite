"""Andar Bahar: a joker card is turned from a shuffled single deck, then cards are dealt
alternately to Andar (first) and Bahar until one matches the joker's rank.

Three cards of the joker's rank remain among 51, so the first match lands on deal position j
with probability C(51 - j, 2) / C(51, 3). Andar wins on odd positions (about 51.5%). Each side's
return is RTP / P(side), rounded down to 0.01x.
"""

import math
from functools import lru_cache
from math import comb

from .base import GameEngine, Outcome
from .cards import rank, shuffled
from .chips import check_total, settle, validate_chips

SPOTS = ("andar", "bahar")


@lru_cache
def side_probs() -> dict[str, float]:
    total = comb(51, 3)
    andar = sum(comb(51 - j, 2) for j in range(1, 50, 2)) / total
    return {"andar": andar, "bahar": 1 - andar}


def returns_x100(rtp: float) -> dict[str, int]:
    return {s: int(math.floor(rtp / p * 100 + 1e-9)) for s, p in side_probs().items()}


class AndarBahar(GameEngine):
    id = "andarbahar"
    name = "Andar Bahar"
    category = "Cards"
    tagline = "Which side finds the joker's match?"
    default_rtp = 0.97

    def validate(self, params):
        return validate_chips(params, SPOTS)

    def check_amount(self, params, amount):
        check_total(params, amount)

    def floats_needed(self, params):
        return 51

    def resolve(self, floats, params, rtp):
        deck = shuffled(floats)
        joker, rest = deck[0], deck[1:]
        andar, bahar = [], []
        winner = None
        for i, c in enumerate(rest):
            (andar if i % 2 == 0 else bahar).append(c)
            if rank(c) == rank(joker):
                winner = "andar" if i % 2 == 0 else "bahar"
                break
        r = returns_x100(rtp)
        payout = settle(params["chips"], {winner: r[winner]})
        total = sum(c["amount"] for c in params["chips"])
        return Outcome(payout * 100 // total, {"joker": joker, "andar": andar, "bahar": bahar, "winner": winner}, payout=payout)

    def describe(self, rtp):
        r = returns_x100(rtp)
        return {"spots": list(SPOTS), "returns": {s: v / 100 for s, v in r.items()}, "odds": side_probs()}

    def theoretical_rtp(self, params, rtp):
        r, p = returns_x100(rtp), side_probs()
        chips = params.get("chips") or [{"type": "andar", "amount": 1}]
        total = sum(c["amount"] for c in chips)
        return sum(c["amount"] * r[c["type"]] / 100 * p[c["type"]] for c in chips) / total

    def simulate_once(self, rand, params, rtp):
        p = self.validate(params if params.get("chips") else {"chips": [{"type": "andar", "amount": 100}]})
        out = self.resolve([rand() for _ in range(51)], p, rtp)
        return out.payout / sum(c["amount"] for c in p["chips"])
