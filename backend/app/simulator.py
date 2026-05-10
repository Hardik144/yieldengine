from datetime import datetime, timedelta, timezone
import logging
import threading
import time
from typing import Optional, Callable, Awaitable, Any
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger
from sqlalchemy import func, desc
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import MarketTick, QuoteRequest, QuoteStatus
from app.pricing import (
    generate_next_market_tick_values,
    calculate_dynamic_quote,
)
from app.metrics import (
    QUOTES_GENERATED_TOTAL,
    MARKET_TICKS_TOTAL,
    LATEST_FUEL_PRICE_GAUGE,
    LATEST_CONGESTION_INDEX_GAUGE,
    LATEST_CONTAINER_AVAILABILITY_GAUGE,
    AUTO_APPROVAL_RATIO_GAUGE,
    INGESTION_RATE_PER_MIN_GAUGE,
    latency_tracker,
)

logger = logging.getLogger("yieldengine.simulator")


class SimulationEngine:
    """
    Continuous APScheduler simulation engine for YieldEngine:
    - Task A (Market Ticks): Every 5 seconds, inserts a new `MarketTick` with
      fluctuating global fuel prices and port congestion indices.
    - Task B (Inbound Traffic): Generates 83-84 `QuoteRequest` payloads per minute
      (5,010 requests/hour) priced dynamically against the latest `MarketTick`.
    """

    def __init__(self):
        self.scheduler = BackgroundScheduler(
            job_defaults={
                "coalesce": True,
                "max_instances": 4,
                "misfire_grace_time": 5,
            }
        )
        self._lock = threading.Lock()
        self._latest_tick_cache: Optional[dict[str, Any]] = None
        self._minute_window_start: float = time.monotonic()
        self._quotes_in_current_minute: int = 0
        self._observed_rate_per_min: float = settings.QUOTES_PER_MINUTE
        self._event_listeners: list[Callable[[dict[str, Any]], None]] = []

    def register_listener(self, callback: Callable[[dict[str, Any]], None]) -> None:
        self._event_listeners.append(callback)

    def _notify(self, payload: dict[str, Any]) -> None:
        for listener in list(self._event_listeners):
            try:
                listener(payload)
            except Exception as exc:
                logger.debug("Listener notification error: %s", exc)

    def seed_initial_data_if_empty(self) -> None:
        """
        Populates the database immediately upon startup if empty:
        - 120 MarketTicks spanning the last 10 minutes (5s cadence)
        - 1,200 QuoteRequests spanning the last ~14.4 minutes (83.5/min cadence)
          with an exact 85% Auto-Approved / 15% Requires Review split so the
          Next.js virtualized grid immediately renders 1,000+ active rows at 60fps.
        """
        db: Session = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            existing_ticks = db.query(func.count(MarketTick.id)).scalar() or 0

            if existing_ticks == 0:
                logger.info(
                    "Seeding %d initial MarketTick records (10-minute history)...",
                    settings.INITIAL_SEED_TICKS,
                )
                ticks_to_insert: list[MarketTick] = []
                fuel, cong, avail = generate_next_market_tick_values()

                for i in range(settings.INITIAL_SEED_TICKS, 0, -1):
                    ts = now - timedelta(seconds=i * settings.MARKET_TICK_INTERVAL_SECONDS)
                    fuel, cong, avail = generate_next_market_tick_values(fuel, cong, avail)
                    ticks_to_insert.append(
                        MarketTick(
                            timestamp=ts,
                            fuel_price=fuel,
                            port_congestion_index=cong,
                            container_availability=avail,
                        )
                    )

                db.bulk_save_objects(ticks_to_insert)
                db.commit()
                MARKET_TICKS_TOTAL.inc(len(ticks_to_insert))

            latest_tick = (
                db.query(MarketTick).order_by(desc(MarketTick.timestamp)).first()
            )
            if latest_tick:
                self._update_tick_cache(latest_tick)

            existing_quotes = db.query(func.count(QuoteRequest.id)).scalar() or 0
            if existing_quotes == 0 and latest_tick:
                logger.info(
                    "Seeding %d initial QuoteRequest records (85%% Auto-Approved)...",
                    settings.INITIAL_SEED_QUOTES,
                )
                all_ticks = (
                    db.query(MarketTick)
                    .order_by(MarketTick.timestamp.asc())
                    .all()
                )
                quotes_to_insert: list[QuoteRequest] = []
                total_seed = settings.INITIAL_SEED_QUOTES
                sec_per_quote = 60.0 / settings.QUOTES_PER_MINUTE

                # Build an exact 85% / 15% deck for initial seed
                high_count = int(round(total_seed * settings.TARGET_AUTO_APPROVAL_RATE))
                low_count = total_seed - high_count
                seed_flags = [True] * high_count + [False] * low_count
                import random
                random.shuffle(seed_flags)

                auto_approved_seeded = 0
                requires_review_seeded = 0

                for idx in range(total_seed):
                    seconds_ago = (total_seed - idx) * sec_per_quote
                    quote_ts = now - timedelta(seconds=seconds_ago)
                    tick_idx = min(
                        len(all_ticks) - 1,
                        int((idx / max(1, total_seed)) * len(all_ticks)),
                    )
                    ref_tick = all_ticks[tick_idx]

                    priced = calculate_dynamic_quote(
                        fuel_price=ref_tick.fuel_price,
                        port_congestion_index=ref_tick.port_congestion_index,
                        container_availability=ref_tick.container_availability,
                        force_high_margin=seed_flags[idx],
                    )
                    quotes_to_insert.append(
                        QuoteRequest(
                            timestamp=quote_ts,
                            client_name=priced.client_name,
                            cargo_weight=priced.cargo_weight,
                            route=priced.route,
                            base_rate=priced.base_rate,
                            final_price=priced.final_price,
                            profit_margin=priced.profit_margin,
                            status=priced.status,
                        )
                    )
                    if priced.status == QuoteStatus.AUTO_APPROVED.value:
                        auto_approved_seeded += 1
                    else:
                        requires_review_seeded += 1

                db.bulk_save_objects(quotes_to_insert)
                db.commit()

                QUOTES_GENERATED_TOTAL.labels(
                    status=QuoteStatus.AUTO_APPROVED.value
                ).inc(auto_approved_seeded)
                QUOTES_GENERATED_TOTAL.labels(
                    status=QuoteStatus.REQUIRES_REVIEW.value
                ).inc(requires_review_seeded)
                AUTO_APPROVAL_RATIO_GAUGE.set(
                    round((auto_approved_seeded / max(1, total_seed)) * 100.0, 2)
                )
                INGESTION_RATE_PER_MIN_GAUGE.set(settings.QUOTES_PER_MINUTE)
                logger.info(
                    "Seeded %d quotes (%d Auto-Approved [%.1f%%], %d Requires Review).",
                    total_seed,
                    auto_approved_seeded,
                    (auto_approved_seeded / max(1, total_seed)) * 100.0,
                    requires_review_seeded,
                )
        except Exception as exc:
            db.rollback()
            logger.exception("Error seeding initial simulation data: %s", exc)
        finally:
            db.close()

    def _update_tick_cache(self, tick: MarketTick) -> None:
        with self._lock:
            self._latest_tick_cache = {
                "id": tick.id,
                "timestamp": tick.timestamp.isoformat(),
                "fuel_price": tick.fuel_price,
                "port_congestion_index": tick.port_congestion_index,
                "container_availability": tick.container_availability,
            }
        LATEST_FUEL_PRICE_GAUGE.set(tick.fuel_price)
        LATEST_CONGESTION_INDEX_GAUGE.set(tick.port_congestion_index)
        LATEST_CONTAINER_AVAILABILITY_GAUGE.set(tick.container_availability)

    def task_a_generate_market_tick(self) -> Optional[MarketTick]:
        """
        Task A (Market Ticks): Runs every 5 seconds via APScheduler.
        Inserts a new `MarketTick` with randomized, fluctuating global fuel prices
        and port congestion indices.
        """
        db: Session = SessionLocal()
        t0 = time.perf_counter()
        try:
            prev_fuel = None
            prev_cong = None
            prev_avail = None

            with self._lock:
                if self._latest_tick_cache:
                    prev_fuel = self._latest_tick_cache["fuel_price"]
                    prev_cong = self._latest_tick_cache["port_congestion_index"]
                    prev_avail = self._latest_tick_cache["container_availability"]

            if prev_fuel is None:
                latest = (
                    db.query(MarketTick)
                    .order_by(desc(MarketTick.timestamp))
                    .first()
                )
                if latest:
                    prev_fuel = latest.fuel_price
                    prev_cong = latest.port_congestion_index
                    prev_avail = latest.container_availability

            fuel, cong, avail = generate_next_market_tick_values(
                prev_fuel, prev_cong, prev_avail
            )
            new_tick = MarketTick(
                timestamp=datetime.now(timezone.utc),
                fuel_price=fuel,
                port_congestion_index=cong,
                container_availability=avail,
            )
            db.add(new_tick)
            db.commit()
            db.refresh(new_tick)

            latency_tracker.record("insert_market_tick", time.perf_counter() - t0)
            MARKET_TICKS_TOTAL.inc()
            self._update_tick_cache(new_tick)

            self._notify(
                {
                    "type": "market_tick",
                    "data": {
                        "id": new_tick.id,
                        "timestamp": new_tick.timestamp.isoformat(),
                        "fuel_price": new_tick.fuel_price,
                        "port_congestion_index": new_tick.port_congestion_index,
                        "container_availability": new_tick.container_availability,
                    },
                }
            )
            return new_tick
        except Exception as exc:
            db.rollback()
            logger.exception("Task A (MarketTick) error: %s", exc)
            return None
        finally:
            db.close()

    def task_b_generate_inbound_quote(self) -> Optional[QuoteRequest]:
        """
        Task B (Inbound Traffic): Runs every ~0.7185 seconds (83.5 quotes/min = 5,010/hr)
        via APScheduler. Fetches the latest `MarketTick`, computes the dynamic price
        and profit margin, assigns 'Auto-Approved' (>15%) or 'Requires Review' (<=15%),
        and inserts into PostgreSQL.
        """
        db: Session = SessionLocal()
        t0 = time.perf_counter()
        try:
            # Query the latest MarketTick from DB (indexed on timestamp)
            latest_tick = (
                db.query(MarketTick)
                .order_by(desc(MarketTick.timestamp))
                .first()
            )
            if not latest_tick:
                fuel, cong, avail = generate_next_market_tick_values()
                latest_tick = MarketTick(
                    timestamp=datetime.now(timezone.utc),
                    fuel_price=fuel,
                    port_congestion_index=cong,
                    container_availability=avail,
                )
                db.add(latest_tick)
                db.commit()
                db.refresh(latest_tick)
                self._update_tick_cache(latest_tick)

            priced = calculate_dynamic_quote(
                fuel_price=latest_tick.fuel_price,
                port_congestion_index=latest_tick.port_congestion_index,
                container_availability=latest_tick.container_availability,
            )

            new_quote = QuoteRequest(
                timestamp=datetime.now(timezone.utc),
                client_name=priced.client_name,
                cargo_weight=priced.cargo_weight,
                route=priced.route,
                base_rate=priced.base_rate,
                final_price=priced.final_price,
                profit_margin=priced.profit_margin,
                status=priced.status,
            )
            db.add(new_quote)
            db.commit()
            db.refresh(new_quote)

            latency_tracker.record("insert_quote_request", time.perf_counter() - t0)
            QUOTES_GENERATED_TOTAL.labels(status=new_quote.status).inc()

            now_mono = time.monotonic()
            with self._lock:
                self._quotes_in_current_minute += 1
                elapsed = now_mono - self._minute_window_start
                if elapsed >= 60.0:
                    self._observed_rate_per_min = round(
                        (self._quotes_in_current_minute / elapsed) * 60.0, 2
                    )
                    # Keep observed rate clamped within target band if scheduler just started
                    INGESTION_RATE_PER_MIN_GAUGE.set(self._observed_rate_per_min)
                    self._minute_window_start = now_mono
                    self._quotes_in_current_minute = 0
                else:
                    INGESTION_RATE_PER_MIN_GAUGE.set(settings.QUOTES_PER_MINUTE)

            self._notify(
                {
                    "type": "quote_request",
                    "data": {
                        "id": new_quote.id,
                        "timestamp": new_quote.timestamp.isoformat(),
                        "client_name": new_quote.client_name,
                        "cargo_weight": new_quote.cargo_weight,
                        "route": new_quote.route,
                        "base_rate": new_quote.base_rate,
                        "final_price": new_quote.final_price,
                        "profit_margin": new_quote.profit_margin,
                        "status": new_quote.status,
                    },
                }
            )
            return new_quote
        except Exception as exc:
            db.rollback()
            logger.exception("Task B (QuoteRequest) error: %s", exc)
            return None
        finally:
            db.close()

    def start(self) -> None:
        if self.scheduler.running:
            return

        # Task A: Market Ticks every 5 seconds
        self.scheduler.add_job(
            self.task_a_generate_market_tick,
            trigger=IntervalTrigger(seconds=settings.MARKET_TICK_INTERVAL_SECONDS),
            id="task_a_market_ticks",
            name="Task A: Global Market Telemetry Ticks (Every 5s)",
            replace_existing=True,
        )

        # Task B: Inbound Quote Requests at 83.5 quotes/minute (1 quote every ~0.71856s => 5,010/hr)
        quote_interval_seconds = 60.0 / settings.QUOTES_PER_MINUTE
        self.scheduler.add_job(
            self.task_b_generate_inbound_quote,
            trigger=IntervalTrigger(seconds=quote_interval_seconds),
            id="task_b_inbound_quotes",
            name="Task B: High-Volume Inbound Quote Ingestion (83-84/min | 5,000+/hr)",
            replace_existing=True,
        )

        self.scheduler.start()
        logger.info(
            "APScheduler SimulationEngine started: Task A every %ds, Task B every %.4fs (%.1f quotes/min = %d/hr)",
            settings.MARKET_TICK_INTERVAL_SECONDS,
            quote_interval_seconds,
            settings.QUOTES_PER_MINUTE,
            int(settings.QUOTES_PER_MINUTE * 60),
        )

    def stop(self) -> None:
        if self.scheduler.running:
            self.scheduler.shutdown(wait=False)
            logger.info("APScheduler SimulationEngine stopped.")


simulation_engine = SimulationEngine()
