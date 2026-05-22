def weighted_score(trend: int, volume: int, quality: int, catalyst: int, rr: int, market: int, freshness: int) -> int:
    total = trend + volume + quality + catalyst + rr + market + freshness
    return max(0, min(100, total))


def rating_from_score(score: int) -> str:
    if score >= 85:
        return "A+"
    if score >= 75:
        return "A"
    if score >= 65:
        return "Watchlist"
    return "Avoid"
