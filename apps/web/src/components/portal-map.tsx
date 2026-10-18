'use client';
// Generic MapLibre map for the admin panel: coloured polygons (optionally clickable) and markers
// (optionally draggable). OpenStreetMap raster tiles.
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { maplibregl } from '@/lib/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';

export interface MapArea {
  id: string;
  geometry: Polygon | MultiPolygon;
  color: string;
  opacity?: number;
  outline?: string;
}

export interface MapPin {
  id: string;
  lat: number;
  lon: number;
  color: string;
  label: string;
  draggable?: boolean;
}

export function PortalMap({
  areas = [],
  pins = [],
  onAreaClick,
  onPinMoved,
  center = [101.0, 4.65],
  zoom = 7.2,
  height = 'h-[460px]',
}: {
  areas?: MapArea[];
  pins?: MapPin[];
  onAreaClick?: (id: string) => void;
  onPinMoved?: (id: string, lat: number, lon: number) => void;
  center?: [number, number];
  zoom?: number;
  height?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const handlers = useRef({ onAreaClick, onPinMoved });
  useEffect(() => {
    handlers.current = { onAreaClick, onPinMoved };
  });

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
            maxzoom: 19,
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center,
      zoom,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      m.addSource('areas', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({
        id: 'area-fill',
        type: 'fill',
        source: 'areas',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['get', 'opacity'] },
      });
      m.addLayer({
        id: 'area-line',
        type: 'line',
        source: 'areas',
        paint: { 'line-color': ['get', 'outline'], 'line-width': 1.2 },
      });
      m.on('click', 'area-fill', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id != null) handlers.current.onAreaClick?.(String(id));
      });
      m.on('mouseenter', 'area-fill', () => {
        if (handlers.current.onAreaClick) m.getCanvas().style.cursor = 'pointer';
      });
      m.on('mouseleave', 'area-fill', () => (m.getCanvas().style.cursor = ''));
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // The map is created once; layers update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polygons
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const data = {
      type: 'FeatureCollection' as const,
      features: areas.map((a): Feature => ({
        type: 'Feature',
        properties: {
          id: a.id,
          color: a.color,
          opacity: a.opacity ?? 0.4,
          outline: a.outline ?? '#334155',
        },
        geometry: a.geometry,
      })),
    };
    const apply = () =>
      (m.getSource('areas') as maplibregl.GeoJSONSource | undefined)?.setData(data);
    if (m.getSource('areas')) apply();
    // Before the style loads: this listener runs after the one above that adds the source.
    else m.once('load', apply);
  }, [areas]);

  // Markers
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const mk of markers.current) mk.remove();
    markers.current = pins.map((p) => {
      const dot = document.createElement('div');
      dot.title = p.label;
      dot.setAttribute('aria-label', p.label);
      dot.style.cssText = `width:14px;height:14px;border-radius:50%;background:${p.color};border:2px solid #fff;box-shadow:0 0 0 1px #0005;cursor:${p.draggable ? 'grab' : 'default'}`;
      const mk = new maplibregl.Marker({ element: dot, draggable: !!p.draggable })
        .setLngLat([p.lon, p.lat])
        .setPopup(new maplibregl.Popup({ offset: 10 }).setText(p.label))
        .addTo(m);
      if (p.draggable) {
        mk.on('dragend', () => {
          const { lat, lng } = mk.getLngLat();
          handlers.current.onPinMoved?.(p.id, lat, lng);
        });
      }
      return mk;
    });
  }, [pins]);

  return (
    <div
      ref={el}
      className={`${height} overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800`}
    />
  );
}
