import { useEffect, useRef } from 'react';
import { Map as MapLibre, NavigationControl, LngLatBounds, GeoJSONSource, setWorkerUrl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// Point MapLibre at the worker file served from /public so Vite's production build doesn't lose it
setWorkerUrl('/maplibre-gl-worker.mjs');
import type { District, LayerId, ViewLevel } from '../types';
import { getLayerScore, scoreColor } from '../data/scoring';
import { aggregateByState } from '../data/aggregateByState';

// GADM NAME_1 (no spaces) → our state name
const GADM_TO_STATE: Record<string, string> = {
  'Johor': 'Johor',
  'Kedah': 'Kedah',
  'Kelantan': 'Kelantan',
  'KualaLumpur': 'W.P. Kuala Lumpur',
  'Labuan': 'W.P. Labuan',
  'Melaka': 'Melaka',
  'NegeriSembilan': 'Negeri Sembilan',
  'Pahang': 'Pahang',
  'Perak': 'Perak',
  'Perlis': 'Perlis',
  'PulauPinang': 'Pulau Pinang',
  'Putrajaya': 'W.P. Putrajaya',
  'Sabah': 'Sabah',
  'Sarawak': 'Sarawak',
  'Selangor': 'Selangor',
  'Trengganu': 'Terengganu',
};

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
  districts, selectedLayer, viewLevel,
  onViewLevelChange, selectedDistrict, onSelectDistrict, onHoverDistrict,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const gadmDataRef = useRef<any>(null);
  const mappingRef = useRef<Record<string, string>>({});
  const reverseMappingRef = useRef<Record<string, string>>({}); // district id → GID_2
  const selectedDistrictRef = useRef<District | null>(selectedDistrict);
  useEffect(() => { selectedDistrictRef.current = selectedDistrict; }, [selectedDistrict]);

  // Keep refs current so map event handlers see latest values
  const viewLevelRef = useRef<ViewLevel>(viewLevel);
  useEffect(() => { viewLevelRef.current = viewLevel; }, [viewLevel]);
  const selectedLayerRef = useRef<LayerId>(selectedLayer);
  useEffect(() => { selectedLayerRef.current = selectedLayer; }, [selectedLayer]);
  const onSelectRef = useRef(onSelectDistrict);
  useEffect(() => { onSelectRef.current = onSelectDistrict; }, [onSelectDistrict]);
  const onHoverRef = useRef(onHoverDistrict);
  useEffect(() => { onHoverRef.current = onHoverDistrict; }, [onHoverDistrict]);
  const onViewRef = useRef(onViewLevelChange);
  useEffect(() => { onViewRef.current = onViewLevelChange; }, [onViewLevelChange]);

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

  // Stamp __color onto each GADM feature then push to the map source
  function pushColors() {
    const map = mapRef.current;
    const data = gadmDataRef.current;
    if (!map || !data || !map.getSource('districts')) return;

    const vl = viewLevelRef.current;
    const layer = selectedLayerRef.current;

    for (const f of data.features) {
      const gid: string = f.properties.GID_2;
      const stateName: string = GADM_TO_STATE[f.properties.NAME_1] ?? f.properties.NAME_1;
      let color = '#9ca3af'; // gray for unmatched districts

      if (vl === 'state') {
        const agg = statesByNameRef.current.get(stateName);
        color = scoreColor(agg ? getLayerScore(agg, layer) : 50);
      } else {
        const did = mappingRef.current[gid];
        const d = did ? districtsByIdRef.current.get(did) : null;
        if (d) color = scoreColor(getLayerScore(d, layer));
      }
      f.properties.__color = color;
    }

    (map.getSource('districts') as GeoJSONSource).setData(data);
  }

  // One-time map init
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let mounted = true;

    const map = new MapLibre({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [] },
      center: [109.5, 4.2],
      zoom: 5,
      minZoom: 4,
      maxZoom: 16,
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('error', e => console.error('[MapLibre]', e.error));
    mapRef.current = map;

    const onMapLoad = async () => {
      if (!mounted) return;
      try {

      const [gadmData, mapping] = await Promise.all([
        fetch('/geojson/gadm_mys_2.geojson').then(r => r.json()),
        fetch('/data/gadm-mapping.json').then(r => r.json()),
      ]);
      if (!mounted) return;

      gadmDataRef.current = gadmData;
      mappingRef.current = mapping;
      const rev: Record<string, string> = {};
      for (const [gid, did] of Object.entries(mapping)) rev[did as string] = gid;
      reverseMappingRef.current = rev;

      // Background (sea color)
      map.addLayer({ id: 'bg', type: 'background', paint: { 'background-color': '#b8cfe8' } });

      // Stamp initial colors
      const vl = viewLevelRef.current;
      const layer = selectedLayerRef.current;
      for (const f of gadmData.features) {
        const gid: string = f.properties.GID_2;
        const stateName: string = GADM_TO_STATE[f.properties.NAME_1] ?? f.properties.NAME_1;
        let color = '#9ca3af';
        if (vl === 'state') {
          const agg = statesByNameRef.current.get(stateName);
          color = scoreColor(agg ? getLayerScore(agg, layer) : 50);
        } else {
          const did = mapping[gid];
          const d = did ? districtsByIdRef.current.get(did) : null;
          if (d) color = scoreColor(getLayerScore(d, layer));
        }
        f.properties.__color = color;
      }

      map.addSource('districts', { type: 'geojson', data: gadmData });

      // Fill
      map.addLayer({
        id: 'district-fills',
        type: 'fill',
        source: 'districts',
        paint: {
          'fill-color': ['get', '__color'],
          'fill-opacity': 0.85,
        },
      });

      // District border — thin white line, thickens on zoom
      map.addLayer({
        id: 'district-lines',
        type: 'line',
        source: 'districts',
        paint: {
          'line-color': 'rgba(255,255,255,0.55)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 9, 1, 13, 1.5],
        },
      });

      // Selected district highlight — panel white fill + solid border
      map.addLayer({
        id: 'district-selected-fill',
        type: 'fill',
        source: 'districts',
        filter: ['==', ['get', 'GID_2'], ''],
        paint: { 'fill-color': 'rgba(255,255,255,0.92)', 'fill-opacity': 1 },
      });
      map.addLayer({
        id: 'district-selected-line',
        type: 'line',
        source: 'districts',
        filter: ['==', ['get', 'GID_2'], ''],
        paint: {
          'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 12, 3],
          'line-opacity': 1,
        },
      });

      // Fit to Malaysia
      const bounds = new LngLatBounds();
      for (const f of gadmData.features) {
        const rings: number[][][] = f.geometry.type === 'Polygon'
          ? f.geometry.coordinates
          : f.geometry.coordinates.flat(1);
        for (const ring of rings)
          for (const [lng, lat] of ring) bounds.extend([lng, lat]);
      }
      map.fitBounds(bounds, { padding: 20, duration: 0 });

      // Click
      map.on('click', 'district-fills', e => {
        if (!e.features?.length) return;
        const props = e.features[0].properties as any;
        const gid: string = props.GID_2;
        const stateName: string = GADM_TO_STATE[props.NAME_1] ?? props.NAME_1;

        if (viewLevelRef.current === 'state') {
          const agg = statesByNameRef.current.get(stateName);
          if (agg) onSelectRef.current(agg);
          onViewRef.current('district');

          // Zoom to state
          const sb = new LngLatBounds();
          for (const feat of gadmData.features) {
            if ((GADM_TO_STATE[feat.properties.NAME_1] ?? feat.properties.NAME_1) !== stateName) continue;
            const rings: number[][][] = feat.geometry.type === 'Polygon'
              ? feat.geometry.coordinates
              : feat.geometry.coordinates.flat(1);
            for (const ring of rings)
              for (const [lng, lat] of ring) sb.extend([lng, lat]);
          }
          if (!sb.isEmpty()) map.fitBounds(sb, { padding: 20, maxZoom: 9 });
        } else {
          const did = mapping[gid];
          onSelectRef.current(did ? (districtsByIdRef.current.get(did) ?? null) : null);

          // Zoom to feature
          const fb = new LngLatBounds();
          const geom = e.features[0].geometry as any;
          const rings: number[][][] = geom.type === 'Polygon'
            ? geom.coordinates
            : geom.coordinates.flat(1);
          for (const ring of rings)
            for (const [lng, lat] of ring) fb.extend([lng, lat]);
          if (!fb.isEmpty()) map.fitBounds(fb, { padding: 40, maxZoom: 8 });
        }
      });

      // Hover — use mousemove so adjacent districts update without a gap
      map.on('mousemove', 'district-fills', e => {
        map.getCanvas().style.cursor = 'pointer';
        if (!e.features?.length) return;
        const props = e.features[0].properties as any;
        const gid: string = props.GID_2;
        const stateName: string = GADM_TO_STATE[props.NAME_1] ?? props.NAME_1;
        const item = viewLevelRef.current === 'state'
          ? statesByNameRef.current.get(stateName)
          : (mappingRef.current[gid] ? districtsByIdRef.current.get(mappingRef.current[gid]) : null);
        onHoverRef.current(item ?? null);
      });

      map.on('mouseleave', 'district-fills', () => {
        map.getCanvas().style.cursor = '';
        onHoverRef.current(null);
      });
      } catch (err) {
        console.error('[MapView] onMapLoad error:', err);
      }
    };

    if (map.isStyleLoaded()) {
      onMapLoad();
    } else {
      map.once('load', onMapLoad);
    }

    return () => {
      mounted = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Re-color whenever view level, layer, or data changes
  useEffect(() => {
    pushColors();
  }, [viewLevel, selectedLayer, districts]);

  // Highlight selected district on the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer('district-selected-fill')) return;
    const gid = selectedDistrict ? (reverseMappingRef.current[selectedDistrict.id] ?? '') : '';
    const filter: any = ['==', ['get', 'GID_2'], gid];
    map.setFilter('district-selected-fill', filter);
    map.setFilter('district-selected-line', filter);
  }, [selectedDistrict]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  );
}
