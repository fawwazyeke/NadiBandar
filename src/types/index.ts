export interface District {
  id: string;
  name: string;
  state: string;
  population: number;
  area_km2: number;
  density: number;
  centroid: [number, number];

  // Demographics
  age_0_14: number;
  age_15_64: number;
  age_65_above: number;
  urban_pop: number;
  rural_pop: number;
  households: number;

  // Socioeconomic (DOSM HIES 2024)
  poverty_rate: number | null;
  gini: number | null;
  income_mean: number | null;
  income_median: number | null;
  expenditure_mean: number | null;

  // Basic amenities (DOSM 2024)
  piped_water: number | null;
  electricity: number | null;

  // Labour force (DOSM LFS 2024)
  unemployment_rate: number | null;

  // Crime (DOSM)
  crimes_total: number;
  crime_year: string;

  // Facilities (OSM)
  hospitals: number;
  schools: number;
  police: number;
  markets: number;
  transport_stops: number;
  pharmacies: number;
}

export type ViewLevel = 'state' | 'district';

export type LayerId =
  | 'hospitals'
  | 'schools'
  | 'police'
  | 'markets'
  | 'pharmacies'
  | 'transport'
  | 'poverty'
  | 'density'
  | 'income'
  | 'amenities';

export interface LayerDef {
  id: LayerId;
  label: string;
  desc: string;
  unit: string;
  standard?: string;
}

export interface GapScore {
  raw: number;
  per10k: number;
  score: number;
  gap: number;
  label: string;
}

export interface DistrictScores {
  hospitals: GapScore;
  schools: GapScore;
  police: GapScore;
  markets: GapScore;
  pharmacies: GapScore;
  transport: GapScore;
  poverty: GapScore;
  income: GapScore;
  composite: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'info';
  text: string;
  timestamp?: number;
}
