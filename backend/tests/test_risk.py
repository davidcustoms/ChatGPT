from app.risk.position_sizing import calc_position_size, risk_reward_ratio


def test_position_size_basic():
    out = calc_position_size(10000, 0.01, 25, 24)
    assert out["shares"] == 100


def test_rr():
    assert risk_reward_ratio(10, 9, 12) == 2
