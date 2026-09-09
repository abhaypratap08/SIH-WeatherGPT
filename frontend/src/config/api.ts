/**
 * API Configuration
 *
 * Java backend  (Spring Boot) → :8080  — weather, climate, alerts, NWP, sectors
 * Python ML backend (FastAPI) → :8000  — AI agent chat, route-weather
 *
 * In dev the Vite proxy rewrites /api → :8080 and /agent|/route-weather → :8000
 * so all requests go through the same origin (no CORS issues).
 */

export const JAVA_API_BASE   = "";   // proxied: /api → localhost:8080
export const ML_API_BASE     = "";   // proxied: /agent, /route-weather → localhost:8000

/** @deprecated Use WEATHER_ENDPOINTS / ALERTS_ENDPOINT etc. directly.
 *  Kept for MobileWeatherGPT backward compatibility. */
export const API_BASE_URL = "";

// ── Java backend endpoints ──────────────────────────────────────────
export const WEATHER_ENDPOINTS = {
  CURRENT:  (location: string) =>
    `/api/weather/current?location=${encodeURIComponent(location)}`,
  FORECAST: (location: string, days = 7) =>
    `/api/weather/forecast?location=${encodeURIComponent(location)}&days=${days}`,
  NWP:      (location: string) =>
    `/api/weather/nwp?location=${encodeURIComponent(location)}`,
};

export const ADVISORIES_ENDPOINT = (location: string, sector: string) =>
  `/api/weather/advisories?location=${encodeURIComponent(location)}&sector=${encodeURIComponent(sector)}`;

export const ALERTS_ENDPOINT = (location: string) =>
  `/api/alerts/early-warnings?location=${encodeURIComponent(location)}`;

export const CLIMATE_ENDPOINT = (
  location: string,
  startYear = 2015,
  endYear   = 2024,
) =>
  `/api/weather/climate?location=${encodeURIComponent(location)}&startYear=${startYear}&endYear=${endYear}`;

export const CHAT_ENDPOINT = `/api/chat/query`;

// ── Python ML backend endpoints ──────────────────────────────────────
/** AI agent chat (LangChain + Ollama) */
export const ML_AGENT_ENDPOINT      = `/agent`;
/** Route weather analysis */
export const ML_ROUTE_ENDPOINT      = `/route-weather`;

// ── In-flight deduplication helper ───────────────────────────────────
const _inFlight = new Map<string, Promise<Response>>();

export function fetchWithDedup(url: string, options?: RequestInit): Promise<Response> {
  const key = `${options?.method ?? "GET"}:${url}`;
  const existing = _inFlight.get(key);
  if (existing) return existing;
  const p = fetch(url, options).finally(() => _inFlight.delete(key));
  _inFlight.set(key, p);
  return p;
}
