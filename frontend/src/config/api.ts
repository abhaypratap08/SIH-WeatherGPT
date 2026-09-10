/**
 * API Configuration
 *
 * Java backend (Spring Boot) → Railway
 * Python ML backend (FastAPI) → Railway
 *
 * In production, requests go directly to the Railway backends.
 * In development, these URLs also work directly, so no Vite proxy
 * is required for these API calls.
 */

// ── Backend base URLs ────────────────────────────────────────────────

export const JAVA_API_BASE =
  "https://sih-weathergpt-production.up.railway.app";

export const ML_API_BASE =
  "https://bubbly-abundance-production-4c2a.up.railway.app";

// Kept for MobileWeatherGPT backward compatibility.
export const API_BASE_URL = "";

// ── Java backend endpoints ──────────────────────────────────────────

export const WEATHER_ENDPOINTS = {
  CURRENT: (location: string) =>
    `${JAVA_API_BASE}/api/weather/current?location=${encodeURIComponent(location)}`,

  FORECAST: (location: string, days = 7) =>
    `${JAVA_API_BASE}/api/weather/forecast?location=${encodeURIComponent(location)}&days=${days}`,

  NWP: (location: string) =>
    `${JAVA_API_BASE}/api/weather/nwp?location=${encodeURIComponent(location)}`,
};

export const ADVISORIES_ENDPOINT = (
  location: string,
  sector: string,
) =>
  `${JAVA_API_BASE}/api/weather/advisories?location=${encodeURIComponent(
    location,
  )}&sector=${encodeURIComponent(sector)}`;

export const ALERTS_ENDPOINT = (location: string) =>
  `${JAVA_API_BASE}/api/alerts/early-warnings?location=${encodeURIComponent(
    location,
  )}`;

export const CLIMATE_ENDPOINT = (
  location: string,
  startYear = 2015,
  endYear = 2024,
) =>
  `${JAVA_API_BASE}/api/weather/climate?location=${encodeURIComponent(
    location,
  )}&startYear=${startYear}&endYear=${endYear}`;

export const CHAT_ENDPOINT =
  `${JAVA_API_BASE}/api/chat/query`;

// ── Python ML backend endpoints ─────────────────────────────────────

/**
 * AI agent chat
 * LangChain + Ollama + FastAPI
 */
export const ML_AGENT_ENDPOINT =
  `${ML_API_BASE}/agent`;

/**
 * Route weather analysis
 */
export const ML_ROUTE_ENDPOINT =
  `${ML_API_BASE}/route-weather`;

// ── In-flight deduplication helper ──────────────────────────────────

const _inFlight = new Map<string, Promise<Response>>();

export function fetchWithDedup(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  const key = `${options?.method ?? "GET"}:${url}`;

  const existing = _inFlight.get(key);

  if (existing) {
    return existing;
  }

  const p = fetch(url, options).finally(() => {
    _inFlight.delete(key);
  });

  _inFlight.set(key, p);

  return p;
}
