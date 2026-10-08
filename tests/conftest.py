import os

os.environ["CMP_DATABASE_URL"] = "sqlite:///:memory:"
os.environ["CMP_CRASH_ENABLED"] = "false"
os.environ["CMP_ADMIN_TOKEN"] = "test-admin"

import json  # noqa: E402
import time  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from provider.db import Base, engine  # noqa: E402
from provider.main import app  # noqa: E402
from provider.security import operator_message, sign  # noqa: E402

ADMIN = {"X-Admin-Token": "test-admin"}


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as c:
        yield c


def demo_session(client, game_id):
    r = client.post("/api/v1/demo/sessions", json={"game_id": game_id})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


class OperatorClient:
    """Signs operator requests the way an integrating casino would."""

    def __init__(self, client, api_key, api_secret):
        self.client, self.key, self.secret = client, api_key, api_secret

    def request(self, method, path, body=None, *, secret=None, timestamp=None):
        raw = json.dumps(body).encode() if body is not None else b""
        ts = str(timestamp or int(time.time()))
        sig = sign(secret or self.secret, operator_message(ts, method, path.split("?")[0], raw))
        headers = {"X-Operator-Key": self.key, "X-Timestamp": ts, "X-Signature": sig, "Content-Type": "application/json"}
        return self.client.request(method, path, content=raw, headers=headers)


def make_operator(client, op_id="acme", **extra):
    r = client.post("/api/v1/admin/operators", json={"id": op_id, "name": op_id.title(), **extra}, headers=ADMIN)
    assert r.status_code == 200, r.text
    d = r.json()
    return OperatorClient(client, d["api_key"], d["api_secret"])
