"""Run the Casino Matrix game provider: ``python server.py`` (dev) or ``uvicorn provider.main:app``."""

import os

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "provider.main:app",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "8090")),
        reload=os.environ.get("RELOAD", "1") == "1",
    )
