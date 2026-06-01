# YieldEngine // Enterprise B2B Logistics Dynamic Pricing & Telemetry Platform

![Next.js](https://img.shields.io/badge/Next.js-15-black?style=flat-square&logo=next.js)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square&logo=fastapi)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=flat-square&logo=postgresql)
![Prometheus](https://img.shields.io/badge/Prometheus-v2.55-E6522C?style=flat-square&logo=prometheus)
![Grafana](https://img.shields.io/badge/Grafana-11.3-F46800?style=flat-square&logo=grafana)

**YieldEngine** is a full-stack enterprise B2B freight pricing and telemetry command center built with **Next.js (App Router)**, **FastAPI**, **PostgreSQL**, **SQLAlchemy**, **APScheduler**, **Prometheus**, and **Grafana**.

It simulates high-volume enterprise logistics quote ingestion (`5,000+ requests/hour`), dynamically prices freight contracts against real-time global bunker fuel and port congestion telemetry, maintains **sub-50ms** PostgreSQL query latency via explicit B-tree indexing, and renders **1,000+ active quotes at 60 FPS** in a dense dark-mode Bloomberg-style command center.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Performance & Load Targets](#performance--load-targets)
3. [Database Schema & Indexing](#database-schema--indexing)
4. [Dynamic Pricing & Simulation Engine](#dynamic-pricing--simulation-engine)
5. [API Endpoints & WebSocket Stream](#api-endpoints--websocket-stream)
6. [Frontend Command Center](#frontend-command-center)
7. [Quick Start (Docker Compose)](#quick-start-docker-compose)
8. [Prometheus & Grafana Monitoring](#prometheus--grafana-monitoring)
9. [Running Tests](#running-tests)
10. [Project Structure](#project-structure)

---

## System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    Next.js 15 Command Center (:3000)                    │
│  • 60 FPS Virtualized Blotter (@tanstack/react-virtual)                 │
│  • 10-Min Market Telemetry Charts (Recharts)                            │
│  • Native <dialog> Manual Underwriter Override Modal                    │
└───────────────────────────┬──────────────────────────┬──────────────────┘
                            │ HTTP REST                │ WebSocket (/ws/stream)
┌───────────────────────────▼──────────────────────────▼──────────────────┐
│                 FastAPI + APScheduler Backend (:8000)                   │
│  • Task A (5s): Global MarketTick Generator (Fuel, Congestion, TEU)     │
│  • Task B (83.5/min): Inbound QuoteRequest Ingestion & Dynamic Pricing  │
│  • Prometheus /metrics Exporter (Latency Histograms & Yield Gauges)     │
└──────────┬─────────────────────────────────────────────┬────────────────┘
           │ SQLAlchemy ORM (Pool: 20+40)                │ Scrape (5s)
┌──────────▼──────────────────────┐           ┌──────────▼────────────────┐
│       PostgreSQL 16 (:5432)     │           │    Prometheus (:9090)     │
│  • market_ticks (indexed)       │           └──────────┬────────────────┘
│  • quote_requests (indexed)     │                      │ Datasource
└─────────────────────────────────┘           ┌──────────▼────────────────┐
                                              │      Grafana (:3001)      │
                                              │  Pre-provisioned SLA Dash │
                                              └───────────────────────────┘
```

---

## Performance & Load Targets

| Metric | Target | Implementation |
| :--- | :--- | :--- |
| **Inbound Quote Ingestion** | **83–84 quotes/min** (`5,000+ req/hr`) | APScheduler `IntervalTrigger(seconds=60.0 / 83.5)` (`83.5/min` = `5,010/hr`) |
| **Auto-Approval Calibration** | **85.0% Auto-Approved** (`margin > 15%`) | `StratifiedQuantileSampler` + beta-distributed yield spreads in `pricing.py` |
| **Database Query Latency** | **< 50 ms** | Explicit SQLAlchemy B-tree indexes on `timestamp`, `status`, `client_name` |
| **Frontend Grid Rendering** | **60 FPS** for `1,000+` active rows | `@tanstack/react-virtual` row windowing + live hardware FPS monitor |
| **Market Telemetry Cadence** | **Every 5 seconds** | Ornstein-Uhlenbeck mean-reverting process for fuel & congestion |

---

## Database Schema & Indexing

Defined in [`backend/app/models.py`](backend/app/models.py):

### 1. `market_ticks` (`MarketTick`)
- `id` (PK, Integer, Auto-increment)
- `timestamp` (DateTime UTC, **Indexed**: `ix_market_ticks_timestamp_explicit`)
- `fuel_price` (Float — VLSFO bunker fuel in `$/MT`)
- `port_congestion_index` (Float — `0` to `100`)
- `container_availability` (Float — `0%` to `100%`)

### 2. `quote_requests` (`QuoteRequest`)
- `id` (PK, Integer, Auto-increment)
- `timestamp` (DateTime UTC, **Indexed**: `ix_quote_requests_timestamp_explicit`)
- `client_name` (String(128), **Indexed**: `ix_quote_requests_client_name_explicit`)
- `cargo_weight` (Float — metric tons)
- `route` (String(128) — e.g. `SHA-LAX (Shanghai → Los Angeles)`)
- `base_rate` (Float)
- `final_price` (Float)
- `profit_margin` (Float — percentage)
- `status` (String(32), **Indexed**: `ix_quote_requests_status_explicit`, composite `ix_quote_requests_status_timestamp`)
  - Values: `Auto-Approved`, `Requires Review`, `Manually Approved`, `Rejected`

---

## Dynamic Pricing & Simulation Engine

### Task A — Market Ticks (`backend/app/simulator.py`)
Every **5 seconds**, `task_a_generate_market_tick` generates a new `MarketTick` using a mean-reverting Ornstein-Uhlenbeck stochastic process:
- **Fuel Price**: Mean ~$625/MT, bounded `[480, 790]`
- **Port Congestion Index**: Mean ~54.0, bounded `[12, 96]`
- **Container Availability**: Inversely correlated with congestion, bounded `[15, 98]`

### Task B — Inbound Quote Traffic & Pricing (`backend/app/pricing.py`)
Every **0.7185 seconds** (`83.5/min` = `5,010/hr`), `task_b_generate_inbound_quote` fetches the latest `MarketTick` and computes:
1. **Base Rate**: Lane fixed tariff + volume-tiered cargo weight rate.
2. **Market Surcharges**:
   - **Bunker Adjustment Factor (BAF)**: Derived from `fuel_price / 600.0`
   - **Port Congestion Surcharge (PCS)**: Derived from `port_congestion_index / 100.0`
   - **Equipment Imbalance Surcharge (EIS)**: Derived from `(100.0 - container_availability) / 100.0`
3. **Margin Classification**:
   - **85.0%** of quotes price above `15.0%` margin → **`Auto-Approved`**
   - **15.0%** of quotes price at or below `15.0%` margin → **`Requires Review`**

Upon startup, `seed_initial_data_if_empty()` immediately populates **120 `MarketTick` records** (10-minute history) and **1,200 `QuoteRequest` records** so the dashboard is immediately live.

---

## API Endpoints & WebSocket Stream

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Service health check, PostgreSQL ping latency, and scheduler status |
| `GET` | `/api/quotes` | Fetch indexed quotes (`limit`, `status`, `client_name`) + `query_latency_ms` & KPI summary |
| `GET` | `/api/market-ticks` | Fetch last `minutes` (default `10`) of `MarketTick` telemetry |
| `PATCH` | `/api/quotes/{quote_id}/override` | Submit custom `final_price` and transition status to `Manually Approved` or `Rejected` |
| `GET` | `/api/stats` | System KPI summary snapshot |
| `GET` | `/metrics` | Prometheus metrics endpoint (`yieldengine_db_query_latency_seconds`, etc.) |
| `WS` | `/ws/stream` | Real-time WebSocket stream pushing `market_tick`, `quote_request`, and `quote_override` events |

---

## Frontend Command Center

- **Bloomberg Terminal Aesthetic**: Dense dark-mode UI (`#06090f` canvas, `#0b101b` panels, amber/cyan/emerald tabular monospace telemetry).
- **60 FPS Virtualized Blotter**: Renders `1,200+` active quotes smoothly with sticky headers, status filter pills, and instant client/route search.
- **10-Minute Recharts Telemetry**: Dual time-series charts tracking global VLSFO fuel prices and Port Congestion vs. Container Availability.
- **Interactive Underwriter Override**: Click any row marked **`Requires Review`** to open the native `<dialog>` modal, preview the recalculated profit margin with quick presets (`16%`, `20%`, `25%`), and submit **`Manually Approved`** or **`Rejected`**.

---

## Quick Start (Docker Compose)

Spin up PostgreSQL, FastAPI + APScheduler, Next.js Frontend, Prometheus, and Grafana simultaneously:

```bash
docker compose up -d --build
```

### Service URLs
- **Next.js Command Center**: [http://localhost:3000](http://localhost:3000)
- **FastAPI OpenAPI Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Prometheus Metrics**: [http://localhost:8000/metrics](http://localhost:8000/metrics)
- **Prometheus UI**: [http://localhost:9090](http://localhost:9090)
- **Grafana SLA Dashboard**: [http://localhost:3001/d/yieldengine-enterprise-sla](http://localhost:3001/d/yieldengine-enterprise-sla) (`admin` / `admin`)

To stop all services:
```bash
docker compose down
```

---

## Prometheus & Grafana Monitoring

Prometheus scrapes `backend:8000/metrics` every **5 seconds** (`monitoring/prometheus/prometheus.yml`). Grafana is pre-provisioned with the Prometheus datasource and the **YieldEngine Enterprise B2B Logistics Telemetry & Latency SLA** dashboard (`monitoring/grafana/dashboards/yieldengine-overview.json`), tracking:
- `yieldengine_last_db_query_latency_ms` & P95 `yieldengine_db_query_latency_seconds_bucket`
- `yieldengine_ingestion_rate_quotes_per_minute`
- `yieldengine_auto_approval_ratio`
- `yieldengine_latest_fuel_price_usd`, `yieldengine_latest_port_congestion_index`, `yieldengine_latest_container_availability_index`

---

## Running Tests

Run the backend test suite (validates 85% auto-approval calibration, SQLAlchemy indexes, sub-50ms query latency, manual overrides, and Prometheus `/metrics`):

```bash
cd backend
pytest -v
```

---

## Project Structure

```text
.
├── backend/
│   ├── app/
│   │   ├── config.py          # Environment & simulation targets (83.5/min, 85%)
│   │   ├── database.py        # SQLAlchemy engine & connection pooling
│   │   ├── main.py            # FastAPI routes, WebSocket hub, middleware
│   │   ├── metrics.py         # Prometheus histograms, gauges, counters
│   │   ├── models.py          # MarketTick & QuoteRequest + B-tree indexes
│   │   ├── pricing.py         # Dynamic pricing & StratifiedQuantileSampler
│   │   ├── schemas.py         # Pydantic v2 request/response schemas
│   │   └── simulator.py       # APScheduler Task A (5s) & Task B (83.5/min)
│   ├── tests/
│   │   └── test_pricing_and_api.py
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── globals.css    # Dark-mode tokens, dialog & responsive-table CSS
│   │   │   ├── layout.tsx     # Root HTML layout & color-scheme meta
│   │   │   └── page.tsx       # Main command center & WebSocket client
│   │   ├── components/
│   │   │   ├── DashboardHeader.tsx
│   │   │   ├── ManualOverrideModal.tsx
│   │   │   ├── MarketTelemetryCharts.tsx
│   │   │   ├── VirtualizedQuoteGrid.tsx
│   │   │   └── ui/            # badge, button, card, input
│   │   └── lib/
│   │       ├── api.ts
│   │       └── utils.ts
│   ├── Dockerfile
│   ├── next.config.mjs
│   ├── package.json
│   └── tailwind.config.ts
├── monitoring/
│   ├── grafana/
│   │   ├── dashboards/yieldengine-overview.json
│   │   └── provisioning/
│   └── prometheus/prometheus.yml
├── docker-compose.yml
├── .gitignore
└── README.md
```
