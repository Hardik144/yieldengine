"use client";

import React, { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertTriangle,
  CheckCircle2,
  Filter,
  Search,
  SlidersHorizontal,
  Sparkles,
  XCircle,
} from "lucide-react";
import { QuoteRequest, QuoteStatusType } from "@/lib/api";
import { formatCurrency, formatTimeShort } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface VirtualizedQuoteGridProps {
  quotes: QuoteRequest[];
  statusFilter: string;
  onStatusFilterChange: (status: string) => void;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onSelectQuoteForOverride: (quote: QuoteRequest) => void;
  queryLatencyMs: number;
}

const STATUS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "ALL QUOTES", value: "ALL" },
  { label: "⚠ REQUIRES REVIEW (≤15%)", value: "Requires Review" },
  { label: "✓ AUTO-APPROVED (>15%)", value: "Auto-Approved" },
  { label: "★ MANUALLY APPROVED", value: "Manually Approved" },
  { label: "✕ REJECTED", value: "Rejected" },
];

export function VirtualizedQuoteGrid({
  quotes,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchQueryChange,
  onSelectQuoteForOverride,
  queryLatencyMs,
}: VirtualizedQuoteGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredQuotes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return quotes.filter((item) => {
      if (statusFilter !== "ALL" && item.status !== statusFilter) {
        return false;
      }
      if (
        q &&
        !item.client_name.toLowerCase().includes(q) &&
        !item.route.toLowerCase().includes(q) &&
        !String(item.id).includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [quotes, statusFilter, searchQuery]);

  const rowVirtualizer = useVirtualizer({
    count: filteredQuotes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 38,
    overscan: 14,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalSize - virtualItems[virtualItems.length - 1].end
      : 0;

  return (
    <div className="flex h-full flex-col rounded-sm border border-slate-800 bg-[#0b101b]">
      {/* Grid Command & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-[#0f172a]/80 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            id="quote-grid-caption"
            className="font-mono text-xs font-bold uppercase tracking-wider text-amber-400"
          >
            LIVE INBOUND QUOTE BLOTTER ({filteredQuotes.length.toLocaleString()}{" "}
            VIRTUALIZED ROWS)
          </h2>
          <Badge variant="default" className="text-[10px] text-cyan-300">
            SQL QUERY: {queryLatencyMs.toFixed(2)}ms
          </Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Search by client_name or route */}
          <div className="relative w-56">
            <Search
              className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Filter quotes by client name, route, or ID"
              placeholder="SEARCH CLIENT / LANE..."
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              className="h-7 pl-8 text-[11px]"
            />
          </div>

          {/* Status Filter Pills */}
          <div
            className="flex flex-wrap items-center gap-1"
            role="group"
            aria-label="Filter quotes by approval status"
          >
            <Filter
              className="mr-1 h-3.5 w-3.5 text-slate-400"
              aria-hidden="true"
            />
            {STATUS_OPTIONS.map((opt) => {
              const active = statusFilter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onStatusFilterChange(opt.value)}
                  className={`rounded-sm border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                    active
                      ? "border-amber-400 bg-amber-500 text-slate-950"
                      : "border-slate-700 bg-slate-900/90 text-slate-300 hover:border-amber-500/50 hover:text-amber-300"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Sub-banner instruction for Requires Review interactive override workflow */}
      <div className="flex items-center justify-between border-b border-slate-800/80 bg-amber-950/15 px-3 py-1 font-mono text-[11px] text-slate-300">
        <span>
          <strong className="text-amber-400">UNDERWRITER ACTION:</strong> Click
          any row marked{" "}
          <span className="text-amber-300 underline decoration-amber-500/50">
            ⚠ Requires Review
          </span>{" "}
          (Profit Margin ≤ 15.0%) to launch the Manual Price Override Modal.
        </span>
        <span className="hidden text-slate-400 sm:inline">
          WINDOWING: TANSTACK VIRTUAL 60FPS ENGINE
        </span>
      </div>

      {/* Focusable Responsive Table Container per modern-web-guidance `responsive-table` */}
      <div
        ref={parentRef}
        tabIndex={0}
        role="region"
        aria-labelledby="quote-grid-caption"
        className="table-wrapper flex-1 overflow-auto focus:outline-none focus:ring-1 focus:ring-amber-400/60"
      >
        <table className="w-full border-collapse text-left font-mono text-xs">
          <thead className="sticky inset-block-start-0 z-10 bg-[#070b14] text-[10px] uppercase tracking-wider text-slate-400 shadow-sm">
            <tr className="border-b border-slate-800">
              <th scope="col" className="px-2.5 py-2 font-semibold">
                QUOTE ID
              </th>
              <th scope="col" className="px-2.5 py-2 font-semibold">
                TIMESTAMP
              </th>
              <th scope="col" className="px-2.5 py-2 font-semibold">
                ENTERPRISE CLIENT
              </th>
              <th scope="col" className="px-2.5 py-2 font-semibold">
                TRADE ROUTE
              </th>
              <th scope="col" className="px-2.5 py-2 text-right font-semibold">
                WEIGHT (MT)
              </th>
              <th scope="col" className="px-2.5 py-2 text-right font-semibold">
                BASE RATE
              </th>
              <th scope="col" className="px-2.5 py-2 text-right font-semibold">
                FINAL PRICE
              </th>
              <th scope="col" className="px-2.5 py-2 text-right font-semibold">
                MARGIN %
              </th>
              <th scope="col" className="px-2.5 py-2 font-semibold">
                STATUS
              </th>
              <th scope="col" className="px-2.5 py-2 text-right font-semibold">
                ACTION
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {paddingTop > 0 && (
              <tr>
                <td colSpan={10} style={{ height: `${paddingTop}px` }} />
              </tr>
            )}
            {virtualItems.map((virtualRow) => {
              const quote = filteredQuotes[virtualRow.index];
              const isReview = quote.status === "Requires Review";
              const isHighMargin = quote.profit_margin > 15.0;

              return (
                <tr
                  key={quote.id}
                  data-index={virtualRow.index}
                  onClick={() => {
                    if (isReview) {
                      onSelectQuoteForOverride(quote);
                    }
                  }}
                  className={`h-[38px] transition-colors ${
                    isReview
                      ? "cursor-pointer bg-amber-950/15 hover:bg-amber-900/30"
                      : "hover:bg-slate-900/70"
                  }`}
                >
                  <th
                    scope="row"
                    className="sticky inset-inline-start-0 bg-inherit px-2.5 py-1.5 font-mono text-[11px] font-bold text-amber-400 tabular-nums"
                  >
                    #{quote.id}
                  </th>
                  <td
                    data-label="Timestamp"
                    className="whitespace-nowrap px-2.5 py-1.5 text-[11px] text-slate-400 tabular-nums"
                  >
                    {formatTimeShort(quote.timestamp)}
                  </td>
                  <td
                    data-label="Client"
                    className="max-w-[190px] truncate px-2.5 py-1.5 font-sans text-xs font-medium text-slate-100"
                    title={quote.client_name}
                  >
                    {quote.client_name}
                  </td>
                  <td
                    data-label="Route"
                    className="max-w-[205px] truncate px-2.5 py-1.5 text-[11px] text-slate-300"
                    title={quote.route}
                  >
                    {quote.route}
                  </td>
                  <td
                    data-label="Weight (MT)"
                    className="whitespace-nowrap px-2.5 py-1.5 text-right text-[11px] text-slate-300 tabular-nums"
                  >
                    {quote.cargo_weight.toFixed(1)}t
                  </td>
                  <td
                    data-label="Base Rate"
                    className="whitespace-nowrap px-2.5 py-1.5 text-right text-[11px] text-slate-400 tabular-nums"
                  >
                    {formatCurrency(quote.base_rate)}
                  </td>
                  <td
                    data-label="Final Price"
                    className="whitespace-nowrap px-2.5 py-1.5 text-right text-[11px] font-semibold text-slate-100 tabular-nums"
                  >
                    {formatCurrency(quote.final_price)}
                  </td>
                  <td
                    data-label="Margin %"
                    className={`whitespace-nowrap px-2.5 py-1.5 text-right text-[11px] font-bold tabular-nums ${
                      isHighMargin ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {quote.profit_margin > 0 ? "+" : ""}
                    {quote.profit_margin.toFixed(2)}%
                  </td>
                  <td
                    data-label="Status"
                    className="whitespace-nowrap px-2.5 py-1.5"
                  >
                    <StatusBadgeWithIcon status={quote.status} />
                  </td>
                  <td
                    data-label="Action"
                    className="whitespace-nowrap px-2.5 py-1.5 text-right"
                  >
                    {isReview ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="default"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectQuoteForOverride(quote);
                        }}
                        className="h-6 px-2 text-[10px]"
                      >
                        <SlidersHorizontal
                          className="h-3 w-3"
                          aria-hidden="true"
                        />
                        <span>OVERRIDE</span>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectQuoteForOverride(quote);
                        }}
                        className="h-6 px-2 text-[10px] text-slate-400 hover:text-slate-200"
                      >
                        INSPECT
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td colSpan={10} style={{ height: `${paddingBottom}px` }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadgeWithIcon({ status }: { status: QuoteStatusType }) {
  switch (status) {
    case "Auto-Approved":
      return (
        <Badge variant="autoApproved">
          <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Auto-Approved</span>
        </Badge>
      );
    case "Requires Review":
      return (
        <Badge variant="requiresReview">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Requires Review</span>
        </Badge>
      );
    case "Manually Approved":
      return (
        <Badge variant="manuallyApproved">
          <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Manually Approved</span>
        </Badge>
      );
    case "Rejected":
      return (
        <Badge variant="rejected">
          <XCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>Rejected</span>
        </Badge>
      );
  }
}
