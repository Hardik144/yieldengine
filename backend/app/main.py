import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import logging
import time
from typing import Optional, List
from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, desc, case
from sqlalchemy.orm import Session

from app.config import settings
from app.database import Base, engine, get_db
from app.models import MarketTick, QuoteRequest, QuoteStatus
from app.pricing import recalculate_margin_for_override
from app.schemas import (
    MarketTickResponse,
    QuoteRequestResponse,
    ManualOverridePayload,
    SystemMetricsSummary,
    PaginatedQuotesResponse,
)
from app.simulator import simulation_engine
from app.metrics import (
    HTTP_REQUEST_LATENCY_SECONDS,
    MANUAL_OVERRIDES_TOTAL,
    AUTO_APPROVAL_RATIO_GAUGE,
    latency_tracker,
    render_prometheus_metrics,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("yieldengine.api")


class WebSocketHub:
    """Broadcasts live MarketTick and QuoteRequest events to connected Next.js clients."""

    def __init__(self):
        self.active_connections: list[WebSocket] = []
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    def broadcast_from_thread(self, payload: dict) -> None:
        if not self._loop or not self.active_connections:
            return
        asyncio.run_coroutine_threadsafe(self.broadcast(payload), self._loop)

    async def broadcast(self, payload: dict) -> None:
        stale: list[WebSocket] = []
        for connection in list(self.active_connections):
            try:
                await connection.send_json(payload)
            except Exception:
                stale.append(connection)
        for conn in stale:
            self.disconnect(conn)


ws_hub = WebSocketHub()
simulation_engine.register_listener(ws_hub.broadcast_from_thread)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Create PostgreSQL tables and explicit indexes
    Base.metadata.create_all(bind=engine)
    ws_hub.set_loop(asyncio.get_running_loop())

    # 2. Seed initial 1,200 quotes and 120 market ticks immediately
    simulation_engine.seed_initial_data_if_empty()

    # 3. Start APScheduler continuous tasks (Task A: 5s MarketTicks, Task B: 83.5/min QuoteRequests)
    if settings.ENABLE_SCHEDULER:
        simulation_engine.start()

    yield

    if settings.ENABLE_SCHEDULER:
        simulation_engine.stop()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description=(
        "Enterprise B2B Logistics Dynamic Pricing & High-Volume Freight Telemetry Engine. "
        "Processes 5,000+ QuoteRequests/hour (83-84/min) with 85% calibrated Auto-Approval."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def prometheus_latency_middleware(request: Request, call_next):
    t0 = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - t0
    HTTP_REQUEST_LATENCY_SECONDS.labels(
        method=request.method,
        endpoint=request.url.path,
        status_code=str(response.status_code),
    ).observe(duration)
    response.headers["X-Response-Time-Ms"] = f"{duration * 1000.0:.2f}"
    return response


def _build_system_summary(db: Session, query_latency_ms: float) -> SystemMetricsSummary:
    counts = db.query(
        func.count(QuoteRequest.id).label("total"),
        func.sum(
            case((QuoteRequest.status == QuoteStatus.AUTO_APPROVED.value, 1), else_=0)
        ).label("auto_approved"),
        func.sum(
            case((QuoteRequest.status == QuoteStatus.REQUIRES_REVIEW.value, 1), else_=0)
        ).label("requires_review"),
        func.sum(
            case(
                (QuoteRequest.status == QuoteStatus.MANUALLY_APPROVED.value, 1),
                else_=0,
            )
        ).label("manually_approved"),
        func.sum(
            case((QuoteRequest.status == QuoteStatus.REJECTED.value, 1), else_=0)
        ).label("rejected"),
        func.avg(QuoteRequest.profit_margin).label("avg_margin"),
        func.sum(QuoteRequest.final_price).label("total_rev"),
    ).one()

    total = int(counts.total or 0)
    auto_approved = int(counts.auto_approved or 0)
    requires_review = int(counts.requires_review or 0)
    manually_approved = int(counts.manually_approved or 0)
    rejected = int(counts.rejected or 0)
    avg_margin = round(float(counts.avg_margin or 0.0), 2)
    total_rev = round(float(counts.total_rev or 0.0), 2)

    # Calculate auto-approval rate across algorithmically generated quotes
    generated_pool = auto_approved + requires_review
    auto_rate_pct = (
        round((auto_approved / generated_pool) * 100.0, 2)
        if generated_pool > 0
        else 85.0
    )
    AUTO_APPROVAL_RATIO_GAUGE.set(auto_rate_pct)

    latest_tick = (
        db.query(MarketTick).order_by(desc(MarketTick.timestamp)).first()
    )
    last_ms, p95_ms = latency_tracker.stats()

    return SystemMetricsSummary(
        total_quotes=total,
        auto_approved_count=auto_approved,
        requires_review_count=requires_review,
        manually_approved_count=manually_approved,
        rejected_count=rejected,
        auto_approval_rate_pct=auto_rate_pct,
        avg_profit_margin_pct=avg_margin,
        total_revenue_usd=total_rev,
        ingestion_rate_per_min=settings.QUOTES_PER_MINUTE,
        projected_hourly_throughput=int(round(settings.QUOTES_PER_MINUTE * 60)),
        last_db_query_latency_ms=query_latency_ms or last_ms,
        p95_db_query_latency_ms=p95_ms,
        latest_tick=MarketTickResponse.model_validate(latest_tick)
        if latest_tick
        else None,
    )


@app.get("/health", tags=["System"])
def health_check(db: Session = Depends(get_db)):
    t0 = time.perf_counter()
    db.execute(func.now())
    db_ms = latency_tracker.record("health_ping", time.perf_counter() - t0)
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "db_latency_ms": db_ms,
        "scheduler_running": simulation_engine.scheduler.running
        if settings.ENABLE_SCHEDULER
        else False,
    }


@app.get("/metrics", tags=["Monitoring"])
def prometheus_metrics():
    """
    Exposes Prometheus metrics including `yieldengine_db_query_latency_seconds`,
    `yieldengine_last_db_query_latency_ms`, `yieldengine_http_request_duration_seconds`,
    `yieldengine_quotes_generated_total`, and `yieldengine_auto_approval_ratio`.
    """
    payload, content_type = render_prometheus_metrics()
    return Response(content=payload, media_type=content_type)


@app.get(
    "/api/market-ticks",
    response_model=List[MarketTickResponse],
    tags=["Telemetry"],
)
def get_market_ticks(
    minutes: int = Query(
        default=10,
        ge=1,
        le=60,
        description="Time window in minutes (default: last 10 minutes)",
    ),
    limit: int = Query(default=150, ge=10, le=500),
    db: Session = Depends(get_db),
):
    """
    Returns simulated global fuel prices and port congestion indices over the last
    `minutes` (default 10 minutes) for the real-time Recharts telemetry line charts.
    Uses the explicit `ix_market_ticks_timestamp_explicit` index for sub-10ms execution.
    """
    t0 = time.perf_counter()
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    ticks = (
        db.query(MarketTick)
        .filter(MarketTick.timestamp >= cutoff)
        .order_by(desc(MarketTick.timestamp))
        .limit(limit)
        .all()
    )
    latency_tracker.record("select_market_ticks", time.perf_counter() - t0)
    # Return in chronological ascending order for Recharts time-series display
    return list(reversed(ticks))


@app.get(
    "/api/quotes",
    response_model=PaginatedQuotesResponse,
    tags=["Quotes"],
)
def get_quotes(
    limit: int = Query(
        default=1200,
        ge=1,
        le=5000,
        description="Number of active quotes to fetch for virtualized grid (default 1,200)",
    ),
    status: Optional[str] = Query(
        default=None,
        description="Optional filter by quote status ('Auto-Approved', 'Requires Review', 'Manually Approved', 'Rejected')",
    ),
    client_name: Optional[str] = Query(
        default=None,
        description="Optional substring or exact filter by enterprise client_name",
    ),
    db: Session = Depends(get_db),
):
    """
    High-performance indexed query returning 1,000+ active quotes for the virtualized
    Next.js data grid along with real-time system KPIs and query latency telemetry.
    Leverages explicit B-tree indexes on `timestamp`, `status`, and `client_name`
    to maintain sub-50ms response times.
    """
    t0 = time.perf_counter()
    query = db.query(QuoteRequest)

    if status and status != "ALL":
        query = query.filter(QuoteRequest.status == status)

    if client_name:
        query = query.filter(QuoteRequest.client_name.ilike(f"%{client_name.strip()}%"))

    items = query.order_by(desc(QuoteRequest.timestamp)).limit(limit).all()
    query_ms = latency_tracker.record("select_quotes_log", time.perf_counter() - t0)

    summary = _build_system_summary(db, query_ms)

    return PaginatedQuotesResponse(
        items=[QuoteRequestResponse.model_validate(item) for item in items],
        total_count=summary.total_quotes,
        query_latency_ms=query_ms,
        summary=summary,
    )


@app.patch(
    "/api/quotes/{quote_id}/override",
    response_model=QuoteRequestResponse,
    tags=["Quotes"],
)
def manual_override_quote(
    quote_id: int,
    payload: ManualOverridePayload,
    db: Session = Depends(get_db),
):
    """
    Interactive workflow endpoint allowing an underwriter to override a quote
    (typically marked 'Requires Review'), input a custom `final_price`, recalculate
    the resulting `profit_margin`, and transition its status to 'Manually Approved'
    or 'Rejected'.
    """
    t0 = time.perf_counter()
    quote = db.query(QuoteRequest).filter(QuoteRequest.id == quote_id).first()
    if not quote:
        raise HTTPException(status_code=404, detail=f"QuoteRequest #{quote_id} not found")

    new_margin = recalculate_margin_for_override(
        base_rate=quote.base_rate,
        original_final_price=quote.final_price,
        original_margin_pct=quote.profit_margin,
        new_final_price=payload.final_price,
    )

    quote.final_price = round(payload.final_price, 2)
    quote.profit_margin = new_margin
    quote.status = payload.status

    db.commit()
    db.refresh(quote)

    latency_tracker.record("update_quote_override", time.perf_counter() - t0)
    MANUAL_OVERRIDES_TOTAL.labels(new_status=payload.status).inc()

    serialized = QuoteRequestResponse.model_validate(quote)
    ws_hub.broadcast_from_thread(
        {
            "type": "quote_override",
            "data": serialized.model_dump(mode="json"),
        }
    )
    return serialized


@app.get(
    "/api/stats",
    response_model=SystemMetricsSummary,
    tags=["System"],
)
def get_system_stats(db: Session = Depends(get_db)):
    t0 = time.perf_counter()
    last_ms, _ = latency_tracker.stats()
    summary = _build_system_summary(db, last_ms)
    latency_tracker.record("select_system_stats", time.perf_counter() - t0)
    return summary


@app.websocket("/ws/stream")
async def websocket_stream(websocket: WebSocket):
    """
    Real-time WebSocket stream pushing every new MarketTick (every 5s),
    inbound QuoteRequest (~83.5/min), and manual override event directly to
    the Next.js Bloomberg command center dashboard.
    """
    await ws_hub.connect(websocket)
    try:
        while True:
            # Keep connection alive and accept optional client ping messages
            msg = await websocket.receive_text()
            if msg == "ping":
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        ws_hub.disconnect(websocket)
    except Exception:
        ws_hub.disconnect(websocket)
