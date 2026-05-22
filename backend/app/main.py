from fastapi import FastAPI

from .database import Base, engine
from .routes.health import router as health_router
from .routes.scan import router as scan_router

Base.metadata.create_all(bind=engine)

app = FastAPI(title="SwingTrader Pro Agent", version="0.1.0")
app.include_router(health_router, prefix="/api")
app.include_router(scan_router, prefix="/api")
