import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { District, LayerId, ViewLevel } from '../types';
import { getLayerScore, scoreColor } from '../data/scoring';
import { aggregateByState } from '../data/aggregateByState';

interface Props {
  districts: District[];
  selectedLayer: LayerId;
  viewLevel: ViewLevel;
  onViewLevelChange: (level: ViewLevel) => void;
  selectedDistrict: District | null;
  onSelectDistrict: (d: District | null) => void;
  onHoverDistrict: (d: District | null) => void;
}

export default function MapView({
  districts, selectedLayer, viewLevel, onViewLevelChange,
  selectedDistrict, onSelectDistrict, onHoverDistrict,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const districtLayerRef = useRef<L.GeoJSON | null>(null);
  const stateBorderRef = useRef<L.Polyline | null>(null);

  const viewLevelRef = useRef<ViewLevel>(viewLevel);
  useEffect(() => { viewLevelRef.current = viewLevel; }, [viewLevel]);
  const selectedLayerRef = useRef<LayerId>(selectedLayer);
  useEffect(() => { selectedLayerRef.current = selectedLayer; }, [selectedLayer]);

  const styleDistrictFnRef = useRef<(f: any) => L.PathOptions>(() => ({}));
  const districtsByIdRef = useRef<Map<string, District>>(new Map());
  const statesByNameRef = useRef<Map<string, District>>(new Map());

  useEffect(() => {
    const byId = new Map<string, District>();
    for (const d of districts) byId.set(d.id, d);
    districtsByIdRef.current = byId;
    const byState = new Map<string, District>();
    for (const s of aggregateByState(districts)) byState.set(s.state, s);
    statesByNameRef.current = byState;
  }, [districts]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let mounted = true;
    containerRef.current.style.background = '#b8cfe8';

    const map = L.map(containerRef.current, {
      zoomControl: false,
      minZoom: 4, maxZoom: 16,
      maxBounds: [[0.5, 98.5], [8.0, 120.5]],
      maxBoundsViscosity: 1.0,
    });
    map.setView([4.2, 109.5], 6);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mapRef.current = map;

    // State borders pre-computed from districts.geojson — 143 connected chains,
    // perfectly aligned with the district fill layer.
    fetch('/data/state-borders.json').then(r => r.json()).then((d: { stateBorders: [number,number][][] }) => {
      if (!mounted) return;
      const line = L.polyline(d.stateBorders, {
        color: '#ffffff', weight: 2.5, opacity: 1, interactive: false,
      });
      stateBorderRef.current = line;
      if (mapRef.current && districtLayerRef.current && mapRef.current.hasLayer(districtLayerRef.current)) {
        line.addTo(mapRef.current);
      }
    });

    fetch('/geojson/districts.geojson').then(r => r.json()).then(data => {
      if (!mounted) return;

      const layer = L.geoJSON(data, {
        style: f => styleDistrictFnRef.current(f),
        smoothFactor: 1.5,
        onEachFeature: (feature, lyr) => {
          lyr.on({
            mouseover: (e: L.LeafletMouseEvent) => {
              e.target.setStyle({ fillOpacity: 0.95 });
              const item = viewLevelRef.current === 'state'
                ? statesByNameRef.current.get(feature.properties?.state)
                : districtsByIdRef.current.get(districtId(feature));
              if (item) onHoverDistrict(item);
            },
            mouseout: (e: L.LeafletMouseEvent) => {
              e.target.setStyle(styleDistrictFnRef.current(feature));
              onHoverDistrict(null);
            },
            click: (e: L.LeafletMouseEvent) => {
              L.DomEvent.stopPropagation(e);
              if (viewLevelRef.current === 'state') {
                const s = statesByNameRef.current.get(feature.properties?.state);
                if (s) onSelectDistrict(s);
                onViewLevelChange('district');
              } else {
                const d = districtsByIdRef.current.get(districtId(feature));
                onSelectDistrict(d ?? null);
                if (e.target.getBounds) map.fitBounds(e.target.getBounds(), { padding: [40, 40], maxZoom: 11 });
              }
            },
          });
        },
      });

      districtLayerRef.current = layer;
      layer.addTo(map);
      if (stateBorderRef.current) stateBorderRef.current.addTo(map);
      const b = layer.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [20, 20] });
    });

    return () => {
      mounted = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Re-style when viewLevel, selectedLayer, or data changes
  useEffect(() => {
    districtLayerRef.current?.setStyle(f => styleDistrictFnRef.current(f));
    if (stateBorderRef.current && mapRef.current) {
      if (!mapRef.current.hasLayer(stateBorderRef.current)) {
        stateBorderRef.current.addTo(mapRef.current);
      }
      stateBorderRef.current.bringToFront();
    }
  }, [viewLevel, selectedLayer, districts]);

  // Highlight selected district in district view
  useEffect(() => {
    if (viewLevel !== 'district') return;
    districtLayerRef.current?.eachLayer((lyr: L.Layer) => {
      const gl = lyr as any;
      if (!gl.feature) return;
      const id = districtId(gl.feature);
      if (id === selectedDistrict?.id) {
        gl.setStyle({ fillOpacity: 0.95 });
        gl.bringToFront();
      } else {
        gl.setStyle(styleDistrictFnRef.current(gl.feature));
      }
    });
    stateBorderRef.current?.bringToFront();
  }, [selectedDistrict]);

  function districtId(feature: any): string {
    const p = feature?.properties || {};
    return `${p.state || ''}|${p.district || p.name || ''}`;
  }

  function styleDistrict(feature: any): L.PathOptions {
    if (viewLevelRef.current === 'state') {
      const stateName = feature?.properties?.state;
      const s = statesByNameRef.current.get(stateName);
      const score = s ? getLayerScore(s, selectedLayerRef.current) : 50;
      // No inner district borders in state view — weight 0 for a clean choropleth
      return { fillColor: scoreColor(score), fillOpacity: 0.85, weight: 0 };
    }
    const id = districtId(feature);
    const d = districtsByIdRef.current.get(id);
    const score = d ? getLayerScore(d, selectedLayerRef.current) : 50;
    return { fillColor: scoreColor(score), fillOpacity: 0.85, weight: 0.8, color: 'rgba(255,255,255,0.45)', opacity: 1 };
  }

  styleDistrictFnRef.current = styleDistrict;

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#b8cfe8' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <style>{`.leaflet-container { background: #b8cfe8 !important; }`}</style>
    </div>
  );
}
