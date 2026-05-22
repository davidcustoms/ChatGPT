from datetime import datetime, timedelta, timezone
import httpx
import pandas as pd

from ..config import settings


class DataNotVerifiedError(RuntimeError):
    pass


async def fetch_live_quote(ticker: str) -> dict:
    if not settings.polygon_api_key:
        raise DataNotVerifiedError("DATA NOT VERIFIED: POLYGON_API_KEY missing")
    url = f"https://api.polygon.io/v2/last/trade/{ticker}"
    params = {"apiKey": settings.polygon_api_key}
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()
    if payload.get("status") != "success":
        raise DataNotVerifiedError("DATA NOT VERIFIED: bad Polygon response")
    trade = payload.get("results", {})
    ts = datetime.fromtimestamp(trade["t"] / 1000, tz=timezone.utc)
    freshness = int((datetime.now(timezone.utc) - ts).total_seconds())
    return {"ticker": ticker, "price": trade["p"], "timestamp": ts, "source": "polygon", "freshness_seconds": freshness, "verified": freshness < 180}


async def fetch_daily_candles(ticker: str, days: int = 260) -> pd.DataFrame:
    if not settings.polygon_api_key:
        raise DataNotVerifiedError("DATA NOT VERIFIED: POLYGON_API_KEY missing")
    to_date = datetime.now(timezone.utc).date()
    from_date = to_date - timedelta(days=days * 2)
    url = f"https://api.polygon.io/v2/aggs/ticker/{ticker}/range/1/day/{from_date}/{to_date}"
    params = {"adjusted": "true", "sort": "asc", "limit": days, "apiKey": settings.polygon_api_key}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        payload = r.json()
    rows = payload.get("results", [])
    if not rows:
        raise DataNotVerifiedError("DATA NOT VERIFIED: no historical candles")
    df = pd.DataFrame([{"timestamp": datetime.fromtimestamp(x["t"] / 1000, tz=timezone.utc), "open": x["o"], "high": x["h"], "low": x["l"], "close": x["c"], "volume": x["v"]} for x in rows])
    return df


async def fetch_universe() -> list[str]:
    # Universe bootstrap with liquid symbols for MVP; replace with full screener integration.
    return ["AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA", "AMD", "PLTR", "AVGO", "NFLX"]
