import pandas as pd


def breakout_signal(df: pd.DataFrame) -> bool:
    row = df.iloc[-1]
    return (
        row["close"] >= row["high20"]
        and row["rel_volume"] >= 1.5
        and row["close"] > row["ema9"] > row["ema21"] > row["ema50"]
    )


def pullback_signal(df: pd.DataFrame) -> bool:
    row = df.iloc[-1]
    prev = df.iloc[-2]
    uptrend = row["close"] > row["sma50"] and row["sma50"] > row["sma200"]
    pulled_to_value = row["low"] <= row["ema21"] * 1.01
    bullish_reclaim = row["close"] > prev["close"] and row["close"] > row["ema21"]
    return bool(uptrend and pulled_to_value and bullish_reclaim)
