// MapView with a basemap that loads everywhere. On Android, Expo Go's Google Maps tiles can fail to
// load (the map renders black with only overlays), so we draw free OpenStreetMap raster tiles
// instead. iOS keeps Apple Maps. Every map screen uses this so they all look the same.
import type { Ref } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import MapView, { UrlTile, type MapViewProps } from 'react-native-maps';

const ANDROID = Platform.OS === 'android';
// Humanitarian OSM style (hosted by OSM France): no key, rivers and roads stand out under risk
// zones. CARTO now needs a key, and tile.openstreetmap.org blocks the Android default user agent.
const TILES = 'https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png';

export function BaseMap({ ref, children, ...props }: MapViewProps & { ref?: Ref<MapView> }) {
  return (
    <MapView
      ref={ref}
      mapType={ANDROID ? 'none' : 'standard'}
      toolbarEnabled={false}
      showsMyLocationButton={false}
      {...props}
    >
      {ANDROID && <UrlTile urlTemplate={TILES} maximumZ={19} tileSize={256} zIndex={-1} />}
      {children}
    </MapView>
  );
}

/** Required credit for the Android basemap; place it in a visible corner of the map. */
export function MapCredit({ style }: { style?: object }) {
  if (!ANDROID) return null;
  return (
    <Text style={[styles.credit, style]} accessibilityElementsHidden>
      © OpenStreetMap contributors · HOT, OSM France
    </Text>
  );
}

const styles = StyleSheet.create({
  credit: {
    fontSize: 10,
    color: '#374151',
    backgroundColor: '#ffffffcc',
    paddingHorizontal: 4,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
});
