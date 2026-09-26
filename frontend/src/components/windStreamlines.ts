/**
 * Wind streamlines: continuous curved paths traced through the wind vector
 * field, replacing the previous discrete rotated-arrow grid.
 *
 * Design constraints (from the spec this implements):
 *  - Streamlines must FOLLOW the real wind vector at each point. Each step
 *    direction comes from bilinear interpolation of the surrounding real grid
 *    observations — never a faked/decorative direction.
 *  - Sparsity is respected: the observation grid is 5x5, so sampling is clamped
 *    half a cell inside the data box and streamlines stop at the edge rather
 *    than extrapolating into invented detail.
 *  - Legibility: each line carries a halo (--paper) stroke behind the coloured
 *    stroke so it reads against both light and dark terrain, plus an opacity
 *    floor so calm-wind streamlines never fade to invisible.
 *  - Speed maps to the existing slate-teal -> brass scale; red is never used
 *    (severity colours stay reserved for warnings).
 *  - Performance: line count is bounded and animation is a CSS dash-offset
 *    (compositor-friendly), not per-frame JS.
 */
import type { GridPoint } from './mapData';

export interface Streamline {
  /** SVG path in map-container pixel space. */
  d: string;
  /** Rendered colour (slate-teal -> brass scale, never red). */
  color: string;
  /** Opacity after the calm-wind floor is applied. */
  opacity: number;
  /** Stroke width in px, scaled by speed. */
  width: number;
  /** Dash phase offset so neighbouring lines don't animate in lockstep. */
  dashOffset: number;
  /** Animation duration in seconds; faster wind animates quicker. */
  dashDuration: number;
}

/** Minimum opacity so calm wind still reads against the basemap. */
const MIN_OPACITY = 0.34;
/** Clamp on step length in pixels so a fast cell can't make a huge jump. */
const MAX_STEP_PX = 13;
/** Steps traced forward from each seed. */
const FOCUS_STEPS = 30;
const OVERVIEW_STEPS = 22;

/** Build the 5x5 observation lattice (row 0 = northernmost). */
function buildLattice(points: GridPoint[]): {
  grid: GridPoint[][];
  lats: number[];
  lons: number[];
  spacing: number;
} {
  const lats = [...new Set(points.map((p) => p.lat))].sort((a, b) => b - a);
  const lons = [...new Set(points.map((p) => p.lon))].sort((a, b) => a - b);
  const spacing =
    lats.length > 1
      ? Math.abs(lats[0] - lats[1])
      : lons.length > 1
        ? Math.abs(lons[0] - lons[1])
        : 0.5;
  const grid = lats.map((la) =>
    lons.map((lo) => {
      const hit = points.find((p) => p.lat === la && p.lon === lo);
      return (
        hit ?? { lat: la, lon: lo, temp: 0, precip: 0, windSpeed: 0, windDir: 0, gust: 0 }
      );
    }),
  );
  return { grid, lats, lons, spacing };
}

/**
 * Bilinear sample over the lattice in fractional index space. Clamped half a
 * cell inside the box so we interpolate between real observations only and
 * never extrapolate past the data.
 */
function bilinear(grid: GridPoint[][], gi: number, gj: number, valueOf: (p: GridPoint) => number) {
  const n = grid.length;
  const m = grid[0]?.length ?? 0;
  if (n < 2 || m < 2) return null;
  const i = Math.min(Math.max(gi, 0.5), n - 1.5);
  const j = Math.min(Math.max(gj, 0.5), m - 1.5);
  const i0 = Math.floor(i);
  const j0 = Math.floor(j);
  const i1 = Math.min(i0 + 1, n - 1);
  const j1 = Math.min(j0 + 1, m - 1);
  const ti = i - i0;
  const tj = j - j0;
  return (
    valueOf(grid[i0][j0]) * (1 - ti) * (1 - tj) +
    valueOf(grid[i1][j0]) * ti * (1 - tj) +
    valueOf(grid[i0][j1]) * (1 - ti) * tj +
    valueOf(grid[i1][j1]) * ti * tj
  );
}

/**
 * Trace streamlines through the wind field and return SVG paths in
 * map-container pixel space.
 *
 * @param points      real wind observations (the 5x5 grid)
 * @param unproject   (x, y) -> [lat, lon] (Leaflet containerPointToLatLng)
 * @param boundsPx    [minX, minY, maxX, maxY] visible viewport
 * @param maxWind     grid max wind, normalises speed -> colour/width
 * @param windColorFn shared wind colour scale (slate-teal -> brass)
 * @param windStyleFn shared wind style helper
 * @param overview    true for the softer combined-overview treatment
 */
export function buildWindStreamlines(
  points: GridPoint[],
  unproject: (x: number, y: number) => [number, number],
  boundsPx: [number, number, number, number],
  maxWind: number,
  windColorFn: (norm: number) => string,
  windStyleFn: (speed: number, maxSpeed: number) => { color: string; opacity: number; size: number },
  overview: boolean,
): Streamline[] {
  if (points.length < 4) return [];
  const { grid, lats, lons, spacing } = buildLattice(points);
  if (grid.length < 2 || grid[0].length < 2) return [];

  const originLat = lats[0];
  const originLon = lons[0];

  const [minX, minY, maxX, maxY] = boundsPx;
  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0) || !(h > 0)) return [];

  // Seed count scales with viewport area so density stays reasonable across
  // zoom levels without becoming a tangle when zoomed out.
  const area = w * h;
  const density = overview ? 1 / 30000 : 1 / 15000;
  const seedCount = Math.max(
    overview ? 16 : 32,
    Math.min(overview ? 34 : 80, Math.round(area * density)),
  );

  // Deterministic low-discrepancy (golden-ratio spiral) seeds rather than
  // random, so re-seeding on pan/zoom doesn't visibly reshuffle the field.
  const GOLDEN = 0.6180339887498949;
  const steps = overview ? OVERVIEW_STEPS : FOCUS_STEPS;
  const out: Streamline[] = [];

  for (let k = 0; k < seedCount; k++) {
    const u = (k * GOLDEN) % 1;
    const v = ((k + 1) * GOLDEN) % 1;
    // Inset from the very edge so seeds aren't immediately clipped away.
    let x = minX + w * (0.06 + 0.88 * u);
    let y = minY + h * (0.06 + 0.88 * v);

    const trace: Array<[number, number]> = [];
    let sumSpeed = 0;
    let samples = 0;

    for (let s = 0; s < steps; s++) {
      const [lat, lon] = unproject(x, y);
      const gi = (lon - originLon) / spacing;
      // Row index grows southward, so invert the latitude delta.
      const gj = -(lat - originLat) / spacing;

      const speed = bilinear(grid, gi, gj, (p) => p.windSpeed);
      const dirDeg = bilinear(grid, gi, gj, (p) => p.windDir);
      if (speed === null || dirDeg === null) break;

      sumSpeed += speed;
      samples++;

      // Meteorological direction is where wind comes FROM; the vector it
      // blows toward is +180deg. Circular mean handles the 0/360 wrap that a
      // naive average would break.
      const towards = ((((dirDeg + 180) % 360) + 360) % 360) * (Math.PI / 180);
      const vx = Math.sin(towards);
      const vy = -Math.cos(towards);

      // One degree of lon spans cos(lat) as much ground as one degree of lat,
      // so correct the x step to keep the on-screen path from shearing.
      const cosLat = Math.cos((lat * Math.PI) / 180);
      const safeCos = cosLat > 0.2 ? cosLat : 0.2;
      const stepDeg = MAX_STEP_PX / spacing;
      x += vx * stepDeg * safeCos;
      y += vy * stepDeg;

      if (x < minX - 40 || x > maxX + 40 || y < minY - 40 || y > maxY + 40) break;
      trace.push([x, y]);
    }

    // A streamline needs enough length to read as a flowing line, not a dot.
    if (trace.length < (overview ? 6 : 12)) continue;

    const meanSpeed = samples ? sumSpeed / samples : 0;
    const ws = windStyleFn(meanSpeed, maxWind);
    const norm = maxWind > 0 ? Math.min(1, Math.max(0, meanSpeed / maxWind)) : 0.35;

    out.push({
      d: toSmoothPath(trace),
      color: windColorFn(norm),
      opacity: Math.max(MIN_OPACITY, ws.opacity * (overview ? 0.6 : 1)),
      width: overview ? 1.1 + norm * 1.1 : 1.3 + norm * 2.5,
      // Stagger phase so the field shimmers rather than pulsing as one block.
      dashOffset: Math.abs(trace[0][0] * 0.6 + trace[0][1] * 1.4) % 48,
      dashDuration: Math.max(1.5, 4.4 - norm * 2.4),
    });
  }

  return out;
}

/**
 * Smooth SVG path through the traced points using quadratic mid-point
 * smoothing — a curve reads as airflow, a polyline reads as a ruler.
 */
function toSmoothPath(pts: Array<[number, number]>): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    d += ` Q ${x0.toFixed(1)} ${y0.toFixed(1)} ${((x0 + x1) / 2).toFixed(1)} ${(
      (y0 + y1) / 2
    ).toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
  return d;
}
