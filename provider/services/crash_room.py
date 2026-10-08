"""Shared real-time crash room (Aviator).

Timeline per round: betting (seed hash published) -> running (m(t) = e^(g t)) -> crashed
(seed revealed) -> cooldown. Up to two bets per player per round ("slots"), each with an
optional auto cash-out. The server is authoritative: cash-outs are priced from the server
clock and rejected once the multiplier has reached the crash point.
"""

import asyncio
import logging
import math
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket
from starlette.concurrency import run_in_threadpool

from .. import rng
from ..config import get_settings
from ..db import SessionLocal
from ..games.crash import crash_point_x100
from ..models import CrashGame, GameSession, Round, Transaction, utcnow
from ..wallet import WalletError
from . import ledger
from .configs import GLOBAL, effective_config
from .errors import GameError

log = logging.getLogger(__name__)


@dataclass
class Bet:
    player_id: int
    session_token: str
    slot: int
    amount: int
    currency: str
    nickname: str
    auto_x100: int | None
    round_id: str
    debit_tx_id: str
    cashed_x100: int | None = None
    settled: bool = False

    def public(self) -> dict:
        name = self.nickname
        masked = name[0] + "***" + name[-1] if len(name) > 2 else name
        return {"name": masked, "slot": self.slot, "amount": self.amount, "currency": self.currency, "cashout": self.cashed_x100 and self.cashed_x100 / 100}


@dataclass
class Conn:
    ws: WebSocket
    token: str
    player_id: int
    nickname: str
    currency: str
    is_demo: bool


@dataclass
class RoomState:
    phase: str = "idle"  # betting | running | crashed
    game_id: int = 0
    seed_hash: str = ""
    server_seed: str = ""
    crash_x100: int = 100
    rtp: float = 0.97
    betting_ends: float = 0.0  # wall clock
    started_wall: float = 0.0
    started_mono: float = 0.0
    bets: dict[tuple[int, int], Bet] = field(default_factory=dict)
    pending: set[tuple[int, int]] = field(default_factory=set)


class CrashRoom:
    def __init__(self, *, betting: float | None = None, cooldown: float | None = None, growth: float | None = None, tick_hz: int | None = None, session_factory=SessionLocal):
        s = get_settings()
        self.betting = s.crash_betting_seconds if betting is None else betting
        self.cooldown = s.crash_cooldown_seconds if cooldown is None else cooldown
        self.growth = s.crash_growth if growth is None else growth
        self.tick = 1 / (tick_hz or s.crash_tick_hz)
        self.salt = s.crash_salt
        self.session_factory = session_factory
        self.state = RoomState()
        self.conns: dict[int, Conn] = {}
        self.history: deque[dict] = deque(maxlen=40)
        self.lock = asyncio.Lock()
        self._task: asyncio.Task | None = None

    # ---- lifecycle -------------------------------------------------------------------

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self.run(), name="crash-room")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def run(self) -> None:
        while True:
            try:
                await self.play_round()
            except asyncio.CancelledError:
                raise
            except Exception:  # keep the room alive
                log.exception("crash round failed")
                await asyncio.sleep(1)

    def multiplier_x100_now(self) -> int:
        elapsed = time.monotonic() - self.state.started_mono
        return int(math.floor(math.exp(self.growth * elapsed) * 100 + 1e-9))

    async def play_round(self) -> None:
        st = self.state
        seed = rng.new_server_seed()
        game_id, rtp = await run_in_threadpool(self._db_new_game, seed)
        async with self.lock:
            self.state = st = RoomState(
                phase="betting", game_id=game_id, seed_hash=rng.hash_seed(seed), server_seed=seed, rtp=rtp,
                betting_ends=time.time() + self.betting,
            )
        await self.broadcast(self.snapshot())
        await asyncio.sleep(self.betting)

        r = rng.floats(seed, self.salt, game_id, 1)[0]
        async with self.lock:
            st.crash_x100 = crash_point_x100(r, rtp)
            st.phase = "running"
            st.started_mono = time.monotonic()
            st.started_wall = time.time()
        await run_in_threadpool(self._db_mark, game_id, "running", None)
        await self.broadcast({"type": "start", "game_id": game_id, "started_at": st.started_wall, "growth": self.growth})

        crash_after = math.log(st.crash_x100 / 100) / self.growth
        while True:
            await asyncio.sleep(self.tick)
            elapsed = time.monotonic() - st.started_mono
            m_now = int(math.floor(math.exp(self.growth * elapsed) * 100 + 1e-9))
            reach = min(m_now, st.crash_x100)
            due: list[Bet] = []
            async with self.lock:
                for b in st.bets.values():
                    if b.cashed_x100 is None and b.auto_x100 and b.auto_x100 <= reach:
                        b.cashed_x100 = b.auto_x100
                        due.append(b)
            for b in due:
                await self._settle(b)
            if due:
                await self.broadcast_bets()
            if elapsed >= crash_after:
                break
            await self.broadcast({"type": "tick", "m": min(m_now, st.crash_x100) / 100})

        async with self.lock:
            st.phase = "crashed"
            losers = [b for b in st.bets.values() if b.cashed_x100 is None]
        await run_in_threadpool(self._db_mark, game_id, "crashed", st.crash_x100)
        for b in losers:
            await self._settle(b)
        self.history.appendleft({"game_id": game_id, "crash": st.crash_x100 / 100, "hash": st.seed_hash})
        await self.broadcast({
            "type": "crash", "game_id": game_id, "crash": st.crash_x100 / 100, "server_seed": seed, "server_seed_hash": st.seed_hash, "salt": self.salt,
        })
        await self.broadcast_bets()
        await asyncio.sleep(self.cooldown)

    # ---- player actions --------------------------------------------------------------

    async def place_bet(self, conn: Conn, slot: int, amount: int, auto: float | None) -> tuple[Bet, int]:
        if slot not in (0, 1):
            raise GameError("BAD_SLOT", "Slot must be 0 or 1")
        auto_x100 = None
        if auto is not None:
            auto_x100 = int(round(float(auto) * 100))
            if auto_x100 < 101:
                raise GameError("BAD_AUTO", "Auto cash-out must be at least 1.01×")
        key = (conn.player_id, slot)
        async with self.lock:
            st = self.state
            if st.phase != "betting":
                raise GameError("BETTING_CLOSED", "Betting is closed for this round", 409)
            if key in st.bets or key in st.pending:
                raise GameError("ALREADY_BET", "You already have a bet in this slot", 409)
            st.pending.add(key)
            game_id, rtp = st.game_id, st.rtp
        try:
            bet, balance = await run_in_threadpool(self._db_open_bet, conn, slot, amount, auto_x100, game_id, rtp)
        finally:
            async with self.lock:
                st.pending.discard(key)
        async with self.lock:
            late = not (self.state is st and st.phase == "betting")
            if not late:
                st.bets[key] = bet
        if late:
            await run_in_threadpool(self._db_refund, bet)
            raise GameError("BETTING_CLOSED", "Betting closed before your bet was confirmed; it was refunded", 409)
        await self.broadcast_bets()
        return bet, balance

    async def cancel_bet(self, conn: Conn, slot: int) -> int | None:
        key = (conn.player_id, slot)
        async with self.lock:
            st = self.state
            bet = st.bets.get(key)
            if st.phase != "betting" or bet is None:
                raise GameError("CANNOT_CANCEL", "Bets can only be cancelled while betting is open", 409)
            del st.bets[key]
        balance = await run_in_threadpool(self._db_refund, bet)
        await self.broadcast_bets()
        return balance

    async def cashout(self, conn: Conn, slot: int) -> Bet:
        key = (conn.player_id, slot)
        async with self.lock:
            st = self.state
            bet = st.bets.get(key)
            if st.phase != "running" or bet is None:
                raise GameError("NO_ACTIVE_BET", "No active bet to cash out", 409)
            if bet.cashed_x100 is not None:
                raise GameError("ALREADY_CASHED", "Already cashed out", 409)
            m = self.multiplier_x100_now()
            if m >= st.crash_x100:
                raise GameError("TOO_LATE", "The plane already flew away", 409)
            bet.cashed_x100 = max(100, m)
        await self._settle(bet)
        await self.broadcast_bets()
        return bet

    # ---- messaging -------------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        st = self.state
        snap = {
            "type": "state",
            "phase": st.phase,
            "game_id": st.game_id,
            "server_seed_hash": st.seed_hash,
            "betting_ends": st.betting_ends,
            "started_at": st.started_wall,
            "growth": self.growth,
            "history": list(self.history)[:25],
            "bets": [b.public() for b in st.bets.values()],
        }
        if st.phase == "crashed":
            snap["crash"] = st.crash_x100 / 100
        return snap

    async def broadcast_bets(self) -> None:
        await self.broadcast({"type": "bets", "bets": [b.public() for b in self.state.bets.values()]})

    async def broadcast(self, msg: dict) -> None:
        msg = msg | {"server_time": time.time()}
        dead = []
        for key, c in list(self.conns.items()):
            try:
                await c.ws.send_json(msg)
            except Exception:
                dead.append(key)
        for key in dead:
            self.conns.pop(key, None)

    async def send_player(self, player_id: int, msg: dict) -> None:
        msg = msg | {"server_time": time.time()}
        for c in list(self.conns.values()):
            if c.player_id == player_id:
                try:
                    await c.ws.send_json(msg)
                except Exception:
                    pass

    async def _settle(self, bet: Bet) -> None:
        if bet.settled:
            return
        bet.settled = True
        try:
            balance = await run_in_threadpool(self._db_settle, bet)
        except Exception:
            log.exception("crash settlement failed for round %s", bet.round_id)
            return
        await self.send_player(bet.player_id, {
            "type": "settled", "slot": bet.slot, "game_id": self.state.game_id, "cashout": bet.cashed_x100 and bet.cashed_x100 / 100,
            "payout": bet.amount * bet.cashed_x100 // 100 if bet.cashed_x100 else 0, "balance": balance,
        })

    # ---- database (run in threadpool) --------------------------------------------------

    def _db_new_game(self, seed: str) -> tuple[int, float]:
        with self.session_factory() as db:
            rtp = effective_config(db, GLOBAL, "crash").rtp
            g = CrashGame(server_seed=seed, server_seed_hash=rng.hash_seed(seed), salt=self.salt, rtp=rtp)
            db.add(g)
            db.commit()
            return g.id, rtp

    def _db_mark(self, game_id: int, status: str, crash_x100: int | None) -> None:
        with self.session_factory() as db:
            g = db.get(CrashGame, game_id)
            g.status = status
            if status == "running":
                g.started_at = utcnow()
            if crash_x100 is not None:
                g.crash_point_x100 = crash_x100
                g.crashed_at = utcnow()
            db.commit()

    def _db_open_bet(self, conn: Conn, slot: int, amount: int, auto_x100: int | None, game_id: int, rtp: float) -> tuple[Bet, int]:
        with self.session_factory() as db:
            from .players import resolve_session

            session = resolve_session(db, conn.token)
            cfg = effective_config(db, session.operator_id, "crash")
            if not cfg.enabled:
                raise GameError("GAME_DISABLED", "This game is currently disabled", 403)
            if not isinstance(amount, int) or not cfg.min_bet <= amount <= cfg.max_bet:
                raise GameError("BET_LIMIT", f"Bet must be between {cfg.min_bet} and {cfg.max_bet} (minor units)")
            rnd = Round(
                id=str(uuid.uuid4()), operator_id=session.operator_id, player_id=session.player_id, game_id="crash",
                session_token=session.token, is_demo=session.is_demo, currency=session.player.currency, bet=amount, rtp=rtp,
                server_seed_hash=self.state.seed_hash, client_seed=self.salt, nonce=game_id,
                params={"slot": slot, "auto_cashout": auto_x100 and auto_x100 / 100, "crash_game_id": game_id}, result={},
            )
            db.add(rnd)
            db.commit()
            try:
                balance, tx_id = ledger.debit(db, session.player, session.is_demo, rnd, amount)
            except WalletError:
                rnd.status = "cancelled"
                db.commit()
                raise
            bet = Bet(session.player_id, session.token, slot, amount, session.player.currency, session.player.nickname, auto_x100, rnd.id, tx_id)
        return bet, balance

    def _db_refund(self, bet: Bet) -> int | None:
        with self.session_factory() as db:
            rnd = db.get(Round, bet.round_id)
            session = db.get(GameSession, bet.session_token)
            tx = db.get(Transaction, bet.debit_tx_id)
            balance = ledger.try_rollback(db, session.player, session.is_demo, rnd, tx)
            rnd.status = "cancelled"
            rnd.settled_at = utcnow()
            db.commit()
            return balance

    def _db_settle(self, bet: Bet) -> int | None:
        from .rounds import settle

        with self.session_factory() as db:
            rnd = db.get(Round, bet.round_id)
            session = db.get(GameSession, bet.session_token)
            cfg = effective_config(db, session.operator_id, "crash")
            mult = bet.cashed_x100 or 0
            rnd.multiplier_x100 = mult
            rnd.result = {"crash": self.state.crash_x100 / 100, "cashout": mult / 100 if mult else None}
            payout = min(bet.amount * mult // 100, cfg.max_win)
            try:
                return settle(db, session, rnd, payout, ledger.balance(db, session.player, session.is_demo))
            except GameError:  # credit_pending: win is stored and retried later
                return None


room: CrashRoom | None = None
