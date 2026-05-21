export type QuoteStatusType =
  | "Auto-Approved"
  | "Requires Review"
  | "Manually Approved"
  | "Rejected";

export interface MarketTick {
  id: number;
  timestamp: string;
  fuel_price: number;
  port_congestion_index: number;
  container_availability: number;
}

export interface QuoteRequest {
  id: number;
  timestamp: string;
  client_name: string;
  cargo_weight: number;
  route: string;
  base_rate: number;
  final_price: number;
  profit_margin: number;
  status: QuoteStatusType;
}

export interface SystemMetricsSummary {
  total_quotes: number;
  auto_approved_count: number;
  requires_review_count: number;
  manually_approved_count: number;
  rejected_count: number;
  auto_approval_rate_pct: number;
  avg_profit_margin_pct: number;
  total_revenue_usd: number;
  ingestion_rate_per_min: number;
  projected_hourly_throughput: number;
  last_db_query_latency_ms: number;
  p95_db_query_latency_ms: number;
  latest_tick: MarketTick | null;
}

export interface PaginatedQuotesResponse {
  items: QuoteRequest[];
  total_count: number;
  query_latency_ms: number;
  summary: SystemMetricsSummary;
}

export interface ManualOverridePayload {
  final_price: number;
  status: "Manually Approved" | "Rejected";
  notes?: string;
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export function getWebSocketUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }
  const base = API_BASE_URL.replace(/^http/, "ws");
  return `${base}/ws/stream`;
}

export async function fetchQuotes(
  limit = 1200,
  status?: string,
  clientName?: string
): Promise<PaginatedQuotesResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status && status !== "ALL") {
    params.set("status", status);
  }
  if (clientName && clientName.trim() !== "") {
    params.set("client_name", clientName.trim());
  }

  const res = await fetch(`${API_BASE_URL}/api/quotes?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch quotes: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchMarketTicks(minutes = 10): Promise<MarketTick[]> {
  const res = await fetch(
    `${API_BASE_URL}/api/market-ticks?minutes=${minutes}&limit=140`,
    { cache: "no-store" }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch market ticks: HTTP ${res.status}`);
  }
  return res.json();
}

export async function submitManualOverride(
  quoteId: number,
  payload: ManualOverridePayload
): Promise<QuoteRequest> {
  const res = await fetch(`${API_BASE_URL}/api/quotes/${quoteId}/override`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Override failed (${res.status}): ${errText}`);
  }
  return res.json();
}
