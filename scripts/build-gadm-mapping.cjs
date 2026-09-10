// Builds a mapping: GADM GID_2 -> our district id
// Output: public/data/gadm-mapping.json
// Run: node scripts/build-gadm-mapping.cjs

const fs = require('fs');
const path = require('path');

const gadm = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/geojson/gadm_mys_2.geojson'), 'utf-8'));
const ours = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/data/districts.json'), 'utf-8'));

// Remove spaces/hyphens/dots, lowercase
const norm = s => s.toLowerCase().replace(/[\s\-'.]/g, '');

// GADM state name → our state name (normalised)
const STATE_ALIAS = {
  'negerisembilan': 'negerisembilan',
  'pulaupinang':    'pulaupinang',
  'kualalumpur':    'wpkualalumpur',
  'labuan':         'wplabuan',
  'putrajaya':      'wputrajaya',
  'trengganu':      'terengganu',
};
const normState = s => {
  const n = norm(s);
  return STATE_ALIAS[n] || n;
};

// GADM district name → our district name (normalised) — spelling fixes
const DIST_ALIAS = {
  'johorbaharu':    'johorbahru',      // -aru vs -ru
  'keluang':        'kluang',          // different spelling
  'kulaijaya':      'kulai',           // GADM uses longer form
  'ledang':         'tangkak',         // district renamed 2008
  'pasirputih':     'pasirputeh',      // -ih vs -eh
  'larutandmatang': 'larutdanmatang',  // "and" vs "dan"
  'meradong':       'maradong',        // spelling
  'hululangat':     'ululangat',       // hulu vs ulu
  'huluselangor':   'uluselangor',
  // Federal territories: GADM NAME_2 matches NAME_1 (e.g. "KualaLumpur"),
  // but our district name includes "W.P." prefix
  'kualalumpur':    'wpkualalumpur',
  'labuan':         'wplabuan',
  'putrajaya':      'wputrajaya',
};
const normDist = s => {
  const n = norm(s);
  return DIST_ALIAS[n] || n;
};

// Index our districts by normalised state+name
const ourIndex = new Map();
for (const d of ours) {
  const key = normState(d.state) + '|' + norm(d.name);
  ourIndex.set(key, d.id);
}

const mapping = {}; // GID_2 -> our district id
const unmatched = [];

for (const f of gadm.features) {
  const p = f.properties;
  const stateKey = normState(p.NAME_1);
  const distKey  = normDist(p.NAME_2);
  const key = stateKey + '|' + distKey;
  const id = ourIndex.get(key);
  if (id) {
    mapping[p.GID_2] = id;
  } else {
    unmatched.push({ gid: p.GID_2, name1: p.NAME_1, name2: p.NAME_2, key });
  }
}

// Putrajaya: "W.P. Putrajaya" normalises to "wpputrajaya" (double-p) while
// GADM's "Putrajaya" → "wputrajaya" — hard-wire the one-off match.
const pjGadm = gadm.features.find(f => f.properties.NAME_1 === 'Putrajaya');
const pjOurs = ours.find(d => d.state === 'W.P. Putrajaya');
if (pjGadm && pjOurs && !mapping[pjGadm.properties.GID_2]) {
  mapping[pjGadm.properties.GID_2] = pjOurs.id;
}

const unmatchedOurs = ours.filter(d => !Object.values(mapping).includes(d.id))
  .map(d => `${d.state}/${d.name}`);

fs.mkdirSync(path.join(__dirname, '../public/data'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '../public/data/gadm-mapping.json'), JSON.stringify(mapping));

console.log(`Matched: ${Object.keys(mapping).length} / ${gadm.features.length} GADM features`);
console.log('GADM unmatched:', unmatched.map(u => `${u.name1}/${u.name2}`));
console.log('Our districts without GADM shape:', unmatchedOurs);
