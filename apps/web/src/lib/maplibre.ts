// MapLibre with its worker served from public/maplibre (copied by scripts/copy-maplibre-worker.mjs).
// Turbopack bundles maplibre-gl away from its worker file, so the default worker URL 404s.
import * as maplibregl from 'maplibre-gl';

const WORKER_URL = `/maplibre/maplibre-gl-worker.mjs?v=${maplibregl.getVersion()}`;

if (typeof window !== 'undefined' && maplibregl.getWorkerUrl() !== WORKER_URL) {
  maplibregl.setWorkerUrl(WORKER_URL);
}

export { maplibregl };
