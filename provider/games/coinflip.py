"""Coin Flip: heads if r < 0.5. A correct call pays floor(2 x RTP, 0.01x)."""

import math

from .base import GameEngine, Outcome, pick


def payout_x100(rtp: float) -> int:
    return int(math.floor(2 * rtp * 100 + 1e-9))


class CoinFlip(GameEngine):
    id = "coinflip"
    name = "Coin Flip"
    category = "Instant"
    tagline = "Heads or tails. Nearly double."
    default_rtp = 0.98

    def validate(self, params):
        return {"side": pick(params, "side", ("heads", "tails"), "heads")}

    def resolve(self, floats, params, rtp):
        side = "heads" if floats[0] < 0.5 else "tails"
        win = side == params["side"]
        return Outcome(payout_x100(rtp) if win else 0, {"side": side, "win": win})

    def describe(self, rtp):
        return {"multiplier": payout_x100(rtp) / 100}

    def theoretical_rtp(self, params, rtp):
        return payout_x100(rtp) / 200
