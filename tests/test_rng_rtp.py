import math

import pytest

from provider import rng
from provider.games import GAMES
from provider.games import dice, mines, plinko, wheel
from provider.games.crash import crash_point_x100
from provider.rtp import expected_return
from provider.sim import simulate


def test_floats_are_deterministic_and_in_range():
    a = rng.floats("server", "client", 7, 30)
    assert a == rng.floats("server", "client", 7, 30)
    assert a != rng.floats("server", "client", 8, 30)
    assert len(a) == 30 and all(0 <= f < 1 for f in a)
    # first float = first 4 HMAC bytes as base-256 fraction
    d = rng.digest("server", "client", 7, 0)
    assert a[0] == pytest.approx(d[0] / 256 + d[1] / 256**2 + d[2] / 256**3 + d[3] / 256**4)


@pytest.mark.parametrize("rtp", [0.90, 0.95, 0.97, 0.99])
def test_plinko_tables_hit_target_without_exceeding(rtp):
    for rows in plinko.ROWS:
        for risk in plinko.RISKS:
            t = plinko.table(rows, risk, rtp)
            ev = expected_return(t, plinko.bucket_probs(rows))
            assert ev <= rtp + 1e-9
            assert rtp - ev < 0.001, (rows, risk, ev)
            assert t == t[::-1], "table must stay symmetric"


@pytest.mark.parametrize("risk", wheel.RISKS)
def test_wheel_tables(risk):
    ev = expected_return(wheel.table(risk, 0.96), wheel.PROBS)
    assert 0.959 <= ev <= 0.96 + 1e-9


def test_dice_multiplier_never_exceeds_rtp():
    for target in range(100, 9801, 37):
        for cond in ("under", "over"):
            n = dice.win_count(target, cond)
            if 100 <= n <= 9800:
                assert dice.multiplier_x100(target, cond, 0.99) / 100 * n / dice.OUTCOMES <= 0.99 + 1e-9


def test_mines_layout_and_ladder():
    f = rng.floats("s", "c", 1, 24)
    lay = mines.layout(f, 5)
    assert len(lay) == 5 == len(set(lay)) and all(0 <= t < 25 for t in lay)
    for n in (1, 3, 10, 24):
        for k in range(1, 26 - n):
            ret = mines.multiplier_x100(n, k, 0.97) / 100 * math.comb(25 - n, k) / math.comb(25, k)
            assert ret <= 0.97 + 1e-9


def test_crash_point_distribution_matches_rtp():
    assert crash_point_x100(0.0, 0.97) == 100  # 0.97 floors to the 1.00x minimum
    assert crash_point_x100(0.5, 0.97) == 194
    for target in (1.5, 2, 10):
        res = simulate("crash", {"cashout": target}, 200_000, 0.97, seed=11)
        assert abs(res["simulated_rtp"] - 0.97) < 4 * res["std_error"] + 0.002


@pytest.mark.parametrize("game,params", [
    ("plinko", {"rows": 12, "risk": "medium"}),
    ("dice", {"target": 50.5, "condition": "over"}),
    ("wheel", {"risk": "low"}),
    ("mines", {"mines": 3, "picks": 4}),
])
def test_simulation_converges(game, params):
    res = simulate(game, params, 150_000, GAMES[game].default_rtp, seed=5)
    assert abs(res["simulated_rtp"] - res["theoretical_rtp"]) < 4 * res["std_error"] + 0.002
