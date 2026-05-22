from datetime import datetime
from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    app: str


class QuoteSnapshot(BaseModel):
    ticker: str
    price: float
    timestamp: datetime
    source: str
    freshness_seconds: int
    verified: bool


class AlertOut(BaseModel):
    ticker: str
    setup_type: str
    score: int = Field(ge=0, le=100)
    final_rating: str
    data_source: str
    data_timestamp: datetime
    data_freshness: str
    message: str
