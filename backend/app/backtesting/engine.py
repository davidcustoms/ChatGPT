def summarize_backtest(trades: list[dict]) -> dict:
    if not trades:
        return {"win_rate": 0, "avg_gain": 0, "avg_loss": 0, "profit_factor": 0, "expectancy": 0}
    wins = [t["pnl"] for t in trades if t["pnl"] > 0]
    losses = [t["pnl"] for t in trades if t["pnl"] <= 0]
    win_rate = len(wins) / len(trades)
    avg_gain = sum(wins) / len(wins) if wins else 0
    avg_loss = sum(losses) / len(losses) if losses else 0
    pf = (sum(wins) / abs(sum(losses))) if losses and sum(losses) != 0 else 0
    expectancy = win_rate * avg_gain + (1 - win_rate) * avg_loss
    return {"win_rate": win_rate, "avg_gain": avg_gain, "avg_loss": avg_loss, "profit_factor": pf, "expectancy": expectancy}
