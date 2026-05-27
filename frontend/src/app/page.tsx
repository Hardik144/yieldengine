"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMarketTicks,
  fetchQuotes,
  getWebSocketUrl,
  ManualOverridePayload,
  MarketTick,
  QuoteRequest,
  submitManualOverride,
  SystemMetricsSummary,
} from "@/lib/api";
import { DashboardHeader } from "@/components/DashboardHeader";
import { MarketTelemetryCharts } from "@/components/MarketTelemetryCharts";
import { VirtualizedQuoteGrid } from "@/components/VirtualizedQuoteGrid";
import { ManualOverrideModal } from "@/components/ManualOverrideModal";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Layers, RefreshCw, Server, Terminal } from "lucide-react";

const INITIAL_SUMMARY: SystemMetricsSummary = {
  total_quotes: 1200,
  auto_approved_count: 1020,
  requires_review_count: 180,
  manually_approved_count: 0,
  rejected_count: 0,
  auto_approval_rate_pct: 85.0,
  avg_profit_margin_pct: 19.85,
  total_revenue_usd: 14850240.0,
  ingestion_rate_per_min: 83.5,
  projected_hourly_throughput: 5010,
  last_db_query_latency_ms: 4.12,
  p95_db_query_latency_ms: 7.85,
  latest_tick: null,
};

export default function YieldEngineCommandCenter() {
  const [quotes, setQuotes] = useState<QuoteRequest[]>([]);
  const [ticks, setTicks] = useState<MarketTick[]>([]);
  const [summary, setSummary] = useState<SystemMetricsSummary>(INITIAL_SUMMARY);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedQuote, setSelectedQuote] = useState<QuoteRequest | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const loadInitialAndPoll = useCallback(async () => {
    try {
      const [quotesRes, ticksRes] = await Promise.all([
        fetchQuotes(1500),
        fetchMarketTicks(10),
      ]);
      setQuotes(quotesRes.items);
      setSummary(quotesRes.summary);
      setTicks(ticksRes);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch {
      // If backend isn't reachable yet during container boot, retry on next poll
    }
  }, []);

  useEffect(() => {
    loadInitialAndPoll();
    const pollInterval = setInterval(loadInitialAndPoll, 3000);
    return () => clearInterval(pollInterval);
  }, [loadInitialAndPoll]);

  // Connect to FastAPI WebSocket stream for instant sub-second ingestion updates
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connectWs = () => {
      try {
        ws = new WebSocket(getWebSocketUrl());
        wsRef.current = ws;

        ws.onopen = () => {
          setWsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "market_tick" && msg.data) {
              const newTick: MarketTick = msg.data;
              setTicks((prev) => {
                const updated = [...prev.slice(-119), newTick];
                return updated;
              });
              setSummary((prev) => ({
                ...prev,
                latest_tick: newTick,
              }));
            } else if (msg.type === "quote_request" && msg.data) {
              const newQuote: QuoteRequest = msg.data;
              setQuotes((prev) => [newQuote, ...prev.slice(0, 1499)]);
              setSummary((prev) => {
                const isAuto = newQuote.status === "Auto-Approved";
                const newAuto = prev.auto_approved_count + (isAuto ? 1 : 0);
                const newReview =
                  prev.requires_review_count + (!isAuto ? 1 : 0);
                const pool = newAuto + newReview;
                return {
                  ...prev,
                  total_quotes: prev.total_quotes + 1,
                  auto_approved_count: newAuto,
                  requires_review_count: newReview,
                  auto_approval_rate_pct:
                    pool > 0
                      ? Number(((newAuto / pool) * 100).toFixed(2))
                      : 85.0,
                  total_revenue_usd:
                    prev.total_revenue_usd + newQuote.final_price,
                };
              });
            } else if (msg.type === "quote_override" && msg.data) {
              const updatedQuote: QuoteRequest = msg.data;
              setQuotes((prev) =>
                prev.map((q) => (q.id === updatedQuote.id ? updatedQuote : q))
              );
            }
          } catch {
            // ignore malformed frame
          }
        };

        ws.onclose = () => {
          setWsConnected(false);
          reconnectTimer = setTimeout(connectWs, 3000);
        };

        ws.onerror = () => {
          setWsConnected(false);
        };
      } catch {
        setWsConnected(false);
      }
    };

    connectWs();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.close();
      }
    };
  }, []);

  const handleManualOverrideSubmit = async (
    quoteId: number,
    payload: ManualOverridePayload
  ) => {
    const updated = await submitManualOverride(quoteId, payload);
    setQuotes((prev) => prev.map((q) => (q.id === quoteId ? updated : q)));
    setToastMessage(
      `Quote #${quoteId} overridden → ${updated.status} at $${updated.final_price.toFixed(
        2
      )} (${updated.profit_margin.toFixed(2)}% margin)`
    );
    setTimeout(() => setToastMessage(null), 5000);
    await loadInitialAndPoll();
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#06090f] text-slate-100">
      {/* Top Command Center Header & 6 KPI Telemetry Cards */}
      <DashboardHeader
        summary={summary}
        wsConnected={wsConnected}
        activeRowCount={quotes.length}
        onFilterRequiresReview={() =>
          setStatusFilter((prev) =>
            prev === "Requires Review" ? "ALL" : "Requires Review"
          )
        }
      />

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center justify-between border-b border-emerald-500/50 bg-emerald-950/80 px-4 py-1.5 font-mono text-xs text-emerald-200"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
            <strong>OVERRIDE COMMITTED TO POSTGRESQL:</strong> {toastMessage}
          </span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-[11px] uppercase underline hover:text-white"
          >
            DISMISS
          </button>
        </div>
      )}

      {/* Main Split Command Center Workspace */}
      <main className="grid flex-1 grid-cols-1 gap-2.5 p-2.5 lg:grid-cols-12">
        {/* Left/Center 8 Columns: Virtualized 1,000+ Quote Blotter */}
        <section
          aria-label="Virtualized Inbound Freight Quotes Blotter"
          className="flex h-[calc(100vh-195px)] min-h-[540px] flex-col lg:col-span-8"
        >
          <VirtualizedQuoteGrid
            quotes={quotes}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            onSelectQuoteForOverride={(quote) => setSelectedQuote(quote)}
            queryLatencyMs={summary.last_db_query_latency_ms}
          />
        </section>

        {/* Right 4 Columns: 10-Minute Recharts Telemetry & Engine Architecture Spec */}
        <aside
          aria-label="Real-Time Market Telemetry and Engine Status"
          className="flex flex-col gap-2.5 lg:col-span-4"
        >
          <MarketTelemetryCharts ticks={ticks} />

          {/* Pricing Algorithm & SLA Telemetry Card */}
          <div className="flex-1 rounded-sm border border-slate-800 bg-[#0b101b] p-3 font-mono text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-amber-400">
                <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
                <span>PRICING ENGINE &amp; SLA TELEMETRY</span>
              </div>
              <Badge variant="autoApproved" className="text-[10px]">
                NOMINAL
              </Badge>
            </div>

            <div className="mt-2.5 space-y-2 text-[11px] text-slate-300">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">APSCHEDULER TASK A:</span>
                <span className="font-semibold text-amber-300">
                  MarketTick @ 5.0s Interval
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">APSCHEDULER TASK B:</span>
                <span className="font-semibold text-emerald-400">
                  83.5 Quotes/min (5,010/hr)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">ALGO WEIGHTING TARGET:</span>
                <span className="font-semibold text-emerald-400">
                  85.0% Auto-Approve (&gt;15% Margin)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">POSTGRESQL INDEXING:</span>
                <span className="text-cyan-300">
                  timestamp, status, client_name
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">PROMETHEUS METRICS:</span>
                <a
                  href="http://localhost:8000/metrics"
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 underline hover:text-amber-300"
                >
                  /metrics (Sub-50ms Histogram)
                </a>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-slate-800/80 pt-2 text-[10px] text-slate-400">
              <span className="flex items-center gap-1">
                <Server className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                SYNC: {lastUpdated || "INITIALIZING..."}
              </span>
              <button
                type="button"
                onClick={loadInitialAndPoll}
                className="inline-flex items-center gap-1 text-amber-400 hover:text-amber-300"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                <span>FORCE SYNC</span>
              </button>
            </div>
          </div>
        </aside>
      </main>

      {/* Manual Override Native <dialog> Modal */}
      <ManualOverrideModal
        quote={selectedQuote}
        onClose={() => setSelectedQuote(null)}
        onSubmitOverride={handleManualOverrideSubmit}
      />
    </div>
  );
}
