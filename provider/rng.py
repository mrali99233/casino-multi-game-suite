"""Provably fair RNG.

Every outcome is derived from HMAC-SHA256(server_seed, f"{client_seed}:{nonce}:{cursor}").
Each 32-byte digest yields eight floats in [0, 1) by reading 4 bytes at a time as base-256
fractions. The server seed is committed to the player as SHA-256(server_seed) before any bet
and revealed when the player rotates seeds, so every past round can be recomputed.
"""

import hashlib
import hmac
import secrets


def new_server_seed() -> str:
    return secrets.token_hex(32)


def new_client_seed() -> str:
    return secrets.token_hex(8)


def hash_seed(server_seed: str) -> str:
    return hashlib.sha256(server_seed.encode()).hexdigest()


def digest(server_seed: str, client_seed: str, nonce: int, cursor: int) -> bytes:
    return hmac.new(server_seed.encode(), f"{client_seed}:{nonce}:{cursor}".encode(), hashlib.sha256).digest()


def bytes_to_float(chunk: bytes) -> float:
    return chunk[0] / 256 + chunk[1] / 256**2 + chunk[2] / 256**3 + chunk[3] / 256**4


def floats(server_seed: str, client_seed: str, nonce: int, count: int) -> list[float]:
    out: list[float] = []
    cursor = 0
    while len(out) < count:
        d = digest(server_seed, client_seed, nonce, cursor)
        for i in range(0, 32, 4):
            if len(out) == count:
                break
            out.append(bytes_to_float(d[i : i + 4]))
        cursor += 1
    return out
