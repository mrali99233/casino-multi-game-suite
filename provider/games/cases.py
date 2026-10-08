"""Cases: open a case and win one of seven items. Each difficulty has fixed item odds and a
multiplier shape that is fitted to the RTP."""

from ..rtp import expected_return, fit_table
from .base import GameEngine, Outcome, pick

TIERS = {  # (multiplier shape, probability); each shape's expected value is close to 1 before fitting
    "easy": ((0.5, 0.30), (0.8, 0.25), (1.0, 0.20), (1.5, 0.15), (2, 0.07), (5, 0.025), (10, 0.005)),
    "medium": ((0.2, 0.40), (0.6, 0.26), (1.2, 0.17), (2, 0.10), (4, 0.05), (10, 0.017), (50, 0.003)),
    "hard": ((0, 0.45), (0.3, 0.25), (1, 0.15), (2.5, 0.10), (7, 0.04), (25, 0.009), (150, 0.001)),
    "expert": ((0, 0.62), (0.5, 0.18), (1.5, 0.11), (4, 0.06), (12, 0.024), (60, 0.0055), (500, 0.0005)),
}


def table(difficulty: str, rtp: float) -> list[int]:
    shape, probs = zip(*TIERS[difficulty])
    return fit_table(shape, probs, rtp)


class Cases(GameEngine):
    id = "cases"
    name = "Cases"
    category = "Instant"
    tagline = "Open a case. Seven items, one rare jackpot."
    default_rtp = 0.97

    def validate(self, params):
        return {"difficulty": pick(params, "difficulty", tuple(TIERS), "medium")}

    def resolve(self, floats, params, rtp):
        acc, item = 0.0, len(TIERS[params["difficulty"]]) - 1
        for i, (_, p) in enumerate(TIERS[params["difficulty"]]):
            acc += p
            if floats[0] < acc:
                item = i
                break
        return Outcome(table(params["difficulty"], rtp)[item], {"item": item})

    def describe(self, rtp):
        return {d: {"multipliers": [m / 100 for m in table(d, rtp)], "odds": [p for _, p in t]} for d, t in TIERS.items()}

    def theoretical_rtp(self, params, rtp):
        d = self.validate(params)["difficulty"]
        return expected_return(table(d, rtp), [p for _, p in TIERS[d]])
