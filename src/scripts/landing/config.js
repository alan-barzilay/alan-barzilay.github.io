// ============================================================
// SHARED LANDING CONFIG
// ------------------------------------------------------------
// Single source of truth for the constants the tunnel renderer needs.
// Imported by BOTH the main-thread fallback (home.js) and the
// OffscreenCanvas worker (tunnelWorker.js). Keeping these here is what
// stops the two renderers from drifting apart (the cause of past crashes
// where one side's constants no longer matched the other's).
//
// This module is environment-agnostic: pure data, no DOM / window / self
// references, so it bundles cleanly into both the page and the worker.
// ============================================================

// ============================================================
// PHASES — scroll only covers TUNNEL + VAPOR.
// Boot + splash are autoplay on page load.
// ============================================================
export const PHASES = {
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
export const TEST = {
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

// ============================================================
// CHAPTERS — drives the card stage / ticks (main thread) AND the in-tube
// station rings (both renderers use `.at` to place rings along the curve).
// ============================================================
export const CHAPTERS = [
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
