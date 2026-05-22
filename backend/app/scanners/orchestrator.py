from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import pandas as pd

from ..indicators.engine import calculate_indicators
from ..news.engine import catalyst_strength, classify_catalyst
from ..risk.position_sizing import calc_position_size, risk_reward_ratio
from .scoring import rating_from_score, weighted_score
from .setups import breakout_signal, pullback_signal


@dataclass
class ScanContext:
    ticker: str
    company: str
    quote: dict
    candles: pd.DataFrame
    market_regime: dict
    news_items: list[dict]


def _build_targets(entry: float, stop: float) -> tuple[float, float, float]:
    risk = max(entry - stop, 0.01)
    return (round(entry + 2 * risk, 2), round(entry + 3 * risk, 2), round(entry + 4 * risk, 2))


def run_scan(ctx: ScanContext, account_size: float = 10000, risk_pct: float = 0.01) -> dict:
    if not ctx.quote.get("verified"):
        return {"status": "DATA NOT VERIFIED", "ticker": ctx.ticker}

    enriched = calculate_indicators(ctx.candles)
    latest = enriched.iloc[-1]

    setup = None
    if breakout_signal(enriched):
        setup = "Breakout Setup"
        entry = float(latest["close"])
        stop = round(float(latest["ema21"]), 2)
        setup_quality = 18
    elif pullback_signal(enriched):
        setup = "Pullback Setup"
        entry = float(latest["close"])
        stop = round(float(latest["ema50"]), 2)
        setup_quality = 16
    else:
        return {
            "status": "watchlist",
            "ticker": ctx.ticker,
            "trigger": round(float(latest["high20"]), 2),
            "needs": "Break above 20-day high with RVOL >= 1.5 and hold above EMA21",
        }

    t1, t2, t3 = _build_targets(entry, stop)
    rr = risk_reward_ratio(entry, stop, t2)
    if rr < 2:
        return {"status": "rejected", "ticker": ctx.ticker, "reason": "Risk/reward below 2:1"}

    catalyst = 0
    main_catalyst = "No major catalyst"
    if ctx.news_items:
        main = ctx.news_items[0]
        main_catalyst = classify_catalyst(main.get("headline", ""))
        catalyst = catalyst_strength(main.get("headline", ""), main.get("hours_old", 999))

    trend = 18 if latest["close"] > latest["sma50"] else 10
    volume = 15 if latest["rel_volume"] >= 1.5 else 8
    rr_points = 15 if rr >= 2.5 else 12
    market = 9 if ctx.market_regime.get("risk_on", False) else 5
    freshness = 5 if ctx.quote.get("freshness_seconds", 9999) <= 120 else 2

    score = weighted_score(trend, volume, setup_quality, catalyst, rr_points, market, freshness)
    rating = rating_from_score(score)
    sizing = calc_position_size(account_size, risk_pct, entry, stop)

    return {
        "status": "research_alert" if score >= 75 else "watchlist",
        "alert": {
            "ticker": ctx.ticker,
            "company": ctx.company,
            "current_price": round(ctx.quote["price"], 2),
            "data_timestamp": ctx.quote["timestamp"].astimezone(timezone.utc).isoformat(),
            "data_source": ctx.quote["source"],
            "data_freshness": f'{ctx.quote["freshness_seconds"]}s',
            "setup_type": setup,
            "confidence_score": score,
            "suggested_entry": round(entry, 2),
            "ideal_entry_zone": f"{round(entry*0.995,2)}-{round(entry*1.005,2)}",
            "stop_loss": stop,
            "target_1": t1,
            "target_2": t2,
            "target_3": t3,
            "risk_reward": round(rr, 2),
            "expected_hold_time": "2-30 trading days",
            "invalidation_level": stop,
            "why_this_trade": f"{setup} with trend/volume confirmation.",
            "main_catalyst": main_catalyst,
            "technical_confirmation": "Price above key moving averages and setup trigger met.",
            "volume_confirmation": f"Relative volume {round(float(latest['rel_volume']),2)}x",
            "market_sector_confirmation": "Market regime aligned" if ctx.market_regime.get("risk_on", False) else "Weak market regime",
            "risks": "Earnings/event risk, volatility expansion risk.",
            "position_sizing": sizing,
            "final_rating": rating,
            "disclaimer": "Research alert only. Not financial advice.",
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
    }
