import { useState, useCallback } from 'react';
import MapView from './components/MapView';
import Sidebar from './components/Sidebar';
import ChatPanel from './components/ChatPanel';
import HoverTooltip from './components/HoverTooltip';
import { useDistricts } from './hooks/useDistricts';
import type { District, LayerId, ViewLevel } from './types';

const VIEW_LEVELS: ViewLevel[] = ['state', 'district'];

export default function App() {
  const { districts, loading } = useDistricts();

  const [selectedLayer, setSelectedLayer] = useState<LayerId>('hospitals');
  const [viewLevel, setViewLevel] = useState<ViewLevel>('district');
  const [selectedDistrict, setSelectedDistrict] = useState<District | null>(null);
  const [hoveredDistrict, setHoveredDistrict] = useState<District | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string>('');

  const handleViewLevel = useCallback((level: ViewLevel) => {
    setViewLevel(level);
    setSelectedDistrict(null);
  }, []);

  const handleAskAbout = useCallback((text: string) => setPendingMessage(text), []);
  const handleClearPending = useCallback(() => setPendingMessage(''), []);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: '100vh', overflow: 'hidden',
      fontFamily: "'Inter', system-ui, sans-serif",
      color: '#0f172a', background: '#f0f4f8',
    }}>
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <Sidebar
          selectedLayer={selectedLayer}
          onLayerChange={setSelectedLayer}
          viewLevel={viewLevel}
          selectedDistrict={selectedDistrict}
          onClearDistrict={() => setSelectedDistrict(null)}
          onAskAbout={handleAskAbout}
        />

        {/* Map area */}
        <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
          {/* Top-left overlays */}
          <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 500, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{
              background: 'rgba(255,255,255,0.96)', border: '1px solid #e2e8f0',
              borderRadius: 8, padding: '5px 11px',
              fontSize: 12, fontWeight: 600, color: '#0f172a',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}>
              {selectedLayer.charAt(0).toUpperCase() + selectedLayer.slice(1)} Coverage
            </div>

            {/* View level toggle */}
            <div style={{
              background: 'rgba(255,255,255,0.96)', border: '1px solid #e2e8f0',
              borderRadius: 8, padding: 3, display: 'flex',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            }}>
              {VIEW_LEVELS.map(level => (
                <button
                  key={level}
                  onClick={() => handleViewLevel(level)}
                  style={{
                    flex: 1, padding: '4px 0', border: 'none', borderRadius: 6, cursor: 'pointer',
                    fontSize: 11.5, fontWeight: 600, textAlign: 'center',
                    background: viewLevel === level ? '#0d9488' : 'transparent',
                    color: viewLevel === level ? '#fff' : '#64748b',
                    transition: 'all 0.15s',
                  }}
                >
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {!loading && (
            <MapView
              districts={districts}
              selectedLayer={selectedLayer}
              viewLevel={viewLevel}
              onViewLevelChange={handleViewLevel}
              selectedDistrict={selectedDistrict}
              onSelectDistrict={setSelectedDistrict}
              onHoverDistrict={setHoveredDistrict}
            />
          )}

          <HoverTooltip
            district={hoveredDistrict}
            layer={selectedLayer}
            viewLevel={viewLevel}
          />

          {loading && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 400,
              background: 'rgba(240,244,248,0.85)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 32, height: 32, border: '3px solid #e2e8f0',
                  borderTopColor: '#0d9488', borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                  margin: '0 auto 12px',
                }} />
                <div style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>Loading…</div>
              </div>
            </div>
          )}
        </div>

        <ChatPanel
          districts={districts}
          selectedLayer={selectedLayer}
          initialMessage={pendingMessage}
          onInitialMessageSent={handleClearPending}
        />
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; overflow: hidden; }
        #root { height: 100%; width: 100%; }
        button { font-family: inherit; }
        textarea { font-family: inherit; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
      `}</style>
    </div>
  );
}
