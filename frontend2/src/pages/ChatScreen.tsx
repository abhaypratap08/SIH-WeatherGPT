import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./GeminiChat.css";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface RiskSummary {
  HIGH?: number;
  MODERATE?: number;
  LOW?: number;
}

interface WeatherPoint {
  location?: string;
  point?: string;
  weather?: string;
  condition?: string;
  temp?: number | string;
  temperature?: number | string;
  risk?: string;
  risk_level?: string;
  description?: string;
  notes?: string;
  [key: string]: any;
}

interface RouteApiResponse {
  message?: string;
  route_info?: any;
  risk_summary?: RiskSummary;
  weather_data?: WeatherPoint[] | any;
  map_json?: any;
  index_html?: string;
}

const API_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

/* ----------------------------------------------------
   ICONS — a small consistent glyph set (no emoji)
---------------------------------------------------- */
const IconCloudSun = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 17h9.5a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6-1.6A4 4 0 0 0 7 17z" />
    <path d="M4 20h1M6.5 20h1M9 20h1" />
  </svg>
);

const IconChat = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

const IconRoute = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="5" r="2" />
    <path d="M8 19h7a3 3 0 0 0 3-3v-1a3 3 0 0 0-3-3H9a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h7" />
  </svg>
);

const IconChart = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19V5" />
    <path d="M4 19h16" />
    <rect x="7" y="11" width="3" height="8" />
    <rect x="12.5" y="7" width="3" height="12" />
    <rect x="18" y="13" width="3" height="6" />
  </svg>
);

const IconRadar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <path d="M12 12L18 6" />
  </svg>
);

const IconSettings = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.3l.06.06A1.65 1.65 0 0 0 8.92 4.7H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.3 9v.08c.16.43.5.78.99.92H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconRain = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 13a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.7A3.5 3.5 0 0 0 6.5 13H16z" />
    <path d="M8 17l-1 2M12 17l-1 2M16 17l-1 2" />
  </svg>
);

const IconCalendar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="5" width="17" height="16" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

const IconLeaf = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 20A7 7 0 0 1 4 13c0-5 4.5-9 12-10 1 6-1 15-5 17z" />
    <path d="M4 13c3-1 6-3 8-6" />
  </svg>
);

const IconSend = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const IconPin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.3" />
  </svg>
);

const IconMenu = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

const IconChevron = ({ dir }: { dir: "left" | "right" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={dir === "left" ? "M11 19l-7-7 7-7m8 14l-7-7 7-7" : "M13 5l7 7-7 7M5 5l7 7-7 7"} />
  </svg>
);

const NAV_ITEMS = [
  { id: "chat", label: "Assistant chat", icon: <IconChat /> },
  { id: "route", label: "Route weather", icon: <IconRoute />, badge: "New" },
  { id: "report", label: "Weather report", icon: <IconChart /> },
  { id: "radar", label: "Interactive radar", icon: <IconRadar /> },
  { id: "settings", label: "Settings", icon: <IconSettings /> },
];

const suggestions = [
  { icon: <IconCloudSun />, title: "Today's weather", text: "What's the current weather forecast for my location?" },
  { icon: <IconRain />, title: "Rain forecast", text: "Will it rain in the next 24 hours?" },

];

/* ----------------------------------------------------
   SUB-COMPONENT: Route Weather Details View
---------------------------------------------------- */
function RouteWeatherView() {
  const [formData, setFormData] = useState({
    origin: "Delhi",
    destination: "Agra",
    departure_time: "08:00",
  });

  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<RouteApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResponse(null);

    try {
      const res = await fetch(`${API_URL}/route-weather`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error(`Error: ${res.status} - ${res.statusText}`);

      const data: RouteApiResponse = await res.json();
      setResponse(data);
    } catch (err: any) {
      setError(err.message || "Failed to fetch weather route analysis.");
    } finally {
      setLoading(false);
    }
  };

  const getRiskBadgeStyle = (risk?: string) => {
    const r = String(risk || "").toUpperCase();
    switch (r) {
      case "HIGH":
        return { backgroundColor: "rgba(229, 101, 74, 0.16)", color: "#f0a08c", borderColor: "rgba(229, 101, 74, 0.35)" };
      case "MODERATE":
        return { backgroundColor: "rgba(224, 166, 63, 0.16)", color: "#f0cf8f", borderColor: "rgba(224, 166, 63, 0.35)" };
      case "LOW":
        return { backgroundColor: "rgba(70, 201, 166, 0.16)", color: "#8fe0cb", borderColor: "rgba(70, 201, 166, 0.35)" };
      default:
        return { backgroundColor: "rgba(154, 164, 182, 0.16)", color: "#c3cad6", borderColor: "rgba(154, 164, 182, 0.35)" };
    }
  };

  return (
    <div style={routeStyles.scrollWrapper}>
      <div style={routeStyles.container}>
        <header style={routeStyles.header}>
          <h2 style={routeStyles.headerTitle}>Route weather analyzer</h2>
          <p style={routeStyles.headerSubtitle}>Check conditions and risk along a journey, point by point.</p>
        </header>

        <form onSubmit={handleSubmit} style={routeStyles.form}>
          <div style={routeStyles.formGrid}>
            <div style={routeStyles.inputGroup}>
              <label style={routeStyles.label}>Origin</label>
              <input
                type="text"
                name="origin"
                value={formData.origin}
                onChange={handleChange}
                required
                style={routeStyles.input}
                placeholder="e.g. Delhi"
              />
            </div>

            <div style={routeStyles.inputGroup}>
              <label style={routeStyles.label}>Destination</label>
              <input
                type="text"
                name="destination"
                value={formData.destination}
                onChange={handleChange}
                required
                style={routeStyles.input}
                placeholder="e.g. Agra"
              />
            </div>

            <div style={routeStyles.inputGroup}>
              <label style={routeStyles.label}>Departure time</label>
              <input
                type="time"
                name="departure_time"
                value={formData.departure_time}
                onChange={handleChange}
                required
                style={routeStyles.input}
              />
            </div>
          </div>

          <button type="submit" disabled={loading} style={routeStyles.button}>
            {loading ? "Analyzing route…" : "Analyze route"}
          </button>
        </form>

        {error && <div style={routeStyles.error}>{error}</div>}

        {response && (
          <div style={routeStyles.resultsContainer}>
            {response.message && (
              <div style={routeStyles.successBanner}>{response.message}</div>
            )}

            {response.risk_summary && (
              <div style={routeStyles.card}>
                <h3 style={routeStyles.cardTitle}>Risk summary</h3>
                <div style={routeStyles.riskGrid}>
                  <div style={{ ...routeStyles.riskMetricCard, borderColor: "rgba(229, 101, 74, 0.3)" }}>
                    <span style={{ ...routeStyles.riskCount, color: "#f0a08c" }}>{response.risk_summary.HIGH ?? 0}</span>
                    <span style={routeStyles.riskLabel}>High-risk waypoints</span>
                  </div>
                  <div style={{ ...routeStyles.riskMetricCard, borderColor: "rgba(224, 166, 63, 0.3)" }}>
                    <span style={{ ...routeStyles.riskCount, color: "#f0cf8f" }}>{response.risk_summary.MODERATE ?? 0}</span>
                    <span style={routeStyles.riskLabel}>Moderate-risk waypoints</span>
                  </div>
                  <div style={{ ...routeStyles.riskMetricCard, borderColor: "rgba(70, 201, 166, 0.3)" }}>
                    <span style={{ ...routeStyles.riskCount, color: "#8fe0cb" }}>{response.risk_summary.LOW ?? 0}</span>
                    <span style={routeStyles.riskLabel}>Low-risk waypoints</span>
                  </div>
                </div>
              </div>
            )}

            {response.weather_data && (
              <div style={routeStyles.card}>
                <h3 style={routeStyles.cardTitle}>Waypoint forecasts</h3>
                {Array.isArray(response.weather_data) ? (
                  <div style={routeStyles.tableWrapper}>
                    <table style={routeStyles.table}>
                      <thead>
                        <tr>
                          <th style={routeStyles.th}>#</th>
                          <th style={routeStyles.th}>Point</th>
                          <th style={routeStyles.th}>Condition</th>
                          <th style={routeStyles.th}>Temp</th>
                          <th style={routeStyles.th}>Risk</th>
                          <th style={routeStyles.th}>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {response.weather_data.map((item: WeatherPoint, index: number) => {
                          const pointName = item.location || item.point || item.name || `Point ${index + 1}`;
                          const condition = item.weather || item.condition || item.sky || "—";
                          const tempVal = item.temp ?? item.temperature;
                          const tempDisplay = tempVal !== undefined ? `${tempVal}°C` : "—";
                          const riskVal = item.risk || item.risk_level || "NORMAL";
                          const desc = item.description || item.notes || item.summary || (
                            typeof item === "object" ? Object.entries(item)
                              .filter(([k]) => !["location", "point", "weather", "condition", "temp", "temperature", "risk", "risk_level"].includes(k))
                              .map(([k, v]) => `${k}: ${v}`).join(", ") : String(item)
                          );

                          return (
                            <tr key={index} style={routeStyles.tr}>
                              <td style={routeStyles.tdIndex}>{index + 1}</td>
                              <td style={routeStyles.tdBold}>{pointName}</td>
                              <td style={routeStyles.td}>{condition}</td>
                              <td style={routeStyles.td}>{tempDisplay}</td>
                              <td style={routeStyles.td}>
                                <span style={{ ...routeStyles.badge, ...getRiskBadgeStyle(riskVal) }}>
                                  {riskVal.toUpperCase()}
                                </span>
                              </td>
                              <td style={routeStyles.tdDesc}>{desc || "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <pre style={routeStyles.jsonBlock}>{JSON.stringify(response.weather_data, null, 2)}</pre>
                )}
              </div>
            )}

            {response.index_html && (
              <div style={routeStyles.card}>
                <h3 style={routeStyles.cardTitle}>Route map</h3>
                <div style={routeStyles.mapWrapper}>
                  <iframe title="Route map preview" srcDoc={response.index_html} style={routeStyles.iframe} />
                </div>
              </div>
            )}

            {response.route_info && (
              <div style={routeStyles.card}>
                <h3 style={routeStyles.cardTitle}>Route parameters</h3>
                <pre style={routeStyles.jsonBlock}>
                  {typeof response.route_info === "object" ? JSON.stringify(response.route_info, null, 2) : response.route_info}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const routeStyles: { [key: string]: React.CSSProperties } = {
  scrollWrapper: { width: "100%", height: "100%", minWidth: 0, overflowY: "auto", overflowX: "hidden", padding: "20px 16px", boxSizing: "border-box" },
  container: { width: "100%", maxWidth: "1400px", minWidth: 0, margin: "0 auto", display: "flex", flexDirection: "column", gap: "18px", boxSizing: "border-box" },
  header: { textAlign: "left" },
  headerTitle: { margin: 0, fontFamily: "'Space Grotesk', sans-serif", fontSize: "1.35rem", fontWeight: 600, letterSpacing: "-0.02em", color: "#edf0f5" },
  headerSubtitle: { margin: "4px 0 0 0", fontSize: "0.85rem", color: "#9aa4b6" },
  form: { display: "flex", flexDirection: "column", gap: "14px", backgroundColor: "#10151d", padding: "18px", borderRadius: "12px", border: "1px solid rgba(237,240,245,0.07)", minWidth: 0, boxSizing: "border-box" },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "14px", minWidth: 0 },
  inputGroup: { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 },
  label: { fontSize: "0.75rem", fontWeight: 600, color: "#9aa4b6" },
  input: { padding: "10px 13px", borderRadius: "8px", border: "1px solid rgba(237,240,245,0.14)", backgroundColor: "#0a0e15", color: "#edf0f5", fontSize: "0.9rem", outline: "none", width: "100%", minWidth: 0, boxSizing: "border-box" },
  button: { padding: "12px 24px", background: "linear-gradient(120deg, #f0a83c 0%, #d9633b 100%)", color: "#14100a", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "0.92rem", width: "100%" },
  error: { padding: "12px 16px", backgroundColor: "rgba(229, 101, 74, 0.12)", border: "1px solid rgba(229, 101, 74, 0.3)", color: "#f0a08c", borderRadius: "8px", fontSize: "0.875rem" },
  resultsContainer: { display: "flex", flexDirection: "column", gap: "18px" },
  successBanner: { backgroundColor: "rgba(70, 201, 166, 0.1)", border: "1px solid rgba(70, 201, 166, 0.25)", color: "#8fe0cb", padding: "11px 15px", borderRadius: "8px", fontWeight: 500, fontSize: "0.88rem" },
  card: { backgroundColor: "#10151d", padding: "18px", borderRadius: "12px", border: "1px solid rgba(237,240,245,0.07)" },
  cardTitle: { margin: "0 0 14px 0", fontFamily: "'Space Grotesk', sans-serif", fontSize: "1.02rem", fontWeight: 600, color: "#edf0f5" },
  riskGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px" },
  riskMetricCard: { display: "flex", flexDirection: "column", alignItems: "center", padding: "14px", borderRadius: "8px", backgroundColor: "#0a0e15", border: "1px solid transparent" },
  riskCount: { fontSize: "1.6rem", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif" },
  riskLabel: { fontSize: "0.7rem", color: "#9aa4b6", marginTop: "4px" },
  badge: { display: "inline-block", padding: "3px 9px", borderRadius: "12px", fontWeight: 600, fontSize: "0.7rem", border: "1px solid transparent" },
  tableWrapper: { width: "100%", overflowX: "auto", borderRadius: "8px", border: "1px solid rgba(237,240,245,0.07)" },
  table: { width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.85rem" },
  th: { borderBottom: "1px solid rgba(237,240,245,0.1)", padding: "10px 13px", backgroundColor: "rgba(237,240,245,0.02)", fontWeight: 600, color: "#9aa4b6", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid rgba(237,240,245,0.05)" },
  tdIndex: { padding: "10px 13px", color: "#5f6a7d", width: "36px" },
  tdBold: { padding: "10px 13px", fontWeight: 600, whiteSpace: "nowrap", color: "#edf0f5" },
  td: { padding: "10px 13px", whiteSpace: "nowrap", color: "#c3cad6" },
  tdDesc: { padding: "10px 13px", color: "#9aa4b6", minWidth: "180px", wordBreak: "break-word" },
  jsonBlock: { backgroundColor: "#0a0e15", padding: "13px", borderRadius: "8px", overflowX: "auto", fontSize: "0.78rem", color: "#8fe0cb", margin: 0, border: "1px solid rgba(237,240,245,0.05)" },
  mapWrapper: { width: "100%", borderRadius: "8px", overflow: "hidden", border: "1px solid rgba(237,240,245,0.1)", backgroundColor: "#fff" },
  iframe: { width: "100%", height: "380px", border: "none", display: "block" },
};

/* ----------------------------------------------------
   SUB-COMPONENT: Weather Report (offline-capable)
   Adapted from the standalone WeatherGPT offline-mode app —
   same Open-Meteo data source and localStorage caching,
   rebuilt as React state instead of direct DOM manipulation.
---------------------------------------------------- */
const WEATHER_REPORT_STORAGE_KEY = "weatherGPT_offline_forecast";

const WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0: "☀️ Clear",
  1: "🌤️ Mainly clear",
  2: "⛅ Partly cloudy",
  3: "☁️ Cloudy",
  45: "🌫️ Fog",
  48: "🌫️ Fog",
  51: "🌦️ Light drizzle",
  53: "🌦️ Drizzle",
  55: "🌧️ Heavy drizzle",
  61: "🌦️ Light rain",
  63: "🌧️ Rain",
  65: "🌧️ Heavy rain",
  71: "🌨️ Light snow",
  73: "❄️ Snow",
  75: "❄️ Heavy snow",
  80: "🌦️ Rain showers",
  81: "🌧️ Rain showers",
  82: "🌧️ Heavy showers",
  95: "⛈️ Thunderstorm",
  96: "⛈️ Thunderstorm + hail",
  99: "⛈️ Thunderstorm + hail",
};

const getWeatherCodeDescription = (code: number) => WEATHER_CODE_DESCRIPTIONS[code] || "🌤️ Unknown";

interface GeoResult {
  latitude: number;
  longitude: number;
  name: string;
  country?: string;
}

interface HourlyBlock {
  time: string[];
  temperature: number[];
  humidity: number[];
  precipitationProbability: number[];
  weatherCode: number[];
  wind: number[];
}

interface DailyBlock {
  time: string[];
  weatherCode: number[];
  maxTemperature: number[];
  minTemperature: number[];
  precipitationProbability: number[];
  maxWind: number[];
}

interface ForecastRecord {
  location: GeoResult;
  savedAt: string;
  hourly24h: HourlyBlock;
  daily7days: DailyBlock;
}

async function geocodeCity(city: string): Promise<GeoResult> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Unable to look up that location.");
  const data = await res.json();
  if (!data.results || data.results.length === 0) throw new Error("Location not found.");
  const r = data.results[0];
  return { latitude: r.latitude, longitude: r.longitude, name: r.name, country: r.country };
}

async function reverseGeocodeForReport(latitude: number, longitude: number): Promise<string> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=jsonv2&zoom=10`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("reverse lookup failed");
    const data = await res.json();
    const addr = data.address || {};
    return addr.city || addr.town || addr.village || addr.county || data.display_name || "Current location";
  } catch {
    return "Current location";
  }
}

async function fetchForecastRecord(place: GeoResult): Promise<ForecastRecord> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    `&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max` +
    `&forecast_days=7&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Weather request failed.");
  const data = await res.json();

  return {
    location: place,
    savedAt: new Date().toISOString(),
    hourly24h: {
      time: data.hourly.time.slice(0, 24),
      temperature: data.hourly.temperature_2m.slice(0, 24),
      humidity: data.hourly.relative_humidity_2m.slice(0, 24),
      precipitationProbability: data.hourly.precipitation_probability.slice(0, 24),
      weatherCode: data.hourly.weather_code.slice(0, 24),
      wind: data.hourly.wind_speed_10m.slice(0, 24),
    },
    daily7days: {
      time: data.daily.time.slice(0, 7),
      weatherCode: data.daily.weather_code.slice(0, 7),
      maxTemperature: data.daily.temperature_2m_max.slice(0, 7),
      minTemperature: data.daily.temperature_2m_min.slice(0, 7),
      precipitationProbability: data.daily.precipitation_probability_max.slice(0, 7),
      maxWind: data.daily.wind_speed_10m_max.slice(0, 7),
    },
  };
}

function loadPersistedForecast(): ForecastRecord | null {
  try {
    const saved = localStorage.getItem(WEATHER_REPORT_STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function persistForecast(record: ForecastRecord) {
  try {
    localStorage.setItem(WEATHER_REPORT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage full or unavailable — the report still works for this session.
  }
}

function WeatherReportView({ location }: { location: Coordinates | null }) {
  const [cityInput, setCityInput] = useState("");
  const [record, setRecord] = useState<ForecastRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const autoLoadedRef = useRef(false);

  useEffect(() => {
    const saved = loadPersistedForecast();
    if (saved) setRecord(saved);

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // If we already have the browser's geolocation and nothing saved yet, load it automatically.
  useEffect(() => {
    if (autoLoadedRef.current || record || !location) return;
    autoLoadedRef.current = true;

    (async () => {
      setLoading(true);
      try {
        const name = await reverseGeocodeForReport(location.latitude, location.longitude);
        const place: GeoResult = { latitude: location.latitude, longitude: location.longitude, name };
        const next = await fetchForecastRecord(place);
        persistForecast(next);
        setRecord(next);
      } catch {
        // Silent — the user can still search manually.
      } finally {
        setLoading(false);
      }
    })();
  }, [location, record]);

  const runSearch = async (cityOverride?: string) => {
    const city = (cityOverride ?? cityInput).trim();
    if (!city) {
      setBanner({ tone: "error", text: "Enter a city to look up." });
      return;
    }

    if (!online) {
      const saved = loadPersistedForecast();
      if (saved) {
        setRecord(saved);
        setBanner({ tone: "info", text: "You're offline — showing the last saved forecast." });
      } else {
        setBanner({ tone: "error", text: "You're offline and no forecast has been saved yet." });
      }
      return;
    }

    setLoading(true);
    setBanner(null);
    try {
      const place = await geocodeCity(city);
      const next = await fetchForecastRecord(place);
      persistForecast(next);
      setRecord(next);
    } catch (err: any) {
      const saved = loadPersistedForecast();
      if (saved) {
        setRecord(saved);
        setBanner({ tone: "info", text: `${err.message || "Couldn't refresh."} Showing the last saved forecast.` });
      } else {
        setBanner({ tone: "error", text: err.message || "Unable to get weather data." });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={routeStyles.scrollWrapper}>
      <div style={routeStyles.container}>
        <header style={routeStyles.header}>
          <h2 style={routeStyles.headerTitle}>Weather report</h2>
          <p style={routeStyles.headerSubtitle}>
            Search any city, or use your current location. The latest forecast is cached on this device for offline viewing.
          </p>
        </header>

        <div style={reportStyles.searchRow}>
          <span className={`location-indicator ${online ? "granted" : "denied"}`} style={reportStyles.statusPill} title={online ? "Online" : "Offline — showing cached data"}>
            {online ? "🟢 Online" : "🔴 Offline"}
          </span>
          <input
            type="text"
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Enter city e.g. Delhi"
            style={{ ...routeStyles.input, flex: 1 }}
          />
          <button onClick={() => runSearch()} disabled={loading} style={reportStyles.searchButton}>
            {loading ? "Loading…" : "Get weather"}
          </button>
        </div>

        {banner && (
          <div style={banner.tone === "error" ? routeStyles.error : routeStyles.successBanner}>{banner.text}</div>
        )}

        {!record && !loading && (
          <div style={routeStyles.card}>
            <p style={{ margin: 0, color: "#9aa4b6", fontSize: "0.88rem" }}>
              Search for a location to load the forecast.
            </p>
          </div>
        )}

        {record && (
          <>
            <div style={routeStyles.card}>
              <div style={reportStyles.currentRow}>
                <div>
                  <h3 style={{ ...routeStyles.cardTitle, marginBottom: "2px" }}>
                    {record.location.name}{record.location.country ? `, ${record.location.country}` : ""}
                  </h3>
                  <p style={{ margin: 0, fontSize: "0.78rem", color: "#5f6a7d" }}>
                    Last updated: {new Date(record.savedAt).toLocaleString()}
                  </p>
                </div>
                <div style={reportStyles.bigTemp}>{Math.round(record.hourly24h.temperature[0])}°C</div>
              </div>
              <div style={reportStyles.currentMeta}>
                <span>{getWeatherCodeDescription(record.hourly24h.weatherCode[0])}</span>
                <span>💧 Humidity: {record.hourly24h.humidity[0]}%</span>
                <span>💨 Wind: {record.hourly24h.wind[0]} km/h</span>
              </div>
            </div>

            <div style={routeStyles.card}>
              <h3 style={routeStyles.cardTitle}>24-hour forecast</h3>
              <div style={reportStyles.hourlyStrip}>
                {record.hourly24h.time.map((t, i) => (
                  <div key={t} style={reportStyles.hourCard}>
                    <div style={reportStyles.hourTime}>
                      {new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </div>
                    <div style={reportStyles.hourTemp}>{Math.round(record.hourly24h.temperature[i])}°C</div>
                    <div style={reportStyles.hourCondition}>{getWeatherCodeDescription(record.hourly24h.weatherCode[i])}</div>
                    <div style={reportStyles.hourMeta}>💧 {record.hourly24h.humidity[i]}%</div>
                    <div style={reportStyles.hourMeta}>🌧️ {record.hourly24h.precipitationProbability[i]}%</div>
                    <div style={reportStyles.hourMeta}>💨 {record.hourly24h.wind[i]} km/h</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={routeStyles.card}>
              <h3 style={routeStyles.cardTitle}>7-day forecast</h3>
              <div style={reportStyles.dailyGrid}>
                {record.daily7days.time.map((t, i) => (
                  <div key={t} style={reportStyles.dayCard}>
                    <strong style={{ color: "#edf0f5", fontSize: "0.82rem" }}>
                      {new Date(t).toLocaleDateString([], { weekday: "long" })}
                    </strong>
                    <span style={{ fontSize: "0.8rem" }}>{getWeatherCodeDescription(record.daily7days.weatherCode[i])}</span>
                    <span style={{ fontSize: "0.8rem", color: "#c3cad6" }}>
                      🌡️ {Math.round(record.daily7days.maxTemperature[i])}° / {Math.round(record.daily7days.minTemperature[i])}°
                    </span>
                    <span style={{ fontSize: "0.8rem", color: "#9aa4b6" }}>
                      🌧️ {record.daily7days.precipitationProbability[i]}%
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <p style={reportStyles.offlineNote}>
              📦 Stored {record.hourly24h.time.length} hourly and {record.daily7days.time.length} daily records on this
              device — this forecast stays available even without a connection.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const reportStyles: { [key: string]: React.CSSProperties } = {
  searchRow: { display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" },
  statusPill: { padding: "6px 12px", borderRadius: "20px", fontSize: "0.78rem", fontWeight: 600, width: "auto", height: "auto", cursor: "default" },
  searchButton: { padding: "10px 20px", background: "linear-gradient(120deg, #f0a83c 0%, #d9633b 100%)", color: "#14100a", border: "none", borderRadius: "8px", cursor: "pointer", fontWeight: 600, fontSize: "0.88rem", whiteSpace: "nowrap" },
  currentRow: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "10px" },
  bigTemp: { fontSize: "2.2rem", fontWeight: 700, fontFamily: "'Space Grotesk', sans-serif", color: "#f0a83c" },
  currentMeta: { display: "flex", gap: "16px", flexWrap: "wrap", marginTop: "12px", fontSize: "0.85rem", color: "#c3cad6" },
  hourlyStrip: { display: "flex", gap: "10px", overflowX: "auto", paddingBottom: "4px" },
  hourCard: { flex: "0 0 auto", minWidth: "108px", padding: "12px", borderRadius: "10px", backgroundColor: "#0a0e15", border: "1px solid rgba(237,240,245,0.07)", display: "flex", flexDirection: "column", gap: "4px" },
  hourTime: { fontSize: "0.78rem", color: "#9aa4b6", fontWeight: 600 },
  hourTemp: { fontSize: "1.1rem", fontWeight: 700, color: "#edf0f5" },
  hourCondition: { fontSize: "0.75rem", color: "#c3cad6" },
  hourMeta: { fontSize: "0.7rem", color: "#5f6a7d" },
  dailyGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "10px" },
  dayCard: { display: "flex", flexDirection: "column", gap: "4px", padding: "14px", borderRadius: "10px", backgroundColor: "#0a0e15", border: "1px solid rgba(237,240,245,0.07)" },
  offlineNote: { margin: 0, fontSize: "0.78rem", color: "#5f6a7d", textAlign: "center" },
};

/* ----------------------------------------------------
   MAIN APP COMPONENT
---------------------------------------------------- */
interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

type LocationStatus = "pending" | "granted" | "denied" | "unsupported";

export default function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const [location, setLocation] = useState<Coordinates | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>("pending");

  const [isSidebarOpen, setIsSidebarOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth > 768 : true
  );
  const [activeNav, setActiveNav] = useState("chat");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const requestLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("unsupported");
      return;
    }
    setLocationStatus("pending");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setLocationStatus("granted");
      },
      () => {
        setLocation(null);
        setLocationStatus("denied");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 }
    );
  };

  // Ask for location once on load so it's ready by the time the first message sends.
  useEffect(() => {
    requestLocation();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
  };

  const sendMessage = async (overridePrompt?: string) => {
    const prompt = (overridePrompt || input).trim();
    if (!prompt || loading) return;

    const userMessage: Message = { role: "user", content: prompt };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    if (textareaRef.current) textareaRef.current.style.height = "auto";

    try {
      const response = await fetch(`${API_URL}/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          location: location
            ? { latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy }
            : null,
        }),
      });

      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);

      const data = await response.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.message }]);
    } catch (error) {
      console.error("Agent error:", error);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I couldn't connect to the WeatherGPT server. Please verify your connection or API server status." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => setMessages([]);

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;
  const selectNav = (id: string) => {
    setActiveNav(id);
    if (isMobile) setIsSidebarOpen(false);
  };

  return (
    <div className="app-layout">
      {isSidebarOpen && <div className="sidebar-backdrop" onClick={() => setIsSidebarOpen(false)} />}

      {/* SIDEBAR */}
      <aside className={`sidebar ${isSidebarOpen ? "open" : "collapsed"}`}>
        <div className="sidebar-header">
          <div className="brand-mark"><IconCloudSun /></div>
          {isSidebarOpen && <span className="brand-title">WeatherGPT</span>}
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => selectNav(item.id)}
              className={`nav-item ${activeNav === item.id ? "active" : ""}`}
              title={!isSidebarOpen ? item.label : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              {isSidebarOpen && <span className="nav-label">{item.label}</span>}
              {isSidebarOpen && item.badge && <span className="nav-badge">{item.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="toggle-sidebar-btn" onClick={() => setIsSidebarOpen(!isSidebarOpen)} aria-label="Toggle sidebar">
            <span className="toggle-icon"><IconChevron dir={isSidebarOpen ? "left" : "right"} /></span>
            {isSidebarOpen && <span className="toggle-label">Collapse</span>}
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT AREA */}
      <div className="main-viewport">
        <header className="gemini-header">
          <div className="header-left">
            {!isSidebarOpen && (
              <button onClick={() => setIsSidebarOpen(true)} className="menu-trigger-btn" aria-label="Open sidebar">
                <IconMenu />
              </button>
            )}
            <span className="current-view-title">{NAV_ITEMS.find((item) => item.id === activeNav)?.label}</span>
          </div>

          <div className="header-right">
            <button
              className={`location-indicator ${locationStatus}`}
              onClick={() => locationStatus !== "pending" && requestLocation()}
              title={
                locationStatus === "granted"
                  ? "Sharing your location with WeatherGPT"
                  : locationStatus === "denied"
                  ? "Location blocked — click to try again"
                  : locationStatus === "unsupported"
                  ? "Location isn't available in this browser"
                  : "Requesting your location…"
              }
              aria-label="Location status"
            >
              <IconPin />
            </button>
            {activeNav === "chat" && messages.length > 0 && (
              <button onClick={clearChat} className="clear-chat-btn">Clear chat</button>
            )}
            <div className="avatar-badge-outer">
              <div className="avatar-badge-inner">AI</div>
            </div>
          </div>
        </header>

        <div className="view-container">
          {activeNav === "chat" && (
            <div className="gemini-chat-container">
              <main className="chat-body">
                <div className="chat-wrapper">
                  {messages.length === 0 && (
                    <div className="empty-state">
                      <div className="empty-state-mark"><IconCloudSun /></div>
                      <h2 className="greeting-subtext">Where would you like weather updates for today?</h2>

                      <div className="suggestion-grid">
                        {suggestions.map((item, idx) => (
                          <button key={idx} onClick={() => sendMessage(item.text)} className="suggestion-card">
                            <p>{item.text}</p>
                            <div className="suggestion-card-footer">
                              <span className="suggestion-title">{item.title}</span>
                              <div className="suggestion-icon-circle">{item.icon}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {messages.length > 0 && (
                    <div className="message-list">
                      {messages.map((msg, index) => {
                        const isUser = msg.role === "user";
                        return (
                          <div key={index} className={`message-row ${isUser ? "user" : "assistant"}`}>
                            {!isUser && <div className="assistant-avatar"><IconCloudSun /></div>}

                            <div className="message-bubble-container">
                              {isUser ? (
                                <div className="user-bubble"><p>{msg.content}</p></div>
                              ) : (
                                <div className="assistant-bubble">
                                  <div className="assistant-content">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                                  </div>
                                </div>
                              )}
                            </div>

                            {isUser && <div className="user-avatar">U</div>}
                          </div>
                        );
                      })}

                      {loading && (
                        <div className="loading-row">
                          <div className="assistant-avatar"><IconCloudSun /></div>
                          <div className="pulse-bar" />
                        </div>
                      )}

                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>
              </main>

              <div className="input-area">
                <div className="input-pill-wrapper">
                  <div className="input-pill">
                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={handleInput}
                      onKeyDown={handleKeyDown}
                      disabled={loading}
                      rows={1}
                      placeholder="Ask WeatherGPT..."
                      className="chat-textarea"
                    />
                    <button onClick={() => sendMessage()} disabled={!input.trim() || loading} className="send-btn" aria-label="Send message">
                      <IconSend />
                    </button>
                  </div>
                </div>
                <p className="disclaimer-text">WeatherGPT may display inaccurate info, including about weather conditions.</p>
              </div>
            </div>
          )}

          {activeNav === "route" && <RouteWeatherView />}

          {activeNav === "report" && <WeatherReportView location={location} />}

          {activeNav !== "chat" && activeNav !== "route" && activeNav !== "report" && (
            <div className="route-placeholder-screen">
              <div className="placeholder-card">
                <span className="placeholder-icon">{NAV_ITEMS.find((item) => item.id === activeNav)?.icon}</span>
                <h2>{NAV_ITEMS.find((item) => item.id === activeNav)?.label}</h2>
                <p>This page route is ready to hold custom components and widgets.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}