// ============================================================
// BOOT LOGS DATA
// ============================================================
const BOOT_LOGS = [
  { kind:'ok',   body:"firmware revision 0x2b loaded" },
  { kind:'ok',   body:"mounting /dev/sda1, readonly: true" },
  { kind:'ok',   body:"loading modules", status:"[ OK ]" },
  { kind:'warn', body:"unnecessarily fancy js to impress recruiters", status:"[WARN]",
                 wrap:["unnecessarily fancy js", "to impress recruiters"] },
  { kind:'warn', body:"sorry, I tried optimizing", status:"[WARN]" },
  { kind:'ok',   body:"phosphor lit", status:"[ OK ]" },
  { kind:'ok',   body:"" },
  { kind:'ok',   body:"user=alan  shell=/bin/zsh  pwd=~/sites/personal",
                 wrap:["user=alan shell=/bin/zsh", "pwd=~/sites/personal"] },
  { kind:'ok',   body:"status: alive · uptime: 31y 03m 14d" },
];

const STATUS_PAD = 57;

function measureColumns(bootLog) {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;';
  probe.textContent = '0'.repeat(100);
  bootLog.appendChild(probe);
  const charW = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return charW > 0 ? Math.floor(bootLog.clientWidth / charW) : Infinity;
}

function buildBootLines(mobile, columns) {
  const TAG = 7;
  const out = [];
  for (const e of BOOT_LOGS) {
    if (!mobile) {
      const text = e.status ? e.body.padEnd(STATUS_PAD) + e.status : e.body;
      out.push({ kind: e.kind, body: text });
      continue;
    }
    const need = TAG + e.body.length + (e.status ? e.status.length + 1 : 0);
    if (e.wrap && need > columns) {
      for (const part of e.wrap) out.push({ kind: e.kind, body: part, status: e.status });
    } else {
      out.push({ kind: e.kind, body: e.body, status: e.status });
    }
  }
  return out;
}

function prepareBootLogs(bootLog, lines) {
  bootLog.innerHTML = '';
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < lines.length; i++) {
    const { kind, status } = lines[i];
    const lineDiv = document.createElement('div');
    lineDiv.className = 'boot-line';
    lineDiv.style.display = 'none';
    
    const tsSpan = document.createElement('span');
    tsSpan.className = 'ts';
    tsSpan.textContent = `[ 00:00:00.${String(60 + i*90).padStart(4,'0')} ]`;
    lineDiv.appendChild(tsSpan);
    
    const tagSpan = document.createElement('span');
    tagSpan.className = kind === 'warn' ? 'warn' : 'ok';
    tagSpan.textContent = kind === 'warn' ? '[warn] ' : '[ ok ] ';
    lineDiv.appendChild(tagSpan);
    
    const msgSpan = document.createElement('span');
    msgSpan.className = 'msg';
    lineDiv.appendChild(msgSpan);
    
    const cursorSpan = document.createElement('span');
    cursorSpan.className = 'dim';
    cursorSpan.textContent = '_';
    cursorSpan.style.display = 'none';
    lineDiv.appendChild(cursorSpan);

    if (status) {
      const statusSpan = document.createElement('span');
      statusSpan.className = (kind === 'warn' ? 'warn' : 'ok') + ' status';
      statusSpan.textContent = status;
      statusSpan.style.display = 'none';
      lineDiv.appendChild(statusSpan);
    }

    fragment.appendChild(lineDiv);
  }
  bootLog.appendChild(fragment);
}

function whenVisible() {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise(res => {
    const h = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', h);
        res();
      }
    };
    document.addEventListener('visibilitychange', h);
  });
}

export async function sleep(ms) {
  await whenVisible();
  return new Promise(r => setTimeout(r, ms));
}

async function typeBootLogs(bootLog) {
  const mobile = window.matchMedia('(max-width: 768px)').matches;
  const lines = buildBootLines(mobile, mobile ? measureColumns(bootLog) : 0);
  prepareBootLogs(bootLog, lines);
  
  const lineElems = bootLog.children;
  for (let i = 0; i < lines.length; i++) {
    const msg = lines[i].body;
    const lineDiv = lineElems[i];
    lineDiv.style.display = '';
    
    if (!msg) {
      await sleep(80);
      continue;
    }
    
    const msgSpan = lineDiv.querySelector('.msg');
    const cursorSpan = lineDiv.querySelector('.dim');
    cursorSpan.style.display = 'inline';
    
    for (let c = 0; c <= msg.length; c++) {
      msgSpan.textContent = msg.slice(0, c);
      await sleep(2 + Math.random() * 5);
    }
    
    cursorSpan.style.display = 'none';
    const statusSpan = lineDiv.querySelector('.status');
    if (statusSpan) statusSpan.style.display = '';
    await sleep(30 + Math.random() * 60);
  }
}

export async function runAutoplay(dom, state, callbacks) {
  // 1. boot logs typing
  await typeBootLogs(dom.bootLog);
  await sleep(280);
  if (state.introCancelled) return;

  // 2. smooth handoff
  dom.splashEl.style.opacity = '1';
  dom.bootEl.style.transition = 'opacity 0.6s ease';
  dom.bootEl.style.opacity = '0';
  await sleep(620);
  dom.bootEl.style.visibility = 'hidden';
  if (state.introCancelled) return;

  // 3. show name + sub
  dom.splashName.classList.add('in');
  await sleep(260);
  dom.splashSub.classList.add('in');
  await sleep(700);
  if (state.introCancelled) return;

  // 4. trigger logo reveal
  await sleep(120);
  if (dom.logoLeft) dom.logoLeft.classList.add('go');
  if (dom.logoRight) dom.logoRight.classList.add('go');
  const logoWrap = dom.splashEl.querySelector('.logo-wrap');
  if (logoWrap) {
    logoWrap.classList.add('in');
  }
  await sleep(1600);
  if (state.introCancelled) return;

  // 5. start WebGL and warm up the renderer in the background (invisible)
  if (callbacks.setRenderTunnel) callbacks.setRenderTunnel(true);
  state.introPlaying = false;

  // Wait 4 frames to ensure Three.js compile/first-frame render has completed off-screen and settled
  for (let i = 0; i < 4; i++) {
    await new Promise(requestAnimationFrame);
    if (state.introCancelled) return;
  }
  // Pause rendering during the glitch animation to save CPU/GPU resources
  if (callbacks.setRenderTunnel) callbacks.setRenderTunnel(false);

  // 6. Glitch Out splash screen inner content
  if (dom.splashInner) {
    dom.splashInner.classList.add('glitch-out');
  }
  await sleep(450);
  if (state.introCancelled) return;

  // Resume rendering permanently now that the splash screen is gone
  if (callbacks.setRenderTunnel) callbacks.setRenderTunnel(true);

  // Zero-blend hard cut to instantly reveal the canvas and chrome
  dom.canvas.style.transition = 'none';
  dom.tunnelUI.style.transition = 'none';
  dom.splashEl.style.transition = 'none';

  dom.canvas.style.opacity = '1';
  dom.tunnelUI.style.opacity = '1';
  dom.splashEl.style.opacity = '0';
  dom.splashEl.style.visibility = 'hidden';
  dom.splashEl.style.display = 'none';

  // 7. unlock scroll & show chrome
  document.body.classList.remove('locked');
  if (dom.top) dom.top.classList.add('on');
  if (dom.pbar) dom.pbar.classList.add('on');
  if (dom.hint) dom.hint.classList.add('on');

  // fade in tweaks panel
  dom.tweaksPanel.style.display = '';
  setTimeout(() => dom.tweaksPanel.classList.add('in'), 50);

  if (callbacks.onComplete) callbacks.onComplete();
}

