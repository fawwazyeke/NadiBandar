"""
Enrich public/data/districts.json with official OpenDOSM district-level datasets.

Sources:
  - Schools:      MOE EMIS via OpenDOSM (schools_district.csv, 2025)
  - HIES 2024:    DOSM HIES 2024 (hies_district.csv, 2024) — income, poverty, Gini
  - Amenities:    DOSM (hh_access_amenities.csv, 2024) — piped water, electricity
  - Labour force: DOSM LFS 2024 (lfs_district.csv, 2024) — unemployment rate

Run: python3 scripts/enrich_districts.py
"""

import json, csv, re
from pathlib import Path

ROOT   = Path(__file__).parent.parent
RAW    = ROOT / "scripts" / "raw_data"
DIST_F = ROOT / "public" / "data" / "districts.json"

# ---------------------------------------------------------------------------
# Name normalisation — CSV district names → districts.json names
# ---------------------------------------------------------------------------
ALIASES = {
    # Perak
    "larut matang and selama":     "Larut, Matang and Selama",
    "larut & matang":              "Larut, Matang and Selama",
    "larut matang & selama":       "Larut, Matang and Selama",
    "larut dan matang":            "Larut, Matang and Selama",
    "larut, matang and selama":    "Larut, Matang and Selama",
    "manjung (dinding)":           "Manjung",
    "cameron highland":            "Cameron Highlands",
    # Selangor
    "hulu langat":                 "Hulu Langat",
    "hulu selangor":               "Hulu Selangor",
    # Sabah / Sarawak Sarawak planning region codes
    "s.p. selatan":                None,   # skip — not an admin district
    "s.p.tengah":                  None,
    "s.p.utara":                   None,
    "s.p. timur":                  None,
    # Minor spelling variants
    "kota belud":                  "Kota Belud",
    "kuala muda/yan":              "Kuala Muda/Yan",
    "kuala muda / yan":            "Kuala Muda/Yan",
    "kota marudu":                 "Kota Marudu",
    "tawau":                       "Tawau",
}

def norm(name: str) -> str:
    """Normalise a district name for matching."""
    return re.sub(r"\s+", " ", name.strip().lower())

def resolve(raw: str, index: dict) -> str | None:
    """Return the canonical district name or None if unresolvable."""
    n = norm(raw)
    if n in ALIASES:
        return ALIASES[n]
    # Try exact match
    if raw in index:
        return raw
    # Try title-case
    tc = raw.title()
    if tc in index:
        return tc
    return None

# ---------------------------------------------------------------------------
# Load existing districts
# ---------------------------------------------------------------------------
with DIST_F.open() as f:
    districts: list[dict] = json.load(f)

idx = {d["name"]: d for d in districts}   # name → district record
matched_log: dict[str, list[str]] = {}    # source → matched names

# ---------------------------------------------------------------------------
# 1. Schools (MOE EMIS, most recent year = 2025-06-30, primary + secondary)
# ---------------------------------------------------------------------------
school_map: dict[str, int] = {}   # district name → school count
with open(RAW / "schools_district.csv") as f:
    for row in csv.DictReader(f):
        if row["date"] != "2025-06-30":
            continue
        if row["district"] == "All Districts":
            continue
        if row["stage"] not in ("primary", "secondary"):
            continue
        canon = resolve(row["district"], idx)
        if not canon:
            continue
        school_map[canon] = school_map.get(canon, 0) + int(row["schools"] or 0)

for name, count in school_map.items():
    if name in idx:
        idx[name]["schools"] = count

print(f"Schools (MOE EMIS 2025): updated {len(school_map)} districts")

# ---------------------------------------------------------------------------
# 2. HIES 2024 — income, poverty, Gini, expenditure
# ---------------------------------------------------------------------------
hies_map: dict[str, dict] = {}
with open(RAW / "hies_district.csv") as f:
    for row in csv.DictReader(f):
        if row["date"] != "2024-01-01":
            continue
        canon = resolve(row["district"], idx)
        if not canon:
            continue
        hies_map[canon] = {
            "income_mean":      float(row["income_mean"])      if row["income_mean"]      else None,
            "income_median":    float(row["income_median"])    if row["income_median"]    else None,
            "expenditure_mean": float(row["expenditure_mean"]) if row["expenditure_mean"] else None,
            "gini":             float(row["gini"])             if row["gini"]             else None,
            "poverty_rate":     float(row["poverty"])          if row["poverty"]          else None,
        }

for name, vals in hies_map.items():
    if name in idx:
        idx[name].update({k: v for k, v in vals.items() if v is not None})

print(f"HIES 2024: updated {len(hies_map)} districts")

# ---------------------------------------------------------------------------
# 3. Basic amenities 2024 — piped water %, electricity %
# ---------------------------------------------------------------------------
amenity_map: dict[str, dict] = {}
with open(RAW / "hh_access_amenities.csv") as f:
    for row in csv.DictReader(f):
        if row["date"] != "2024-01-01":
            continue
        if row["district"] in ("All Districts",):
            continue
        canon = resolve(row["district"], idx)
        if not canon:
            continue
        amenity_map[canon] = {
            "piped_water": float(row["piped_water"]) if row.get("piped_water") else None,
            "electricity":  float(row["electricity"])  if row.get("electricity")  else None,
        }

for name, vals in amenity_map.items():
    if name in idx:
        for k, v in vals.items():
            if v is not None:
                idx[name][k] = v

print(f"Amenities 2024: updated {len(amenity_map)} districts")

# ---------------------------------------------------------------------------
# 4. Labour force 2024 — unemployment rate
# ---------------------------------------------------------------------------
lfs_map: dict[str, float] = {}
with open(RAW / "lfs_district.csv") as f:
    for row in csv.DictReader(f):
        if row["date"] != "2024-01-01":
            continue
        canon = resolve(row["district"], idx)
        if not canon:
            continue
        try:
            lfs_map[canon] = float(row["u_rate"])
        except (ValueError, KeyError):
            pass

for name, rate in lfs_map.items():
    if name in idx:
        idx[name]["unemployment_rate"] = rate

print(f"LFS 2024: updated {len(lfs_map)} districts")

# ---------------------------------------------------------------------------
# Fill missing new fields with null for districts not in any CSV
# ---------------------------------------------------------------------------
NEW_FIELDS = ["piped_water", "electricity", "unemployment_rate", "expenditure_mean"]
for d in districts:
    for fld in NEW_FIELDS:
        if fld not in d:
            d[fld] = None

# ---------------------------------------------------------------------------
# Write output
# ---------------------------------------------------------------------------
with DIST_F.open("w") as f:
    json.dump(districts, f, ensure_ascii=False, separators=(",", ":"))

print(f"\nWrote {len(districts)} districts to {DIST_F}")
print("New fields added: piped_water, electricity, unemployment_rate, expenditure_mean")
print("Updated fields:   schools (MOE 2025), income_median, poverty_rate, gini (HIES 2024)")
