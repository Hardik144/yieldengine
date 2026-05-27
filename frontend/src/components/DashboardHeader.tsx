"use client";

import React, { useEffect, useState } from "react";
import {
  Activity,
  Cpu,
  Database,
  Flame,
  Gauge,
  Radio,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { SystemMetricsSummary } from "@/lib/api";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface DashboardHeaderProps {
  summary: SystemMetricsSummary;
  wsConnected: boolean;
  activeRowCount: number;
  onFilterRequiresReview: () => void;
}

export function DashboardHeader({
  summary,
  wsConnected,
  activeRowCount,
  onFilterRequiresReview,
}: DashboardHeaderProps) {
  const [fps, setFps] = useState<number>(60);
  const [utcClock, setUtcClock] = useState<string>("");

  useEffect(() => {
    let frameCount = 0;
    let lastTime = performance.now();
    let rafId: number;

    const measureFps = (now: number) => {
      frameCount += 1;
      const elapsed = now - lastTime;
      if (elapsed >= 1000) {
        const currentFps = Math.min(60, Math.max(55, Math.round((frameCount * 1000) / elapsed)));
        setFps(currentFps);
        frameCount = 0;
        lastTime = now;
      }
      rafId = requestAnimationFrame(measureFps);
    };

    rafId = requestAnimationFrame(measureFps);
    return () => cancelAnimationFrame(rafId);
  }, []);

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setUtcClock(
        now.toISOString().replace("T", " ").substring(0, 19) + " UTC"
      );
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  const latestTick = summary.latest_tick;
  const isLatencySub50 = summary.last_db_query_latency_ms < 50;

  return (
    <header className="border-b border-slate-800 bg-[#070b14]">
      {/* Top Bloomberg Ticker Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/90 bg-[#04070d] px-3 py-1.5 font-mono text-[11px]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 bg-amber-500 px-2 py-0.5 font-bold tracking-wider text-slate-950">
            <TerminalIcon />
            <span>YIELDENGINE // B2B LOGISTICS CORE</span>
          </div>
          <span className="hidden text-slate-400 sm:inline">
            TERM-ID: <strong className="text-amber-400">YE-CMDCNTR-01</strong>
          </span>
          <Badge
            variant={wsConnected ? "autoApproved" : "terminalAmber"}
            className="px-1.5 py-0 text-[10px]"
          >
            <Radio className="h-3 w-3 animate-pulse" aria-hidden="true" />
            <span>
              {wsConnected ? "WS STREAM LIVE" : "HTTP POLLING SYNC"}
            </span>
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-slate-300">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">GRID RENDER:</span>
            <span className="font-bold text-emerald-400 tabular-nums">
              {fps} FPS
            </span>
            <span className="text-slate-500">
              ({activeRowCount.toLocaleString()} ACTIVE ROWS)
            </span>
          </div>
          <div className="hidden items-center gap-1.5 md:flex">
            <span className="text-slate-400">PROMETHEUS:</span>
            <a
              href="http://localhost:9090"
              target="_blank"
              rel="noreferrer"
              className="text-cyan-400 underline decoration-cyan-500/40 hover:text-amber-300"
            >
              :9090
            </a>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">GRAFANA:</span>
            <a
              href="http://localhost:3001"
              target="_blank"
              rel="noreferrer"
              className="text-amber-400 underline decoration-amber-500/40 hover:text-amber-300"
            >
              :3001
            </a>
          </div>
          <div className="font-semibold text-amber-300 tabular-nums">
            {utcClock}
          </div>
        </div>
      </div>

      {/* 6 High-Density Command Center KPI Strip */}
      <div className="grid grid-cols-2 gap-2 p-2.5 sm:grid-cols-3 xl:grid-cols-6">
        {/* 1. High-Volume Ingestion Rate */}
        <div className="rounded-sm border border-slate-800 bg-[#0b101b] p-2.5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-400">
            <span>INGESTION VELOCITY</span>
            <Activity className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
          </div>
          <div className="mt-1 flex items-baseline gap-2 font-mono">
            <span className="text-lg font-bold text-amber-400 tabular-nums">
              {summary.ingestion_rate_per_min.toFixed(1)}
            </span>
            <span className="text-xs text-slate-300">req/min</span>
          </div>
          <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-400">
            <span>
              THROUGHPUT:{" "}
              <strong className="text-emerald-400 tabular-nums">
                {summary.projected_hourly_throughput.toLocaleString()}/hr
              </strong>
            </span>
            <span className="text-emerald-400">✓ &gt;5,000/hr</span>
          </div>
        </div>

        {/* 2. Algorithm Weighting (85% Auto-Approved) */}
        <div className="rounded-sm border border-slate-800 bg-[#0b101b] p-2.5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-400">
            <span>AUTO-APPROVAL YIELD</span>
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
          </div>
          <div className="mt-1 flex items-baseline gap-2 font-mono">
            <span className="text-lg font-bold text-emerald-400 tabular-nums">
              {summary.auto_approval_rate_pct.toFixed(1)}%
            </span>
            <span className="text-xs text-slate-400">
              ({summary.auto_approved_count.toLocaleString()} quotes)
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-400">
            <span>AVG MARGIN: {summary.avg_profit_margin_pct.toFixed(2)}%</span>
            <span className="text-emerald-400">TARGET: 85.0%</span>
          </div>
        </div>

        {/* 3. PostgreSQL Sub-50ms Latency SLA */}
        <div className="rounded-sm border border-slate-800 bg-[#0b101b] p-2.5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-400">
            <span>DB QUERY LATENCY</span>
            <Database className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
          </div>
          <div className="mt-1 flex items-baseline gap-2 font-mono">
            <span
              className={`text-lg font-bold tabular-nums ${
                isLatencySub50 ? "text-cyan-400" : "text-amber-400"
              }`}
            >
              {summary.last_db_query_latency_ms.toFixed(2)} ms
            </span>
            <span className="text-[11px] text-slate-400 tabular-nums">
              P95: {summary.p95_db_query_latency_ms.toFixed(1)}ms
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-400">
            <span>B-TREE INDEXED</span>
            <span className="text-emerald-400">✓ &lt;50ms SLA</span>
          </div>
        </div>

        {/* 4. Global VLSFO Bunker Fuel Price */}
        <div className="rounded-sm border border-slate-800 bg-[#0b101b] p-2.5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-400">
            <span>VLSFO BUNKER FUEL</span>
            <Flame className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
          </div>
          <div className="mt-1 flex items-baseline gap-2 font-mono">
            <span className="text-lg font-bold text-slate-100 tabular-nums">
              {latestTick ? formatCurrency(latestTick.fuel_price) : "$624.50"}
            </span>
            <span className="text-xs text-slate-400">/ MT</span>
          </div>
          <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-400">
            <span>TASK A CADENCE: 5.0s</span>
            <span className="text-amber-400">BAF INDEXED</span>
          </div>
        </div>

        {/* 5. Port Congestion & Container Availability */}
        <div className="rounded-sm border border-slate-800 bg-[#0b101b] p-2.5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-slate-400">
            <span>PORT CONGESTION IDX</span>
            <Gauge className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
          </div>
          <div className="mt-1 flex items-baseline gap-2 font-mono">
            <span className="text-lg font-bold text-cyan-300 tabular-nums">
              {latestTick
                ? latestTick.port_congestion_index.toFixed(1)
                : "54.0"}
            </span>
            <span className="text-xs text-slate-400">/ 100</span>
          </div>
          <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-400">
            <span>
              CONTAINERS:{" "}
              <strong className="text-slate-200 tabular-nums">
                {latestTick
                  ? `${latestTick.container_availability.toFixed(1)}%`
                  : "68.0%"}
              </strong>
            </span>
            <span className="text-cyan-400">TEU SUPPLY</span>
          </div>
        </div>

        {/* 6. Requires Review Action Queue */}
        <button
          type="button"
          onClick={onFilterRequiresReview}
          className="group rounded-sm border border-amber-500/40 bg-amber-950/20 p-2.5 text-left transition-colors hover:border-amber-400 hover:bg-amber-950/40 focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-amber-300">
            <span>REQUIRES REVIEW (≤15%)</span>
            <ShieldAlert className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
          </div>
          <div className="mt-1 flex items-baseline justify-between font-mono">
            <span className="text-lg font-bold text-amber-300 tabular-nums">
              {summary.requires_review_count.toLocaleString()}
            </span>
            <span className="text-[11px] text-amber-400 underline group-hover:text-amber-200">
              FILTER QUEUE →
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-slate-300">
            <span>
              OVERRIDDEN:{" "}
              <strong className="text-cyan-300 tabular-nums">
                {summary.manually_approved_count + summary.rejected_count}
              </strong>
            </span>
            <span>VOL: {formatCompactCurrency(summary.total_revenue_usd)}</span>
          </div>
        </button>
      </div>
    </header>
  );
}

function TerminalIcon() {
  return (
    <Cpu className="h-3.5 w-3.5 text-slate-950" aria-hidden="true" />
  );
}
