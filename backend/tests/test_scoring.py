from app.scanners.scoring import rating_from_score, weighted_score


def test_score_clamped():
    assert weighted_score(50, 50, 50, 0, 0, 0, 0) == 100


def test_rating_levels():
    assert rating_from_score(90) == "A+"
    assert rating_from_score(80) == "A"
    assert rating_from_score(70) == "Watchlist"
    assert rating_from_score(40) == "Avoid"
