def sentiment_status(api_enabled: bool) -> str:
    return "available" if api_enabled else "sentiment unavailable"
