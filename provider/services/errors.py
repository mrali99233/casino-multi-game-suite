class GameError(Exception):
    """Business-rule failure surfaced to API callers as {"error": {"code", "message"}}."""

    def __init__(self, code: str, message: str, http_status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
