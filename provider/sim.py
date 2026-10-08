"""Monte Carlo simulator. Plays the real engine code with a seeded PRNG.

    python -m provider.sim plinko --rounds 1000000 -p rows=16 -p risk=high --rtp 0.97
    python -m provider.sim mines -p mines=3 -p picks=5
    python -m provider.sim crash -p cashout=2
    python -m provider.sim keno -p 'numbers=[3,7,19,22,31]' -p risk=high
"""

import argparse
import json
import math
import random
import time

from .games import GAMES


def simulate(game_id: str, params: dict, rounds: int, rtp: float, seed: int | None = None) -> dict:
    engine = GAMES[game_id]
    rand = random.Random(seed).random
    total = total_sq = best = staked = 0.0
    hits = 0
    for _ in range(rounds):
        out = engine.simulate_once(rand, params, rtp)
        m, stake = out if isinstance(out, tuple) else (out, 1)
        total += m
        total_sq += m * m
        staked += stake
        hits += m > 0
        best = max(best, m / stake)
    mean = total / staked  # RTP = everything returned / everything staked
    per_round = total / rounds
    sd = math.sqrt(max(0.0, total_sq / rounds - per_round * per_round)) * rounds / staked
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
    params = {}
    for kv in a.param:
        key, raw = kv.split("=", 1)
        try:
            params[key] = json.loads(raw)
        except ValueError:
            params[key] = raw
    engine = GAMES[a.game]
    t0 = time.time()
    res = simulate(a.game, params, a.rounds, a.rtp or engine.default_rtp, a.seed)
    for k, v in res.items():
        print(f"{k:>16}: {v}")
    print(f"{'elapsed':>16}: {time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
