from datetime import datetime, timezone
from enum import Enum
from sqlalchemy import Column, Integer, Float, String, DateTime, Index
from app.database import Base


class QuoteStatus(str, Enum):
    AUTO_APPROVED = "Auto-Approved"
    REQUIRES_REVIEW = "Requires Review"
    MANUALLY_APPROVED = "Manually Approved"
    REJECTED = "Rejected"


class MarketTick(Base):
    """
    Real-time global freight telemetry tick inserted every 5 seconds.
    Tracks global bunker fuel prices ($/MT), port congestion (0-100),
    and container availability index (0-100%).
    """

    __tablename__ = "market_ticks"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    timestamp = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    fuel_price = Column(Float, nullable=False)
    port_congestion_index = Column(Float, nullable=False)
    container_availability = Column(Float, nullable=False)

    __table_args__ = (
        Index("ix_market_ticks_timestamp_explicit", "timestamp"),
    )


class QuoteRequest(Base):
    """
    Inbound enterprise B2B freight quote request priced dynamically against
    the latest MarketTick telemetry.
    Explicitly indexed on timestamp, status, and client_name to guarantee
    sub-50ms query execution under 5,000+ req/hr ingestion load.
    """

    __tablename__ = "quote_requests"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    timestamp = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    client_name = Column(String(128), nullable=False, index=True)
    cargo_weight = Column(Float, nullable=False)
    route = Column(String(128), nullable=False)
    base_rate = Column(Float, nullable=False)
    final_price = Column(Float, nullable=False)
    profit_margin = Column(Float, nullable=False)
    status = Column(
        String(32),
        nullable=False,
        default=QuoteStatus.AUTO_APPROVED.value,
        index=True,
    )

    __table_args__ = (
        Index("ix_quote_requests_timestamp_explicit", "timestamp"),
        Index("ix_quote_requests_status_explicit", "status"),
        Index("ix_quote_requests_client_name_explicit", "client_name"),
        Index("ix_quote_requests_status_timestamp", "status", "timestamp"),
    )
