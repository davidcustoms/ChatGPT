from datetime import datetime, timezone

from .schemas import AlertOut
from .scanners.scoring import rating_from_score


def build_alert_message(ticker: str, setup_type: str, score: int, source: str, data_ts: datetime, freshness: int) -> AlertOut:
    rating = rating_from_score(score)
    freshness_text = f"{freshness}s"
    message = f"ALERT: {ticker} — {setup_type} — Score {score}/100"
    return AlertOut(
        ticker=ticker,
        setup_type=setup_type,
        score=score,
        final_rating=rating,
        data_source=source,
        data_timestamp=data_ts.astimezone(timezone.utc),
        data_freshness=freshness_text,
        message=message,
    )
