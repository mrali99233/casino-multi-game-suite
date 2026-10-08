"""Payout-table fitting.

Game designers write a *shape* for a payout table (relative multipliers per outcome).
``fit_table`` scales that shape so the expected return equals the target RTP as closely as
possible without exceeding it, with every multiplier rounded down to 0.01x. Multipliers are
returned as integers in hundredths (``x100``) so settlement never touches float money.
"""

import math
from collections.abc import Sequence
from functools import lru_cache


def floor_x100(value: float) -> int:
    return int(math.floor(value * 100 + 1e-9))


def expected_return(table_x100: Sequence[int], probs: Sequence[float]) -> float:
    return sum(m * p for m, p in zip(table_x100, probs)) / 100


@lru_cache(maxsize=512)
def _fit(base: tuple[float, ...], probs: tuple[float, ...], rtp: float) -> tuple[int, ...]:
    def scaled(scale: float) -> list[int]:
        return [floor_x100(m * scale) for m in base]

    raw_ev = sum(m * p for m, p in zip(base, probs))
    if raw_ev <= 0:
        raise ValueError("payout shape must have positive expected value")
    lo, hi = 0.0, 1.5 * rtp / raw_ev
    for _ in range(64):
        mid = (lo + hi) / 2
        if expected_return(scaled(mid), probs) <= rtp + 1e-12:
            lo = mid
        else:
            hi = mid
    table = scaled(lo)

    # Uniform scaling stalls below target because of the 0.01x grid. Top up groups of
    # outcomes that share a base multiplier (keeps symmetric tables symmetric).
    groups: dict[float, list[int]] = {}
    for i, m in enumerate(base):
        if m > 0:
            groups.setdefault(m, []).append(i)
    ordered = sorted(
        ((idx, sum(probs[i] for i in idx)) for idx in groups.values()), key=lambda g: g[1], reverse=True
    )
    current = expected_return(table, probs)
    changed = True
    while changed:
        changed = False
        for idx, p in ordered:
            if current + p * 0.01 <= rtp + 1e-12:
                for i in idx:
                    table[i] += 1
                current += p * 0.01
                changed = True
    return tuple(table)


def fit_table(base: Sequence[float], probs: Sequence[float], rtp: float) -> list[int]:
    return list(_fit(tuple(base), tuple(probs), round(rtp, 6)))
