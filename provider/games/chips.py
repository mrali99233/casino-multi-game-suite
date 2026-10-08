"""Validation for table games that take several chips on named betting spots."""

from .base import ParamError


def validate_chips(params: dict, spots: tuple[str, ...], max_chips: int = 20) -> dict:
    chips = params.get("chips")
    if not isinstance(chips, list) or not 1 <= len(chips) <= max_chips:
        raise ParamError(f"Place between 1 and {max_chips} chips")
    out: dict[str, int] = {}
    for c in chips:
        if not isinstance(c, dict) or c.get("type") not in spots:
            raise ParamError(f"Chip type must be one of {list(spots)}")
        try:
            amount = int(c.get("amount", 0))
        except (TypeError, ValueError):
            raise ParamError("Chip amount must be an integer") from None
        if amount <= 0:
            raise ParamError("Chip amounts must be positive")
        out[c["type"]] = out.get(c["type"], 0) + amount
    return {"chips": [{"type": t, "amount": a} for t, a in out.items()]}


def check_total(params: dict, amount: int) -> None:
    if sum(c["amount"] for c in params["chips"]) != amount:
        raise ParamError("Bet amount must equal the sum of the chips")


def settle(chips: list[dict], returns_x100: dict[str, int]) -> int:
    """Total payout given each spot's return per unit staked (x100)."""
    return sum(c["amount"] * returns_x100.get(c["type"], 0) // 100 for c in chips)
