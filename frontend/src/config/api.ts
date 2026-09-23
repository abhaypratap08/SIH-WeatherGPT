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

// ── Python ML backend endpoints ─────────────────────────────────────

/**
 * AI agent chat
 * LangChain + OpenRouter + FastAPI
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

// ── Network/HTTP diagnostics ────────────────────────────────────────
//
// A plain `fetch()` failure from a different origin surfaces to the caller as
// "TypeError: NetworkError when attempting to fetch resource." with no way to
// tell a CORS block, an offline client, DNS trouble, an HTTP 5xx body, or an
// abort apart. `fetchWithDiagnostics` and `FetchDiagnosticError` keep that
// distinction so the UI can show a useful message while logging the request
// URL, HTTP status and response body for developers.

/**
 * Structured failure for a cross-origin API request:
 *  - "network": no HTTP response at all (CORS block, connectivity, DNS);
 *  - "http": an HTTP error response carrying a status (body captured when present).
 * AbortError is intentionally never wrapped so callers keep treating it as
 * user/component-driven cancellation rather than a real failure.
 */
export class FetchDiagnosticError extends Error {
  readonly kind: "network" | "http" | "invalid-response";
  readonly url: string;
  readonly status?: number;
  readonly statusText?: string;
  readonly bodyText?: string;
  readonly cause?: unknown;

  constructor(info: {
    kind: FetchDiagnosticError["kind"];
    url: string;
    status?: number;
    statusText?: string;
    bodyText?: string;
    cause?: unknown;
    message: string;
  }) {
    super(info.message);
    this.name = "FetchDiagnosticError";
    this.kind = info.kind;
    this.url = info.url;
    this.status = info.status;
    this.statusText = info.statusText;
    this.bodyText = info.bodyText;
    this.cause = info.cause;
  }

  /**
   * User-safe message for display in the UI. Never echoes raw response bodies;
   * only the message constructed from the status or the backend's ApiResponse
   * envelope `message` field.
   */
  toDisplayMessage(): string {
    if (this.kind === "network") {
      return "Could not reach the weather service (network/CORS error). Check your connection, then retry — see the browser console for the request URL and details.";
    }
    return this.message;
  }
}

/**
 * fetch() wrapper that turns transport-level failures (CORS blocks, offline,
 * DNS, proxy) into a {@link FetchDiagnosticError} while preserving AbortError
 * semantics unchanged. HTTP error statuses are NOT thrown here: the caller keeps
 * the Response so it can read the body for diagnostics.
 */
export async function fetchWithDiagnostics(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (cause) {
    const signalAborted = init?.signal?.aborted === true;
    const isAbort =
      signalAborted || (cause instanceof Error && cause.name === "AbortError");
    if (isAbort) throw cause; // keep AbortError recognizable for callers

    throw new FetchDiagnosticError({
      kind: "network",
      url,
      cause,
      message:
        cause instanceof Error
          ? cause.message
          : "Unknown network failure while reaching the weather server.",
    });
  }
}

/** Cap diagnostic bodies so a large error page never floods logs. */
export function truncateForDiagnostics(
  text: string,
  maxLength = 2000,
): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
