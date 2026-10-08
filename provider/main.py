"""ASGI application: provider APIs, crash room lifecycle and the static game clients."""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from .api import admin, client, demo, fair, operator
from .config import get_settings
from .db import SessionLocal, init_db
from .games import GAMES
from .models import Operator
from .security import new_api_key, new_api_secret
from .services import crash_room
from .services.errors import GameError
from .wallet import WalletError

CLIENT_DIR = Path(__file__).resolve().parent.parent / "client"
log = logging.getLogger("provider")


def bootstrap() -> None:
    init_db()
    s = get_settings()
    with SessionLocal() as db:
        if s.demo_enabled and db.get(Operator, s.demo_operator_id) is None:
            db.add(Operator(id=s.demo_operator_id, name="Demo Lobby", api_key=new_api_key(), api_secret=new_api_secret(), wallet_mode="transfer"))
            db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    bootstrap()
    if get_settings().crash_enabled:
        crash_room.room = crash_room.CrashRoom()
        crash_room.room.start()
    yield
    if crash_room.room:
        await crash_room.room.stop()
        crash_room.room = None


app = FastAPI(
    title="Casino Matrix Game Provider API",
    version=__version__,
    description="Provably fair game engines with operator integration (transfer or seamless wallet).",
    lifespan=lifespan,
)


def _error(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


@app.exception_handler(GameError)
async def game_error(_: Request, exc: GameError):
    return _error(exc.code, exc.message, exc.http_status)


@app.exception_handler(WalletError)
async def wallet_error(_: Request, exc: WalletError):
    return _error(exc.code, exc.message, exc.http_status)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    return _error("BAD_REQUEST", f"{where}: {first.get('msg', 'invalid request')}".strip(": "), 422)


for r in (operator.router, client.router, fair.router, admin.router, demo.router):
    app.include_router(r)


@app.get("/health", tags=["meta"])
def health():
    return {"status": "ok", "version": __version__, "games": list(GAMES)}


app.mount("/client", StaticFiles(directory=CLIENT_DIR), name="client")


@app.get("/", include_in_schema=False)
def lobby():
    return FileResponse(CLIENT_DIR / "lobby.html")


@app.get("/admin", include_in_schema=False)
def admin_page():
    return FileResponse(CLIENT_DIR / "admin.html")


@app.get("/play/{game_id}", include_in_schema=False)
def play(game_id: str):
    if game_id not in GAMES:
        return _error("UNKNOWN_GAME", f"Unknown game '{game_id}'", 404)
    return FileResponse(CLIENT_DIR / "game.html")
