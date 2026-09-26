import { CloudRain, Map as MapIcon, MapPin, Thermometer, Wind } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import './WeatherMap.css';
import { reverseGeocodeLabel, useLocation } from '../location/LocationContext';
import { WeatherField } from './weatherField';
import {
  GridResult,
  LayerId,
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
  windStyle,
} from './mapData';

const QUERY_RINGS_KM = [25, 50, 75];

const OSM_ATTR = OSM_TILE_ATTR;

const LAYERS: { id: LayerId; label: string; Icon: typeof MapIcon }[] = [
  { id: 'standard', label: 'Standard', Icon: MapIcon },
  { id: 'temperature', label: 'Temperature', Icon: Thermometer },
  { id: 'precipitation', label: 'Rain', Icon: CloudRain },
  { id: 'wind', label: 'Wind', Icon: Wind },
];

interface LegendSpec {
  title: string;
  gradient: string;
  from: string;
  to: string;
}

function legendFor(layer: LayerId, grid: GridResult | null): LegendSpec | null {
  if (layer === 'standard' || !grid) return null;
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
  const heatLayerRef = useRef<WeatherField | null>(null);
  const [ready, setReady] = useState(false);
  const [layer, setLayer] = useState<LayerId>('standard');
  const [grid, setGrid] = useState<GridResult | null>(null);
  const [gridAt, setGridAt] = useState<number>(0);
  const [point, setPoint] = useState<PointWeather | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [layerLoading, setLayerLoading] = useState(false);
  const [layerError, setLayerError] = useState(false);
  const [readingPos, setReadingPos] = useState<{ x: number; y: number } | null>(null);
  const reading = readingText(layer, point);

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
    // location is captured at mount; live updates come from the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      heatLayerRef.current?.clear();
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

  // Render the active data layer from the (cached) grid.
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || !location) return;
    if (cellRef.current) {
      cellRef.current.clearLayers();
      cellRef.current.remove();
      cellRef.current = null;
    }
    // Standard and wind have no colour field; take the soft overlay down.
    if (layer !== 'temperature' && layer !== 'precipitation') {
      heatLayerRef.current?.clear();
    }
    if (layer === 'standard') return;
    let cancelled = false;
    setLayerLoading(true);
    setLayerError(false);
    (async () => {
      try {
        const g = await fetchGrid(location.latitude, location.longitude);
        if (cancelled || !mapRef.current) return;
        setGrid(g);
        setGridAt(Date.now());
        if (!heatLayerRef.current) heatLayerRef.current = new WeatherField(map);
        const rings = { lat: location.latitude, lon: location.longitude, radiiKm: QUERY_RINGS_KM };
        if (layer === 'temperature' || layer === 'precipitation') {
          // Weather Map Rain honours the same truth gate as Radar: an area
          // with no meaningful rainfall shows no coloured field at all.
          const dry = layer === 'precipitation' && g.maxRain <= MEANINGFUL_RAIN;
          heatLayerRef.current.set({ points: g.points, mode: layer, field: !dry, rings });
        } else {
          // Wind draws its own arrows; the field is re-used for the query
          // rings only (concentric contours around the anchor point).
          heatLayerRef.current.set({ points: g.points, mode: 'precipitation', field: false, rings });
          const grp = L.layerGroup();
          for (const p of g.points) {
            const ws = windStyle(p.windSpeed, g.maxWind);
            const html =
              `<div class="wind-arrow" style="transform:rotate(${Math.round(p.windDir)}deg)">` +
              `<svg width="${ws.size}" height="${ws.size}" viewBox="0 0 24 24" fill="none">` +
              `<path class="shaft" d="M12 20 V7.5" stroke="${ws.color}" stroke-width="2" stroke-linecap="round" opacity="${ws.opacity}"/>` +
              `<path d="M12 4.5 L8.4 10.5 L15.6 10.5 Z" fill="${ws.color}" opacity="${ws.opacity}"/>` +
              `</svg></div>`;
            L.marker([p.lat, p.lon], {
              icon: L.divIcon({
                className: '',
                html,
                iconSize: [ws.size, ws.size],
                iconAnchor: [ws.size / 2, ws.size / 2],
              }),
              interactive: false,
              zIndexOffset: 300,
            }).addTo(grp);
          }
          grp.addTo(map);
          cellRef.current = grp;
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