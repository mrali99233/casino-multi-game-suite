import json
import time

import httpx
import pytest

from provider.db import SessionLocal
from provider.models import Round, Transaction
from provider.security import callback_message, verify
from provider.wallet import seamless

from .conftest import ADMIN, make_operator


def test_signature_is_required_and_checked(client):
    op = make_operator(client)
    assert op.request("GET", "/api/v1/operator/games").status_code == 200
    assert op.request("GET", "/api/v1/operator/games", secret="wrong").status_code == 401
    assert op.request("GET", "/api/v1/operator/games", timestamp=int(time.time()) - 3600).status_code == 401
    assert client.get("/api/v1/operator/games").status_code == 401
    # tampered body
    raw = json.dumps({"player_id": "p1", "game_id": "dice"}).encode()
    ok = op.request("POST", "/api/v1/operator/sessions", {"player_id": "p1", "game_id": "dice"})
    assert ok.status_code == 200
    headers = {k: v for k, v in ok.request.headers.items() if k.lower().startswith("x-")}
    tampered = client.post("/api/v1/operator/sessions", content=raw.replace(b"p1", b"p2"), headers=headers | {"Content-Type": "application/json"})
    assert tampered.status_code == 401


def test_transfer_wallet_flow(client):
    op = make_operator(client)
    s = op.request("POST", "/api/v1/operator/sessions", {"player_id": "u-42", "game_id": "dice", "currency": "eur", "nickname": "Zara"}).json()
    assert s["launch_url"].endswith(f"/play/dice?token={s['token']}")
    h = {"Authorization": f"Bearer {s['token']}"}
    broke = client.post("/api/v1/client/bet", json={"amount": 100, "params": {}}, headers=h)
    assert broke.status_code == 402 and broke.json()["error"]["code"] == "INSUFFICIENT_FUNDS"

    dep = op.request("POST", "/api/v1/operator/players/u-42/deposit", {"amount": 5000, "transfer_id": "t1"}).json()
    again = op.request("POST", "/api/v1/operator/players/u-42/deposit", {"amount": 5000, "transfer_id": "t1"}).json()
    assert dep["balance"] == again["balance"] == 5000 and again["idempotent_replay"] and dep["currency"] == "EUR"

    played = client.post("/api/v1/client/bet", json={"amount": 1000, "params": {"target": 50, "condition": "over"}}, headers=h).json()
    bal = op.request("GET", "/api/v1/operator/players/u-42/balance").json()["balance"]
    assert bal == 4000 + played["payout"]

    over = op.request("POST", "/api/v1/operator/players/u-42/withdraw", {"amount": bal + 1, "transfer_id": "w1"})
    assert over.status_code == 402
    out = op.request("POST", "/api/v1/operator/players/u-42/withdraw", {"amount": bal, "transfer_id": "w2"}).json()
    assert out["balance"] == 0

    rounds = op.request("GET", "/api/v1/operator/rounds?player_id=u-42").json()["rounds"]
    assert [r["round_id"] for r in rounds] == [played["round_id"]]
    assert op.request("GET", f"/api/v1/operator/rounds/{played['round_id']}").json()["payout"] == played["payout"]


def test_rtp_config_operator_and_admin(client):
    op = make_operator(client)
    r = op.request("PUT", "/api/v1/operator/games/plinko/config", {"rtp": 0.95, "max_bet": 2000})
    assert r.status_code == 200 and r.json()["rtp"] == 0.95 and r.json()["source"] == "operator"
    assert op.request("PUT", "/api/v1/operator/games/plinko/config", {"rtp": 0.995}).json()["error"]["code"] == "RTP_OUT_OF_RANGE"
    assert op.request("PUT", "/api/v1/operator/games/crash/config", {"rtp": 0.95}).status_code == 400
    s = op.request("POST", "/api/v1/operator/sessions", {"player_id": "x", "game_id": "plinko", "mode": "demo"}).json()
    init = client.get("/api/v1/client/init", headers={"Authorization": f"Bearer {s['token']}"}).json()
    assert init["game"]["rtp"] == 0.95 and init["game"]["max_bet"] == 2000 and init["player"]["demo"]
    g = client.put("/api/v1/admin/games/dice/config", json={"rtp": 0.98}, headers=ADMIN).json()
    assert g["rtp"] == 0.98 and g["source"] == "provider"
    assert client.put("/api/v1/admin/games/dice/config", json={"rtp": 0.98}).status_code == 401


def test_admin_stats_and_simulate(client):
    from .conftest import demo_session

    h = demo_session(client, "wheel")
    for _ in range(4):
        client.post("/api/v1/client/bet", json={"amount": 1000, "params": {"risk": "low"}}, headers=h)
    stats = {g["game_id"]: g for g in client.get("/api/v1/admin/stats", headers=ADMIN).json()["games"]}
    assert stats["wheel"]["rounds"] == 4 and stats["wheel"]["wagered"] == 4000
    sim = client.post("/api/v1/admin/simulate", json={"game_id": "plinko", "params": {"rows": 8, "risk": "low"}, "rounds": 20000}, headers=ADMIN).json()
    assert abs(sim["simulated_rtp"] - 0.97) < 0.03


# ---- seamless wallet -------------------------------------------------------------------


class FakeCasino:
    """Minimal operator wallet that verifies provider signatures and is idempotent."""

    def __init__(self, secret, balance=10_000):
        self.secret, self.balance, self.seen, self.calls = secret, balance, {}, []
        self.fail_credit = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = request.content
        assert verify(self.secret, callback_message(request.headers["X-Timestamp"], body), request.headers["X-Signature"])
        data = json.loads(body)
        action = request.url.path.rsplit("/", 1)[-1]
        self.calls.append(action)
        if action == "balance":
            return httpx.Response(200, json={"balance": self.balance, "currency": "USD"})
        if action == "credit" and self.fail_credit:
            self.fail_credit -= 1
            return httpx.Response(503, json={"error": "BUSY"})
        tx = data["transaction_id"]
        if tx in self.seen:
            return httpx.Response(200, json={"balance": self.balance, "currency": "USD"})
        if action == "debit":
            if data["amount"] > self.balance:
                return httpx.Response(402, json={"error": "INSUFFICIENT_FUNDS"})
            self.balance -= data["amount"]
        elif action in ("credit", "rollback"):
            self.balance += data["amount"]
        self.seen[tx] = True
        return httpx.Response(200, json={"balance": self.balance, "currency": "USD"})


@pytest.fixture()
def casino(client):
    resp = client.post("/api/v1/admin/operators", json={"id": "seam", "name": "Seam", "wallet_mode": "seamless", "wallet_url": "https://casino.test/wallet"}, headers=ADMIN).json()
    from .conftest import OperatorClient

    fake = FakeCasino(resp["api_secret"])
    seamless.set_http_client(httpx.Client(transport=httpx.MockTransport(fake.handler)))
    yield fake, OperatorClient(client, resp["api_key"], resp["api_secret"])
    seamless.set_http_client(None)


def test_seamless_round_calls_operator_wallet(client, casino):
    fake, op = casino
    s = op.request("POST", "/api/v1/operator/sessions", {"player_id": "s1", "game_id": "plinko"}).json()
    h = {"Authorization": f"Bearer {s['token']}"}
    assert client.get("/api/v1/client/init", headers=h).json()["balance"] == 10_000
    d = client.post("/api/v1/client/bet", json={"amount": 1000, "params": {"rows": 8, "risk": "low"}}, headers=h).json()
    assert fake.calls[-2:] == ["debit", "credit"]
    assert d["balance"] == fake.balance == 9000 + d["payout"]
    too_much = client.post("/api/v1/client/bet", json={"amount": 50_000, "params": {"rows": 8}}, headers=h)
    assert too_much.status_code == 402


def test_seamless_credit_failure_is_retried_then_parked(client, casino):
    fake, op = casino
    s = op.request("POST", "/api/v1/operator/sessions", {"player_id": "s2", "game_id": "dice"}).json()
    h = {"Authorization": f"Bearer {s['token']}"}
    fake.fail_credit = 2  # first two attempts fail, third succeeds (3 retries)
    ok = client.post("/api/v1/client/bet", json={"amount": 500, "params": {"target": 50, "condition": "under"}}, headers=h)
    assert ok.status_code == 200 and ok.json()["status"] == "settled"
    fake.fail_credit = 99
    parked = client.post("/api/v1/client/bet", json={"amount": 500, "params": {"target": 50, "condition": "under"}}, headers=h)
    assert parked.status_code == 502 and parked.json()["error"]["code"] == "CREDIT_PENDING"
    with SessionLocal() as db:
        rnd = db.query(Round).filter(Round.status == "credit_pending").one()
        rid, payout = rnd.id, rnd.payout
    fake.fail_credit = 0
    fixed = client.post(f"/api/v1/admin/rounds/{rid}/retry-credit", headers=ADMIN).json()
    assert fixed["status"] == "settled" and fixed["payout"] == payout
    with SessionLocal() as db:
        assert db.query(Transaction).filter(Transaction.round_id == rid, Transaction.kind == "credit", Transaction.status == "ok").count() == 1
