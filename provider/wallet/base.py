"""Wallet contract shared by the internal ledger and operator seamless wallets."""

from dataclasses import dataclass
from typing import Protocol

from sqlalchemy.orm import Session

from ..models import Player, Round


class WalletError(Exception):
    code = "WALLET_ERROR"
    http_status = 502

    def __init__(self, message: str = "Wallet rejected the request"):
        super().__init__(message)
        self.message = message


class InsufficientFunds(WalletError):
    code = "INSUFFICIENT_FUNDS"
    http_status = 402

    def __init__(self, message: str = "Not enough balance for this bet"):
        super().__init__(message)


class WalletUnavailable(WalletError):
    """Network failure or timeout: the outcome of the call is unknown."""

    code = "WALLET_UNAVAILABLE"
    http_status = 503

    def __init__(self, message: str = "Wallet did not respond"):
        super().__init__(message)


@dataclass
class WalletResult:
    balance: int
    currency: str
    reference: str | None = None


class Wallet(Protocol):
    def balance(self, db: Session, player: Player) -> WalletResult: ...

    def debit(self, db: Session, player: Player, amount: int, tx_id: str, rnd: Round) -> WalletResult: ...

    def credit(
        self, db: Session, player: Player, amount: int, tx_id: str, rnd: Round, debit_tx_id: str | None
    ) -> WalletResult: ...

    def rollback(
        self, db: Session, player: Player, amount: int, tx_id: str, rnd: Round, original_tx_id: str
    ) -> WalletResult: ...
