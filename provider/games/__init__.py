from .base import GameEngine, Outcome, ParamError
from .crash import Crash
from .dice import Dice
from .mines import Mines
from .plinko import Plinko
from .wheel import Wheel

GAMES: dict[str, GameEngine] = {g.id: g for g in (Crash(), Plinko(), Mines(), Dice(), Wheel())}

__all__ = ["GAMES", "GameEngine", "Outcome", "ParamError"]
