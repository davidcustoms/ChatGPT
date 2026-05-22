def risk_reward_ratio(entry: float, stop: float, target: float) -> float:
    risk = max(entry - stop, 0)
    reward = max(target - entry, 0)
    if risk == 0:
        return 0.0
    return reward / risk


def calc_position_size(account_size: float, risk_pct: float, entry: float, stop: float) -> dict:
    risk_pct = min(risk_pct, 0.02)
    risk_dollars = account_size * risk_pct
    per_share = abs(entry - stop)
    if per_share <= 0:
        return {"shares": 0, "risk_dollars": risk_dollars, "warning": "Invalid stop distance"}
    shares = int(risk_dollars // per_share)
    warning = None
    if per_share / entry > 0.08:
        warning = "Stop is wide (>8% of price)."
    return {"shares": shares, "risk_dollars": round(risk_dollars, 2), "warning": warning}
