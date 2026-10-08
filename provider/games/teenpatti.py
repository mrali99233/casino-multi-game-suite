"""Teen Patti (Player A vs Player B): three cards each from one shuffled deck.

Hands rank Trail > Pure sequence > Sequence > Colour > Pair > High card (A-K-Q is the top
sequence, A-2-3 the second). Equal hands are decided by suit (spades > hearts > diamonds >
clubs), so A and B each win exactly half the time and pay 2 x RTP.
Pair Plus is a side bet on A's hand; its category odds come from all C(52, 3) hands.
"""

import itertools
import math
from collections import Counter
from functools import lru_cache

from ..rtp import expected_return, fit_table
from .base import GameEngine, Outcome
from .cards import dealt, rank, suit
from .chips import check_total, settle, validate_chips

SPOTS = ("a", "b", "pair_plus")
CATEGORIES = ("trail", "pure_sequence", "sequence", "colour", "pair", "high_card")
PAIR_PLUS_SHAPE = {"trail": 31, "pure_sequence": 41, "sequence": 7, "colour": 5, "pair": 2, "high_card": 0}


def _v(card: int) -> int:
    r = rank(card)
    return 14 if r == 1 else r


def evaluate(cards: list[int]) -> tuple[str, tuple]:
    vals = sorted((_v(c) for c in cards), reverse=True)
    flush = len({suit(c) for c in cards}) == 1
    seq_key = None
    if vals == [14, 3, 2]:
        seq_key = 13.5
    elif vals[0] - vals[1] == 1 and vals[1] - vals[2] == 1:
        seq_key = vals[0]
    counts = Counter(vals)
    if len(counts) == 1:
        cat, key = "trail", (vals[0],)
    elif seq_key and flush:
        cat, key = "pure_sequence", (seq_key,)
    elif seq_key:
        cat, key = "sequence", (seq_key,)
    elif flush:
        cat, key = "colour", tuple(vals)
    elif len(counts) == 2:
        pair = next(v for v, n in counts.items() if n == 2)
        kicker = next(v for v, n in counts.items() if n == 1)
        cat, key = "pair", (pair, kicker)
    else:
        cat, key = "high_card", tuple(vals)
    # final tie-break by suit, strongest card first (spades = 3 ... clubs = 0)
    suits = tuple(3 - suit(c) for c in sorted(cards, key=lambda c: (_v(c), 3 - suit(c)), reverse=True))
    return cat, (len(CATEGORIES) - CATEGORIES.index(cat),) + key + suits


@lru_cache
def category_probs() -> tuple[float, ...]:
    c = Counter(evaluate(list(h))[0] for h in itertools.combinations(range(52), 3))
    total = sum(c.values())
    return tuple(c[k] / total for k in CATEGORIES)


def pair_plus_table(rtp: float) -> dict[str, int]:
    return dict(zip(CATEGORIES, fit_table([PAIR_PLUS_SHAPE[k] for k in CATEGORIES], category_probs(), rtp)))


def main_x100(rtp: float) -> int:
    return int(math.floor(2 * rtp * 100 + 1e-9))


class TeenPatti(GameEngine):
    id = "teenpatti"
    name = "Teen Patti"
    category = "Cards"
    tagline = "Player A or Player B: best three cards win."
    default_rtp = 0.97

    def validate(self, params):
        return validate_chips(params, SPOTS)

    def check_amount(self, params, amount):
        check_total(params, amount)

    def floats_needed(self, params):
        return 6

    def resolve(self, floats, params, rtp):
        c = dealt(floats, 6)
        a, b = [c[0], c[2], c[4]], [c[1], c[3], c[5]]
        (ca, ka), (cb, kb) = evaluate(a), evaluate(b)
        winner = "a" if ka > kb else "b"
        ret = {winner: main_x100(rtp), "pair_plus": pair_plus_table(rtp)[ca]}
        payout = settle(params["chips"], ret)
        total = sum(x["amount"] for x in params["chips"])
        return Outcome(payout * 100 // total, {"a": a, "b": b, "a_hand": ca, "b_hand": cb, "winner": winner}, payout=payout)

    def describe(self, rtp):
        return {"spots": list(SPOTS), "main": main_x100(rtp) / 100, "pair_plus": {k: v / 100 for k, v in pair_plus_table(rtp).items()},
                "odds": dict(zip(CATEGORIES, category_probs()))}

    def theoretical_rtp(self, params, rtp):
        pp = expected_return([pair_plus_table(rtp)[k] for k in CATEGORIES], category_probs())
        chips = params.get("chips") or [{"type": "a", "amount": 1}]
        total = sum(c["amount"] for c in chips)
        return sum(c["amount"] * (pp if c["type"] == "pair_plus" else main_x100(rtp) / 200) for c in chips) / total

    def simulate_once(self, rand, params, rtp):
        p = self.validate(params if params.get("chips") else {"chips": [{"type": "a", "amount": 100}]})
        out = self.resolve([rand() for _ in range(6)], p, rtp)
        return out.payout / sum(c["amount"] for c in p["chips"])
