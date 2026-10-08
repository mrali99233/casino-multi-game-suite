#!/usr/bin/env sh
# Casino Matrix: install dependencies and start the server on http://127.0.0.1:8090
set -e
python3 -m pip install -r requirements.txt
python3 -m uvicorn provider.main:app --host 0.0.0.0 --port 8090
