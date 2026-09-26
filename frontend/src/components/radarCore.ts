/**
 * Pure radar decision logic (no React, no DOM): the Precipitation Radar's
 * location-dependent behaviour extracted so `node --test` can exercise the
 * no-location → no-request contract and the coordinate-authority rule
 * without a renderer. The component consumes exactly these helpers; nothing
 * here can fabricate a location, fallback coordinates or a request.
 *
 * Invariants enforced here:
 *   - location === null → no plan (no radar frames, no point weather, no
 *     alerts URL, no marker coordinates);
 *   - location !== null → the canonical coordinates drive every request; the
 *     display name is carried alongside as a presentation-only label.
 */
// Type-only import: `config/api` is not Node-resolvable without a bundler,
// so the alerts-URL builder is injected by the component (tests pass the
// real ALERTS_ENDPOINT declared with an explicit `.ts` import).
import type { WeatherQueryCoords } from '../config/api';
import type { SelectedLocation } from '../location/locationCore';

/** Builder for the early-warnings endpoint (ALERTS_ENDPOINT). */
export type AlertsUrlBuilder = (
  location: string,
  coords?: WeatherQueryCoords,
) => string;

/**
 * True only for a real canonical location. The radar page splits on this:
 * null renders the no-location shell (basemap + truthful empty state, no
 * requests), non-null renders the full radar with a guaranteed-located
 * child. Used as a type guard so the child prop narrows to
 * `SelectedLocation`.
 */
export function hasRealLocation(
  location: SelectedLocation | null,
): location is SelectedLocation {
  return location !== null;
}

/** Canonical coordinates — the single source for the map dot, marker and setView. */
export function coordsOf(location: SelectedLocation): [number, number] {
  return [location.latitude, location.longitude];
}

/**
 * Canonical location created by a map tap: the clicked coordinates are
 * authoritative; the reverse-geocoded `name` is a display label only (a
 * geocoding failure still keeps the coordinates, labelled plainly).
 */
export function mapTapLocation(
  lat: number,
  lon: number,
  name: string,
): SelectedLocation {
  return { latitude: lat, longitude: lon, name, source: 'map' };
}

/** Everything the radar needs to ask about one location. */
export interface RadarRequestPlan {
  latitude: number;
  longitude: number;
  /** Presentation-only label (reverse-geocoded POI or "Selected point"). */
  name: string;
  /** Alerts request built from the canonical coordinates + display label. */
  alertsUrl: string;
}

/**
 * Build the request plan for a location. `null` location → `null` plan, so
 * no radar-frame, point-weather or alerts request can be constructed. The
 * coordinates always win: `name` only rides along for backend display.
 * `buildAlertsUrl` is injected by the caller so this module stays free of
 * non-Node-resolvable imports (the component passes the real ALERTS_ENDPOINT).
 *
 * The overload expresses the contract in the type system: a guaranteed
 * location yields a guaranteed plan, so the inner radar component's effects
 * never see a nullable plan — no assertions, no guards needed.
 */
export function planRadarRequests(
  location: SelectedLocation,
  buildAlertsUrl: AlertsUrlBuilder,
): RadarRequestPlan;
export function planRadarRequests(
  location: SelectedLocation | null,
  buildAlertsUrl: AlertsUrlBuilder,
): RadarRequestPlan | null;
export function planRadarRequests(
  location: SelectedLocation | null,
  buildAlertsUrl: AlertsUrlBuilder,
): RadarRequestPlan | null {
  if (location === null) return null;
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    name: location.name,
    alertsUrl: buildAlertsUrl(location.name, {
      latitude: location.latitude,
      longitude: location.longitude,
      name: location.name,
    }),
  };
}