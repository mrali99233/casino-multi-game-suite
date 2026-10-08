"""Provider-held balances (transfer-mode operators and demo play).

Debits use a single conditional UPDATE so two concurrent bets can never overdraw.
"""

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..models import Player, Round, WalletAccount
from .base import InsufficientFunds, WalletResult


def ensure_account(db: Session, player: Player, opening_balance: int = 0) -> WalletAccount:
    acct = db.get(WalletAccount, player.id)
    if acct is None:
        acct = WalletAccount(player_id=player.id, balance=opening_balance)
        db.add(acct)
        db.commit()
    return acct


def _balance(db: Session, player: Player) -> int:
    return db.scalar(select(WalletAccount.balance).where(WalletAccount.player_id == player.id)) or 0


def adjust(db: Session, player: Player, delta: int) -> int:
    """Atomically add ``delta`` (may be negative). Raises InsufficientFunds on overdraw."""
    ensure_account(db, player)
    stmt = update(WalletAccount).where(WalletAccount.player_id == player.id)
    if delta < 0:
        stmt = stmt.where(WalletAccount.balance >= -delta)
    res = db.execute(stmt.values(balance=WalletAccount.balance + delta))
    if res.rowcount == 0:
        db.rollback()
        raise InsufficientFunds()
    db.commit()
    return _balance(db, player)


class InternalWallet:
    def balance(self, db: Session, player: Player) -> WalletResult:
        ensure_account(db, player)
        return WalletResult(_balance(db, player), player.currency)

    def debit(self, db: Session, player: Player, amount: int, tx_id: str, rnd: Round) -> WalletResult:
        return WalletResult(adjust(db, player, -amount), player.currency)

    def credit(self, db, player, amount, tx_id, rnd, debit_tx_id) -> WalletResult:
        return WalletResult(adjust(db, player, amount) if amount else _balance(db, player), player.currency)

    def rollback(self, db, player, amount, tx_id, rnd, original_tx_id) -> WalletResult:
        return WalletResult(adjust(db, player, amount), player.currency)
