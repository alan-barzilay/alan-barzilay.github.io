// ============================================================
// TUNNEL GEOMETRY LOADER — fetches the precomputed tube wireframes.
// ------------------------------------------------------------
// Kept three.js-free and separate from tunnelScene.js for ONE reason: so this
// fetch can fire in PARALLEL with the (heavy) three.js chunk download instead
// of waiting behind it. If this lived inside tunnelScene.js the fetch couldn't
// start until that chunk had downloaded AND parsed.
//
// The asset is gzip-compressed at build time (the GH Pages CDN won't compress
// application/octet-stream), so we inflate it natively here with
// DecompressionStream. The virtual module supplies the hashed URL and the two
// array lengths so we can slice the single inflated buffer into zero-copy
// Float32Array views ([wf1][wf2]).
// ============================================================
import { geometryUrl, len1, len2 } from 'virtual:tunnel-geometry';

export async function loadTunnelGeometry() {
  const res = await fetch(geometryUrl);
  const buf = await new Response(
    res.body.pipeThrough(new DecompressionStream('gzip'))
  ).arrayBuffer();
  return {
    // len1*4 is always a multiple of 4, and a fetched ArrayBuffer starts at
    // offset 0, so both views are 4-byte aligned (Float32Array requires it).
    tubeWF1: new Float32Array(buf, 0, len1),
    tubeWF2: new Float32Array(buf, len1 * 4, len2),
  };
}
