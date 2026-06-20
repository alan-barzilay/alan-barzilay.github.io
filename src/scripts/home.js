import { runAutoplay } from './landing/boot.js';
import { PHASES, CONFIG, CHAPTERS } from './landing/config.js';

// ============================================================
// MAIN-THREAD HOST for the landing page.
// ------------------------------------------------------------
// Owns everything that is intrinsically main-thread: the DOM (cards, progress
// bar, vapor/tunnel styles), scroll input, and the boot/splash autoplay. The
// tunnel + starfield rendering lives in the shared scene module
// (./landing/tunnelScene.js), which is dynamically imported and driven on the
// main thread (createTunnelScene). The scene emits DOM-style updates, which
// this host applies through applyDomUpdate().
// ============================================================

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

let introCancelled = false;
let introPlaying = true;
let renderTunnel = false;
window.CONFIG = CONFIG;

// cached viewport size — refreshed on resize
let viewW = window.innerWidth, viewH = window.innerHeight;

const tunnelCanvas = document.getElementById('tunnel-canvas');
const starCanvas = document.getElementById('showcase-canvas');

let sceneApi = null;   // set once the dynamically-imported scene is live

// ---- SCENE-READY SIGNAL ----
// The intro autoplay must not reveal the tunnel canvas (or run its GPU "warm-up"
// frames) until the scene actually exists AND its shaders are compiled —
// otherwise the warm-up renders nothing and the first *visible* frame is the one
// that stalls. `initScene()` is async (it dynamically imports three.js), so we
// expose a promise the autoplay can await. It resolves when the scene fires
// `onShadersReady`, and — as a guard against a failed/slow import wedging the
// page in its locked intro forever — on a timeout or import error too.
let resolveSceneReady;
const sceneReady = new Promise((res) => { resolveSceneReady = res; });
const markSceneReady = () => { if (resolveSceneReady) { resolveSceneReady(); resolveSceneReady = null; } };
setTimeout(markSceneReady, 3000);

// ---- DOM references for the scene's style output ----
const vaporEl = document.getElementById('vapor');
const vaporContentEl = document.querySelector('.vapor-content');
const topEl   = document.getElementById('top');
const tunnelUIEl = document.getElementById('tunnel-ui');

// ============================================================
// DOM OUTPUT APPLIER — the single place style state from the scene is written
// to the DOM, wired up as the scene's onDomUpdate callback. Per-field change
// detection skips redundant style writes (most fields are constant for long
// stretches of the scroll).
// ============================================================
let lastHideNav = null, lastTunnelOpacity = -1, lastVaporVis = '', lastVaporOpacity = '';
let lastMask = '', lastCe = -1;
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
}

// ============================================================
// RENDERER WIRING — main-thread scene.
// ------------------------------------------------------------
// three.js + the scene module are loaded dynamically so they stay out of the
// main bundle (and the heavy precomputed tube geometry rides along in that lazy
// chunk). Returns a promise that resolves once the scene is live.
// ============================================================
async function initScene() {
  try {
    const { createTunnelScene } = await import('./landing/tunnelScene.js');
    sceneApi = createTunnelScene({
      tunnelCanvas,
      starCanvas,
      width: viewW,
      height: viewH,
      dpr: window.devicePixelRatio || 1,
      onDomUpdate: applyDomUpdate,
      onShadersReady: markSceneReady,
    });
    return sceneApi;
  } catch (err) {
    // Don't let a failed import wedge the intro: release the gate so the
    // autoplay still completes and unlocks scroll (the page just renders
    // without the tunnel).
    console.error('tunnel scene failed to load', err);
    markSceneReady();
    return null;
  }
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
  if (sceneApi) sceneApi.resize(viewW, viewH, window.devicePixelRatio || 1);
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

// ============================================================
// MAIN-THREAD FRAME LOOP — drives the cards/progress UI, smooths the scroll
// position, and (once the scene is live) renders one scene frame per tick.
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

// Kick off the scene, then the UI loop (which renders it once it's live).
initScene();
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

  // boot.js reveals the tunnel via dom.canvas.style.opacity
  const autoplayDom = {
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
    set introPlaying(val) { introPlaying = val; },
  };

  const callbacks = {
    setRenderTunnel: (val) => { renderTunnel = val; },
    // gate the GPU warm-up + canvas reveal on the scene being live & compiled
    whenSceneReady: () => sceneReady,
    onComplete: () => {
      // Hand off to scroll EXACTLY where the page physically is. The intro keeps
      // scrollY pinned at 0 (scroll is locked), so this is normally a no-op — but
      // snapping smoothP to scrollP here guarantees the tube starts 1:1 with the
      // scrollbar instead of easing across a stale gap, so the first scroll input
      // gets an immediate response rather than a delayed catch-up sweep.
      updateScrollMax();
      updateScroll();
      smoothP = scrollP;
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
