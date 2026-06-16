import * as THREE from 'three';

const N = 120;

function snakePath({ yawAmp, yawFreq, pitchAmp = 0.6, pitchFreq = 2, pitchPhase = Math.PI / 3, endBoost = 1, seg = 4.5,
                     calmStart = null, calmEnd = 0.92, calmFloor = 0.3, pitchCalmFloor = null, segEndBoost = 1, yawPhase = 0 }) {
  const pts = [];
  const pos = new THREE.Vector3(0, 0, 0);
  const dir = new THREE.Vector3();
  const pFloor = pitchCalmFloor == null ? calmFloor : pitchCalmFloor;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const amp = 1 + (endBoost - 1) * t;
    let yawT = amp, pitchT = amp;
    if (calmStart !== null && t > calmStart) {
      const u = Math.min(1, (t - calmStart) / (calmEnd - calmStart));
      const ease = u * u * (3 - 2 * u);
      yawT   = amp * (1 - (1 - calmFloor) * ease);
      pitchT = amp * (1 - (1 - pFloor)   * ease);
    }
    const yaw   = yawAmp   * yawT   * Math.sin(2 * Math.PI * yawFreq   * t + yawPhase);
    const pitch = pitchAmp * pitchT * Math.sin(2 * Math.PI * pitchFreq * t + pitchPhase);
    dir.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch)
    );
    const segT = seg * (1 + (segEndBoost - 1) * t);
    if (i > 0) pos.addScaledVector(dir, segT);
    pts.push(pos.clone());
  }
  return pts;
}

function applyEndBend(pts, TEST) {
  const amt = TEST.endBend, startF = TEST.endBendStart;
  if (!amt) return pts;
  const n = pts.length;
  const a = TEST.bendAngle * Math.PI / 180;
  const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
  return pts.map((p, i) => {
    const t = i / (n - 1);
    if (t <= startF) return p;
    const u = (t - startF) / (1 - startF);
    const k = u * u;
    return p.clone().addScaledVector(dir, amt * k);
  });
}

function applyStartBend(pts, TEST) {
  const amt = TEST.startBend, until = TEST.startBendLen, angle = TEST.startBendAngle;
  if (!amt) return pts;
  const n = pts.length;
  const a = angle * Math.PI / 180;
  const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
  return pts.map((p, i) => {
    const t = i / (n - 1);
    if (t >= until) return p;
    const u = t / until;
    const k = (1 - u) * (1 - u);
    return p.clone().addScaledVector(dir, amt * k);
  });
}

export function currentCenterline(shapeName, TEST) {
  // Only the 'v1d' variant is used in practice.
  return applyStartBend(
    applyEndBend(
      snakePath({ yawAmp: 1.2, yawFreq: 1.5, pitchAmp: 0.42, pitchFreq: 1.1 }),
      TEST
    ),
    TEST
  );
}
