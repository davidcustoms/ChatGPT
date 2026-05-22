from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..market_data.providers import DataNotVerifiedError, fetch_daily_candles, fetch_live_quote, fetch_universe
from ..news.engine import fetch_company_news
from ..scanners.orchestrator import ScanContext, run_scan
from ..services import save_scan_result

router = APIRouter()


async def market_regime_live() -> dict:
    symbols = ["SPY", "QQQ", "IWM"]
    aligned = 0
    for s in symbols:
        q = await fetch_live_quote(s)
        d = await fetch_daily_candles(s, days=80)
        sma50 = d["close"].tail(50).mean()
        if q["price"] > sma50:
            aligned += 1
    risk_on = aligned >= 2
    return {"risk_on": risk_on, "aligned_indexes": aligned}


@router.get("/scan/{ticker}")
async def scan_ticker(ticker: str, db: Session = Depends(get_db)):
    try:
        quote = await fetch_live_quote(ticker.upper())
        candles = await fetch_daily_candles(ticker.upper())
        news = await fetch_company_news(ticker.upper())
        regime = await market_regime_live()
    except DataNotVerifiedError as e:
        raise HTTPException(status_code=503, detail=str(e))

    result = run_scan(ScanContext(ticker=ticker.upper(), company=ticker.upper(), quote=quote, candles=candles, market_regime=regime, news_items=news))
    if result.get("status") == "DATA NOT VERIFIED":
        raise HTTPException(status_code=503, detail="DATA NOT VERIFIED")
    save_scan_result(db, result)
    return result


@router.get("/scan/daily")
async def scan_daily(limit: int = 10, db: Session = Depends(get_db)):
    tickers = (await fetch_universe())[:limit]
    results = []
    regime = await market_regime_live()
    for t in tickers:
        try:
            quote = await fetch_live_quote(t)
            candles = await fetch_daily_candles(t)
            news = await fetch_company_news(t)
            result = run_scan(ScanContext(ticker=t, company=t, quote=quote, candles=candles, market_regime=regime, news_items=news))
            save_scan_result(db, result)
            results.append(result)
        except Exception as e:
            results.append({"status": "rejected", "ticker": t, "reason": str(e)})
    return {"count": len(results), "market_regime": regime, "results": results}
