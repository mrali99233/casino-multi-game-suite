"""Punto banco baccarat from an infinite shoe with standard third-card rules.

Payouts are the classic ones (Player 1:1, Banker 0.95:1, Tie 8:1, pairs 11:1; Player and Banker
bets push on a tie), so the return is fixed by the rules: about 98.9% on Banker.
"""

import itertools
from functools import lru_cache

from .base import GameEngine, Outcome
from .cards import rank, shoe
from .chips import check_total, settle, validate_chips

SPOTS = ("player", "banker", "tie", "player_pair", "banker_pair")
PAIR_X100 = 1200
TIE_X100 = 900
BANKER_X100 = 195
VALUE_P = [4 / 13] + [1 / 13] * 9  # baccarat value 0..9 from an infinite shoe


def value(card: int) -> int:
    return min(rank(card), 10) % 10


def banker_draws(bt: int, p3: int | None) -> bool:
    if p3 is None:
        return bt <= 5
    return bt <= 2 or (bt == 3 and p3 != 8) or (bt == 4 and 2 <= p3 <= 7) or (bt == 5 and 4 <= p3 <= 7) or (bt == 6 and p3 in (6, 7))


def play(cards: list[int]) -> tuple[list[int], list[int]]:
    """Deal from ``cards`` in order: P, B, P, B, then third cards as the rules require."""
    player, banker = [cards[0], cards[2]], [cards[1], cards[3]]
    nxt = 4
    pt, bt = sum(map(value, player)) % 10, sum(map(value, banker)) % 10
    if pt >= 8 or bt >= 8:
        return player, banker
    p3 = None
    if pt <= 5:
        player.append(cards[nxt])
        p3 = value(cards[nxt])
        nxt += 1
    if banker_draws(bt, p3):
        banker.append(cards[nxt])
    return player, banker


@lru_cache
def outcome_probs() -> dict[str, float]:
    """Exact P(player), P(banker), P(tie) from the value distribution."""
    two = [0.0] * 10
    for a, b in itertools.product(range(10), repeat=2):
        two[(a + b) % 10] += VALUE_P[a] * VALUE_P[b]
    res = {"player": 0.0, "banker": 0.0, "tie": 0.0}

    def record(p, b, w):
        res["player" if p > b else "banker" if b > p else "tie"] += w

    for pt, bt in itertools.product(range(10), repeat=2):
        w = two[pt] * two[bt]
        if pt >= 8 or bt >= 8:
            record(pt, bt, w)
            continue
        if pt <= 5:
            for p3 in range(10):
                p_final = (pt + p3) % 10
                if banker_draws(bt, p3):
                    for b3 in range(10):
                        record(p_final, (bt + b3) % 10, w * VALUE_P[p3] * VALUE_P[b3])
                else:
                    record(p_final, bt, w * VALUE_P[p3])
        elif banker_draws(bt, None):
            for b3 in range(10):
                record(pt, (bt + b3) % 10, w * VALUE_P[b3])
        else:
            record(pt, bt, w)
    return res


def spot_returns(winner: str, player_pair: bool, banker_pair: bool) -> dict[str, int]:
    return {
        "player": 200 if winner == "player" else 100 if winner == "tie" else 0,
        "banker": BANKER_X100 if winner == "banker" else 100 if winner == "tie" else 0,
        "tie": TIE_X100 if winner == "tie" else 0,
        "player_pair": PAIR_X100 if player_pair else 0,
        "banker_pair": PAIR_X100 if banker_pair else 0,
    }


def spot_rtp(spot: str) -> float:
    p = outcome_probs()
    return {
        "player": 2 * p["player"] + p["tie"],
        "banker": BANKER_X100 / 100 * p["banker"] + p["tie"],
        "tie": TIE_X100 / 100 * p["tie"],
        "player_pair": PAIR_X100 / 100 / 13,
        "banker_pair": PAIR_X100 / 100 / 13,
    }[spot]


class Baccarat(GameEngine):
    id = "baccarat"
    name = "Baccarat"
    category = "Cards"
    tagline = "Player, Banker or Tie. Classic punto banco."
    default_rtp = min_rtp = max_rtp = 0.989

    def validate(self, params):
        return validate_chips(params, SPOTS)

    def check_amount(self, params, amount):
        check_total(params, amount)

    def floats_needed(self, params):
        return 6

    def resolve(self, floats, params, rtp):
        cards = shoe(floats[:6])
        player, banker = play(cards)
        pt, bt = sum(map(value, player)) % 10, sum(map(value, banker)) % 10
        winner = "player" if pt > bt else "banker" if bt > pt else "tie"
        pp, bp = rank(player[0]) == rank(player[1]), rank(banker[0]) == rank(banker[1])
        payout = settle(params["chips"], spot_returns(winner, pp, bp))
        total = sum(c["amount"] for c in params["chips"])
        return Outcome(payout * 100 // total, {"player": player, "banker": banker, "player_total": pt, "banker_total": bt,
                                                "winner": winner, "player_pair": pp, "banker_pair": bp}, payout=payout)

    def describe(self, rtp):
        return {"spots": list(SPOTS), "returns": {"player": 2, "banker": BANKER_X100 / 100, "tie": TIE_X100 / 100, "pair": PAIR_X100 / 100},
                "spot_rtp": {s: round(spot_rtp(s), 5) for s in SPOTS}, "odds": outcome_probs()}

    def theoretical_rtp(self, params, rtp):
        p = self.validate(params if params.get("chips") else {"chips": [{"type": "banker", "amount": 100}]})
        total = sum(c["amount"] for c in p["chips"])
        return sum(c["amount"] * spot_rtp(c["type"]) for c in p["chips"]) / total

    def simulate_once(self, rand, params, rtp):
        p = self.validate(params if params.get("chips") else {"chips": [{"type": "banker", "amount": 100}]})
        out = self.resolve([rand() for _ in range(6)], p, rtp)
        return out.payout / sum(c["amount"] for c in p["chips"])
