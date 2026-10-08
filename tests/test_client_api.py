from provider.db import SessionLocal
from provider.models import Round

from .conftest import demo_session


def test_demo_plinko_round_moves_balance_exactly(client):
    h = demo_session(client, "plinko")
    init = client.get("/api/v1/client/init", headers=h).json()
    assert init["balance"] == 100_000 and init["game"]["id"] == "plinko"
    assert len(init["game"]["data"]["tables"]["12"]["high"]) == 13
    r = client.post("/api/v1/client/bet", json={"amount": 1000, "params": {"rows": 12, "risk": "high"}}, headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "settled" and len(d["result"]["path"]) == 12
    assert d["payout"] == 1000 * round(d["multiplier"] * 100) // 100
    assert d["balance"] == 100_000 - 1000 + d["payout"]
    assert d["fairness"]["nonce"] == 1


def test_bet_validation_errors(client):
    h = demo_session(client, "dice")
    assert client.post("/api/v1/client/bet", json={"amount": 5, "params": {}}, headers=h).json()["error"]["code"] == "BET_LIMIT"
    bad = client.post("/api/v1/client/bet", json={"amount": 100, "params": {"target": 99.5, "condition": "under"}}, headers=h)
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "BAD_PARAMS"
    assert client.post("/api/v1/client/bet", json={"amount": 100}).status_code == 401
    assert client.post("/api/v1/client/bet", json={"amount": 100}, headers={"Authorization": "Bearer nope"}).status_code == 401


def test_insufficient_funds_cancels_round(client):
    h = demo_session(client, "dice")
    for _ in range(2):
        client.post("/api/v1/client/bet", json={"amount": 100_000, "params": {"target": 2, "condition": "under"}}, headers=h)
    bal = client.get("/api/v1/client/balance", headers=h).json()["balance"]
    if bal < 100_000:
        r = client.post("/api/v1/client/bet", json={"amount": 100_000, "params": {}}, headers=h)
        assert r.status_code == 402 and r.json()["error"]["code"] == "INSUFFICIENT_FUNDS"
        with SessionLocal() as db:
            assert db.query(Round).filter(Round.status == "cancelled").count() >= 1


def test_seed_rotation_reveals_seed_and_verify_reproduces_round(client):
    h = demo_session(client, "wheel")
    played = client.post("/api/v1/client/bet", json={"amount": 500, "params": {"risk": "medium"}}, headers=h).json()
    rot = client.post("/api/v1/client/seeds/rotate", json={"client_seed": "my-lucky-seed"}, headers=h).json()
    prev = rot["previous"]
    assert prev["server_seed_hash"] == played["fairness"]["server_seed_hash"]
    assert rot["current"]["client_seed"] == "my-lucky-seed" and rot["current"]["nonce"] == 0
    v = client.post("/api/v1/fair/verify", json={
        "game_id": "wheel", "server_seed": prev["server_seed"], "client_seed": prev["client_seed"],
        "nonce": played["fairness"]["nonce"], "params": {"risk": "medium"}, "rtp": 0.96,
    }).json()
    assert v["server_seed_hash"] == prev["server_seed_hash"]
    assert v["result"] == played["result"] and v["multiplier"] == played["multiplier"]


def test_mines_full_flow(client):
    h = demo_session(client, "mines")
    start = client.post("/api/v1/client/round/start", json={"amount": 1000, "params": {"mines": 3}}, headers=h).json()
    assert start["status"] == "open" and "mines" not in start["result"] and start["balance"] == 99_000
    assert client.post("/api/v1/client/round/start", json={"amount": 1000, "params": {"mines": 3}}, headers=h).status_code == 409
    assert client.post("/api/v1/client/seeds/rotate", json={}, headers=h).json()["error"]["code"] == "ROUND_OPEN"
    with SessionLocal() as db:
        mines = db.get(Round, start["round_id"]).secret["mines"]
    safe = [t for t in range(25) if t not in mines]
    r1 = client.post("/api/v1/client/round/act", json={"action": {"tile": safe[0]}}, headers=h).json()
    r2 = client.post("/api/v1/client/round/act", json={"action": {"tile": safe[1]}}, headers=h).json()
    assert r2["result"]["revealed"] == safe[:2] and r2["multiplier"] > r1["multiplier"] > 1
    # resuming: init returns the open round
    assert client.get("/api/v1/client/init", headers=h).json()["open_round"]["round_id"] == start["round_id"]
    cash = client.post("/api/v1/client/round/cashout", headers=h).json()
    assert cash["status"] == "settled" and sorted(cash["result"]["mines"]) == sorted(mines)
    assert cash["payout"] == 1000 * round(cash["multiplier"] * 100) // 100
    assert cash["balance"] == 99_000 + cash["payout"]
    # second round: hit a mine
    s2 = client.post("/api/v1/client/round/start", json={"amount": 1000, "params": {"mines": 24}}, headers=h).json()
    with SessionLocal() as db:
        mine = db.get(Round, s2["round_id"]).secret["mines"][0]
    boom = client.post("/api/v1/client/round/act", json={"action": {"tile": mine}}, headers=h).json()
    assert boom["status"] == "settled" and boom["payout"] == 0 and boom["result"]["mine_hit"] == mine
    assert client.post("/api/v1/client/round/act", json={"action": {"tile": 0}}, headers=h).json()["error"]["code"] == "NO_ROUND"
    assert client.post("/api/v1/client/round/start", json={"amount": 1000, "params": {"mines": 30}}, headers=h).json()["error"]["code"] == "BAD_PARAMS"


def test_history_lists_settled_rounds(client):
    h = demo_session(client, "dice")
    for _ in range(3):
        client.post("/api/v1/client/bet", json={"amount": 100, "params": {"target": 50, "condition": "under"}}, headers=h)
    rounds = client.get("/api/v1/client/history", headers=h).json()["rounds"]
    assert len(rounds) == 3 and all(r["game_id"] == "dice" for r in rounds)
