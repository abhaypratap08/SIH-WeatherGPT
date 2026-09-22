import type { SelectedLocation } from '../location/LocationContext';

/** The `location` object accepted by the ML backend `/agent` endpoint. */
export interface AgentLocationPayload {
  latitude: number;
  longitude: number;
  /** Optional per-fix GPS accuracy (the canonical store does not track it). */
  accuracy?: number;
}

/**
 * Builds the `location` object for the `/agent` request from the canonical
 * selected location AT SEND TIME.
 *
 * Nothing is cached: each message reads the current canonical state, so a
 * location change between messages flows into the next request automatically
 * (docs/location-architecture.md §10 — "current coordinates at request time").
 *
 * `null` is passed through so the request can express "no location" the same
 * way frontend2 did (the backend treats `location` as optional).
 */
export function buildAgentLocationPayload(
  location: (Pick<SelectedLocation, 'latitude' | 'longitude'> & { accuracy?: number }) | null,
): AgentLocationPayload | null {
  if (!location) return null;
  const payload: AgentLocationPayload = {
    latitude: location.latitude,
    longitude: location.longitude,
  };
  if (typeof location.accuracy === 'number' && Number.isFinite(location.accuracy)) {
    payload.accuracy = location.accuracy;
  }
  return payload;
}