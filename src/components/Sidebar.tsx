import type { District, LayerId, ViewLevel } from '../types';
import { LAYERS, LEGEND_COLORS } from '../data/layers';
import { scoreDistrict, scoreColor } from '../data/scoring';

interface Props {
  selectedLayer: LayerId;
  onLayerChange: (l: LayerId) => void;
  viewLevel: ViewLevel;
  selectedDistrict: District | null;
  onClearDistrict: () => void;
  onAskAbout: (text: string) => void;
}

export default function Sidebar({
  selectedLayer, onLayerChange, viewLevel,
  selectedDistrict,
  onClearDistrict, onAskAbout,
}: Props) {
  const scores = selectedDistrict ? scoreDistrict(selectedDistrict) : null;

  const scoreRows = scores && selectedDistrict ? [
    { label: 'Hospitals & Clinics', score: scores.hospitals.score, raw: `${selectedDistrict.hospitals} facilities`, gap: scores.hospitals.gap },
    { label: 'Schools',             score: scores.schools.score,   raw: `${selectedDistrict.schools} facilities`,  gap: scores.schools.gap },
    { label: 'Police Stations',     score: scores.police.score,    raw: `${selectedDistrict.police} stations`,     gap: scores.police.gap },
    { label: 'Markets',             score: scores.markets.score,   raw: `${selectedDistrict.markets} markets`,     gap: scores.markets.gap },
    { label: 'Transit Stops',       score: scores.transport.score,  raw: `${selectedDistrict.transport_stops}`,    gap: scores.transport.gap },
    { label: 'Poverty Index',       score: scores.poverty.score,    raw: scores.poverty.label, gap: 0 },
  ] : [];

  return (
    <aside style={{
      width: 220, background: '#ffffff',
      borderRight: '1px solid #e2e8f0',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', flexShrink: 0,
    }}>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* Data layers */}
        <div style={{ padding: '12px 12px 8px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 8 }}>
            Data Layers
          </div>
          {LAYERS.map(layer => {
            const active = selectedLayer === layer.id;
            return (
              <button
                key={layer.id}
                onClick={() => onLayerChange(layer.id)}
                style={{
                  display: 'block', width: '100%', padding: '6px 8px',
                  marginBottom: 2, textAlign: 'left', cursor: 'pointer',
                  background: active ? '#f0fdfa' : 'transparent',
                  border: `1.5px solid ${active ? '#0d9488' : 'transparent'}`,
                  borderRadius: 7,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: active ? '#0d9488' : '#e2e8f0' }} />
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: '#0f172a', lineHeight: 1.2, textAlign: 'left' }}>
                    {layer.label}
                  </span>
                </div>
              </button>
            );
          })}
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 6, paddingLeft: 2, lineHeight: 1.4 }}>
            {LAYERS.find(l => l.id === selectedLayer)?.desc}
          </div>
        </div>

        <div style={{ height: 1, background: '#f1f5f9', margin: '0 12px' }} />

        {/* Legend */}
        <div style={{ padding: '10px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: 8 }}>
            Legend
          </div>
          {LEGEND_COLORS.map(item => (
            <div key={item.color} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <div style={{ width: 13, height: 13, borderRadius: 3, background: item.color, flexShrink: 0, border: (item as any).dark ? '1px solid #c8e6d4' : 'none' }} />
              <span style={{ fontSize: 11.5, color: '#475569' }}>{item.label}</span>
            </div>
          ))}
        </div>

        <div style={{ height: 1, background: '#f1f5f9', margin: '0 12px' }} />

        {/* District / State detail */}
        {selectedDistrict && scores ? (
          <div style={{ padding: '12px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 2 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>{selectedDistrict.name}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{viewLevel === 'state' ? 'State' : selectedDistrict.state}</div>
              </div>
              <button onClick={onClearDistrict} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: 20, lineHeight: 1, padding: 0, flexShrink: 0, marginLeft: 6 }}>×</button>
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10 }}>
              Pop: {selectedDistrict.population.toLocaleString()} · {selectedDistrict.density}/km²
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: '#374151' }}>Overall Score</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: scoreColor(scores.composite) }}>{scores.composite}/100</span>
            </div>
            {scoreRows.map(row => {
              const capped = Math.min(100, row.score);
              const isOver = row.score > 120;
              const label = row.score > 100 ? `${row.score}%` : `${row.score}/100`;
              return (
                <div key={row.label} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: '#374151' }}>{row.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {isOver && <span style={{ fontSize: 9, fontWeight: 700, color: '#993C1D', background: '#FAECE7', borderRadius: 4, padding: '1px 4px' }}>OVERDEVELOPED</span>}
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: scoreColor(row.score) }}>{label}</span>
                    </div>
                  </div>
                  <div style={{ height: 4, background: '#f1f5f9', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${capped}%`, height: '100%', background: scoreColor(row.score), borderRadius: 2, transition: 'width 0.4s ease' }} />
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
                    {row.raw}{row.gap > 0 ? ` · needs ${row.gap} more` : row.score > 100 ? ` · ${row.score - 100}% above standard` : ''}
                  </div>
                </div>
              );
            })}
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, lineHeight: 1.6 }}>
              {selectedDistrict.poverty_rate != null && <>Poverty: {selectedDistrict.poverty_rate}% · </>}
              Median income: RM{selectedDistrict.income_median?.toLocaleString() ?? '–'}
              {selectedDistrict.unemployment_rate != null && <> · Unemployed: {selectedDistrict.unemployment_rate}%</>}
            </div>
            {(selectedDistrict.piped_water != null || selectedDistrict.electricity != null) && (
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                Piped water: {selectedDistrict.piped_water?.toFixed(1) ?? '–'}% · Electricity: {selectedDistrict.electricity?.toFixed(1) ?? '–'}%
              </div>
            )}
            <button
              onClick={() => onAskAbout(
                viewLevel === 'state'
                  ? `Tell me about ${selectedDistrict.name} state and its overall facility gaps`
                  : `Tell me about ${selectedDistrict.name}, ${selectedDistrict.state} and its facility gaps`
              )}
              style={{ width: '100%', marginTop: 8, padding: '7px 12px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              Ask AI about {selectedDistrict.name} →
            </button>
          </div>

        ) : (
          <div style={{ padding: '20px 14px', textAlign: 'center' }}>
            <div style={{ color: '#94a3b8', fontSize: 12.5, lineHeight: 1.7, marginBottom: 16 }}>
              Click any {viewLevel} on<br/>the map to view analysis
            </div>
            <button
              onClick={() => onAskAbout(
                'Analyze all 160 Malaysian districts and list the top 5 most critical facility gaps that need immediate government intervention. For each, name the district, the specific gap, how many facilities are missing, and the recommended action. Rank by severity and impact on residents.'
              )}
              style={{
                width: '100%', padding: '9px 12px',
                background: '#0d9488',
                color: '#fff', border: 'none', borderRadius: 8,
                fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Analyze All Districts
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '8px 12px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: '#cbd5e1', lineHeight: 1.5 }}>
          Sources: DOSM Census 2020 · HIES 2022 · OSM · PLANMalaysia
        </div>
      </div>
    </aside>
  );
}
