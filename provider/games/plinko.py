"""Plinko: a ball falls through ``rows`` peg rows, going left or right with p = 1/2 each.

Bucket k (number of right bounces) has probability C(rows, k) / 2^rows. The payout table
is the risk profile's shape fitted to the target RTP (see ``rtp.fit_table``).
"""

from functools import lru_cache
from math import comb

from ..rtp import expected_return, fit_table
from .base import GameEngine, Outcome, ParamError, pick

ROWS = (8, 10, 12, 14, 16)
RISKS = ("low", "medium", "high")

SHAPES: dict[int, dict[str, list[float]]] = {
    8: {
        "low": [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
        "medium": [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
        "high": [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    },
    10: {
        "low": [8.9, 3, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 3, 8.9],
        "medium": [22, 5, 2, 1.4, 0.6, 0.4, 0.6, 1.4, 2, 5, 22],
        "high": [76, 10, 3, 0.9, 0.3, 0.2, 0.3, 0.9, 3, 10, 76],
    },
    12: {
        "low": [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
        "medium": [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
        "high": [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
    },
    14: {
        "low": [7.1, 4, 1.9, 1.4, 1.3, 1.1, 1, 0.5, 1, 1.1, 1.3, 1.4, 1.9, 4, 7.1],
        "medium": [58, 15, 7, 4, 1.9, 1, 0.5, 0.2, 0.5, 1, 1.9, 4, 7, 15, 58],
        "high": [420, 56, 18, 5, 1.9, 0.3, 0.2, 0.2, 0.2, 0.3, 1.9, 5, 18, 56, 420],
    },
    16: {
        "low": [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
        "medium": [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
        "high": [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
    },
}


@lru_cache
def bucket_probs(rows: int) -> tuple[float, ...]:
    return tuple(comb(rows, k) / 2**rows for k in range(rows + 1))


def table(rows: int, risk: str, rtp: float) -> list[int]:
    return fit_table(SHAPES[rows][risk], bucket_probs(rows), rtp)


class Plinko(GameEngine):
    id = "plinko"
    name = "Plinko"
    category = "Physics"
    tagline = "Drop the ball. Up to 1,000×."
    default_max_bet = 50_000

    def validate(self, params):
        try:
            rows = int(params.get("rows", 12))
        except (TypeError, ValueError):
            raise ParamError("'rows' must be a number") from None
        if rows not in ROWS:
            raise ParamError(f"'rows' must be one of {list(ROWS)}")
        return {"rows": rows, "risk": pick(params, "risk", RISKS, "medium")}

    def floats_needed(self, params):
        return params["rows"]

    def resolve(self, floats, params, rtp):
        rows, risk = params["rows"], params["risk"]
        path = [1 if f >= 0.5 else 0 for f in floats[:rows]]
        bucket = sum(path)
        return Outcome(table(rows, risk, rtp)[bucket], {"path": path, "bucket": bucket})

    def describe(self, rtp):
        return {
            "rows": list(ROWS),
            "risks": list(RISKS),
            "tables": {str(r): {k: table(r, k, rtp) for k in RISKS} for r in ROWS},
        }

    def theoretical_rtp(self, params, rtp):
        p = self.validate(params)
        return expected_return(table(p["rows"], p["risk"], rtp), bucket_probs(p["rows"]))
