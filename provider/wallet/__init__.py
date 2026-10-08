from ..models import Operator
from .base import InsufficientFunds, Wallet, WalletError, WalletResult, WalletUnavailable
from .internal import InternalWallet
from .seamless import SeamlessWallet

__all__ = [
    "InsufficientFunds",
    "InternalWallet",
    "SeamlessWallet",
    "Wallet",
    "WalletError",
    "WalletResult",
    "WalletUnavailable",
    "wallet_for",
]


def wallet_for(operator: Operator, is_demo: bool) -> Wallet:
    if is_demo or operator.wallet_mode != "seamless":
        return InternalWallet()
    return SeamlessWallet(operator)
