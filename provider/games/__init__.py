from .base import GameEngine, Outcome, ParamError, StatefulEngine, Step
from .coinflip import CoinFlip
from .crash import Crash
from .diamonds import Diamonds
from .dice import Dice
from .hilo import HiLo
from .keno import Keno
from .limbo import Limbo
from .mines import Mines
from .plinko import Plinko
from .roulette import Roulette
from .slots import Slots
from .tower import Tower
from .wheel import Wheel

GAMES: dict[str, GameEngine] = {
    g.id: g
    for g in (Crash(), Plinko(), Mines(), Dice(), Wheel(), Limbo(), HiLo(), Slots(), Tower(), Keno(), Roulette(), Diamonds(), CoinFlip())
}

__all__ = ["GAMES", "GameEngine", "Outcome", "ParamError", "StatefulEngine", "Step"]
