import asyncio

from provider import rng
from provider.db import SessionLocal
from provider.games.crash import crash_point_x100
from provider.models import CrashGame, Operator, Round
from provider.services import crash_room, ledger, players
from provider.services.errors import GameError


class FakeWS:
    def __init__(self):
        self.sent = []

    async def send_json(self, msg):
        self.sent.append(msg)


def _conn(client):
    with SessionLocal() as db:
        op = db.get(Operator, "demo")
        s = players.create_session(db, op, player_external_id="pilot", game_id="crash", is_demo=True, nickname="Pilot")
        return crash_room.Conn(FakeWS(), s.token, s.player_id, "Pilot", "USD", True)


def _balance(conn):
    with SessionLocal() as db:
        s = players.resolve_session(db, conn.token)
        return ledger.balance(db, s.player, True)


def test_crash_round_bets_cashouts_and_fairness(client):
    async def scenario():
        room = crash_room.CrashRoom(betting=0.3, cooldown=0.05, growth=2.5, tick_hz=50)
        conn = _conn(client)
        room.conns[1] = conn
        task = asyncio.create_task(room.play_round())
        await asyncio.sleep(0.05)
        assert room.state.phase == "betting"
        _, bal = await room.place_bet(conn, 0, 1000, None)
        assert bal == 99_000
        await room.place_bet(conn, 1, 500, 1.01)  # auto cash-out at 1.01x
        try:
            await room.place_bet(conn, 0, 1000, None)
            raise AssertionError("duplicate slot accepted")
        except GameError as e:
            assert e.code == "ALREADY_BET"
        while room.state.phase == "betting":
            await asyncio.sleep(0.01)
        crash = room.state.crash_x100
        if crash > 120:
            await asyncio.sleep(0.04)
            if room.state.phase == "running":
                await room.cashout(conn, 0)
        await task
        return room, conn, crash

    room, conn, crash = asyncio.run(scenario())
    st = room.state
    assert st.phase == "crashed"
    # crash point is reproducible from the revealed seed
    assert crash == crash_point_x100(rng.floats(st.server_seed, room.salt, st.game_id, 1)[0], st.rtp)
    with SessionLocal() as db:
        assert db.get(CrashGame, st.game_id).crash_point_x100 == crash
        rounds = {r.params["slot"]: r for r in db.query(Round).filter(Round.game_id == "crash")}
    assert all(r.status == "settled" for r in rounds.values())
    auto = rounds[1]
    assert auto.payout == (505 if crash >= 101 else 0)
    manual = rounds[0]
    if manual.payout:
        assert 100 <= manual.multiplier_x100 < crash and manual.payout == 1000 * manual.multiplier_x100 // 100
    assert _balance(conn) == 100_000 - 1500 + manual.payout + auto.payout
    kinds = [m["type"] for m in conn.ws.sent]
    assert "start" in kinds and "crash" in kinds and "settled" in kinds


def test_bets_rejected_outside_betting_and_cancel_refunds(client):
    async def scenario():
        room = crash_room.CrashRoom(betting=0.25, cooldown=0.01, growth=50, tick_hz=50)
        conn = _conn(client)
        task = asyncio.create_task(room.play_round())
        await asyncio.sleep(0.05)
        await room.place_bet(conn, 0, 2000, None)
        bal = await room.cancel_bet(conn, 0)
        assert bal == 100_000
        await task
        try:
            await room.place_bet(conn, 0, 100, None)
            raise AssertionError("bet accepted after crash")
        except GameError as e:
            assert e.code == "BETTING_CLOSED"

    asyncio.run(scenario())
    with SessionLocal() as db:
        assert db.query(Round).filter(Round.game_id == "crash").one().status == "cancelled"


def test_websocket_handshake_and_replies(client):
    room = crash_room.CrashRoom(betting=5, cooldown=1, growth=0.1, tick_hz=10)
    crash_room.room = room
    try:
        token = client.post("/api/v1/demo/sessions", json={"game_id": "crash"}).json()["token"]
        with client.websocket_connect(f"/api/v1/client/crash/ws?token={token}") as ws:
            hello = ws.receive_json()
            assert hello["type"] == "hello" and hello["balance"] == 100_000
            ws.send_json({"action": "ping", "req": 1})
            assert ws.receive_json() == {"type": "reply", "req": 1, "ok": True}
            ws.send_json({"action": "bet", "slot": 0, "amount": 100, "req": 2})
            reply = ws.receive_json()
            assert reply["ok"] is False and reply["code"] == "BETTING_CLOSED"
        wrong = client.post("/api/v1/demo/sessions", json={"game_id": "dice"}).json()["token"]
        try:
            with client.websocket_connect(f"/api/v1/client/crash/ws?token={wrong}") as ws:
                ws.receive_json()
            raise AssertionError("dice session allowed into crash room")
        except Exception as exc:  # starlette raises WebSocketDisconnect on close
            assert "4401" in repr(exc) or getattr(exc, "code", None) == 4401
    finally:
        crash_room.room = None
