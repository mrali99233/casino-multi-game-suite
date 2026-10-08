"""Request signing for operator <-> provider traffic.

Operator -> provider: X-Signature = HMAC-SHA256(api_secret, f"{timestamp}.{METHOD}.{path}.{body}")
Provider -> operator: X-Signature = HMAC-SHA256(api_secret, f"{timestamp}.{body}")
"""

import hashlib
import hmac
import secrets


def sign(secret: str, message: bytes) -> str:
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def verify(secret: str, message: bytes, signature: str) -> bool:
    return hmac.compare_digest(sign(secret, message), signature or "")


def operator_message(timestamp: str, method: str, path: str, body: bytes) -> bytes:
    return f"{timestamp}.{method.upper()}.{path}.".encode() + body


def callback_message(timestamp: str, body: bytes) -> bytes:
    return f"{timestamp}.".encode() + body


def new_token() -> str:
    return secrets.token_urlsafe(32)


def new_api_key() -> str:
    return "cmk_" + secrets.token_hex(12)


def new_api_secret() -> str:
    return "cms_" + secrets.token_hex(32)
