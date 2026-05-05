import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROJECT_NAME: str = "YieldEngine B2B Logistics Core"
    VERSION: str = "2.4.0-ENTERPRISE"
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql://yieldengine:yieldengine_secret@postgres:5432/yieldengine_db",
    )
    # High-Volume Ingestion target: 83-84 QuoteRequest payloads/min => 5,000+ requests/hour
    QUOTES_PER_MINUTE: float = float(os.getenv("QUOTES_PER_MINUTE", "83.5"))
    MARKET_TICK_INTERVAL_SECONDS: int = int(os.getenv("MARKET_TICK_INTERVAL_SECONDS", "5"))
    # Algorithm Weighting target: 85% of generated quotes yield profit_margin > 15% ('Auto-Approved')
    TARGET_AUTO_APPROVAL_RATE: float = float(os.getenv("TARGET_AUTO_APPROVAL_RATE", "0.85"))
    MARGIN_THRESHOLD_PERCENT: float = float(os.getenv("MARGIN_THRESHOLD_PERCENT", "15.0"))
    # Seed 1,200 quotes and 120 ticks (last 10 mins) on startup for immediate 1,000+ row virtualization
    INITIAL_SEED_QUOTES: int = int(os.getenv("INITIAL_SEED_QUOTES", "1200"))
    INITIAL_SEED_TICKS: int = int(os.getenv("INITIAL_SEED_TICKS", "120"))
    ENABLE_SCHEDULER: bool = os.getenv("ENABLE_SCHEDULER", "true").lower() == "true"


settings = Settings()
