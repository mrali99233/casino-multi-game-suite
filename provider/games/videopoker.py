"""Video Poker, Jacks or Better: one shuffled deck, five cards dealt, hold any, draw once.

The return depends on the paytable and on the player's holds. RTP picks the standard
full-house/flush paytable whose optimal-strategy return does not exceed it:
9/6 = 99.54%, 9/5 = 98.45%, 8/5 = 97.30%, 7/5 = 96.15%, 6/5 = 95.00%.
"""

from collections import Counter

from .base import ParamError, StatefulEngine, Step
from .cards import rank, shuffled, suit

HANDS = ("royal_flush", "straight_flush", "four_kind", "full_house", "flush", "straight", "three_kind", "two_pair", "jacks_or_better", "nothing")
VARIANTS = ((0.9954, 9, 6), (0.9845, 9, 5), (0.9730, 8, 5), (0.9615, 7, 5), (0.9500, 6, 5))


def variant(rtp: float) -> tuple[float, int, int]:
    for v in VARIANTS:
        if rtp >= v[0] - 1e-9:
            return v
    return VARIANTS[-1]


def paytable(rtp: float) -> dict[str, int]:
    _, fh, fl = variant(rtp)
    return {"royal_flush": 800, "straight_flush": 50, "four_kind": 25, "full_house": fh, "flush": fl, "straight": 4,
            "three_kind": 3, "two_pair": 2, "jacks_or_better": 1, "nothing": 0}


def evaluate(cards: list[int]) -> str:
    vals = sorted((14 if rank(c) == 1 else rank(c) for c in cards), reverse=True)
    counts = sorted(Counter(vals).values(), reverse=True)
    flush = len({suit(c) for c in cards}) == 1
    distinct = len(set(vals)) == 5
    straight = distinct and (vals[0] - vals[4] == 4 or vals == [14, 5, 4, 3, 2])
    if straight and flush:
        return "royal_flush" if vals[4] == 10 else "straight_flush"
    if counts[0] == 4:
        return "four_kind"
    if counts[:2] == [3, 2]:
        return "full_house"
    if flush:
        return "flush"
    if straight:
        return "straight"
    if counts[0] == 3:
        return "three_kind"
    if counts[:2] == [2, 2]:
        return "two_pair"
    if counts[0] == 2:
        pair = next(v for v, n in Counter(vals).items() if n == 2)
        return "jacks_or_better" if pair >= 11 else "nothing"
    return "nothing"


class VideoPoker(StatefulEngine):
    id = "videopoker"
    name = "Video Poker"
    category = "Cards"
    tagline = "Jacks or Better. Hold, draw, win."
    default_rtp = 0.973
    min_rtp = 0.95
    max_rtp = 0.9954

    def validate(self, params):
        return {}

    def floats_needed(self, params):
        return 51

    def start(self, floats, params, rtp):
        deck = shuffled(floats)
        return {"draws": deck[5:10]}, {"hand": deck[:5], "dealt": evaluate(deck[:5])}

    def act(self, secret, state, params, rtp, action):
        hold = action.get("hold")
        if not isinstance(hold, list) or len(hold) != 5 or not all(isinstance(x, bool) for x in hold):
            raise ParamError("'hold' must be a list of five true/false values")
        draws = iter(secret["draws"])
        final = [c if keep else next(draws) for c, keep in zip(state["hand"], hold)]
        hand = evaluate(final)
        mult = paytable(rtp)[hand] * 100
        new = {**state, "held": hold, "final": final, "result": hand}
        return Step(new, "cashout" if mult else "lost", mult)

    def multiplier_x100(self, state, params, rtp):
        return 0

    def view(self, state, params, rtp):
        return {"paytable": paytable(rtp)}

    def describe(self, rtp):
        v = variant(rtp)
        return {"variant": f"{v[1]}/{v[2]}", "paytable": paytable(rtp), "hands": list(HANDS)}

    def theoretical_rtp(self, params, rtp):
        return variant(rtp)[0]

    def simulate_once(self, rand, params, rtp):
        """A simple strategy (made hands, 4-card draws, high pairs, high cards). It trails the
        optimal-strategy figure by a couple of percent."""
        secret, state = self.start([rand() for _ in range(51)], {}, rtp)
        return self.act(secret, state, {}, rtp, {"hold": simple_holds(state["hand"])}).multiplier_x100 / 100


def simple_holds(hand: list[int]) -> list[bool]:
    vals = [14 if rank(c) == 1 else rank(c) for c in hand]
    made = evaluate(hand)
    if made in ("royal_flush", "straight_flush", "four_kind", "full_house", "flush", "straight"):
        return [True] * 5
    counts = Counter(vals)
    if made in ("three_kind", "two_pair", "jacks_or_better"):
        return [counts[v] >= 2 for v in vals]
    suits = Counter(suit(c) for c in hand)
    s, n = suits.most_common(1)[0]
    if n == 4:
        return [suit(c) == s for c in hand]
    if any(n == 2 for n in counts.values()):
        return [counts[v] == 2 for v in vals]
    for lo in range(10, 1, -1):  # four to an open straight
        window = set(range(lo, lo + 4))
        if len(window & set(vals)) == 4:
            seen = set()
            keep = []
            for v in vals:
                keep.append(v in window and v not in seen)
                seen.add(v)
            return keep
    high = [v >= 11 for v in vals]
    if sum(high) > 2:
        best = sorted((v for v in vals if v >= 11))[:2]
        return [v in best for v in vals]
    return high
