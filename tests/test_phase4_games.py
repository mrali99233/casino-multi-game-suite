import random
from collections import Counter

import pytest

from provider.db import SessionLocal
from provider.games import GAMES
from provider.games import cases, chicken, rps, scratch, videoslot
from provider.models import Round
from provider.rtp import expected_return
from provider.sim import simulate

from .conftest import demo_session


def test_video_slot_line_odds_match_brute_force():
    """The closed-form line probabilities agree with spinning real reel strips."""
    rnd = random.Random(3)
    pt = {p: 1 for p in videoslot.PRIZES}
    counts = Counter()
    n = 300_000
    for _ in range(n):
        res = videoslot.spin([rnd.randrange(videoslot.STRIP) for _ in range(5)], pt, 1)
        for w in res["wins"]:
            counts[(w["symbol"], w["count"])] += 1
    rates = dict(zip(videoslot.PRIZES, videoslot.line_rates()))
    for prize in [("ten", 3), ("jack", 3), ("bell", 3), ("ten", 4)]:
        assert counts[prize] / n == pytest.approx(rates[prize], rel=0.08), prize
    assert sum(counts.values()) / n == pytest.approx(sum(rates.values()), rel=0.02)


@pytest.mark.parametrize("rtp", [0.92, 0.96, 0.99])
def test_video_slot_fits_rtp_and_pays_free_spins(rtp):
    assert rtp - 0.002 <= videoslot.theoretical(rtp) <= rtp + 1e-9
    # force three scatters on the base spin: put each reel's scatter in its window
    floats = []
    for r in range(5):
        stop = videoslot.STRIPS[r].index("scatter") if r < 3 else (videoslot.STRIPS[r].index("scatter") + 10) % videoslot.STRIP
        floats.append((stop + 0.5) / videoslot.STRIP)
    floats += [0.5] * 50
    out = GAMES["videoslot"].resolve(floats, {}, rtp)
    assert out.result["base"]["scatters"] >= 3 and len(out.result["free_spins"]) == 10


def test_scratch_cards_show_exactly_their_prize():
    rnd = random.Random(8)
    for _ in range(3000):
        prize, cells = scratch.build_card([rnd.random() for _ in range(18)])
        c = Counter(cells)
        triples = [s for s, n in c.items() if n >= 3]
        assert len(cells) == 9 and max(c.values()) <= 3
        assert triples == ([prize] if prize != "none" else [])
    assert 0.969 <= expected_return(list(scratch.prizes(0.97).values()), scratch.PROBS) <= 0.97 + 1e-9


@pytest.mark.parametrize("difficulty", list(cases.TIERS))
def test_cases_tables(difficulty):
    t = cases.table(difficulty, 0.97)
    assert t == sorted(t)
    assert 0.969 <= GAMES["cases"].theoretical_rtp({"difficulty": difficulty}, 0.97) <= 0.97 + 1e-9


@pytest.mark.parametrize("game,params,tol", [
    ("videoslot", {}, 0.02),
    ("chicken", {"difficulty": "medium", "lanes": 4}, 0.004),
    ("scratch", {}, 0.02),
    ("cases", {"difficulty": "medium"}, 0.006),
    ("rps", {"wins": 2}, 0.004),
])
def test_phase4_simulations_converge(game, params, tol):
    res = simulate(game, params, 150_000, GAMES[game].default_rtp, seed=29)
    assert abs(res["simulated_rtp"] - res["theoretical_rtp"]) < 4 * res["std_error"] + tol, res


def test_instant_phase4_games_over_api(client):
    for game, params in [("videoslot", {}), ("scratch", {}), ("cases", {"difficulty": "hard"})]:
        h = demo_session(client, game)
        d = client.post("/api/v1/client/bet", json={"amount": 200, "params": params}, headers=h).json()
        assert d["balance"] == 100_000 - 200 + d["payout"], (game, d)


def test_chicken_road_over_api(client):
    h = demo_session(client, "chicken")
    s = client.post("/api/v1/client/round/start", json={"amount": 1000, "params": {"difficulty": "easy"}}, headers=h).json()
    with SessionLocal() as db:
        hit = db.get(Round, s["round_id"]).secret["hit_lane"]
    r = s
    for lane in range(3):
        r = client.post("/api/v1/client/round/act", json={"action": {"move": "go"}}, headers=h).json()
        if hit == lane:
            assert r["status"] == "settled" and r["payout"] == 0 and r["result"]["hit"] == lane
            return
    assert r["cashout_multiplier"] == chicken.multiplier_x100("easy", 3, 0.97) / 100
    cash = client.post("/api/v1/client/round/cashout", headers=h).json()
    assert cash["payout"] == 1000 * chicken.multiplier_x100("easy", 3, 0.97) // 100


def test_rps_streak_over_api(client):
    h = demo_session(client, "rps")
    s = client.post("/api/v1/client/round/start", json={"amount": 1000, "params": {}}, headers=h).json()
    with SessionLocal() as db:
        house = db.get(Round, s["round_id"]).secret["house"]
    beat = {v: k for k, v in rps.BEATS.items()}  # hand that beats v
    r = client.post("/api/v1/client/round/act", json={"action": {"pick": house[0]}}, headers=h).json()
    assert r["result"]["history"][0]["outcome"] == "draw" and r["cashout_multiplier"] == 0
    r = client.post("/api/v1/client/round/act", json={"action": {"pick": beat[house[1]]}}, headers=h).json()
    assert r["result"]["wins"] == 1 and r["cashout_multiplier"] == 1.94
    cash = client.post("/api/v1/client/round/cashout", headers=h).json()
    assert cash["payout"] == 1940
