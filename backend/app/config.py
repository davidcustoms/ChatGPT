from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "SwingTrader Pro Agent"
    environment: str = "development"
    database_url: str = "sqlite:///./swingtrader.db"

    polygon_api_key: str | None = None
    finnhub_api_key: str | None = None
    benzinga_api_key: str | None = None
    fmp_api_key: str | None = None
    alpaca_api_key: str | None = None

    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None
    discord_webhook_url: str | None = None
    smtp_host: str | None = None
    smtp_user: str | None = None
    smtp_password: str | None = None

    scan_timezone: str = "America/New_York"
    min_score_for_alert: int = 75
    default_risk_pct: float = 0.01

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
