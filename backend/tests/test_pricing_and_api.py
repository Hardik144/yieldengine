import os
import time

os.environ["DATABASE_URL"] = "sqlite:///./test_yieldengine.db"
os.environ["ENABLE_SCHEDULER"] = "false"
os.environ["INITIAL_SEED_QUOTES"] = "1200"
os.environ["INITIAL_SEED_TICKS"] = "120"

from fastapi.testclient import TestClient
from app.main import app
from app.models import QuoteRequest, MarketTick, QuoteStatus
from app.pricing import calculate_dynamic_quote
from app.simulator import simulation_engine


def test_pricing_algorithm_exact_85_percent_weighting():
    """Verify that across 1,000 generated quotes, 85% are Auto-Approved (margin > 15%)."""
    results = [
        calculate_dynamic_quote(
            fuel_price=625.0,
            port_congestion_index=54.0,
            container_availability=68.0,
        )
        for _ in range(1000)
    ]
    auto_approved = [r for r in results if r.status == QuoteStatus.AUTO_APPROVED.value]
    requires_review = [r for r in results if r.status == QuoteStatus.REQUIRES_REVIEW.value]

    assert len(auto_approved) == 850
    assert len(requires_review) == 150
    assert all(r.profit_margin > 15.0 for r in auto_approved)
    assert all(r.profit_margin <= 15.0 for r in requires_review)


def test_sqlalchemy_explicit_indexes():
    """Verify explicit indexes exist on timestamp, status, and client_name."""
    quote_indexes = {idx.name: [c.name for c in idx.columns] for idx in QuoteRequest.__table__.indexes}
    flattened_cols = {col for cols in quote_indexes.values() for col in cols}
    assert "timestamp" in flattened_cols
    assert "status" in flattened_cols
    assert "client_name" in flattened_cols


def test_api_endpoints_and_sub_50ms_latency():
    with TestClient(app) as client:
        # 1. Verify initial seed and sub-50ms query latency on 1,200 quotes
        t0 = time.perf_counter()
        res = client.get("/api/quotes?limit=1200")
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        assert res.status_code == 200
        data = res.json()
        assert data["total_count"] >= 1200
        assert len(data["items"]) == 1200
        assert data["summary"]["auto_approval_rate_pct"] == 85.0
        assert data["query_latency_ms"] < 50.0, f"Expected <50ms DB query, got {data['query_latency_ms']}ms"

        # 2. Verify MarketTicks endpoint returns 10-minute history
        ticks_res = client.get("/api/market-ticks?minutes=10")
        assert ticks_res.status_code == 200
        ticks = ticks_res.json()
        assert len(ticks) >= 100

        # 3. Verify Manual Override workflow for a 'Requires Review' quote
        review_quote = next(
            q for q in data["items"] if q["status"] == "Requires Review"
        )
        new_price = round(review_quote["final_price"] * 1.18, 2)
        override_res = client.patch(
            f"/api/quotes/{review_quote['id']}/override",
            json={
                "final_price": new_price,
                "status": "Manually Approved",
                "notes": "Approved by Senior Pricing Desk",
            },
        )
        assert override_res.status_code == 200
        updated = override_res.json()
        assert updated["final_price"] == new_price
        assert updated["status"] == "Manually Approved"

        # 4. Verify Prometheus /metrics endpoint exposes latency metrics
        metrics_res = client.get("/metrics")
        assert metrics_res.status_code == 200
        body = metrics_res.text
        assert "yieldengine_db_query_latency_seconds" in body
        assert "yieldengine_last_db_query_latency_ms" in body
        assert "yieldengine_quotes_generated_total" in body
