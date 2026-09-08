import type { LayerDef } from '../types';

export const LAYERS: LayerDef[] = [
  { id: 'hospitals',  label: 'Hospitals & Clinics', desc: 'JPBD GP004-A 2022: 1 clinic per 10k residents', unit: 'facilities' },
  { id: 'schools',    label: 'Schools',             desc: 'JPBD GP004-A 2022: 1 school per 5k residents',  unit: 'facilities' },
  { id: 'police',     label: 'Police Stations',     desc: 'JPBD GP004-A 2022: 1 station per 10k residents', unit: 'facilities' },
  { id: 'markets',    label: 'Markets',             desc: 'JPBD GP004-A 2022: 1 market per 10k residents', unit: 'facilities' },
  { id: 'pharmacies', label: 'Pharmacies',          desc: 'WHO optimum & MOH 2022: 1 per 2k residents',    unit: 'facilities' },
  { id: 'transport',  label: 'Public Transport',    desc: 'Bus stops & rail stations per 5k (APAD/FHWA)',  unit: 'stops' },
  { id: 'poverty',    label: 'Poverty Rate',        desc: 'Lower poverty = higher score (DOSM HIES 2022)', unit: '%' },
  { id: 'income',     label: 'Median Income',       desc: 'Household median income vs RM 6,338 national median (DOSM HIES 2022)', unit: 'RM' },
  { id: 'density',    label: 'Population Density',  desc: 'People per km² — saturation at 10,000/km² (DOSM Census 2020)', unit: '/km²' },
  { id: 'amenities',  label: 'Basic Amenities',     desc: 'Average of piped water + electricity access % (DOSM 2024)',     unit: '%' },
];

export const LEGEND_COLORS = [
  { color: '#D85A30', label: 'Overdeveloped (>120%)' },
  { color: '#0F6E56', label: 'Well-Served (70–120%)' },
  { color: '#F59E0B', label: 'Needs Improvement (35–70%)' },
  { color: '#EF4444', label: 'Critical (<35%)' },
];
