// Turns Natural Earth's 110m land polygons into a small file the app can embed,
// so the map needs no tile server and works offline.
//
//   usage: node scripts/build-coastline.mjs [path/to/ne_110m_land.geojson]
//
// Natural Earth is public domain, so this is the one dataset in the project
// with no attribution obligation at all. Output is src/coastline.json: an array
// of rings, each a flat [lng, lat, lng, lat, ...] array at 2dp - about 20m of
// resolution at this latitude, far finer than a 1300px world map can show.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ?? '/tmp/ne_land.geojson';
const geo = JSON.parse(readFileSync(source, 'utf8'));

const rings = [];
let dropped = 0;

for (const feature of geo.features) {
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;

  for (const polygon of polygons) {
    for (const ring of polygon) {
      const flat = [];
      let lastLng = NaN;
      let lastLat = NaN;
      for (const [lng, lat] of ring) {
        const x = Math.round(lng * 100) / 100;
        const y = Math.round(lat * 100) / 100;
        if (x === lastLng && y === lastLat) continue; // collapsed by rounding
        flat.push(x, y);
        lastLng = x;
        lastLat = y;
      }
      // A ring needs three distinct points to enclose anything.
      if (flat.length >= 6) rings.push(flat);
      else dropped++;
    }
  }
}

const out = join(ROOT, 'src', 'coastline.json');
writeFileSync(out, JSON.stringify(rings));

const points = rings.reduce((n, r) => n + r.length / 2, 0);
console.log(`${rings.length} rings, ${points} points${dropped ? `, ${dropped} dropped` : ''}`);
console.log(`wrote ${out}`);
