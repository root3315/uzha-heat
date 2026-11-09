import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

// MapLibre resolves its worker relative to its own module URL, which breaks once Vite
// pre-bundles or fingerprints it. Point it at the worker file Vite ships as an asset.
setWorkerUrl(workerUrl);
