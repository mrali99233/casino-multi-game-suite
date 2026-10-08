@echo off
rem Casino Matrix: install dependencies and start the server on http://127.0.0.1:8090
python -m pip install -r requirements.txt
start "" http://127.0.0.1:8090
python -m uvicorn provider.main:app --port 8090
