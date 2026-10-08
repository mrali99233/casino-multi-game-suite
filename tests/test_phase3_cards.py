import pytest

from provider.db import SessionLocal
from provider.games import GAMES
from provider.games import andarbahar, baccarat, blackjack, teenpatti, videopoker
from provider.games.cards import rank
from provider.models import Round
from provider.sim import simulate

from .conftest import demo_session

# card helpers: rank 1..13 and suit 0..3 -> card id
C = lambda r, s=0: s * 13 + (r - 1)  # noqa: E731


def test_video_poker_hand_evaluation():
    ev = videopoker.evaluate
    assert ev([C(10), C(11), C(12), C(13), C(1)]) == "royal_flush"
    assert ev([C(5, 1), C(6, 1), C(7, 1), C(8, 1), C(9, 1)]) == "straight_flush"
    assert ev([C(1), C(2, 1), C(3, 2), C(4, 3), C(5)]) == "straight"
    assert ev([C(9), C(9, 1), C(9, 2), C(9, 3), C(2)]) == "four_kind"
    assert ev([C(3), C(3, 1), C(3, 2), C(7), C(7, 1)]) == "full_house"
    assert ev([C(11), C(11, 1), C(2), C(5), C(8, 2)]) == "jacks_or_better"
    assert ev([C(10), C(10, 1), C(2), C(5), C(8, 2)]) == "nothing"
    assert videopoker.paytable(0.9954)["full_house"] == 9 and videopoker.paytable(0.96)["flush"] == 5
    assert videopoker.variant(0.97)[0] == 0.9615


def test_teen_patti_ranking():
    key = lambda cards: teenpatti.evaluate(cards)[1]  # noqa: E731
    trail, pure, seq = [C(2), C(2, 1), C(2, 2)], [C(4, 1), C(5, 1), C(6, 1)], [C(1), C(13, 1), C(12, 2)]
    a23 = [C(1), C(2, 1), C(3, 2)]
    kqj = [C(13), C(12, 1), C(11, 2)]
    assert key(trail) > key(pure) > key(seq) > key(a23) > key(kqj)
    assert teenpatti.evaluate([C(9), C(9, 1), C(4)])[0] == "pair"
    assert sum(teenpatti.category_probs()) == pytest.approx(1)


def test_baccarat_third_card_rules():
    # player 2+3=5 draws; banker 3+3=6 draws only on player's third card 6 or 7
    cards = [C(2), C(3), C(3, 1), C(3, 2), C(6), C(9)]
    player, banker = baccarat.play(cards)
    assert len(player) == 3 and len(banker) == 3
    player, banker = baccarat.play([C(9), C(2), C(13), C(3), C(5), C(5)])  # player natural 9
    assert len(player) == 2 and len(banker) == 2
    p = baccarat.outcome_probs()
    assert sum(p.values()) == pytest.approx(1)
    assert 0.9890 < baccarat.spot_rtp("banker") < 0.9898


def test_andar_bahar_probabilities():
    p = andarbahar.side_probs()
    assert p["andar"] + p["bahar"] == pytest.approx(1) and 0.51 < p["andar"] < 0.52


@pytest.mark.parametrize("game,params,tol", [
    ("baccarat", {}, 0.004),
    ("dragontiger", {}, 0.004),
    ("dragontiger", {"chips": [{"type": "tie", "amount": 100}]}, 0.012),
    ("andarbahar", {"chips": [{"type": "bahar", "amount": 100}]}, 0.004),
    ("teenpatti", {"chips": [{"type": "pair_plus", "amount": 100}]}, 0.012),
    ("blackjack", {}, 0.006),
])
def test_card_simulations_converge(game, params, tol):
    res = simulate(game, params, 150_000, GAMES[game].default_rtp, seed=17)
    assert abs(res["simulated_rtp"] - res["theoretical_rtp"]) < 4 * res["std_error"] + tol, res


def test_video_poker_simple_strategy_trails_optimal():
    res = simulate("videopoker", {}, 60_000, 0.9954, seed=4)
    assert 0.93 < res["simulated_rtp"] < 0.9954 + 4 * res["std_error"]


def _blackjack_round(client, h, amount=1000):
    """Start rounds until one is still open (not settled on the deal)."""
    for _ in range(40):
        r = client.post("/api/v1/client/round/start", json={"amount": amount, "params": {}}, headers=h).json()
        if r["status"] == "open":
            return r
    raise AssertionError("every deal was a blackjack")


def test_blackjack_double_takes_a_second_stake(client):
    h = demo_session(client, "blackjack")
    r = _blackjack_round(client, h)
    before = client.get("/api/v1/client/balance", headers=h).json()["balance"]
    assert "double" in r["actions"] and r["result"]["dealer"].__len__() == 1  # hole card hidden
    d = client.post("/api/v1/client/round/act", json={"action": {"move": "double"}}, headers=h).json()
    assert d["status"] == "settled" and d["bet"] == 2000
    assert d["payout"] in (0, 2000, 4000)
    assert len(d["result"]["dealer"]) >= 2
    after = client.get("/api/v1/client/balance", headers=h).json()["balance"]
    assert after == before - 1000 + d["payout"]
    # doubling after a hit is refused before any money moves
    _blackjack_round(client, h)
    hit = client.post("/api/v1/client/round/act", json={"action": {"move": "hit"}}, headers=h).json()
    if hit["status"] == "open":
        bal = client.get("/api/v1/client/balance", headers=h).json()["balance"]
        resp = client.post("/api/v1/client/round/act", json={"action": {"move": "double"}}, headers=h).json()
        assert resp["error"]["code"] == "BAD_ACTION"
        assert client.get("/api/v1/client/balance", headers=h).json()["balance"] == bal


def test_blackjack_split_and_settle_on_deal(client):
    h = demo_session(client, "blackjack")
    seen_split = seen_natural = False
    for _ in range(300):
        r = client.post("/api/v1/client/round/start", json={"amount": 100, "params": {}}, headers=h).json()
        if r["status"] == "settled":
            seen_natural = True
            hand = r["result"]["hands"][0]
            assert hand["result"] in ("blackjack", "push", "lose")
            if hand["result"] == "blackjack":
                assert r["payout"] == 250
            continue
        if "split" in r["actions"] and not seen_split:
            s = client.post("/api/v1/client/round/act", json={"action": {"move": "split"}}, headers=h).json()
            assert len(s["result"]["hands"]) == 2 and s["bet"] == 200
            seen_split = True
            r = s
        while r["status"] == "open":
            r = client.post("/api/v1/client/round/act", json={"action": {"move": "stand"}}, headers=h).json()
        with SessionLocal() as db:
            rnd = db.get(Round, r["round_id"])
            assert rnd.payout == r["payout"] and rnd.bet == r["bet"]
        if seen_split and seen_natural:
            break
    assert seen_natural


def test_table_card_games_over_api(client):
    for game, chips in [
        ("baccarat", [{"type": "banker", "amount": 300}, {"type": "player_pair", "amount": 100}]),
        ("dragontiger", [{"type": "dragon", "amount": 200}, {"type": "tie", "amount": 100}]),
        ("andarbahar", [{"type": "andar", "amount": 400}]),
        ("teenpatti", [{"type": "b", "amount": 200}, {"type": "pair_plus", "amount": 100}]),
    ]:
        h = demo_session(client, game)
        amount = sum(c["amount"] for c in chips)
        r = client.post("/api/v1/client/bet", json={"amount": amount, "params": {"chips": chips}}, headers=h)
        assert r.status_code == 200, (game, r.text)
        d = r.json()
        assert d["balance"] == 100_000 - amount + d["payout"]
    ab = client.post("/api/v1/client/bet", json={"amount": 100, "params": {"chips": [{"type": "andar", "amount": 100}]}}, headers=demo_session(client, "andarbahar")).json()
    joker = ab["result"]["joker"]
    last = (ab["result"]["andar"] + ab["result"]["bahar"])
    assert any(rank(c) == rank(joker) for c in last)


def test_video_poker_round_over_api(client):
    h = demo_session(client, "videopoker")
    r = client.post("/api/v1/client/round/start", json={"amount": 500, "params": {}}, headers=h).json()
    assert len(r["result"]["hand"]) == 5 and "draws" not in r["result"]
    with SessionLocal() as db:
        draws = db.get(Round, r["round_id"]).secret["draws"]
    hold = [True, False, True, False, False]
    d = client.post("/api/v1/client/round/act", json={"action": {"hold": hold}}, headers=h).json()
    expected = [r["result"]["hand"][0], draws[0], r["result"]["hand"][2], draws[1], draws[2]]
    assert d["status"] == "settled" and d["result"]["final"] == expected
    assert d["payout"] == 500 * videopoker.paytable(0.973)[videopoker.evaluate(expected)]
    assert blackjack.total([C(1), C(6)]) == (17, True)
