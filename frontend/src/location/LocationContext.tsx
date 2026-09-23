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
 * `location === null` is a first-class state: **no location has been selected
 * yet**. Nothing is ever chosen implicitly. A location exists only after a
 * REAL source provides one — a GPS fix, an explicit map tap, a search result,
 * a chat resolution or a deep link. There is no default city, no persistence
 * round-trip (old sessions never silently rehydrate a previous pick) and no
 * hydration: a fresh visit starts `null` and stays `null` until the user (or
 * the browser's geolocation, with permission) supplies coordinates.
 *
 * Every consumer must treat `location === null` as "no weather requests" —
 * see docs/location-architecture.md.
 *
 * Selection sources (see docs/location-architecture.md):
 *  - url  : ?lat=..&lon=..&name=.. deep link (explicit intent)
 *  - gps  : browser geolocation (auto-fill only when nothing was chosen; the
 *           location pill click always refreshes it)
 *  - map  : tap on the Weather Map or Radar map
 *  - search  : Weather report city search
 *  - chat : location resolved by the AI assistant's answer
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  locationKeyOf,
  parseDeepLink,
  sanitize,
  type LocationSource,
  type SelectedLocation,
} from './locationCore';

// Re-exported so existing consumers keep importing from LocationContext.
export type { LocationSource, SelectedLocation } from './locationCore';

export type LocationPatch = Partial<
  Pick<SelectedLocation, 'latitude' | 'longitude' | 'name' | 'region' | 'country'>
> & { source?: LocationSource };

/**
 * Discriminated status of the location feature. `status === 'selected'`
 * means a real location exists (location === null only in the other states).
 * `requesting-gps` is transient: the browser geolocation call is in flight.
 * `denied` / `error` mean GPS failed AND no location has been selected by any
 * other real source (a later map tap / search / deep link always recovers).
 */
export type LocationState =
  | { status: 'none' }
  | { status: 'requesting-gps' }
  | { status: 'selected' }
  | { status: 'denied' }
  | { status: 'error' };

/**
 * Mount-time seed from the URL deep link ONLY. Nothing else may seed the
 * canonical state — no localStorage read, no default city. Delegates to the
 * pure {@link parseDeepLink} core function so the parse logic is unit-
 * testable without a DOM (tests/location_core.test.ts).
 */
function initFromUrl(): SelectedLocation | null {
  if (typeof window === 'undefined') return null;
  return parseDeepLink(window.location.search);
}

// GeolocationPositionError code for "permission denied".
const PERMISSION_DENIED_CODE = 1;

const GPS_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 8000,
  maximumAge: 300000,
};

interface LocationContextValue {
  /**
   * The one canonical selected location. `null` until a real source (GPS,
   * map tap, search, chat resolution, deep link) provides one — every data
   * page must treat `null` as "no location, no weather requests".
   */
  location: SelectedLocation | null;
  /** Discriminated status for the header pill / no-location UI. */
  state: LocationState;
  /** Stable identity (lat,lon rounded) for cache keys and effects; null-safe. */
  locationKey: string | null;
  /** Update the canonical location. Invalid/unknown patches are ignored. */
  setLocation: (
    patch: LocationPatch | ((prev: SelectedLocation | null) => LocationPatch),
  ) => void;
  /** Force a GPS refresh (header location pill). Explicit intent: it replaces
   *  whatever is selected right now; a failure keeps the existing location. */
  requestGpsLocation: () => void;
}

const LocationContext = createContext<LocationContextValue | null>(null);

export function LocationProvider({ children }: { children: ReactNode }) {
  // Init from the URL deep link ONLY. Nothing else may seed the canonical
  // state: no localStorage read, no default city (§location-architecture).
  const [location, setLocationState] = useState<SelectedLocation | null>(() => initFromUrl());
  const [status, setStatus] = useState<LocationState['status']>(
    () => (initFromUrl() ? 'selected' : 'none'),
  );

  // Distinguishes the mount-time auto-fill (only fills while nothing was
  // chosen) from an explicit pill click (always replaces the selection).
  const explicitGpsRef = useRef(false);

  // Latest location readable inside async GPS callbacks.
  const locationRef = useRef(location);
  locationRef.current = location;

  const setLocation = useCallback<LocationContextValue['setLocation']>((patch) => {
    setLocationState((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : patch;
      // Full replacement: when the patch carries coordinates it must also
      // carry a real source, or it cannot become a selection.
      if ('latitude' in next || 'longitude' in next) {
        const merged = sanitize({ ...prev, ...next, source: next.source ?? prev?.source });
        return merged ?? prev;
      }
      // Name/region/country-only patch (e.g. the reverse-geocode label fill):
      // only meaningful when a location already exists.
      if (!prev) return prev;
      return sanitize({ ...prev, ...next, source: next.source ?? prev.source }) ?? prev;
    });
    setStatus('selected');
  }, []);

  const runGpsRequest = useCallback((explicit: boolean) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setStatus('error');
      return;
    }
    explicitGpsRef.current = explicit;
    setStatus('requesting-gps');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const lat = p.coords.latitude;
        const lon = p.coords.longitude;
        setLocationState((prev) => {
          // Auto-fill must never overwrite a selection the user made while
          // the GPS call was in flight; an explicit pill click always wins.
          if (!explicit && prev) return prev;
          return sanitize({ latitude: lat, longitude: lon, source: 'gps' });
        });
        setStatus('selected');
        void reverseGeocodeLabel(lat, lon).then((name) => {
          if (name === 'Selected point') return;
          // Only fill the name if the fix still matches the current location.
          setLocationState((prev) =>
            prev && prev.latitude === lat && prev.longitude === lon
              ? sanitize({ ...prev, name })
              : prev,
          );
        });
      },
      (err) => {
        const denied = err?.code === PERMISSION_DENIED_CODE;
        setStatus(() => (locationRef.current ? 'selected' : denied ? 'denied' : 'error'));
      },
      GPS_OPTIONS,
    );
  }, []);

  // Auto-fill once on mount: requesting-gps → selected / denied / error.
  // Never yields a fake location — failure leaves location null. Deep-link
  // sessions skip the auto-fill because a location already exists (url).
  useEffect(() => {
    if (locationRef.current) return;
    runGpsRequest(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestGpsLocation = useCallback(() => runGpsRequest(true), [runGpsRequest]);

  const locationKey = locationKeyOf(location);

  const value = useMemo<LocationContextValue>(
    () => ({ location, state: { status }, locationKey, setLocation, requestGpsLocation }),
    [location, status, locationKey, setLocation, requestGpsLocation],
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