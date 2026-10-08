"""Monte Carlo simulator. Plays the real engine code with a seeded PRNG.

    python -m provider.sim plinko --rounds 1000000 -p rows=16 -p risk=high --rtp 0.97
    python -m provider.sim mines -p mines=3 -p picks=5
    python -m provider.sim crash -p cashout=2
"""

import argparse
import math
import random
import time

from .games import GAMES
from .games import mines as mines_math
from .games.crash import crash_point_x100


def simulate(game_id: str, params: dict, rounds: int, rtp: float, seed: int | None = None) -> dict:
    engine = GAMES[game_id]
    rnd = random.Random(seed)
    total = 0.0
    total_sq = 0.0
    hits = 0
    best = 0.0
    if game_id == "crash":
        target = int(round(float(params.get("cashout", 2.0)) * 100))
        for _ in range(rounds):
            m = target / 100 if crash_point_x100(rnd.random(), rtp) >= target else 0.0
            total += m
            total_sq += m * m
            hits += m > 0
            best = max(best, m)
    elif game_id == "mines":
        p = engine.validate(params)
        n, picks = p["mines"], int(params.get("picks", 3))
        if not 1 <= picks <= 25 - n:
            raise ValueError(f"picks must be 1..{25 - n}")
        payout = mines_math.multiplier_x100(n, picks, rtp) / 100
        for _ in range(rounds):
            mines = set(mines_math.layout([rnd.random() for _ in range(24)], n))
            safe = [t for t in range(25) if t not in mines]
            ok = all(t in safe for t in rnd.sample(range(25), picks))
            m = payout if ok else 0.0
            total += m
            total_sq += m * m
            hits += ok
            best = max(best, m)
    else:
        p = engine.validate(params)
        need = engine.floats_needed(p)
        for _ in range(rounds):
            m = engine.resolve([rnd.random() for _ in range(need)], p, rtp).multiplier_x100 / 100
            total += m
            total_sq += m * m
            hits += m > 0
            best = max(best, m)
    mean = total / rounds
    sd = math.sqrt(max(0.0, total_sq / rounds - mean * mean))
    return {
        "game_id": game_id,
        "params": params,
        "rounds": rounds,
        "target_rtp": rtp,
        "theoretical_rtp": round(engine.theoretical_rtp(params, rtp), 6),
        "simulated_rtp": round(mean, 6),
        "std_error": round(sd / math.sqrt(rounds), 6),
        "hit_rate": round(hits / rounds, 6),
        "max_multiplier": best,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Monte Carlo RTP check for Casino Matrix games")
    ap.add_argument("game", choices=sorted(GAMES))
    ap.add_argument("--rounds", type=int, default=200_000)
    ap.add_argument("--rtp", type=float, default=None)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("-p", "--param", action="append", default=[], help="key=value, repeatable")
    a = ap.parse_args()
    params = dict(kv.split("=", 1) for kv in a.param)
    engine = GAMES[a.game]
    t0 = time.time()
    res = simulate(a.game, params, a.rounds, a.rtp or engine.default_rtp, a.seed)
    for k, v in res.items():
        print(f"{k:>16}: {v}")
    print(f"{'elapsed':>16}: {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
