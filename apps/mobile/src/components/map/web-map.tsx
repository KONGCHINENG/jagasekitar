// The map used by every screen: Leaflet in a WebView with OpenStreetMap tiles.
// Why not react-native-maps: in Expo Go on Android it uses Google Maps with Expo Go's own key, and
// on some phones that map draws nothing at all (black, no tiles, no polygons). Leaflet needs no key,
// works in Expo Go and in builds, and looks the same on Android and iOS.
// Screens pass plain data (polygons, lines, markers); taps come back as ids.
import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export type LatLng = { latitude: number; longitude: number };
export type Region = LatLng & { latitudeDelta: number; longitudeDelta: number };
export type Padding = { top: number; bottom: number; left: number; right: number };

export interface MapPolygon {
  id: string;
  /** Outer ring first, then holes. */
  rings: LatLng[][];
  fill: string;
  stroke: string;
  width: number;
}
export interface MapLine {
  id: string;
  coords: LatLng[];
  color: string;
  width: number;
}
export interface MapMarker {
  id: string;
  latitude: number;
  longitude: number;
  /** Marker body as HTML (inline styles). Use escapeHtml for any text from data. */
  html: string;
  /** Box size in px; the marker is centred on its coordinate. */
  size: number;
  /** Plain text shown in a popup when tapped. */
  popup?: string;
  /** Send taps to onPress. */
  pressable?: boolean;
}

export interface WebMapHandle {
  animateToRegion: (region: Region) => void;
}

export interface WebMapProps {
  ref?: Ref<WebMapHandle>;
  style?: StyleProp<ViewStyle>;
  /** Where the map starts. */
  initialRegion?: Region;
  /** Controlled view: the map refits whenever this changes. */
  region?: Region;
  /** Screen space covered by floating UI, so fits and recentring keep content visible. */
  padding?: Padding;
  polygons?: MapPolygon[];
  lines?: MapLine[];
  markers?: MapMarker[];
  /** Blue "you are here" dot. */
  user?: LatLng | null;
  onPress?: (id: string) => void;
  onRegionChangeComplete?: (center: LatLng) => void;
}

const NO_PADDING: Padding = { top: 0, bottom: 0, left: 0, right: 0 };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const ll = (p: LatLng) => [round(p.latitude), round(p.longitude)];
const round = (n: number) => Math.round(n * 1e5) / 1e5;

export function WebMap({
  ref,
  style,
  initialRegion,
  region,
  padding = NO_PADDING,
  polygons,
  lines,
  markers,
  user,
  onPress,
  onRegionChangeComplete,
}: WebMapProps) {
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const sent = useRef<{ layers?: string; padding?: string; region?: string }>({});
  // Kept in refs so the message handler always sees the latest callbacks.
  const handlers = useRef({ onPress, onRegionChangeComplete });
  useEffect(() => {
    handlers.current = { onPress, onRegionChangeComplete };
  });

  const layers = useMemo(
    () =>
      JSON.stringify({
        polygons: (polygons ?? []).map((p) => ({
          id: p.id,
          rings: p.rings.map((r) => r.map(ll)),
          fill: p.fill,
          stroke: p.stroke,
          width: p.width,
        })),
        lines: (lines ?? []).map((l) => ({ ...l, coords: l.coords.map(ll) })),
        markers: markers ?? [],
        user: user ? ll(user) : null,
      }),
    [polygons, lines, markers, user],
  );
  const paddingJson = JSON.stringify(padding);
  const regionJson = region ? JSON.stringify(region) : undefined;

  const run = (js: string) => web.current?.injectJavaScript(`${js};true;`);

  // Push only what changed since the last send (and nothing until the page is ready).
  const flush = () => {
    if (!ready.current) return;
    if (sent.current.padding !== paddingJson) {
      run(`window.jaga.setPadding(${paddingJson})`);
      sent.current.padding = paddingJson;
    }
    if (regionJson && sent.current.region !== regionJson) {
      run(`window.jaga.fit(${regionJson}, ${sent.current.region ? 'true' : 'false'})`);
      sent.current.region = regionJson;
    }
    if (sent.current.layers !== layers) {
      run(`window.jaga.draw(${layers})`);
      sent.current.layers = layers;
    }
  };
  useEffect(flush);

  useImperativeHandle(ref, () => ({
    animateToRegion: (r: Region) => run(`window.jaga.fit(${JSON.stringify(r)}, true)`),
  }));

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { type: string; id?: string; latitude?: number; longitude?: number };
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      ready.current = true;
      sent.current = {};
      run(`window.jaga.setPadding(${paddingJson})`);
      sent.current.padding = paddingJson;
      const start = region ?? initialRegion;
      if (start) run(`window.jaga.fit(${JSON.stringify(start)}, false)`);
      sent.current.region = regionJson;
      flush();
    } else if (msg.type === 'press' && msg.id) {
      handlers.current.onPress?.(msg.id);
    } else if (msg.type === 'move' && msg.latitude != null && msg.longitude != null) {
      handlers.current.onRegionChangeComplete?.({
        latitude: msg.latitude,
        longitude: msg.longitude,
      });
    }
  };

  return (
    <View style={style}>
      <WebView
        ref={web}
        style={styles.web}
        source={{ html: PAGE }}
        originWhitelist={['*']}
        onMessage={onMessage}
        setSupportMultipleWindows={false}
        overScrollMode="never"
        bounces={false}
        scrollEnabled={false}
        // A crashed/killed renderer: reload and redraw everything.
        onRenderProcessGone={() => {
          ready.current = false;
          web.current?.reload();
        }}
        onContentProcessDidTerminate={() => {
          ready.current = false;
          web.current?.reload();
        }}
      />
    </View>
  );
}

/** Required basemap credit; place it in a visible corner of the map. */
export function MapCredit({ style }: { style?: object }) {
  return (
    <Text style={[styles.credit, style]} accessibilityElementsHidden>
      © OpenStreetMap contributors · HOT, OSM France
    </Text>
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: '#E5E7EB' },
  credit: {
    fontSize: 10,
    color: '#374151',
    backgroundColor: '#ffffffcc',
    paddingHorizontal: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
});

// Humanitarian OSM style (hosted by OSM France): no key, rivers and roads stand out under risk
// zones. (CARTO now needs a key; tile.openstreetmap.org blocks app traffic without a referer.)
const PAGE = `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #m { margin: 0; height: 100%; background: #E5E7EB; }
  .pin { background: none; border: none; display: flex; align-items: center; justify-content: center; }
  .leaflet-popup-content { font: 14px/1.4 system-ui, sans-serif; margin: 10px 12px; white-space: pre-line; }
</style>
</head><body><div id="m"></div>
<script>
(function () {
  function send(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  if (!window.L) { send({ type: 'error', message: 'leaflet failed to load' }); return; }
  var map = L.map('m', { zoomControl: false, attributionControl: false }).setView([4.6, 101.08], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
    subdomains: 'abc', maxZoom: 19,
  }).addTo(map);
  var group = L.layerGroup().addTo(map);
  var pad = { top: 0, bottom: 0, left: 0, right: 0 };

  function bounds(r) {
    return L.latLngBounds(
      [r.latitude - r.latitudeDelta / 2, r.longitude - r.longitudeDelta / 2],
      [r.latitude + r.latitudeDelta / 2, r.longitude + r.longitudeDelta / 2]
    );
  }
  function press(id) { return function (e) { L.DomEvent.stopPropagation(e); send({ type: 'press', id: id }); }; }

  window.jaga = {
    setPadding: function (p) { pad = p; },
    fit: function (r, animate) {
      map.fitBounds(bounds(r), {
        paddingTopLeft: [pad.left, pad.top],
        paddingBottomRight: [pad.right, pad.bottom],
        animate: !!animate,
      });
    },
    draw: function (s) {
      group.clearLayers();
      s.polygons.forEach(function (p) {
        L.polygon(p.rings, { color: p.stroke, weight: p.width, opacity: 1, fillColor: p.fill, fillOpacity: 1 })
          .on('click', press(p.id)).addTo(group);
      });
      s.lines.forEach(function (l) {
        L.polyline(l.coords, { color: l.color, weight: l.width, opacity: 1, lineCap: 'round', interactive: false })
          .addTo(group);
      });
      s.markers.forEach(function (m) {
        var mk = L.marker([m.latitude, m.longitude], {
          icon: L.divIcon({ html: m.html, className: 'pin', iconSize: [m.size, m.size] }),
          interactive: !!(m.pressable || m.popup), keyboard: false,
        });
        if (m.popup) { var box = document.createElement('div'); box.textContent = m.popup; mk.bindPopup(box); }
        if (m.pressable) mk.on('click', press(m.id));
        mk.addTo(group);
      });
      if (s.user) {
        L.circleMarker(s.user, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563EB', fillOpacity: 1, interactive: false })
          .addTo(group);
      }
    },
  };
  map.on('moveend', function () {
    var c = map.getCenter();
    send({ type: 'move', latitude: c.lat, longitude: c.lng });
  });
  send({ type: 'ready' });
})();
</script></body></html>`;
