import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useQuery, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Search, MapPin, Clock, TrendingDown, TrendingUp, Star, StarOff, RefreshCw } from "lucide-react";

// -----------------------------------------------------------------------------
// Configuration (fixed to your instance; can still be overridden via Vite env)
// -----------------------------------------------------------------------------
const DATASETTE_BASE_URL = (import.meta as any).env?.VITE_DATASETTE_BASE_URL || "https://datasette.familie-bell.com";
const DB_NAME = (import.meta as any).env?.VITE_DATASETTE_DB || "tankentanken";
const DEFAULT_TIME_RANGE_DAYS = 7; // default history shown
const REFRESH_MS = 15 * 60 * 1000; // data updates every 15 minutes

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------
export type Station = {
  id: number;
  station_id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

export type PriceRow = {
  ts: string;
  diesel: number | null;
  super: number | null;
  e10: number | null;
};

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
function dsUrl(
  sql: string,
  params: Record<string, string | number | null | undefined> = {},
  options?: { shape?: "array" | "objects" }
) {
  const u = new URL(`${DATASETTE_BASE_URL.replace(/\/$/, "")}/${encodeURIComponent(DB_NAME)}.json`);
  u.searchParams.set("sql", sql);
  u.searchParams.set("_shape", options?.shape || "objects");
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) {
      // Datasette expects parameter names WITHOUT the colon in the query string
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

async function fetchDsRows<T = any>(input: RequestInfo, init?: RequestInit): Promise<T[]> {
  const res = await fetch(input, init);
  if (!res.ok) throw new Error(`Datasette request failed: ${res.status}`);
  const json = await res.json();
  if (Array.isArray(json)) return json as T[];
  if (json && Array.isArray(json.rows)) return json.rows as T[];
  console.warn("Unexpected Datasette JSON shape", json);
  return [] as T[];
}

function formatEuro(n: number | null | undefined) {
  if (n == null) return "–";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: 3 }).format(n);
}

function formatTs(ts: string) {
  try {
    const d = new Date(ts);
    return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" }).format(d);
  } catch {
    return ts;
  }
}

function isValidStationId(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

// -----------------------------------------------------------------------------
// Data hooks
// -----------------------------------------------------------------------------
function useStationSearch(q: string) {
  const sql = `
    SELECT gs.id, gs.station_id, gs.name, gs.address, gs.latitude, gs.longitude
    FROM gas_stations gs
    WHERE (? = '' OR gs.name LIKE '%' || ? || '%' OR gs.address LIKE '%' || ? || '%')
    ORDER BY gs.name
    LIMIT 30
  `;
  return useQuery<Station[]>({
    queryKey: ["stations", q],
    queryFn: async () => fetchDsRows<Station>(dsUrl(sql, { q: q ?? "" })),
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
  });
}

function usePriceHistory(stationDbId: number | null | undefined, days: number) {
  const since = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }, [days]);

  const sql = `
    SELECT ph.last_transmission as ts,
           ph.price_diesel as diesel,
           ph.price_super as super,
           ph.price_super_e10 as e10
    FROM price_history ph
    WHERE ph.station_id = ? AND ph.last_transmission >= ?
    ORDER BY ph.last_transmission
  `;

  const enabled = isValidStationId(stationDbId);

  return useQuery<PriceRow[]>({
    queryKey: ["history", enabled ? stationDbId : null, days, since],
    enabled,
    queryFn: async () => {
      if (!enabled) return [] as PriceRow[];
      return fetchDsRows<PriceRow>(dsUrl(sql, { sid: stationDbId as number, since }));
    },
    staleTime: REFRESH_MS,
    refetchInterval: REFRESH_MS,
  });
}

// -----------------------------------------------------------------------------
// Analytics
// -----------------------------------------------------------------------------
function computeAdvice(rows: PriceRow[], fuelKey: keyof PriceRow) {
  const values = rows
    .map((r) => ({ date: new Date(r.ts), v: (r as any)[fuelKey] as number | null }))
    .filter((x) => x.v != null) as { date: Date; v: number }[];

  if (values.length < 3) return null;

  const last = values[values.length - 1];
  const sorted = [...values.map((v) => v.v)].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const std = Math.sqrt(sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / sorted.length);

  const perHour = new Array(24).fill(0).map(() => ({ sum: 0, n: 0 }));
  for (const { date, v } of values) {
    const h = Number(new Intl.DateTimeFormat("de-DE", { hour: "2-digit", hour12: false, timeZone: "Europe/Berlin" }).format(date));
    perHour[h].sum += v;
    perHour[h].n += 1;
  }
  const hourAvg = perHour.map((x, h) => ({ h, avg: x.n ? x.sum / x.n : Infinity }));
  const bestHour = hourAvg.reduce((min, cur) => (cur.avg < min.avg ? cur : min), { h: 0, avg: Infinity as number });
  const bestWindow = { startHour: bestHour.h, endHour: (bestHour.h + 2) % 24, avg: bestHour.avg };

  const now = new Date();
  const priceNow = last.v;
  const isBargain = priceNow <= bestWindow.avg + 0.02;
  const isExpensive = priceNow >= median + Math.max(0.03, 1.5 * std);
  const tz = "Europe/Berlin";
  const curHour = Number(new Intl.DateTimeFormat("en-CA", { timeZone: tz, hour: "2-digit", hour12: false }).format(now));
  const daysOffset = curHour <= bestWindow.startHour ? 0 : 1;
  const nextBest = new Date(now);
  nextBest.setDate(nextBest.getDate() + daysOffset);
  nextBest.setHours(bestWindow.startHour, 0, 0, 0);

  const decision: "buy" | "wait" | "neutral" = isBargain ? "buy" : isExpensive ? "wait" : "neutral";
  return { last, median, mean, std, bestWindow, decision, nextBest };
}

// -----------------------------------------------------------------------------
// UI components (unchanged)
// -----------------------------------------------------------------------------
// ... (rest of the UI components and AppInner/App remain identical to previous version)
