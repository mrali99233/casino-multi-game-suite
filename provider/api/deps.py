"""FastAPI dependencies: operator signature auth, game-session auth, admin token."""

import hmac
import time

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import GameSession, Operator
from ..security import operator_message, verify
from ..services.errors import GameError
from ..services.players import resolve_session


async def operator_auth(
    request: Request,
    db: Session = Depends(get_db),
    x_operator_key: str | None = Header(default=None),
    x_timestamp: str | None = Header(default=None),
    x_signature: str | None = Header(default=None),
) -> Operator:
    if not (x_operator_key and x_timestamp and x_signature):
        raise GameError("UNAUTHORIZED", "X-Operator-Key, X-Timestamp and X-Signature headers are required", 401)
    try:
        skew = abs(time.time() - int(x_timestamp))
    except ValueError:
        raise GameError("UNAUTHORIZED", "X-Timestamp must be unix seconds", 401) from None
    if skew > get_settings().signature_tolerance_seconds:
        raise GameError("UNAUTHORIZED", "Request timestamp is outside the allowed window", 401)
    operator = db.scalar(select(Operator).where(Operator.api_key == x_operator_key))
    if operator is None or not operator.active:
        raise GameError("UNAUTHORIZED", "Unknown or disabled operator key", 401)
    body = await request.body()
    msg = operator_message(x_timestamp, request.method, request.url.path, body)
    if not verify(operator.api_secret, msg, x_signature):
        raise GameError("UNAUTHORIZED", "Signature mismatch", 401)
    return operator


def game_session(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> GameSession:
    token = authorization[7:] if authorization and authorization.lower().startswith("bearer ") else None
    return resolve_session(db, token)


def admin_auth(x_admin_token: str | None = Header(default=None)) -> None:
    if not x_admin_token or not hmac.compare_digest(x_admin_token, get_settings().admin_token):
        raise GameError("UNAUTHORIZED", "Invalid admin token", 401)
