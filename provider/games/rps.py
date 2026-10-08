"""Rock Paper Scissors streak: beat the house hand to double your multiplier, draws replay,
a loss ends the round. Decisive rounds are won half the time, so after k wins the cash-out
multiplier is RTP x 2^k (up to 20 wins). House hands are fixed at the start from the floats.
"""

import math

from .base import ParamError, StatefulEngine, Step

HANDS = ("rock", "paper", "scissors")
BEATS = {"rock": "scissors", "paper": "rock", "scissors": "paper"}
MAX_ROUNDS, MAX_WINS = 60, 20


def multiplier_x100(wins: int, rtp: float) -> int:
    return int(math.floor(rtp * 2**wins * 100 + 1e-9)) if wins else 0


class RockPaperScissors(StatefulEngine):
    id = "rps"
    name = "Rock Paper Scissors"
    category = "Instant"
    tagline = "Win to double. Draws replay."
    default_rtp = 0.97

    def validate(self, params):
        return {}

    def floats_needed(self, params):
        return MAX_ROUNDS

    def start(self, floats, params, rtp):
        return {"house": [HANDS[int(math.floor(f * 3))] for f in floats[:MAX_ROUNDS]]}, {"round": 0, "wins": 0, "history": []}

    def act(self, secret, state, params, rtp, action):
        pick = action.get("pick")
        if pick not in HANDS:
            raise ParamError(f"'pick' must be one of {list(HANDS)}")
        house = secret["house"][state["round"]]
        outcome = "draw" if house == pick else "win" if BEATS[pick] == house else "lose"
        new = {"round": state["round"] + 1, "wins": state["wins"] + (outcome == "win"),
               "history": state["history"] + [{"pick": pick, "house": house, "outcome": outcome}]}
        if outcome == "lose":
            return Step(new, "lost")
        mult = multiplier_x100(new["wins"], rtp)
        if new["wins"] == MAX_WINS or new["round"] == MAX_ROUNDS:
            return Step(new, "cashout", mult or 100)
        return Step(new, "continue", mult)

    def multiplier_x100(self, state, params, rtp):
        return multiplier_x100(state["wins"], rtp)

    def view(self, state, params, rtp):
        return {"next_multiplier": multiplier_x100(state["wins"] + 1, rtp) / 100}

    def describe(self, rtp):
        return {"ladder": [multiplier_x100(k, rtp) / 100 for k in range(1, MAX_WINS + 1)]}

    def theoretical_rtp(self, params, rtp):
        return multiplier_x100(int(params.get("wins", 1)), rtp) / 100 / 2 ** int(params.get("wins", 1))

    def simulate_once(self, rand, params, rtp):
        goal, wins = int(params.get("wins", 3)), 0
        while wins < goal:
            house, mine = int(rand() * 3), int(rand() * 3)
            if house == mine:
                continue
            if (mine - house) % 3 == 1:  # paper(1) beats rock(0), scissors(2) beats paper(1), rock(0) beats scissors(2)
                wins += 1
            else:
                return 0.0
        return multiplier_x100(wins, rtp) / 100
