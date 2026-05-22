def simulate_trade(entry: float, exit_price: float, shares: int) -> dict:
    pnl = (exit_price - entry) * shares
    return {"entry": entry, "exit": exit_price, "shares": shares, "pnl": pnl}
