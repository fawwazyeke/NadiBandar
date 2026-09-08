import type { Mukim, LayerId } from '../types';

// Per-population standards — PLANMalaysia JPBD GP004-A 2022
// https://mytownnet.planmalaysia.gov.my/ver2/gp/GPP%20KEMUDAHAN%20MASYARAKAT%20(GP004-A.2022).pdf
const HEALTH_PER = 10_000;  // Category V community clinic: 1 per 10,000 pop
const PHARMA_PER = 2_000;   // WHO optimum & Malaysia MOH 2022: 1 per 2,000 pop
                             // Ref: WHO GHO Pharmacists indicator; AIPharm Malaysia 2022

// Score is uncapped above 100 (over-provision) but floored at 0. Cap at 200 for display.
function clamp(v: number) { return Math.min(200, Math.max(0, Math.round(v))); }

export function getMukimLayerScore(m: Mukim, layer: LayerId): number {
  if (!m.population) return 50;

  switch (layer) {
    case 'hospitals': {
      const expected = m.population / HEALTH_PER;
      if (expected === 0) return 50;
      return clamp((m.health_facilities / expected) * 100);
    }
    case 'pharmacies': {
      const expected = m.population / PHARMA_PER;
      if (expected === 0) return 50;
      return clamp((m.pharmacies / expected) * 100);
    }
    case 'density': {
      // JPBD high-density threshold: >300 persons/ha = 30,000/km².
      // KL urban core: ~7,200/km². Saturation set at 10,000/km² (dense urban).
      // Ref: JPBD density guidelines; KLSP 2020; DOSM Census 2020.
      const score = Math.min(100, Math.round((m.density / 10_000) * 100));
      return score;
    }
    case 'poverty':
    case 'income':
    case 'schools':
    case 'police':
    case 'markets':
    case 'transport':
      return 50; // neutral — no data at mukim level
    default:
      return 50;
  }
}

export function MUKIM_HAS_DATA(layer: LayerId): boolean {
  return layer === 'hospitals' || layer === 'pharmacies' || layer === 'density';
}

// Same teal · coral scale as district scoreColor.
export function mukimScoreColor(score: number): string {
  if (score > 120) return '#D85A30'; // coral — over-served
  if (score >= 80) return '#0F6E56'; // teal 600 — meets standard
  if (score >= 55) return '#1D9E75'; // teal 400 — slight gap
  if (score >= 35) return '#5DCAA5'; // teal 200 — moderate gap
  if (score >= 15) return '#9FE1CB'; // teal 100 — significant gap
  return '#E1F5EE';                  // teal 50  — critical gap
}
