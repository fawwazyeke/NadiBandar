// Pre-computes interior district border polylines from districts.geojson.
// Finds all edges shared between districts in the SAME state (interior borders)
// and chains them into connected polylines.
// Output: public/data/district-borders.json — loaded by MapView at runtime.
// Run once: node scripts/precompute-district-borders.cjs

const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const path = require('path');

const geojson = JSON.parse(
  readFileSync(path.join(__dirname, '../public/geojson/districts.geojson'), 'utf-8')
);

function round4(v) { return Math.round(v * 10000) / 10000; }

function edgeKey(a, b) {
  const ra = [round4(a[0]), round4(a[1])];
  const rb = [round4(b[0]), round4(b[1])];
  const pa = ra.join(','), pb = rb.join(',');
  return pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
}

// ── 1. Collect all edges with their district + state membership ───────────────
const edgeMap = new Map();

for (const feature of geojson.features) {
  const state = feature.properties.state;
  const district = feature.properties.district || feature.properties.name;
  const geom = feature.geometry;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    const ring = poly[0];
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      const key = edgeKey(a, b);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          districts: new Set(),
          states: new Set(),
          a: [parseFloat(a[1].toFixed(6)), parseFloat(a[0].toFixed(6))],
          b: [parseFloat(b[1].toFixed(6)), parseFloat(b[0].toFixed(6))],
        });
      }
      const entry = edgeMap.get(key);
      entry.districts.add(`${state}|${district}`);
      entry.states.add(state);
    }
  }
}

// Interior district borders: shared by 2+ districts, same state (1 state only)
const rawSegments = [];
for (const { districts, states, a, b } of edgeMap.values()) {
  if (districts.size > 1 && states.size === 1) rawSegments.push([a, b]);
}

// ── 2. Chain segments into connected polylines ────────────────────────────────
const ptKey = ([lat, lng]) => `${lat},${lng}`;
const adj = new Map();
const addAdj = (fromKey, toPt, idx) => {
  if (!adj.has(fromKey)) adj.set(fromKey, []);
  adj.get(fromKey).push({ pt: toPt, key: ptKey(toPt), idx });
};

rawSegments.forEach(([a, b], i) => {
  addAdj(ptKey(a), b, i);
  addAdj(ptKey(b), a, i);
});

const used = new Set();
const chains = [];

for (let i = 0; i < rawSegments.length; i++) {
  if (used.has(i)) continue;
  used.add(i);

  const [startPt, endPt] = rawSegments[i];
  const chain = [startPt, endPt];

  let cur = endPt;
  let curKey = ptKey(cur);
  while (true) {
    const neighbors = adj.get(curKey) || [];
    const next = neighbors.find(n => !used.has(n.idx));
    if (!next) break;
    used.add(next.idx);
    chain.push(next.pt);
    cur = next.pt;
    curKey = next.key;
  }

  cur = startPt;
  curKey = ptKey(cur);
  const back = [];
  while (true) {
    const neighbors = adj.get(curKey) || [];
    const next = neighbors.find(n => !used.has(n.idx));
    if (!next) break;
    used.add(next.idx);
    back.push(next.pt);
    cur = next.pt;
    curKey = next.key;
  }

  chains.push([...back.reverse(), ...chain]);
}

mkdirSync(path.join(__dirname, '../public/data'), { recursive: true });
writeFileSync(
  path.join(__dirname, '../public/data/district-borders.json'),
  JSON.stringify({ districtBorders: chains })
);

console.log(`Interior district segments: ${rawSegments.length}`);
console.log(`Connected chains: ${chains.length}`);
console.log(`Saved to public/data/district-borders.json`);
