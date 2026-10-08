import pytest

from provider.db import SessionLocal
from provider.games import GAMES
from provider.games import diamonds, hilo, keno, roulette, slots, tower
from provider.models import Round
from provider.rtp import expected_return
from provider.sim import simulate

from .conftest import demo_session


@pytest.mark.parametrize("risk", keno.RISKS)
def test_keno_tables_fit_rtp_and_increase(risk):
    for picks in range(1, 11):
        t = keno.table(picks, risk, 0.97)
        ev = expected_return(t, keno.hit_probs(picks))
        assert 0.969 <= ev <= 0.97 + 1e-9, (picks, risk, ev)
        paying = [m for m in t if m > 0]
        assert paying == sorted(paying), (picks, risk, t)


def test_slots_and_diamonds_fit_rtp():
    assert 0.959 <= GAMES["slots"].theoretical_rtp({}, 0.96) <= 0.96 + 1e-9
    assert 0.979 <= GAMES["diamonds"].theoretical_rtp({}, 0.98) <= 0.98 + 1e-9
    assert sum(diamonds.pattern_probs()) == pytest.approx(1)
    assert diamonds.pattern([1, 1, 1, 2, 2]) == "full" and diamonds.pattern([0, 1, 2, 3, 4]) == "none"
    assert slots.line_prize("wild", "seven", "seven") == "seven"
    assert slots.line_prize("cherry", "wild", "bar") == "cherry_pair"
    assert slots.line_prize("wild", "wild", "wild") == "wild"


def test_roulette_payouts():
    chips = {"chips": [{"type": "straight", "value": 17, "amount": 100}, {"type": "red", "amount": 200}, {"type": "column", "value": 2, "amount": 50}]}
    p = GAMES["roulette"].validate(chips)
    f17 = (17 + 0.5) / 37
    out = GAMES["roulette"].resolve([f17], p, 0.973)
    # 17 is black, column 2
    assert out.result["number"] == 17 and out.payout == 100 * 36 + 50 * 3
    zero = GAMES["roulette"].resolve([0.0], p, 0.973)
    assert zero.result["number"] == 0 and zero.payout == 0
    assert all(roulette.wins({"type": "dozen", "value": 3}, n) for n in range(25, 37))


@pytest.mark.parametrize("game,params", [
    ("limbo", {"target": 3}),
    ("coinflip", {"side": "tails"}),
    ("diamonds", {}),
    ("keno", {"numbers": [1, 5, 9, 13, 22], "risk": "medium"}),
    ("slots", {}),
    ("hilo", {"streak": 3}),
    ("tower", {"difficulty": "medium", "rows": 3}),
    ("roulette", {}),
])
def test_phase2_simulations_converge(game, params):
    res = simulate(game, params, 120_000, GAMES[game].default_rtp, seed=21)
    assert abs(res["simulated_rtp"] - res["theoretical_rtp"]) < 4 * res["std_error"] + 0.003, res


def test_instant_phase2_games_over_api(client):
    for game, params in [("limbo", {"target": 1.5}), ("coinflip", {"side": "heads"}), ("diamonds", {}),
                         ("keno", {"numbers": [1, 2, 3], "risk": "low"}), ("slots", {})]:
        h = demo_session(client, game)
        r = client.post("/api/v1/client/bet", json={"amount": 200, "params": params}, headers=h)
        assert r.status_code == 200, (game, r.text)
        d = r.json()
        assert d["balance"] == 100_000 - 200 + d["payout"]


def test_roulette_amount_must_match_chips(client):
    h = demo_session(client, "roulette")
    chips = [{"type": "red", "amount": 300}, {"type": "straight", "value": 0, "amount": 100}]
    bad = client.post("/api/v1/client/bet", json={"amount": 300, "params": {"chips": chips}}, headers=h)
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "BAD_PARAMS"
    ok = client.post("/api/v1/client/bet", json={"amount": 400, "params": {"chips": chips}}, headers=h).json()
    n = ok["result"]["number"]
    expected = (300 * 2 if n in roulette.RED else 0) + (100 * 36 if n == 0 else 0)
    assert ok["payout"] == expected and ok["balance"] == 100_000 - 400 + expected


def test_hilo_round_over_api(client):
    h = demo_session(client, "hilo")
    start = client.post("/api/v1/client/round/start", json={"amount": 1000, "params": {}}, headers=h).json()
    assert "cards" not in start["result"] and start["cashout_multiplier"] == 0
    with SessionLocal() as db:
        cards = db.get(Round, start["round_id"]).secret["cards"]
    # play the correct answer twice using the secret, then cash out
    state = start
    for _ in range(2):
        cur, nxt = hilo.rank(cards[state["result"]["pos"]]), hilo.rank(cards[state["result"]["pos"] + 1])
        if nxt == cur or (nxt > cur and cur == 13) or (nxt < cur and cur == 1):
            state = client.post("/api/v1/client/round/act", json={"action": {"guess": "skip"}}, headers=h).json()
            continue
        state = client.post("/api/v1/client/round/act", json={"action": {"guess": "higher" if nxt > cur else "lower"}}, headers=h).json()
        assert state["status"] == "open" and state["result"]["streak"] >= 1
    if state["result"]["streak"]:
        cash = client.post("/api/v1/client/round/cashout", headers=h).json()
        assert cash["status"] == "settled" and cash["payout"] == 1000 * round(cash["multiplier"] * 100) // 100
        assert cash["result"]["cards"] == cards


def test_tower_round_over_api(client):
    h = demo_session(client, "tower")
    start = client.post("/api/v1/client/round/start", json={"amount": 500, "params": {"difficulty": "hard"}}, headers=h).json()
    with SessionLocal() as db:
        safe = db.get(Round, start["round_id"]).secret["safe"]
    r = client.post("/api/v1/client/round/act", json={"action": {"column": safe[0][0]}}, headers=h).json()
    assert r["status"] == "open" and r["cashout_multiplier"] == tower.multiplier_x100("hard", 1, 0.97) / 100
    bad = 1 - safe[1][0]
    lost = client.post("/api/v1/client/round/act", json={"action": {"column": bad}}, headers=h).json()
    assert lost["status"] == "settled" and lost["payout"] == 0 and lost["result"]["safe"] == safe
