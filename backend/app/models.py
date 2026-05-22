from datetime import datetime
from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticker: Mapped[str] = mapped_column(String(12), index=True)
    company: Mapped[str] = mapped_column(String(255), default="Unknown")
    setup_type: Mapped[str] = mapped_column(String(64))
    score: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="research_alert")
    price: Mapped[float] = mapped_column(Float)
    entry_zone: Mapped[str] = mapped_column(String(64))
    stop_loss: Mapped[float] = mapped_column(Float)
    target_1: Mapped[float] = mapped_column(Float)
    target_2: Mapped[float] = mapped_column(Float)
    target_3: Mapped[float] = mapped_column(Float)
    risk_reward: Mapped[float] = mapped_column(Float)
    explanation: Mapped[str] = mapped_column(Text)
    data_source: Mapped[str] = mapped_column(String(64))
    data_timestamp: Mapped[datetime] = mapped_column(DateTime)
    data_freshness_seconds: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class WatchlistItem(Base):
    __tablename__ = "watchlist"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticker: Mapped[str] = mapped_column(String(12), index=True)
    trigger_price: Mapped[float] = mapped_column(Float)
    condition_text: Mapped[str] = mapped_column(Text)
    score: Mapped[int] = mapped_column(Integer)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class BacktestResult(Base):
    __tablename__ = "backtest_results"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    setup_type: Mapped[str] = mapped_column(String(64))
    win_rate: Mapped[float] = mapped_column(Float)
    avg_gain: Mapped[float] = mapped_column(Float)
    avg_loss: Mapped[float] = mapped_column(Float)
    max_drawdown: Mapped[float] = mapped_column(Float)
    profit_factor: Mapped[float] = mapped_column(Float)
    expectancy: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
