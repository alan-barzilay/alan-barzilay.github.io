// ============================================================
// OFFSCREENCANVAS WORKER — thin host around the shared tunnel scene.
// ------------------------------------------------------------
// Owns the worker side of the boundary only: receives the transferred
// canvases + control messages, runs the rAF loop with scroll smoothing, and
// forwards the scene's DOM-style output back to the main thread as messages.
// All rendering/simulation lives in tunnelScene.js (shared with the
// main-thread fallback in home.js).
// ============================================================
import { createTunnelScene } from './tunnelScene.js';

let sceneApi = null;
let renderTunnel = false;
let introPlaying = true;
let scrollP = 0;
let smoothP = 0;

function frame(ts) {
  const nowMs = ts || performance.now();
  let dt = (nowMs - (frame._last || nowMs)) / 16.667;
  frame._last = nowMs;
  if (dt > 4) dt = 4;      // clamp big gaps (backgrounded tab) so nothing teleports
  if (dt <= 0) dt = 1;

  smoothP += (scrollP - smoothP) * (1 - Math.pow(1 - 0.07, dt));
  if (Math.abs(scrollP - smoothP) < 0.00002) smoothP = scrollP; // snap when settled

  if (sceneApi) sceneApi.renderFrame(nowMs, dt, smoothP, renderTunnel, introPlaying);

  requestAnimationFrame(frame);
}

self.onmessage = function (e) {
  const data = e.data;
  switch (data.type) {
    case 'init':
      // WebGL context creation can fail inside a worker (driver/context limits,
      // blocklists, etc.). Catch it and tell the main thread so it can fall back
      // to the main-thread renderer — without this the transferred canvases
      // would be stuck blank with no recovery.
      try {
        sceneApi = createTunnelScene({
          tunnelCanvas: data.canvas,
          starCanvas: data.starCanvas,
          width: data.width,
          height: data.height,
          dpr: data.dpr,
          onDomUpdate: (s) => self.postMessage({
            type: 'domUpdate',
            hideNav: s.hideNav,
            tunnelOpacity: s.tunnelOpacity,
            vaporOpacity: s.vaporOpacity,
            vaporVisibility: s.vaporVisibility,
            mask: s.mask,
            contentRise: s.contentRise,
          }),
          onShadersReady: () => self.postMessage({ type: 'shadersReady' }),
        });
        requestAnimationFrame(frame);
      } catch (err) {
        self.postMessage({ type: 'initError', message: String((err && err.message) || err) });
      }
      break;

    case 'scroll':
      scrollP = data.p;
      break;

    case 'resize':
      if (sceneApi) sceneApi.resize(data.width, data.height, data.dpr);
      break;

    case 'setRenderTunnel':
      renderTunnel = data.val;
      break;

    case 'setIntroPlaying':
      introPlaying = data.val;
      break;
  }
};
