// MapLibre loads its tile worker from a URL next to its own script, which Turbopack moves, so the
// browser reported "Worker failed to load". Copy the worker into public/ (matching the installed
// version) and point MapLibre at it with setWorkerUrl (src/lib/maplibre.ts). Runs before dev/build.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const dist = path.join(path.dirname(require.resolve('maplibre-gl/package.json')), 'dist');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'maplibre');
mkdirSync(out, { recursive: true });
copyFileSync(path.join(dist, 'maplibre-gl-worker.mjs'), path.join(out, 'maplibre-gl-worker.mjs'));
