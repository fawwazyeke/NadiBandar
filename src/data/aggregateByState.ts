import type { District } from '../types';

// geoBoundaries shapeName → DOSM state name used in districts.json
export const GEO_TO_DOSM: Record<string, string> = {
  'Malacca': 'Melaka',
  'Penang': 'Pulau Pinang',
  'Kuala Lumpur': 'W.P. Kuala Lumpur',
  'Labuan': 'W.P. Labuan',
  'Putrajaya': 'W.P. Putrajaya',
};

export function resolveStateName(shapeName: string): string {
  return GEO_TO_DOSM[shapeName] ?? shapeName;
}

export function aggregateByState(districts: District[]): District[] {
  const stateMap = new Map<string, District[]>();
  for (const d of districts) {
    const arr = stateMap.get(d.state) ?? [];
    arr.push(d);
    stateMap.set(d.state, arr);
  }

  return Array.from(stateMap.entries()).map(([state, ds]) => {
    const totalPop = ds.reduce((s, d) => s + d.population, 0);
    const totalArea = ds.reduce((s, d) => s + d.area_km2, 0);

    const wavg = (field: (d: District) => number | null): number | null => {
      const valid = ds.filter(d => field(d) != null);
      if (!valid.length) return null;
      const totalW = valid.reduce((s, d) => s + d.population, 0);
      return totalW ? valid.reduce((s, d) => s + (field(d) as number) * d.population, 0) / totalW : null;
    };

    return {
      id: state,
      name: state,
      state,
      population: totalPop,
      area_km2: totalArea,
      density: totalArea ? Math.round(totalPop / totalArea) : 0,
      centroid: ds[0].centroid,

      age_0_14: ds.reduce((s, d) => s + d.age_0_14, 0),
      age_15_64: ds.reduce((s, d) => s + d.age_15_64, 0),
      age_65_above: ds.reduce((s, d) => s + d.age_65_above, 0),
      urban_pop: ds.reduce((s, d) => s + d.urban_pop, 0),
      rural_pop: ds.reduce((s, d) => s + d.rural_pop, 0),
      households: ds.reduce((s, d) => s + d.households, 0),

      poverty_rate: wavg(d => d.poverty_rate),
      gini: wavg(d => d.gini),
      income_mean: wavg(d => d.income_mean),
      income_median: wavg(d => d.income_median),
      expenditure_mean: wavg(d => d.expenditure_mean),

      crimes_total: ds.reduce((s, d) => s + d.crimes_total, 0),
      crime_year: ds[0].crime_year,

      hospitals: ds.reduce((s, d) => s + d.hospitals, 0),
      schools: ds.reduce((s, d) => s + d.schools, 0),
      police: ds.reduce((s, d) => s + d.police, 0),
      markets: ds.reduce((s, d) => s + d.markets, 0),
      transport_stops: ds.reduce((s, d) => s + d.transport_stops, 0),
      pharmacies: ds.reduce((s, d) => s + d.pharmacies, 0),
    } as District;
  });
}
