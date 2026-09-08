#!/usr/bin/env python3
"""
Build mukims.json: mukim-level population (Census 2020) + MOH facility counts.
Run from the project root: python3 scripts/build_mukim_data.py
"""
import json, csv, re, math, sys
from pathlib import Path
from shapely.geometry import shape, Point

ROOT = Path(__file__).parent.parent
EXCEL_PATH = Path.home() / "Downloads/JADUAL BANCI MALAYSIA 2020 MUKIM BANDAR PEKAN.xlsx"
GEO_PATH   = ROOT / "public/geojson/mukim_simplified.geojson"
FAC_PATH   = Path("/tmp/facilities_master.csv")
OUT_PATH   = ROOT / "public/data/mukims.json"

# ── 1. Parse Census 2020 mukim population from Excel ─────────────────────────
print("Parsing Census 2020 Excel …")
import openpyxl

wb = openpyxl.load_workbook(str(EXCEL_PATH), read_only=True, data_only=True)
target_sheets = [s for s in wb.sheetnames if re.match(r'\d+\.3', s.split()[0])]

STATE_MAP = {
    'JOHOR': 'Johor', 'KEDAH': 'Kedah', 'KELANTAN': 'Kelantan',
    'MELAKA': 'Melaka', 'NEGERI SEMBILAN': 'Negeri Sembilan',
    'PAHANG': 'Pahang', 'P.PINANG': 'Pulau Pinang', 'PULAU PINANG': 'Pulau Pinang',
    'PERAK': 'Perak', 'PERLIS': 'Perlis', 'SELANGOR': 'Selangor',
    'TERENGGANU': 'Terengganu', 'SABAH': 'Sabah', 'SARAWAK': 'Sarawak',
    'W.P KUALA LUMPUR': 'W.P. Kuala Lumpur', 'WP KUALA LUMPUR': 'W.P. Kuala Lumpur',
    'W.P LABUAN': 'W.P. Labuan', 'WP LABUAN': 'W.P. Labuan',
    'W.P PUTRAJAYA': 'W.P. Putrajaya', 'WP PUTRAJAYA': 'W.P. Putrajaya',
}
AREA_PREFIXES = ('MUKIM ', 'BANDAR ', 'PEKAN ')

def is_state_row(val):
    v = str(val).upper().strip()
    for k in STATE_MAP:
        if v == k or v == k.replace('.', ''):
            return STATE_MAP[k]
    return None

def is_area_row(val):
    return any(str(val).upper().strip().startswith(p) for p in AREA_PREFIXES)

def safe_int(v):
    try: return int(v) if isinstance(v, (int, float)) else 0
    except: return 0

pop_by_name = {}   # upper mukim name → dict
current_state = current_district = ''

for sheet_name in target_sheets:
    ws = wb[sheet_name]
    for row in ws.iter_rows(values_only=True):
        col_a = str(row[0]).strip() if row[0] else ''
        if not col_a:
            continue
        state_hit = is_state_row(col_a)
        if state_hit and all(x is None for x in row[1:5]):
            current_state = state_hit
            continue
        if col_a.startswith('Jadual') or col_a.startswith('Table') or \
           col_a.startswith('Daerah') or col_a.startswith('Kumpulan'):
            continue
        if is_area_row(col_a) and current_state:
            age_0_14  = safe_int(row[4])
            age_15_64 = safe_int(row[6])
            age_65p   = safe_int(row[8])
            pop_2020  = age_0_14 + age_15_64 + age_65p
            pop_2010  = safe_int(row[1])
            if pop_2020 > 0:
                key = col_a.upper().strip()
                pop_by_name[key] = {
                    'state': current_state,
                    'district': current_district,
                    'population': pop_2020,
                    'population_2010': pop_2010,
                    'age_0_14': age_0_14,
                    'age_15_64': age_15_64,
                    'age_65plus': age_65p,
                }
        elif not is_area_row(col_a) and not state_hit and current_state:
            if row[4] is None:
                current_district = col_a

print(f"  → {len(pop_by_name)} mukim population records")

# ── 2. Load mukim GeoJSON and compute areas ───────────────────────────────────
print("Loading mukim GeoJSON …")
with open(GEO_PATH) as f:
    geo = json.load(f)

features = geo['features']
print(f"  → {len(features)} mukim polygons")

# ── 3. Load MOH facilities (health only: hospitals + clinics) ─────────────────
print("Loading MOH facilities …")
facilities = []
with open(FAC_PATH, encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        try:
            lat = float(row['LATITUD'])
            lon = float(row['LONGITUD'])
            if lat and lon and 0.5 < lat < 8.5 and 98 < lon < 120:
                facilities.append({
                    'lat': lat, 'lon': lon,
                    'kategori': row['KATEGORI_FASILITI'].strip().upper(),
                })
        except (ValueError, KeyError):
            pass
print(f"  → {len(facilities)} valid facilities")

# Convert to shapely Points
fac_points = [(Point(f['lon'], f['lat']), f['kategori']) for f in facilities]

# ── 4. Spatial join: assign each facility to a mukim polygon ─────────────────
print("Spatial join: facilities → mukims …")
mukim_fac_counts = {}   # shape_name → {hospitals, clinics, pharmacies}

for feat in features:
    name = feat['properties']['shapeName'].upper().strip()
    mukim_fac_counts[name] = {'hospitals': 0, 'clinics': 0, 'pharmacies': 0}

for feat in features:
    name = feat['properties']['shapeName'].upper().strip()
    try:
        poly = shape(feat['geometry'])
    except Exception:
        continue
    for pt, kategori in fac_points:
        if poly.contains(pt):
            if 'HOSPITAL' in kategori:
                mukim_fac_counts[name]['hospitals'] += 1
            elif 'KLINIK' in kategori or 'CLINIC' in kategori:
                mukim_fac_counts[name]['clinics'] += 1
            elif 'FARMASI' in kategori or 'PHARM' in kategori:
                mukim_fac_counts[name]['pharmacies'] += 1

total_fac = sum(sum(v.values()) for v in mukim_fac_counts.values())
print(f"  → {total_fac} facilities assigned")

# ── 5. Compute polygon areas (approximate km²) ───────────────────────────────
def approx_area_km2(geometry):
    """Rough spherical area from GeoJSON polygon coords."""
    try:
        poly = shape(geometry)
        # Use centroid latitude for metre-per-degree scaling
        c = poly.centroid
        lat_rad = math.radians(c.y)
        km_per_deg_lat = 111.32
        km_per_deg_lon = 111.32 * math.cos(lat_rad)
        area_deg2 = poly.area
        return area_deg2 * km_per_deg_lat * km_per_deg_lon
    except:
        return 0

# ── 6. Build output records ───────────────────────────────────────────────────
print("Building mukims.json …")
records = []

for feat in features:
    name_raw = feat['properties']['shapeName'].strip()
    name_upper = name_raw.upper()

    pop_data = pop_by_name.get(name_upper, {})
    fac_data = mukim_fac_counts.get(name_upper, {})

    population = pop_data.get('population', 0)
    area_km2   = round(approx_area_km2(feat['geometry']), 2)

    # Centroid
    try:
        c = shape(feat['geometry']).centroid
        centroid = [round(c.y, 5), round(c.x, 5)]
    except:
        centroid = [0, 0]

    records.append({
        'id':           name_upper,
        'name':         name_raw,
        'state':        pop_data.get('state', ''),
        'district':     pop_data.get('district', ''),
        'population':   population,
        'population_2010': pop_data.get('population_2010', 0),
        'area_km2':     area_km2,
        'density':      round(population / area_km2, 1) if area_km2 > 0 and population > 0 else 0,
        'age_0_14':     pop_data.get('age_0_14', 0),
        'age_15_64':    pop_data.get('age_15_64', 0),
        'age_65plus':   pop_data.get('age_65plus', 0),
        'centroid':     centroid,
        'hospitals':    fac_data.get('hospitals', 0),
        'clinics':      fac_data.get('clinics', 0),
        'pharmacies':   fac_data.get('pharmacies', 0),
        # Fields for scoring compatibility (reuse clinics as "health" proxy)
        'health_facilities': fac_data.get('hospitals', 0) + fac_data.get('clinics', 0),
    })

matched = sum(1 for r in records if r['population'] > 0)
print(f"  → {len(records)} total mukims, {matched} with population data")

with open(OUT_PATH, 'w') as f:
    json.dump(records, f, separators=(',', ':'))

size_kb = OUT_PATH.stat().st_size // 1024
print(f"  → Saved {OUT_PATH} ({size_kb} KB)")
print("Done.")
