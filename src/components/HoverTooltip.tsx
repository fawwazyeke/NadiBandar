import type { District, LayerId, ViewLevel } from '../types';
import { getLayerScore } from '../data/scoring';
import { LAYERS } from '../data/layers';

interface Props {
  district: District | null;
  layer: LayerId;
  viewLevel?: ViewLevel;
}

export default function HoverTooltip({ district, layer, viewLevel }: Props) {
  if (!district) return null;

  const score = getLayerScore(district, layer);
  const layerLabel = LAYERS.find(l => l.id === layer)?.label ?? '';
  const label = viewLevel === 'state' ? district.name : `${district.name}, ${district.state}`;
  const text = `${label} · ${layerLabel}: ${score}/100`;

  return (
    <div style={{
      position: 'absolute', bottom: 48, left: '50%', transform: 'translateX(-50%)',
      zIndex: 1000, background: '#0f172a', color: '#f8fafc',
      fontSize: 12, fontWeight: 500, padding: '5px 14px',
      borderRadius: 20, pointerEvents: 'none',
      whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
    }}>
      {text}
    </div>
  );
}
