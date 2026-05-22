from datetime import datetime
from sqlalchemy.orm import Session

from .models import Alert, WatchlistItem


def save_scan_result(db: Session, result: dict) -> None:
    status = result.get("status")
    if status == "research_alert" and result.get("alert"):
        a = result["alert"]
        row = Alert(
            ticker=a["ticker"],
            company=a.get("company", a["ticker"]),
            setup_type=a["setup_type"],
            score=a["confidence_score"],
            status="research_alert",
            price=a["current_price"],
            entry_zone=a["ideal_entry_zone"],
            stop_loss=a["stop_loss"],
            target_1=a["target_1"],
            target_2=a["target_2"],
            target_3=a["target_3"],
            risk_reward=a["risk_reward"],
            explanation=a["why_this_trade"],
            data_source=a["data_source"],
            data_timestamp=datetime.fromisoformat(a["created_at"].replace("Z", "+00:00")),
            data_freshness_seconds=int(str(a["data_freshness"]).replace("s", "")),
        )
        db.add(row)
    elif status == "watchlist":
        row = WatchlistItem(
            ticker=result["ticker"],
            trigger_price=result.get("trigger", 0),
            condition_text=result.get("needs", "Waiting for trigger"),
            score=result.get("score", 0),
            active=True,
        )
        db.add(row)
    db.commit()
