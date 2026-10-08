"""Blackjack: infinite shoe, dealer stands on all 17s, double on any first two cards,
one split (split aces receive one card each), dealer peeks for blackjack, no insurance.

Return depends on the rules, not on a payout table. RTP selects the blackjack payout:
3:2 (about 99.5% with basic strategy) or 6:5 (about 98.1%).
"""

import copy

from .base import ParamError, StatefulEngine, Step
from .cards import rank, shoe

SHOE = 40
VARIANTS = ((0.995, 250, "3:2"), (0.981, 220, "6:5"))  # (rtp, blackjack return x100, label)
MOVES = ("hit", "stand", "double", "split")


def card_value(card: int) -> int:
    return min(rank(card), 10)


def total(cards: list[int]) -> tuple[int, bool]:
    t = sum(card_value(c) for c in cards)
    if any(rank(c) == 1 for c in cards) and t + 10 <= 21:
        return t + 10, True
    return t, False


def is_blackjack(cards: list[int]) -> bool:
    return len(cards) == 2 and total(cards)[0] == 21


def variant(rtp: float) -> tuple[float, int, str]:
    for v in VARIANTS:
        if rtp >= v[0] - 1e-9:
            return v
    return VARIANTS[-1]


class Blackjack(StatefulEngine):
    id = "blackjack"
    name = "Blackjack"
    category = "Cards"
    tagline = "Beat the dealer to 21."
    default_rtp = max_rtp = 0.995
    min_rtp = 0.981

    def validate(self, params):
        return {}

    def floats_needed(self, params):
        return SHOE

    def start(self, floats, params, rtp):
        s = shoe(floats)
        state = {"dealer": [s[1]], "hands": [{"cards": [s[0], s[2]], "units": 1, "done": False, "result": None}],
                 "active": 0, "next": 4, "phase": "player"}
        return {"shoe": s}, state

    def settle_on_start(self, secret, state, params, rtp):
        s = secret["shoe"]
        player, dealer = state["hands"][0]["cards"], [s[1], s[3]]
        pbj, dbj = is_blackjack(player), is_blackjack(dealer)
        if not (pbj or dbj):
            return None
        st = copy.deepcopy(state)
        st |= {"dealer": dealer, "phase": "done", "dealer_total": 21 if dbj else total(dealer)[0]}
        hand = st["hands"][0]
        hand["done"] = True
        if pbj and dbj:
            hand["result"] = "push"
            return Step(st, "cashout", 100)
        if pbj:
            hand["result"] = "blackjack"
            return Step(st, "cashout", variant(rtp)[1])
        hand["result"] = "lose"
        return Step(st, "lost")

    def _allowed(self, state) -> list[str]:
        if state["phase"] != "player":
            return []
        h = state["hands"][state["active"]]
        moves = ["hit", "stand"]
        if len(h["cards"]) == 2 and not h.get("split_aces"):
            moves.append("double")
            if len(state["hands"]) == 1 and card_value(h["cards"][0]) == card_value(h["cards"][1]):
                moves.append("split")
        return moves

    def extra_units(self, state, params, action):
        move = action.get("move")
        if move not in MOVES:
            raise ParamError(f"'move' must be one of {list(MOVES)}")
        if move not in self._allowed(state):
            raise ParamError(f"You cannot {move} now")
        return 1 if move in ("double", "split") else 0

    def act(self, secret, state, params, rtp, action):
        self.extra_units(state, params, action)
        s = secret["shoe"]
        st = copy.deepcopy(state)

        def draw() -> int:
            c = s[st["next"]]
            st["next"] += 1
            return c

        h = st["hands"][st["active"]]
        move = action["move"]
        if move == "hit":
            h["cards"].append(draw())
        elif move == "stand":
            h["done"] = True
        elif move == "double":
            h["units"] = 2
            h["doubled"] = True
            h["cards"].append(draw())
            h["done"] = True
        else:  # split
            c0, c1 = h["cards"]
            aces = rank(c0) == 1
            st["hands"] = [
                {"cards": [c0, draw()], "units": 1, "done": aces, "result": None, "split": True, "split_aces": aces},
                {"cards": [c1, draw()], "units": 1, "done": aces, "result": None, "split": True, "split_aces": aces},
            ]
        for hand in st["hands"]:
            t = total(hand["cards"])[0]
            if t > 21:
                hand["done"], hand["result"] = True, "bust"
            elif t == 21:
                hand["done"] = True
        while st["active"] < len(st["hands"]) and st["hands"][st["active"]]["done"]:
            st["active"] += 1
        if st["active"] < len(st["hands"]):
            return Step(st, "continue")

        # dealer plays
        dealer = [s[1], s[3]]
        if any(hd["result"] != "bust" for hd in st["hands"]):
            while total(dealer)[0] < 17:
                dealer.append(draw())
        dt = total(dealer)[0]
        units_x100 = 0
        for hd in st["hands"]:
            pt = total(hd["cards"])[0]
            if hd["result"] == "bust":
                continue
            if dt > 21 or pt > dt:
                hd["result"] = "win"
                units_x100 += hd["units"] * 200
            elif pt == dt:
                hd["result"] = "push"
                units_x100 += hd["units"] * 100
            else:
                hd["result"] = "lose"
        st |= {"dealer": dealer, "dealer_total": dt, "phase": "done", "active": len(st["hands"]) - 1}
        return Step(st, "cashout" if units_x100 else "lost", units_x100)

    def multiplier_x100(self, state, params, rtp):
        return 0  # no early cash-out in blackjack

    def view(self, state, params, rtp):
        return {
            "totals": [total(h["cards"]) for h in state["hands"]],
            "dealer_total": total(state["dealer"]),
            "actions": self._allowed(state),
        }

    def describe(self, rtp):
        v = variant(rtp)
        return {"blackjack_pays": v[2], "rules": ["Dealer stands on all 17s", "Double on any first two cards",
                                                   "Split once; split aces get one card", f"Blackjack pays {v[2]}"]}

    def theoretical_rtp(self, params, rtp):
        return variant(rtp)[0]

    def simulate_once(self, rand, params, rtp):
        """Basic strategy (S17, double after split). Returns (returned, staked) in opening-bet units
        so the simulator can weight doubled and split rounds correctly."""
        secret, state = self.start([rand() for _ in range(SHOE)], {}, rtp)
        step = self.settle_on_start(secret, state, {}, rtp)
        staked = 1
        while step is None or step.status == "continue":
            st = state if step is None else step.state
            h = st["hands"][st["active"]]
            move = basic_strategy(h["cards"], st["dealer"][0], self._allowed(st))
            staked += self.extra_units(st, {}, {"move": move})
            step = self.act(secret, st, {}, rtp, {"move": move})
        return step.multiplier_x100 / 100, staked


def basic_strategy(cards: list[int], dealer_up: int, allowed: list[str]) -> str:
    up = card_value(dealer_up)
    up = 11 if up == 1 else up
    t, soft = total(cards)
    can_double = "double" in allowed
    if "split" in allowed:
        v = card_value(cards[0])
        v = 11 if v == 1 else v
        split = {11: True, 8: True, 9: up in (2, 3, 4, 5, 6, 8, 9), 7: up <= 7, 6: up <= 6, 4: up in (5, 6), 3: up <= 7, 2: up <= 7}
        if split.get(v):
            return "split"
    if soft:
        if t >= 19:
            return "stand"
        if t == 18:
            if 3 <= up <= 6:
                return "double" if can_double else "stand"
            return "stand" if up in (2, 7, 8) else "hit"
        lo = {17: 3, 16: 4, 15: 4, 14: 5, 13: 5}.get(t, 99)
        return "double" if can_double and lo <= up <= 6 else "hit"
    if t >= 17:
        return "stand"
    if t >= 13:
        return "stand" if up <= 6 else "hit"
    if t == 12:
        return "stand" if 4 <= up <= 6 else "hit"
    if t == 11:
        return "double" if can_double and up <= 10 else "hit"
    if t == 10:
        return "double" if can_double and up <= 9 else "hit"
    if t == 9:
        return "double" if can_double and 3 <= up <= 6 else "hit"
    return "hit"
