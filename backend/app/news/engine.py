from datetime import datetime, timezone
import httpx

from ..config import settings


def classify_catalyst(headline: str) -> str:
    h = headline.lower()
    if "earnings" in h or "guidance" in h or "beat" in h:
        return "earnings beat/guidance"
    if "upgrade" in h or "price target" in h:
        return "analyst upgrade"
    if "fda" in h:
        return "fda/biotech"
    if "contract" in h or "order" in h:
        return "contract win"
    if "product" in h or "launch" in h:
        return "product catalyst"
    return "general"


def catalyst_strength(headline: str, hours_old: float) -> int:
    if hours_old > 72:
        return 0
    base = 8
    cat = classify_catalyst(headline)
    if cat in {"earnings beat/guidance", "fda/biotech", "analyst upgrade"}:
        base = 12
    return min(15, base + (3 if hours_old <= 24 else 0))


async def fetch_company_news(ticker: str) -> list[dict]:
    if not settings.finnhub_api_key:
        return []
    now = datetime.now(timezone.utc).date()
    frm = now.replace(day=max(1, now.day - 3))
    params = {"symbol": ticker, "from": str(frm), "to": str(now), "token": settings.finnhub_api_key}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get("https://finnhub.io/api/v1/company-news", params=params)
        r.raise_for_status()
        payload = r.json()
    out = []
    now_ts = datetime.now(timezone.utc).timestamp()
    for item in payload[:8]:
        hours = round((now_ts - item.get("datetime", now_ts)) / 3600, 1)
        out.append({"headline": item.get("headline", ""), "source": item.get("source", "finnhub"), "hours_old": hours})
    return out
