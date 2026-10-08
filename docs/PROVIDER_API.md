# Casino Matrix provider API

This is the integration guide for casinos ("operators") that want to offer Casino Matrix games.
The full machine-readable reference is served at `/docs` (OpenAPI) on a running provider.

All amounts are **integers in minor units** (cents): `1050` means 10.50.

## 1. Credentials

The provider creates your operator account in the back office (`/admin`) and gives you:

| Field | Use |
| --- | --- |
| `api_key` | Sent as `X-Operator-Key` on every request |
| `api_secret` | Signs your requests and verifies our wallet callbacks. Never send it. |
| `wallet_mode` | `transfer` or `seamless` (see section 4) |

## 2. Signing requests (operator → provider)

Every request to `/api/v1/operator/*` carries three headers:

```
X-Operator-Key: cmk_...
X-Timestamp:    1760000000                      # unix seconds, must be within 300 s
X-Signature:    hex(HMAC_SHA256(api_secret, "{timestamp}.{METHOD}.{path}.{raw_body}"))
```

`path` is the URL path without the query string. `raw_body` is the exact bytes you send (empty for GET).

```python
import hashlib, hmac, json, time, httpx

def call(method, path, body=None):
    raw = json.dumps(body).encode() if body is not None else b""
    ts = str(int(time.time()))
    sig = hmac.new(SECRET.encode(), f"{ts}.{method}.{path}.".encode() + raw, hashlib.sha256).hexdigest()
    return httpx.request(method, BASE + path, content=raw, headers={
        "X-Operator-Key": KEY, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json"})
```

## 3. Launching a game

```
POST /api/v1/operator/sessions
{ "player_id": "user-1842", "game_id": "crash", "currency": "USD",
  "nickname": "Zara", "mode": "real", "return_url": "https://casino.example/lobby" }

200 { "token": "...", "launch_url": "https://provider/play/crash?token=...", "expires_at": "...", "mode": "real" }
```

Open `launch_url` in an iframe or a new window. `mode: "demo"` gives the player play money on the
provider side and never touches your wallet. Game ids: `crash`, `plinko`, `mines`, `slots`, `roulette`,
`hilo`, `tower`, `limbo`, `dice`, `keno`, `wheel`, `diamonds`, `coinflip`
(`GET /api/v1/operator/games` lists them with your current RTP and limits).

Multi-step games (`mines`, `hilo`, `tower`) debit when the round starts and credit when the player cashes
out or loses, so a round can stay open between the two calls. An open round is resumed when the player
relaunches the game.

## 4. Wallets

### Transfer wallet

The provider keeps each player's balance. Move money with idempotent transfers (repeat a
`transfer_id` and you get the original result back):

```
POST /api/v1/operator/players/{player_id}/deposit   { "amount": 5000, "transfer_id": "dep-77" }
POST /api/v1/operator/players/{player_id}/withdraw  { "amount": 1200, "transfer_id": "wd-12" }
GET  /api/v1/operator/players/{player_id}/balance
```

### Seamless wallet

You keep the money; the provider calls `{wallet_url}/{action}` for every bet. Each call is a JSON POST
with headers `X-Provider-Id`, `X-Timestamp` and
`X-Signature = hex(HMAC_SHA256(api_secret, "{timestamp}.{raw_body}"))`. Verify the signature before acting.

| Action | Body (besides `player_id`, `currency`, `round_id`, `game_id`, `session_token`) |
| --- | --- |
| `balance` | only `player_id`, `currency` |
| `debit` | `transaction_id`, `amount` |
| `credit` | `transaction_id`, `amount`, `debit_transaction_id` (amount can be 0: the round ended with no win) |
| `rollback` | `transaction_id`, `amount`, `rollback_transaction_id` (refund that debit if you applied it) |

Reply `200 {"balance": 12345, "currency": "USD"}`. For a refused debit reply `402 {"error": "INSUFFICIENT_FUNDS"}`.

Rules your wallet must follow:

* **Idempotency.** The same `transaction_id` can arrive more than once. Apply it once and answer with the current balance.
* **Rollbacks.** If a debit times out we send a rollback for it. If you never saw the debit, just answer with the balance.
* **Credits are retried** up to 3 times. If they still fail the round is parked as `credit_pending` and the provider retries it from the back office, with the same `transaction_id`.

## 5. Rounds and reconciliation

```
GET /api/v1/operator/rounds?player_id=user-1842&game_id=plinko&limit=50
GET /api/v1/operator/rounds/{round_id}
```

Each round has `bet`, `payout`, `multiplier`, `status` (`settled`, `credit_pending`, `cancelled`),
the game `params` and `result`, and the fairness data (`server_seed_hash`, `client_seed`, `nonce`).

## 6. RTP and limits

```
PUT /api/v1/operator/games/plinko/config
{ "rtp": 0.96, "min_bet": 10, "max_bet": 20000, "max_win": 5000000, "enabled": true }
```

RTP must sit inside the game's range (`rtp_range` in the games list, usually 0.90–0.99). RTP changes the
payout table, never the RNG: every round stays verifiable. The crash room is shared by all operators,
so its RTP is set provider-wide. Roulette uses standard European payouts, so its RTP is fixed at 97.30%.

## 7. Fairness

* Instant games: `HMAC_SHA256(server_seed, "{client_seed}:{nonce}:{cursor}")`, 4 bytes per float.
  Players see `SHA256(server_seed)` before betting and can reveal and rotate the seed in the game.
* Crash: each round publishes `SHA256(server_seed)` when betting opens and reveals the seed when it ends.
  `crash = max(1.00, floor(RTP / (1 − r), 0.01))`.
* Anyone can recompute: `POST /api/v1/fair/verify` and `GET /api/v1/fair/crash/{game_id}`.

## Errors

Every error has the same shape and an HTTP status that matches it:

```
{ "error": { "code": "BET_LIMIT", "message": "Bet must be between 10 and 100000 (minor units)" } }
```

Common codes: `UNAUTHORIZED` (401), `BAD_SESSION` / `SESSION_EXPIRED` (401), `BAD_PARAMS` (400),
`BET_LIMIT` (400), `INSUFFICIENT_FUNDS` (402), `GAME_DISABLED` (403), `ROUND_OPEN` (409),
`CREDIT_PENDING` (502), `WALLET_UNAVAILABLE` (503).
