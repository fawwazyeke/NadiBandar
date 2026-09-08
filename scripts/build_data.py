#!/usr/bin/env python3
"""
Data pipeline for NadiBandar.
Sources:
  - District boundaries: DOSM data-open (administrative_2_district.geojson)
  - Population/census:   DOSM data-open (census_district.csv) - 2020 census
  - Income/poverty:      data.gov.my API (hies_district) - 2022 + 2024
  - Crime:               data.gov.my API (crime_district) - 2016-2023
  - Facilities:          OSM Overpass API (hospitals, clinics, schools, police, markets, transport)
Output: ../public/data/districts.json
"""

import json, csv, time, sys, math
from pathlib import Path
from shapely.geometry import shape, Point, mapping
from shapely.ops import unary_union
import requests

PYTHON = "/Library/Frameworks/Python.framework/Versions/3.10/bin/python3"

SCRATCHPAD = Path("/private/tmp/claude-501/-Users-fawwazhaziq-VSCode-NadiBandar/4f5e9789-3893-4ceb-9949-db1489b4fd21/scratchpad")
OUT_DIR = Path(__file__).parent.parent / "public" / "data"
OUT_DIR.mkdir(parents=True, exist_ok=True)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
DOSM_API = "https://api.data.gov.my/data-catalogue"

# ── 1. Load district boundaries ─────────────────────────────────────────────

print("Loading district boundaries...")
geojson_path = SCRATCHPAD / "administrative_2_district.geojson"
with open(geojson_path) as f:
    geojson = json.load(f)

districts_raw = {}
for feat in geojson["features"]:
    props = feat["properties"]
    # DOSM geojson uses 'district' and 'state' fields
    name = props.get("district") or props.get("name") or props.get("shapeName") or ""
    state = props.get("state") or props.get("state_name") or ""
    code = props.get("code_district") or props.get("code_state_district") or ""
    if not name:
        continue
    key = f"{state}|{name}"
    districts_raw[key] = {
        "name": name,
        "state": state,
        "code": code,
        "geometry": feat["geometry"],
        "shape": shape(feat["geometry"]),
        "centroid": None,
    }

print(f"  Loaded {len(districts_raw)} districts")
# Show sample
for k in list(districts_raw.keys())[:3]:
    print(f"  Sample: {k}")

# ── 2. Load census data (population, area) ──────────────────────────────────

print("\nLoading census data...")
census = {}  # key: "state|district" -> dict
census_path = SCRATCHPAD / "census_district.csv"
with open(census_path, encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    for row in reader:
        year = row.get("year", "").strip()
        if year != "2020":
            continue
        state = row["state"].strip()
        district = row["district"].strip()
        key = f"{state}|{district}"
        try:
            census[key] = {
                "population": int(float(row.get("population_total", 0) or 0)),
                "area_km2": float(row.get("area_km2", 0) or 0),
                "growth_rate": float(row.get("population_growth", 0) or 0),
                "households": int(float(row.get("household_total", 0) or 0)),
                "household_size": float(row.get("household_size_avg", 0) or 0),
                "age_0_14": int(float(row.get("age_0_14", 0) or 0)),
                "age_15_64": int(float(row.get("age_15_64", 0) or 0)),
                "age_65_above": int(float(row.get("age_65_above", 0) or 0)),
                "urban": int(float(row.get("density_urban", 0) or 0)),
                "rural": int(float(row.get("density_rural", 0) or 0)),
            }
        except (ValueError, KeyError):
            pass

print(f"  Loaded {len(census)} district census rows (2020)")

# ── 3. Load HIES district data (poverty, income) ────────────────────────────

print("\nFetching HIES district data from data.gov.my...")
hies = {}
try:
    # Fetch all pages
    resp = requests.get(DOSM_API, params={"id": "hies_district", "limit": 2000}, timeout=30)
    rows = resp.json()
    for row in rows:
        year = str(row.get("date", ""))[:4]
        if year != "2022":  # use 2022 (most complete)
            continue
        state = row.get("state", "").strip()
        district = row.get("district", "").strip()
        key = f"{state}|{district}"
        hies[key] = {
            "poverty_rate": row.get("poverty", None),
            "gini": row.get("gini", None),
            "income_mean": row.get("income_mean", None),
            "income_median": row.get("income_median", None),
            "expenditure_mean": row.get("expenditure_mean", None),
        }
    print(f"  Loaded {len(hies)} HIES district rows (2022)")
except Exception as e:
    print(f"  WARN: {e}")

# ── 4. Load crime data ───────────────────────────────────────────────────────

print("\nFetching crime district data...")
crime = {}
try:
    resp = requests.get(DOSM_API, params={"id": "crime_district", "limit": 5000}, timeout=30)
    rows = resp.json()
    # Use latest year available, aggregate all categories
    year_crimes = {}
    for row in rows:
        year = str(row.get("date", ""))[:4]
        state = row.get("state", "").strip()
        district = row.get("district", "").strip()
        if district in ("All", ""):
            continue
        cat = row.get("category", "all")
        crimes = row.get("crimes", 0) or 0
        key = f"{state}|{district}|{year}"
        if cat == "all":
            year_crimes.setdefault(key, {})["total"] = crimes

    # Get latest year per district
    for key, val in year_crimes.items():
        parts = key.rsplit("|", 1)
        dk = parts[0]
        year = parts[1]
        if dk not in crime or year > crime[dk]["year"]:
            crime[dk] = {"crimes": val.get("total", 0), "year": year}

    print(f"  Loaded crime data for {len(crime)} districts")
except Exception as e:
    print(f"  WARN: {e}")

# ── 5. OSM Overpass — fetch all facilities in Malaysia ───────────────────────

print("\nFetching facilities from OSM Overpass (this takes ~2 min)...")

FACILITY_QUERIES = {
    "hospital": """
[out:json][timeout:120];
area["name"="Malaysia"]["boundary"="administrative"]["admin_level"="2"]->.my;
(
  node["amenity"="hospital"](area.my);
  way["amenity"="hospital"](area.my);
  node["amenity"="clinic"](area.my);
  way["amenity"="clinic"](area.my);
);
out center;
""",
    "school": """
[out:json][timeout:120];
area["name"="Malaysia"]["boundary"="administrative"]["admin_level"="2"]->.my;
(
  node["amenity"="school"](area.my);
  way["amenity"="school"](area.my);
  node["amenity"="university"](area.my);
  way["amenity"="university"](area.my);
  node["amenity"="college"](area.my);
  way["amenity"="college"](area.my);
);
out center;
""",
    "police": """
[out:json][timeout:60];
area["name"="Malaysia"]["boundary"="administrative"]["admin_level"="2"]->.my;
(
  node["amenity"="police"](area.my);
  way["amenity"="police"](area.my);
);
out center;
""",
    "market": """
[out:json][timeout:60];
area["name"="Malaysia"]["boundary"="administrative"]["admin_level"="2"]->.my;
(
  node["amenity"="marketplace"](area.my);
  way["amenity"="marketplace"](area.my);
  node["shop"="supermarket"](area.my);
  way["shop"="supermarket"](area.my);
  node["shop"="wet_market"](area.my);
);
out center;
""",
    "transport": """
[out:json][timeout:120];
area["name"="Malaysia"]["boundary"="administrative"]["admin_level"="2"]->.my;
(
  node["highway"="bus_stop"](area.my);
  node["railway"="station"](area.my);
  node["railway"="halt"](area.my);
  node["amenity"="bus_station"](area.my);
  way["amenity"="bus_station"](area.my);
);
out center;
""",
    "pharmacy": """
[out:json][timeout:60];
area["name"="Malaysia"]["boundary"="administrative"]["admin_level"="2"]->.my;
(
  node["amenity"="pharmacy"](area.my);
  way["amenity"="pharmacy"](area.my);
);
out center;
""",
}

osm_points = {}  # facility_type -> list of (lat, lon)

for ftype, query in FACILITY_QUERIES.items():
    print(f"  Querying {ftype}...")
    try:
        resp = requests.post(OVERPASS_URL, data={"data": query},
                             headers={"User-Agent": "NadiBandar/1.0"},
                             timeout=150)
        data = resp.json()
        pts = []
        for el in data.get("elements", []):
            lat = el.get("lat") or (el.get("center", {}) or {}).get("lat")
            lon = el.get("lon") or (el.get("center", {}) or {}).get("lon")
            if lat and lon:
                pts.append((float(lat), float(lon)))
        osm_points[ftype] = pts
        print(f"    {len(pts)} {ftype} points")
        time.sleep(3)  # be polite to Overpass
    except Exception as e:
        print(f"    WARN {ftype}: {e}")
        osm_points[ftype] = []

# ── 6. Spatial join — assign each OSM point to a district ───────────────────

print("\nSpatial join: assigning OSM points to districts...")

# Build list of (key, shapely_shape) for fast lookup
district_shapes = [(k, v["shape"]) for k, v in districts_raw.items()]

def assign_to_district(lat, lon):
    pt = Point(lon, lat)
    for key, shp in district_shapes:
        if shp.contains(pt):
            return key
    # fallback: nearest centroid
    best, best_d = None, float("inf")
    for key, shp in district_shapes:
        c = shp.centroid
        d = (c.x - lon)**2 + (c.y - lat)**2
        if d < best_d:
            best_d, best = d, key
    return best

# Count facilities per district
facility_counts = {}  # key -> {ftype: count}
for ftype, pts in osm_points.items():
    print(f"  Joining {len(pts)} {ftype} points...")
    for lat, lon in pts:
        key = assign_to_district(lat, lon)
        if key:
            facility_counts.setdefault(key, {})
            facility_counts[key][ftype] = facility_counts[key].get(ftype, 0) + 1

# ── 7. Name reconciliation (census ↔ boundaries ↔ HIES) ────────────────────

# The census uses DOSM district names, boundaries use DOSM names too
# Build a fuzzy match table
def normalize(s):
    return s.lower().strip().replace("-", " ").replace(".", "").replace("'", "")

census_keys = {normalize(k.split("|")[1]) + "|" + normalize(k.split("|")[0]): k for k in census}
hies_keys   = {normalize(k.split("|")[1]) + "|" + normalize(k.split("|")[0]): k for k in hies}
crime_keys  = {normalize(k.split("|")[1]) + "|" + normalize(k.split("|")[0]): k for k in crime}

def find_key(district_name, state_name, lookup):
    nd = normalize(district_name)
    ns = normalize(state_name)
    k = f"{nd}|{ns}"
    if k in lookup:
        return lookup[k]
    # try district only
    for lk, orig in lookup.items():
        if lk.startswith(nd + "|"):
            return orig
    return None

# ── 8. Assemble final districts.json ────────────────────────────────────────

print("\nAssembling output...")

output_districts = {}

for key, d in districts_raw.items():
    name = d["name"]
    state = d["state"]

    # Census 2020
    cen_key = find_key(name, state, census_keys)
    cen = census.get(cen_key, {}) if cen_key else {}

    pop = cen.get("population", 0)
    area = cen.get("area_km2", 0)

    # HIES
    hi_key = find_key(name, state, hies_keys)
    hi = hies.get(hi_key, {}) if hi_key else {}

    # Crime
    cr_key = find_key(name, state, crime_keys)
    cr = crime.get(cr_key, {}) if cr_key else {}

    # Facilities
    fac = facility_counts.get(key, {})

    # Centroid
    try:
        c = d["shape"].centroid
        centroid = [c.y, c.x]
    except:
        centroid = [0, 0]

    output_districts[key] = {
        "id": key,
        "name": name,
        "state": state,
        "population": pop,
        "area_km2": area,
        "density": round(pop / area, 1) if area > 0 else 0,
        "centroid": centroid,
        # Census demographics
        "age_0_14": cen.get("age_0_14", 0),
        "age_15_64": cen.get("age_15_64", 0),
        "age_65_above": cen.get("age_65_above", 0),
        "urban_pop": cen.get("urban", 0),
        "rural_pop": cen.get("rural", 0),
        "households": cen.get("households", 0),
        # HIES
        "poverty_rate": hi.get("poverty_rate"),
        "gini": hi.get("gini"),
        "income_mean": hi.get("income_mean"),
        "income_median": hi.get("income_median"),
        # Crime
        "crimes": cr.get("crimes", 0),
        "crime_year": cr.get("year", ""),
        # OSM facilities
        "hospitals": fac.get("hospital", 0),
        "schools": fac.get("school", 0),
        "police": fac.get("police", 0),
        "markets": fac.get("market", 0),
        "transport_stops": fac.get("transport", 0),
        "pharmacies": fac.get("pharmacy", 0),
    }

print(f"  Built {len(output_districts)} district records")

# ── 9. Write output ──────────────────────────────────────────────────────────

out_path = OUT_DIR / "districts.json"
with open(out_path, "w") as f:
    json.dump(list(output_districts.values()), f, ensure_ascii=False)

print(f"\nWrote {out_path} ({out_path.stat().st_size // 1024} KB)")

# Summary stats
pops = [d["population"] for d in output_districts.values() if d["population"] > 0]
hosps = [d["hospitals"] for d in output_districts.values()]
print(f"Districts with population data: {len(pops)}/{len(output_districts)}")
print(f"Total hospitals/clinics found: {sum(hosps)}")
print(f"Total schools found: {sum(d['schools'] for d in output_districts.values())}")
print(f"Total police found: {sum(d['police'] for d in output_districts.values())}")
print(f"Districts with poverty data: {sum(1 for d in output_districts.values() if d['poverty_rate'])}")

# Print a few sample records
samples = list(output_districts.values())[:3]
for s in samples:
    print(f"\n  {s['name']}, {s['state']}: pop={s['population']}, hospitals={s['hospitals']}, poverty={s['poverty_rate']}")
