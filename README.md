# Casino Matrix: game provider

A game provider platform: provably fair game engines, an operator integration API with transfer or
seamless wallets, per-operator RTP control, and polished HTML5 Canvas game clients.

## Games (Phase 1)

| Game | Type | Math model | Default RTP |
| --- | --- | --- | --- |
| Aviator | Real-time multiplayer (WebSocket) | crash = RTP / (1 − r) | 97% |
| Plinko | Instant, 8–16 rows, 3 risks | binomial buckets, payout table fitted to RTP | 97% |
| Mines | Stateful, 1–24 mines | RTP × C(25, k) / C(25 − n, k) | 97% |
| Dice | Instant, 1–98% chance | RTP × 10001 / winning outcomes | 99% |
| Wheel | Instant, 30 segments, 3 risks | segment table fitted to RTP | 96% |

Every multiplier is rounded **down** to 0.01×, so a game's expected return never exceeds its configured RTP.

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
  games/             pure math engines (no I/O), one file per game
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

## Roadmap

Phase 2 ports HiLo and 3×3 Slots and adds Limbo, Keno, Dragon Tower, Roulette, Coin Flip and Diamonds;
later phases add the card games (Blackjack, Baccarat, Video Poker, Dragon Tiger, Andar Bahar, Teen Patti)
and a 5×3 video slot. Each new title is an engine file plus a client module.
