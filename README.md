# SwingTrader Pro Agent

Production-oriented MVP for US swing-trade research alerts with FastAPI backend, modular scanners, scoring, risk controls, scheduling, and dashboard shell.

## Quick Start

1. Create env file:
```bash
cp .env.example .env
```
2. Install:
```bash
pip install -r requirements.txt
```
3. Run API:
```bash
uvicorn backend.app.main:app --reload
```
4. Test:
```bash
PYTHONPATH=backend pytest -q
```

## How to Use

- Health check: `GET /api/health`
- Scan one ticker (live quote + candles + news + scoring): `GET /api/scan/{ticker}`
- Run daily scan batch on liquid universe: `GET /api/scan/daily?limit=10`

Responses are **research alerts only**. If live data cannot be verified, endpoint returns `DATA NOT VERIFIED`.

## Required API Keys
- `POLYGON_API_KEY` (required for verified quotes + candles)
- `FINNHUB_API_KEY` (used for catalyst/news ranking)

## MVP Coverage
- Live quote verification + historical candles ingestion
- Indicator engine (EMA/SMA/RVOL/20D high)
- Breakout + pullback setup detection
- Weighted scoring and rating gates
- Risk/reward and position-sizing checks
- Catalyst classification + staleness handling
- Daily scan endpoint and modular orchestration

## Next Improvements
- Full US universe with liquidity/market-cap/spread filters
- SPY/QQQ/IWM/VIX market regime scoring
- Alert delivery (Telegram/Discord/Email)
- Persistent alert/watchlist/rejection tables in routes
- Backtesting + paper trading dashboard pages
