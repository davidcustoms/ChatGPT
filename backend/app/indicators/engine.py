import pandas as pd


def calculate_indicators(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["ema9"] = out["close"].ewm(span=9, adjust=False).mean()
    out["ema21"] = out["close"].ewm(span=21, adjust=False).mean()
    out["ema50"] = out["close"].ewm(span=50, adjust=False).mean()
    out["sma50"] = out["close"].rolling(50).mean()
    out["sma200"] = out["close"].rolling(200).mean()
    out["vol_avg20"] = out["volume"].rolling(20).mean()
    out["rel_volume"] = out["volume"] / out["vol_avg20"]
    out["high20"] = out["high"].rolling(20).max()
    return out
