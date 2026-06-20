// @ts-check
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';

// ============================================================
// virtual:tunnel-geometry — precompute the heavy tube wireframes at build time.
// ------------------------------------------------------------
// The two WireframeGeometry(TubeGeometry(...)) builds in tunnelScene.js are the
// single most expensive part of booting the landing scene (~510 ms, dominated
// by WireframeGeometry's edge dedup). The geometry is 100% deterministic (pure
// sin math + CONFIG bends, no Math.random), so we compute the vertex buffers
// here — with the SAME installed three the app bundles — and write them to a
// pre-gzipped binary asset in public/. The browser fetches it and inflates it
// with DecompressionStream, so the costly atob loop AND the parse of a ~1.5 MB
// JS string literal at module-eval are both gone. (Pre-gzipping is required
// because the GH Pages CDN won't compress application/octet-stream.)
//
// Recomputed from source on every build (and on demand in dev), so there is no
// persisted artifact to commit, regenerate, or keep in sync: it can never drift
// from centerline.js / config.js / the three version. Editing a watched input
// invalidates the module (addWatchFile). The virtual module now exports only
// metadata (URL + the two array lengths); the loader (tunnelGeometry.js) slices
// the inflated buffer by those lengths, and the ?v=<hash> keeps the binary in
// lockstep with the code that slices it (so a returning visitor on GH Pages'
// 10-min cache can't pair new code with a stale buffer).
// ============================================================
export function tunnelGeometryPlugin() {
  const VIRTUAL_ID = 'virtual:tunnel-geometry';
  const RESOLVED_ID = '\0' + VIRTUAL_ID;
  const centerlinePath = fileURLToPath(new URL('./src/scripts/landing/centerline.js', import.meta.url));
  const configPath = fileURLToPath(new URL('./src/scripts/landing/config.js', import.meta.url));

  return {
    name: 'tunnel-geometry',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    async load(id) {
      if (id !== RESOLVED_ID) return;
      // recompute whenever a geometry input changes (dev HMR / rebuild)
      this.addWatchFile(centerlinePath);
      this.addWatchFile(configPath);

      const THREE = await import('three');
      const { currentCenterline } = await import('./src/scripts/landing/centerline.js');
      const { CONFIG } = await import('./src/scripts/landing/config.js');

      // Mirror tunnelScene.js buildTube() EXACTLY (same args → same vertex order).
      const curve = new THREE.CatmullRomCurve3(currentCenterline('v1d', CONFIG), false, 'catmullrom', 0.5);
      const p1 = new THREE.WireframeGeometry(new THREE.TubeGeometry(curve, 800, 6, 16, false)).attributes.position.array;
      const p2 = new THREE.WireframeGeometry(new THREE.TubeGeometry(curve, 600, 6, 6, false)).attributes.position.array;

      // Concatenate the two position buffers into one raw blob [wf1][wf2], then
      // pre-gzip it (the loader slices it back apart by len1/len2). Lengths are
      // DERIVED from the arrays — never hardcoded — so they can't drift.
      const raw = Buffer.allocUnsafe(p1.byteLength + p2.byteLength);
      Buffer.from(p1.buffer, p1.byteOffset, p1.byteLength).copy(raw, 0);
      Buffer.from(p2.buffer, p2.byteOffset, p2.byteLength).copy(raw, p1.byteLength);

      const gz = zlib.gzipSync(raw, { level: 9 });               // pre-compress; GH Pages won't
      const hash = createHash('sha256').update(gz).digest('hex').slice(0, 8);
      writeFileSync(fileURLToPath(new URL('./public/tunnel-geometry.bin', import.meta.url)), gz);

      return `export const geometryUrl = '/tunnel-geometry.bin?v=${hash}';
export const len1 = ${p1.length};
export const len2 = ${p2.length};
`;
    },
  };
}
