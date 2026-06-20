/// <reference path="../.astro/types.d.ts" />

// Precomputed tunnel wireframe geometry, generated at build time by the
// tunnel-geometry Vite plugin (see astro.config.mjs).
declare module 'virtual:tunnel-geometry' {
  export const tubeWF1: Float32Array;
  export const tubeWF2: Float32Array;
}
