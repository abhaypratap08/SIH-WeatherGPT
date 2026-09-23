# Location Architecture (null-first)

Status: **implemented** for the primary UI `frontend/`; the legacy UI
`frontend2/` follows the same model (documented in §9).

This document is the project-wide audit of how **the one selected location**
flows through every location-aware feature of WeatherGPT. It records the
canonical model, the backend contract changes, the cache and race-protection
rules, the remaining *intentional* hardcoded references, and the exact checks
that were run. Earlier drafts described an older model with default cities
(Delhi), persisted-hydration and name-keyed queries; **that design is deleted
history** — provenance is preserved in `weathergpt-local-context.md`, and the
text below describes only the current behaviour.

---

## 1. The one question and the null-first model

The app tracks a single state: **which location is currently selected?** Every
feature derives from that answer.

- `location === null` is a **first-class state**: *no location has been
  selected yet*. A fresh visit starts `null` and stays `null` until a REAL
  source supplies coordinates. Nothing is ever chosen implicitly — there is
  **no default city, no fallback centre, and no persisted hydration** of a
  previous session's pick.
- A location is created **only** by a real source:
  `url` (deep link), `gps` (browser geolocation), `map` (explicit tap),
  `search` (the weather-report city search), or `chat` (a location resolved by
  the AI assistant's answer). There is no `'default'` source.
- **No location ⇒ no weather API request.** Every data page (forecast, NWP,
  sectors, alerts, climate, report, map, radar) and the warning bulletin
  render a truthful "no location" state instead of fetching. The AI chat may
  still be used without a location (`/agent` accepts a null location), but the
  assistant then has no place context — it answers generically or asks the
  user to name a place.
- **Coordinates are the identity; the name is a display label only.** A
  reverse-geocode failure never loses the selection: the coordinates stay and
  the label becomes the generic `"Selected point"`.

The pure logic behind this lives in
`frontend/src/location/locationCore.ts` (no React, no DOM, no network —
directly unit-testable; `tests/location_core.test.ts`), and the React store is
`frontend/src/location/LocationContext.tsx`.

---

## 2. Canonical store — `LocationContext` + `locationCore`

```
   LocationProvider (one SelectedLocation | null)
         │ state: LocationState
   ┌─────┼──────────┬─────────────┬─────────────┐
 Header  Map      Radar      Forecast      Chat / AI
   │      │          │          (NWP/climate (location payload
 Alerts report      point rain  sectors/alerts  sent per request)
   │      cache         │            │
```

### `frontend/src/location/locationCore.ts` (pure, tested)

| Member | Purpose |
| --- | --- |
| `SelectedLocation { latitude; longitude; name; region?; country?; source }` | Canonical shape. `name` is **display-only**. |
| `LocationSource = 'url' \| 'gps' \| 'map' \| 'search' \| 'chat'` | Real sources only — no `'default'`. |
| `sanitize(raw)` | Validate + coerce. Returns `null` unless a patch has BOTH valid coordinates **and** a known source; blank `name` falls back to `'Selected point'`. A partial patch can never invent a location. |
| `parseDeepLink(search)` | Strict `?lat=..&lon=..&name=..` parse. Missing/blank/out-of-range params ⇒ `null` — the historical `Number(null) → 0` path that fabricated a `(0,0)` location is gone. |
| `locationKeyOf(loc)` | `lat,lon` rounded to 4 decimals; **`null` for `null`** so caches/effects never fire without a location. |
| `reportCacheKey(lat, lon)` | `weatherGPT_offline_forecast_{lat.2f}_{lon.2f}` (also used verbatim by `frontend2/`). |
| `SELECTED_POINT_LABEL` | The generic `"Selected point"` label. |

### `frontend/src/location/LocationContext.tsx` (React store)

- **Init from the URL deep link ONLY.** No `localStorage` read, no
  `fromStorage`, no hydration, no `DEFAULT_LOCATION`. A plain `/` load starts
  `null`; `?lat=..&lon=..&name=..` starts `'selected'`.
- **`LocationState`** discriminated union: `none` | `requesting-gps` |
  `selected` | `denied` | `error`. `selected` is the only state with a real
  location; `denied`/`error` mean GPS failed **and** no other source exists
  yet (a later map tap / search / deep link always recovers). The header pill
  renders every state truthfully (§3).
- **`setLocation(patch)`** merges a partial patch. A patch carrying
  coordinates must also carry a real source (`source` survives from `prev`
  when the patch has none) or it is rejected; a name-only patch (the
  reverse-geocode label fill) is only meaningful when a location already
  exists — it can never create one.
- **GPS**: auto-fill runs once on mount **only while `location === null`**
  (a deep-link session skips it). The header pill click is **explicit** and
  always refreshes. A failure never discards an existing selection, and a
  successful auto-fill never overwrites a selection the user made while the
  call was in flight. The reverse-geocoded name is applied only if the fix
  still matches the current coordinates.
- **`locationKey`** is `locationKeyOf(location)` — `null`-safe identity for
  effects and caches.

---

## 3. Consumers, page by page

### Header pill (`frontend/src/components/AppHeader.tsx`)

Truthful for every `LocationState`: selected `name` → **"Finding your
location…"** while requesting GPS → **"Location unavailable"** on
`denied`/`error` → **"Select a location"** when `none`. It never fabricates a
place. Clicking always calls `requestGpsLocation()`.

### `frontend/src/App.tsx` — rail/drawer pages

Every data page follows the pattern `location ? <page content> : <NoLocation/>`
and the fetch effect is guarded up front:

```
useEffect(() => {
  if (!activePage || !location) return;   // no location → NO request
  ...
}, [activePage, location, locationKey, activeSector]);
```

- **Forecast / NWP / Sectors / Alerts / Climate** pages render the shared
  `NoLocation` panel (`frontend/src/App.tsx`, "No location selected — choose
  where to check the weather…") when `location === null`. `retryFetch`
  guards `if (!location) return;`.
- **Alerts** are fetched whenever a location exists; the effect's null branch
  drops any previous alerts (`setAlertsList([])`) so a stale warning can never
  appear under a "no location" header. The `activeWarning` bulletin also
  requires `location` (plus demo-only dev seam, §10).
- **Location change reset effect** (declared BEFORE the fetch effect) clears
  every page's one-shot state (`forecastList`, NWP, climate, sector
  advisories, `alertsList`) on any `locationKey` transition — including
  `null → coords` and `coords → null` — so the UI never shows "yesterday's
  place" data under a new header.
- **`toWeatherQuery(loc)`** builds the backend query as `{latitude,
  longitude, name}` — coordinates authoritative, name as display label; it is
  null-rejecting by construction (callers guard `location === null` first).
- **Climate map embed** (`ClimateMapEmbed lat lon label`) renders only inside
  the `location` branch — viewport and marker use the canonical coordinates,
  never a name geocode and never a fallback centre.

### Weather Report (`WeatherReportView`)

- No location ⇒ no fetch: the effect's null branch clears any `record` and
  the per-run key; the page shows "Search a city to load a forecast."
- **Search selects the canonical location** (`source: 'search'`), so map,
  radar, warnings and the AI chat context all follow the searched city.
- Offline reads use `reportCacheKey` for the **current** coordinates only —
  a Delhi record can never satisfy a Ghaziabad request, and the cache is never
  consulted without a location (§7).

### Route Weather planner (`RouteWeatherView`)

A **user-driven journey form**: origin/destination default to empty strings
(placeholders "Starting point" / "Finish point"), and it has no dependency on
the canonical location at all — a planned route is never "the selected
weather location", and no geography is ever pre-filled for the user.

### Weather Map & Radar (`WeatherMapView.tsx`, `WeatherRadarView.tsx`)

- **Neutral viewport** when `location === null`: `NEUTRAL_MAP_VIEWPORT =
  [20, 0]`, `NEUTRAL_MAP_ZOOM = 2` (`frontend/src/components/mapData.ts`) —
  Leaflet init pixels only. It is **never** fed into any weather request and
  never written into the canonical store; a `20,0` coordinate is never
  "selected". The first real selection re-centres the map immediately.
- **Map tap is always a real selection** — including the very first one
  (`location === null` → the tap *becomes* the only source). Re-tapping the
  exact current coordinates is a no-op.
- **Null branch cleans up**: when the location is cleared, both views remove
  every location-bound artifact (query dot, grid/cell layers, heat layer,
  reading, radar frames, point rain, movement, alerts, errors/loading) and
  recentre on the neutral viewport — no stale place data lingers.
- Data effects are guarded (`if (!map || !location) return;`,
  `if (!L || !map || !location) return;`), so no grid/frame request fires
  without a location.
- A `.weather-empty` / `.radar-empty` overlay ("No location selected — tap the
  map…") covers the map surface while `location === null`; the Radar
  subtitle shows the same truthful label instead of a fabricated place.

### AI Chat (`AIChatWorkspace.tsx`)

- **Greeting**: with a location, "Ask anything about the weather in {name}.";
  without one, "Ask anything about the weather anywhere. Choose a location
  from the header pill, the Weather map, or the Weather report."
- The `/agent` request carries `{ prompt, location:
  buildAgentLocationPayload(location) }` **read at send time** (nothing
  cached inside the component). `buildAgentLocationPayload(null)` returns
  `null` (§9: the ML agent treats it as optional), so chatting without a
  location is allowed and *no location is fabricated*.
- **The AI answer never rewrites the canonical store** — the reply is text
  only; a place named in a prompt is resolved by the agent *for that answer
  only*.

---

## 4. Backend contract

### Coordinate-authoritative controllers

Weather, NWP, SectorAdvisory, Climate, Alert and AlertStream controllers
already derive queries from `latitude != null && longitude != null` →
`GeoLocation.fromCoordinates(name, lat, lon)`; `GeoLocation.validate`
enforces the coordinate ranges; `weatherService.resolveLocation` throws
`ResourceNotFoundException` for unknown names; the legacy `?location=Delhi`
name-geocoding form is kept for compatibility. **There is no silent fallback
to any city in a production controller.**

### `LlmQueryUnderstandingService` — no defaults

Location resolution precedence for specialized queries:
**message-detected location → session memory → request `location` (the
user's selected location) → ask the user.** The previous unconditional
"Delhi" reference point and the `(28.61, 77.20)` coordinate fallback are
**removed**:

- no location anywhere ⇒ answer *"Please specify the location for which you
  want weather information…"* — no fabricating coordinates, no default city;
  neither the resolver nor any weather provider is invoked;
- a name that cannot be geocoded ⇒ truthful *"I couldn't find \“X\”…"*;
- `ChatQueryRequest.location` (optional, `@Size(max=100)`) is documented as a
  display label with **no implicit default**.

### Backend tests

- `LlmQueryUnderstandingServiceTest` (5 tests): request-location context used
  when the message names no place; **no-location asks instead of defaulting**
  (verifies `resolveLocation`/provider are `never()` called); unresolvable
  location answers truthfully; message-named location wins over request
  context; session memory restores the last location before request context.
- `WeatherCoordinateAwareEndpointsTest` (3 tests): coordinate-authoritative
  weather endpoints are exercised with `location=null` + lat/lon.

---

## 5. ML `/agent` — null-safe location payload

- `ML/main.py` accepts `location: Optional[LocationPayload] = None`.
  `build_location_context(None)` returns `None` — the system prompt simply
  carries **no** place context, and `fast_weather_response` guards
  `if (location)`. A "my location" style question with no location is not
  silently answered for a default city.
- The frontend `buildAgentLocationPayload` (`frontend/src/components/
  agentPayload.ts`) returns `null` for a null canonical location, so "no
  location" is expressed explicitly in the request rather than hidden.

---

## 6. Caches — coordinate-keyed, no resurrection

| Cache | Key | Rule |
| --- | --- | --- |
| Offline report forecast (`frontend/`) | `weatherGPT_offline_forecast_{lat.2f}_{lon.2f}` (`reportCacheKey`) | Read only for the **current** coordinates; never consulted when `location === null`. |
| Offline report forecast (`frontend2/`, legacy) | identical format | Same rule; the old cross-location `…_last` pointer was **removed** — a saved forecast can only be read for exactly its own coordinates. |
| Map grid / radar frames (`frontend/src/components/mapData.ts`) | `${lat.toFixed(2)},${lon.toFixed(2)}` | Already coordinate-keyed; requests are additionally guarded by `location !== null`. |
| canonical selection | **none** | The selected location is **never persisted**. Old `localStorage["weathergpt:selectedLocation"]` (and the old session-id key) are never written or read. |
| AI chat | stateless | No session storage; coordinates are read at send time. |

**No cache can create or resurrect a location**: persistence is write-only for
forecast data keyed by already-selected coordinates, and the canonical store
has no persistence path at all.

---

## 7. Stale-response and race protection

- **AbortController** on every page fetch (forecast/NWP/climate/sectors/
  alerts): a location change aborts in-flight requests — the latest selection
  wins.
- **Location-change reset effect** drops stale page data immediately (before
  the fetch effect runs) and re-arms the one-shot pages.
- **Functional `setLocation` updates** make async name fills no-ops when the
  coordinates have already moved on (map taps, GPS reverse-geocode fill).
- **GPS auto-fill never overwrites** a selection made while the call was in
  flight; an explicit pill click always refreshes; a GPS failure keeps the
  existing selection (status falls back to `'selected'` when a location
  exists).
- **Per-run `cancelled` flags** (report fetch, `ClimateMapEmbed`, map init)
  discard results from superseded runs.
- Report effect tracks `lastKeyRef` so another place's forecast is never left
  on screen while the new one loads.

---

## 8. No-location page × state matrix

| Surface | `location === null` renders | Network behaviour |
| --- | --- | --- |
| Chat greeting | "Ask anything about the weather anywhere…" | None unless the user sends a message (then `/agent` with `location: null`); no weather data requested on mount |
| Forecast / NWP / Sectors / Alerts / Climate | `NoLocation` panel | **No request** (guarded up front) |
| Alerts bulletin | no bulletin (alerts list dropped) | **No request** |
| Weather Report | search form + "Search a city to load a forecast." | **No request** (offline cache not consulted) |
| Weather Map / Radar | neutral world viewport + "No location selected" overlay | **No grid/frame/point-rain request** |
| Route weather | empty form (placeholders only) | None until the user submits origin+destination (route API is location-independent of the store) |
| Header pill | "Select a location" / "Finding your location…" / "Location unavailable" | GPS request only |

---

## 9. `frontend2/` (legacy secondary UI)

`frontend2/src/pages/ChatScreen.tsx` follows the same null-first rules:

- Weather map / interactive radar initialise on `NEUTRAL_LAT = 20`,
  `NEUTRAL_LNG = 0` (local constants), zoom 2; OWM case-weather overlays and
  markers render only inside `if (location)`, and the marker effect's null
  branch removes the marker and recentres.
- `loadPersistedForecast(lat?, lon?)` requires coordinates (returns `null`
  without them); `persistForecast` writes only per-coordinate keys.
  `LAST_CACHE_KEY` (the old cross-location "last saved forecast" pointer) is
  **removed**.
- Route fields default to `""` with "Starting point" / "Finish point"
  placeholders.

---

## 10. Remaining intentional references (full inventory)

| Reference | Where | Why it stays |
| --- | --- | --- |
| `NEUTRAL_MAP_VIEWPORT [20, 0]` / zoom 2 | `mapData.ts`, frontend2 locals | Leaflet init pixels only — never a weather request, never canonical state |
| `"Selected point"` label | `locationCore.ts` | Generic display label for coordinates without a better reverse-geocode name (coords remain authoritative) |
| `?location=Delhi` name form | backend controllers | Backward-compatible name geocoding; no default is injected anywhere |
| "…weather in Delhi?" example | `LlmQueryUnderstandingService` ask-for-location prompt | A linguistic example inside the *no-location* reply, not a default — the message only appears when NO location exists anywhere |
| Delhi example coords/prompt | `ML/` module docstrings | Documentation only |
| `ML/map/*` route artifacts | generated demo outputs (e.g. Delhi→Jaipur) | Build artifacts of the route-weather prototype |
| `DEMO_WARNING` | `App.tsx` (`?demo=1` dev seam) | Dev-only canned warning; never active in a normal session |
| Old default-city/hydration behaviour | `weathergpt-local-context.md` history | Deleted-history provenance only; no active code |

---

## 11. Checks run (the truth)

| Check | Command | Result |
| --- | --- | --- |
| Location core unit tests | `node --test tests/location_core.test.ts` | **13 pass, 0 fail** — deep-link parse (valid/missing/out-of-range, no fake `(0,0)`), `sanitize` guards, null-key identity, coordinate cache keys |
| Frontend build | `npm run build` (`tsc -b && vite build`) in `frontend/` | **green** |
| Backend suite | `mvn -o test` in `backend/` | **140 tests, 0 failures, 0 errors** (incl. `LlmQueryUnderstandingServiceTest`, `WeatherCoordinateAwareEndpointsTest`) |
| Legacy UI build | `npm run build` in `frontend2/` | **green** |
| `frontend2` lint | `npm run lint` in `frontend2/` | 15 errors + 3 warnings — **pre-existing** (HEAD baseline 15E + 2W; the single added `exhaustive-deps` warning comes from pre-existing uncommitted work). Not fixed: unrelated to this task and outside acceptance. |
| Final re-grep audit | §12 | no `DEFAULT_LOCATION`, persisted-selection hydration, `LAST_CACHE_KEY`, city fallbacks, or `location!` non-null assertions in active code |

**Not run:** live browser verification (no browser tooling intended for
production-UIs in this session; the primary UI targets deployed backends per
`AGENTS.md`). The manual propagation steps in the repository working
agreement should be replayed against the running app.

---

## 12. Traceability

| Requirement | Documented in |
| --- | --- |
| `location === null` first-class; nothing implicitly chosen | §1, §2, §8 |
| No default city / fallback centre / persisted hydration (frontend, frontend2, backend) | §1, §2, §4, §6, §10 |
| Real-only sources (`url/gps/map/search/chat`, no `'default'`) | §1, §2 |
| Coordinates = identity; name = display label; "Selected point" | §1, §2, §10 |
| No location ⇒ no weather request; truthful no-location UI on every route | §3, §5, §8 |
| Caches coordinate-keyed; no creation/resurrection; stale responses guarded | §6, §7 |
| `LocationState` union (`none/requesting-gps/selected/denied/error`) | §2, §3 |
| Backend: no Delhi default / `(28.61,77.20)` fallback; `?location=` compat kept; coordinate-authoritative requests | §4 |
| Tests for the no-location matrix | §11, `LlmQueryUnderstandingServiceTest`, `WeatherCoordinateAwareEndpointsTest`, `tests/location_core.test.ts` |
| Pre-existing uncommitted work preserved | §13 |

## 13. Notes on the working tree

Pre-existing uncommitted changes (VoiceController normalization, `ChatQueryRequest`
javadoc, `LlmQueryUnderstandingService`, frontend2 `ChatScreen`, `start.sh`) and
untracked docs/tests/scripts (`docs/`, `tests/`, `AGENTS.md`,
`weathergpt-local-context.md`, `.serena/`, `opencode.json`, `frontend/public/
privacy.html|terms.html`, backend test file) were **preserved**; no commits or
pushes were made in this session.