import type { District, DistrictScores, GapScore, LayerId } from '../types';

// Facility provision standards — all ratios are population-per-facility.
//
// Primary source: PLANMalaysia Garis Panduan Perancangan Kemudahan Masyarakat
//   GP004-A (2022 edition) — the authoritative Malaysian urban planning standard.
//   https://mytownnet.planmalaysia.gov.my/ver2/gp/GPP%20KEMUDAHAN%20MASYARAKAT%20(GP004-A.2022).pdf
//
// Secondary sources cited per facility below.
export const STANDARDS = {
  // JPBD GP004-A 2022: Category V community health clinic — 1 per 10,000 pop.
  // Consistent with WHO primary healthcare accessibility guidelines.
  // (Previous value of 1:60,000 was a hospital-level standard, not clinic-level.)
  hospitals:  { per: 10_000,  label: '1 per 10k pop',   weight: 0.25 },

  // JPBD GP004-A 2022: 1 primary school per 5,000 pop; 1 secondary per 10,000.
  // Using 5,000 as the combined school standard (primary dominates by count).
  // Ref: PLANMalaysia MURNInets indicator; UNICEF Malaysia Education 2030 report.
  schools:    { per: 5_000,   label: '1 per 5k pop',    weight: 0.20 },

  // JPBD GP004-A 2022: 1 police station per 10,000 pop (community facility tier).
  // PDRM national ratio ~1:244 officers; UN reference median 300 officers/100k.
  // Ref: Malay Mail, Home Ministry police ratio report (April 2023).
  police:     { per: 10_000,  label: '1 per 10k pop',   weight: 0.15 },

  // JPBD GP004-A 2022: market / pasar in the 5,000–10,000 pop neighbourhood tier.
  // Using 10,000 as the standard (no binding international per-market ratio exists).
  markets:    { per: 10_000,  label: '1 per 10k pop',   weight: 0.15 },

  // WHO optimum: 1 pharmacist per 2,000 population (5 per 10,000).
  // Malaysia achieved this nationally by December 2022 (21,760 licensed pharmacists).
  // Ref: WHO GHO Pharmacists indicator; AIPharm Malaysia Community Pharmacies Report 2022.
  // FIP global mean: 6 pharmacists per 10,000 pop (FIP WPD 2025 Factsheet).
  pharmacies: { per: 2_000,   label: '1 per 2k pop',    weight: 0.10 },

  // No direct Malaysian standard for stop count per population.
  // Retained as proxy; true standard is 400 m walkability radius (APAD/FHWA/NACTO).
  // Ref: Planning Malaysia Journal spatial bus catchment analysis; FHWA Stop Spacing guide.
  transport:  { per: 5_000,   label: '1 stop per 5k',   weight: 0.15 },
};

function facilityScore(count: number, pop: number, perN: number): GapScore {
  if (!pop) return { raw: count, per10k: 0, score: 0, gap: 0, label: '–' };
  const required = pop / perN;
  const ratio = count / Math.max(required, 0.001);
  // Score is uncapped: 100 = exactly meets the JPBD/WHO standard.
  // >100 = over-served (excess provision); <100 = gap.
  // Cap at 200 to keep the diverging colour scale readable.
  const score = Math.min(200, Math.round(ratio * 100));
  const gap = Math.round(required - count);
  const per10k = parseFloat(((count / pop) * 10_000).toFixed(2));
  const surplus = count - Math.ceil(required);
  const label = surplus > 0
    ? `${count} / need ${Math.ceil(required)} (+${surplus} excess)`
    : `${count} / need ${Math.ceil(required)}`;
  return { raw: count, per10k, score, gap: Math.max(0, gap), label };
}

export function scoreDistrict(d: District): DistrictScores {
  const pop = d.population || 1;

  const hospitals  = facilityScore(d.hospitals,       pop, STANDARDS.hospitals.per);
  const schools    = facilityScore(d.schools,         pop, STANDARDS.schools.per);
  const police     = facilityScore(d.police,          pop, STANDARDS.police.per);
  const markets    = facilityScore(d.markets,         pop, STANDARDS.markets.per);
  const pharmacies = facilityScore(d.pharmacies,      pop, STANDARDS.pharmacies.per);
  const transport  = facilityScore(d.transport_stops, pop, STANDARDS.transport.per);

  // Poverty: invert scale — lower rate = higher score.
  // 0% poverty → 100; 25% → 0; each percentage point costs 4 score points.
  // Ref: DOSM MPI methodology (Alkire-Foster); DOSM Poverty in Malaysia 2022 release.
  const pov = d.poverty_rate ?? 15;
  const povScore = Math.max(0, Math.min(100, Math.round(100 - pov * 4)));
  const poverty: GapScore = {
    raw: pov, per10k: 0, score: povScore, gap: 0,
    label: d.poverty_rate != null ? `${pov}% poverty rate` : 'No data',
  };

  // Income: normalise against DOSM HIES 2022 national median household income RM 6,338.
  // Score of 70 at the national median; reaches 100 at RM 9,054 (6338 / 0.7).
  // Ref: DOSM Household Income & Expenditure Survey (HIES) 2022.
  // (Previous benchmark of RM 5,900 was the 2019 HIES figure — now updated.)
  const HIES_2022_MEDIAN = 6_338;
  const med = d.income_median ?? 0;
  const incScore = med ? Math.min(100, Math.round((med / HIES_2022_MEDIAN) * 70)) : 0;
  const income: GapScore = {
    raw: med, per10k: 0, score: incScore, gap: 0,
    label: med ? `RM${med.toLocaleString()} median` : 'No data',
  };

  // Composite is capped at 100: over-provision in one facility type doesn't
  // compensate for gaps elsewhere. Clamp each score at 100 for composite only.
  const cap = (s: number) => Math.min(100, s);
  const composite = Math.round(
    cap(hospitals.score)  * STANDARDS.hospitals.weight  +
    cap(schools.score)    * STANDARDS.schools.weight    +
    cap(police.score)     * STANDARDS.police.weight     +
    cap(markets.score)    * STANDARDS.markets.weight    +
    cap(pharmacies.score) * STANDARDS.pharmacies.weight +
    cap(transport.score)  * STANDARDS.transport.weight
  );

  return { hospitals, schools, police, markets, pharmacies, transport, poverty, income, composite };
}

export function getLayerScore(d: District, layer: LayerId): number {
  const s = scoreDistrict(d);
  const map: Record<LayerId, number> = {
    hospitals:  s.hospitals.score,
    schools:    s.schools.score,
    police:     s.police.score,
    markets:    s.markets.score,
    pharmacies: s.pharmacies.score,
    transport:  s.transport.score,
    poverty:    s.poverty.score,
    // Saturation at 10,000/km² — KL urban core ~7,200/km² per DOSM Census 2020.
    // JPBD high-density tier: >300 persons/ha (30,000/km²); 10,000 is a realistic urban ceiling.
    density:    Math.min(100, Math.round((d.density / 10_000) * 100)),
    // Average of piped water and electricity access (both %). Source: DOSM 2024.
    // 100% access = score 100; missing data defaults to 50 (neutral).
    amenities: (() => {
      const w = d.piped_water ?? null;
      const e = d.electricity ?? null;
      if (w === null && e === null) return 50;
      const vals = [w, e].filter(v => v !== null) as number[];
      return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    })(),
    income:     s.income.score,
  };
  return map[layer] ?? 50;
}

// 4-tier semantic scale. Thresholds vs JPBD GP004-A 2022 provision standards.
export function scoreColor(score: number): string {
  if (score > 120) return '#D85A30'; // coral  — Overdeveloped
  if (score >= 70)  return '#0F6E56'; // teal   — Well-Served
  if (score >= 35)  return '#D97706'; // amber-600 — Needs Improvement (contrast 3.19 vs white)
  return '#EF4444';                   // red    — Critical
}

export function gapSummary(d: District): string {
  const s = scoreDistrict(d);
  const rows = [
    { label: 'health clinics',  gap: s.hospitals.gap,  score: s.hospitals.score,  raw: s.hospitals.raw },
    { label: 'schools',         gap: s.schools.gap,    score: s.schools.score,    raw: s.schools.raw },
    { label: 'police stations', gap: s.police.gap,     score: s.police.score,     raw: s.police.raw },
    { label: 'markets',         gap: s.markets.gap,    score: s.markets.score,    raw: s.markets.raw },
    { label: 'pharmacies',      gap: s.pharmacies.gap, score: s.pharmacies.score, raw: s.pharmacies.raw },
    { label: 'transit stops',   gap: s.transport.gap,  score: s.transport.score,  raw: s.transport.raw },
  ];
  const critical   = rows.filter(r => r.score < 40).sort((a, b) => a.score - b.score);
  const overserved = rows.filter(r => r.score > 150).sort((a, b) => b.score - a.score);
  const parts: string[] = [];
  if (critical.length)
    parts.push(critical.map(r => `needs ${r.gap} more ${r.label} (${r.score}%)`).join('; '));
  if (overserved.length)
    parts.push(`over-provisioned: ${overserved.map(r => `${r.label} (${r.score}%)`).join(', ')}`);
  return parts.length ? parts.join(' · ') : 'Adequate coverage across all facility types.';
}
