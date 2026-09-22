/**
 * Canonical selected-location state for the entire app.
 *
 * One location, every consumer:
 *
 *        LocationProvider
 *              │
 *   ┌──────────┼──────────────┬─────────────┐
 *   │          │              │             │
 * Header     Weather Map    Radar        Forecast
 *   │          │              │             │
 * Warnings  report cache   point rain    charts / AI
 *
 * A location may exist as an initial default (Delhi) but it is never the
 * permanent source of truth: a GPS fix, a map tap, a search result, a chat
 * resolution or a deep link replaces it and every consumer re-queries
 * against the new coordinates.
 *
 * Selection sources (see docs/location-architecture.md):
 *  - default : initial state before the user chooses anything
 *  - url     : ?lat=..&lon=..&name=.. deep link (wins over persisted state)
 *  - gps     : browser geolocation (auto-fill only when nothing was chosen;
 *              the location pill click always refreshes it)
 *  - map     : tap on the Weather Map or Radar map
 *  - search  : Weather report city search
 *  - chat    : location resolved by the AI assistant's answer
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type LocationSource =
  | 'default'
  | 'url'
  | 'gps'
  | 'map'
  | 'search'
  | 'chat';

export interface SelectedLocation {
  latitude: number;
  longitude: number;
  /** Display name (reverse-geocoded, search result, or chat resolution). */
  name: string;
  region?: string;
  country?: string;
  /** How this location was last selected — auditable, not user-visible. */
  source: LocationSource;
}

export type LocationPatch = Partial<
  Pick<SelectedLocation, 'latitude' | 'longitude' | 'name' | 'region' | 'country'>
> & { source?: LocationSource };

/**
 * Initial default. This is only the starting state: any explicit selection
 * (GPS, map tap, search, chat, deep link) replaces it and every feature then
 * follows the new location. See docs/location-architecture.md.
 */
export const DEFAULT_LOCATION: SelectedLocation = {
  latitude: 28.6139,
  longitude: 77.209,
  name: 'Delhi',
  source: 'default',
};

const STORAGE_KEY = 'weathergpt:selectedLocation';

function isLat(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90;
}
function isLon(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180;
}

const SOURCES: LocationSource[] = ['default', 'url', 'gps', 'map', 'search', 'chat'];

function sanitize(raw: unknown): SelectedLocation | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!isLat(o.latitude) || !isLon(o.longitude)) return null;
  const name =
    typeof o.name === 'string' && o.name.trim() ? o.name.trim() : 'Selected point';
  const source: LocationSource = SOURCES.includes(o.source as LocationSource)
    ? (o.source as LocationSource)
    : 'default';
  return {
    latitude: o.latitude as number,
    longitude: o.longitude as number,
    name,
    region: typeof o.region === 'string' ? o.region : undefined,
    country: typeof o.country === 'string' ? o.country : undefined,
    source,
  };
}

/** Deep link support: /weather?lat=..&lon=..&name=.. initialises the state.
 *  The params must actually be present: without them (a plain "/" load) the
 *  default location wins. Historically `Number(null)` yielded 0, which passed
 *  the valid-range check and silently replaced the default with a
 *  (0,0) "Selected point" location — poisoning every backend query. */
function fromUrl(): SelectedLocation | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const latRaw = params.get('lat');
  const lonRaw = params.get('lon');
  if (latRaw === null || lonRaw === null || latRaw.trim() === '' || lonRaw.trim() === '') {
    return null;
  }
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!isLat(lat) || !isLon(lon)) return null;
  return sanitize({
    latitude: lat,
    longitude: lon,
    name: params.get('name') ?? 'Selected point',
    source: 'url',
  });
}

/** Persisted last-selected location (one remembered location, per §25). */
function fromStorage(): SelectedLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return sanitize(JSON.parse(raw));
  } catch {
    return null;
  }
}

function hydrate(): SelectedLocation {
  return fromUrl() ?? fromStorage() ?? DEFAULT_LOCATION;
}

interface LocationContextValue {
  /** The one canonical selected location. */
  location: SelectedLocation;
  /** Update the canonical location. Unknown/invalid coordinates are ignored. */
  setLocation: (patch: LocationPatch | ((prev: SelectedLocation) => LocationPatch)) => void;
  /** Stable identity (lat,lon rounded) for cache keys and effects. */
  locationKey: string;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocationState] = useState<SelectedLocation>(hydrate);

  const setLocation = useCallback<LocationContextValue['setLocation']>((patch) => {
    setLocationState((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : patch;
      const merged = sanitize({ ...prev, ...next, source: next.source ?? prev.source });
      return merged ?? prev;
    });
  }, []);

  // Persist the one remembered location (coordinates + display name only).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
    } catch {
      /* storage unavailable (private mode / quota) — session-only is fine */
    }
  }, [location]);

  const locationKey = `${location.latitude.toFixed(4)},${location.longitude.toFixed(4)}`;
  const value = useMemo(
    () => ({ location, setLocation, locationKey }),
    [location, setLocation, locationKey],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): LocationContextValue {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used inside <LocationProvider>');
  return ctx;
}

/**
 * Friendly place name for a coordinate (Nominatim reverse geocoding). Used
 * when the user taps the map — the dot/rings move immediately, and the name
 * fills in as soon as the lookup returns. Never blocks the UI.
 */
export async function reverseGeocodeLabel(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10`,
    );
    if (!res.ok) return 'Selected point';
    const d = await res.json();
    const a = d.address ?? {};
    return a.city ?? a.town ?? a.village ?? a.county ?? d.display_name ?? 'Selected point';
  } catch {
    return 'Selected point';
  }
}