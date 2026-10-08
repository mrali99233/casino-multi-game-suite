"""Seamless wallet: the operator keeps the money, the provider calls it per transaction.

Every call is a signed JSON POST to ``{operator.wallet_url}/{action}`` with headers
``X-Provider-Id``, ``X-Timestamp`` and ``X-Signature`` (see ``security.callback_message``).
The operator answers ``{"balance": <int>, "currency": "USD"}`` or an error body
``{"error": "INSUFFICIENT_FUNDS" | <code>, "message": "..."}`` with a 4xx status.
Transaction ids are stable, so operators must treat repeated ids as idempotent.
"""

import json
import time

import httpx

from ..config import get_settings
from ..models import Operator, Player, Round
from ..security import callback_message, sign
from .base import InsufficientFunds, WalletError, WalletResult, WalletUnavailable

_client: httpx.Client | None = None


def http_client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=get_settings().wallet_timeout_seconds)
    return _client


def set_http_client(client: httpx.Client | None) -> None:
    """Swap the HTTP client (tests inject an ``httpx.MockTransport``)."""
    global _client
    _client = client


class SeamlessWallet:
    def __init__(self, operator: Operator):
        if not operator.wallet_url:
            raise WalletError("Operator has no wallet_url configured")
        self.operator = operator

    def _call(self, action: str, payload: dict) -> WalletResult:
        body = json.dumps(payload, separators=(",", ":")).encode()
        ts = str(int(time.time()))
        headers = {
            "Content-Type": "application/json",
            "X-Provider-Id": "casino-matrix",
            "X-Timestamp": ts,
            "X-Signature": sign(self.operator.api_secret, callback_message(ts, body)),
        }
        url = self.operator.wallet_url.rstrip("/") + "/" + action
        try:
            resp = http_client().post(url, content=body, headers=headers)
        except httpx.HTTPError as exc:
            raise WalletUnavailable(f"Operator wallet unreachable: {exc.__class__.__name__}") from exc
        try:
            data = resp.json()
        except ValueError:
            data = {}
        if resp.status_code >= 500:
            raise WalletUnavailable(f"Operator wallet error {resp.status_code}")
        if resp.status_code >= 400 or "error" in data:
            if data.get("error") == "INSUFFICIENT_FUNDS" or resp.status_code == 402:
                raise InsufficientFunds()
            raise WalletError(data.get("message") or data.get("error") or f"Operator wallet returned {resp.status_code}")
        if "balance" not in data:
            raise WalletError("Operator wallet response is missing 'balance'")
        return WalletResult(int(data["balance"]), data.get("currency", ""), data.get("reference"))

    def _base(self, player: Player, rnd: Round | None) -> dict:
        base = {"player_id": player.external_id, "currency": player.currency}
        if rnd is not None:
            base |= {"round_id": rnd.id, "game_id": rnd.game_id, "session_token": rnd.session_token}
        return base

    def balance(self, db, player) -> WalletResult:
        return self._call("balance", self._base(player, None))

    def debit(self, db, player, amount, tx_id, rnd) -> WalletResult:
        return self._call("debit", self._base(player, rnd) | {"transaction_id": tx_id, "amount": amount})

    def credit(self, db, player, amount, tx_id, rnd, debit_tx_id) -> WalletResult:
        return self._call(
            "credit",
            self._base(player, rnd) | {"transaction_id": tx_id, "amount": amount, "debit_transaction_id": debit_tx_id},
        )

    def rollback(self, db, player, amount, tx_id, rnd, original_tx_id) -> WalletResult:
        return self._call(
            "rollback",
            self._base(player, rnd)
            | {"transaction_id": tx_id, "amount": amount, "rollback_transaction_id": original_tx_id},
        )
