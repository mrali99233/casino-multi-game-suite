"""HiLo: guess whether the next card is strictly higher or lower (A low, K high; ties lose).

Cards are drawn uniformly from 52 (an infinite shoe). After correct guesses with chances
p1..pk the cash-out multiplier is RTP / (p1 x ... x pk), so every stopping point returns RTP.
The 52 draws of the round are fixed at the start from the seeded floats.
"""

import math
from fractions import Fraction

from .base import ParamError, StatefulEngine, Step, pick

DECK = 52
RANKS = 13  # 1 = Ace ... 13 = King


def rank(card: int) -> int:
    return card % RANKS + 1


def chance(guess: str, r: int) -> Fraction:
    return Fraction(RANKS - r, RANKS) if guess == "higher" else Fraction(r - 1, RANKS)


def _mult(num: int, den: int, rtp: float) -> int:
    return int(math.floor(rtp * num / den * 100 + 1e-9))


class HiLo(StatefulEngine):
    id = "hilo"
    name = "HiLo"
    category = "Cards"
    tagline = "Higher or lower? Build a streak."
    default_rtp = 0.97

    def validate(self, params):
        return {}

    def floats_needed(self, params):
        return DECK

    def start(self, floats, params, rtp):
        cards = [int(math.floor(f * DECK)) for f in floats[:DECK]]
        return {"cards": cards}, {"pos": 0, "card": cards[0], "history": [], "num": 1, "den": 1, "streak": 0}

    def act(self, secret, state, params, rtp, action):
        guess = pick(action, "guess", ("higher", "lower", "skip"), None)
        pos, cur = state["pos"], rank(state["card"])
        if pos >= DECK - 2 and guess == "skip":
            raise ParamError("No skips left in this round")
        nxt = secret["cards"][pos + 1]
        entry = {"card": nxt, "guess": guess, "from": state["card"]}
        new = {**state, "pos": pos + 1, "card": nxt, "history": state["history"] + [entry]}
        if guess == "skip":
            return Step(new, "continue", self.multiplier_x100(new, params, rtp))
        p = chance(guess, cur)
        if p == 0:
            raise ParamError(f"Cannot guess {guess} on this card")
        won = rank(nxt) > cur if guess == "higher" else rank(nxt) < cur
        if not won:
            entry["won"] = False
            return Step(new, "lost")
        entry["won"] = True
        new |= {"num": state["num"] * p.denominator, "den": state["den"] * p.numerator, "streak": state["streak"] + 1}
        mult = _mult(new["num"], new["den"], rtp)
        return Step(new, "cashout" if new["pos"] >= DECK - 1 else "continue", mult)

    def multiplier_x100(self, state, params, rtp):
        return _mult(state["num"], state["den"], rtp) if state["streak"] else 0

    def view(self, state, params, rtp):
        r = rank(state["card"])
        out = {}
        for g in ("higher", "lower"):
            p = chance(g, r)
            out[g] = {"chance": float(p), "multiplier": _mult(state["num"] * p.denominator, state["den"] * p.numerator, rtp) / 100 if p else None}
        return {"options": out, "skips_left": max(0, DECK - 2 - state["pos"])}

    def theoretical_rtp(self, params, rtp):
        return rtp

    def simulate_once(self, rand, params, rtp):
        """Strategy: always take the likelier side, stop after ``streak`` wins (default 3)."""
        goal = int(params.get("streak", 3))
        num = den = 1
        r = rank(int(rand() * DECK))
        for _ in range(goal):
            g = "higher" if r <= 7 else "lower"
            p = chance(g, r)
            n = rank(int(rand() * DECK))
            if not (n > r if g == "higher" else n < r):
                return 0.0
            num, den, r = num * p.denominator, den * p.numerator, n
        return _mult(num, den, rtp) / 100
