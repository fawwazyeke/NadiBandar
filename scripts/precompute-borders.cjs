// Pre-computes state border polylines from districts.geojson.
// Finds all edges shared between districts in different states, then chains
// those individual 2-point segments into connected polylines so each state
// border renders as a continuous line with proper joints (not disconnected dashes).
// Output: public/data/state-borders.json  — loaded by MapView at runtime.
// Run once: node scripts/precompute-borders.cjs

const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const path = require('path');

const geojson = JSON.parse(
  readFileSync(path.join(__dirname, '../public/geojson/districts.geojson'), 'utf-8')
);

function edgeKey(a, b) {
  const pa = a.join(','), pb = b.join(',');
  return pa < pb ? `${pa}|${pb}` : `${pb}|${pa}`;
}

// ── 1. Collect cross-state edges ─────────────────────────────────────────────
const edgeMap = new Map();

for (const feature of geojson.features) {
  const state = feature.properties.state;
  const geom = feature.geometry;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    const ring = poly[0];
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      const key = edgeKey(a, b);
      if (!edgeMap.has(key)) {
        // Flip GeoJSON [lng, lat] → Leaflet [lat, lng]
        edgeMap.set(key, {
          states: new Set(),
          // canonical direction: a before b (key is sorted, so re-derive from a,b)
          a: [parseFloat(a[1].toFixed(6)), parseFloat(a[0].toFixed(6))],
          b: [parseFloat(b[1].toFixed(6)), parseFloat(b[0].toFixed(6))],
        });
      }
      edgeMap.get(key).states.add(state);
    }
  }
}

const rawSegments = [];
for (const { states, a, b } of edgeMap.values()) {
  if (states.size > 1) rawSegments.push([a, b]);
}

// ── 2. Chain segments into connected polylines ────────────────────────────────
// Build adjacency: ptKey → [{neighborPtKey, neighborPt, segIdx}]
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

  // Extend forward from endPt
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

  // Extend backward from startPt
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

  const fullChain = [...back.reverse(), ...chain];
  chains.push(fullChain);
}

mkdirSync(path.join(__dirname, '../public/data'), { recursive: true });
writeFileSync(
  path.join(__dirname, '../public/data/state-borders.json'),
  JSON.stringify({ stateBorders: chains })
);

console.log(`Raw cross-state segments: ${rawSegments.length}`);
console.log(`Connected chains: ${chains.length}`);
console.log(`Saved to public/data/state-borders.json`);
