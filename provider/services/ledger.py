"""Money movement with an audit trail. Every wallet call is recorded as a Transaction row
*before* it is sent, so an operator can reconcile by transaction id even after a crash."""

import logging
import uuid

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import GameSession, Player, Round, Transaction
from ..wallet import InsufficientFunds, WalletError, WalletUnavailable, wallet_for

log = logging.getLogger(__name__)


def _tx(db: Session, rnd: Round | None, player: Player, kind: str, amount: int, ref: str | None = None, tx_id: str | None = None) -> Transaction:
    tx = Transaction(
        id=tx_id or str(uuid.uuid4()), round_id=rnd.id if rnd else None, player_id=player.id, kind=kind, amount=amount, reference_id=ref
    )
    db.add(tx)
    db.commit()
    return tx


def _finish(db: Session, tx: Transaction, status: str, balance: int | None = None, error: str | None = None) -> None:
    tx.status = status
    tx.balance_after = balance
    tx.error = error[:255] if error else None
    db.commit()


def balance(db: Session, player: Player, is_demo: bool) -> int:
    return wallet_for(player.operator, is_demo).balance(db, player).balance


def debit(db: Session, player: Player, is_demo: bool, rnd: Round, amount: int) -> tuple[int, str]:
    wallet = wallet_for(player.operator, is_demo)
    tx = _tx(db, rnd, player, "debit", amount)
    try:
        res = wallet.debit(db, player, amount, tx.id, rnd)
    except WalletUnavailable as exc:
        # Unknown outcome: the operator may have taken the money. Roll it back.
        _finish(db, tx, "unknown", error=exc.message)
        try_rollback(db, player, is_demo, rnd, tx)
        raise
    except WalletError as exc:
        _finish(db, tx, "rejected", error=exc.message)
        raise
    _finish(db, tx, "ok", res.balance)
    return res.balance, tx.id


def credit(db: Session, player: Player, is_demo: bool, rnd: Round, amount: int, debit_tx_id: str | None) -> int:
    wallet = wallet_for(player.operator, is_demo)
    tx = _tx(db, rnd, player, "credit", amount, debit_tx_id)
    last: WalletError | None = None
    for _ in range(max(1, get_settings().wallet_credit_retries)):
        try:
            res = wallet.credit(db, player, amount, tx.id, rnd, debit_tx_id)
        except WalletError as exc:
            last = exc
            continue
        _finish(db, tx, "ok", res.balance)
        return res.balance
    _finish(db, tx, "unknown", error=last.message if last else None)
    raise last or WalletError()


def try_rollback(db: Session, player: Player, is_demo: bool, rnd: Round, original: Transaction) -> int | None:
    wallet = wallet_for(player.operator, is_demo)
    tx = _tx(db, rnd, player, "rollback", original.amount, original.id)
    try:
        res = wallet.rollback(db, player, original.amount, tx.id, rnd, original.id)
    except WalletError as exc:
        log.warning("rollback %s failed: %s", tx.id, exc.message)
        _finish(db, tx, "unknown", error=exc.message)
        return None
    _finish(db, tx, "ok", res.balance)
    return res.balance


def transfer(db: Session, player: Player, kind: str, amount: int, transfer_id: str) -> tuple[int, bool]:
    """Operator deposit/withdraw for transfer-mode wallets. Idempotent on transfer_id."""
    from ..wallet.internal import adjust

    tx_id = f"{player.operator_id}:{kind}:{transfer_id}"
    existing = db.get(Transaction, tx_id)
    if existing is not None:
        if existing.status == "ok":
            return existing.balance_after or 0, True
        raise InsufficientFunds() if existing.error == "INSUFFICIENT_FUNDS" else WalletError("Transfer previously failed")
    tx = _tx(db, None, player, kind, amount, tx_id=tx_id)
    try:
        bal = adjust(db, player, amount if kind == "deposit" else -amount)
    except InsufficientFunds:
        _finish(db, tx, "rejected", error="INSUFFICIENT_FUNDS")
        raise
    _finish(db, tx, "ok", bal)
    return bal, False


def session_player(session: GameSession) -> Player:
    return session.player
