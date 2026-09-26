/**
 * Pure-logic tests for the Precipitation Radar's location contract
 * (tests/radar_core.test.ts). The component consumes exactly these helpers,
 * so these tests exercise the real decision paths:
 *
 *   - `hasRealLocation`      → the outer page split (no-location shell vs
 *                              the located radar);
 *   - `planRadarRequests`    → the ONLY way the radar builds requests; null
 *                              location → null plan → zero request URLs;
 *   - `coordsOf`             → the marker/dot/recentre coordinate source;
 *   - `mapTapLocation`       → the map-tap selection path.
 *
 * Component-level request counting (mounting the React tree) would need a
 * DOM test framework that this repository does not install; the no-location
 * → zero-request rule is instead enforced structurally: every radar-frame,
 * point-weather and alerts request lives in <RadarWithLocation/>, which only
 * ever mounts with a non-null `location` prop, and every request URL is
 * built from `planRadarRequests`. Stale previous-location responses are
 * dropped by effect cancellation in the component (not unit-testable here).
 *
 * Run: node --test tests/radar_core.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coordsOf,
  hasRealLocation,
  mapTapLocation,
  planRadarRequests,
} from '../frontend/src/components/radarCore.ts';
import {
  SELECTED_POINT_LABEL,
  sanitize,
} from '../frontend/src/location/locationCore.ts';
import { ALERTS_ENDPOINT } from '../frontend/src/config/api.ts';

const BENGALURU_POI = {
  latitude: 12.9716,
  longitude: 77.5946,
  name: '16th Park View(GYC)', // reverse-geocoded POI label, not a geocoder key
  source: 'map' as const,
};

test('no location → no-location radar state (outer split gate)', () => {
  assert.equal(hasRealLocation(null), false);
  assert.equal(hasRealLocation(BENGALURU_POI), true);
});

test('location null → no request plan → zero radar/point/alerts requests', () => {
  assert.equal(planRadarRequests(null, ALERTS_ENDPOINT), null);
});

test('real location → request plan carries the canonical coordinates', () => {
  const plan = planRadarRequests(BENGALURU_POI, ALERTS_ENDPOINT);
  assert.ok(plan, 'a real location must produce a plan');
  assert.equal(plan.latitude, BENGALURU_POI.latitude);
  assert.equal(plan.longitude, BENGALURU_POI.longitude);
});

test('alerts request is coordinate-keyed; display label rides along but never replaces coordinates', () => {
  const plan = planRadarRequests(BENGALURU_POI, ALERTS_ENDPOINT);
  assert.ok(plan);
  const q = new URL(plan.alertsUrl).searchParams;
  assert.equal(q.get('latitude'), '12.9716');
  assert.equal(q.get('longitude'), '77.5946');
  // The POI label cannot be geocoded by Open-Meteo, so the backend must
  // receive the coordinates — the name is presentation-only.
  assert.equal(q.get('name'), '16th Park View(GYC)');
});

test('a different location yields a different plan (marker/data re-query on change)', () => {
  const a = planRadarRequests(BENGALURU_POI, ALERTS_ENDPOINT);
  const b = planRadarRequests({
    latitude: 28.6139,
    longitude: 77.209,
    name: 'Delhi',
    source: 'search',
  }, ALERTS_ENDPOINT);
  assert.ok(a && b);
  assert.notEqual(a.latitude, b.latitude);
  assert.notEqual(a.alertsUrl, b.alertsUrl);
  // coordsOf is the marker/recentre source: it must follow the location.
  assert.notDeepEqual(coordsOf(BENGALURU_POI), coordsOf({ latitude: 28.6139, longitude: 77.209, name: 'Delhi', source: 'search' }));
});

test('coordsOf returns the canonical coordinates — never fabricated', () => {
  assert.deepEqual(coordsOf(BENGALURU_POI), [12.9716, 77.5946]);
  // A real 0,0 coordinate is preserved, never masked or replaced.
  assert.deepEqual(
    coordsOf({ latitude: 0, longitude: 0, name: 'Equator crossing', source: 'map' }),
    [0, 0],
  );
});

test('map tap creates a canonical location from the clicked coordinates', () => {
  assert.deepEqual(mapTapLocation(19.076, 72.8777, 'Mumbai'), {
    latitude: 19.076,
    longitude: 72.8777,
    name: 'Mumbai',
    source: 'map',
  });
});

test('reverse-geocode failure keeps the clicked coordinates (plain label)', () => {
  const sel = mapTapLocation(-33.8688, 151.2093, SELECTED_POINT_LABEL);
  assert.equal(sel.latitude, -33.8688);
  assert.equal(sel.longitude, 151.2093);
  assert.equal(sel.name, SELECTED_POINT_LABEL);
  // And the location store's sanitize path preserves those coordinates too.
  const stored = sanitize(sel);
  assert.ok(stored);
  assert.equal(stored.latitude, -33.8688);
  assert.equal(stored.longitude, 151.2093);
  assert.equal(stored.name, SELECTED_POINT_LABEL);
});