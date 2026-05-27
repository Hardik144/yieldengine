"use client";

import React, { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { MarketTick } from "@/lib/api";
import { formatTimeShort } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface MarketTelemetryChartsProps {
  ticks: MarketTick[];
}

export function MarketTelemetryCharts({ ticks }: MarketTelemetryChartsProps) {
  const chartData = useMemo(() => {
    return ticks.map((t) => ({
      id: t.id,
      timeLabel: formatTimeShort(t.timestamp),
      fuel_price: Number(t.fuel_price.toFixed(2)),
      port_congestion_index: Number(t.port_congestion_index.toFixed(2)),
      container_availability: Number(t.container_availability.toFixed(2)),
    }));
  }, [ticks]);

  const latest = chartData[chartData.length - 1];
  const first = chartData[0];
  const fuelDelta =
    latest && first ? (latest.fuel_price - first.fuel_price).toFixed(2) : "0.00";
  const congDelta =
    latest && first
      ? (latest.port_congestion_index - first.port_congestion_index).toFixed(2)
      : "0.00";

  return (
    <div className="flex flex-col gap-2.5">
      {/* Chart 1: Simulated Global Fuel Prices (Last 10 Minutes) */}
      <Card className="border-slate-800 bg-[#0b101b]">
        <CardHeader className="py-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-[11px] text-amber-400">
              VLSFO GLOBAL FUEL TELEMETRY (10M WINDOW)
            </CardTitle>
            <Badge variant="terminalAmber" className="text-[10px]">
              5s TICK CADENCE
            </Badge>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="font-bold text-slate-100 tabular-nums">
              ${latest ? latest.fuel_price.toFixed(2) : "625.00"}/MT
            </span>
            <span
              className={`text-[11px] tabular-nums ${
                Number(fuelDelta) >= 0 ? "text-amber-400" : "text-emerald-400"
              }`}
            >
              ({Number(fuelDelta) >= 0 ? `+${fuelDelta}` : fuelDelta})
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-2 pt-3">
          <div className="h-[195px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 4, right: 10, left: -12, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="fuelGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.28} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="#1e293b"
                  strokeDasharray="2 2"
                  vertical={false}
                />
                <XAxis
                  dataKey="timeLabel"
                  stroke="#64748b"
                  tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "monospace" }}
                  minTickGap={28}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  stroke="#64748b"
                  tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "monospace" }}
                  tickFormatter={(v) => `$${v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#06090f",
                    borderColor: "#f59e0b",
                    borderRadius: "2px",
                    fontFamily: "monospace",
                    fontSize: "11px",
                    color: "#f8fafc",
                  }}
                  formatter={(value: number) => [`$${value.toFixed(2)} / MT`, "Fuel Price"]}
                />
                <ReferenceLine
                  y={625}
                  stroke="#475569"
                  strokeDasharray="3 3"
                  label={{
                    value: "BENCHMARK $625",
                    position: "insideTopRight",
                    fill: "#94a3b8",
                    fontSize: 9,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="fuel_price"
                  stroke="none"
                  fill="url(#fuelGradient)"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="fuel_price"
                  name="Fuel Price ($/MT)"
                  stroke="#f59e0b"
                  strokeWidth={1.75}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Chart 2: Port Congestion Index & Container Availability (Last 10 Minutes) */}
      <Card className="border-slate-800 bg-[#0b101b]">
        <CardHeader className="py-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-[11px] text-cyan-400">
              PORT CONGESTION &amp; TEU AVAILABILITY (10M)
            </CardTitle>
            <Badge variant="default" className="text-[10px] text-cyan-300">
              INDEX 0-100
            </Badge>
          </div>
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="font-bold text-cyan-300 tabular-nums">
              {latest ? latest.port_congestion_index.toFixed(1) : "54.0"} IDX
            </span>
            <span className="text-[11px] text-slate-400 tabular-nums">
              ({Number(congDelta) >= 0 ? `+${congDelta}` : congDelta})
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-2 pt-3">
          <div className="h-[195px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 4, right: 10, left: -16, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="congGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.24} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="#1e293b"
                  strokeDasharray="2 2"
                  vertical={false}
                />
                <XAxis
                  dataKey="timeLabel"
                  stroke="#64748b"
                  tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "monospace" }}
                  minTickGap={28}
                />
                <YAxis
                  domain={[0, 100]}
                  stroke="#64748b"
                  tick={{ fill: "#94a3b8", fontSize: 10, fontFamily: "monospace" }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#06090f",
                    borderColor: "#06b6d4",
                    borderRadius: "2px",
                    fontFamily: "monospace",
                    fontSize: "11px",
                    color: "#f8fafc",
                  }}
                />
                <ReferenceLine
                  y={75}
                  stroke="#ef4444"
                  strokeDasharray="3 3"
                  label={{
                    value: "SURCHARGE ALERT (75)",
                    position: "insideTopRight",
                    fill: "#f87171",
                    fontSize: 9,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="port_congestion_index"
                  stroke="none"
                  fill="url(#congGradient)"
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="port_congestion_index"
                  name="Port Congestion (0-100)"
                  stroke="#06b6d4"
                  strokeWidth={1.75}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="container_availability"
                  name="Container Availability (%)"
                  stroke="#10b981"
                  strokeWidth={1.35}
                  strokeDasharray="4 2"
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1.5 flex items-center justify-between border-t border-slate-800/80 pt-1.5 font-mono text-[10px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-cyan-400" />
              Port Congestion Index
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
              Container Availability (%)
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
