// @ts-check
import { fileURLToPath } from 'node:url';

// ============================================================
// virtual:tunnel-geometry — precompute the heavy tube wireframes at build time.
// ------------------------------------------------------------
// The two WireframeGeometry(TubeGeometry(...)) builds in tunnelScene.js are the
// single most expensive part of booting the landing scene (~510 ms, dominated
// by WireframeGeometry's edge dedup). The geometry is 100% deterministic (pure
// sin math + CONFIG bends, no Math.random), so we compute the vertex buffers
// here — with the SAME installed three the app bundles — and ship them as raw
// base64-encoded Float32Arrays.
//
// Recomputed from source on every build (and on demand in dev), so there is no
// persisted artifact to commit, regenerate, or keep in sync: it can never drift
// from centerline.js / config.js / the three version. Editing a watched input
// invalidates the module (addWatchFile). The module is imported by
// tunnelScene.js — itself dynamically imported — so it lands in the lazy chunk,
// never the main bundle.
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
      const wf1 = new THREE.WireframeGeometry(new THREE.TubeGeometry(curve, 800, 6, 16, false));
      const wf2 = new THREE.WireframeGeometry(new THREE.TubeGeometry(curve, 600, 6, 6, false));

      const encode = (attr) => {
        const a = attr.array; // Float32Array
        return Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
      };
      const b1 = encode(wf1.attributes.position);
      const b2 = encode(wf2.attributes.position);

      // Decode into a FRESH 0-offset buffer so the Float32Array view is 4-byte
      // aligned. base64 → bytes → Float32Array is ~1 ms for a few hundred KB.
      return `// AUTO-GENERATED at build time by the tunnel-geometry Vite plugin — do not edit.
function decode(s) {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
export const tubeWF1 = decode(${JSON.stringify(b1)});
export const tubeWF2 = decode(${JSON.stringify(b2)});
`;
    },
  };
}
