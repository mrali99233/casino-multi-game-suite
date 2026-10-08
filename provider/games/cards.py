"""Shared playing-card helpers. A card is an int 0..51: rank = card % 13 (0 = Ace .. 12 = King),
suit = card // 13 (0 spades, 1 hearts, 2 diamonds, 3 clubs)."""

import math

DECK = 52
RANK_NAMES = "A 2 3 4 5 6 7 8 9 10 J Q K".split()
SUIT_NAMES = "♠♥♦♣"


def rank(card: int) -> int:
    """1 (Ace) .. 13 (King)."""
    return card % 13 + 1


def suit(card: int) -> int:
    return card // 13


def label(card: int) -> str:
    return RANK_NAMES[card % 13] + SUIT_NAMES[card // 13]


def shuffled(floats: list[float]) -> list[int]:
    """A full 52-card deck shuffled by Fisher-Yates with 51 floats."""
    deck = list(range(DECK))
    for i in range(DECK - 1, 0, -1):
        j = int(math.floor(floats[DECK - 1 - i] * (i + 1)))
        deck[i], deck[j] = deck[j], deck[i]
    return deck


def dealt(floats: list[float], n: int) -> list[int]:
    """The first ``n`` cards of a shuffled single deck (partial Fisher-Yates, n floats)."""
    deck = list(range(DECK))
    for i in range(n):
        j = i + int(math.floor(floats[i] * (DECK - i)))
        deck[i], deck[j] = deck[j], deck[i]
    return deck[:n]


def shoe(floats: list[float]) -> list[int]:
    """Infinite shoe: every card drawn independently and uniformly."""
    return [int(math.floor(f * DECK)) for f in floats]
