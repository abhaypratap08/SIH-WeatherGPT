import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Anchor,
  Building2,
  CheckCircle,
  CloudRain,
  Droplets,
  Flame,
  Map as MapIcon,
  MapPin,
  Plane,
  SprayCan,
  Sprout,
  Thermometer,
  TrendingUp,
  Waves,
  Wind,
} from 'lucide-react';
import AIChatWorkspace from './components/AIChatWorkspace';
import AppHeader from './components/AppHeader';
import IconRail from './components/IconRail';
import MobileDrawer from './components/MobileDrawer';
import WarningBulletin from './components/WarningBulletin';
import type { ImdSeverity, ImdWarning } from './components/WarningBulletin';
import WeatherMapView from './components/WeatherMapView';
import WeatherRadarView from './components/WeatherRadarView';
import type { NavPage } from './config/navigation';
import {
  ADVISORIES_ENDPOINT,
  ALERTS_ENDPOINT,
  CLIMATE_ENDPOINT,
  FetchDiagnosticError,
  fetchWithDiagnostics,
  ML_ROUTE_ENDPOINT,
  truncateForDiagnostics,
  WEATHER_ENDPOINTS,
  type WeatherQueryCoords,
} from './config/api';
import { useTheme } from './hooks/useTheme';
import {
  reverseGeocodeLabel,
  useLocation,
  type SelectedLocation,
} from './location/LocationContext';
import { reportCacheKey } from './location/locationCore';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

interface RouteApiResponse {
  message?: string;
  route_info?: any;
  risk_summary?: { HIGH?: number; MODERATE?: number; LOW?: number };
  weather_data?: WeatherPoint[] | any;
  index_html?: string;
}
interface WeatherPoint {
  location?: string; point?: string; weather?: string; condition?: string;
  temp?: number | string; temperature?: number | string;
  risk?: string; risk_level?: string; description?: string; notes?: string;
  [key: string]: any;
}
interface GeoResult { latitude: number; longitude: number; name: string; country?: string; }
interface HourlyBlock {
  time: string[]; temperature: number[]; humidity: number[];
  precipitationProbability: number[]; weatherCode: number[]; wind: number[];
}
interface DailyBlock {
  time: string[]; weatherCode: number[]; maxTemperature: number[];
  minTemperature: number[]; precipitationProbability: number[]; maxWind: number[];
}
interface ForecastRecord {
  location: GeoResult; savedAt: string;
  hourly24h: HourlyBlock; daily7days: DailyBlock;
}

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

const WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle',
  55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow',
  80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers',
  95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
};
const wmoDesc = (code: number) => WEATHER_CODE_DESCRIPTIONS[code] ?? 'Unknown';

// Dev-only demo seam so components can be previewed without mutating the
// deployed backend (open the app with ?demo=1 in dev).
const IS_DEMO = import.meta.env.DEV
  && typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('demo') === '1';

const DEMO_WARNING: ImdWarning = {
  district: 'Sitamarhi district',
  severity: 'orange',
  title: 'Heavy to very heavy rainfall warning',
  text: '"Isolated heavy to very heavy rainfall (7-20 cm) very likely at one or two places over Sitamarhi and adjoining districts during the next 48 hours, with possibility of localised flooding in low-lying areas."',
  issuedAt: '05:30 IST, 23 Sep',
};

// ─────────────────────────────────────────────────────────────────────
// Weather report helpers (offline-capable)
// ─────────────────────────────────────────────────────────────────────

async function geocodeCity(city: string): Promise<GeoResult> {
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
  if (!res.ok) throw new Error('Unable to look up that location.');
  const data = await res.json();
  if (!data.results?.length) throw new Error('Location not found.');
  const r = data.results[0];
  return { latitude: r.latitude, longitude: r.longitude, name: r.name, country: r.country };
}

async function fetchForecastRecord(place: GeoResult): Promise<ForecastRecord> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    `&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max` +
    `&forecast_days=7&timezone=auto`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather request failed.');
  const d = await res.json();
  return {
    location: place, savedAt: new Date().toISOString(),
    hourly24h: {
      time: d.hourly.time.slice(0, 24), temperature: d.hourly.temperature_2m.slice(0, 24),
      humidity: d.hourly.relative_humidity_2m.slice(0, 24),
      precipitationProbability: d.hourly.precipitation_probability.slice(0, 24),
      weatherCode: d.hourly.weather_code.slice(0, 24), wind: d.hourly.wind_speed_10m.slice(0, 24),
    },
    daily7days: {
      time: d.daily.time.slice(0, 7), weatherCode: d.daily.weather_code.slice(0, 7),
      maxTemperature: d.daily.temperature_2m_max.slice(0, 7),
      minTemperature: d.daily.temperature_2m_min.slice(0, 7),
      precipitationProbability: d.daily.precipitation_probability_max.slice(0, 7),
      maxWind: d.daily.wind_speed_10m_max.slice(0, 7),
    },
  };
}
/**
 * Per-location offline cache: `reportCacheKey` (locationCore) embeds the
 * coordinates so a Delhi record can never satisfy a Ghaziabad request; the
 * cache is read only for the CURRENT coordinates and never seeds the
 * canonical selection (§cache rules — persistence cannot resurrect a location).
 */
function loadCachedForecast(lat: number, lon: number): ForecastRecord | null {
  try { return JSON.parse(localStorage.getItem(reportCacheKey(lat, lon)) ?? 'null'); } catch { return null; }
}
function saveForecast(r: ForecastRecord, lat: number, lon: number) {
  try { localStorage.setItem(reportCacheKey(lat, lon), JSON.stringify(r)); } catch { /* storage full */ }
}

// ─────────────────────────────────────────────────────────────────────
// IMD severity helpers (bulletin + alerts list)
// ─────────────────────────────────────────────────────────────────────

function severityOf(a: any): ImdSeverity {
  const raw = [a?.severity, a?.informationClass, a?.description, a?.title]
    .filter(Boolean).join(' ').toLowerCase();
  if (/\bred\b/.test(raw)) return 'red';
  if (/\borange\b/.test(raw)) return 'orange';
  if (/\byellow\b/.test(raw)) return 'yellow';
  if (/\bgreen\b/.test(raw)) return 'green';
  return 'red';
}

const tierBadge = (sev: ImdSeverity | undefined): React.CSSProperties => {
  switch (sev) {
    case 'green': return { background: 'var(--watch-green-tint)', color: 'var(--watch-green)', borderColor: 'var(--watch-green)' };
    case 'yellow': return { background: 'var(--watch-yellow-tint)', color: 'var(--watch-yellow-deep)', borderColor: 'var(--watch-yellow)' };
    case 'orange': return { background: 'var(--watch-orange-tint)', color: 'var(--watch-orange-deep)', borderColor: 'var(--watch-orange)' };
    case 'red': return { background: 'var(--watch-red-tint)', color: 'var(--watch-red-deep)', borderColor: 'var(--watch-red)' };
    default: return { background: 'var(--slate-teal-tint)', color: 'var(--slate-teal)', borderColor: 'var(--slate-teal)' };
  }
};

const tierBorder = (sev: ImdSeverity): string => {
  switch (sev) {
    case 'green': return 'var(--watch-green)';
    case 'yellow': return 'var(--watch-yellow)';
    case 'orange': return 'var(--watch-orange)';
    case 'red': return 'var(--watch-red)';
    default: return 'var(--slate-teal)';
  }
};

// ─────────────────────────────────────────────────────────────────────
// Shared card styles (Route + Report + secondary pages)
// ─────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  card: { background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius-card)', padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' },
  cardTitle: { margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--ink)' },
  label: { fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--muted)' },
  input: { padding: '10px 13px', borderRadius: 'var(--radius-card)', border: '1px solid var(--line)', background: 'var(--paper)', color: 'var(--ink)', fontSize: '14px', outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-ui)' },
  btn: { padding: '11px 20px', background: 'var(--slate-teal-tint)', color: 'var(--slate-teal)', border: '1px solid var(--slate-teal)', borderRadius: 'var(--radius-btn)', cursor: 'pointer', fontWeight: 700, fontSize: '13.5px', fontFamily: 'var(--font-ui)' },
  error: { padding: '11px 15px', background: 'var(--watch-red-tint)', border: '1px solid var(--watch-red)', color: 'var(--watch-red-deep)', borderRadius: 'var(--radius-card)', fontSize: '13px' },
  successBanner: { padding: '11px 15px', background: 'var(--slate-teal-tint)', border: '1px solid var(--slate-teal)', color: 'var(--slate-teal)', borderRadius: 'var(--radius-card)', fontWeight: 500, fontSize: '13px' },
  badge: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 9px', borderRadius: 'var(--radius-chip)', fontWeight: 600, fontSize: '11px', border: '1px solid transparent' },
  tableWrap: { width: '100%', overflowX: 'auto', borderRadius: 'var(--radius-card)', border: '1px solid var(--line)' },
  table: { width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' },
  th: { borderBottom: '1px solid var(--line)', padding: '9px 13px', background: 'var(--mist)', fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap', fontSize: '11px', textTransform: 'uppercase' },
  tr: { borderBottom: '1px solid var(--line)' },
  td: { padding: '9px 13px', whiteSpace: 'nowrap', color: 'var(--ink)' },
  tdBold: { padding: '9px 13px', fontWeight: 600, whiteSpace: 'nowrap', color: 'var(--ink)' },
  tdIndex: { padding: '9px 13px', color: 'var(--muted)', width: '36px' },
  tdDesc: { padding: '9px 13px', color: 'var(--ink)', minWidth: '180px', wordBreak: 'break-word', whiteSpace: 'normal' },
  jsonBlock: { background: 'var(--mist)', padding: '13px', borderRadius: 'var(--radius-card)', overflowX: 'auto', fontSize: '12px', color: 'var(--ink)', margin: 0, border: '1px solid var(--line)', fontFamily: 'var(--font-mono)' },
  mapWrapper: { width: '100%', borderRadius: 'var(--radius-card)', overflow: 'hidden', border: '1px solid var(--line)', background: 'var(--paper)' },
  iframe: { width: '100%', height: '380px', border: 'none', display: 'block' },
};

// Token-based panel for rail/drawer destinations.
const P: Record<string, React.CSSProperties> = {
  panel: { background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius-card)', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' },
  h2: { margin: 0, fontSize: '19px', fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--font-display)', letterSpacing: '-0.01em' },
  metaCard: { background: 'var(--mist)', border: '1px solid var(--line)', borderRadius: 'var(--radius-card)', padding: '10px 12px' },
  mono: { fontFamily: 'var(--font-mono)' },
};

const riskStyle = (risk?: string): React.CSSProperties => {
  switch (String(risk ?? '').toUpperCase()) {
    case 'HIGH': return { background: 'var(--watch-red-tint)', color: 'var(--watch-red-deep)', borderColor: 'var(--watch-red)' };
    case 'MODERATE': return { background: 'var(--watch-orange-tint)', color: 'var(--watch-orange-deep)', borderColor: 'var(--watch-orange)' };
    case 'LOW': return { background: 'var(--slate-teal-tint)', color: 'var(--slate-teal)', borderColor: 'var(--slate-teal)' };
    default: return { background: 'var(--mist)', color: 'var(--muted)', borderColor: 'var(--line)' };
  }
};

/**
 * Build a user-safe HTTP error message that captures status, statusText and —
 * when the backend returns an ApiResponse envelope — its `message` field.
 * The raw body is never echoed wholesale; only the envelope's message is used.
 */
async function describeHttpError(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = await res.json();
    if (body && typeof body.message === 'string' && body.message) detail = `: ${body.message}`;
  } catch {
    /* non-JSON error body — status/statusText is enough */
  }
  return `HTTP ${res.status} ${res.statusText ?? ''}${detail}`.trim();
}

/**
 * Extract the backend's user-safe ApiResponse `message` from an already-read
 * response body, without echoing the raw body. Returns null when the body is
 * not the JSON envelope.
 */
function readApiResponseMessage(text: string): string | null {
  try {
    const body = JSON.parse(text);
    if (body && typeof body.message === 'string' && body.message) return body.message;
  } catch {
    /* non-JSON body */
  }
  return null;
}

/**
 * Build the coordinate + display-label query for backend weather requests.
 * The canonical location's name is a DISPLAY LABEL (it can be a reverse-
 * geocoded POI such as "16th Park View(GYC)"), so coordinates are the
 * authoritative query while the name travels along purely for presentation.
 *
 * Null-rejecting by construction: callers must guard `location === null`
 * (no location → no request) before invoking this.
 */
function toWeatherQuery(loc: SelectedLocation): WeatherQueryCoords {
  return { latitude: loc.latitude, longitude: loc.longitude, name: loc.name };
}

// ─────────────────────────────────────────────────────────────────────
// ClimateMapEmbed — OSM map inside climate panel
// ─────────────────────────────────────────────────────────────────────

/**
 * Small OSM map centred on the canonical selected location. The viewport and
 * the marker use the coordinates passed in — never a city-name geocode and
 * never a fallback center: the caller only renders this when a location
 * exists (no location → the climate page shows the NoLocation state instead).
 */
function ClimateMapEmbed({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    let cancelled = false;
    import('leaflet').then((L) => {
      if (mapRef.current) return;
      const map = L.map(ref.current!, { center: [lat, lon], zoom: 7, scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 18,
      }).addTo(map);
      const icon = L.divIcon({
        className: '',
        html: '<div class="map-loc-dot"></div>',
        iconSize: [12, 12], iconAnchor: [6, 6],
      });
      L.marker([lat, lon], { icon }).addTo(map).bindPopup(label);
      mapRef.current = map;
      if (!cancelled) setLoaded(true);
    });
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, [lat, lon, label]);

  return (
    <div style={{ position: 'relative', height: '280px', width: '100%' }}>
      {!loaded && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--mist)', zIndex: 10, color: 'var(--muted)', fontSize: '13px' }}>
          Loading map…
        </div>
      )}
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// RouteWeatherView
// ─────────────────────────────────────────────────────────────────────

function RouteWeatherView() {
  // The route planner is a user-driven journey form. It does NOT seed the
  // fields from the selected location and has no city defaults: the user
  // names both endpoints, so no hardcoded or pre-filled geography can ever
  // reach the route-weather API (§no-location).
  const [form, setForm] = useState({ origin: '', destination: '', departure_time: '08:00' });
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<RouteApiResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setErr(null); setResp(null);
    try {
      const res = await fetch(ML_ROUTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error(`Error ${res.status} - ${res.statusText}`);
      setResp(await res.json());
    } catch (e: any) { setErr(e.message || 'Failed to fetch route weather.'); }
    finally { setLoading(false); }
  };

  const riskBoxes: { key: string; fg: string; bg: string; border: string }[] = [
    { key: 'HIGH', fg: 'var(--watch-red-deep)', bg: 'var(--watch-red-tint)', border: 'var(--watch-red)' },
    { key: 'MODERATE', fg: 'var(--watch-orange-deep)', bg: 'var(--watch-orange-tint)', border: 'var(--watch-orange)' },
    { key: 'LOW', fg: 'var(--slate-teal)', bg: 'var(--slate-teal-tint)', border: 'var(--slate-teal)' },
  ];

  return (
    <div style={S.card}>
      <header>
        <h2 style={P.h2}>Route weather analyzer</h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>Check conditions and risk along a journey, point by point.</p>
      </header>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '14px' }}>
          {(['origin', 'destination'] as const).map(field => (
            <div key={field} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={S.label}>{field.charAt(0).toUpperCase() + field.slice(1)}</label>
              <input style={S.input} type="text" name={field} value={form[field]}
                onChange={e => setForm({ ...form, [field]: e.target.value })} required
                placeholder={field === 'origin' ? 'Starting point' : 'Finish point'} />
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <label style={S.label}>Departure time</label>
            <input style={S.input} type="time" name="departure_time" value={form.departure_time}
              onChange={e => setForm({ ...form, departure_time: e.target.value })} required />
          </div>
        </div>
        <button type="submit" disabled={loading} style={S.btn}>{loading ? 'Analyzing route…' : 'Analyze route'}</button>
      </form>

      {err && <div style={S.error}>{err}</div>}

      {resp && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {resp.message && <div style={S.successBanner}>{resp.message}</div>}

          {resp.risk_summary && (
            <div style={S.card}>
              <h3 style={S.cardTitle}>Risk summary</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '10px' }}>
                {riskBoxes.map(({ key, fg, bg, border }) => (
                  <div key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '14px', borderRadius: 'var(--radius-card)', background: bg, border: `1px solid ${border}` }}>
                    <span style={{ fontSize: '1.6rem', fontWeight: 700, color: fg, fontVariantNumeric: 'tabular-nums' }}>{(resp.risk_summary as any)[key] ?? 0}</span>
                    <span style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '4px' }}>{key.charAt(0) + key.slice(1).toLowerCase()}-risk waypoints</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {resp.weather_data && (
            <div style={S.card}>
              <h3 style={S.cardTitle}>Waypoint forecasts</h3>
              {Array.isArray(resp.weather_data) ? (
                <div style={S.tableWrap}>
                  <table style={S.table}>
                    <thead><tr>
                      {['#', 'Point', 'Condition', 'Temp', 'Risk', 'Details'].map(h => <th key={h} style={S.th}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {resp.weather_data.map((item: WeatherPoint, i: number) => {
                        const name = item.location || item.point || item.name || `Point ${i + 1}`;
                        const cond = item.weather || item.condition || item.sky || 'n/a';
                        const temp = (item.temp ?? item.temperature) !== undefined ? `${item.temp ?? item.temperature}°C` : 'n/a';
                        const risk = item.risk || item.risk_level || 'NORMAL';
                        const detail = item.description || item.notes || item.summary ||
                          Object.entries(item)
                            .filter(([k]) => !['location', 'point', 'weather', 'condition', 'temp', 'temperature', 'risk', 'risk_level'].includes(k))
                            .map(([k, v]) => `${k}: ${v}`).join(', ');
                        return (
                          <tr key={i} style={S.tr}>
                            <td style={S.tdIndex}>{i + 1}</td>
                            <td style={S.tdBold}>{name}</td>
                            <td style={S.td}>{cond}</td>
                            <td style={S.td}>{temp}</td>
                            <td style={S.td}><span style={{ ...S.badge, ...riskStyle(risk) }}>{risk.toUpperCase()}</span></td>
                            <td style={S.tdDesc}>{detail || 'n/a'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <pre style={S.jsonBlock}>{JSON.stringify(resp.weather_data, null, 2)}</pre>
              )}
            </div>
          )}

          {resp.index_html && (
            <div style={S.card}>
              <h3 style={S.cardTitle}>Route map</h3>
              <div style={S.mapWrapper}>
                <iframe title="Route map" srcDoc={resp.index_html} style={S.iframe} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// WeatherReportView (offline-capable)
// ─────────────────────────────────────────────────────────────────────

function WeatherReportView() {
  const { location, setLocation } = useLocation();
  const [cityInput, setCityInput] = useState('');
  const [record, setRecord] = useState<ForecastRecord | null>(() =>
    location ? loadCachedForecast(location.latitude, location.longitude) : null,
  );
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const lastKeyRef = useRef('');

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Follows the canonical location: show the per-location offline cache, or
  // fetch the forecast for exactly these coordinates. No location → no
  // forecast and no fetch (§no-location).
  useEffect(() => {
    if (!location) {
      setRecord(null);
      lastKeyRef.current = '';
      return;
    }
    const { latitude, longitude, name } = location;
    const key = `${latitude},${longitude}`;
    const cached = loadCachedForecast(latitude, longitude);
    if (cached) {
      setRecord(cached);
      lastKeyRef.current = key;
      return;
    }
    // Never keep another place's forecast on screen while this one loads.
    if (lastKeyRef.current !== key) setRecord(null);
    lastKeyRef.current = key;
    let cancelled = false;
    setLoading(true);
    setBanner(null);
    (async () => {
      try {
        const label = name && name !== 'Selected point'
          ? name
          : await reverseGeocodeLabel(latitude, longitude);
        const r = await fetchForecastRecord({ latitude, longitude, name: label });
        if (!cancelled) { saveForecast(r, latitude, longitude); setRecord(r); }
      } catch {
        if (!cancelled) setBanner({ tone: 'error', text: 'Weather data unavailable for this location.' });
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [location]);

  const search = async (override?: string) => {
    const city = (override ?? cityInput).trim();
    if (!city) { setBanner({ tone: 'error', text: 'Enter a city.' }); return; }
    if (!online) {
      if (record) setBanner({ tone: 'info', text: 'Offline. Showing cached forecast.' });
      else setBanner({ tone: 'error', text: 'Offline and no cached forecast.' });
      return;
    }
    setLoading(true); setBanner(null);
    try {
      const place = await geocodeCity(city);
      // Search selects the canonical location: every location-aware feature
      // (map, radar, warnings, chat context) now follows the searched city.
      setLocation({ latitude: place.latitude, longitude: place.longitude, name: place.name, country: place.country, source: 'search' });
      setCityInput('');
      setLoading(false); // same-coords search won't re-trigger the location effect
    } catch (e: any) {
      if (record) setBanner({ tone: 'info', text: `${e.message} Showing cached forecast.` });
      else setBanner({ tone: 'error', text: e.message });
      setLoading(false);
    }
  };

  const fmtTime = (t: string) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtDay = (t: string) => new Date(t).toLocaleDateString([], { weekday: 'long' });

  return (
    <div style={S.card}>
      <header>
        <h2 style={P.h2}>Weather report</h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--muted)' }}>Search any city. Forecast is cached for offline use.</p>
      </header>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: 'var(--radius-btn)', fontSize: '12px', fontWeight: 600, border: '1px solid var(--line)', color: online ? 'var(--slate-teal)' : 'var(--muted)' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: online ? 'var(--slate-teal)' : 'var(--muted)' }} />
          {online ? 'Online' : 'Offline'}
        </span>
        <input style={{ ...S.input, flex: 1, minWidth: '180px' }} type="text" value={cityInput}
          onChange={e => setCityInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Enter a city" />
        <button onClick={() => search()} disabled={loading}
          style={S.btn}>
          {loading ? 'Loading…' : 'Get weather'}
        </button>
      </div>

      {banner && <div style={banner.tone === 'error' ? S.error : S.successBanner}>{banner.text}</div>}

      {!record && !loading && (
        <div style={S.card}><p style={{ margin: 0, color: 'var(--muted)', fontSize: '13px' }}>Search a city to load a forecast.</p></div>
      )}

      {record && (<>
        <div style={S.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h3 style={{ ...S.cardTitle, marginBottom: 2 }}>{record.location.name}{record.location.country ? `, ${record.location.country}` : ''}</h3>
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>Updated {new Date(record.savedAt).toLocaleString()}</p>
            </div>
            <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--slate-teal)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(record.hourly24h.temperature[0])}°C</div>
          </div>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '13px', color: 'var(--ink)' }}>
            <span>{wmoDesc(record.hourly24h.weatherCode[0])}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}><Droplets size={14} style={{ color: 'var(--slate-teal)' }} /> {record.hourly24h.humidity[0]}%</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}><Wind size={14} style={{ color: 'var(--slate-teal)' }} /> {record.hourly24h.wind[0]} km/h</span>
          </div>
        </div>

        <div style={S.card}>
          <h3 style={S.cardTitle}>24-hour forecast</h3>
          <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px' }}>
            {record.hourly24h.time.map((t, i) => (
              <div key={t} style={{ flex: '0 0 auto', minWidth: '108px', padding: '12px', borderRadius: 'var(--radius-card)', background: 'var(--mist)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{ fontSize: '11px', color: 'var(--slate-teal)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{fmtTime(t)}</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(record.hourly24h.temperature[i])}°C</div>
                <div style={{ fontSize: '11px', color: 'var(--muted)' }}>{wmoDesc(record.hourly24h.weatherCode[i])}</div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Droplets size={12} /> {record.hourly24h.humidity[i]}%</div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><CloudRain size={12} /> {record.hourly24h.precipitationProbability[i]}%</div>
                <div style={{ fontSize: '11px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><Wind size={12} /> {record.hourly24h.wind[i]} km/h</div>
              </div>
            ))}
          </div>
        </div>

        <div style={S.card}>
          <h3 style={S.cardTitle}>7-day forecast</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '10px' }}>
            {record.daily7days.time.map((t, i) => (
              <div key={t} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '14px', borderRadius: 'var(--radius-card)', background: 'var(--mist)', border: '1px solid var(--line)' }}>
                <strong style={{ color: 'var(--ink)', fontSize: '13px' }}>{fmtDay(t)}</strong>
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{wmoDesc(record.daily7days.weatherCode[i])}</span>
                <span style={{ fontSize: '12px', color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '4px' }}><Thermometer size={12} style={{ color: 'var(--slate-teal)' }} /> {Math.round(record.daily7days.maxTemperature[i])}° / {Math.round(record.daily7days.minTemperature[i])}°</span>
                <span style={{ fontSize: '12px', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: '4px' }}><CloudRain size={12} /> {record.daily7days.precipitationProbability[i]}%</span>
              </div>
            ))}
          </div>
        </div>
      </>)}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// NoLocation — shared "no location selected" state for every page that
// depends on the canonical location. Rendered instead of the page content
// (and instead of any fetch) whenever location === null (§no-location).
// ─────────────────────────────────────────────────────────────────────

function NoLocation({ feature }: { feature: string }) {
  return (
    <div style={P.panel} className="page-panel">
      <header>
        <h2 style={P.h2}>{feature}</h2>
      </header>
      <div style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--muted)' }}>
        <MapPin size={30} style={{ margin: '0 auto 12px', opacity: 0.6 }} />
        <p style={{ margin: 0, fontWeight: 600, color: 'var(--ink)' }}>No location selected</p>
        <p style={{ margin: '8px auto 0', fontSize: '13px', maxWidth: '48ch', lineHeight: 1.6 }}>
          Choose where to check the weather — enable GPS from the pill, search a city on the
          Weather report page, or tap the Weather map. Until a location exists, no weather
          data is requested.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Root App component — chat-first layout
// ─────────────────────────────────────────────────────────────────────

export default function App() {
  const { theme, toggleTheme } = useTheme();

  // ── Navigation: chat is the primary view; rail/drawer hold the rest ──
  const [activePage, setActivePage] = useState<NavPage | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── Chat language: feeds the header toggle AND the AI chat's
  // placeholder/voice locale (the chat itself lives in AIChatWorkspace).
  const [selectedLang, setSelectedLang] = useState<'en' | 'hi'>('en');
  // One canonical selected location: the header pill, GPS, search, map taps
  // and every data fetch all read/write this single state. The AI chat
  // (AIChatWorkspace) consumes the same state and posts the current
  // coordinates with every /agent request. `location === null` means "no
  // location yet" — every data page below treats it as "no requests".
  const {
    location,
    locationKey,
    state: locationState,
    requestGpsLocation,
  } = useLocation();

  // ── Java-backend data state (rail/drawer pages) ──
  // Every data page carries explicit loading/error state so a failed request
  // surfaces an error + Retry instead of leaving "Loading…" forever.
  const [forecastList, setForecastList] = useState<any[]>([]);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [nwpComparison, setNwpComparison] = useState<any>(null);
  const [nwpLoading, setNwpLoading] = useState(false);
  const [nwpError, setNwpError] = useState<string | null>(null);
  const [sectorAdvisory, setSectorAdvisory] = useState<any>(null);
  const [activeSector, setActiveSector] = useState<'agriculture' | 'aviation' | 'marine' | 'urban'>('agriculture');
  const [sectorLoading, setSectorLoading] = useState(false);
  const [sectorError, setSectorError] = useState<string | null>(null);
  const [alertsList, setAlertsList] = useState<any[]>([]);
  const [climateInfo, setClimateInfo] = useState<any>(null);
  const [climateLoading, setClimateLoading] = useState(false);
  const [climateError, setClimateError] = useState<string | null>(null);

  // ── Geolocation lives in the location store ──
  // The provider owns the GPS request lifecycle (requesting-gps → selected /
  // denied / error), the mount-time auto-fill and the reverse-geocode name
  // fill. The header pill below calls requestGpsLocation (explicit intent —
  // it always refreshes, and a failure never discards an existing selection).

  // Location change: drop stale page data and any stale loading/error state
  // so every page re-queries against the new coordinates (§23). Runs for any
  // locationKey transition, including null → coords and coords → null.
  useEffect(() => {
    setForecastList([]);
    setForecastLoading(false);
    setForecastError(null);
    setNwpComparison(null);
    setNwpLoading(false);
    setNwpError(null);
    setClimateInfo(null);
    setClimateLoading(false);
    setClimateError(null);
    setSectorAdvisory(null);
    setSectorLoading(false);
    setSectorError(null);
    setAlertsList([]);
  }, [locationKey]);

  // ── Data fetch for the rail/drawer pages ──
  // Lazy: each page fetches when first shown. There is deliberately NO
  // "already loaded" marker: a failed request must be retryable, and a
  // location change must trigger a fresh request for the new place.
  // No location → NO request (§no-location).
  useEffect(() => {
    if (!activePage || !location) return;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    if (activePage === 'forecast') void fetchWeather(location, signal);
    if (activePage === 'nwp') void fetchNwp(location, signal);
    if (activePage === 'climate') void fetchClimate(location, signal);
    if (activePage === 'sectors') void fetchSector(location, activeSector, signal);
    return () => ctrl.abort();
  }, [activePage, location, locationKey, activeSector]);

  // Retry a failed page fetch with a fresh request (never blocked by stale
  // state). The controller is abandoned on navigation, which is harmless.
  const retryFetch = (kind: 'forecast' | 'nwp' | 'climate' | 'sector') => {
    if (!location) return;
    const ctrl = new AbortController();
    const { signal } = ctrl;
    if (kind === 'forecast') void fetchWeather(location, signal);
    else if (kind === 'nwp') void fetchNwp(location, signal);
    else if (kind === 'climate') void fetchClimate(location, signal);
    else if (kind === 'sector') void fetchSector(location, activeSector, signal);
  };

  // Alerts are always fetched — the warning bulletin above the chat needs them.
  // No location → no request, and any previous alerts are dropped so a stale
  // warning can never appear under a "no location" header (§no-location).
  useEffect(() => {
    if (!location) {
      setAlertsList([]);
      return;
    }
    const ctrl = new AbortController();
    void fetchAlerts(location, ctrl.signal);
    return () => ctrl.abort();
  }, [location]);

  const fetchWeather = async (
    loc: SelectedLocation,
    signal: AbortSignal,
  ) => {
    setForecastLoading(true);
    setForecastError(null);
    const url = WEATHER_ENDPOINTS.FORECAST(loc.name, 7, toWeatherQuery(loc));
    try {
      const f = await fetchWithDiagnostics(url, { signal });
      // Read the raw body once so error diagnostics and JSON parsing share it
      // (the backend may answer 5xx with a non-JSON error page).
      const responseText = await f.text();
      if (!f.ok) {
        const apiMessage = readApiResponseMessage(responseText);
        throw new FetchDiagnosticError({
          kind: 'http',
          url,
          status: f.status,
          statusText: f.statusText,
          bodyText: truncateForDiagnostics(responseText),
          message:
            apiMessage ?? `HTTP ${f.status}${f.statusText ? ' ' + f.statusText : ''}`,
        });
      }
      let fd: any;
      try {
        fd = JSON.parse(responseText);
      } catch {
        throw new FetchDiagnosticError({
          kind: 'invalid-response',
          url,
          bodyText: truncateForDiagnostics(responseText),
          message: 'Weather service returned an unreadable response.',
        });
      }
      if (!fd?.success) throw new FetchDiagnosticError({
        kind: 'invalid-response',
        url,
        bodyText: truncateForDiagnostics(responseText),
        message: fd?.message ?? 'Backend returned success:false',
      });
      if (!Array.isArray(fd.data?.days) || fd.data.days.length === 0) throw new FetchDiagnosticError({
        kind: 'invalid-response',
        url,
        bodyText: truncateForDiagnostics(responseText),
        message: 'No forecast days returned',
      });
      setForecastList(fd.data.days);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      const diagnostic = e instanceof FetchDiagnosticError ? e : null;
      console.error('[Forecast] request failed', {
        url,
        kind: diagnostic?.kind ?? 'unknown',
        status: diagnostic?.status,
        statusText: diagnostic?.statusText,
        bodyText: diagnostic?.bodyText,
        cause: diagnostic?.cause ?? e,
      });
      setForecastError(
        diagnostic
          ? diagnostic.toDisplayMessage()
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      if (!signal.aborted) setForecastLoading(false);
    }
  };
  const fetchNwp = async (loc: SelectedLocation, signal: AbortSignal) => {
    setNwpLoading(true);
    setNwpError(null);
    try {
      const url = WEATHER_ENDPOINTS.NWP(loc.name, toWeatherQuery(loc));
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error(await describeHttpError(r));
      const d = await r.json();
      if (!d?.success) throw new Error(d?.message ?? 'Backend returned success:false');
      const data = d?.data;
      if (!data) throw new Error('Backend returned no data object');
      if (!Array.isArray(data.models)) throw new Error('Unexpected response shape: models[] is missing');
      setNwpComparison(data);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      console.warn('[NWP] request failed:', e);
      setNwpError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal.aborted) setNwpLoading(false);
    }
  };
  const fetchSector = async (
    loc: SelectedLocation,
    sector: string,
    signal: AbortSignal,
  ) => {
    setSectorLoading(true);
    setSectorError(null);
    try {
      const r = await fetch(ADVISORIES_ENDPOINT(loc.name, sector, toWeatherQuery(loc)), { signal });
      if (!r.ok) throw new Error(await describeHttpError(r));
      const d = await r.json();
      if (!d?.success) throw new Error(d?.message ?? 'Backend returned success:false');
      if (!d?.data) throw new Error('Backend returned no data object');
      setSectorAdvisory(d.data);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      console.warn('[Sector] request failed:', e);
      setSectorError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal.aborted) setSectorLoading(false);
    }
  };
  const fetchAlerts = async (
    loc: SelectedLocation,
    signal: AbortSignal,
  ) => {
    try {
      const r = await fetch(ALERTS_ENDPOINT(loc.name, toWeatherQuery(loc)), { signal });
      if (!r.ok) throw new Error(await describeHttpError(r));
      const d = await r.json();
      if (d?.success && Array.isArray(d.data?.alerts)) setAlertsList(d.data.alerts);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      console.warn('[Alerts] request failed:', e);
      // No blocking UI state: an absent warning bulletin is the safe default.
    }
  };
  const fetchClimate = async (
    loc: SelectedLocation,
    signal: AbortSignal,
  ) => {
    setClimateLoading(true);
    setClimateError(null);
    try {
      const url = CLIMATE_ENDPOINT(loc.name, 2015, 2024, toWeatherQuery(loc));
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error(await describeHttpError(r));
      const d = await r.json();
      if (!d?.success) throw new Error(d?.message ?? 'Backend returned success:false');
      if (!d?.data) throw new Error('Backend returned no data object');
      setClimateInfo(d.data);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      console.warn('[Climate] request failed:', e);
      setClimateError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!signal.aborted) setClimateLoading(false);
    }
  };

  // ── Active IMD warning (bulletin overrides routine answers structurally) ──
  // No location → alerts are empty and no bulletin can be constructed; a
  // location-less demo preview still renders the canned demo warning (dev only).
  const activeWarning = useMemo<ImdWarning | null>(() => {
    if (IS_DEMO) return DEMO_WARNING;
    if (!location || !alertsList.length) return null;
    const a = alertsList[0];
    const text = a.description || a.warning || a.message || '';
    if (!text) return null;
    return {
      district: `${location.name} district`,
      severity: severityOf(a),
      title: a.title || undefined,
      text,
      issuedAt: a.issuedAt ?? a.issueTime ?? a.issued ?? undefined,
    };
  }, [alertsList, location]);

  const handleNavigate = (page: NavPage) => {
    setActivePage(page);
    setDrawerOpen(false);
  };

  const navigateHome = () => {
    setActivePage(null);
    setDrawerOpen(false);
  };

  // ── Render ──
  const onChat = activePage === null;

  const SECTOR_LIST: { id: 'agriculture' | 'aviation' | 'marine' | 'urban'; label: string; icon: typeof Sprout }[] = [
    { id: 'agriculture', label: 'Agriculture', icon: Sprout },
    { id: 'aviation', label: 'Aviation', icon: Plane },
    { id: 'marine', label: 'Marine', icon: Anchor },
    { id: 'urban', label: 'Smart City', icon: Building2 },
  ];

  const climateMetrics = [
    { label: 'Warming rate', value: `+${climateInfo?.warmingRatePerDecade}°C`, sub: 'per decade', icon: Flame },
    { label: 'Baseline mean', value: `${climateInfo?.baselineMeanTemperature}°C`, sub: '30-year normal', icon: Thermometer },
    { label: 'Annual rain', value: `${climateInfo?.baselineAnnualPrecipitation} mm`, sub: 'per year', icon: Droplets },
  ] as const;

  return (
    <div className="app">
      <IconRail activePage={activePage} onNavigate={handleNavigate} onGoHome={navigateHome} />

      <div className="main">
        <AppHeader
          locationName={location?.name ?? null}
          locationStatus={locationState.status}
          lang={selectedLang}
          onLanguageChange={setSelectedLang}
          theme={theme}
          onToggleTheme={toggleTheme}
          onLocationClick={requestGpsLocation}
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerOpen(v => !v)}
        />

        <WarningBulletin warning={activeWarning} />

        {onChat ? (
          <AIChatWorkspace lang={selectedLang} />
        ) : (
          <main className="page-view" aria-label={NAV_LABELS[activePage] ?? activePage}>
            <div className="page-view-inner">
              {activePage === 'forecast' && (location ? (
                <div style={P.panel} className="page-panel">
                  <header>
                    <h2 style={P.h2}>7-Day Forecast for {location.name}</h2>
                  </header>
                  {forecastError && forecastList.length === 0 ? (
                    <div style={S.error} role="alert">
                      <p style={{ margin: 0, fontWeight: 600 }}>Unable to load the forecast.</p>
                      <p style={{ margin: '6px 0 0', fontSize: '12.5px' }}>{forecastError}</p>
                      <button type="button" style={{ ...S.btn, marginTop: '10px' }} onClick={() => retryFetch('forecast')}>Retry</button>
                    </div>
                  ) : forecastList.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)' }} aria-busy={forecastLoading}>Loading forecast…</div>
                  ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: '10px' }}>
                    {forecastList.map((day: any, i: number) => (
                      <div key={i} style={P.metaCard}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--slate-teal)' }}>{i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : day.date}</div>
                        <div style={{ fontSize: '17px', fontWeight: 800, margin: '6px 0', fontVariantNumeric: 'tabular-nums' }}>{Math.round(day.tempMax)}° / {Math.round(day.tempMin)}°</div>
                        <div style={{ fontSize: '11.5px', color: 'var(--muted)' }}>{day.weatherDescription}</div>
                        <div style={{ fontSize: '11.5px', color: 'var(--ink)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                          <CloudRain size={12} style={{ color: 'var(--slate-teal)' }} /> {day.precipitationProbabilityMax}%
                        </div>
                      </div>
                    ))}
                  </div>
                  )}
                </div>
              ) : (
                <NoLocation feature="7-Day Forecast" />
              ))}

              {activePage === 'nwp' && (location ? (
                <>
                  {nwpComparison && nwpComparison.models.length > 0 && (
                    <div style={P.panel} className="page-panel">
                      <header>
                        <h2 style={P.h2}>NWP Multi-Model Ensemble for {location.name}</h2>
                      </header>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={{ ...S.badge, background: 'var(--slate-teal-tint)', color: 'var(--slate-teal)', borderColor: 'var(--slate-teal)' }}>
                          Consensus: {nwpComparison.consensus?.consensusScorePercentage}% ({nwpComparison.consensus?.confidenceLevel})
                        </span>
                      </div>
                      <p style={{ fontSize: '13px', color: 'var(--muted)', margin: 0 }}>{nwpComparison.consensus?.synopticSummary}</p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '10px' }}>
                        {nwpComparison.models?.map((m: any, i: number) => (
                          <div key={i} style={P.metaCard}>
                            <strong style={{ color: 'var(--slate-teal)' }}>{m.modelName}</strong> <span style={{ color: 'var(--muted)', fontSize: '12px' }}>({m.resolution})</span>
                            <div style={{ fontSize: '12.5px', margin: '4px 0', color: 'var(--ink)' }}>
                              Max <b style={{ fontVariantNumeric: 'tabular-nums' }}>{m.maxTemp}°C</b> · Min <b style={{ fontVariantNumeric: 'tabular-nums' }}>{m.minTemp}°C</b>
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Rain: {m.totalPrecipitation} mm · Wind: {m.maxWindSpeed} km/h</div>
                            <div style={{ fontSize: '11.5px', color: 'var(--slate-teal)', marginTop: '4px' }}>{m.synopticCondition}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {nwpComparison && nwpComparison.models.length === 0 && (
                    <div style={P.panel} className="page-panel">
                      <header>
                        <h2 style={P.h2}>NWP Multi-Model Ensemble for {location.name}</h2>
                      </header>
                      <p style={{ textAlign: 'center', padding: '24px', color: 'var(--muted)', margin: 0 }}>
                        No NWP model data is currently available.
                      </p>
                    </div>
                  )}

                  {nwpError && !nwpComparison && (
                    <div style={P.panel} className="page-panel">
                      <header>
                        <h2 style={P.h2}>NWP Multi-Model Ensemble for {location.name}</h2>
                      </header>
                      <div style={S.error} role="alert">
                        <p style={{ margin: 0, fontWeight: 600 }}>Unable to load NWP models.</p>
                        <p style={{ margin: '6px 0 0', fontSize: '12.5px' }}>The weather-model service did not return usable data ({nwpError}).</p>
                        <button type="button" style={{ ...S.btn, marginTop: '10px' }} onClick={() => retryFetch('nwp')}>Retry</button>
                      </div>
                    </div>
                  )}

                  {!nwpComparison && !nwpError && (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }} aria-busy={nwpLoading}>Loading NWP models…</div>
                  )}
                </>
              ) : (
                <NoLocation feature="NWP models" />
              ))}

              {activePage === 'sectors' && (location ? (
                <div style={P.panel} className="page-panel">
                  <header>
                    <h2 style={P.h2}>Sector advisories for {location.name}</h2>
                  </header>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {SECTOR_LIST.map(({ id, label, icon: Icon }) => (
                      <button key={id} type="button" onClick={() => setActiveSector(id)} aria-pressed={activeSector === id}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '7px',
                          background: activeSector === id ? 'var(--slate-teal-tint)' : 'var(--paper)',
                          color: activeSector === id ? 'var(--slate-teal)' : 'var(--muted)',
                          border: `1px solid ${activeSector === id ? 'var(--slate-teal)' : 'var(--line)'}`,
                          padding: '6px 14px', borderRadius: 'var(--radius-btn)', cursor: 'pointer',
                          fontSize: '12.5px', fontWeight: 600, fontFamily: 'var(--font-ui)',
                        }}>
                        <Icon size={15} /> {label}
                      </button>
                    ))}
                  </div>
                  {sectorError && !sectorAdvisory ? (
                    <div style={S.error} role="alert">
                      <p style={{ margin: 0, fontWeight: 600 }}>Unable to load {activeSector} advisory.</p>
                      <p style={{ margin: '6px 0 0', fontSize: '12.5px' }}>{sectorError}</p>
                      <button type="button" style={{ ...S.btn, marginTop: '10px' }} onClick={() => retryFetch('sector')}>Retry</button>
                    </div>
                  ) : sectorLoading ? (
                    <div style={{ textAlign: 'center', padding: '20px', color: 'var(--muted)' }}>Loading {activeSector} advisory…</div>
                  ) : (<>
                    {activeSector === 'agriculture' && sectorAdvisory?.agriculture && (
                      <div className="sector-cards" style={{ fontSize: '13px', lineHeight: '1.7' }}>
                        {[
                          { icon: Sprout, title: 'Sowing advice', text: sectorAdvisory.agriculture.sowingAdvisory, accent: 'var(--slate-teal)', border: 'var(--slate-teal)' },
                          { icon: Droplets, title: 'Irrigation', text: sectorAdvisory.agriculture.irrigationRecommendation, accent: 'var(--slate-teal)', border: 'var(--slate-teal)' },
                          { icon: SprayCan, title: 'Spraying window', text: sectorAdvisory.agriculture.sprayingWindow, accent: 'var(--brass)', border: 'var(--brass)' },
                        ].map(({ icon: Icon, title, text, accent, border }) => (
                          <div key={title} style={{ background: 'var(--mist)', border: `1px solid ${border}`, padding: '12px', borderRadius: 'var(--radius-card)' }}>
                            <p style={{ margin: '0 0 4px', fontWeight: 600, color: accent, display: 'flex', alignItems: 'center', gap: '7px' }}>
                              <Icon size={15} /> {title}
                            </p>
                            <p style={{ margin: 0, color: 'var(--ink)' }}>{text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {activeSector === 'aviation' && sectorAdvisory?.aviation && (
                      <div className="sector-cards" style={{ fontSize: '13px', lineHeight: '1.7' }}>
                        <div style={{ background: 'var(--mist)', border: '1px solid var(--line)', padding: '12px', borderRadius: 'var(--radius-card)' }}>
                          <p style={{ margin: '0 0 4px', fontWeight: 600, color: 'var(--slate-teal)', display: 'flex', alignItems: 'center', gap: '7px' }}>
                            <Plane size={15} /> Flight category
                          </p>
                          <p style={{ margin: 0, color: 'var(--ink)', fontWeight: 700 }}>{sectorAdvisory.aviation.flightCategory}</p>
                        </div>
                        <div style={{ background: 'var(--mist)', border: '1px solid var(--line)', padding: '12px', borderRadius: 'var(--radius-card)' }}>
                          <p style={{ margin: 0, color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{sectorAdvisory.aviation.metarCode}</p>
                        </div>
                      </div>
                    )}
                    {activeSector === 'marine' && sectorAdvisory?.marine && (
                      <div className="sector-cards" style={{ fontSize: '13px', lineHeight: '1.7' }}>
                        <div style={{ background: 'var(--mist)', border: '1px solid var(--line)', padding: '12px', borderRadius: 'var(--radius-card)' }}>
                          <p style={{ margin: '0 0 4px', fontWeight: 600, color: 'var(--slate-teal)', display: 'flex', alignItems: 'center', gap: '7px' }}>
                            <Anchor size={15} /> Fishermen directive
                          </p>
                          <p style={{ margin: 0, color: 'var(--ink)' }}>{sectorAdvisory.marine.fishermenAction}</p>
                        </div>
                      </div>
                    )}
                    {activeSector === 'urban' && sectorAdvisory?.smartCity && (
                      <div className="sector-cards" style={{ fontSize: '13px', lineHeight: '1.7' }}>
                        <div style={{ background: 'var(--mist)', border: '1px solid var(--line)', padding: '12px', borderRadius: 'var(--radius-card)' }}>
                          <p style={{ margin: '0 0 4px', fontWeight: 600, color: 'var(--slate-teal)', display: 'flex', alignItems: 'center', gap: '7px' }}>
                            <Waves size={15} /> Flood risk
                          </p>
                          <p style={{ margin: 0, color: 'var(--ink)' }}>{sectorAdvisory.smartCity.waterloggingFloodRisk}</p>
                        </div>
                      </div>
                    )}
                  </>)}
                </div>
              ) : (
                <NoLocation feature="Sector advisories" />
              ))}

              {activePage === 'alerts' && (location ? (
                <div style={P.panel} className="page-panel">
                  <header>
                    <h2 style={P.h2}>IMD colour-coded early warnings for {location.name}</h2>
                  </header>
                  {alertsList.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '24px', color: 'var(--watch-green)' }}>
                      <CheckCircle size={36} style={{ margin: '0 auto 8px' }} />
                      <p style={{ margin: 0 }}><strong>IMD Green: normal weather conditions</strong></p>
                      <span style={{ fontSize: '12px', color: 'var(--muted)' }}>No severe weather warnings for {location.name}.</span>
                    </div>
                  ) : alertsList.map((a: any) => (
                    <div key={a.id} style={{ background: 'var(--mist)', borderLeft: `4px solid ${tierBorder(severityOf(a))}`, padding: '11px 14px', borderRadius: 'var(--radius-chip)', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', gap: '8px', fontSize: '11px', marginBottom: '4px', alignItems: 'center' }}>
                        <span style={{ ...S.badge, ...tierBadge(severityOf(a)) }}>{a.severity ?? 'Warning'}</span>
                        {a.informationClass && <span style={{ color: 'var(--muted)' }}>{a.informationClass}</span>}
                      </div>
                      <strong style={{ fontSize: '14px', color: 'var(--ink)' }}>{a.title}</strong>
                      <p style={{ margin: '4px 0 0', fontSize: '12.5px', color: 'var(--ink)', maxWidth: '78ch' }}>{a.description}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <NoLocation feature="Alerts & history" />
              ))}

              {activePage === 'climate' && (location ? (
                <div style={P.panel} className="page-panel">
                  <header>
                    <h2 style={P.h2}>Climate analysis for {location.name}</h2>
                  </header>
                  {climateError && !climateInfo ? (
                    <div style={S.error} role="alert">
                      <p style={{ margin: 0, fontWeight: 600 }}>Unable to load climate data.</p>
                      <p style={{ margin: '6px 0 0', fontSize: '12.5px' }}>{climateError}</p>
                      <button type="button" style={{ ...S.btn, marginTop: '10px' }} onClick={() => retryFetch('climate')}>Retry</button>
                    </div>
                  ) : !climateInfo ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }} aria-busy={climateLoading}>
                      <p style={{ margin: 0 }}>Loading climate data for <strong>{location.name}</strong>…</p>
                    </div>
                  ) : (<>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '10px' }}>
                      {climateMetrics.map(({ label, value, sub, icon: Icon }) => (
                        <div key={label} style={P.metaCard}>
                          <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Icon size={13} style={{ color: 'var(--slate-teal)' }} /> {label}
                          </div>
                          <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
                          <div style={{ fontSize: '10.5px', color: 'var(--muted)' }}>{sub}</div>
                        </div>
                      ))}
                    </div>
                    {climateInfo.yearlyMetrics?.length > 0 && (
                      <div style={P.metaCard}>
                        <p style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '7px' }}>
                          <TrendingUp size={15} style={{ color: 'var(--slate-teal)' }} /> Year-by-year temperature
                        </p>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '80px', overflowX: 'auto', paddingBottom: '4px' }}>
                          {climateInfo.yearlyMetrics.map((ym: any, i: number) => {
                            const temps = climateInfo.yearlyMetrics.map((y: any) => y.meanTemperature || 0);
                            const mn = Math.min(...temps), mx = Math.max(...temps), rng = mx - mn || 1;
                            const h = Math.max(8, ((ym.meanTemperature - mn) / rng) * 64 + 8);
                            const warm = ym.meanTemperature > (mn + mx) / 2;
                            return (
                              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', minWidth: '32px' }}>
                                <div title={`${ym.year}: ${ym.meanTemperature}°C`}
                                  style={{ width: '20px', height: `${h}px`, background: warm ? 'var(--slate-teal)' : 'var(--line)', borderRadius: '3px 3px 0 0' }} />
                                <span style={{ fontSize: '9px', color: 'var(--muted)', writingMode: 'vertical-rl' }}>{ym.year}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div style={{ ...P.metaCard, padding: 0, overflow: 'hidden' }}>
                      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '7px' }}>
                        <MapIcon size={15} style={{ color: 'var(--slate-teal)' }} /> Location map for {location.name}
                      </div>
                      <ClimateMapEmbed lat={location.latitude} lon={location.longitude} label={location.name} />
                    </div>
                  </>)}
                </div>
              ) : (
                <NoLocation feature="Climate analysis" />
              ))}

              {activePage === 'route' && <RouteWeatherView />}
              {activePage === 'report' && <WeatherReportView />}
              {activePage === 'map' && <WeatherMapView />}
              {activePage === 'radar' && <WeatherRadarView />}
            </div>
          </main>
        )}

        <footer className="app-footer" aria-label="Site links">
          <span>© 2026 WeatherGPT</span>
          <span className="app-footer-links">
            <a href="/privacy.html">Privacy Policy</a>
            <span className="app-footer-sep" aria-hidden="true">·</span>
            <a href="/terms.html">Terms of Use</a>
          </span>
          <span className="app-footer-src">Weather data: Open-Meteo · IMD warnings · Map tiles: OpenStreetMap</span>
        </footer>
      </div>

      <MobileDrawer
        open={drawerOpen}
        activePage={activePage}
        onNavigate={handleNavigate}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}

const NAV_LABELS: Record<NavPage, string> = {
  forecast: 'Forecast',
  nwp: 'NWP models',
  sectors: 'Sectors',
  alerts: 'Alerts & history',
  climate: 'Climate',
  route: 'Route weather',
  report: 'Weather report',
  map: 'Weather map',
  radar: 'Radar',
};