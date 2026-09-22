import {
  CloudRain,
  Compass,
  Layers,
  Pause,
  Play,
  Radar,
  RotateCcw,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import './WeatherMap.css';
import { reverseGeocodeLabel, useLocation } from '../location/LocationContext';
import { ALERTS_ENDPOINT } from '../config/api';
import {
  MEANINGFUL_RAIN,
  OSM_TILE_ATTR,
  OSM_TILE_URL,
  RadarFrame,
  fetchPointWeather,
  fetchRadarFrames,
  fieldGradient,
  frameClock,
  rainColor,
  rainMovement,
} from './mapData';
import { WeatherField } from './weatherField';

type Intensity = 'heavy' | 'moderate' | 'light' | 'dry';

/** Intensity bands for the summary counts (mm/h), always over grid cells. */
function classify(mm: number): Intensity {
  if (mm > 10) return 'heavy';
  if (mm > 2.5) return 'moderate';
  if (mm > MEANINGFUL_RAIN) return 'light';
  return 'dry';
}

function istClock(epochMs: number): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    }).format(new Date(epochMs));
  } catch {
    return '--:--';
  }
}

function alertDotClass(a: any): string {
  const s = String(a?.severity ?? '').toUpperCase();
  if (s.includes('EXTREME') || s.includes('RED')) return 'dot-red';
  if (s.includes('SEVERE') || s.includes('ORANGE')) return 'dot-orange';
  if (s.includes('MODERATE') || s.includes('YELLOW')) return 'dot-yellow';
  return 'dot-slate';
}

/**
 * Precipitation Radar: "where is rain, how is it changing, what does it
 * mean?" Identical OSM basemap and the shared WeatherField renderer as the
 * Weather Map. Understands the honest data model from docs/radar-data-
 * capability.md: an estimated 0.5 deg precipitation field from Open-Meteo
 * NWP model forecasts, now..+5 h real forecast frames, no district geometry,
 * no warning polygons, no lightning. Features not backed by data are not
 * exposed as controls. The anchor is the single canonical selected location;
 * tapping the map selects a new location and re-queries everything.
 */
export default function WeatherRadarView() {
  const { location, setLocation } = useLocation();
  const mountRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const dotRef = useRef<any>(null);
  const heatLayerRef = useRef<WeatherField | null>(null);
  const [ready, setReady] = useState(false);
  const [frames, setFrames] = useState<RadarFrame[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number>(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [layerOn, setLayerOn] = useState(true);
  const [opacity, setOpacity] = useState(0.9);
  const [movement, setMovement] = useState<{ bearing: number; label: string } | null>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [pointRain, setPointRain] = useState<string | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const activeFrame = frames?.[frameIndex] ?? null;
  const isLive = frameIndex === 0;
  const meaningful = activeFrame?.meaningful ?? false;

  useEffect(() => {
    let cancelled = false;
    let map: any = null;
    let ro: ResizeObserver | null = null;
    (async () => {
      const L = await import('leaflet');
      if (cancelled || !mountRef.current) return;
      LRef.current = L;
      const lat = location.latitude;
      const lon = location.longitude;
      map = L.map(mountRef.current, {
        center: [lat, lon],
        zoom: 7,
      });
      // Same working OSM basemap as the Weather Map; no CARTO / API key.
      const tiles = L.tileLayer(OSM_TILE_URL, { maxZoom: 19, attribution: OSM_TILE_ATTR });
      let tileErrors = 0;
      tiles.on('tileerror', () => {
        tileErrors += 1;
        if (tileErrors >= 6) setTilesFailed(true);
      });
      tiles.addTo(map);
      mapRef.current = map;
      setReady(true);

      // Tapping the radar map selects the canonical location: the query dot
      // and the precipitation field move here, and the header, warnings,
      // forecast and AI context follow the same coordinates (§16).
      map.on('click', (e: any) => {
        const lat = e.latlng.lat as number;
        const lon = e.latlng.lng as number;
        void reverseGeocodeLabel(lat, lon).then((name) => {
          setLocation((prev) =>
            prev.latitude === lat && prev.longitude === lon
              ? { latitude: lat, longitude: lon, name, source: 'map' }
              : {},
          );
        });
      });

      requestAnimationFrame(() => map.invalidateSize());
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(mountRef.current);
      }
    })();
    return () => {
      cancelled = true;
      heatLayerRef.current?.dispose();
      heatLayerRef.current = null;
      if (ro) ro.disconnect();
      if (map) map.remove();
      mapRef.current = null;
      LRef.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Canonical location changes: move the dot, recentre, fetch the reading.
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    if (dotRef.current) {
      dotRef.current.setLatLng([location.latitude, location.longitude]);
    } else {
      dotRef.current = L.marker([location.latitude, location.longitude], {
        icon: L.divIcon({
          className: '',
          html: '<div class="map-loc-dot"></div>',
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        }),
        interactive: false,
        zIndexOffset: 900,
      }).addTo(map);
    }
    map.setView([location.latitude, location.longitude], Math.max(map.getZoom(), 7));
    void fetchPointWeather(location.latitude, location.longitude)
      .then((p) => setPointRain(p.precip != null ? p.precip.toFixed(1) : null))
      .catch(() => undefined);
  }, [location, ready]);

  // Forecast frames: now..+5 h model frames with real API timestamps.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    (async () => {
      try {
        const res = await fetchRadarFrames(location.latitude, location.longitude);
        if (cancelled || !mapRef.current) return;
        setFrames(res.frames);
        setFetchedAt(res.fetchedAt);
        setFrameIndex(0);
        setPlaying(false);
        setMovement(rainMovement(res.frames));
      } catch {
        if (!cancelled) {
          setFrames(null);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location, ready]);

  // Active-warning line (text only: the backend provides localities and
  // severities, never polygon geometry - see docs/radar-data-capability.md).
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    void fetch(ALERTS_ENDPOINT(location.name), { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d: any) => {
        if (!cancelled && d?.success && Array.isArray(d.data?.alerts)) setAlerts(d.data.alerts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [location.name]);

  // Render the precipitation field for the active frame.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!heatLayerRef.current) heatLayerRef.current = new WeatherField(map);
    const frame = frames?.[frameIndex];
    if (!frame || !frame.meaningful || !layerOn) {
      heatLayerRef.current.clear();
      return;
    }
    heatLayerRef.current.set({ points: frame.points, mode: 'precipitation' });
    heatLayerRef.current.setOpacity(opacity);
  }, [frames, frameIndex, layerOn, opacity, ready]);

  // Playback: advance through real forecast frames; LIVE returns to now.
  useEffect(() => {
    if (!playing || !frames || frames.length < 2) return;
    const id = window.setInterval(() => {
      setFrameIndex((i) => (i + 1) % frames.length);
    }, 900);
    return () => window.clearInterval(id);
  }, [playing, frames]);

  const counts = useMemo(() => {
    const c = { heavy: 0, moderate: 0, light: 0, dry: 0 };
    if (!activeFrame) return c;
    for (const p of activeFrame.points) c[classify(p.precip)] += 1;
    return c;
  }, [activeFrame]);

  const maxRain = activeFrame ? activeFrame.maxRain.toFixed(1) : '0.0';
  const updated = fetchedAt ? istClock(fetchedAt) : '--:--';
  const activeLabel = activeFrame ? frameClock(activeFrame.timeISO) : '--:--';

  return (
    <div className={`map-view radar-view ${tilesFailed ? 'tiles-failed' : ''}`}>
      <div className="radar-header">
        <div className="radar-title-row">
          <h1 className="radar-title">
            <Radar aria-hidden />
            Precipitation Radar
          </h1>
          <span className={`radar-status ${isLive ? 'live' : 'forecast'}`}>
            <span className="radar-status-dot" />
            {isLive ? 'Live' : `Forecast ${activeLabel}`}
          </span>
        </div>
        <div className="radar-sub">
          India{location.name && location.name !== 'India' ? ` / ${location.name}` : ''} · Updated {updated} IST
        </div>
      </div>

      <div className="map-surface">
        <div ref={mountRef} className="map-leaf" />

        {loading && <div className="map-loading">Loading precipitation field…</div>}
        {error && (
          <div className="map-layer-error">
            Live precipitation data is unavailable right now. Showing the base map.
          </div>
        )}

        {activeFrame && !meaningful && layerOn && (
          <div className="radar-empty">
            <CloudRain aria-hidden />
            <div className="radar-empty-title">No precipitation detected</div>
            <div className="radar-empty-body">
              No meaningful rainfall is currently detected in this area.
            </div>
            <div className="radar-empty-meta">Updated {updated} IST</div>
          </div>
        )}

        {meaningful && layerOn && (
          <div className="map-legend">
            <div className="legend-title">Estimated precipitation</div>
            <div className="legend-bar" style={{ background: fieldGradient('precipitation', activeFrame?.minRain ?? 0, activeFrame?.maxRain ?? 0) }} />
            <div className="legend-range">
              <span>{activeFrame?.minRain.toFixed(1)} mm/h</span>
              <span>{maxRain} mm/h</span>
            </div>
          </div>
        )}

        <div className="radar-controls">
          <div className="radar-control-group">
            <div className="radar-control-title">
              <Layers aria-hidden /> Layers
            </div>
            <label className="radar-check">
              <input
                type="checkbox"
                checked={layerOn}
                onChange={(e) => setLayerOn(e.target.checked)}
              />
              Precipitation
            </label>
            <div className="radar-control-note">Estimated field · 0.5° model grid</div>
          </div>
          <div className="radar-control-group">
            <div className="radar-control-title">Opacity</div>
            <div className="radar-opacity-row">
              <input
                type="range"
                min={20}
                max={100}
                value={Math.round(opacity * 100)}
                aria-label="Precipitation opacity"
                onChange={(e) => setOpacity(Number(e.target.value) / 100)}
              />
              <span>{Math.round(opacity * 100)}%</span>
            </div>
          </div>
        </div>

        {activeFrame && (
          <div className="radar-summary">
            <div className="radar-summary-title">Precipitation</div>
            <div className="radar-summary-rows">
              <div className="radar-summary-row">
                <span className="swatch" style={{ background: rainColor(15) }} /> Heavy &gt;10 <b>{counts.heavy}</b>
              </div>
              <div className="radar-summary-row">
                <span className="swatch" style={{ background: rainColor(5) }} /> Moderate 2.5-10 <b>{counts.moderate}</b>
              </div>
              <div className="radar-summary-row">
                <span className="swatch" style={{ background: rainColor(1) }} /> Light 0.05-2.5 <b>{counts.light}</b>
              </div>
            </div>
            <div className="radar-summary-meta">
              Max <b>{maxRain} mm/h</b> · {counts.dry} dry cells · Updated {updated} IST
            </div>
            {pointRain != null && (
              <div className="radar-summary-meta">At your location: {pointRain} mm/h</div>
            )}
            {movement && (
              <div className="radar-summary-meta radar-movement">
                <Compass style={{ transform: `rotate(${movement.bearing}deg)` }} aria-hidden /> Rain
                approaching from <b>{movement.label}</b>
                <span className="radar-summary-note">model forecast trend</span>
              </div>
            )}
            <div className="radar-summary-warn">
              {alerts.length > 0 ? (
                alerts.slice(0, 1).map((a: any) => (
                  <span key={a.id ?? 'warn'} className="radar-advisory">
                    <i className={`dot ${alertDotClass(a)}`} />
                    Advisory · {a.title}
                  </span>
                ))
              ) : (
                <span className="radar-noadvisory">
                  <i className="dot dot-green" />
                  No active warnings
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {frames && frames.length > 1 && (
        <div className="radar-timeline">
          <div className="radar-timeline-controls">
            <button
              type="button"
              className="radar-timeline-btn live"
              onClick={() => {
                setPlaying(false);
                setFrameIndex(0);
              }}
            >
              <RotateCcw aria-hidden /> Live
            </button>
            <button
              type="button"
              className="radar-timeline-btn"
              aria-label="Previous frame"
              disabled={frameIndex === 0}
              onClick={() => {
                setPlaying(false);
                setFrameIndex((i) => Math.max(0, i - 1));
              }}
            >
              <SkipBack aria-hidden />
            </button>
            <button
              type="button"
              className="radar-timeline-btn"
              aria-label={playing ? 'Pause' : 'Play forecast'}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
            </button>
            <button
              type="button"
              className="radar-timeline-btn"
              aria-label="Next frame"
              disabled={frameIndex >= frames.length - 1}
              onClick={() => {
                setPlaying(false);
                setFrameIndex((i) => Math.min(frames.length - 1, i + 1));
              }}
            >
              <SkipForward aria-hidden />
            </button>
            <span className="radar-timeline-label">
              {isLive ? 'Live now' : `Forecast for ${activeLabel} IST`}
            </span>
          </div>
          <input
            type="range"
            className="radar-timeline-slider"
            min={0}
            max={frames.length - 1}
            value={frameIndex}
            aria-label="Forecast frame"
            onChange={(e) => {
              setPlaying(false);
              setFrameIndex(Number(e.target.value));
            }}
          />
          <div className="radar-timeline-ticks">
            {frames.map((f, i) => (
              <span key={f.timeISO} className={i === frameIndex ? 'active' : i === 0 ? 'now' : ''}>
                {i === 0 ? 'Now' : frameClock(f.timeISO)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}