# Casino Matrix: game provider

A game provider platform: provably fair game engines, an operator integration API with transfer or
seamless wallets, per-operator RTP control, and polished HTML5 Canvas game clients.

## Games

| Game | Type | Math model | Default RTP |
| --- | --- | --- | --- |
| Aviator | Real-time multiplayer (WebSocket) | crash = RTP / (1 − r) | 97% |
| Plinko | Instant, 8–16 rows, 3 risks | binomial buckets, payout table fitted to RTP | 97% |
| Mines | Multi-step, 1–24 mines | RTP × C(25, k) / C(25 − n, k) | 97% |
| Fruit Slots | Instant, 3×3, 5 lines, wilds | line-hit rates enumerated over all 24³ stops, paytable fitted | 96% |
| Roulette | Instant, European single zero | fixed table payouts (36/37) | 97.30% (fixed) |
| HiLo | Multi-step cards | RTP / Π(chance of each correct guess) | 97% |
| Dragon Tower | Multi-step, 5 difficulties | RTP × (tiles / eggs)^floors | 97% |
| Limbo | Instant, target 1.01–1,000,000× | P(result ≥ T) = RTP / T | 99% |
| Dice | Instant, 1–98% chance | RTP × 10001 / winning outcomes | 99% |
| Keno | Instant, 40 numbers, 1–10 picks, 3 risks | hypergeometric hits, table fitted per pick count | 97% |
| Wheel | Instant, 30 segments, 3 risks | segment table fitted to RTP | 96% |
| Diamonds | Instant, 5 gems × 7 colours | pattern odds enumerated over 7⁵ draws | 98% |
| Coin Flip | Instant | 2 × RTP on a correct call | 98% |

Every multiplier is rounded **down** to 0.01×, so a game's expected return never exceeds its configured RTP.
Roulette keeps the standard European payouts, so its RTP is fixed by the rules.

## Quick start

```bash
pip install -r requirements.txt
python server.py            # http://127.0.0.1:8090
```

| URL | What |
| --- | --- |
| `/` | Lobby with free demo play |
| `/play/{game}?token=…` | Game client (opened from a launch URL) |
| `/admin` | Back office: stats, RTP sliders, simulator, operators (token = `CMP_ADMIN_TOKEN`) |
| `/docs` | OpenAPI reference |

Configuration lives in environment variables (see `.env.example`). Use PostgreSQL in production by setting
`CMP_DATABASE_URL`, and change `CMP_ADMIN_TOKEN`.

## Project layout

```
provider/            FastAPI back end
  games/             pure math engines (no I/O), one file per game;
                     instant games implement resolve(), multi-step games start()/act()
  rng.py, rtp.py     HMAC-SHA256 floats, payout-table fitting
  wallet/            internal ledger + seamless operator wallet client
  services/          rounds, ledger (audit trail), players/seeds, crash room
  api/               operator (signed), client (session token), fair, admin, demo
  sim.py             Monte Carlo simulator
client/              static front end (no build step)
  sdk/               shell UI, FX engine (tweens, particles), synth sound, API client
  games/             one module per game
tests/               pytest suite
docs/PROVIDER_API.md operator integration guide
```

## Checking the math

```bash
python -m provider.sim plinko --rounds 1000000 -p rows=16 -p risk=high
python -m provider.sim crash -p cashout=2
python -m provider.sim mines -p mines=3 -p picks=5
pytest
```

## Integrating as an operator

See [docs/PROVIDER_API.md](docs/PROVIDER_API.md): sign requests with HMAC-SHA256, create a session,
open the `launch_url`, and either fund a transfer wallet or answer seamless debit/credit/rollback callbacks.

## Adding a game

1. Write `provider/games/<id>.py`: a `GameEngine` with `validate`, `floats_needed`, `resolve` (or a
   `StatefulEngine` with `start`, `act`, `multiplier_x100`), plus `theoretical_rtp` and `describe`.
2. Register it in `provider/games/__init__.py`.
3. Write `client/games/<id>.js` exporting `mount(ctx)` and `rules`; the shared SDK gives you the shell,
   wallet display, fairness and history modals, particles, tweens and sounds.
4. Add a simulation case to the tests and check it with `python -m provider.sim <id>`.

## Roadmap

Phase 3 adds the card tables (Blackjack, Baccarat, Video Poker, Dragon Tiger, Andar Bahar, Teen Patti);
Phase 4 adds a 5×3 video slot with free spins, Chicken Road, Scratch Card, Cases and Rock Paper Scissors.
