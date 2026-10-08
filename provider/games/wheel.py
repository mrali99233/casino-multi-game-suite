"""Wheel: 30 equal segments; segment = floor(r * 30). Payout shape per risk is fitted to RTP."""

import math

from ..rtp import expected_return, fit_table
from .base import GameEngine, Outcome, pick

SEGMENTS = 30
RISKS = ("low", "medium", "high")
SHAPES = {
    "low": [1.5, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.2, 1.2, 0] * 3,
    "medium": [0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2, 0, 1.5, 0, 5, 0, 1.5, 0, 2, 0, 1.5, 0, 3, 0, 1.5, 0, 2, 0, 1.7],
    "high": [1] + [0] * (SEGMENTS - 1),
}
PROBS = [1 / SEGMENTS] * SEGMENTS


def table(risk: str, rtp: float) -> list[int]:
    return fit_table(SHAPES[risk], PROBS, rtp)


class Wheel(GameEngine):
    id = "wheel"
    name = "Wheel"
    category = "Physics"
    tagline = "30 segments, three risk profiles."
    default_rtp = 0.96

    def validate(self, params):
        return {"risk": pick(params, "risk", RISKS, "medium")}

    def resolve(self, floats, params, rtp):
        seg = int(math.floor(floats[0] * SEGMENTS))
        return Outcome(table(params["risk"], rtp)[seg], {"segment": seg})

    def describe(self, rtp):
        return {"segments": SEGMENTS, "risks": list(RISKS), "tables": {r: table(r, rtp) for r in RISKS}}

    def theoretical_rtp(self, params, rtp):
        return expected_return(table(self.validate(params)["risk"], rtp), PROBS)
