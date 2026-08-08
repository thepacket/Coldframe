// Where the plants actually grew, coloured by what they carry at one site.
//
// The sorted matrix is an abstraction of a cline; this is the cline itself. No
// tile server - Natural Earth land polygons are embedded at build time, so the
// map works offline and adds no third-party request.

import coastline from './coastline.json';
import type { Accession } from './types';
import { css, type Palette } from './theme';

/**
 * Native range. Arabidopsis in North America is introduced - those accessions
 * carry European genotypes without having had time to adapt locally, so
 * plotting them alongside the native range would invite a wrong reading. They
 * are counted and reported instead of drawn.
 *
 * The southern edge also drops exactly one accession, Cvi-0 from Cape Verde at
 * 15N. Framing for it would spend 40% of the map on empty ocean and Sahara.
 */
const VIEW = { lngMin: -28, lngMax: 80, latMin: 27, latMax: 70 };
const MID_LAT_SCALE = Math.cos((((VIEW.latMin + VIEW.latMax) / 2) * Math.PI) / 180);

export const mapAspect = ((VIEW.lngMax - VIEW.lngMin) * MID_LAT_SCALE) / (VIEW.latMax - VIEW.latMin);

export interface MapPoint {
  accession: Accession;
  x: number;
  y: number;
  genotype: string;
}

export interface MapResult {
  points: MapPoint[];
  /** In the panel but off this map - the introduced range, mostly. */
  offMap: number;
}

const project = (lng: number, lat: number, w: number, h: number) => ({
  x: ((lng - VIEW.lngMin) / (VIEW.lngMax - VIEW.lngMin)) * w,
  y: ((VIEW.latMax - lat) / (VIEW.latMax - VIEW.latMin)) * h,
});

export function drawMap(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: Palette,
  accessions: Accession[],
  genotypeRow: string | undefined,
): MapResult {
  ctx.clearRect(0, 0, w, h);

  // Graticule every 10 degrees, barely there - enough to read the projection.
  ctx.strokeStyle = p.rule;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let lng = Math.ceil(VIEW.lngMin / 10) * 10; lng <= VIEW.lngMax; lng += 10) {
    const { x } = project(lng, 0, w, h);
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let lat = Math.ceil(VIEW.latMin / 10) * 10; lat <= VIEW.latMax; lat += 10) {
    const { y } = project(0, lat, w, h);
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Land. Filled faintly so the points read as figure against ground.
  ctx.fillStyle = css(p.land);
  ctx.strokeStyle = p.rule;
  ctx.lineWidth = 0.6;
  for (const ring of coastline as number[][]) {
    ctx.beginPath();
    for (let i = 0; i < ring.length; i += 2) {
      const { x, y } = project(ring[i] as number, ring[i + 1] as number, w, h);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  const points: MapPoint[] = [];
  let offMap = 0;

  accessions.forEach((accession, i) => {
    if (accession.lat === null || accession.lng === null) return;
    if (
      accession.lng < VIEW.lngMin || accession.lng > VIEW.lngMax ||
      accession.lat < VIEW.latMin || accession.lat > VIEW.latMax
    ) {
      offMap++;
      return;
    }
    const { x, y } = project(accession.lng, accession.lat, w, h);
    points.push({ accession, x, y, genotype: genotypeRow?.[i] ?? '.' });
  });

  // Reference last-but-one and alternate last, so the rarer allele is never
  // buried under the commoner one where collections overlap.
  const order = ['.', '0', '1', '2'];
  const colorFor: Record<string, string> = {
    '.': css(p.gtMissing),
    '0': css(p.gtRef),
    '1': css(p.gtHet),
    '2': css(p.gtAlt),
  };

  ctx.lineWidth = 0.7;
  ctx.strokeStyle = p.panel;
  for (const g of order) {
    ctx.fillStyle = colorFor[g] as string;
    for (const pt of points) {
      if (pt.genotype !== g) continue;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, g === '0' || g === '.' ? 2.9 : 3.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  return { points, offMap };
}

/** Nearest point within `radius` px, or null. */
export function pickPoint(points: MapPoint[], x: number, y: number, radius = 7): MapPoint | null {
  let best: MapPoint | null = null;
  let bestD = radius * radius;
  for (const pt of points) {
    const d = (pt.x - x) ** 2 + (pt.y - y) ** 2;
    if (d <= bestD) { bestD = d; best = pt; }
  }
  return best;
}
