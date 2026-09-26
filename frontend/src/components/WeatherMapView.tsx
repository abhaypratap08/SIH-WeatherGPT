import { CloudRain, Map as MapIcon, MapPin, Thermometer, Wind, Activity } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import './WeatherMap.css';
import { reverseGeocodeLabel, useLocation } from '../location/LocationContext';
import { WeatherField } from './weatherField';
import {
  GridResult,
  MEANINGFUL_RAIN,
  NEUTRAL_MAP_VIEWPORT,
  NEUTRAL_MAP_ZOOM,
  OSM_TILE_ATTR,
  OSM_TILE_URL,
  PointWeather,
  compass,
  fetchGrid,
  fetchPointWeather,
  fieldGradient,
  windColor,
  windStyle,
} from './mapData';
import { buildWindStreamlines, type Streamline } from './windStreamlines';

const QUERY_RINGS_KM = [25, 50, 75];

const OSM_ATTR = OSM_TILE_ATTR;

// Overview = combined low-intensity view; Temperature/Precipitation/Wind = focus modes
// Radar = real reflectivity composite from RainViewer (global radar mosaic)
type LayerId = 'standard' | 'temperature' | 'precipitation' | 'wind' | 'radar';

const LAYERS: { id: LayerId; label: string; Icon: typeof MapIcon }[] = [
  { id: 'standard', label: 'Overview', Icon: MapIcon },
  { id: 'temperature', label: 'Temperature', Icon: Thermometer },
  { id: 'precipitation', label: 'Rain', Icon: CloudRain },
  { id: 'wind', label: 'Wind', Icon: Wind },
  { id: 'radar', label: 'Radar', Icon: Activity },
];

// Overview mode intensity multipliers (applied to field opacity / wind arrow opacity)
const OVERVIEW_INTENSITY = {
  temperature: 0.45,  // ~half of full intensity (full is ~0.5 core alpha)
  precipitation: 0.45,
  wind: 0.4,          // wind arrows at 40% opacity, same density
  windDensity: 0.5,   // render ~50% of wind arrows in overview
};

interface LegendSpec {
  title: string;
  gradient: string;
  from: string;
  to: string;
}

function legendFor(layer: LayerId, grid: GridResult | null): LegendSpec | null {
  if (layer === 'standard' || layer === 'radar' || !grid) return null;
  if (layer === 'temperature') {
    return {
      title: 'Temperature',
      // Legend bar is sampled from the SAME scale the field uses, across the
      // visible data range, so the legend and the map always agree.
      gradient: fieldGradient('temperature', grid.minTemp, grid.maxTemp),
      from: `${Math.round(grid.minTemp)}°C`,
      to: `${Math.round(grid.maxTemp)}°C`,
    };
  }
  if (layer === 'precipitation') {
    // All-zero / below-threshold area: no field, no legend - see the
    // "No precipitation detected" empty state rendered by the view.
    if (grid.maxRain <= MEANINGFUL_RAIN) return null;
    return {
      title: 'Precipitation',
      gradient: fieldGradient('precipitation', grid.minRain, grid.maxRain),
      from: `${grid.minRain.toFixed(1)} mm/h`,
      to: `${grid.maxRain.toFixed(1)} mm/h`,
    };
  }
  return {
    title: 'Wind speed',
    gradient: fieldGradient('wind', grid.minWind, grid.maxWind),
    from: `${Math.round(grid.minWind)} km/h`,
    to: `${Math.round(grid.maxWind)} km/h`,
  };
}

/** "HH:MM" clock in Asia/Kolkata for the empty-state "Updated" label. */
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

function readingText(layer: LayerId, p: PointWeather | null): string | null {
  if (!p) return null;
  if (layer === 'precipitation' && p.precip != null) {
    return `${p.precip.toFixed(1)} mm/h at this point`;
  }
  if (layer === 'wind' && p.windSpeed != null) {
    return `${compass(p.windDir ?? 0)}, ${Math.round(p.windSpeed)} km/h, gusting ${Math.round(p.gust ?? p.windSpeed)}`;
  }
  if (p.temp != null) return `${Math.round(p.temp)}°C at this point`;
  return null;
}

/**
 * Weather Map view: real OpenStreetMap tiles, functional data layers
 * (temperature / rain / wind) rendered from a live Open-Meteo grid, a
 * slate-teal pulsed location dot with concentric query rings, a reading tag
 * at the point, and a bottom-left legend for the active layer. The anchor is
 * the single canonical selected location; tapping the map selects a new
 * location and every other feature re-queries against it. If tiles fail to
 * load, the surface falls back to a dark contour-texture instead of an empty
 * tile state.
 */
export default function WeatherMapView() {
  const { location, setLocation } = useLocation();
  const mountRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const LRef = useRef<any>(null);
  const dotRef = useRef<any>(null);
  const cellRef = useRef<any>(null);
  // Three separate field layers for cross-fade transitions
  const tempFieldRef = useRef<WeatherField | null>(null);
  const precipFieldRef = useRef<WeatherField | null>(null);
  const windLayerRef = useRef<any>(null); // L.layerGroup for wind arrows
  const [ready, setReady] = useState(false);
  const [layer, setLayer] = useState<LayerId>('standard');
  const [grid, setGrid] = useState<GridResult | null>(null);
  const [gridAt, setGridAt] = useState<number>(0);
  const [point, setPoint] = useState<PointWeather | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [layerLoading, setLayerLoading] = useState(false);
  const [layerError, setLayerError] = useState(false);
  const [readingPos, setReadingPos] = useState<{ x: number; y: number } | null>(null);
  // Wind streamlines: traced paths through the wind vector field, re-seeded on
  // pan/zoom so coverage stays reasonable at any zoom level.
  const [streamlines, setStreamlines] = useState<Streamline[]>([]);
  // Container pixel size the streamline paths were traced against; the SVG
  // viewBox is re-synced on pan/zoom/resize so paths stay aligned.
  const [mapW, setMapW] = useState(0);
  const [mapH, setMapH] = useState(0);
  // Latest grid + active layer, read by the pan/zoom re-seed handler without
  // re-subscribing the map listener on every layer change.
  const gridRef = useRef<GridResult | null>(null);
  const layerRef = useRef<LayerId>('standard');
  // Pan/zoom handler plus the latest reseed function, held in refs so the map
  // listener is attached exactly once (mount) and never re-subscribes.
  const mapReSeedRef = useRef<(() => void) | null>(null);
  const reseedStreamlinesRef = useRef<
    ((map: any, grid: GridResult, layer: LayerId) => void) | null
  >(null);
  // RainViewer radar state
  const radarTileLayerRef = useRef<any>(null);
  const [radarFrames, setRadarFrames] = useState<Array<{ time: number; path: string }>>([]);
  const [radarFrameIndex, setRadarFrameIndex] = useState(0);
  const [radarHost, setRadarHost] = useState<string>('');
  const [radarLoading, setRadarLoading] = useState(false);
  const [radarError, setRadarError] = useState<string | null>(null);
  const reading = readingText(layer, point);

  /**
   * Trace (or re-trace) the wind streamline field for the current viewport.
   * Called on layer change and on every pan/zoom/resize: the SVG paths live in
   * container pixel space, so they must be regenerated whenever that space
   * changes or they drift out of alignment with the basemap.
   */
  const reseedStreamlines = (map: any, grid: GridResult, activeLayer: LayerId) => {
    const wantWind = activeLayer === 'standard' || activeLayer === 'wind';
    if (!wantWind) {
      setStreamlines([]);
      setMapW(0);
      setMapH(0);
      return;
    }
    const size = map.getSize();
    if (!size || size.x <= 0 || size.y <= 0) {
      setStreamlines([]);
      setMapW(0);
      setMapH(0);
      return;
    }
    const lines = buildWindStreamlines(
      grid.points,
      (x, y) => {
        const ll = map.containerPointToLatLng([x, y]);
        return [ll.lat, ll.lng] as [number, number];
      },
      [0, 0, size.x, size.y],
      grid.maxWind,
      windColor,
      windStyle,
      activeLayer === 'standard',
    );
    setStreamlines(lines);
    setMapW(size.x);
    setMapH(size.y);
  };
  // Publish the latest reseed function + active layer for the mount-time
  // pan/zoom handler to call without re-subscribing the map listener.
  reseedStreamlinesRef.current = reseedStreamlines;
  layerRef.current = layer;

  // One-shot map initialisation.
  useEffect(() => {
    let cancelled = false;
    let map: any = null;
    let ro: ResizeObserver | null = null;
    (async () => {
      const L = await import('leaflet');
      if (cancelled || !mountRef.current) return;
      LRef.current = L;
      // No location → neutral world viewport (pixels only — never a weather
      // query, never canonical state). The real selection drives the view
      // through the location-change effect below (§no-location).
      map = L.map(mountRef.current, {
        center: location ? [location.latitude, location.longitude] : NEUTRAL_MAP_VIEWPORT,
        zoom: location ? 8 : NEUTRAL_MAP_ZOOM,
      });
      const tiles = L.tileLayer(OSM_TILE_URL, { maxZoom: 19, attribution: OSM_ATTR });
      let errors = 0;
      tiles.on('tileerror', () => {
        errors += 1;
        if (errors >= 6) setTilesFailed(true);
      });
      tiles.addTo(map);
      mapRef.current = map;
      setReady(true);

      // Tapping the map selects the canonical location: the query dot, rings
      // and reading move here, and the header, warnings, forecast, radar and
      // AI context all re-query against these coordinates (§5, §16).
      map.on('click', (e: any) => {
        const lat = e.latlng.lat as number;
        const lon = e.latlng.lng as number;
        void reverseGeocodeLabel(lat, lon).then((name) => {
          // A tap is always a real selection — including the very first one
          // (location === null → this tap becomes the only source). Only a
          // re-tap on the exact current coordinates is a no-op.
          setLocation((prev) =>
            prev && prev.latitude === lat && prev.longitude === lon
              ? {}
              : { latitude: lat, longitude: lon, name, source: 'map' },
          );
        });
      });

      // Self-heal sizing races: if the container had zero size when
      // Leaflet initialised (e.g. mid-layout mount), refit it now and on
      // any later resize so the map is never stuck blank.
      requestAnimationFrame(() => map.invalidateSize());
      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => map.invalidateSize());
        ro.observe(mountRef.current);
      }
      // Re-seed the wind field on any pan/zoom/resize so streamline coverage
      // stays reasonable at every zoom level instead of stretching or bunching.
      const re = () => {
        if (cancelled) return;
        if (!gridRef.current) return;
        const size = map.getSize();
        if (size.x > 0 && size.y > 0) {
          setMapW(size.x);
          setMapH(size.y);
        }
        reseedStreamlinesRef.current?.(map, gridRef.current, layerRef.current);
      };
      map.on('moveend zoomend resize', re);
      mapReSeedRef.current = re;
    })();
    return () => {
      cancelled = true;
      const map0 = mapRef.current;
      if (map0 && mapReSeedRef.current) {
        map0.off('moveend zoomend resize', mapReSeedRef.current);
      }
      mapReSeedRef.current = null;
      tempFieldRef.current?.dispose();
      tempFieldRef.current = null;
      precipFieldRef.current?.dispose();
      precipFieldRef.current = null;
      if (windLayerRef.current) {
        map?.removeLayer(windLayerRef.current);
        windLayerRef.current = null;
      }
      if (ro) ro.disconnect();
      if (map) map.remove();
      mapRef.current = null;
      LRef.current = null;
      setReady(false);
    };
    // location is captured at mount; live updates come from the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch RainViewer radar metadata (host + past frames) on mount
  useEffect(() => {
    let cancelled = false;
    setRadarLoading(true);
    setRadarError(null);
    fetch('https://api.rainviewer.com/public/weather-maps.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (data.host && data.radar?.past?.length) {
          setRadarHost(data.host);
          setRadarFrames(data.radar.past);
          setRadarFrameIndex(data.radar.past.length - 1); // start at latest
        } else {
          setRadarError('No radar frames available');
        }
      })
      .catch((e) => {
        if (!cancelled) setRadarError(e.message || 'Failed to load radar metadata');
      })
      .finally(() => {
        if (!cancelled) setRadarLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // Canonical location changes: move the dot, recentre, refresh the reading.
  // location === null → drop every location-bound artifact (dot, rings,
  // point reading, grid, field) and park the map on the neutral viewport:
  // no stale place data may linger after the location is cleared (§no-location).
  useEffect(() => {
    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L) return;
    if (!location) {
      if (dotRef.current) {
        dotRef.current.remove();
        dotRef.current = null;
      }
      if (cellRef.current) {
        cellRef.current.clearLayers();
        cellRef.current.remove();
        cellRef.current = null;
      }
      tempFieldRef.current?.clear();
      precipFieldRef.current?.clear();
      if (windLayerRef.current) {
        windLayerRef.current.clearLayers();
        map.removeLayer(windLayerRef.current);
        windLayerRef.current = null;
      }
      setPoint(null);
      setReadingPos(null);
      setGrid(null);
      setLayerError(false);
      setLayerLoading(false);
      map.setView(NEUTRAL_MAP_VIEWPORT as [number, number], NEUTRAL_MAP_ZOOM);
      return;
    }
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
    map.setView([location.latitude, location.longitude], Math.max(map.getZoom(), 8));
    void fetchPointWeather(location.latitude, location.longitude)
      .then(setPoint)
      .catch(() => undefined);
  }, [location, ready]);

  // Keep the reading tag pinned above the location dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !location) return;
    const update = () => {
      const pt = map.latLngToContainerPoint([location.latitude, location.longitude]);
      setReadingPos({ x: pt.x, y: pt.y });
    };
    update();
    map.on('move zoom moveend zoomend', update);
    return () => {
      map.off('move zoom moveend zoomend', update);
    };
  }, [location, reading]);

  // Render data layers with cross-fade transitions between overview and focus modes
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || !location) return;

    let cancelled = false;
    setLayerLoading(true);
    setLayerError(false);

    (async () => {
      try {
        const g = await fetchGrid(location.latitude, location.longitude);
        if (cancelled || !mapRef.current) return;
        setGrid(g);
        setGridAt(Date.now());
        gridRef.current = g;

        const rings = { lat: location.latitude, lon: location.longitude, radiiKm: QUERY_RINGS_KM };

        // Initialize three separate field layers if needed
        if (!tempFieldRef.current) tempFieldRef.current = new WeatherField(map);
        if (!precipFieldRef.current) precipFieldRef.current = new WeatherField(map);

        // Determine visibility/opacity for each layer based on current mode
        const isOverview = layer === 'standard';
        const isTempFocus = layer === 'temperature';
        const isPrecipFocus = layer === 'precipitation';
        const isWindFocus = layer === 'wind';

        // Temperature field
        const tempVisible = isOverview || isTempFocus;
        const tempOpacity = isOverview ? OVERVIEW_INTENSITY.temperature : 1.0;
        const tempDry = isOverview ? false : (g.maxRain <= MEANINGFUL_RAIN); // in focus, precip dry check doesn't apply to temp
        tempFieldRef.current.set({
          points: g.points,
          mode: 'temperature',
          field: tempVisible && !tempDry,
          rings: isOverview ? undefined : rings, // only show rings in focus modes
        });
        tempFieldRef.current.setOpacity(tempOpacity);

        // Precipitation field
        const precipDry = g.maxRain <= MEANINGFUL_RAIN;
        const precipVisible = (isOverview || isPrecipFocus) && !precipDry;
        const precipOpacity = isOverview ? OVERVIEW_INTENSITY.precipitation : 1.0;
        precipFieldRef.current.set({
          points: g.points,
          mode: 'precipitation',
          field: precipVisible,
          rings: isOverview ? undefined : rings,
        });
        precipFieldRef.current.setOpacity(precipOpacity);

        // Wind arrows layer
        if (windLayerRef.current) {
          windLayerRef.current.clearLayers();
          map.removeLayer(windLayerRef.current);
        }
        const windVisible = isOverview || isWindFocus;
        if (windLayerRef.current) {
          map.removeLayer(windLayerRef.current);
          windLayerRef.current = null;
        }
        if (windVisible) {
          reseedStreamlines(map, g, layer);
        } else {
          setStreamlines([]);
          setMapW(0);
          setMapH(0);
        }
        layerRef.current = layer;

        // Radar tile layer (RainViewer)
        if (radarTileLayerRef.current) {
          map.removeLayer(radarTileLayerRef.current);
          radarTileLayerRef.current = null;
        }
        if (layer === 'radar' && radarHost && radarFrames.length > 0) {
          const frame = radarFrames[radarFrameIndex];
          const tileUrl = `${radarHost}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
          radarTileLayerRef.current = L.tileLayer(tileUrl, {
            maxZoom: 7,
            attribution: 'Radar © <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a> ' + OSM_ATTR,
            opacity: 0.8,
          }).addTo(map);
        }

      } catch {
        if (!cancelled) {
          setGrid(null);
          setLayerError(true);
        }
      } finally {
        if (!cancelled) setLayerLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [layer, location, ready]);

  const activeLabel = LAYERS.find((l) => l.id === layer)?.label ?? 'layer';
  const legend = legendFor(layer, grid);
  const coords = location
    ? `${Math.abs(location.latitude).toFixed(4)}° ${location.latitude >= 0 ? 'N' : 'S'}, ` +
      `${Math.abs(location.longitude).toFixed(4)}° ${location.longitude >= 0 ? 'E' : 'W'}`
    : 'No location selected';

  return (
    <div className={`map-view ${tilesFailed ? 'tiles-failed' : ''}`}>
      <div className="map-toolbar">
        {LAYERS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`map-layer-pill ${layer === id ? 'active' : ''}`}
            aria-pressed={layer === id}
            onClick={() => setLayer(id)}
          >
            <Icon />
            {label}
          </button>
        ))}
        <span className="map-meta">{coords}</span>
      </div>
      {layer === 'radar' && radarFrames.length > 0 && (
        <div className="radar-time-controls">
          <div className="radar-time-label">
            {radarLoading ? 'Loading radar…' : (
              <>
                Frame {radarFrameIndex + 1} / {radarFrames.length} —
                <strong>{new Date(radarFrames[radarFrameIndex].time * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })} IST</strong>
              </>
            )}
          </div>
          <input
            type="range"
            min={0}
            max={radarFrames.length - 1}
            value={radarFrameIndex}
            onChange={(e) => setRadarFrameIndex(Number(e.target.value))}
            className="radar-time-slider"
            aria-label="Radar time frame"
          />
          <div className="radar-time-ticks">
            <span>Latest</span>
            <span>Oldest</span>
          </div>
          {radarError && <div className="radar-error">{radarError}</div>}
        </div>
      )}
      <div className="map-surface">
        <div ref={mountRef} className="map-leaf" />
        {!location && (
          <div className="weather-empty">
            <MapPin aria-hidden />
            <div className="weather-empty-title">No location selected</div>
            <div className="weather-empty-body">
              Tap the map to choose where to check the weather, search a city on the Weather
              report page, or enable GPS from the header pill. No weather data is requested until
              a location exists.
            </div>
          </div>
        )}
        {streamlines.length > 0 && (
          <svg
            className="wind-streamlines"
            viewBox={`0 0 ${mapW || 1} ${mapH || 1}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            {streamlines.map((s, i) => (
              <g key={i}>
                {/* Halo behind the coloured stroke so the line reads against
                    both light and dark basemap terrain. */}
                <path
                  d={s.d}
                  className="wind-stream-halo"
                  strokeWidth={s.width + 2.6}
                />
                <path
                  d={s.d}
                  className="wind-stream"
                  stroke={s.color}
                  strokeWidth={s.width}
                  strokeOpacity={s.opacity}
                  strokeDasharray="10 16"
                  style={{
                    strokeDashoffset: s.dashOffset,
                    animationDuration: `${s.dashDuration}s`,
                  }}
                />
              </g>
            ))}
          </svg>
        )}
        {layerLoading && <div className="map-loading">Loading {activeLabel.toLowerCase()} layer…</div>}
        {layerError && (
          <div className="map-layer-error">
            Live {activeLabel.toLowerCase()} data is unavailable right now. Showing the base map with your location reading.
          </div>
        )}
        {layer === 'precipitation' && grid && grid.maxRain <= MEANINGFUL_RAIN && !layerLoading && !layerError && (
          <div className="weather-empty">
            <CloudRain aria-hidden />
            <div className="weather-empty-title">No precipitation detected</div>
            <div className="weather-empty-body">
              No meaningful rainfall is currently detected in this area.
            </div>
            <div className="weather-empty-meta">Updated {istClock(gridAt)} IST</div>
          </div>
        )}
        {legend && (
          <div className="map-legend">
            <div className="legend-title">{legend.title}</div>
            <div className="legend-bar" style={{ background: legend.gradient }} />
            <div className="legend-range">
              <span>{legend.from}</span>
              <span>{legend.to}</span>
            </div>
          </div>
        )}
        {reading && readingPos && (
          <div className="map-reading" style={{ left: readingPos.x, top: readingPos.y - 30 }}>
            {reading}
          </div>
        )}
      </div>
    </div>
  );
}