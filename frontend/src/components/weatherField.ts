import {
  GridPoint,
  MEANINGFUL_RAIN,
  WeatherRegion,
  colorToRgba,
  rainColor,
  regionalize,
  tempColor,
} from './mapData';

export interface FieldSpec {
  points: GridPoint[];
  mode: 'temperature' | 'precipitation';
  /** Render the colour regions (default true; false renders rings only). */
  field?: boolean;
  /** Faint concentric query rings drawn above the field (Weather Map only). */
  rings?: { lat: number; lon: number; radiiKm: number[] };
}

/** Map events that should trigger a re-projection of the weather field. */
const MAP_EVENTS = 'move zoom moveend zoomend resize';

const RING_COLOR = '#2E6E7D';
const EARTH_R = 6378137;

/**
 * Radial-gradient alpha steps shared by every weather region (fraction ->
 * alpha; the outer stops always fade to the region's OWN colour at alpha 0,
 * never toward black). 0.5 at the core keeps the base map readable.
 */
const GRADIENT_STOPS: [number, number][] = [
  [0, 0.5],
  [0.45, 0.32],
  [0.72, 0.14],
  [1, 0],
];

/**
 * Shared weather-field renderer for the Weather Map (Temperature + Rain)
 * and the Radar page (Precipitation). ONE implementation for both views so
 * the design language cannot drift apart.
 *
 * The 5x5 observation grid is first aggregated with regionalize() into a few
 * broad weather regions anchored on spatial clusters of the real values; then
 * each region is painted as ONE large translucent soft ellipse (rotated,
 * slightly varied aspect, radial gradient fading to the region's own colour).
 * Precipitation cells at or below MEANINGFUL_RAIN are dropped before
 * aggregation, so dry areas render no field at all and the basemap stays
 * clean. Overlaps use normal alpha compositing (source-over), so neighbouring
 * zones blend into broad continuous weather masses instead of a per-cell
 * point heatmap or a single dark blob. The fade is the only edge treatment:
 * no strokes, no fills.
 *
 * The canvas lives in Leaflet's overlay pane (above tiles, below the
 * location dot and wind arrows) and re-projects on pan/zoom/resize. The
 * query point itself is never part of the field: it is drawn separately as
 * the location dot + reading tag + concentric rings.
 */
export class WeatherField {
  private canvas: HTMLCanvasElement | null = null;
  private spec: FieldSpec | null = null;
  private opacity = 1;
  private raf = 0;

  private onChange = () => this.schedule();

  constructor(private map: any) {
    map.on(MAP_EVENTS, this.onChange);
  }

  /** Render a new field (replacing whatever was on screen). */
  set(spec: FieldSpec): void {
    this.ensureCanvas();
    this.spec = spec;
    this.schedule();
  }

  /** Overlay opacity (0.1..1); redraws with the current spec. */
  setOpacity(value: number): void {
    this.opacity = Math.max(0.1, Math.min(1, value));
    this.schedule();
  }

  /** Hide the field and remove the overlay canvas entirely. */
  clear(): void {
    this.spec = null;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.canvas && this.canvas.parentElement) {
      this.canvas.parentElement.removeChild(this.canvas);
    }
    this.canvas = null;
  }

  /** Detach map listeners and remove the overlay canvas. */
  dispose(): void {
    this.map.off(MAP_EVENTS, this.onChange);
    this.clear();
  }

  private ensureCanvas(): void {
    if (this.canvas) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'weather-field-canvas';
    this.map.getPanes().overlayPane.appendChild(canvas);
    this.canvas = canvas;
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private draw(): void {
    const { canvas, spec, map } = this;
    if (!canvas || !spec) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = size.x;
    const h = size.y;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (spec.field !== false && spec.points.length) {
      // Normal alpha compositing: overlapping regions blend honestly instead
      // of any single zone dominating. 'screen' is deliberately NOT used.
      // Precipitation is only painted where it is actually meaningful: cells
      // at or below MEANINGFUL_RAIN are dropped up front, so dry areas keep
      // the basemap clean (same threshold the views gate the whole frame on).
      const pts =
        spec.mode === 'precipitation'
          ? spec.points.filter((p) => p.precip > MEANINGFUL_RAIN)
          : spec.points;
      if (pts.length) {
        const valueOf = (p: GridPoint) =>
          spec.mode === 'temperature' ? p.temp : p.precip;
        const regions = regionalize(pts, valueOf);
        for (const r of regions) {
          const color = spec.mode === 'temperature' ? tempColor(r.value) : rainColor(r.value);
          this.region(ctx, r, color);
        }
      }
    }
    if (spec.rings) this.rings(ctx, spec.rings);
  }

  /**
   * One large soft elliptical weather region anchored on a cluster centroid.
   * Reach comes from the actual cluster spacing (see regionalize()), so the
   * region is a broad meteorological zone - never a point blob and never a
   * hard-edged cell. Aspect and tilt vary restrictively and deterministically
   * per centroid, so neighbouring regions never read as a repetitive grid.
   * The gradient fades to the region's own colour at the edge (no stroke).
   */
  private region(ctx: CanvasRenderingContext2D, r: WeatherRegion, color: string): void {
    const map = this.map;
    const pt = map.latLngToContainerPoint([r.lat, r.lon]);
    const origin = map.project([r.lat, r.lon]);
    const north = map.project([r.lat + r.ry, r.lon]);
    const east = map.project([r.lat, r.lon + r.rx]);
    const px = Math.max(4, Math.abs(east.x - origin.x));
    const py = Math.max(4, Math.abs(origin.y - north.y));
    const o = this.opacity;
    ctx.save();
    ctx.translate(pt.x, pt.y);
    ctx.rotate(r.rot);
    ctx.scale(px, py);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [stop, alpha] of GRADIENT_STOPS) {
      grad.addColorStop(stop, colorToRgba(color, alpha * o));
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Faint concentric rings around the query point, above the field. */
  private rings(ctx: CanvasRenderingContext2D, rings: NonNullable<FieldSpec['rings']>): void {
    const map = this.map;
    const pt = map.latLngToContainerPoint([rings.lat, rings.lon]);
    const zoom = map.getZoom();
    const metersPerPx =
      (2 * Math.PI * EARTH_R * Math.cos((rings.lat * Math.PI) / 180)) / (256 * 2 ** zoom);
    ctx.save();
    ctx.strokeStyle = colorToRgba(RING_COLOR, 0.3);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const km of rings.radiiKm) {
      const r = (km * 1000) / metersPerPx;
      ctx.moveTo(pt.x + r, pt.y);
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  }
}