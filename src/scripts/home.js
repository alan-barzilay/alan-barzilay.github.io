import { runAutoplay } from './landing/boot.js';
import TunnelWorker from './landing/tunnelWorker.js?worker';
import { PHASES, TEST, CHAPTERS, QUALITY_DEFAULTS } from './landing/config.js';

// ============================================================
// MAIN-THREAD HOST for the landing page.
// ------------------------------------------------------------
// Owns everything that is intrinsically main-thread: the DOM (cards, progress
// bar, vapor/tunnel styles), scroll input, and the boot/splash autoplay. The
// tunnel + starfield rendering lives in the shared scene module
// (./landing/tunnelScene.js), driven EITHER:
//   · off the main thread in an OffscreenCanvas worker (preferred), or
//   · on the main thread as a fallback (createTunnelScene here) where
//     OffscreenCanvas is unavailable.
// Either way the scene emits the same DOM-style updates, which this host
// applies through applyDomUpdate()/applyShift().
// ============================================================

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

let introCancelled = false;
let introPlaying = true;
let renderTunnel = false;
window.TEST = TEST;

// ============================================================
// QUALITY / performance knobs — tunable live + overridable from the URL:
//   ?dpr=1        force the pixel-ratio cap (range 0.5–3). lower = faster + softer
//   ?starscale=0.75   resolution multiplier for the 2D starfield (0.4–2)
//   ?stats        show a live FPS / DPR / active-layer overlay
// In the console you can also set e.g. QUALITY.dprCap = 1 then QUALITY.apply().
// ============================================================
const QUALITY = { ...QUALITY_DEFAULTS };
(function () {
  const q = new URLSearchParams(location.search);
  if (q.has('dpr'))       QUALITY.dprCap    = Math.max(0.5, Math.min(3, parseFloat(q.get('dpr'))       || 1.5));
  if (q.has('starscale')) QUALITY.starScale = Math.max(0.4, Math.min(2, parseFloat(q.get('starscale')) || 1));
})();
// DPR CLAMP — effective device-pixel-ratio = the real DPR, capped (used here for
// the stats overlay; the scene caps the raw DPR it is handed the same way).
function effDPR() { return Math.min(window.devicePixelRatio || 1, QUALITY.dprCap); }
window.QUALITY = QUALITY;

// cached viewport size — refreshed on resize
let viewW = window.innerWidth, viewH = window.innerHeight;

// reassignable: a failed worker transfer leaves these canvases dead (control
// already handed off), so the fallback replaces them with fresh nodes.
let tunnelCanvas = document.getElementById('tunnel-canvas');
let starCanvas = document.getElementById('showcase-canvas');

// ?offscreen=0 forces the main-thread fallback renderer even where OffscreenCanvas
// is supported — used to exercise/verify the fallback path on modern browsers.
const offscreenAllowed = new URLSearchParams(location.search).get('offscreen') !== '0';
const supportsOffscreen = offscreenAllowed && !!(window.OffscreenCanvas && tunnelCanvas.transferControlToOffscreen && starCanvas.transferControlToOffscreen);

let worker = null;
let sceneApi = null;   // set when the main-thread fallback scene is running
let autoplayDom = null; // the boot/splash DOM refs, kept live across a fallback canvas swap

// ---- DOM references for the scene's style output ----
const vaporEl = document.getElementById('vapor');
const vaporContentEl = document.querySelector('.vapor-content');
const vaporGlowEl = document.getElementById('vaporGlow');
const topEl   = document.getElementById('top');
const tunnelUIEl = document.getElementById('tunnel-ui');

// ============================================================
// DOM OUTPUT APPLIERS — the single place style state from the scene is written
// to the DOM, used by BOTH the worker's messages and the main-thread scene's
// callbacks. Per-field change detection skips redundant style writes (most
// fields are constant for long stretches of the scroll).
// ============================================================
let lastHideNav = null, lastTunnelOpacity = -1, lastVaporVis = '', lastVaporOpacity = '';
let lastMask = '', lastCe = -1, lastGlow = -1;
function applyDomUpdate(s) {
  if (s.hideNav !== lastHideNav) {
    lastHideNav = s.hideNav;
    if (topEl) topEl.classList.toggle('hide-nav', s.hideNav);
  }
  if (s.tunnelOpacity !== lastTunnelOpacity) {
    lastTunnelOpacity = s.tunnelOpacity;
    tunnelCanvas.style.opacity = s.tunnelOpacity;
    tunnelUIEl.style.opacity = s.tunnelOpacity;
  }
  if (s.vaporVisibility !== lastVaporVis) {
    lastVaporVis = s.vaporVisibility;
    vaporEl.style.visibility = s.vaporVisibility;
  }
  if (s.vaporOpacity !== lastVaporOpacity) {
    lastVaporOpacity = s.vaporOpacity;
    vaporEl.style.opacity = s.vaporOpacity;
  }
  if (s.mask !== lastMask) {
    lastMask = s.mask;
    vaporEl.style.webkitMaskImage = s.mask;
    vaporEl.style.maskImage = s.mask;
  }
  if (s.contentRise !== lastCe) {
    lastCe = s.contentRise;
    vaporContentEl.style.transform = `translateY(${(1 - s.contentRise) * 110}px)`;
    vaporContentEl.style.opacity = s.contentRise;
  }
  if (s.glow !== lastGlow) {
    lastGlow = s.glow;
    vaporGlowEl.style.opacity = s.glow;
  }
}
function applyShift(x, y) {
  starCanvas.style.transform = x === null ? '' : `translate(${x}px, ${y}px)`;
}

// ============================================================
// OPTIONAL ?stats OVERLAY — fed by the scene (fallback) or worker (offscreen).
// ============================================================
let statsEl = null;
if (new URLSearchParams(location.search).has('stats')) {
  statsEl = document.createElement('div');
  statsEl.style.cssText = 'position:fixed;top:8px;left:8px;z-index:200;font:11px/1.55 ui-monospace,monospace;color:#6fc89a;background:rgba(7,12,10,.82);border:1px solid rgba(111,200,154,.35);padding:7px 10px;border-radius:5px;white-space:pre;pointer-events:none';
  document.body.appendChild(statsEl);
}
function showStats(d) {
  if (!statsEl) return;
  const sScale = (effDPR() * QUALITY.starScale).toFixed(2);
  const starInfo = d.starCount != null ? `${d.starCount} rays` : 'offscreen';
  statsEl.textContent =
    `fps    ${d.fps}\n` +
    `dprCap ${QUALITY.dprCap}  → eff ${effDPR().toFixed(2)}\n` +
    `device ${(window.devicePixelRatio || 1).toFixed(2)}\n` +
    `star   ${sScale}×  (${starInfo})\n` +
    `scroll ${d.scroll}%\n` +
    `layers ${d.layers}`;
}

// ============================================================
// RENDERER WIRING — worker (preferred) or main-thread fallback.
// ============================================================
if (supportsOffscreen) {
  worker = new TunnelWorker();
  const offscreenTunnel = tunnelCanvas.transferControlToOffscreen();
  const offscreenStar = starCanvas.transferControlToOffscreen();
  worker.postMessage({
    type: 'init',
    canvas: offscreenTunnel,
    starCanvas: offscreenStar,
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
  }, [offscreenTunnel, offscreenStar]);

  worker.onmessage = (e) => {
    const data = e.data;
    if (data.type === 'domUpdate') {
      applyDomUpdate(data);
    } else if (data.type === 'shift') {
      applyShift(data.clear ? null : data.x, data.y);
    } else if (data.type === 'stats') {
      showStats(data);
    } else if (data.type === 'initError') {
      // the worker couldn't bring up WebGL — recover on the main thread
      fallbackToMainThread();
    }
  };
  // backstop for any uncaught worker error not surfaced as an initError message
  worker.onerror = () => fallbackToMainThread();
}

// Boot the main-thread fallback scene. three.js + the scene module are loaded
// dynamically so they never reach the main bundle when the worker handles
// rendering. Returns a promise that resolves once the scene is live.
async function initMainThread() {
  if (sceneApi) return sceneApi;
  const { createTunnelScene } = await import('./landing/tunnelScene.js');
  sceneApi = createTunnelScene({
    tunnelCanvas,
    starCanvas,
    width: viewW,
    height: viewH,
    dpr: window.devicePixelRatio || 1,
    quality: QUALITY,
    onDomUpdate: applyDomUpdate,
    onShift: applyShift,
    onShadersReady: () => {},
    onStats: showStats,
  });
  return sceneApi;
}

// Recover from a worker that failed to initialize (or crashed): the canvases
// were already transferred to the worker, so they can't be drawn to on the main
// thread — replace them with fresh nodes, then bring up the main-thread scene.
// renderTunnel / introPlaying carry the current autoplay state, so the scene
// picks up wherever the boot sequence currently is.
let fellBack = false;
function fallbackToMainThread() {
  if (fellBack || !supportsOffscreen) return;
  fellBack = true;
  if (worker) { worker.terminate(); worker = null; }
  tunnelCanvas = replaceCanvas(tunnelCanvas);
  starCanvas = replaceCanvas(starCanvas);
  // boot.js reveals the tunnel by setting opacity on its captured canvas ref —
  // keep it pointing at the live node so the swap doesn't leave it blank.
  if (autoplayDom) autoplayDom.canvas = tunnelCanvas;
  // the fresh canvases start from their CSS defaults — reset the change-detection
  // caches so the scene's first frame writes every style afresh onto them.
  lastHideNav = null; lastTunnelOpacity = -1; lastVaporVis = ''; lastVaporOpacity = '';
  lastMask = ''; lastCe = -1; lastGlow = -1;
  initMainThread();
}
function replaceCanvas(oldEl) {
  const fresh = document.createElement('canvas');
  fresh.id = oldEl.id;
  fresh.className = oldEl.className;
  oldEl.replaceWith(fresh);
  return fresh;
}

// ============================================================
// CARD STAGE + progress ticks (DOM, always main-thread)
// ============================================================
const stageEl = document.getElementById('cardStage');
CHAPTERS.forEach((ch, i) => {
  const moreHtml = ch.more ? `<details class="more"><summary>read more</summary>
    <dl>${ch.more.map(item => {
      if (Array.isArray(item)) {
        return `<dt>${item[0]}</dt><dd>${item[1]}</dd>`;
      } else {
        return `<dd style="grid-column: 1 / -1;">· ${item}</dd>`;
      }
    }).join("")}</dl>
  </details>` : '';
  const html = `<div class="chapter ${ch.pos}" data-i="${i}">
    <div class="idx">${String(i+1).padStart(2,"0")} · ${ch.label}</div>
    <h2>${ch.head}</h2>
    <p>${ch.lede}</p>
    ${moreHtml}
  </div>`;
  stageEl.insertAdjacentHTML('beforeend', html);
});

CHAPTERS.forEach((ch) => {
  const t = document.createElement('div');
  t.className = 'chapter-tick';
  t.style.left = (ch.at * 100) + '%';
  document.getElementById('track').appendChild(t);
});

// ============================================================
// SCROLL DRIVER
// ============================================================
let scrollP = 0, smoothP = 0;
let scrollMax = 1;
// scrollHeight is layout-stable here (fixed 1000vh scroller) — measure it on
// load/resize instead of forcing a layout read on EVERY scroll event
function updateScrollMax() { scrollMax = Math.max(1, document.body.scrollHeight - window.innerHeight); }
function updateScroll() {
  scrollP = Math.max(0, Math.min(1, window.scrollY / scrollMax));
  if (scrollP > 0) {
    const hint = document.getElementById('hint');
    if (hint) hint.classList.remove('on');
  }
  if (worker) worker.postMessage({ type: 'scroll', p: scrollP });
}

function setupInteractionListeners() {
  window.addEventListener('scroll', updateScroll, { passive: true });

  const trackEl = document.getElementById('track');
  if (trackEl) {
    trackEl.addEventListener('click', (e) => {
      const rect = trackEl.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      updateScrollMax();
      window.scrollTo({ top: pct * scrollMax, behavior: 'smooth' });
    });
  }
}

window.addEventListener('resize', () => {
  viewW = window.innerWidth; viewH = window.innerHeight;
  updateScrollMax();
  updateScroll();
  if (worker) {
    worker.postMessage({ type: 'resize', width: viewW, height: viewH, dpr: window.devicePixelRatio || 1 });
  } else if (sceneApi) {
    sceneApi.resize(viewW, viewH, window.devicePixelRatio || 1);
  }
});
updateScrollMax();
updateScroll();

// ============================================================
// CHAPTER / PROGRESS UI (DOM, always main-thread)
// ============================================================
const cards = document.querySelectorAll('.chapter');
const pCurEl = document.getElementById('pCur');
let lastActive = -1;
function setActiveChapter(i) {
  cards.forEach((c, k) => c.classList.toggle('in', k === i));
  pCurEl.textContent = `CH ${String(i+1).padStart(2,"0")}`;
}
function activeChapterFromP(p) {
  if (p > PHASES.tunnelEnd) return -1;
  let best = 0, bd = Infinity;
  for (let i = 0; i < CHAPTERS.length; i++) {
    const d = Math.abs(CHAPTERS[i].at - p);
    if (d < bd) { bd = d; best = i; }
  }
  if (bd > 0.08) return -1; // too far from any chapter — fade out (no lingering last card)
  return best;
}

const pFill = document.getElementById('pFill');
const pPct = document.getElementById('pPct');
let lastFillW = '', lastPct = -1;

// Re-apply quality settings after changing QUALITY.* live from the console.
QUALITY.apply = function () {
  if (sceneApi) sceneApi.applyQuality();
};

// ============================================================
// MAIN-THREAD FRAME LOOP — always runs: drives the cards/progress UI and
// smooths the scroll position. When the fallback scene is active it also
// renders one scene frame; in worker mode the worker renders independently.
// ============================================================
function frame(ts) {
  // DELTA-TIME — ms since the previous frame, normalised so 1.0 == one 60fps
  // tick, so motion runs at the same real-world speed regardless of refresh rate.
  const nowMs = ts || performance.now();
  let dt = (nowMs - (frame._last || nowMs)) / 16.667;
  frame._last = nowMs;
  if (dt > 4) dt = 4;      // clamp big gaps (backgrounded tab) so nothing teleports
  if (dt <= 0) dt = 1;

  smoothP += (scrollP - smoothP) * (1 - Math.pow(1 - 0.07, dt));
  // snap when settled — stops sub-pixel mask/progress churn while idle
  if (Math.abs(scrollP - smoothP) < 0.00002) smoothP = scrollP;
  const p = smoothP;

  if (sceneApi) sceneApi.renderFrame(nowMs, dt, p, renderTunnel, introPlaying);

  const ac = activeChapterFromP(p);
  if (ac >= 0 && ac !== lastActive) {
    setActiveChapter(ac); lastActive = ac;
  } else if (ac < 0 && lastActive !== -1) {
    cards.forEach(c => c.classList.remove('in'));
    lastActive = -1;
  }

  const fillW = (p * 100).toFixed(1) + '%';
  if (fillW !== lastFillW) { lastFillW = fillW; pFill.style.width = fillW; }
  const pctNow = Math.round(p * 100);
  if (pctNow !== lastPct) { lastPct = pctNow; pPct.textContent = pctNow + '%'; }

  requestAnimationFrame(frame);
}

// Kick off the fallback scene (if needed) and then the UI loop.
if (!supportsOffscreen) {
  initMainThread();
}
frame();

// ============================================================
// AUTOPLAY INTRO (boot + splash, then hands control to scroll)
// ============================================================
function initAutoplay() {
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
  window.scrollTo(0, 0);
  updateScrollMax();
  updateScroll();

  // module-scoped so a fallback canvas swap can keep `canvas` pointing at the
  // live node (boot.js reveals the tunnel via dom.canvas.style.opacity)
  autoplayDom = {
    bootLog: document.getElementById('bootLog'),
    bootEl: document.getElementById('boot'),
    splashEl: document.getElementById('splash'),
    logoLeft: document.getElementById('logoLeft'),
    logoRight: document.getElementById('logoRight'),
    splashName: document.getElementById('splashName'),
    splashSub: document.getElementById('splashSub'),
    canvas: tunnelCanvas,
    tunnelUI: document.getElementById('tunnel-ui'),
    splashInner: document.getElementById('splashInner'),
    top: document.getElementById('top'),
    pbar: document.getElementById('pbar'),
    hint: document.getElementById('hint'),
  };

  const state = {
    get introCancelled() { return introCancelled; },
    set introCancelled(val) { introCancelled = val; },
    get introPlaying() { return introPlaying; },
    set introPlaying(val) {
      introPlaying = val;
      if (worker) worker.postMessage({ type: 'setIntroPlaying', val });
    },
  };

  const callbacks = {
    setRenderTunnel: (val) => {
      renderTunnel = val;
      if (worker) worker.postMessage({ type: 'setRenderTunnel', val });
    },
    onComplete: () => {
      setupInteractionListeners();
    }
  };

  setTimeout(() => runAutoplay(autoplayDom, state, callbacks), 200);
}

if (document.readyState !== 'loading') {
  initAutoplay();
} else {
  window.addEventListener('load', initAutoplay);
}
