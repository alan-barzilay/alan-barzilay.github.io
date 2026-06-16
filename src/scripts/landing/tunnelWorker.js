import * as THREE from 'three';
import { currentCenterline } from './centerline.js';

let renderer, scene, camera, fogDefault;
let curve;
let tunnelCanvas, starCanvas, starCtx;

const _tmpV1 = new THREE.Vector3();
const _tmpV2 = new THREE.Vector3();
const _camLook = new THREE.Vector3();

const CURVE_LUT_N = 1024;
const curveLUT = new Float32Array(CURVE_LUT_N * 3);
const curveEnd = new THREE.Vector3();
const curveEndTangent = new THREE.Vector3();
const openingEdge = new THREE.Vector3();

let rings = [];
let ringHalos = [];
let ringLocalT = [];
let tubeMesh1 = null, tubeMesh2 = null;

let ptGeo, ptCount = 700, ptPos, ptSeeds, ptMat, points;

let QUALITY = { dprCap: 1.5, starScale: 1.0 };
let PHASES = {
  tunnelIn:    0.00,
  tunnelOut:   0.85,
  tunnelEnd:   0.93,
  tunnelFlash: 0.94,
  outroIn:     0.94,
  outroFull:   0.98,
};
let TEST = {
  starVelocity: 5,
  starDir: 1,
  starFocalY: 0.5,
  contentRise: 0.92,
  particleDir: -1,
  emerge: true,
  emergeGlow: false,
  emergeBehind: false,
  outroBgMatch: true,
  revealR0: 40,
  revealStartP: 0.82,
  revealFullP: 0.905,
  revealAlign: 0.30,
  endBend: 50,
  endBendStart: 0.92,
  bendAngle: 90,
  startBend: 15,
  startBendLen: 0.10,
  startBendAngle: 260,
  rayMode: 'fade',
  fadeBase: 0.18,
  fadeGain: 0.05,
  fadeMax:  0.85,
};

let activeTube = 'v1d';
let fogEnabled = true;
let currentBlendMode = 'additive';
let lumGain = 0.5;
let pureBlackBg = false;
let viewW = 800, viewH = 600;

let shadersReady = false;
let outroActive = false;
let revealFocalX = null, revealFocalY = null, revealFocalValid = false;
let starVelMulCurrent = 0.30;
let alignSmooth = 0;
let lastTCurve = 0;
let lastOpening = null;

let renderTunnel = false;
let introPlaying = true;
let scrollP = 0;

const CHAPTERS = [
  { id: "intro",    label: "intro",       at: 0.05 },
  { id: "work",     label: "work",        at: 0.20 },
  { id: "research", label: "research",    at: 0.34 },
  { id: "education", label: "education & volunteering", at: 0.48 },
  { id: "diy",      label: "built",       at: 0.62 },
  { id: "oss",      label: "open source", at: 0.76 },
];

const BLEND_MODES = {
  additive: { builtin: THREE.AdditiveBlending },
  screen:   { custom: { equation: THREE.AddEquation, src: THREE.OneFactor, dst: THREE.OneMinusSrcColorFactor } },
  softadd:  { custom: { equation: THREE.AddEquation, src: THREE.ConstantColorFactor, dst: THREE.OneFactor }, usesGain: true },
  average:  { custom: { equation: THREE.AddEquation, src: THREE.ConstantColorFactor, dst: THREE.OneMinusConstantColorFactor }, constant: 0.5 },
  lighten:  { custom: { equation: THREE.MaxEquation, src: THREE.OneFactor, dst: THREE.OneFactor } },
  normal:   { builtin: THREE.NormalBlending },
  multiply: { builtin: THREE.MultiplyBlending },
  darken:   { custom: { equation: THREE.MinEquation, src: THREE.OneFactor, dst: THREE.OneFactor } },
  subtract: { builtin: THREE.SubtractiveBlending },
  difference: { custom: { equation: THREE.ReverseSubtractEquation, src: THREE.OneFactor, dst: THREE.OneFactor } },
  tubecolor: { custom: { equation: THREE.AddEquation, src: THREE.ConstantColorFactor, dst: THREE.ZeroFactor }, constantColorHex: 0x4f8c6f },
};

let tubeMat1 = new THREE.LineBasicMaterial({ color: 0x4f8c6f, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
let tubeMat2 = new THREE.LineBasicMaterial({ color: 0x284a3b, transparent: true, opacity: 0.40, blending: THREE.AdditiveBlending, depthWrite: false });

function effDPR() { return Math.min(viewDPR, QUALITY.dprCap); }
let viewDPR = 1;

function refreshCurveCache() {
  for (let i = 0; i < CURVE_LUT_N; i++) {
    curve.getPointAt(i / (CURVE_LUT_N - 1), _tmpV1);
    curveLUT[i*3] = _tmpV1.x; curveLUT[i*3+1] = _tmpV1.y; curveLUT[i*3+2] = _tmpV1.z;
  }
  curve.getPointAt(0.999, curveEnd);
  curve.getTangentAt(0.999, curveEndTangent).normalize();
  const perp = _tmpV1.set(0, 1, 0).cross(curveEndTangent);
  if (perp.lengthSq() < 1e-4) perp.set(1, 0, 0).cross(curveEndTangent);
  perp.normalize().multiplyScalar(6);
  openingEdge.copy(curveEnd).add(perp);
}

function applyBlend(mat, desc) {
  if (desc.builtin !== undefined) {
    mat.blending = desc.builtin;
  } else {
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = desc.custom.equation;
    mat.blendSrc = desc.custom.src;
    mat.blendDst = desc.custom.dst;
    if (desc.usesGain) mat.blendColor.setScalar(lumGain);
    else if (desc.constantColorHex !== undefined) mat.blendColor.setHex(desc.constantColorHex);
    else if (desc.constant !== undefined) mat.blendColor.setScalar(desc.constant);
  }
  mat.needsUpdate = true;
}

function setBlendMode(modeName) {
  const desc = BLEND_MODES[modeName];
  if (!desc) return;
  currentBlendMode = modeName;
  applyBlend(tubeMat1, desc);
  applyBlend(tubeMat2, desc);
}

function buildTube() {
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
  if (rings.length) layoutRings();
}

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

// Outro Starfield
const STAR_STROKES = [];
for (let i = 0; i < 256; i++) STAR_STROKES.push(`rgba(184, 240, 208, ${(i / 255).toFixed(3)})`);
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
  respawnXY(s) {
    const spread = 60 + Math.pow(s.band, 0.85) * 1040;
    const ang = Math.random() * Math.PI * 2;
    const r = spread * (0.18 + 0.82 * Math.random());
    s.x = Math.cos(ang) * r;
    s.y = Math.sin(ang) * r;
  },
  setup() {
    const scale = starCanvas._renderScale || 1;
    const W = starCanvas.width / scale, H = starCanvas.height / scale;
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
    dt = dt || 1;
    const scale = starCanvas._renderScale || 1;
    const W = starCanvas.width / scale, H = starCanvas.height / scale;

    const mode = TEST.rayMode;
    let fx = W / 2, fy = H * TEST.starFocalY;
    if ((mode === 'follow' || mode === 'fade') && revealFocalValid) {
      fx = revealFocalX;
      fy = revealFocalY;
    } else if (mode === 'shift') {
      fx = W / 2;
      fy = H / 2;
    }
    this.cx = fx;
    this.cy = fy;

    let fade = TEST.fadeBase;
    if (mode === 'fade') {
      const mvx = fx - (this._pfx ?? fx), mvy = fy - (this._pfy ?? fy);
      fade = Math.min(TEST.fadeMax, TEST.fadeBase + Math.hypot(mvx, mvy) * TEST.fadeGain);
    }
    this._pfx = fx; this._pfy = fy;
    starCtx.fillStyle = TEST.outroBgMatch ? `rgba(7, 12, 10, ${fade.toFixed(3)})` : `rgba(0, 0, 0, ${fade.toFixed(3)})`;
    starCtx.fillRect(0, 0, W, H);

    if (mode === 'shift' && revealFocalValid) {
      self.postMessage({ type: 'shift', x: (revealFocalX - W / 2).toFixed(1), y: (revealFocalY - H / 2).toFixed(1) });
    } else {
      self.postMessage({ type: 'shift', clear: true });
    }

    const velocity = TEST.starVelocity * TEST.starDir;
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
  const scale = effDPR() * QUALITY.starScale;
  starCanvas._renderScale = scale;
  starCanvas.width = Math.round(viewW * scale);
  starCanvas.height = Math.round(viewH * scale);
  starCtx.setTransform(scale, 0, 0, scale, 0, 0);
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function smoothstep(x) { return x*x*(3 - 2*x); }
function lerp(a, b, t) { return a + (b - a) * t; }

let lastMaskString = '';
let lastVaporOpacityVal = -1;
let lastCeVal = -1;
let lastGlowVal = -1;
let lastHideNavVal = null;
let maskDropped = false;
let vaporHidden = true;

function projectTubeOpening() {
  const cP = _tmpV1.copy(curveEnd).project(camera);
  if (cP.z >= 1) return lastOpening;
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
  const tunnelOpacity = p > PHASES.tunnelEnd
    ? 1 - clamp01((p - PHASES.tunnelEnd) / (PHASES.tunnelFlash - PHASES.tunnelEnd))
    : 1;

  if (TEST.emerge) {
    updateEmerge(p, shouldHideNav, tunnelOpacity);
    return;
  }

  // Fallback path
  if (p > PHASES.outroIn) {
    vaporHidden = false;
    const t = clamp01((p - PHASES.outroIn) / (PHASES.outroFull - PHASES.outroIn));
    const wasActive = outroActive;
    outroActive = t > 0.05;
    if (outroActive && !wasActive) StarfieldEffect.setup();

    const tOpacity = t*t*(3-2*t);
    self.postMessage({
      type: 'domUpdate',
      hideNav: shouldHideNav,
      tunnelOpacity: tunnelOpacity,
      vaporOpacity: tOpacity.toFixed(3),
      vaporVisibility: 'visible',
      mask: 'none',
      contentRise: t,
      glow: 0
    });
  } else {
    vaporHidden = true;
    outroActive = false;
    self.postMessage({
      type: 'domUpdate',
      hideNav: shouldHideNav,
      tunnelOpacity: tunnelOpacity,
      vaporOpacity: '0',
      vaporVisibility: 'hidden',
      mask: 'none',
      contentRise: 0,
      glow: 0
    });
  }
}

function updateEmerge(p, shouldHideNav, tunnelOpacity) {
  const toEnd = _tmpV1.copy(curveEnd).sub(camera.position).normalize();
  camera.getWorldDirection(_tmpV2);
  const alignRaw = _tmpV2.dot(toEnd);
  alignSmooth += (alignRaw - alignSmooth) * 0.15;

  const gate = smoothstep(clamp01((alignSmooth - TEST.revealAlign) / 0.18));
  const span = Math.max(0.001, TEST.revealFullP - TEST.revealStartP);
  const growth = smoothstep(clamp01((p - TEST.revealStartP) / span));
  const effGate = Math.max(gate, growth);
  const lead = smoothstep(clamp01((p - (TEST.revealStartP - 0.02)) / 0.02));

  const op = (lead > 0 && effGate > 0) ? projectTubeOpening() : null;
  const vw = viewW, vh = viewH;
  let inView = 0;
  if (op) {
    const ex = Math.min(op.cx, vw - op.cx) / vw;
    const ey = Math.min(op.cy, vh - op.cy) / vh;
    inView = smoothstep(clamp01(Math.min(ex, ey) / 0.18));
  }

  const present = effGate * inView * lead;

  if (present <= 0.001) {
    outroActive = false;
    revealFocalValid = false;
    if (!vaporHidden) {
      vaporHidden = true;
      maskDropped = false;
      self.postMessage({
        type: 'domUpdate',
        hideNav: shouldHideNav,
        tunnelOpacity: tunnelOpacity,
        vaporOpacity: '0',
        vaporVisibility: 'hidden',
        mask: 'none',
        contentRise: 0,
        glow: 0,
        resetSmooth: true
      });
      self.postMessage({ type: 'shift', clear: true });
    }
    return;
  }

  if (vaporHidden) { vaporHidden = false; }

  const wasActive = outroActive;
  outroActive = true;
  if (!wasActive) StarfieldEffect.setup();

  const effOpacity = (growth >= 1.0) ? 1.0 : present;
  const vaporOpacity = effOpacity.toFixed(3);

  let maskStr = 'none';
  if (growth >= 1.0) {
    if (!maskDropped) {
      maskDropped = true;
    }
  } else {
    maskDropped = false;
    const coverR = Math.hypot(vw, vh) * 0.5 + 4;
    const rad = lerp(TEST.revealR0, coverR, growth);
    let maskCx = vw / 2, maskCy = vh / 2;
    if (op) {
      if (self._openSmoothX == null) {
        self._openSmoothX = op.cx;
        self._openSmoothY = op.cy;
      }
      const dxm = op.cx - self._openSmoothX, dym = op.cy - self._openSmoothY;
      const err = Math.hypot(dxm, dym);
      const k = (present < 0.5) ? 1 : Math.min(1, 0.15 + err / 240);
      self._openSmoothX += dxm * k;
      self._openSmoothY += dym * k;
      const recentre = smoothstep(clamp01(growth / 0.4));
      maskCx = lerp(self._openSmoothX, vw / 2, recentre);
      maskCy = lerp(self._openSmoothY, vh / 2, recentre);
    }
    const feather = Math.max(24, rad * 0.3);
    const inner = Math.max(0, rad - feather);
    maskStr = `radial-gradient(circle ${rad.toFixed(1)}px at ${maskCx.toFixed(1)}px ${maskCy.toFixed(1)}px, #000 ${inner.toFixed(1)}px, rgba(0,0,0,0) ${rad.toFixed(1)}px)`;

    revealFocalX = maskCx;
    revealFocalY = maskCy;
    revealFocalValid = true;
  }

  const cStart = TEST.contentRise;
  const cEnd = Math.min(1.0, cStart + 0.02);
  const ce = smoothstep(clamp01((p - cStart) / (cEnd - cStart)));
  const glow = TEST.emergeGlow ? ((0.10 + 0.28 * growth) * (1 - ce)).toFixed(3) : 0;

  self.postMessage({
    type: 'domUpdate',
    hideNav: shouldHideNav,
    tunnelOpacity: tunnelOpacity,
    vaporOpacity: vaporOpacity,
    vaporVisibility: 'visible',
    mask: maskStr,
    contentRise: ce,
    glow: glow
  });
}

// Stats variables
let statsFrames = 0, statsLast = 0;

function frame(ts) {
  const nowMs = ts || performance.now();
  let dt = (nowMs - (frame._last || nowMs)) / 16.667;
  frame._last = nowMs;
  if (dt > 4) dt = 4;
  if (dt <= 0) dt = 1;

  if (typeof scrollP !== 'undefined') {
    self.smoothP += (scrollP - self.smoothP) * (1 - Math.pow(1 - 0.07, dt));
    if (Math.abs(scrollP - self.smoothP) < 0.00002) self.smoothP = scrollP;
    const p = self.smoothP;
    updateLayers(p);

    const tunnelVisible = p < PHASES.tunnelFlash;

    if (tunnelVisible && !introPlaying && renderTunnel) {
      let tCurve;
      if (p < PHASES.tunnelOut) {
        tCurve = lerp(0.001, 0.92, p / PHASES.tunnelOut);
      } else if (p < PHASES.tunnelEnd) {
        const lateP = clamp01((p - PHASES.tunnelOut) / (PHASES.tunnelEnd - PHASES.tunnelOut));
        tCurve = lerp(0.92, 0.998, 1 - Math.pow(1 - lateP, 2));
      } else {
        const outP = clamp01((p - PHASES.tunnelEnd) / (1 - PHASES.tunnelEnd));
        tCurve = 0.998 + outP * 0.15;
      }

      if (tCurve <= 0.999) {
        curve.getPointAt(Math.min(0.999, tCurve), camera.position);
        curve.getPointAt(Math.min(0.999, tCurve + 0.008), _camLook);
        camera.lookAt(_camLook);
      } else {
        const distPastEnd = (tCurve - 0.999) * 220;
        camera.position.copy(curveEnd).addScaledVector(curveEndTangent, distPastEnd);
        camera.lookAt(_camLook.copy(curveEnd).addScaledVector(curveEndTangent, distPastEnd + 20));
      }
      lastTCurve = tCurve;
      const roll = Math.sin(nowMs * 0.0002) * 0.04;
      camera.up.set(Math.sin(roll), Math.cos(roll), 0);

      for (let ri = 0; ri < rings.length; ri++) {
        const sf = Math.sin(nowMs * 0.0012 + ri * 1.3);
        rings[ri].material.opacity = 0.55 + sf * 0.3;
        rings[ri].scale.setScalar(1 + sf * 0.04);
      }

      const arr = ptGeo.attributes.position.array;
      const drift = 0.00018 * TEST.particleDir * dt;
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

    // Stats calculations
    statsFrames++;
    if (nowMs - statsLast >= 500) {
      const fpsVal = statsFrames * 1000 / (nowMs - statsLast);
      const layers = (tunnelVisible ? 'GL ' : '·· ') + (outroActive ? '2D' : '··');
      self.postMessage({
        type: 'stats',
        fps: fpsVal.toFixed(0),
        layers: layers,
        scroll: (p * 100).toFixed(0)
      });
      statsFrames = 0; statsLast = nowMs;
    }
  }

  requestAnimationFrame(frame);
}

self.smoothP = 0;
scrollP = 0;

self.onmessage = function (e) {
  const data = e.data;
  switch (data.type) {
    case 'init':
      tunnelCanvas = data.canvas;
      starCanvas = data.starCanvas;
      starCtx = starCanvas.getContext('2d');
      viewW = data.width;
      viewH = data.height;
      viewDPR = data.dpr;
      
      renderer = new THREE.WebGLRenderer({ canvas: tunnelCanvas, antialias: true, alpha: true });
      renderer.setPixelRatio(viewDPR);
      renderer.setSize(viewW, viewH, false);
      renderer.setClearColor(0x000000, 0);

      scene = new THREE.Scene();
      fogDefault = new THREE.FogExp2(0x070c0a, 0.038);
      scene.fog = fogDefault;
      camera = new THREE.PerspectiveCamera(60, viewW / viewH, 0.1, 1000);

      // Chapter setup
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

      buildTube();

      // White particles
      ptGeo = new THREE.BufferGeometry();
      ptPos = new Float32Array(ptCount * 3);
      ptSeeds = new Float32Array(ptCount * 3);
      for (let i = 0; i < ptCount; i++) {
        ptSeeds[i*3] = Math.random();
        ptSeeds[i*3+1] = Math.random() * Math.PI * 2;
        ptSeeds[i*3+2] = 1.8 + Math.random() * 3.4;
      }
      ptGeo.setAttribute('position', new THREE.BufferAttribute(ptPos, 3));
      ptMat = new THREE.PointsMaterial({
        color: 0xffffff, size: 0.06, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      points = new THREE.Points(ptGeo, ptMat);
      points.frustumCulled = false;
      scene.add(points);

      // Async shader compile
      if (typeof renderer.compileAsync === 'function') {
        renderer.compileAsync(scene, camera)
          .then(() => {
            renderer.render(scene, camera);
            shadersReady = true;
            self.postMessage({ type: 'shadersReady' });
          })
          .catch(() => {
            shadersReady = true;
            self.postMessage({ type: 'shadersReady' });
          });
      } else {
        shadersReady = true;
        self.postMessage({ type: 'shadersReady' });
      }

      resizeOutroCanvas();
      requestAnimationFrame(frame);
      break;

    case 'scroll':
      scrollP = data.p;
      break;

    case 'resize':
      viewW = data.width;
      viewH = data.height;
      viewDPR = data.dpr;
      if (renderer) {
        renderer.setPixelRatio(viewDPR);
        renderer.setSize(viewW, viewH, false);
      }
      if (camera) {
        camera.aspect = viewW / viewH;
        camera.updateProjectionMatrix();
      }
      if (starCanvas) {
        resizeOutroCanvas();
      }
      break;

    case 'setRenderTunnel':
      renderTunnel = data.val;
      break;

    case 'setIntroPlaying':
      introPlaying = data.val;
      break;

    case 'setShadersReady':
      shadersReady = data.val;
      break;
  }
};
