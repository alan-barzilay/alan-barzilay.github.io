export function initTweaksPanel({ TEST, callbacks }) {
  const wrap = document.getElementById('tubeOptions');
  if (wrap) {
    wrap.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        wrap.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tube = btn.getAttribute('data-tube');
        callbacks.setActiveTube(tube);
      });
    });
  }

  const blendWrap = document.getElementById('blendModeOptions');
  if (blendWrap) {
    blendWrap.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        blendWrap.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.getAttribute('data-blend');
        callbacks.setBlendMode(mode);
      });
    });
  }

  const lumSlider = document.getElementById('lumGainSlider');
  const lumVal = document.getElementById('lumGainVal');
  if (lumSlider && lumVal) {
    lumSlider.addEventListener('input', () => {
      const val = parseFloat(lumSlider.value);
      lumVal.textContent = val.toFixed(2);
      callbacks.setLumGain(val);
    });
  }

  const pbBtn = document.getElementById('togglePureBlack');
  if (pbBtn) {
    pbBtn.addEventListener('click', () => {
      const active = pbBtn.classList.toggle('active');
      pbBtn.textContent = active ? 'bg: pure black' : 'bg: dark theme';
      document.body.classList.toggle('pure-black', active);
    });
  }

  const drBtn = document.getElementById('toggleDarkerRays');
  if (drBtn) {
    drBtn.addEventListener('click', () => {
      const active = drBtn.classList.toggle('active');
      drBtn.textContent = active ? 'darker rays: ON' : 'darker rays: OFF';
      document.body.classList.toggle('darker-rays', active);
    });
  }

  const amt = document.getElementById('sbAmt');
  const len = document.getElementById('sbLen');
  const ang = document.getElementById('sbAng');
  const amtVal = document.getElementById('sbAmtVal');
  const lenVal = document.getElementById('sbLenVal');
  const angVal = document.getElementById('sbAngVal');

  if (amt && amtVal) {
    amt.addEventListener('input', () => {
      TEST.startBend = parseFloat(amt.value);
      amtVal.textContent = amt.value;
      callbacks.requestTubeRebuild();
    });
  }
  if (len && lenVal) {
    len.addEventListener('input', () => {
      TEST.startBendLen = parseFloat(len.value);
      lenVal.textContent = parseFloat(len.value).toFixed(2);
      callbacks.requestTubeRebuild();
    });
  }
  if (ang && angVal) {
    ang.addEventListener('input', () => {
      TEST.startBendAngle = parseFloat(ang.value);
      angVal.textContent = ang.value + '°';
      callbacks.requestTubeRebuild();
    });
  }
}
