from datetime import datetime
from typing import Optional, List, Literal
from pydantic import BaseModel, Field, ConfigDict


class MarketTickResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    timestamp: datetime
    fuel_price: float = Field(..., description="Global VLSFO bunker fuel price in USD/MT")
    port_congestion_index: float = Field(..., ge=0.0, le=100.0, description="Port congestion index (0-100)")
    container_availability: float = Field(..., ge=0.0, le=100.0, description="Container availability index (0-100%)")


class QuoteRequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    timestamp: datetime
    client_name: str
    cargo_weight: float
    route: str
    base_rate: float
    final_price: float
    profit_margin: float
    status: str


class ManualOverridePayload(BaseModel):
    final_price: float = Field(..., gt=0, description="Custom override final price in USD")
    status: Literal["Manually Approved", "Rejected"] = Field(
        ..., description="Target override status ('Manually Approved' or 'Rejected')"
    )
    notes: Optional[str] = Field(default=None, description="Optional underwriter audit note")


class SystemMetricsSummary(BaseModel):
    total_quotes: int
    auto_approved_count: int
    requires_review_count: int
    manually_approved_count: int
    rejected_count: int
    auto_approval_rate_pct: float
    avg_profit_margin_pct: float
    total_revenue_usd: float
    ingestion_rate_per_min: float
    projected_hourly_throughput: int
    last_db_query_latency_ms: float
    p95_db_query_latency_ms: float
    latest_tick: Optional[MarketTickResponse] = None


class PaginatedQuotesResponse(BaseModel):
    items: List[QuoteRequestResponse]
    total_count: int
    query_latency_ms: float
    summary: SystemMetricsSummary
