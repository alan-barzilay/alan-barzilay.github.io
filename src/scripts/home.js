import { runAutoplay } from './landing/boot.js';
import TunnelWorker from './landing/tunnelWorker.js?worker';

let THREE = null;
let currentCenterline = null;

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
window.scrollTo(0, 0);

// ============================================================
// PERF PASS (2026-06-12) — identical behaviour, leaner hot path:
//   · zero per-frame Vector3 allocations (scratch vectors + cached curve end)
//   · particle positions read from a curve LUT (was: 700 arc-length searches/frame)
//   · DOM nodes / 2D context looked up once, not per frame
//   · style/text writes skipped when the value hasn't changed
//   · boot-log typing appends incrementally (was: full innerHTML re-parse per char)
//   · scroll handler no longer reads scrollHeight per event
// ============================================================
// ============================================================
// PHASES — scroll only covers TUNNEL + VAPOR.
// Boot + splash are autoplay on page load.
// ============================================================
const PHASES = {
  tunnelIn:    0.00,
  tunnelOut:   0.85,   // camera reaches 0.92, then starts deceleration
  tunnelEnd:   0.93,   // camera reaches 0.998 (spline exit)
  tunnelFlash: 0.94,   // escape flash: tunnel canvas opacity fades to 0
  outroIn:     0.94,   // outro starts fading in
  outroFull:   0.98,   // outro reaches 1.00 opacity
};

// ============================================================
// TEST CONTROLS STATE — tweak speed & directions live
// ============================================================
const TEST = {
  starVelocity: 5,   // single starfield speed (no tiering)
  starDir: 1,        //  1 = forward (fly into stars)   · -1 = reverse (recede)
  starFocalY: 0.5,   // vertical position of the rays' vanishing point, as a fraction of canvas height (0 = top)
  contentRise: 0.92, // SCROLL position where the outro text/cards rise — later = more pure-starfield time before content appears
  particleDir: -1,   //  1 = forward (drift downstream)  · -1 = reverse (drift back)
  emerge: true,      // reveal the starfield out of the tube as we scroll
  emergeGlow: false, // optional lit-glow under the reveal — OFF
  emergeBehind: false,  // CHANGED: no longer using screen-blend since canvas is now transparent
  outroBgMatch: true,  // outro/starfield background uses the tube color (#070c0a) vs pure black
  // ---- single continuous reveal (replaces the tier system) ----
  // One starfield. We grow a soft circular mask, centred on the screen, from a
  // small radius to fullscreen as the camera scrolls toward the exit. Smoother
  // and more continuous than the old 3-step tiering.
  revealR0: 40,        // starting radius (px) of the reveal circle — small dot at the screen centre
  revealStartP: 0.82,  // SCROLL position where the reveal begins to open (default: right after the bend, when we're looking down the barrel)
  revealFullP: 0.905,  // SCROLL position where the reveal reaches fullscreen (default: right before the tube exit)
  revealAlign: 0.30,   // internal safety gate — suppress the reveal until we're roughly aligned down the barrel (kills bleed during the sharp bend)
  endBend: 50,         // sharp lateral bend added to the LAST stretch of the tube
  endBendStart: 0.92,  // where along the tube the end-bend begins (0..1)
  bendAngle: 90,       // direction of the bend in degrees (0=right, 90=up, 180=left, 270=down)
  // START BEND — mirror of the end-bend, on the FRONT of the tube (used by 1d).
  // Pushes the entrance sideways so the wall hides the distance at 0% scroll,
  // easing back to centre by `startBendLen` so the rest is revealed as the
  // camera rounds the lead-in bend. Live-tunable from the panel.
  startBend: 15,        // sharp lateral bend amount at the entrance (0 = off)  [FINAL]
  startBendLen: 0.10,   // how far down the tube the bend zone reaches (0..1)    [FINAL]
  startBendAngle: 260,  // direction in degrees (0=right, 90=up, 180=left, 270=down) [FINAL]
  // rays vs opening — how the starfield's vanishing point relates to the moving tube opening:
  //  'follow' — focal tracks the opening directly (original; trails smear while it moves)
  //  'fade'   — same as follow, but the trail fade strengthens while the focal moves (wipes stale streaks)
  //  'shift'  — focal fixed at canvas centre; the CANVAS element is translated onto the opening,
  //             so the trail history moves rigidly with the field (no smear, trails intact)
  //  'fixed'  — focal pinned at screen centre / focalY, never moves (mask alone tracks the opening)
  rayMode: 'fade',
  // 'fade' mode tuning:
  fadeBase: 0.18,  // trail fade at rest (higher = shorter trails everywhere)
  fadeGain: 0.05,  // how strongly focal-point motion increases the wipe (px of movement → extra fade)
  fadeMax:  0.85,  // cap on the wipe while moving (1 = full clear each frame, no trails during motion)
};
let introCancelled = false;
let introPlaying = true;
let renderTunnel = false;
let lastTCurve = 0;
let lastOpening = null;
// shared smoothed reveal centre (projected tube opening, low-passed) — drives
// BOTH the reveal mask and (optionally) the starfield rays' vanishing point.
let revealFocalX = null, revealFocalY = null, revealFocalValid = false;
let starVelMulCurrent = 0.30; // eased star-speed multiplier (slow → full as we near the end)
let alignSmooth = 0;          // low-passed camera→end alignment (kills per-frame jitter)
window.TEST = TEST;
// Boot sequence logic modularized to src/scripts/landing/boot.js

// ============================================================
// TUNNEL (three.js phosphor green) — scroll-driven
// ============================================================
// ============================================================
// QUALITY / performance knobs  — tunable live + overridable from the URL,
// so you can A/B different settings without editing code:
//   ?dpr=1        force the pixel-ratio cap (range 0.5–3). lower = faster + softer
//   ?starscale=0.75   resolution multiplier for the 2D starfield (0.4–2)
//   ?stats        show a live FPS / DPR / active-layer overlay
// In the console you can also set e.g. QUALITY.dprCap = 1 then QUALITY.apply().
// ============================================================
const QUALITY = { dprCap: 1.5, starScale: 1.0 };
(function () {
  const q = new URLSearchParams(location.search);
  if (q.has('dpr'))       QUALITY.dprCap    = Math.max(0.5, Math.min(3, parseFloat(q.get('dpr'))       || 1.5));
  if (q.has('starscale')) QUALITY.starScale = Math.max(0.4, Math.min(2, parseFloat(q.get('starscale')) || 1));
})();
// #1 DPR CLAMP — effective device-pixel-ratio = the real DPR, capped. On a 2×/3×
// retina screen this is what stops us rendering 4–9× the pixels for no visible gain.
function effDPR() { return Math.min(window.devicePixelRatio || 1, QUALITY.dprCap); }
window.QUALITY = QUALITY;

// cached viewport size — refreshed on resize, read everywhere else (avoids
// scattered window.innerWidth/innerHeight reads in the frame loop)
let viewW = window.innerWidth, viewH = window.innerHeight;

const tunnelCanvas = document.getElementById('tunnel-canvas');
const starCanvas = document.getElementById('showcase-canvas');

const supportsOffscreen = !!(window.OffscreenCanvas && tunnelCanvas.transferControlToOffscreen && starCanvas.transferControlToOffscreen);
let worker = null;

let renderer, scene, camera, fogDefault;
let fogEnabled = true;
let activeTube = 'v1d';

// Define DOM references early for worker messages
const vaporEl = document.getElementById('vapor');
const vaporContentEl = document.querySelector('.vapor-content');
const vaporGlowEl = document.getElementById('vaporGlow');
const topEl   = document.getElementById('top');
const pbarEl  = document.getElementById('pbar');
const tunnelUIEl = document.getElementById('tunnel-ui');

if (!supportsOffscreen) {
  THREE = await import('three');
  const centerlineModule = await import('./landing/centerline.js');
  currentCenterline = centerlineModule.currentCenterline;

  _tmpV1 = new THREE.Vector3();
  _tmpV2 = new THREE.Vector3();
  _camLook = new THREE.Vector3();
  curveEnd = new THREE.Vector3();
  curveEndTangent = new THREE.Vector3();
  openingEdge = new THREE.Vector3();

  tubeMat1 = new THREE.LineBasicMaterial({ color: 0x4f8c6f, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  tubeMat2 = new THREE.LineBasicMaterial({ color: 0x284a3b, transparent: true, opacity: 0.40, blending: THREE.AdditiveBlending, depthWrite: false });

  renderer = new THREE.WebGLRenderer({ canvas: tunnelCanvas, antialias: true, alpha: true });
  renderer.setPixelRatio(effDPR());
  renderer.setSize(viewW, viewH);
  renderer.setClearColor(0x000000, 0); // transparent background so starfield shows through

  scene = new THREE.Scene();
  fogDefault = new THREE.FogExp2(0x070c0a, 0.038);
  scene.fog = fogDefault;
  camera = new THREE.PerspectiveCamera(60, viewW / viewH, 0.1, 1000);
}

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
    dpr: effDPR()
  }, [offscreenTunnel, offscreenStar]);

  worker.onmessage = (e) => {
    const data = e.data;
    if (data.type === 'domUpdate') {
      if (topEl) topEl.classList.toggle('hide-nav', data.hideNav);
      
      tunnelCanvas.style.opacity = data.tunnelOpacity;
      tunnelUIEl.style.opacity = data.tunnelOpacity;
      
      vaporEl.style.opacity = data.vaporOpacity;
      vaporEl.style.visibility = data.vaporVisibility;
      
      if (data.mask !== lastMask) {
        lastMask = data.mask;
        vaporEl.style.webkitMaskImage = data.mask;
        vaporEl.style.maskImage = data.mask;
      }
      
      vaporContentEl.style.transform = `translateY(${(1 - data.contentRise) * 110}px)`;
      vaporContentEl.style.opacity = data.contentRise;
      
      vaporGlowEl.style.opacity = data.glow;
      
      if (data.resetSmooth) {
        window._openSmoothX = null;
        window._openSmoothY = null;
      }
    } else if (data.type === 'shift') {
      if (data.clear) {
        starCanvas.style.transform = '';
      } else {
        starCanvas.style.transform = `translate(${data.x}px, ${data.y}px)`;
      }
    } else if (data.type === 'shadersReady') {
      shadersReady = true;
    } else if (data.type === 'stats') {
      if (statsEl) {
        const sScale = (effDPR() * QUALITY.starScale).toFixed(2);
        statsEl.textContent =
          `fps    ${data.fps}\n` +
          `dprCap ${QUALITY.dprCap}  → eff ${effDPR().toFixed(2)}\n` +
          `device ${(window.devicePixelRatio || 1).toFixed(2)}\n` +
          `star   ${sScale}×  (offscreen)\n` +
          `scroll ${data.scroll}%\n` +
          `layers ${data.layers}`;
      }
    }
  };
}

// ---- per-curve caches + scratch vectors (perf) ----
// Everything derivable from the curve alone is computed ONCE per tube build:
// the exit point/tangent, the opening-edge point, and a dense LUT of curve
// samples for the particle system. The frame loop reuses these scratch
// vectors instead of allocating new THREE.Vector3s every frame.
let curve = null;
let _tmpV1 = null, _tmpV2 = null;
let _camLook = null;
const CURVE_LUT_N = 1024;
const curveLUT = new Float32Array(CURVE_LUT_N * 3);
let curveEnd = null;        // curve.getPointAt(0.999)
let curveEndTangent = null; // exit tangent (normalised)
let openingEdge = null;     // curveEnd + perpendicular · tube radius
function refreshCurveCache() {
  for (let i = 0; i < CURVE_LUT_N; i++) {
    curve.getPointAt(i / (CURVE_LUT_N - 1), _tmpV1);
    curveLUT[i*3] = _tmpV1.x; curveLUT[i*3+1] = _tmpV1.y; curveLUT[i*3+2] = _tmpV1.z;
  }
  curve.getPointAt(0.999, curveEnd);
  curve.getTangentAt(0.999, curveEndTangent).normalize();
  const perp = _tmpV1.set(0, 1, 0).cross(curveEndTangent);
  if (perp.lengthSq() < 1e-4) perp.set(1, 0, 0).cross(curveEndTangent);
  perp.normalize().multiplyScalar(6); // tube radius
  openingEdge.copy(curveEnd).add(perp);
}

// Green wireframes (terminal aesthetic) — rebuilt by buildTube() so the bend
// controls can reshape the tube live. Materials are created ONCE and shared
// across rebuilds (the old code created — and leaked — a fresh pair per rebuild).

let tubeMat1 = null, tubeMat2 = null;
let tubeMesh1 = null, tubeMesh2 = null;
function buildTube() {
  if (supportsOffscreen) return;
  curve = new THREE.CatmullRomCurve3(currentCenterline(activeTube, TEST), false, 'catmullrom', 0.5);
  refreshCurveCache();
  if (tubeMesh1) { scene.remove(tubeMesh1); tubeMesh1.geometry.dispose(); }
  if (tubeMesh2) { scene.remove(tubeMesh2); tubeMesh2.geometry.dispose(); }
  const g1 = new THREE.TubeGeometry(curve, 800, 6, 16, false);
  tubeMesh1 = new THREE.LineSegments(new THREE.WireframeGeometry(g1), tubeMat1);
  tubeMesh1.frustumCulled = false;
  scene.add(tubeMesh1);
  g1.dispose();
  const g2 = new THREE.TubeGeometry(curve, 600, 6, 6, false);
  tubeMesh2 = new THREE.LineSegments(new THREE.WireframeGeometry(g2), tubeMat2);
  tubeMesh2.frustumCulled = false;
  scene.add(tubeMesh2);
  g2.dispose();
  if (typeof rings !== 'undefined' && rings.length) layoutRings();
}
// coalesce rapid slider drags into one rebuild per frame (geometry rebuild is
// the only heavy bit — don't run it several times per input event)
let tubeRebuildQueued = false;
function requestTubeRebuild() {
  if (tubeRebuildQueued) return;
  tubeRebuildQueued = true;
  requestAnimationFrame(() => { tubeRebuildQueued = false; buildTube(); });
}
// initial tube is built once `rings` exist (see after the ring setup below)

// Tweaks UI handlers extracted to ./landing/tweaks.js
let darkerRaysVisible = true;

const CHAPTERS = [
  { id: "intro",    label: "intro",       at: 0.05, pos: "pos-left",
    head: 'I&rsquo;m <em>Alan</em>. <span class="a">Welcome.</span>',
    lede: 'Developer &amp; researcher. ML / NLP by trade — <span class="mute">DIY enthusiast, open source contributor, occasional educator. São Paulo, Brazil.</span>' },
  { id: "work",     label: "work",        at: 0.20, pos: "pos-right",
    head: 'Putting it<br/><span class="a">into production</span>',
    lede: 'Ongoing industry career building data and ML systems. <span class="mute">Experience working at banks, startups, consulting and free-lancing.</span>' },
  { id: "research", label: "research",    at: 0.34, pos: "pos-bot-l",
    head: 'Chasing <span class="a">the frontier</span>',
    lede: 'Master&rsquo;s in CS focusing on NLP, internship at Oxford, exchange in TUDelft. <span class="mute">Multiple graduate and undergraduate research projects.</span>' },
  { id: "education", label: "education &amp; volunteering", at: 0.48, pos: "pos-top-r",
    head: 'Growing people,<br/><span class="a">not just systems.</span>',
    lede: 'Years of volunteering and leadership. <span class="mute">Formal and non-formal education.</span>',
    more: [
      ["coursera", "authored a graduate level NLP course"],
      ["avanhandava", "youth educational movement · 5 years educator · 1 year president"],
      ["judge", "STEM fair judge · regional &amp; national"],
      ["student assoc.", "founding member and president"],
      ["linux network", "volunteer sys admin at my alma mater · 10 years"]
    ] },
  { id: "diy",      label: "built",       at: 0.62, pos: "pos-bot-r",
    head: '<span class="a">Built things</span> that aren&rsquo;t (always) code.',
    lede: 'Bike mechanic. Backyard aquaponics. Charcoal kiln. Self-hosting most of my things. <span class="mute">Multiple projects on the bench at all times.</span>',
    more: [
      "community workshop bike mechanic",
      "steel-drum charcoal kiln",
      "aquaponics loop",
      "network attached storage",
      "several websites",
      "game mods &amp; ROM hacks",
      "OSkate - my own OS"
    ] },
  { id: "oss",      label: "open source", at: 0.76, pos: "pos-left",
    head: '<span class="a">Open source.</span><br/>Since the beginning.',
    lede: 'Contributing back since I started coding. Years as sole maintainer of pipreqs. GSoC mentee. <span class="mute">A long tail of patches across the python &amp; linux ecosystem.</span>',
    more: [
      ["pipreqs", "sole maintainer · 2021 - 2024"],
      ["gsoc", "Linux Foundation · 2021"],
      ["misc", "ongoing PRs &amp; comments in many random repos"],
      ["failed", "I tried, can't win them all but I can share them"]
    ] },
];

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

// Green station rings
const rings = [];
const ringHalos = [];
const ringLocalT = [];
if (!supportsOffscreen) {
  CHAPTERS.forEach((ch) => {
    const local = (ch.at - PHASES.tunnelIn) / (PHASES.tunnelEnd - PHASES.tunnelIn);
    if (local < 0 || local > 1) return;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(5.2, 0.10, 6, 96),
      new THREE.MeshBasicMaterial({ color: 0x4f8c6f, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.frustumCulled = false;
    scene.add(ring);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(5.5, 0.04, 4, 64),
      new THREE.MeshBasicMaterial({ color: 0x4f8c6f, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    halo.frustumCulled = false;
    scene.add(halo);
    rings.push(ring);
    ringHalos.push(halo);
    ringLocalT.push(Math.min(local, 0.999));
  });
}
// (re)place rings/halos along the current curve — called after any bend rebuild
function layoutRings() {
  if (supportsOffscreen) return;
  rings.forEach((ring, i) => {
    const tt = ringLocalT[i];
    const p = curve.getPointAt(tt);
    const tan = curve.getTangentAt(tt);
    ring.position.copy(p);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1), tan.clone().normalize());
    const halo = ringHalos[i];
    halo.position.copy(p);
    halo.quaternion.copy(ring.quaternion);
  });
}
buildTube(); // builds the tube meshes AND lays out the rings on the curve

// White particles inside the tube
const ptGeo = new THREE.BufferGeometry();
const ptCount = 700;
const ptPos = new Float32Array(ptCount * 3);
const ptSeeds = new Float32Array(ptCount * 3);
if (!supportsOffscreen) {
  for (let i = 0; i < ptCount; i++) {
    ptSeeds[i*3] = Math.random();
    ptSeeds[i*3+1] = Math.random() * Math.PI * 2;
    ptSeeds[i*3+2] = 1.8 + Math.random() * 3.4;
  }
  ptGeo.setAttribute('position', new THREE.BufferAttribute(ptPos, 3));
  const ptMat = new THREE.PointsMaterial({
    color: 0xffffff, size: 0.06, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  const points = new THREE.Points(ptGeo, ptMat);
  points.frustumCulled = false;
  scene.add(points);
}

// ============================================================
// SHADER COMPILE — async (KHR_parallel_shader_compile)
// ============================================================
// The tube/ring/particle programs are compiled + linked on a BACKGROUND GPU
// thread, before the first renderer.render(), rather than synchronously on
// frame 1. Without this, that first render's link blocks the main thread for
// ~1s — and because the loop starts at page load, that stall lands right on top
// of the CRT boot-log typing animation, stuttering it. The tunnel canvas is
// invisible (opacity:0) through the entire boot+splash sequence (~6s), so
// deferring the first GL render until the programs are ready is completely
// invisible — and by the time the splash fades to the tunnel the shaders have
// long since finished. Net result: identical pixels, no main-thread stall.
//
// NOTE: these are already the lightest stock materials (Line/Mesh/Points Basic,
// all UNLIT — no lighting/shadow code to strip), so a custom raw-GLSL rewrite
// would buy little while risking drift in additive blending / fog / tone-map.
// Moving the compile off-thread captures the win with zero visual risk.
let shadersReady = false;
if (!supportsOffscreen) {
  if (typeof renderer.compileAsync === 'function') {
    renderer.compileAsync(scene, camera)
      .then(() => {
        // Warm up compile & link caches by forcing a single synchronous dummy render 
        // while the user is viewing the typing boot logs.
        renderer.render(scene, camera);
        shadersReady = true;
      })
      .catch(() => {
        shadersReady = true; // never leave the tunnel un-rendered
      });
  } else {
    shadersReady = true; // older three.js: fall back to a synchronous first-render compile
  }
}

// ============================================================
// OUTRO — Starfield Integration
// ============================================================
let outroActive = false;

// canvas + 2D context resolved ONCE (the old draw() did two DOM lookups per frame)
let starCtx;
if (!supportsOffscreen) {
  starCtx = starCanvas.getContext('2d');
}
// quantised stroke-style cache — avoids building a fresh rgba() string per star per frame
const STAR_STROKES = [];
for (let i = 0; i < 256; i++) STAR_STROKES.push(`rgba(184, 240, 208, ${(i / 255).toFixed(3)})`);
// B2: reusable opacity bins. Stars are grouped by quantised alpha so the whole
// field draws in ≤STAR_BIN_COUNT path/stroke calls per frame instead of one
// beginPath/stroke per star (was 340). Bins + per-bin style/lineWidth are built
// ONCE; each frame only resets bin lengths (zero per-frame allocation).
const STAR_BIN_COUNT = 10;
const STAR_BINS = Array.from({ length: STAR_BIN_COUNT }, () => []);
const STAR_BIN_STROKE = [];
const STAR_BIN_LW = [];
for (let b = 0; b < STAR_BIN_COUNT; b++) {
  STAR_BIN_STROKE.push(STAR_STROKES[Math.min(255, (b / (STAR_BIN_COUNT - 1) * 255) | 0)]);
  STAR_BIN_LW.push(Math.min(2.5, 1.2 + b / (STAR_BIN_COUNT - 1)));
}

const StarfieldEffect = {
  stars: [],
  cx: 0, cy: 0,
  fov: 300,
  // single, uniform starfield. Every star is always drawn at full speed — the
  // reveal is done purely by a growing circular MASK on the #vapor layer, so
  // the field reads as one continuous effect carried into the outro.
  // spread distribution: a band 0..1 only controls how far from the axis a star
  // sits, giving a natural density falloff from centre to edges.
  respawnXY(s) {
    const spread = 60 + Math.pow(s.band, 0.85) * 1040; // ~60 (centre) → ~1100 (edge)
    const ang = Math.random() * Math.PI * 2;
    const r = spread * (0.18 + 0.82 * Math.random());
    s.x = Math.cos(ang) * r;
    s.y = Math.sin(ang) * r;
  },
  setup() {
    if (supportsOffscreen) return;
    const cv = starCanvas;
    const scale = cv._renderScale || 1;
    const W = cv.width / scale, H = cv.height / scale; // logical (CSS px) size
    this.cx = W / 2;
    this.cy = H * TEST.starFocalY;
    this.stars = [];
    const count = 340;
    for (let i = 0; i < count; i++) {
      const s = { band: i / (count - 1), x: 0, y: 0, z: Math.random() * 800, prevZ: 0 };
      this.respawnXY(s);
      s.prevZ = s.z;
      this.stars.push(s);
    }
  },
  draw(dt) {
    if (supportsOffscreen) return;
    dt = dt || 1; // #3 delta-time: 1.0 == one 60fps tick; >1 when frames are slow
    const cv = starCanvas;
    const ctx = starCtx;
    // #1 the backing store may be larger than the CSS box (DPR-aware). Work in
    // logical CSS px and let a single transform scale everything to device px.
    const scale = cv._renderScale || 1;
    const W = cv.width / scale, H = cv.height / scale;
    // B3: ctx.setTransform() is NOT called here anymore — the scale only changes
    // on resize, so it's applied once in resizeOutroCanvas() (and survives every
    // frame since nothing resets the context between draws).

    // ---- rays vs opening: pick the vanishing point per mode ----
    const mode = TEST.rayMode;
    let fx = W / 2, fy = H * TEST.starFocalY; // 'fixed' default
    if ((mode === 'follow' || mode === 'fade') && revealFocalValid) {
      fx = revealFocalX;
      fy = revealFocalY;
    } else if (mode === 'shift') {
      fx = W / 2;
      fy = H / 2; // internal focal never moves; the CANVAS moves instead
    }
    this.cx = fx;
    this.cy = fy;

    // ---- trail fade: 'fade' mode wipes harder while the focal is moving ----
    let fade = TEST.fadeBase;
    if (mode === 'fade') {
      const mvx = fx - (this._pfx ?? fx), mvy = fy - (this._pfy ?? fy);
      fade = Math.min(TEST.fadeMax, TEST.fadeBase + Math.hypot(mvx, mvy) * TEST.fadeGain);
    }
    this._pfx = fx; this._pfy = fy;
    ctx.fillStyle = TEST.outroBgMatch ? `rgba(7, 12, 10, ${fade.toFixed(3)})` : `rgba(0, 0, 0, ${fade.toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);

    // ---- 'shift' mode: translate the canvas ELEMENT onto the opening, so the
    // trail history moves rigidly with the field (no smearing) ----
    if (mode === 'shift' && revealFocalValid) {
      cv.style.transform = `translate(${(revealFocalX - W / 2).toFixed(1)}px, ${(revealFocalY - H / 2).toFixed(1)}px)`;
    } else if (cv.style.transform) {
      cv.style.transform = '';
    }

    const velocity = TEST.starVelocity * TEST.starDir;

    // plain for-loop (no per-frame closure), trail endpoints only computed for
    // stars that survive the on-screen + alpha culls
    const stars = this.stars, fov2 = this.fov, scx = this.cx, scy = this.cy;
    const dz = velocity * dt;

    // B2: clear the bins, then advance every star and drop the visible ones into
    // a bin keyed by quantised alpha (storing their projected endpoints on the
    // star object — no allocation).
    const bins = STAR_BINS;
    for (let b = 0; b < STAR_BIN_COUNT; b++) bins[b].length = 0;

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.prevZ = s.z;
      s.z -= dz;

      if (s.z <= 1) {
        s.z = 800; this.respawnXY(s); s.prevZ = s.z;
      } else if (s.z >= 800) {
        s.z = 1; this.respawnXY(s); s.prevZ = s.z;
      }

      const px = (s.x / s.z) * fov2 + scx;
      const py = (s.y / s.z) * fov2 + scy;

      if (px < 0 || px > W || py < 0 || py > H) continue;

      const alpha = 1 - (s.z / 800);
      if (alpha <= 0.01) continue;

      s.px = px; s.py = py;
      s.lx = (s.x / s.prevZ) * fov2 + scx;
      s.ly = (s.y / s.prevZ) * fov2 + scy;

      const bi = alpha >= 1 ? STAR_BIN_COUNT - 1 : (alpha * STAR_BIN_COUNT) | 0;
      bins[bi].push(s);
    }

    // B2: one path + one stroke per non-empty bin → ≤STAR_BIN_COUNT draw calls/frame.
    for (let b = 0; b < STAR_BIN_COUNT; b++) {
      const list = bins[b];
      if (!list.length) continue;
      ctx.strokeStyle = STAR_BIN_STROKE[b];
      ctx.lineWidth = STAR_BIN_LW[b];
      ctx.beginPath();
      for (let j = 0; j < list.length; j++) {
        const s = list[j];
        ctx.moveTo(s.lx, s.ly);
        ctx.lineTo(s.px, s.py);
      }
      ctx.stroke();
    }
  }
};

function resizeOutroCanvas() {
  if (supportsOffscreen) return;
  const cv = starCanvas;
  // #1 render the starfield at (clamped DPR × starScale); keep the CSS box at
  // viewport size so it still fills the screen, just at a capped resolution.
  const scale = effDPR() * QUALITY.starScale;
  cv._renderScale = scale;
  cv.width = Math.round(viewW * scale);
  cv.height = Math.round(viewH * scale);
  cv.style.width = viewW + 'px';
  cv.style.height = viewH + 'px';
  // B3: setting cv.width/height above RESETS the 2D context transform to
  // identity, so (re)apply the DPR scale here — once per resize — instead of
  // calling ctx.setTransform() inside the per-frame draw() loop.
  starCtx.setTransform(scale, 0, 0, scale, 0, 0);
}

// ============================================================
// PHASE OPACITY (driven by scroll for tunnel + vapor)
// ============================================================
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function smoothstep(x) { return x*x*(3 - 2*x); }
function lerp(a, b, t) { return a + (b - a) * t; }

let lastTunnelOpacity = -1;
let vaporHidden = true;      // mirrors the CSS initial state of #vapor (hidden)
let lastVaporOpacity = '', lastMask = '', lastCe = -1, lastGlow = -1;
let maskDropped = false; // B4: true once the reveal is fully open and the mask has been released
let lastHideNav = null;

function updateLayers(p) {
  if (supportsOffscreen) return;
  const shouldHideNav = p >= 0.91;
  if (shouldHideNav !== lastHideNav) {
    lastHideNav = shouldHideNav;
    if (topEl) topEl.classList.toggle('hide-nav', shouldHideNav);
  }
  // Tunnel canvas opacity: fully visible through tunnelEnd, then fade to 0 by tunnelFlash
  const tunnelOpacity = p > PHASES.tunnelEnd
    ? 1 - clamp01((p - PHASES.tunnelEnd) / (PHASES.tunnelFlash - PHASES.tunnelEnd))
    : 1;
  if (tunnelOpacity !== lastTunnelOpacity) {   // skip redundant style writes (it's 1 for most of the scroll)
    lastTunnelOpacity = tunnelOpacity;
    tunnelCanvas.style.opacity = tunnelOpacity;
    tunnelUIEl.style.opacity = tunnelOpacity;
  }

  // #4 starfield emerge owns the vapor reveal across a wider range
  if (TEST.emerge) {
    updateEmerge(p);
    return;
  }

  // Non-emerge path (fallback, rarely used now)
  if (p > PHASES.outroIn) {
    vaporHidden = false; lastVaporOpacity = ''; lastMask = ''; lastCe = -1; lastGlow = -1;
    vaporEl.style.visibility = "visible";
    const t = clamp01((p - PHASES.outroIn) / (PHASES.outroFull - PHASES.outroIn));
    vaporEl.style.webkitMaskImage = 'none';
    vaporEl.style.maskImage = 'none';
    vaporEl.style.zIndex = '';
    vaporGlowEl.style.opacity = 0;
    vaporEl.style.opacity = t*t*(3-2*t);
    vaporContentEl.style.transform = '';
    vaporContentEl.style.opacity = '';
    const wasActive = outroActive;
    outroActive = t > 0.05;
    if (outroActive && !wasActive) {
      StarfieldEffect.setup();
    }
  } else {
    vaporHidden = true; lastVaporOpacity = ''; lastMask = ''; lastCe = -1; lastGlow = -1;
    vaporEl.style.opacity = 0;
    vaporEl.style.visibility = "hidden";
    vaporEl.style.webkitMaskImage = 'none';
    vaporEl.style.maskImage = 'none';
    vaporEl.style.zIndex = '';
    vaporGlowEl.style.opacity = 0;
    vaporContentEl.style.transform = '';
    vaporContentEl.style.opacity = '';
    outroActive = false;
  }
}

// #4 the starfield reveals through a SOFT-EDGED circle centered on the tube's
// vanishing point — it grows out of the far opening and feathers into the walls
// (no hard border), fades in (no pop), fills the screen as we punch through,
// optional glow keeps it from pure black, then the content rises from the bottom.
// project the tube's far opening (centre + edge) to screen, so the reveal can
// be sized/placed to the REAL opening rather than a guessed disc.
function projectTubeOpening() {
  // The centre + edge of the exit opening are constants per tube build — cached
  // in refreshCurveCache() (applyEndBend deforms the control points BEFORE the
  // curve is built, so the cache tracks the bend sliders via buildTube()).
  // Per-frame work here is just two projections, zero allocations.
  const cP = _tmpV1.copy(curveEnd).project(camera);
  if (cP.z >= 1) return lastOpening;   // opening behind camera near a hard bend — reuse last good
  const eP = _tmpV2.copy(openingEdge).project(camera);
  const w = viewW, h = viewH;
  const cx = (cP.x * 0.5 + 0.5) * w, cy = (-cP.y * 0.5 + 0.5) * h;
  const ex = (eP.x * 0.5 + 0.5) * w, ey = (-eP.y * 0.5 + 0.5) * h;
  const r = Math.hypot(ex - cx, ey - cy);
  if (lastOpening === null) {
    lastOpening = { cx, cy, r };
  } else {
    lastOpening.cx = cx;
    lastOpening.cy = cy;
    lastOpening.r = r;
  }
  return lastOpening;
}

// invert the camera's scroll→curve easing (see frame()) so we can ask "at what
// scroll position is the camera at curve fraction tc?". This lets the emerge
// trigger ride along WITH the bend instead of firing at a fixed scroll value.
function pAtCurve(tc) {
  if (tc <= 0.92) {
    return clamp01((tc - 0.001) / (0.92 - 0.001) * PHASES.tunnelOut);
  }
  const frac = clamp01((tc - 0.92) / (0.998 - 0.92));
  const lateP = 1 - Math.sqrt(Math.max(0, 1 - frac));
  return PHASES.tunnelOut + lateP * (PHASES.tunnelEnd - PHASES.tunnelOut);
}

function updateEmerge(p) {
  // ===========================================================
  // SINGLE CONTINUOUS REVEAL (replaces the 3-step tier system).
  // One uniform starfield, revealed by a soft circular mask that
  // is CENTRED on the screen and grows smoothly with scroll:
  //   • starts at a small radius (revealR0) right after the bend,
  //     once we're looking down the barrel (align safety gate)
  //   • grows continuously from revealStartP → revealFullP, where
  //     it reaches fullscreen (default: just before the tube exit)
  // The starfield carries straight on into the outro with no steps.
  // ===========================================================
  const toEnd = _tmpV1.copy(curveEnd).sub(camera.position).normalize(); // cached end + scratch vector — no allocations
  camera.getWorldDirection(_tmpV2);
  const alignRaw = _tmpV2.dot(toEnd);               // 1 = looking straight at the end
  alignSmooth += (alignRaw - alignSmooth) * 0.15;   // low-pass to kill wave/roll jitter

  // align safety gate: 0 while the sharp bend hides the opening → 1 once we're
  // looking down the barrel. Keeps the field from bleeding mid-bend.
  const gate = smoothstep(clamp01((alignSmooth - TEST.revealAlign) / 0.18));

  // continuous scroll-driven growth: 0 at revealStartP → 1 at revealFullP
  const span = Math.max(0.001, TEST.revealFullP - TEST.revealStartP);
  const growth = smoothstep(clamp01((p - TEST.revealStartP) / span));

  // Once the reveal has begun opening, LATCH it open — when the camera flies out
  // past the mouth (Option B) the align dot-product flips negative, which would
  // otherwise slam the gate shut and kill the starfield. growth only rises after
  // revealStartP (well past the bend), so latching here can't cause early bleed.
  const effGate = Math.max(gate, growth);

  // lead-in factor: 0 until just shy of revealStartP — while it is 0, presence
  // is 0 no matter what, so we can skip projecting the opening entirely.
  const lead = smoothstep(clamp01((p - (TEST.revealStartP - 0.02)) / 0.02));

  // where does the opening project on screen RIGHT NOW?
  const op = (lead > 0 && effGate > 0) ? projectTubeOpening() : null;

  // in-view factor: 0 while the projected opening is still off-screen or hugging
  // an edge (mid-bend), 1 once it is comfortably inside the viewport. This makes
  // the reveal appear exactly WHEN and WHERE the opening swings into view —
  // instead of fading in early near the top of the screen and dragging down.
  const vw = viewW, vh = viewH;
  let inView = 0;
  if (op) {
    const ex = Math.min(op.cx, vw - op.cx) / vw;   // 0 at the screen edge → 0.5 at centre
    const ey = Math.min(op.cy, vh - op.cy) / vh;
    inView = smoothstep(clamp01(Math.min(ex, ey) / 0.18));
  }

  // overall presence: can't appear before we're aligned/started, NOR before the
  // opening is actually in view
  const present = effGate * inView * lead;

  if (present <= 0.001) {
    outroActive = false;
    revealFocalValid = false;
    if (!vaporHidden) {           // write the hidden state ONCE, not every frame
      vaporHidden = true;
      vaporEl.style.opacity = 0;
      vaporEl.style.visibility = 'hidden';
      vaporEl.style.webkitMaskImage = 'none';
      vaporEl.style.maskImage = 'none';
      vaporEl.style.zIndex = '';
      vaporGlowEl.style.opacity = 0;
      vaporContentEl.style.transform = '';
      vaporContentEl.style.opacity = '';
      lastVaporOpacity = ''; lastMask = ''; lastCe = -1; lastGlow = -1;
      maskDropped = false;         // B4: re-arm the mask so it re-applies on re-entry
      window._openSmoothX = null;  // re-seed the opening smoother on next entry
      window._openSmoothY = null;
      starCanvas.style.transform = ''; // clear any 'shift' offset
    }
    return;
  }

  if (vaporHidden) { vaporHidden = false; vaporEl.style.visibility = 'visible'; }

  const wasActive = outroActive;
  outroActive = true;
  if (!wasActive) StarfieldEffect.setup();

  // layer fades in with the align gate. Once growth is 1.0 (mask fully open), force opacity to 1.0.
  const effOpacity = (growth >= 1.0) ? 1.0 : present;
  const vaporOpacity = effOpacity.toFixed(3);
  if (vaporOpacity !== lastVaporOpacity) { lastVaporOpacity = vaporOpacity; vaporEl.style.opacity = vaporOpacity; }

  const w = vw, h = vh;
  const cx = w / 2, cy = h / 2;

  // LIVE anchor on the projected opening. While the field is still young/faint
  // (present < 0.5) the anchor is GLUED to the opening — zero smoothing lag, so
  // the rays sit exactly inside the mouth from their very first visible frame
  // and move WITH it, never trailing behind. Once established, an adaptive
  // low-pass takes over: gentle (0.15) at rest to kill roll-wobble jitter, but
  // automatically faster when the opening genuinely moves, so it can't drag.
  let maskCx = cx, maskCy = cy;
  if (op) {
    if (window._openSmoothX == null) {
      window._openSmoothX = op.cx;
      window._openSmoothY = op.cy;
    }
    const dxm = op.cx - window._openSmoothX, dym = op.cy - window._openSmoothY;
    const err = Math.hypot(dxm, dym);
    const k = (present < 0.5) ? 1 : Math.min(1, 0.15 + err / 240);
    window._openSmoothX += dxm * k;
    window._openSmoothY += dym * k;
    const recentre = smoothstep(clamp01(growth / 0.4)); // 0 → 1 across the FIRST 40% of growth
    maskCx = lerp(window._openSmoothX, cx, recentre);
    maskCy = lerp(window._openSmoothY, cy, recentre);
  }

  const coverR = Math.hypot(w, h) * 0.5 + 4;          // radius that fully covers the viewport
  const rad = lerp(TEST.revealR0, coverR, growth);    // small → fullscreen, continuous

  // share the centre out so the starfield rays can emanate from it too
  revealFocalX = maskCx;
  revealFocalY = maskCy;
  revealFocalValid = true;

  // REMOVED: screen-blend and z-index flipping. Canvas is now transparent,
  // starfield shows through, and #vapor stays at z:0 forever (tube at z:1).
  // No blending needed, no z-juggling needed.

  // B4: once the reveal is fully open the mask is a screen-covering disc that the
  // compositor must keep rasterising every frame for no visual gain. Release it
  // to 'none' ONCE at full growth (guarded by maskDropped so it's a single
  // write); rebuild + re-apply it if the user scrolls back before it's open.
  if (growth >= 1.0) {
    if (!maskDropped) {
      maskDropped = true;
      vaporEl.style.webkitMaskImage = 'none';
      vaporEl.style.maskImage = 'none';
      lastMask = 'none';
    }
  } else {
    maskDropped = false;
    const feather = Math.max(24, rad * 0.3);
    const inner = Math.max(0, rad - feather);
    const mask = `radial-gradient(circle ${rad.toFixed(1)}px at ${maskCx.toFixed(1)}px ${maskCy.toFixed(1)}px, #000 ${inner.toFixed(1)}px, rgba(0,0,0,0) ${rad.toFixed(1)}px)`;
    if (mask !== lastMask) {        // settles to a constant near full open — skip re-writes
      lastMask = mask;
      vaporEl.style.webkitMaskImage = mask;
      vaporEl.style.maskImage = mask;
    }
  }

  // content rises on SCROLL — there's a stretch of pure full-screen starfield
  // before the text/cards come up. `content rise @` controls where that begins.
  const cStart = TEST.contentRise;
  const cEnd = Math.min(1.0, cStart + 0.02);
  const ce = smoothstep(clamp01((p - cStart) / (cEnd - cStart)));
  if (ce !== lastCe) {            // ce sits at 0 (then 1) for long stretches — skip re-writes
    lastCe = ce;
    vaporContentEl.style.transform = `translateY(${(1 - ce) * 110}px)`;
    vaporContentEl.style.opacity = ce;
  }

  const glow = TEST.emergeGlow ? ((0.10 + 0.28 * growth) * (1 - ce)).toFixed(3) : 0;
  if (glow !== lastGlow) {
    lastGlow = glow;
    vaporGlowEl.style.opacity = glow;
  }
}

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
  if (supportsOffscreen && worker) {
    worker.postMessage({ type: 'scroll', p: scrollP });
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
      window.scrollTo({
        top: pct * scrollMax,
        behavior: 'smooth'
      });
    });
  }
}

window.addEventListener('resize', () => {
  viewW = window.innerWidth; viewH = window.innerHeight;
  updateScrollMax();
  updateScroll();
  if (supportsOffscreen && worker) {
    worker.postMessage({ type: 'resize', width: viewW, height: viewH, dpr: effDPR() });
  } else if (renderer && camera) {
    renderer.setPixelRatio(effDPR());
    renderer.setSize(viewW, viewH);
    camera.aspect = viewW / viewH;
    camera.updateProjectionMatrix();
    resizeOutroCanvas();
  }
});
updateScrollMax();
updateScroll();
resizeOutroCanvas();

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
  if (renderer) {
    renderer.setPixelRatio(effDPR());
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  resizeOutroCanvas();
  if (StarfieldEffect.stars.length) StarfieldEffect.setup();
};

// ---- optional ?stats overlay: live FPS + DPR + which layers are drawing ----
let statsEl = null, statsFrames = 0, statsLast = performance.now();
if (new URLSearchParams(location.search).has('stats')) {
  statsEl = document.createElement('div');
  statsEl.style.cssText = 'position:fixed;top:8px;left:8px;z-index:200;font:11px/1.55 ui-monospace,monospace;color:#6fc89a;background:rgba(7,12,10,.82);border:1px solid rgba(111,200,154,.35);padding:7px 10px;border-radius:5px;white-space:pre;pointer-events:none';
  document.body.appendChild(statsEl);
}

function frame(ts) {
  // #3 DELTA-TIME — ms since the previous frame, normalised so 1.0 == one 60fps
  // tick. Every per-frame motion is multiplied by dt, so the animation runs at
  // the same real-world speed on 60/120/144Hz and a dropped frame produces one
  // larger step (lands where it should) instead of a visible stutter.
  const nowMs = ts || performance.now();
  let dt = (nowMs - (frame._last || nowMs)) / 16.667;
  frame._last = nowMs;
  if (dt > 4) dt = 4;      // clamp big gaps (backgrounded tab) so nothing teleports
  if (dt <= 0) dt = 1;

  smoothP += (scrollP - smoothP) * (1 - Math.pow(1 - 0.07, dt));
  // snap when settled — stops sub-pixel mask/progress churn while idle
  if (Math.abs(scrollP - smoothP) < 0.00002) smoothP = scrollP;
  const p = smoothP;
  updateLayers(p);

  // #2 SKIP INVISIBLE LAYERS — the tunnel canvas fades to 0 at tunnelFlash; past
  // that there is no point running its camera, ring/particle sim, or GL render.
  const tunnelVisible = p < PHASES.tunnelFlash;

  // tunnel camera: ease into the deep end so by tunnelEnd the camera is at
  // curve t ≈ 0.998 — we've travelled the full tube. Fog density takes over
  // ahead, leaving only the immediate tube walls visible at the screen borders.
  if (!supportsOffscreen && tunnelVisible && !introPlaying && renderTunnel) {
  let tCurve;
  if (p < PHASES.tunnelOut) {
    tCurve = lerp(0.001, 0.92, p / PHASES.tunnelOut);
  } else if (p < PHASES.tunnelEnd) {
    const lateP = clamp01((p - PHASES.tunnelOut) / (PHASES.tunnelEnd - PHASES.tunnelOut));
    tCurve = lerp(0.92, 0.998, 1 - Math.pow(1 - lateP, 2));
  } else {
    // OPTION B: past tunnelEnd, keep pushing the camera FORWARD past the mouth
    // so it physically flies out of the tube (tCurve climbs above 1.0).
    const outP = clamp01((p - PHASES.tunnelEnd) / (1 - PHASES.tunnelEnd));
    tCurve = 0.998 + outP * 0.15; // up to ~1.148 → well past the exit rim
  }

  if (tCurve <= 0.999) {
    curve.getPointAt(Math.min(0.999, tCurve), camera.position); // write straight into camera.position
    curve.getPointAt(Math.min(0.999, tCurve + 0.008), _camLook);
    camera.lookAt(_camLook);
  } else {
    // flying out: extrapolate straight along the exit tangent (cached per build)
    const distPastEnd = (tCurve - 0.999) * 220; // world units past the mouth
    camera.position.copy(curveEnd).addScaledVector(curveEndTangent, distPastEnd);
    camera.lookAt(_camLook.copy(curveEnd).addScaledVector(curveEndTangent, distPastEnd + 20));
  }
  lastTCurve = tCurve;
  const roll = Math.sin(performance.now() * 0.0002) * 0.04;
  camera.up.set(Math.sin(roll), Math.cos(roll), 0);

  const now = performance.now();
  for (let ri = 0; ri < rings.length; ri++) {
    const sf = Math.sin(now * 0.0012 + ri * 1.3);
    rings[ri].material.opacity = 0.55 + sf * 0.3;
    rings[ri].scale.setScalar(1 + sf * 0.04);
  }

  // particles ride the precomputed curve LUT — two array reads + a lerp per
  // particle, instead of an arc-length search + Vector3 allocation each (700×/frame)
  const arr = ptGeo.attributes.position.array;
  const drift = 0.00018 * TEST.particleDir * dt;
  const aOff = now * 0.0001;
  for (let i = 0; i < ptCount; i++) {
    let tt = ptSeeds[i*3] + drift;
    if (tt > 1) tt -= 1; else if (tt < 0) tt += 1;
    ptSeeds[i*3] = tt;
    const a = ptSeeds[i*3+1] + aOff;
    const r = ptSeeds[i*3+2];
    const f = tt * (CURVE_LUT_N - 1);
    const i0 = f | 0;
    const i1 = i0 < CURVE_LUT_N - 1 ? i0 + 1 : i0;
    const fr = f - i0;
    const b0 = i0 * 3, b1 = i1 * 3;
    arr[i*3]   = curveLUT[b0]   + (curveLUT[b1]   - curveLUT[b0])   * fr + Math.cos(a) * r;
    arr[i*3+1] = curveLUT[b0+1] + (curveLUT[b1+1] - curveLUT[b0+1]) * fr + Math.sin(a) * r;
    arr[i*3+2] = curveLUT[b0+2] + (curveLUT[b1+2] - curveLUT[b0+2]) * fr;
  }
  ptGeo.attributes.position.needsUpdate = true;
  } // end tunnelVisible

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

  // gate the first GL render on async shader compile (see compileAsync above);
  // once shadersReady flips true it stays true, so this is a no-op thereafter.
  if (!supportsOffscreen) {
    if (tunnelVisible && shadersReady && !introPlaying && renderTunnel) renderer.render(scene, camera);

    if (outroActive) {
      StarfieldEffect.draw(dt);
    }
  }

  if (!supportsOffscreen && statsEl) {
    statsFrames++;
    if (nowMs - statsLast >= 500) {
      const fps = statsFrames * 1000 / (nowMs - statsLast);
      const sScale = (effDPR() * QUALITY.starScale).toFixed(2);
      statsEl.textContent =
        `fps    ${fps.toFixed(0)}\n` +
        `dprCap ${QUALITY.dprCap}  → eff ${effDPR().toFixed(2)}\n` +
        `device ${(window.devicePixelRatio || 1).toFixed(2)}\n` +
        `star   ${sScale}×  (${StarfieldEffect.stars.length} rays)\n` +
        `scroll ${(p * 100).toFixed(0)}%\n` +
        `layers ${tunnelVisible ? 'GL ' : '·· '}${outroActive ? '2D' : '··'}`;
      statsFrames = 0; statsLast = nowMs;
    }
  }

  requestAnimationFrame(frame);
}
frame();

// Kick off autoplay intro on load (re-measure the scroll range once settled)
function initAutoplay() {
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
  window.scrollTo(0, 0);
  updateScrollMax();
  updateScroll();

  const dom = {
    bootLog: document.getElementById('bootLog'),
    bootEl: document.getElementById('boot'),
    splashEl: document.getElementById('splash'),
    logoLeft: document.getElementById('logoLeft'),
    logoRight: document.getElementById('logoRight'),
    splashName: document.getElementById('splashName'),
    splashSub: document.getElementById('splashSub'),
    canvas: document.getElementById('tunnel-canvas'),
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
      if (supportsOffscreen && worker) {
        worker.postMessage({ type: 'setIntroPlaying', val });
      }
    },
  };

  const callbacks = {
    setRenderTunnel: (val) => {
      if (supportsOffscreen && worker) {
        worker.postMessage({ type: 'setRenderTunnel', val });
      } else {
        renderTunnel = val;
      }
    },
    onComplete: () => {
      setupInteractionListeners();
    }
  };

  setTimeout(() => runAutoplay(dom, state, callbacks), 200);
}

if (document.readyState !== 'loading') {
  initAutoplay();
} else {
  window.addEventListener('load', initAutoplay);
}



