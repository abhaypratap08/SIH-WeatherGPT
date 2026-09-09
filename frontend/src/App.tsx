import {
  BarChart3,
  Bell,
  CheckCircle,
  Cloud,
  Cpu,
  Droplets,
  Layers,
  MapPin,
  Mic,
  Radar,
  Send,
  Thermometer,
  TrendingUp,
  Volume2,
  VolumeX,
  Wind,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './App.css';
import ChatDrawer from './components/ChatDrawer';
import MobileChatToggle from './components/MobileChatToggle';
import MobileWeatherGPT from './components/MobileWeatherGPT';
import {
  ADVISORIES_ENDPOINT,
  ALERTS_ENDPOINT,
  CHAT_ENDPOINT,
  CLIMATE_ENDPOINT,
  ML_AGENT_ENDPOINT,
  ML_ROUTE_ENDPOINT,
  WEATHER_ENDPOINTS,
} from './config/api';
import { useVoiceInput } from './hooks/useVoiceInput';
import { useVoiceOutput } from './hooks/useVoiceOutput';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

type MessageRole = 'user' | 'bot';
type NavPage =
  | 'weather' | 'forecast' | 'nwp' | 'sectors' | 'alerts' | 'climate'
  | 'aichat' | 'route' | 'report' | 'map' | 'radar';

interface AiMessage { role: 'user' | 'assistant'; content: string; }
interface Coordinates { latitude: number; longitude: number; accuracy?: number; }
type LocationStatus = 'pending' | 'granted' | 'denied' | 'unsupported';

interface RouteApiResponse {
  message?: string;
  route_info?: any;
  risk_summary?: { HIGH?: number; MODERATE?: number; LOW?: number };
  weather_data?: WeatherPoint[] | any;
  map_json?: any;
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

const LANGUAGES = [
  { code: 'en', label: 'English',             speechLocale: 'en-IN' },
  { code: 'hi', label: 'हिन्दी (Hindi)',       speechLocale: 'hi-IN' },
  { code: 'ta', label: 'தமிழ் (Tamil)',        speechLocale: 'ta-IN' },
  { code: 'te', label: 'తెలుగు (Telugu)',      speechLocale: 'te-IN' },
  { code: 'bn', label: 'বাংলা (Bengali)',      speechLocale: 'bn-IN' },
  { code: 'mr', label: 'मराठी (Marathi)',      speechLocale: 'mr-IN' },
  { code: 'gu', label: 'ગુજરાતી (Gujarati)',   speechLocale: 'gu-IN' },
];

const WEATHER_CODE_DESCRIPTIONS: Record<number, string> = {
  0:'☀️ Clear', 1:'🌤️ Mainly clear', 2:'⛅ Partly cloudy', 3:'☁️ Cloudy',
  45:'🌫️ Fog', 48:'🌫️ Fog', 51:'🌦️ Light drizzle', 53:'🌦️ Drizzle',
  55:'🌧️ Heavy drizzle', 61:'🌦️ Light rain', 63:'🌧️ Rain', 65:'🌧️ Heavy rain',
  71:'🌨️ Light snow', 73:'❄️ Snow', 75:'❄️ Heavy snow',
  80:'🌦️ Rain showers', 81:'🌧️ Rain showers', 82:'🌧️ Heavy showers',
  95:'⛈️ Thunderstorm', 96:'⛈️ Thunderstorm + hail', 99:'⛈️ Thunderstorm + hail',
};
const wmoDesc = (code: number) => WEATHER_CODE_DESCRIPTIONS[code] ?? '🌤️ Unknown';
const REPORT_CACHE_KEY = 'weatherGPT_offline_forecast';

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

async function reverseGeocodeForReport(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10`);
    if (!res.ok) throw new Error('');
    const d = await res.json();
    const a = d.address ?? {};
    return a.city ?? a.town ?? a.village ?? a.county ?? d.display_name ?? 'Current location';
  } catch { return 'Current location'; }
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
      time: d.hourly.time.slice(0,24), temperature: d.hourly.temperature_2m.slice(0,24),
      humidity: d.hourly.relative_humidity_2m.slice(0,24),
      precipitationProbability: d.hourly.precipitation_probability.slice(0,24),
      weatherCode: d.hourly.weather_code.slice(0,24), wind: d.hourly.wind_speed_10m.slice(0,24),
    },
    daily7days: {
      time: d.daily.time.slice(0,7), weatherCode: d.daily.weather_code.slice(0,7),
      maxTemperature: d.daily.temperature_2m_max.slice(0,7),
      minTemperature: d.daily.temperature_2m_min.slice(0,7),
      precipitationProbability: d.daily.precipitation_probability_max.slice(0,7),
      maxWind: d.daily.wind_speed_10m_max.slice(0,7),
    },
  };
}
function loadCachedForecast(): ForecastRecord | null {
  try { return JSON.parse(localStorage.getItem(REPORT_CACHE_KEY) ?? 'null'); } catch { return null; }
}
function saveForecast(r: ForecastRecord) {
  try { localStorage.setItem(REPORT_CACHE_KEY, JSON.stringify(r)); } catch { /* full */ }
}

// ─────────────────────────────────────────────────────────────────────
// Shared card styles (used by Route + Report views)
// ─────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  scrollWrap:   { width:'100%', height:'100%', overflowY:'auto', overflowX:'hidden', padding:'20px 16px', boxSizing:'border-box' },
  container:    { width:'100%', maxWidth:'1400px', margin:'0 auto', display:'flex', flexDirection:'column', gap:'18px', boxSizing:'border-box' },
  card:         { background:'rgba(10,22,36,0.55)', padding:'18px', borderRadius:'12px', border:'1px solid rgba(0,229,255,0.12)' },
  cardTitle:    { margin:'0 0 14px', fontSize:'1rem', fontWeight:700, color:'#e0f7ff' },
  label:        { fontSize:'0.75rem', fontWeight:600, color:'#7ab8d4' },
  input:        { padding:'10px 13px', borderRadius:'8px', border:'1px solid rgba(0,229,255,0.2)', background:'rgba(5,11,18,0.8)', color:'#e8f4fc', fontSize:'0.9rem', outline:'none', width:'100%', boxSizing:'border-box' },
  btn:          { padding:'12px 24px', background:'linear-gradient(120deg,#00c8ff 0%,#0078ff 100%)', color:'#050b12', border:'none', borderRadius:'8px', cursor:'pointer', fontWeight:700, fontSize:'0.92rem', width:'100%' },
  error:        { padding:'12px 16px', background:'rgba(229,101,74,0.12)', border:'1px solid rgba(229,101,74,0.3)', color:'#f0a08c', borderRadius:'8px', fontSize:'0.875rem' },
  successBanner:{ background:'rgba(0,229,255,0.08)', border:'1px solid rgba(0,229,255,0.25)', color:'#67e8f9', padding:'11px 15px', borderRadius:'8px', fontWeight:500, fontSize:'0.88rem' },
  badge:        { display:'inline-block', padding:'3px 9px', borderRadius:'12px', fontWeight:600, fontSize:'0.7rem', border:'1px solid transparent' },
  tableWrap:    { width:'100%', overflowX:'auto', borderRadius:'8px', border:'1px solid rgba(0,229,255,0.1)' },
  table:        { width:'100%', borderCollapse:'collapse', textAlign:'left', fontSize:'0.85rem' },
  th:           { borderBottom:'1px solid rgba(0,229,255,0.12)', padding:'10px 13px', background:'rgba(0,229,255,0.03)', fontWeight:600, color:'#7ab8d4', whiteSpace:'nowrap' },
  tr:           { borderBottom:'1px solid rgba(0,229,255,0.05)' },
  td:           { padding:'10px 13px', whiteSpace:'nowrap', color:'#b8d4e8' },
  tdBold:       { padding:'10px 13px', fontWeight:600, whiteSpace:'nowrap', color:'#e0f7ff' },
  tdIndex:      { padding:'10px 13px', color:'#4a6a7d', width:'36px' },
  tdDesc:       { padding:'10px 13px', color:'#7ab8d4', minWidth:'180px', wordBreak:'break-word' },
  jsonBlock:    { background:'rgba(5,11,18,0.8)', padding:'13px', borderRadius:'8px', overflowX:'auto', fontSize:'0.78rem', color:'#67e8f9', margin:0, border:'1px solid rgba(0,229,255,0.07)' },
  mapWrapper:   { width:'100%', borderRadius:'8px', overflow:'hidden', border:'1px solid rgba(0,229,255,0.15)', background:'#fff' },
  iframe:       { width:'100%', height:'380px', border:'none', display:'block' },
};

const riskStyle = (risk?: string): React.CSSProperties => {
  switch (String(risk ?? '').toUpperCase()) {
    case 'HIGH':     return { background:'rgba(229,101,74,0.16)', color:'#f0a08c', borderColor:'rgba(229,101,74,0.35)' };
    case 'MODERATE': return { background:'rgba(224,166,63,0.16)', color:'#f0cf8f', borderColor:'rgba(224,166,63,0.35)' };
    case 'LOW':      return { background:'rgba(0,229,255,0.1)',   color:'#67e8f9', borderColor:'rgba(0,229,255,0.3)' };
    default:         return { background:'rgba(154,164,182,0.16)',color:'#c3cad6', borderColor:'rgba(154,164,182,0.35)' };
  }
};

// ─────────────────────────────────────────────────────────────────────
// ClimateMapEmbed — OSM map inside climate panel
// ─────────────────────────────────────────────────────────────────────

function ClimateMapEmbed({ city }: { city: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    import('leaflet').then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });
      fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`)
        .then(r => r.json())
        .then(data => {
          const r = data.results?.[0];
          const lat = r?.latitude ?? 20.5937;
          const lng = r?.longitude ?? 78.9629;
          if (mapRef.current) return;
          const map = L.map(ref.current!, { center: [lat, lng], zoom: 7 });
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors', maxZoom: 18,
          }).addTo(map);
          L.tileLayer('https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=demo',
            { opacity: 0.45, attribution: 'Weather &copy; OpenWeatherMap' }).addTo(map);
          L.marker([lat, lng]).addTo(map).bindPopup(`📍 ${city}`).openPopup();
          mapRef.current = map;
          setLoaded(true);
        })
        .catch(() => {
          if (mapRef.current) return;
          const map = L.map(ref.current!, { center: [20.5937, 78.9629], zoom: 5 });
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
          mapRef.current = map;
          setLoaded(true);
        });
    });
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [city]);

  return (
    <div style={{ position:'relative', height:'280px', width:'100%' }}>
      {!loaded && (
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(5,11,18,0.8)', zIndex:10, color:'#7ab8d4', fontSize:'13px' }}>
          Loading map…
        </div>
      )}
      <div ref={ref} style={{ width:'100%', height:'100%' }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// WeatherMapView — full-screen map page
// ─────────────────────────────────────────────────────────────────────

function WeatherMapView({ location }: { location: Coordinates | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [layer, setLayer] = useState<'standard'|'temperature'|'precipitation'|'wind'>('standard');

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link'); link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    import('leaflet').then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });
      const map = L.map(ref.current!, { center:[location?.latitude??20.5937, location?.longitude??78.9629], zoom:5 });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'&copy; OpenStreetMap contributors', maxZoom:18 }).addTo(map);
      mapRef.current = map;
      if (location) {
        markerRef.current = L.marker([location.latitude, location.longitude])
          .addTo(map).bindPopup(`📍 Your Location`).openPopup();
      }
    });
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !location) return;
    import('leaflet').then((L) => {
      if (markerRef.current) markerRef.current.setLatLng([location.latitude, location.longitude]);
      else markerRef.current = L.marker([location.latitude, location.longitude]).addTo(mapRef.current).bindPopup('📍 Your Location').openPopup();
      mapRef.current.setView([location.latitude, location.longitude], 8);
    });
  }, [location]);

  const switchLayer = (type: typeof layer) => {
    setLayer(type);
    if (!mapRef.current) return;
    import('leaflet').then((L) => {
      const map = mapRef.current;
      map.eachLayer((l: any) => { if (l instanceof L.TileLayer) map.removeLayer(l); });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'&copy; OpenStreetMap contributors', maxZoom:18 }).addTo(map);
      const overlays: Record<string,string> = {
        temperature:   'https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=demo',
        precipitation: 'https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=demo',
        wind:          'https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=demo',
      };
      if (type !== 'standard' && overlays[type])
        L.tileLayer(overlays[type], { opacity:0.55, attribution:'Weather &copy; OpenWeatherMap' }).addTo(map);
    });
  };

  const layers: {id: typeof layer; label: string; emoji: string}[] = [
    {id:'standard',      label:'Standard',    emoji:'🗺️'},
    {id:'temperature',   label:'Temperature', emoji:'🌡️'},
    {id:'precipitation', label:'Rain',        emoji:'🌧️'},
    {id:'wind',          label:'Wind',        emoji:'💨'},
  ];

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', width:'100%' }}>
      <div style={{ padding:'10px 16px', background:'var(--glass-bg)', borderBottom:'1px solid var(--glass-border)', display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap', flexShrink:0 }}>
        <span style={{ fontSize:'12px', color:'var(--text-secondary)', fontWeight:600, marginRight:'4px' }}>Layer:</span>
        {layers.map(b => (
          <button key={b.id} onClick={() => switchLayer(b.id)} style={{
            padding:'5px 12px', borderRadius:'20px', border:'1px solid',
            borderColor: layer===b.id ? 'var(--accent-cyan)' : 'var(--glass-border)',
            background:  layer===b.id ? 'var(--accent-cyan-dim)' : 'transparent',
            color:       layer===b.id ? 'var(--accent-cyan)' : 'var(--text-secondary)',
            fontSize:'12px', fontWeight:600, cursor:'pointer',
          }}>{b.emoji} {b.label}</button>
        ))}
        {location && <span style={{ marginLeft:'auto', fontSize:'11px', color:'var(--text-muted)' }}>📍 {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}</span>}
      </div>
      <div style={{ flex:1, position:'relative', overflow:'hidden' }}>
        <div ref={ref} style={{ width:'100%', height:'100%', background:'#071018' }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// InteractiveRadarView
// ─────────────────────────────────────────────────────────────────────

function InteractiveRadarView({ location }: { location: Coordinates | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link'); link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    import('leaflet').then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });
      const map = L.map(ref.current!, { center:[location?.latitude??20.5937, location?.longitude??78.9629], zoom:5 });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution:'&copy; OpenStreetMap, &copy; CARTO', maxZoom:18,
      }).addTo(map);
      L.tileLayer('https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=demo',
        { opacity:0.65, attribution:'Weather &copy; OpenWeatherMap' }).addTo(map);
      L.tileLayer('https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=demo',
        { opacity:0.4, attribution:'Clouds &copy; OpenWeatherMap' }).addTo(map);
      if (location) {
        const icon = L.divIcon({
          className:'',
          html:`<div style="width:14px;height:14px;background:rgba(0,229,255,0.9);border-radius:50%;border:2px solid white;box-shadow:0 0 0 4px rgba(0,229,255,0.3)"></div>`,
          iconSize:[14,14], iconAnchor:[7,7],
        });
        L.marker([location.latitude, location.longitude], { icon }).addTo(map).bindPopup('📍 Your Location');
      }
      mapRef.current = map;
    });
    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, []);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', width:'100%' }}>
      <div style={{ padding:'10px 16px', background:'var(--glass-bg)', borderBottom:'1px solid var(--glass-border)', display:'flex', gap:'12px', alignItems:'center', flexShrink:0 }}>
        <Radar size={16} style={{ color:'var(--accent-cyan)' }} />
        <span style={{ fontSize:'13px', fontWeight:700, color:'var(--text-primary)' }}>Live Precipitation & Cloud Radar</span>
        <span style={{ fontSize:'11px', color:'var(--text-muted)', marginLeft:'auto' }}>OpenStreetMap + OpenWeatherMap tiles</span>
      </div>
      <div style={{ flex:1, position:'relative', overflow:'hidden' }}>
        <div ref={ref} style={{ width:'100%', height:'100%', background:'#050b12' }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// RouteWeatherView
// ─────────────────────────────────────────────────────────────────────

function RouteWeatherView() {
  const [form, setForm] = useState({ origin:'Delhi', destination:'Agra', departure_time:'08:00' });
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<RouteApiResponse|null>(null);
  const [err, setErr] = useState<string|null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setErr(null); setResp(null);
    try {
      const res = await fetch(ML_ROUTE_ENDPOINT, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(form) });
      if (!res.ok) throw new Error(`Error ${res.status} - ${res.statusText}`);
      setResp(await res.json());
    } catch (e: any) { setErr(e.message || 'Failed to fetch route weather.'); }
    finally { setLoading(false); }
  };

  return (
    <div style={S.scrollWrap}>
      <div style={S.container}>
        <header>
          <h2 style={{ margin:0, fontSize:'1.35rem', fontWeight:700, color:'var(--text-primary)' }}>Route weather analyzer</h2>
          <p style={{ margin:'4px 0 0', fontSize:'0.85rem', color:'var(--text-muted)' }}>Check conditions and risk along a journey, point by point.</p>
        </header>

        <form onSubmit={handleSubmit} style={{ ...S.card, display:'flex', flexDirection:'column', gap:'14px' }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:'14px' }}>
            {(['origin','destination'] as const).map(field => (
              <div key={field} style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                <label style={S.label}>{field.charAt(0).toUpperCase()+field.slice(1)}</label>
                <input style={S.input} type="text" name={field} value={form[field]}
                  onChange={e => setForm({...form, [field]:e.target.value})} required
                  placeholder={field==='origin' ? 'e.g. Delhi' : 'e.g. Agra'} />
              </div>
            ))}
            <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
              <label style={S.label}>Departure time</label>
              <input style={S.input} type="time" name="departure_time" value={form.departure_time}
                onChange={e => setForm({...form, departure_time:e.target.value})} required />
            </div>
          </div>
          <button type="submit" disabled={loading} style={S.btn}>{loading ? 'Analyzing route…' : 'Analyze route'}</button>
        </form>

        {err && <div style={S.error}>{err}</div>}

        {resp && (
          <div style={{ display:'flex', flexDirection:'column', gap:'18px' }}>
            {resp.message && <div style={S.successBanner}>{resp.message}</div>}

            {resp.risk_summary && (
              <div style={S.card}>
                <h3 style={S.cardTitle}>Risk summary</h3>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:'10px' }}>
                  {([['HIGH','#f0a08c','rgba(229,101,74,0.3)'],['MODERATE','#f0cf8f','rgba(224,166,63,0.3)'],['LOW','#67e8f9','rgba(0,229,255,0.3)']] as const).map(([key,color,bc]) => (
                    <div key={key} style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'14px', borderRadius:'8px', background:'rgba(5,11,18,0.8)', border:`1px solid ${bc}` }}>
                      <span style={{ fontSize:'1.6rem', fontWeight:700, color }}>{(resp.risk_summary as any)[key] ?? 0}</span>
                      <span style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:'4px' }}>{key.charAt(0)+key.slice(1).toLowerCase()}-risk waypoints</span>
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
                        {['#','Point','Condition','Temp','Risk','Details'].map(h => <th key={h} style={S.th}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {resp.weather_data.map((item: WeatherPoint, i: number) => {
                          const name   = item.location || item.point || item.name || `Point ${i+1}`;
                          const cond   = item.weather || item.condition || item.sky || '—';
                          const temp   = (item.temp ?? item.temperature) !== undefined ? `${item.temp ?? item.temperature}°C` : '—';
                          const risk   = item.risk || item.risk_level || 'NORMAL';
                          const detail = item.description || item.notes || item.summary ||
                            Object.entries(item).filter(([k]) => !['location','point','weather','condition','temp','temperature','risk','risk_level'].includes(k)).map(([k,v]) => `${k}: ${v}`).join(', ');
                          return (
                            <tr key={i} style={S.tr}>
                              <td style={S.tdIndex}>{i+1}</td>
                              <td style={S.tdBold}>{name}</td>
                              <td style={S.td}>{cond}</td>
                              <td style={S.td}>{temp}</td>
                              <td style={S.td}><span style={{...S.badge,...riskStyle(risk)}}>{risk.toUpperCase()}</span></td>
                              <td style={S.tdDesc}>{detail || '—'}</td>
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// WeatherReportView (offline-capable)
// ─────────────────────────────────────────────────────────────────────

function WeatherReportView({ location }: { location: Coordinates | null }) {
  const [cityInput, setCityInput] = useState('');
  const [record, setRecord] = useState<ForecastRecord|null>(loadCachedForecast);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<{tone:'error'|'info';text:string}|null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const autoRef = useRef(false);

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    if (autoRef.current || record || !location) return;
    autoRef.current = true;
    (async () => {
      setLoading(true);
      try {
        const name = await reverseGeocodeForReport(location.latitude, location.longitude);
        const r = await fetchForecastRecord({ latitude:location.latitude, longitude:location.longitude, name });
        saveForecast(r); setRecord(r);
      } catch { /* silent */ } finally { setLoading(false); }
    })();
  }, [location, record]);

  const search = async (override?: string) => {
    const city = (override ?? cityInput).trim();
    if (!city) { setBanner({tone:'error', text:'Enter a city.'}); return; }
    if (!online) {
      if (record) setBanner({tone:'info', text:'Offline — showing cached forecast.'});
      else setBanner({tone:'error', text:'Offline and no cached forecast.'});
      return;
    }
    setLoading(true); setBanner(null);
    try {
      const place = await geocodeCity(city);
      const r = await fetchForecastRecord(place);
      saveForecast(r); setRecord(r);
    } catch (e: any) {
      if (record) setBanner({tone:'info', text:`${e.message} Showing cached forecast.`});
      else setBanner({tone:'error', text:e.message});
    } finally { setLoading(false); }
  };

  return (
    <div style={S.scrollWrap}>
      <div style={S.container}>
        <header>
          <h2 style={{ margin:0, fontSize:'1.35rem', fontWeight:700, color:'var(--text-primary)' }}>Weather report</h2>
          <p style={{ margin:'4px 0 0', fontSize:'0.85rem', color:'var(--text-muted)' }}>Search any city. Forecast cached for offline use.</p>
        </header>

        <div style={{ display:'flex', gap:'10px', alignItems:'center', flexWrap:'wrap' }}>
          <span style={{ padding:'6px 12px', borderRadius:'20px', fontSize:'0.78rem', fontWeight:600, border:'1px solid var(--glass-border)', color: online ? 'var(--accent-cyan)' : '#f87171' }}>
            {online ? '🟢 Online' : '🔴 Offline'}
          </span>
          <input style={{...S.input, flex:1}} type="text" value={cityInput}
            onChange={e => setCityInput(e.target.value)} onKeyDown={e => e.key==='Enter' && search()}
            placeholder="Enter city e.g. Delhi" />
          <button onClick={() => search()} disabled={loading}
            style={{ padding:'10px 20px', background:'linear-gradient(120deg,#00c8ff 0%,#0078ff 100%)', color:'#050b12', border:'none', borderRadius:'8px', cursor:'pointer', fontWeight:700, fontSize:'0.88rem', whiteSpace:'nowrap' }}>
            {loading ? 'Loading…' : 'Get weather'}
          </button>
        </div>

        {banner && <div style={banner.tone==='error' ? S.error : S.successBanner}>{banner.text}</div>}

        {!record && !loading && (
          <div style={S.card}><p style={{ margin:0, color:'var(--text-muted)', fontSize:'0.88rem' }}>Search a city to load forecast.</p></div>
        )}

        {record && (<>
          <div style={S.card}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:'10px' }}>
              <div>
                <h3 style={{ ...S.cardTitle, marginBottom:'2px' }}>{record.location.name}{record.location.country ? `, ${record.location.country}` : ''}</h3>
                <p style={{ margin:0, fontSize:'0.78rem', color:'var(--text-muted)' }}>Last updated: {new Date(record.savedAt).toLocaleString()}</p>
              </div>
              <div style={{ fontSize:'2.2rem', fontWeight:800, color:'var(--accent-cyan)' }}>{Math.round(record.hourly24h.temperature[0])}°C</div>
            </div>
            <div style={{ display:'flex', gap:'16px', flexWrap:'wrap', marginTop:'12px', fontSize:'0.85rem', color:'var(--text-secondary)' }}>
              <span>{wmoDesc(record.hourly24h.weatherCode[0])}</span>
              <span>💧 {record.hourly24h.humidity[0]}%</span>
              <span>💨 {record.hourly24h.wind[0]} km/h</span>
            </div>
          </div>

          <div style={S.card}>
            <h3 style={S.cardTitle}>24-hour forecast</h3>
            <div style={{ display:'flex', gap:'10px', overflowX:'auto', paddingBottom:'4px' }}>
              {record.hourly24h.time.map((t,i) => (
                <div key={t} style={{ flex:'0 0 auto', minWidth:'108px', padding:'12px', borderRadius:'10px', background:'rgba(5,11,18,0.8)', border:'1px solid rgba(0,229,255,0.1)', display:'flex', flexDirection:'column', gap:'4px' }}>
                  <div style={{ fontSize:'0.78rem', color:'var(--accent-cyan)', fontWeight:600 }}>{new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</div>
                  <div style={{ fontSize:'1.1rem', fontWeight:700, color:'var(--text-primary)' }}>{Math.round(record.hourly24h.temperature[i])}°C</div>
                  <div style={{ fontSize:'0.75rem', color:'var(--text-secondary)' }}>{wmoDesc(record.hourly24h.weatherCode[i])}</div>
                  <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>💧 {record.hourly24h.humidity[i]}%</div>
                  <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>🌧️ {record.hourly24h.precipitationProbability[i]}%</div>
                  <div style={{ fontSize:'0.7rem', color:'var(--text-muted)' }}>💨 {record.hourly24h.wind[i]} km/h</div>
                </div>
              ))}
            </div>
          </div>

          <div style={S.card}>
            <h3 style={S.cardTitle}>7-day forecast</h3>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:'10px' }}>
              {record.daily7days.time.map((t,i) => (
                <div key={t} style={{ display:'flex', flexDirection:'column', gap:'4px', padding:'14px', borderRadius:'10px', background:'rgba(5,11,18,0.8)', border:'1px solid rgba(0,229,255,0.1)' }}>
                  <strong style={{ color:'var(--text-primary)', fontSize:'0.82rem' }}>{new Date(t).toLocaleDateString([],{weekday:'long'})}</strong>
                  <span style={{ fontSize:'0.8rem', color:'var(--text-secondary)' }}>{wmoDesc(record.daily7days.weatherCode[i])}</span>
                  <span style={{ fontSize:'0.8rem', color:'var(--text-secondary)' }}>🌡️ {Math.round(record.daily7days.maxTemperature[i])}° / {Math.round(record.daily7days.minTemperature[i])}°</span>
                  <span style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>🌧️ {record.daily7days.precipitationProbability[i]}%</span>
                </div>
              ))}
            </div>
          </div>
        </>)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AIChatView — powered by Python ML backend (Ollama/LangChain)
// ─────────────────────────────────────────────────────────────────────

const AI_SUGGESTIONS = [
  { title:"Today's weather", text:"What's the current weather at my location?" },
  { title:"Rain forecast",   text:"Will it rain in the next 24 hours?" },
  { title:"Heat advisory",   text:"Is there a heatwave warning for Delhi?" },
  { title:"Crop advisory",   text:"Should farmers in Punjab irrigate tomorrow?" },
];

function AIChatView({ location }: { location: Coordinates | null }) {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'smooth' }); }, [messages, loading]);

  const send = async (override?: string) => {
    const prompt = (override ?? input).trim();
    if (!prompt || loading) return;
    setMessages(p => [...p, { role:'user', content:prompt }]);
    setInput(''); setLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    try {
      const res = await fetch(ML_AGENT_ENDPOINT, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          prompt,
          location: location ? { latitude:location.latitude, longitude:location.longitude, accuracy:location.accuracy } : null,
        }),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const d = await res.json();
      setMessages(p => [...p, { role:'assistant', content:d.message }]);
    } catch {
      setMessages(p => [...p, { role:'assistant', content:"⚠️ Couldn't reach the AI backend. Make sure the Python ML server is running on :8000." }]);
    } finally { setLoading(false); }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', width:'100%', overflow:'hidden' }}>
      {/* Chat body */}
      <div style={{ flex:1, overflowY:'auto', padding:'24px 20px 12px' }}>
        <div style={{ maxWidth:'860px', margin:'0 auto' }}>
          {messages.length === 0 && (
            <div style={{ paddingTop:'6vh' }}>
              <div style={{ width:'44px', height:'44px', borderRadius:'12px', background:'var(--accent-cyan-dim)', border:'1px solid var(--accent-cyan)', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:'20px' }}>
                <Cloud size={22} style={{ color:'var(--accent-cyan)' }} />
              </div>
              <h2 style={{ margin:'0 0 24px', fontSize:'clamp(20px,4vw,28px)', fontWeight:700, color:'var(--text-primary)', letterSpacing:'-0.4px', lineHeight:1.25 }}>
                Where would you like weather updates for today?
              </h2>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:'10px' }}>
                {AI_SUGGESTIONS.map((s,i) => (
                  <button key={i} onClick={() => send(s.text)} style={{ display:'flex', flexDirection:'column', justifyContent:'space-between', gap:'12px', minHeight:'88px', padding:'14px', textAlign:'left', background:'var(--glass-bg)', borderRadius:'12px', border:'1px solid var(--glass-border)', cursor:'pointer', transition:'border-color 0.15s' }}>
                    <p style={{ margin:0, fontSize:'13px', fontWeight:500, color:'var(--text-primary)', lineHeight:1.4 }}>{s.text}</p>
                    <span style={{ fontSize:'11px', color:'var(--text-muted)' }}>{s.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:'18px', paddingBottom:'8px' }}>
              {messages.map((m,i) => (
                <div key={i} style={{ display:'flex', gap:'10px', justifyContent:m.role==='user'?'flex-end':'flex-start', alignItems:'flex-start' }}>
                  {m.role==='assistant' && (
                    <div style={{ width:'28px', height:'28px', borderRadius:'50%', background:'var(--glass-bg-strong)', border:'1px solid var(--glass-border)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:'var(--accent-cyan)' }}>
                      <Cloud size={14} />
                    </div>
                  )}
                  <div style={{ maxWidth:'min(78%,720px)' }}>
                    {m.role==='user' ? (
                      <div style={{ background:'var(--glass-bg-strong)', border:'1px solid var(--glass-border)', color:'var(--text-primary)', padding:'10px 15px', borderRadius:'16px', borderTopRightRadius:'4px', fontSize:'14px', lineHeight:1.55 }}>
                        <p style={{ margin:0, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>{m.content}</p>
                      </div>
                    ) : (
                      <div style={{ background:'var(--glass-bg)', border:'1px solid var(--glass-border)', padding:'12px 15px', borderRadius:'16px', borderTopLeftRadius:'4px', color:'var(--text-primary)', fontSize:'14px', lineHeight:1.65 }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                      </div>
                    )}
                  </div>
                  {m.role==='user' && (
                    <div style={{ width:'28px', height:'28px', borderRadius:'50%', background:'var(--glass-bg-strong)', color:'var(--text-secondary)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'11px', fontWeight:600, flexShrink:0 }}>U</div>
                  )}
                </div>
              ))}
              {loading && (
                <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
                  <div style={{ width:'28px', height:'28px', borderRadius:'50%', background:'var(--glass-bg-strong)', border:'1px solid var(--glass-border)', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--accent-cyan)' }}>
                    <Cloud size={14} />
                  </div>
                  <div style={{ width:'110px', height:'11px', borderRadius:'6px', background:'linear-gradient(90deg,var(--glass-bg) 25%,var(--glass-bg-strong) 50%,var(--glass-bg) 75%)', backgroundSize:'200% 100%', animation:'shimmer 1.4s infinite' }} />
                </div>
              )}
              <div ref={endRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div style={{ padding:'10px 20px 16px', maxWidth:'860px', width:'100%', margin:'0 auto', boxSizing:'border-box', flexShrink:0 }}>
        <div style={{ borderRadius:'24px', padding:'1px', background:'var(--glass-border)', transition:'background 0.2s' }}>
          <div style={{ display:'flex', alignItems:'flex-end', background:'var(--glass-bg)', borderRadius:'23px', padding:'6px 6px 6px 18px' }}>
            <textarea ref={textareaRef} value={input} onChange={e => { setInput(e.target.value); const t=e.target; t.style.height='auto'; t.style.height=`${Math.min(t.scrollHeight,120)}px`; }}
              onKeyDown={handleKey} disabled={loading} rows={1} placeholder="Ask WeatherGPT (AI-powered)…"
              style={{ width:'100%', background:'transparent', border:'none', outline:'none', padding:'9px 0', fontSize:'16px', color:'var(--text-primary)', resize:'none', maxHeight:'120px', fontFamily:'inherit', lineHeight:1.4 }} />
            <button onClick={() => send()} disabled={!input.trim()||loading}
              style={{ width:'34px', height:'34px', borderRadius:'50%', background: (!input.trim()||loading) ? 'var(--glass-bg-strong)' : 'linear-gradient(120deg,var(--accent-cyan) 0%,var(--accent-blue) 100%)', color: (!input.trim()||loading) ? 'var(--text-muted)' : '#050b12', border:'none', display:'flex', alignItems:'center', justifyContent:'center', cursor: (!input.trim()||loading) ? 'not-allowed' : 'pointer', flexShrink:0 }}>
              <Send size={14} />
            </button>
          </div>
        </div>
        <p style={{ fontSize:'10.5px', textAlign:'center', color:'var(--text-muted)', margin:'8px 0 0' }}>
          Powered by Ollama + LangChain · answers are grounded in live weather data
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Root App component
// ─────────────────────────────────────────────────────────────────────

export default function App() {
  // ── Java-backend chat / nav state ──
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<NavPage>('weather');
  const [selectedLang, setSelectedLang] = useState('en');
  const [currentCity, setCurrentCity] = useState('Delhi');
  const [gpsCoords, setGpsCoords] = useState<Coordinates|null>(null);
  const [gpsWatching, setGpsWatching] = useState(false);
  const [gpsWatchId, setGpsWatchId] = useState<number|null>(null);

  // ── Java-backend data state ──
  const [messages, setMessages] = useState<{id:string;role:MessageRole;content:string;voiceAnswer?:string}[]>([{
    id:'1', role:'bot',
    content:"👋 Hello! I'm **WeatherGPT**, your AI meteorological assistant aligned with MoES / IMD.\n\nAsk me about live forecasts, crop advisories, NWP models or climate trends!",
  }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sectorLoading, setSectorLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [currentWeather, setCurrentWeather] = useState<any>(null);
  const [forecastList, setForecastList] = useState<any[]>([]);
  const [nwpComparison, setNwpComparison] = useState<any>(null);
  const [sectorAdvisory, setSectorAdvisory] = useState<any>(null);
  const [activeSector, setActiveSector] = useState<'agriculture'|'aviation'|'marine'|'urban'>('agriculture');
  const [alertsList, setAlertsList] = useState<any[]>([]);
  const [climateInfo, setClimateInfo] = useState<any>(null);
  const [isSpeakingId, setIsSpeakingId] = useState<string|null>(null);

  // ── ML-backend / location state ──
  const [gpsLocation, setGpsLocation] = useState<Coordinates|null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('pending');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeLangObj = LANGUAGES.find(l => l.code===selectedLang) ?? LANGUAGES[0];

  // ── Voice ──
  const { status:sttStatus, isSupported:sttSupported, startListening, stopListening } = useVoiceInput({
    lang: activeLangObj.speechLocale,
    onTranscript: (text) => { if (text) setInput(text); },
    onError: (err) => console.error('Voice error:', err),
  });
  const { speak, stop:stopSpeech, isSpeaking } = useVoiceOutput();

  // ── GPS (for map/radar pages) ──
  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) { setLocationStatus('unsupported'); return; }
    setLocationStatus('pending');
    navigator.geolocation.getCurrentPosition(
      p => { setGpsLocation({ latitude:p.coords.latitude, longitude:p.coords.longitude, accuracy:p.coords.accuracy }); setLocationStatus('granted'); },
      () => { setGpsLocation(null); setLocationStatus('denied'); },
      { enableHighAccuracy:false, timeout:8000, maximumAge:300000 }
    );
  }, []);

  useEffect(() => { requestLocation(); }, []);

  // ── GPS watch (for header indicator) ──
  const handleUseMyLocation = useCallback(() => {
    if (!navigator.geolocation) { alert('Geolocation not supported'); return; }
    if (gpsWatchId !== null) {
      navigator.geolocation.clearWatch(gpsWatchId); setGpsWatching(false); setGpsWatchId(null); return;
    }
    const id = navigator.geolocation.watchPosition(
      p => {
        const {latitude,longitude,accuracy} = p.coords;
        setCurrentCity(`${latitude.toFixed(5)}, ${longitude.toFixed(5)}`);
        setGpsCoords({latitude,longitude,accuracy:accuracy??0});
        setGpsWatching(true);
        setGpsLocation({latitude,longitude,accuracy:accuracy??undefined});
      },
      err => console.warn('GPS error:', err),
      { enableHighAccuracy:true, timeout:8000, maximumAge:0 }
    );
    setGpsWatchId(id); setGpsWatching(true);
  }, [gpsWatchId]);

  useEffect(() => () => { if (gpsWatchId!==null) navigator.geolocation.clearWatch(gpsWatchId); }, [gpsWatchId]);

  // ── Scroll chat on new messages ──
  useEffect(() => {
    if (messages.length > 1 || isLoading) messagesEndRef.current?.scrollIntoView({behavior:'smooth'});
  }, [messages, isLoading]);

  // ── Fetch Java-backend data ──
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        await fetchWeather(currentCity, ctrl.signal);
        await fetchNwp(currentCity, ctrl.signal);
        await fetchSector(currentCity, activeSector, ctrl.signal);
        await fetchAlerts(currentCity, ctrl.signal);
        await fetchClimate(currentCity, ctrl.signal);
      } catch (e) { if (!(e instanceof Error && e.name==='AbortError')) console.warn('Initial load error:', e); }
    })();
    return () => ctrl.abort();
  }, [currentCity, activeSector]);

  const fetchWeather = async (city: string, signal?: AbortSignal) => {
    try {
      const r = await fetch(WEATHER_ENDPOINTS.CURRENT(city), {signal}); const d = await r.json();
      if (d.success && d.data) setCurrentWeather(d.data);
      const f = await fetch(WEATHER_ENDPOINTS.FORECAST(city,7), {signal}); const fd = await f.json();
      if (fd.success && fd.data?.days) setForecastList(fd.data.days);
    } catch (e) { if (!(e instanceof Error && e.name==='AbortError')) console.warn('Weather error:', e); }
  };
  const fetchNwp = async (city: string, signal?: AbortSignal) => {
    try { const r=await fetch(WEATHER_ENDPOINTS.NWP(city),{signal}); const d=await r.json(); if(d.success&&d.data) setNwpComparison(d.data); }
    catch(e){ if(!(e instanceof Error&&e.name==='AbortError')) console.warn('NWP error:',e); }
  };
  const fetchSector = async (city: string, sector: string, signal?: AbortSignal) => {
    setSectorLoading(true);
    try { const r=await fetch(ADVISORIES_ENDPOINT(city,sector),{signal}); const d=await r.json(); if(d.success&&d.data) setSectorAdvisory(d.data); }
    catch(e){ if(!(e instanceof Error&&e.name==='AbortError')) console.warn('Sector error:',e); }
    finally { setSectorLoading(false); }
  };
  const fetchAlerts = async (city: string, signal?: AbortSignal) => {
    try { const r=await fetch(ALERTS_ENDPOINT(city),{signal}); const d=await r.json(); if(d.success&&d.data?.alerts) setAlertsList(d.data.alerts); }
    catch(e){ if(!(e instanceof Error&&e.name==='AbortError')) console.warn('Alerts error:',e); }
  };
  const fetchClimate = async (city: string, signal?: AbortSignal) => {
    try { const r=await fetch(CLIMATE_ENDPOINT(city),{signal}); const d=await r.json(); if(d.success&&d.data) setClimateInfo(d.data); }
    catch(e){ if(!(e instanceof Error&&e.name==='AbortError')) console.warn('Climate error:',e); }
  };

  const toggleVoice = useCallback(() => {
    if (sttStatus==='listening') { stopListening(); setVoiceEnabled(false); }
    else { stopSpeech(); startListening(); setVoiceEnabled(true); }
  }, [sttStatus, startListening, stopListening, stopSpeech]);

  const handleSend = useCallback(async (customMsg?: string) => {
    const text = (customMsg || input).trim();
    if (!text || isLoading) return;
    if (!customMsg) setInput('');
    setIsLoading(true);
    const userMsg = { id:Date.now().toString(), role:'user' as MessageRole, content:text };
    setMessages(p => [...p, userMsg]);
    try {
      const res = await fetch(CHAT_ENDPOINT, { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ message:text, language:selectedLang, sector:activeSector, sessionId:'desktop-session' }) });
      const d = await res.json();
      if (d.success && d.data) {
        const bot = { id:(Date.now()+1).toString(), role:'bot' as MessageRole, content:d.data.answer||'Query processed.', voiceAnswer:d.data.voiceAnswer||d.data.answer };
        setMessages(p => [...p, bot]);
        if (d.data.location?.name) setCurrentCity(d.data.location.name);
        if (voiceEnabled && d.data.voiceAnswer) speak(d.data.voiceAnswer, activeLangObj.speechLocale);
      } else {
        setMessages(p => [...p, { id:(Date.now()+1).toString(), role:'bot', content:d.message||'Could not process query.' }]);
      }
    } catch {
      setMessages(p => [...p, { id:(Date.now()+1).toString(), role:'bot', content:'⚠️ Unable to connect to backend.' }]);
    } finally { setIsLoading(false); }
  }, [input, isLoading, selectedLang, activeSector, voiceEnabled, activeLangObj, speak]);

  const handleSpeakText = (msg: {id:string;content:string;voiceAnswer?:string}) => {
    if (isSpeaking && isSpeakingId===msg.id) { stopSpeech(); setIsSpeakingId(null); }
    else { stopSpeech(); speak((msg.voiceAnswer||msg.content).replace(/[*#`_~]/g,''), activeLangObj.speechLocale); setIsSpeakingId(msg.id); }
  };

  // ── Mobile ──
  if (typeof window!=='undefined' && window.innerWidth<=768) return <MobileWeatherGPT />;

  // ── Pages that use the full-viewport layout (no chat column) ──
  const FULLSCREEN_PAGES: NavPage[] = ['aichat','route','report','map','radar'];
  const isFullscreen = FULLSCREEN_PAGES.includes(activeNav);

  // ── Shared header nav items ──
  const ALL_NAV: {id:NavPage;label:string;icon:React.ReactNode;group:'java'|'ml'}[] = [
    { id:'weather',  label:'Nowcasting',   icon:<Radar size={20}/>,       group:'java' },
    { id:'forecast', label:'Forecast',     icon:<BarChart3 size={20}/>,   group:'java' },
    { id:'nwp',      label:'NWP Models',   icon:<Cpu size={20}/>,         group:'java' },
    { id:'sectors',  label:'Sectors',      icon:<Layers size={20}/>,      group:'java' },
    { id:'alerts',   label:'Alerts',       icon:<Bell size={20}/>,        group:'java' },
    { id:'climate',  label:'Climate',      icon:<TrendingUp size={20}/>,  group:'java' },
    { id:'aichat',   label:'AI Chat',      icon:<Cloud size={20}/>,       group:'ml'   },
    { id:'route',    label:'Route Weather',icon:<Wind size={20}/>,        group:'ml'   },
    { id:'report',   label:'Weather Report',icon:<Droplets size={20}/>,   group:'ml'   },
    { id:'map',      label:'Weather Map',  icon:<MapPin size={20}/>,      group:'ml'   },
    { id:'radar',    label:'Radar',        icon:<Radar size={20}/>,       group:'ml'   },
  ];

  return (
    <div className="simple-weathergpt">
      <div className="glass-orb glass-orb-1" aria-hidden="true" />
      <div className="glass-orb glass-orb-2" aria-hidden="true" />
      <div className="glass-orb glass-orb-3" aria-hidden="true" />

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <button className="sidebar-logo" title="WeatherGPT" aria-label="WeatherGPT">
          <svg className="breeze-icon" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M2 16C2 23.7268 8.2732 30 16 30C23.7268 30 30 23.7268 30 16C30 8.2732 23.7268 2 16 2C8.2732 2 2 8.2732 2 16V16" stroke="white" strokeOpacity="0.225" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M9 13.5C11.5 12 14 12 16.5 13.5C19 15 21.5 15 24 13.5" stroke="white" strokeOpacity="0.9" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M8 17.5C10.5 16 13 16 15.5 17.5C18 19 20.5 19 23 17.5" stroke="white" strokeOpacity="0.9" strokeWidth="2.2" strokeLinecap="round"/>
            <path d="M10 21.5C12 20.5 14 20.5 16 21.5C18 22.5 20 22.5 22 21.5" stroke="white" strokeOpacity="0.9" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
        </button>

        <nav className="sidebar-nav">
          {/* Java-backend pages */}
          <div style={{ padding:'4px 8px 2px', fontSize:'9px', fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.08em', textTransform:'uppercase' }}>Dashboard</div>
          {ALL_NAV.filter(n => n.group==='java').map(n => (
            <button key={n.id} className={`sidebar-item ${activeNav===n.id?'active':''}`} onClick={() => setActiveNav(n.id)} title={n.label} aria-label={n.label}>
              {n.icon}
            </button>
          ))}
          <div style={{ height:'1px', background:'var(--glass-border)', margin:'8px 10px' }} />
          {/* ML-backend pages */}
          <div style={{ padding:'4px 8px 2px', fontSize:'9px', fontWeight:700, color:'var(--text-muted)', letterSpacing:'0.08em', textTransform:'uppercase' }}>AI / Maps</div>
          {ALL_NAV.filter(n => n.group==='ml').map(n => (
            <button key={n.id} className={`sidebar-item ${activeNav===n.id?'active':''}`} onClick={() => setActiveNav(n.id)} title={n.label} aria-label={n.label}>
              {n.icon}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Main ── */}
      <main className="main-content">
        {/* Header */}
        <header className="simple-header">
          <div className="header-brand">
            <div className="header-logo-icon">
              <svg width="22" height="22" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M2 16C2 23.7268 8.2732 30 16 30C23.7268 30 30 23.7268 30 16C30 8.2732 23.7268 2 16 2C8.2732 2 2 8.2732 2 16V16" stroke="currentColor" strokeOpacity="0.225" strokeWidth="2.2" strokeLinecap="round"/>
                <path d="M9 13.5C11.5 12 14 12 16.5 13.5C19 15 21.5 15 24 13.5" stroke="currentColor" strokeOpacity="0.9" strokeWidth="2.2" strokeLinecap="round"/>
                <path d="M8 17.5C10.5 16 13 16 15.5 17.5C18 19 20.5 19 23 17.5" stroke="currentColor" strokeOpacity="0.9" strokeWidth="2.2" strokeLinecap="round"/>
                <path d="M10 21.5C12 20.5 14 20.5 16 21.5C18 22.5 20 22.5 22 21.5" stroke="currentColor" strokeOpacity="0.9" strokeWidth="2.2" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="header-title-group">
              <h1>WeatherGPT</h1>
              <p className="header-subtitle">AI-Powered Meteorological Intelligence</p>
            </div>
          </div>

          <nav className="header-nav">
            {ALL_NAV.map(n => (
              <button key={n.id} className={`header-nav-item ${activeNav===n.id?'active':''}`} onClick={() => setActiveNav(n.id)}>{n.label}</button>
            ))}
          </nav>

          <div className="header-actions">
            <button className="header-action-btn" onClick={handleUseMyLocation} title="Use My Location" aria-label="Use My Location">
              {gpsWatching && gpsCoords ? (
                <span style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'11px' }}>
                  <span style={{ color:gpsCoords.accuracy!<=50?'#10b981':'#f59e0b' }}>●</span>
                  <MapPin size={13} />
                  <span style={{ color:'#94a3b8' }}>GPS {Math.round(gpsCoords.accuracy!)}m</span>
                </span>
              ) : (<MapPin size={16}/>)}
            </button>
            {!isFullscreen && (
              <>
                <button className={`header-action-btn voice-btn ${sttStatus==='listening'?'active':''}`} onClick={toggleVoice} disabled={!sttSupported} title="Voice Query" aria-label="Voice Query">
                  <Mic size={16}/>
                  <span className="voice-label">{sttStatus==='listening'?'Listening…':'Voice'}</span>
                </button>
                <button className="header-action-btn chat-btn" onClick={() => setChatDrawerOpen(!chatDrawerOpen)} title="Open Chat" aria-label="Open Chat">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                  <span className="chat-label">Chat</span>
                </button>
              </>
            )}
            {isFullscreen && locationStatus !== 'pending' && (
              <button className={`header-action-btn ${locationStatus==='granted'?'active':''}`} onClick={requestLocation} title="Location status" style={{ fontSize:'11px', gap:'4px' }}>
                <MapPin size={14}/>
                <span style={{ fontSize:'11px' }}>{locationStatus==='granted'?'GPS on':'GPS off'}</span>
              </button>
            )}
          </div>
        </header>

        {/* ── Full-screen pages (AI / Maps) ── */}
        {isFullscreen && (
          <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0 }}>
            {activeNav==='aichat'  && <AIChatView   location={gpsLocation} />}
            {activeNav==='route'   && <RouteWeatherView />}
            {activeNav==='report'  && <WeatherReportView location={gpsLocation} />}
            {activeNav==='map'     && <WeatherMapView    location={gpsLocation} />}
            {activeNav==='radar'   && <InteractiveRadarView location={gpsLocation} />}
          </div>
        )}

        {/* ── Dashboard pages (Java backend) ── */}
        {!isFullscreen && (<>
          <div className="dashboard-view-container">

            {/* Nowcast */}
            {activeNav==='weather' && !currentWeather && (
              <div style={{ textAlign:'center', padding:'40px', color:'#94a3b8' }}>
                <div style={{ fontSize:'40px', marginBottom:'12px' }}>🌤️</div>
                <p style={{ margin:'0 0 8px', fontWeight:600, color:'#cbd5e1' }}>Loading weather for {currentCity}…</p>
                <p style={{ margin:0, fontSize:'12px' }}>Connecting to Open-Meteo service</p>
              </div>
            )}
            {activeNav==='weather' && currentWeather && (
              <div className="weather-card-simple">
                <div className="weather-card-header">
                  <MapPin size={16}/><span>{currentWeather.location?.name}, {currentWeather.location?.country}</span>
                  <span style={{ marginLeft:'auto', fontSize:'11px', color:'#94a3b8' }}>Live Observation</span>
                </div>
                <div className="weather-card-main">
                  <span className="weather-temp">{Math.round(currentWeather.temperature)}°C</span>
                  <span className="weather-desc">{currentWeather.weatherDescription}</span>
                </div>
                <div className="weather-card-metrics">
                  <div className="metric"><Thermometer size={14}/><span>Feels {Math.round(currentWeather.apparentTemperature||currentWeather.temperature)}°C</span></div>
                  <div className="metric"><Droplets size={14}/><span>{currentWeather.humidity}% humidity</span></div>
                  <div className="metric"><Wind size={14}/><span>{currentWeather.windSpeed} km/h wind</span></div>
                  <div className="metric"><Cloud size={14}/><span>{currentWeather.pressure} hPa</span></div>
                </div>
              </div>
            )}

            {/* 7-day forecast */}
            {activeNav==='forecast' && (
              <div className="forecast-panel-desktop">
                <h3 style={{ margin:'0 0 12px', fontSize:'16px' }}>📅 7-Day Forecast — {currentCity}</h3>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(110px,1fr))', gap:'10px', overflowX:'auto' }}>
                  {forecastList.map((day,i) => (
                    <div key={i} className="forecast-day-glass">
                      <div style={{ fontSize:'12px', fontWeight:700, color:'#38bdf8' }}>{i===0?'Today':i===1?'Tomorrow':day.date}</div>
                      <div style={{ fontSize:'16px', fontWeight:800, margin:'6px 0' }}>{Math.round(day.tempMax)}° / {Math.round(day.tempMin)}°</div>
                      <div style={{ fontSize:'11px', color:'#cbd5e1' }}>{day.weatherDescription}</div>
                      <div style={{ fontSize:'11px', color:'#67e8f9', marginTop:'4px' }}>🌧️ {day.precipitationProbabilityMax}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* NWP */}
            {activeNav==='nwp' && nwpComparison && (
              <div className="nwp-panel-desktop">
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
                  <h3 style={{ margin:0, fontSize:'16px' }}>🛰️ NWP Multi-Model Ensemble</h3>
                  <span style={{ background:'#0284c7', color:'white', padding:'4px 10px', borderRadius:'12px', fontSize:'12px', fontWeight:700 }}>
                    Consensus: {nwpComparison.consensus?.consensusScorePercentage}% ({nwpComparison.consensus?.confidenceLevel})
                  </span>
                </div>
                <p style={{ fontSize:'13px', color:'#cbd5e1', margin:'0 0 12px' }}>{nwpComparison.consensus?.synopticSummary}</p>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'10px' }}>
                  {nwpComparison.models?.map((m: any,i: number) => (
                    <div key={i} style={{ background:'rgba(2,6,23,0.6)', padding:'12px', borderRadius:'8px', border:'1px solid rgba(255,255,255,0.08)' }}>
                      <strong style={{ color:'#38bdf8' }}>{m.modelName}</strong> ({m.resolution})
                      <div style={{ fontSize:'12px', margin:'4px 0' }}>Max: {m.maxTemp}°C | Min: {m.minTemp}°C</div>
                      <div style={{ fontSize:'12px', color:'#94a3b8' }}>Rain: {m.totalPrecipitation} mm | Wind: {m.maxWindSpeed} km/h</div>
                      <div style={{ fontSize:'11px', color:'#67e8f9', marginTop:'4px' }}>{m.synopticCondition}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sectors */}
            {activeNav==='sectors' && (
              <div className="sector-panel-desktop">
                <div style={{ display:'flex', gap:'8px', marginBottom:'14px', flexWrap:'wrap' }}>
                  {(['agriculture','aviation','marine','urban'] as const).map(sec => (
                    <button key={sec} onClick={() => setActiveSector(sec)} style={{ background:activeSector===sec?'#0284c7':'rgba(255,255,255,0.05)', color:'white', border:'none', padding:'6px 14px', borderRadius:'6px', cursor:'pointer', fontSize:'12px', fontWeight:600 }}>
                      {sec==='agriculture'?'🌾 Agriculture':sec==='aviation'?'✈️ Aviation':sec==='marine'?'⚓ Marine':'🏙️ Smart City'}
                    </button>
                  ))}
                </div>
                {sectorLoading ? (
                  <div style={{ textAlign:'center', padding:'20px', color:'#94a3b8' }}>Loading {activeSector} advisory… ⏳</div>
                ) : (<>
                  {activeSector==='agriculture' && sectorAdvisory?.agriculture && (
                    <div style={{ fontSize:'12px', lineHeight:'1.7', display:'flex', flexDirection:'column', gap:'10px' }}>
                      {[['🌾 Sowing Advice','rgba(34,197,94,0.1)','rgba(34,197,94,0.3)','#86efac',sectorAdvisory.agriculture.sowingAdvisory],
                        ['💧 Irrigation','rgba(59,130,246,0.1)','rgba(59,130,246,0.3)','#93c5fd',sectorAdvisory.agriculture.irrigationRecommendation],
                        ['🧪 Spraying','rgba(168,85,247,0.1)','rgba(168,85,247,0.3)','#d8b4fe',sectorAdvisory.agriculture.sprayingWindow]].map(([title,bg,bc,tc,text])=>(
                        <div key={title as string} style={{ background:bg as string, border:`1px solid ${bc}`, padding:'12px', borderRadius:'8px' }}>
                          <p style={{ margin:'0 0 4px', fontWeight:600, color:tc as string }}>{title as string}</p>
                          <p style={{ margin:0, color:'#cbd5e1' }}>{text as string}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {activeSector==='aviation' && sectorAdvisory?.aviation && (
                    <div style={{ fontSize:'12px', lineHeight:'1.7', display:'flex', flexDirection:'column', gap:'10px' }}>
                      <div style={{ background:'rgba(56,189,248,0.1)', border:'1px solid rgba(56,189,248,0.3)', padding:'12px', borderRadius:'8px' }}>
                        <p style={{ margin:'0 0 4px', fontWeight:600 }}>✈️ Flight Category</p>
                        <p style={{ margin:0, color:'#cbd5e1', fontWeight:700 }}>{sectorAdvisory.aviation.flightCategory}</p>
                      </div>
                      <div style={{ background:'rgba(17,24,39,0.8)', border:'1px solid rgba(255,255,255,0.1)', padding:'12px', borderRadius:'8px', fontFamily:'monospace', fontSize:'11px' }}>
                        <p style={{ margin:0, color:'#93c5fd' }}>{sectorAdvisory.aviation.metarCode}</p>
                      </div>
                    </div>
                  )}
                  {activeSector==='marine' && sectorAdvisory?.marine && (
                    <div style={{ fontSize:'12px', lineHeight:'1.7', display:'flex', flexDirection:'column', gap:'10px' }}>
                      <div style={{ background:'rgba(6,182,212,0.1)', border:'1px solid rgba(6,182,212,0.3)', padding:'12px', borderRadius:'8px' }}>
                        <p style={{ margin:'0 0 4px', fontWeight:600, color:'#67e8f9' }}>⚓ Fishermen Directive</p>
                        <p style={{ margin:0, color:'#cbd5e1' }}>{sectorAdvisory.marine.fishermenAction}</p>
                      </div>
                    </div>
                  )}
                  {activeSector==='urban' && sectorAdvisory?.smartCity && (
                    <div style={{ fontSize:'12px', lineHeight:'1.7', display:'flex', flexDirection:'column', gap:'10px' }}>
                      <div style={{ background:'rgba(217,119,6,0.1)', border:'1px solid rgba(217,119,6,0.3)', padding:'12px', borderRadius:'8px' }}>
                        <p style={{ margin:'0 0 4px', fontWeight:600, color:'#fcd34d' }}>🌊 Flood Risk</p>
                        <p style={{ margin:0, color:'#cbd5e1' }}>{sectorAdvisory.smartCity.waterloggingFloodRisk}</p>
                      </div>
                    </div>
                  )}
                </>)}
              </div>
            )}

            {/* Alerts */}
            {activeNav==='alerts' && (
              <div className="alerts-panel-desktop">
                <h3 style={{ margin:'0 0 12px', fontSize:'16px' }}>🚨 IMD Colour-Coded Early Warnings</h3>
                {alertsList.length===0 ? (
                  <div style={{ textAlign:'center', padding:'20px', color:'#10b981' }}>
                    <CheckCircle size={36}/>
                    <p>🟢 <strong>IMD Green: Normal Weather Conditions</strong></p>
                    <span style={{ fontSize:'12px', color:'#94a3b8' }}>No severe weather warnings for {currentCity}.</span>
                  </div>
                ) : alertsList.map((a: any) => (
                  <div key={a.id} style={{ background:'rgba(2,6,23,0.5)', borderLeft:'4px solid #f59e0b', padding:'10px 14px', borderRadius:'6px', marginBottom:'8px' }}>
                    <div style={{ display:'flex', gap:'8px', fontSize:'11px', marginBottom:'4px' }}>
                      <span style={{ background:'#ef4444', color:'white', padding:'1px 6px', borderRadius:'4px' }}>{a.severity}</span>
                      <span style={{ color:'#38bdf8' }}>{a.informationClass}</span>
                    </div>
                    <strong style={{ fontSize:'14px' }}>{a.title}</strong>
                    <p style={{ margin:'4px 0', fontSize:'12px', color:'#cbd5e1' }}>{a.description}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Climate */}
            {activeNav==='climate' && (
              <div className="climate-panel-desktop" style={{ overflowY:'auto', flex:1 }}>
                <h3 style={{ margin:'0 0 16px', fontSize:'16px' }}>📈 Climate Analysis — {currentCity}</h3>
                {!climateInfo ? (
                  <div style={{ textAlign:'center', padding:'40px', color:'#94a3b8' }}>
                    <div style={{ fontSize:'32px', marginBottom:'12px' }}>📊</div>
                    <p style={{ margin:0 }}>Loading climate data for <strong>{currentCity}</strong>…</p>
                  </div>
                ) : (<>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:'10px', marginBottom:'16px' }}>
                    {[
                      ['🔥 Warming','#f87171',`+${climateInfo.warmingRatePerDecade}°C`,'per decade'],
                      ['🌡️ Baseline','#38bdf8',`${climateInfo.baselineMeanTemperature}°C`,'30-yr normal'],
                      ['🌧️ Annual Rain','#67e8f9',`${climateInfo.baselineAnnualPrecipitation} mm`,'per year'],
                    ].map(([label,color,val,sub])=>(
                      <div key={label as string} style={{ background:'rgba(2,6,23,0.6)', border:`1px solid ${color}33`, padding:'12px', borderRadius:'10px', textAlign:'center' }}>
                        <div style={{ fontSize:'11px', color:'#94a3b8', marginBottom:'4px' }}>{label as string}</div>
                        <div style={{ fontSize:'22px', fontWeight:800, color:color as string }}>{val as string}</div>
                        <div style={{ fontSize:'10px', color:'#64748b' }}>{sub as string}</div>
                      </div>
                    ))}
                  </div>
                  {climateInfo.yearlyMetrics?.length > 0 && (
                    <div style={{ background:'rgba(2,6,23,0.55)', border:'1px solid rgba(255,255,255,0.07)', padding:'14px', borderRadius:'10px', marginBottom:'16px' }}>
                      <p style={{ margin:'0 0 12px', fontSize:'13px', fontWeight:600, color:'#38bdf8' }}>📊 Year-by-Year Temperature</p>
                      <div style={{ display:'flex', alignItems:'flex-end', gap:'4px', height:'80px', overflowX:'auto', paddingBottom:'4px' }}>
                        {climateInfo.yearlyMetrics.map((ym: any, i: number) => {
                          const temps = climateInfo.yearlyMetrics.map((y: any) => y.meanTemperature||0);
                          const mn=Math.min(...temps), mx=Math.max(...temps), rng=mx-mn||1;
                          const h=Math.max(8,((ym.meanTemperature-mn)/rng)*64+8);
                          return (
                            <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'3px', minWidth:'32px' }}>
                              <div title={`${ym.year}: ${ym.meanTemperature}°C`}
                                style={{ width:'20px', height:`${h}px`, background:ym.meanTemperature>(mn+mx)/2?'linear-gradient(180deg,#f87171,#fb923c)':'linear-gradient(180deg,#38bdf8,#0ea5e9)', borderRadius:'3px 3px 0 0' }} />
                              <span style={{ fontSize:'9px', color:'#64748b', writingMode:'vertical-rl' }}>{ym.year}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div style={{ background:'rgba(2,6,23,0.55)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:'10px', overflow:'hidden', marginBottom:'16px', minHeight:'280px' }}>
                    <div style={{ padding:'10px 14px', borderBottom:'1px solid rgba(255,255,255,0.06)', fontSize:'13px', fontWeight:600, color:'#38bdf8' }}>🗺️ Location Map — {currentCity}</div>
                    <ClimateMapEmbed city={currentCity} />
                  </div>
                </>)}
              </div>
            )}
          </div>

          {/* Java-backend chat flow */}
          <div className="simple-chat">
            {messages.map(msg => (
              <div key={msg.id} className={`message ${msg.role}`}>
                <div className="message-bubble">
                  {msg.content.split('\n').map((line, i) => (
                    <p key={i} className={line.startsWith('•')?'message-bullet':line.startsWith('**')?'message-bold':''}>
                      {line.replace(/\*\*/g,'')}
                    </p>
                  ))}
                  {msg.role==='bot' && (
                    <button className="read-aloud-btn" onClick={() => handleSpeakText(msg)}
                      style={{ background:'transparent', border:'none', color:'#38bdf8', cursor:'pointer', display:'flex', alignItems:'center', gap:'4px', marginTop:'6px', fontSize:'12px' }}>
                      {isSpeaking&&isSpeakingId===msg.id ? <VolumeX size={14}/> : <Volume2 size={14}/>}
                      <span>{isSpeaking&&isSpeakingId===msg.id?'Stop Speech':'Listen'}</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="message bot typing">
                <div className="typing-dots"><span/><span/><span/></div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="input-area">
            <div className="input-container">
              <input ref={inputRef} type="text"
                placeholder={voiceEnabled ? `Listening in ${activeLangObj.label}…` : `Ask WeatherGPT in ${activeLangObj.label}… (e.g. 'Rain in Delhi')`}
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();handleSend();} }}
                className={voiceEnabled?'voice-active':''} />
              <button className={`mic-btn ${voiceEnabled?'active':''}`} onClick={toggleVoice} disabled={!sttSupported} title="Voice Input" aria-label="Voice Input"><Mic size={20}/></button>
              <button className="send-btn" onClick={() => handleSend()} disabled={!input.trim()||isLoading} aria-label="Send"><Send size={18}/></button>
            </div>
            <p className="input-hint">Multilingual ({activeLangObj.label}) · Enter to send · MoES / IMD Aligned</p>
          </div>

          <footer className="simple-footer">
            <p>WeatherGPT · MoES / IMD · Open-Meteo · Ollama (llama3.2)</p>
          </footer>
        </>)}
      </main>

      <ChatDrawer isOpen={chatDrawerOpen} onClose={() => setChatDrawerOpen(false)} selectedLang={selectedLang} onLanguageChange={setSelectedLang} />
      <MobileChatToggle isOpen={mobileChatOpen} onClose={() => setMobileChatOpen(false)} />
    </div>
  );
}
