// ============================================================
// TUNNEL SCENE / SIMULATION
// ------------------------------------------------------------
// The three.js tunnel + 2D starfield outro. Dynamically imported by the
// main-thread host (home.js) so three.js + the precomputed geometry stay out
// of the main bundle.
//
// All the per-frame math (tube build, ring layout, particle drift, camera
// easing, starfield projection, scroll→reveal mapping) lives here.
//
// The module stays decoupled from the DOM: it never reaches for `document`
// directly. Everything that crosses the boundary is injected:
//   · the canvases + viewport come in as parameters,
//   · DOM-style outputs go out through the `onDomUpdate` callback.
// The host owns the rAF loop, scroll input and scroll-smoothing, then calls
// `renderFrame(nowMs, dt, p, renderTunnel, introPlaying)` once per tick.
// ============================================================
import * as THREE from 'three';
import { currentCenterline } from './centerline.js';
import { PHASES, CONFIG, CHAPTERS } from './config.js';
// Heavy tube wireframes, precomputed at build time (see astro.config.mjs), are
// passed in as `tubeWF1`/`tubeWF2` params: the host fetches the pre-gzipped
// binary asset (tunnelGeometry.js) in parallel with this chunk and hands the
// inflated Float32Array views to createTunnelScene().

// Cap the device-pixel-ratio we render at: on 2×/3× retina screens this stops
// us drawing 4–9× the pixels for no visible gain (the single biggest GPU cost).
const DPR_CAP = 1.5;

export function createTunnelScene({
  tunnelCanvas,
  starCanvas,
  width,
  height,
  dpr,
  tubeWF1,          // Float32Array  precomputed wireframe vertices (tube 1)
  tubeWF2,          // Float32Array  precomputed wireframe vertices (tube 2)
  onDomUpdate,      // (state) => void   apply vapor/tunnel style state
  onShadersReady,   // () => void
}) {
  let viewW = width, viewH = height, viewDPR = dpr;
  function effDPR() { return Math.min(viewDPR, DPR_CAP); }

  // ---- scene / camera / renderer ----
  const renderer = new THREE.WebGLRenderer({ canvas: tunnelCanvas, antialias: true, alpha: true });
  renderer.setPixelRatio(effDPR());
  renderer.setSize(viewW, viewH, false);
  renderer.setClearColor(0x000000, 0); // transparent background so starfield shows through

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x070c0a, 0.038);
  const camera = new THREE.PerspectiveCamera(60, viewW / viewH, 0.1, 1000);

  const starCtx = starCanvas.getContext('2d');

  // ---- per-curve caches + scratch vectors (perf) ----
  // Everything derivable from the curve alone is computed ONCE per tube build:
  // the exit point/tangent, the opening-edge point, and a dense LUT of curve
  // samples for the particle system. The frame loop reuses these scratch
  // vectors instead of allocating new THREE.Vector3s every frame.
  const _tmpV1 = new THREE.Vector3();
  const _tmpV2 = new THREE.Vector3();
  const _camLook = new THREE.Vector3();
  const CURVE_LUT_N = 1024;
  const curveLUT = new Float32Array(CURVE_LUT_N * 3);
  const curveEnd = new THREE.Vector3();        // curve.getPointAt(0.999)
  const curveEndTangent = new THREE.Vector3(); // exit tangent (normalised)
  const openingEdge = new THREE.Vector3();      // curveEnd + perpendicular · tube radius
  let curve = null;

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

  // Green wireframes (terminal aesthetic).
  const tubeMat1 = new THREE.LineBasicMaterial({ color: 0x4f8c6f, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
  const tubeMat2 = new THREE.LineBasicMaterial({ color: 0x284a3b, transparent: true, opacity: 0.40, blending: THREE.AdditiveBlending, depthWrite: false });
  let tubeMesh1 = null, tubeMesh2 = null;
  const activeTube = 'v1d';

  // The curve is still created at runtime — it's cheap and needed every frame
  // for the camera (curve.getPointAt) and the ring layout. Only the tube
  // MESHING was expensive, so that's what we precompute: the wireframe vertex
  // buffers come in ready-made from virtual:tunnel-geometry, built from this
  // exact same curve at build time, and just get wrapped in LineSegments here.
  function buildTube() {
    curve = new THREE.CatmullRomCurve3(currentCenterline(activeTube, CONFIG), false, 'catmullrom', 0.5);
    refreshCurveCache();
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute('position', new THREE.BufferAttribute(tubeWF1, 3));
    tubeMesh1 = new THREE.LineSegments(g1, tubeMat1);
    tubeMesh1.frustumCulled = false;
    scene.add(tubeMesh1);
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(tubeWF2, 3));
    tubeMesh2 = new THREE.LineSegments(g2, tubeMat2);
    tubeMesh2.frustumCulled = false;
    scene.add(tubeMesh2);
    if (rings.length) layoutRings();
  }

  // Green station rings, placed along the curve from the chapter positions.
  const rings = [];
  const ringHalos = [];
  const ringLocalT = [];
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

  // (re)place rings/halos along the current curve — called after any bend rebuild
  function layoutRings() {
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
  const ptCount = 700;
  const ptGeo = new THREE.BufferGeometry();
  const ptPos = new Float32Array(ptCount * 3);
  const ptSeeds = new Float32Array(ptCount * 3);
  for (let i = 0; i < ptCount; i++) {
    ptSeeds[i*3] = Math.random();
    ptSeeds[i*3+1] = Math.random() * Math.PI * 2;
    ptSeeds[i*3+2] = 1.8 + Math.random() * 3.4;
  }
  ptGeo.setAttribute('position', new THREE.BufferAttribute(ptPos, 3));
  const points = new THREE.Points(ptGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.06, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  points.frustumCulled = false;
  scene.add(points);

  // ============================================================
  // SHADER COMPILE — warm the compile/link caches before the first visible
  // render so the first frame doesn't stall the boot-log typing. With
  // KHR_parallel_shader_compile (most Chromium) compileAsync runs on a
  // background GPU thread. Engines without it (e.g. Firefox) compile
  // SYNCHRONOUSLY — and since the scene now runs on the main thread, that
  // briefly blocks it here. Impact is low: the materials are all trivial
  // built-ins (LineBasic/Points/MeshBasic), the compile is one-time and early,
  // and it's hidden behind the boot screen — worst case a single-frame hitch in
  // the boot-log typing on Firefox.
  // ============================================================
  let shadersReady = true;
  if (typeof renderer.compileAsync === 'function') {
    renderer.compileAsync(scene, camera)
      .then(() => {
        renderer.render(scene, camera); // warm compile/link caches behind the boot screen
        onShadersReady();
      })
      .catch(() => {
        onShadersReady();
      });
  } else {
    onShadersReady();
  }

  // ============================================================
  // OUTRO — Starfield
  // ============================================================
  let outroActive = false;
  // shared smoothed reveal centre (projected tube opening, low-passed) — drives
  // BOTH the reveal mask and (optionally) the starfield rays' vanishing point.
  let revealFocalX = null, revealFocalY = null, revealFocalValid = false;
  let alignSmooth = 0;   // low-passed camera→end alignment (kills per-frame jitter)
  let lastOpening = null;
  let openSmoothX = null, openSmoothY = null;

  // quantised stroke-style cache — avoids building a fresh rgba() string per star per frame
  const STAR_STROKES = [];
  for (let i = 0; i < 256; i++) STAR_STROKES.push(`rgba(184, 240, 208, ${(i / 255).toFixed(3)})`);
  // reusable opacity bins: stars grouped by quantised alpha so the whole field
  // draws in ≤STAR_BIN_COUNT stroke calls/frame instead of one per star.
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
    // spread distribution: a band 0..1 controls how far from the axis a star
    // sits, giving a natural density falloff from centre to edges.
    respawnXY(s) {
      const spread = 60 + Math.pow(s.band, 0.85) * 1040; // ~60 (centre) → ~1100 (edge)
      const ang = Math.random() * Math.PI * 2;
      const r = spread * (0.18 + 0.82 * Math.random());
      s.x = Math.cos(ang) * r;
      s.y = Math.sin(ang) * r;
    },
    setup() {
      const scale = starCanvas._renderScale || 1;
      const W = starCanvas.width / scale, H = starCanvas.height / scale; // logical (CSS px) size
      this.cx = W / 2;
      this.cy = H * CONFIG.starFocalY;
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
      dt = dt || 1; // 1.0 == one 60fps tick; >1 when frames are slow
      const scale = starCanvas._renderScale || 1;
      const W = starCanvas.width / scale, H = starCanvas.height / scale;

      // ---- rays vs opening: vanishing point tracks the opening ----
      let fx = W / 2, fy = H * CONFIG.starFocalY;
      if (revealFocalValid) {
        fx = revealFocalX;
        fy = revealFocalY;
      }
      this.cx = fx;
      this.cy = fy;

      // ---- trail fade: wipes harder while the focal point is moving to prevent smearing ----
      const mvx = fx - (this._pfx ?? fx), mvy = fy - (this._pfy ?? fy);
      const fade = Math.min(CONFIG.fadeMax, CONFIG.fadeBase + Math.hypot(mvx, mvy) * CONFIG.fadeGain);
      this._pfx = fx; this._pfy = fy;
      starCtx.fillStyle = CONFIG.outroBgMatch ? `rgba(7, 12, 10, ${fade.toFixed(3)})` : `rgba(0, 0, 0, ${fade.toFixed(3)})`;
      starCtx.fillRect(0, 0, W, H);

      const velocity = CONFIG.starVelocity * CONFIG.starDir;
      const stars = this.stars, fov2 = this.fov, scx = this.cx, scy = this.cy;
      const dz = velocity * dt;

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

      for (let b = 0; b < STAR_BIN_COUNT; b++) {
        const list = bins[b];
        if (!list.length) continue;
        starCtx.strokeStyle = STAR_BIN_STROKE[b];
        starCtx.lineWidth = STAR_BIN_LW[b];
        starCtx.beginPath();
        for (let j = 0; j < list.length; j++) {
          const s = list[j];
          starCtx.moveTo(s.lx, s.ly);
          starCtx.lineTo(s.px, s.py);
        }
        starCtx.stroke();
      }
    }
  };

  function resizeOutroCanvas() {
    // render the starfield at the clamped DPR; keep the CSS box at viewport
    // size so it still fills the screen, just at a capped resolution.
    const scale = effDPR();
    starCanvas._renderScale = scale;
    starCanvas.width = Math.round(viewW * scale);
    starCanvas.height = Math.round(viewH * scale);
    // setting width/height RESETS the 2D transform, so (re)apply the scale here
    // once per resize instead of inside the per-frame draw().
    starCtx.setTransform(scale, 0, 0, scale, 0, 0);
  }
  resizeOutroCanvas();

  // ============================================================
  // PHASE OPACITY (driven by scroll for tunnel + vapor)
  // ============================================================
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function smoothstep(x) { return x*x*(3 - 2*x); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  let vaporHidden = true;   // mirrors the CSS initial state of #vapor (hidden)
  let maskDropped = false;  // true once the reveal is fully open and the mask has been released

  // reused scratch state object — no per-frame allocation crossing the boundary
  const _dom = {
    hideNav: false, tunnelOpacity: 1, vaporOpacity: '0', vaporVisibility: 'hidden',
    mask: 'none', contentRise: 0,
  };
  function emitDom(hideNav, tunnelOpacity, vaporOpacity, vaporVisibility, mask, contentRise) {
    _dom.hideNav = hideNav;
    _dom.tunnelOpacity = tunnelOpacity;
    _dom.vaporOpacity = vaporOpacity;
    _dom.vaporVisibility = vaporVisibility;
    _dom.mask = mask;
    _dom.contentRise = contentRise;
    onDomUpdate(_dom);
  }

  // project the tube's far opening (centre + edge) to screen, so the reveal can
  // be sized/placed to the REAL opening rather than a guessed disc.
  function projectTubeOpening() {
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

  function updateLayers(p) {
    const shouldHideNav = p >= 0.91;
    // Tunnel canvas opacity: fully visible through tunnelEnd, then fade to 0 by tunnelFlash
    const tunnelOpacity = p > PHASES.tunnelEnd
      ? 1 - clamp01((p - PHASES.tunnelEnd) / (PHASES.tunnelFlash - PHASES.tunnelEnd))
      : 1;

    // starfield emerge owns the vapor reveal across a wider range
    if (CONFIG.emerge) {
      updateEmerge(p, shouldHideNav, tunnelOpacity);
      return;
    }

    // Non-emerge path (fallback, rarely used now)
    if (p > PHASES.outroIn) {
      vaporHidden = false;
      const t = clamp01((p - PHASES.outroIn) / (PHASES.outroFull - PHASES.outroIn));
      const wasActive = outroActive;
      outroActive = t > 0.05;
      if (outroActive && !wasActive) StarfieldEffect.setup();
      emitDom(shouldHideNav, tunnelOpacity, (t*t*(3-2*t)).toFixed(3), 'visible', 'none', t);
    } else {
      vaporHidden = true;
      outroActive = false;
      emitDom(shouldHideNav, tunnelOpacity, '0', 'hidden', 'none', 0);
    }
  }

  // the starfield reveals through a SOFT-EDGED circle centred on the tube's
  // vanishing point — grows out of the far opening, feathers into the walls,
  // fills the screen as we punch through, then the content rises from the bottom.
  function updateEmerge(p, shouldHideNav, tunnelOpacity) {
    const toEnd = _tmpV1.copy(curveEnd).sub(camera.position).normalize();
    camera.getWorldDirection(_tmpV2);
    const alignRaw = _tmpV2.dot(toEnd);               // 1 = looking straight at the end
    alignSmooth += (alignRaw - alignSmooth) * 0.15;   // low-pass to kill wave/roll jitter

    // align safety gate: 0 while the sharp bend hides the opening → 1 once we're
    // looking down the barrel. Keeps the field from bleeding mid-bend.
    const gate = smoothstep(clamp01((alignSmooth - CONFIG.revealAlign) / 0.18));
    // continuous scroll-driven growth: 0 at revealStartP → 1 at revealFullP
    const span = Math.max(0.001, CONFIG.revealFullP - CONFIG.revealStartP);
    const growth = smoothstep(clamp01((p - CONFIG.revealStartP) / span));
    // Once the reveal has begun opening, LATCH it open (growth only rises after
    // revealStartP, well past the bend, so latching can't cause early bleed).
    const effGate = Math.max(gate, growth);
    // lead-in factor: 0 until just shy of revealStartP — skip projecting while 0.
    const lead = smoothstep(clamp01((p - (CONFIG.revealStartP - 0.02)) / 0.02));

    const op = (lead > 0 && effGate > 0) ? projectTubeOpening() : null;
    const vw = viewW, vh = viewH;
    let inView = 0;
    if (op) {
      const ex = Math.min(op.cx, vw - op.cx) / vw;   // 0 at the screen edge → 0.5 at centre
      const ey = Math.min(op.cy, vh - op.cy) / vh;
      inView = smoothstep(clamp01(Math.min(ex, ey) / 0.18));
    }

    // overall presence: can't appear before aligned/started, NOR before the
    // opening is actually in view
    const present = effGate * inView * lead;

    if (present <= 0.001) {
      outroActive = false;
      revealFocalValid = false;
      if (!vaporHidden) {           // write the hidden state ONCE, not every frame
        vaporHidden = true;
        maskDropped = false;         // re-arm the mask so it re-applies on re-entry
        openSmoothX = null;          // re-seed the opening smoother on next entry
        openSmoothY = null;
        emitDom(shouldHideNav, tunnelOpacity, '0', 'hidden', 'none', 0);
      }
      return;
    }

    if (vaporHidden) vaporHidden = false;

    const wasActive = outroActive;
    outroActive = true;
    if (!wasActive) StarfieldEffect.setup();

    // layer fades in with the align gate. Once growth is 1.0 (mask fully open), force opacity to 1.0.
    const effOpacity = (growth >= 1.0) ? 1.0 : present;
    const vaporOpacity = effOpacity.toFixed(3);

    const w = vw, h = vh;
    const cx = w / 2, cy = h / 2;

    // LIVE anchor on the projected opening. While the field is still young/faint
    // (present < 0.5) the anchor is GLUED to the opening (zero smoothing lag);
    // once established, an adaptive low-pass takes over.
    let maskCx = cx, maskCy = cy;
    if (op) {
      if (openSmoothX == null) {
        openSmoothX = op.cx;
        openSmoothY = op.cy;
      }
      const dxm = op.cx - openSmoothX, dym = op.cy - openSmoothY;
      const err = Math.hypot(dxm, dym);
      const k = (present < 0.5) ? 1 : Math.min(1, 0.15 + err / 240);
      openSmoothX += dxm * k;
      openSmoothY += dym * k;
      const recentre = smoothstep(clamp01(growth / 0.4)); // 0 → 1 across the FIRST 40% of growth
      maskCx = lerp(openSmoothX, cx, recentre);
      maskCy = lerp(openSmoothY, cy, recentre);
    }

    const coverR = Math.hypot(w, h) * 0.5 + 4;          // radius that fully covers the viewport
    const rad = lerp(CONFIG.revealR0, coverR, growth);    // small → fullscreen, continuous

    // share the centre out so the starfield rays can emanate from it too
    revealFocalX = maskCx;
    revealFocalY = maskCy;
    revealFocalValid = true;

    // once the reveal is fully open the mask is a screen-covering disc the
    // compositor must keep rasterising for no gain — release it to 'none' ONCE.
    let mask;
    if (growth >= 1.0) {
      mask = 'none';
      maskDropped = true;
    } else {
      maskDropped = false;
      const feather = Math.max(24, rad * 0.3);
      const inner = Math.max(0, rad - feather);
      mask = `radial-gradient(circle ${rad.toFixed(1)}px at ${maskCx.toFixed(1)}px ${maskCy.toFixed(1)}px, #000 ${inner.toFixed(1)}px, rgba(0,0,0,0) ${rad.toFixed(1)}px)`;
    }

    // content rises on SCROLL — a stretch of pure full-screen starfield first.
    const cStart = CONFIG.contentRise;
    const cEnd = Math.min(1.0, cStart + 0.02);
    const ce = smoothstep(clamp01((p - cStart) / (cEnd - cStart)));

    emitDom(shouldHideNav, tunnelOpacity, vaporOpacity, 'visible', mask, ce);
  }

  // ============================================================
  // PER-FRAME — host owns the rAF loop + scroll smoothing and calls this once
  // per tick with the already-smoothed scroll position `p`.
  // ============================================================
  function renderFrame(nowMs, dt, p, renderTunnel, introPlaying) {
    updateLayers(p);

    // SKIP INVISIBLE LAYERS — the tunnel canvas fades to 0 at tunnelFlash; past
    // that there is no point running its camera, ring/particle sim, or GL render.
    const tunnelVisible = p < PHASES.tunnelFlash;

    if (tunnelVisible && !introPlaying && renderTunnel) {
      let tCurve;
      if (p < PHASES.tunnelOut) {
        tCurve = lerp(0.001, 0.92, p / PHASES.tunnelOut);
      } else if (p < PHASES.tunnelEnd) {
        const lateP = clamp01((p - PHASES.tunnelOut) / (PHASES.tunnelEnd - PHASES.tunnelOut));
        tCurve = lerp(0.92, 0.998, 1 - Math.pow(1 - lateP, 2));
      } else {
        // past tunnelEnd, keep pushing the camera forward past the mouth so it
        // physically flies out of the tube (tCurve climbs above 1.0).
        const outP = clamp01((p - PHASES.tunnelEnd) / (1 - PHASES.tunnelEnd));
        tCurve = 0.998 + outP * 0.15;
      }

      if (tCurve <= 0.999) {
        curve.getPointAt(Math.min(0.999, tCurve), camera.position);
        curve.getPointAt(Math.min(0.999, tCurve + 0.008), _camLook);
        camera.lookAt(_camLook);
      } else {
        // flying out: extrapolate straight along the exit tangent (cached per build)
        const distPastEnd = (tCurve - 0.999) * 220;
        camera.position.copy(curveEnd).addScaledVector(curveEndTangent, distPastEnd);
        camera.lookAt(_camLook.copy(curveEnd).addScaledVector(curveEndTangent, distPastEnd + 20));
      }
      const roll = Math.sin(nowMs * 0.0002) * 0.04;
      camera.up.set(Math.sin(roll), Math.cos(roll), 0);

      for (let ri = 0; ri < rings.length; ri++) {
        const sf = Math.sin(nowMs * 0.0012 + ri * 1.3);
        rings[ri].material.opacity = 0.55 + sf * 0.3;
        rings[ri].scale.setScalar(1 + sf * 0.04);
      }

      // particles ride the precomputed curve LUT — two array reads + a lerp per
      // particle, instead of an arc-length search + Vector3 alloc each (700×/frame)
      const arr = ptGeo.attributes.position.array;
      const drift = 0.00018 * CONFIG.particleDir * dt;
      const aOff = nowMs * 0.0001;
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
    }

    if (tunnelVisible && shadersReady && !introPlaying && renderTunnel) {
      renderer.render(scene, camera);
    }

    if (outroActive) {
      StarfieldEffect.draw(dt);
    }
  }

  function resize(w, h, newDpr) {
    viewW = w; viewH = h; viewDPR = newDpr;
    renderer.setPixelRatio(effDPR());
    renderer.setSize(viewW, viewH, false);
    camera.aspect = viewW / viewH;
    camera.updateProjectionMatrix();
    resizeOutroCanvas();
  }

  return { renderFrame, resize };
}
