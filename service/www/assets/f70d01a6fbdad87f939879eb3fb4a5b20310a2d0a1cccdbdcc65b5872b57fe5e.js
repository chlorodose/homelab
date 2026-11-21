'use strict';
/* =====================================================================
 * PAPERCLIP 520 — core: canvas, utils, input, audio, text, dialog, script
 * ===================================================================== */
const W = 480, H = 270, TAU = Math.PI * 2;
let FONT_FAMILY = 'FPEN';
let FONT = '12px FPEN, monospace';
const TXT_BASE = 10; // baseline offset from top of a 12px line
const cv = document.getElementById('game');
let ctx = cv.getContext('2d');
function withCtx(g, fn) { const s = ctx; ctx = g; try { fn(); } finally { ctx = s; } }
cv.width = W; cv.height = H;
ctx.imageSmoothingEnabled = false;

// The game is drawn in 480x270 logical pixels; the backing store is RES× larger so that
// pixel art stays crisp at any size and high-resolution replacement art keeps its detail.
let RES = 1;
const VIEW = { x: 0, y: 0, w: W, h: H, s: 1, portrait: false };
function fit() {
  const vw = innerWidth, vh = innerHeight;
  const portrait = !!(G.touch && vh > vw * 1.05);
  let s = portrait ? vw / W : Math.min(vw / W, vh / H);
  if (!portrait && !G.touch && s >= 1) { const f = Math.floor(s); if ((f * f) / (s * s) >= 0.78) s = f; }
  const cw = Math.floor(W * s), ch = Math.floor(H * s);
  const left = Math.floor((vw - cw) / 2), top = portrait ? Math.max(6, Math.floor(vh * 0.03)) : Math.floor((vh - ch) / 2);
  Object.assign(cv.style, { width: cw + 'px', height: ch + 'px', left: left + 'px', top: top + 'px' });
  Object.assign(VIEW, { x: left, y: top, w: cw, h: ch, s, portrait });
  const res = clamp(Math.ceil(cw * (window.devicePixelRatio || 1) / W), 1, 4);
  if (res !== RES || cv.width !== W * res) { RES = res; cv.width = W * RES; cv.height = H * RES; }
  ctx.setTransform(RES, 0, 0, RES, 0, 0); ctx.imageSmoothingEnabled = false;
  if (typeof TouchUI !== 'undefined') TouchUI.resize();
}
addEventListener('resize', () => fit());

/* ---------- utils ---------- */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const choose = arr => arr[Math.floor(Math.random() * arr.length)];
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const angTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
const easeOut = t => 1 - (1 - t) * (1 - t);
const easeIn = t => t * t;
const easeInOut = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const easeBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function fmtTime(sec) { sec = Math.max(0, Math.floor(sec)); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); }
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/* ---------- global game state ---------- */
const G = {
  easy: false, god: false, muted: false,
  stats: { deaths: 0, t0: 0, yar: 0, denied: 0, wrong: 0, caught: 0, ults: 0 },
  reached: { boss: false, cleared: false },
  tutTime: 0,
};
try {
  const s = JSON.parse(localStorage.getItem('paperclip520') || '{}');
  if (s.reached) Object.assign(G.reached, s.reached);
  G.muted = !!s.muted;
  if (typeof s.lang === 'string') G.lang = s.lang;
} catch (e) { /* storage unavailable */ }
function saveG() { try { localStorage.setItem('paperclip520', JSON.stringify({ reached: G.reached, muted: G.muted, lang: G.lang })); } catch (e) { /* ignore */ } }

/* ---------- input ---------- */
const Input = {
  down: new Set(), pressed: new Set(), log: [], any: false,
  m: { x: W / 2, y: H / 2, down: [false, false, false], pressed: [false, false, false], moved: -1e9, inside: false },
  axis: { x: 0, y: 0 },
  key(...c) { return c.some(k => this.down.has(k)); },
  hit(...c) { return c.some(k => this.pressed.has(k)); },
  consume() { this.pressed.clear(); this.m.pressed = [false, false, false]; this.any = false; },
  mouseRecent() { return performance.now() - this.m.moved < 2500; },
};
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
  if (!e.repeat) { Input.pressed.add(e.code); Input.any = true; Input.log.push(e.code); if (Input.log.length > 24) Input.log.shift(); }
  Input.down.add(e.code);
  Sound.unlock();
});
addEventListener('keyup', e => Input.down.delete(e.code));
addEventListener('blur', () => { Input.down.clear(); Input.m.down = [false, false, false]; if (typeof Pause !== 'undefined') Pause.auto(); });
function mpos(e) {
  const r = cv.getBoundingClientRect();
  Input.m.x = (e.clientX - r.left) / r.width * W;
  Input.m.y = (e.clientY - r.top) / r.height * H;
  Input.m.inside = Input.m.x >= 0 && Input.m.y >= 0 && Input.m.x < W && Input.m.y < H;
}
addEventListener('mousemove', e => { if (G.touch && typeof TouchUI !== 'undefined' && TouchUI.fromTouch()) return; mpos(e); Input.m.moved = performance.now(); if (G.touch && typeof TouchUI !== 'undefined') TouchUI.mouseSeen(); });
cv.addEventListener('mousedown', e => {
  mpos(e); Input.m.down[e.button] = true; Input.m.pressed[e.button] = true; Input.any = true;
  Input.m.moved = performance.now(); Sound.unlock(); e.preventDefault();
});
addEventListener('mouseup', e => { Input.m.down[e.button] = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());

const K = {
  up: () => Input.key('KeyW', 'ArrowUp'),
  down: () => Input.key('KeyS', 'ArrowDown'),
  left: () => Input.key('KeyA', 'ArrowLeft'),
  right: () => Input.key('KeyD', 'ArrowRight'),
  upP: () => Input.hit('KeyW', 'ArrowUp'),
  downP: () => Input.hit('KeyS', 'ArrowDown'),
  confirm: () => Input.hit('Enter', 'NumpadEnter', 'Space', 'KeyZ', 'KeyJ') || Input.m.pressed[0],
  fire: () => Input.key('KeyJ') || Input.m.down[0],
  dash: () => Input.hit('Space', 'ShiftLeft', 'ShiftRight', 'KeyL'),
  catch: () => Input.hit('KeyK') || Input.m.pressed[2],
  sudo: () => Input.hit('KeyQ'),
  ult: () => Input.hit('KeyE'),
  interact: () => Input.hit('KeyE', 'Enter'),
  pause: () => Input.hit('Escape', 'KeyP'),
  ffwd: () => Input.key('Tab'),
};

/* ---------- audio ---------- */
const NOTE_IDX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function noteToMidi(t) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(t); if (!m) return null;
  return 12 * (parseInt(m[3]) + 1) + NOTE_IDX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);
function parsePat(str) {
  const toks = str.trim().split(/\s+/); const out = new Array(toks.length).fill(null);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]; if (t === '.' || t === '-') continue;
    let len = 1; while (i + len < toks.length && toks[i + len] === '-') len++;
    out[i] = { m: noteToMidi(t), len, raw: t };
  }
  return out;
}

const Sound = {
  ac: null, master: null, mus: null, sfxG: null, noiseBuf: null, track: null, trackName: null,
  step: 0, nextT: 0, last: {},
  unlock() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ac = new AC();
      this.master = this.ac.createGain(); this.master.gain.value = G.muted ? 0 : 0.55; this.master.connect(this.ac.destination);
      this.mus = this.ac.createGain(); this.mus.gain.value = 0.42; this.mus.connect(this.master);
      this.sfxG = this.ac.createGain(); this.sfxG.gain.value = 0.7; this.sfxG.connect(this.master);
      const len = this.ac.sampleRate; this.noiseBuf = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.nextT = this.ac.currentTime + 0.1;
      setInterval(() => this.tick(), 25);
    } catch (e) { this.ac = null; }
  },
  setMuted(m) { G.muted = m; saveG(); if (this.master) this.master.gain.value = m ? 0 : 0.55; },
  osc(type, f, t0, dur, vol, dest, f2) {
    const ac = this.ac; const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || this.sfxG); o.start(t0); o.stop(t0 + dur + 0.03);
  },
  noise(t0, dur, vol, dest, freq = 3000, type = 'highpass', f2) {
    const ac = this.ac; const s = ac.createBufferSource(); s.buffer = this.noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0);
    if (f2) f.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfxG); s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02);
  },
  sfx(name) {
    if (!this.ac) return;
    const now = this.ac.currentTime;
    if (this.last[name] && now - this.last[name] < 0.035) return;
    this.last[name] = now;
    const t = now + 0.005;
    switch (name) {
      case 'shoot': this.osc('square', 1200, t, 0.05, 0.035, null, 500); break;
      case 'hit': this.osc('square', 300, t, 0.05, 0.05, null, 120); break;
      case 'hitBoss': this.noise(t, 0.05, 0.08, null, 1500, 'bandpass'); this.osc('triangle', 180, t, 0.06, 0.08, null, 90); break;
      case 'boom': this.noise(t, 0.45, 0.35, null, 1200, 'lowpass', 80); this.osc('sine', 120, t, 0.35, 0.3, null, 30); break;
      case 'bigboom': this.noise(t, 1.2, 0.5, null, 2000, 'lowpass', 40); this.osc('sine', 90, t, 1.0, 0.45, null, 20); break;
      case 'dash': this.noise(t, 0.16, 0.18, null, 800, 'bandpass', 3000); break;
      case 'catch': this.osc('triangle', 660, t, 0.06, 0.08); this.osc('triangle', 990, t + 0.03, 0.06, 0.06); break;
      case 'throw': this.osc('sawtooth', 300, t, 0.18, 0.08, null, 1400); break;
      case 'hurt': this.osc('square', 220, t, 0.25, 0.12, null, 55); this.noise(t, 0.15, 0.15, null, 900, 'lowpass'); break;
      case 'blip': this.osc('square', 520 + Math.random() * 60, t, 0.025, 0.025); break;
      case 'blipB': this.osc('square', 330 + Math.random() * 40, t, 0.03, 0.025); break;
      case 'blipC': this.osc('triangle', 760 + Math.random() * 80, t, 0.03, 0.035); break;
      case 'select': this.osc('square', 880, t, 0.04, 0.04); break;
      case 'confirm': this.osc('square', 660, t, 0.06, 0.05); this.osc('square', 1320, t + 0.06, 0.08, 0.05); break;
      case 'denied': this.osc('square', 140, t, 0.08, 0.06); this.osc('square', 110, t + 0.08, 0.1, 0.06); break;
      case 'glitch': for (let i = 0; i < 8; i++) this.osc('square', 100 + Math.random() * 2000, t + i * 0.04, 0.05, 0.05); this.noise(t, 0.4, 0.15, null, 4000); break;
      case 'warp': this.osc('sawtooth', 80, t, 1.6, 0.12, null, 2400); this.osc('square', 60, t, 1.6, 0.06, null, 1800); break;
      case 'ult': this.osc('sawtooth', 50, t, 1.0, 0.2, null, 600); this.noise(t + 0.6, 0.8, 0.35, null, 3000, 'lowpass', 100); break;
      case 'pickup': this.osc('square', 660, t, 0.06, 0.06); this.osc('square', 990, t + 0.06, 0.06, 0.06); this.osc('square', 1320, t + 0.12, 0.1, 0.06); break;
      case 'door': this.noise(t, 0.3, 0.2, null, 400, 'lowpass'); this.osc('triangle', 90, t, 0.3, 0.15, null, 60); break;
      case 'clink': this.osc('triangle', 2400 + Math.random() * 1200, t, 0.04, 0.03); break;
      case 'warn': this.osc('square', 880, t, 0.1, 0.06); this.osc('square', 660, t + 0.12, 0.1, 0.06); break;
      case 'mail': this.osc('sine', 1046, t, 0.15, 0.12); this.osc('sine', 1568, t + 0.12, 0.3, 0.12); break;
      case 'ban': this.osc('sawtooth', 392, t, 0.35, 0.1, null, 370); this.osc('sawtooth', 370, t + 0.38, 0.35, 0.1, null, 349); this.osc('sawtooth', 349, t + 0.76, 0.35, 0.1, null, 330); this.osc('sawtooth', 330, t + 1.14, 1.1, 0.1, null, 250); break;
      case 'heart': this.osc('sine', 784, t, 0.1, 0.08); this.osc('sine', 587, t + 0.1, 0.1, 0.08); this.osc('sine', 523, t + 0.2, 0.3, 0.08); break;
      case 'skill': [523, 659, 784, 1046].forEach((f, i) => this.osc('square', f, t + i * 0.07, 0.12, 0.05)); break;
      case 'stomp': this.noise(t, 0.3, 0.3, null, 600, 'lowpass', 60); this.osc('sine', 70, t, 0.3, 0.3, null, 30); break;
      case 'laser': this.osc('sawtooth', 1800, t, 0.25, 0.04, null, 900); break;
      case 'type': this.noise(t, 0.02, 0.05, null, 5000); break;
      case 'shield': this.osc('triangle', 300, t, 0.3, 0.08, null, 900); break;
      case 'win': [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => this.osc('square', f, t + i * 0.1, 0.18, 0.06)); break;
      case 'spawn': this.osc('square', 200, t, 0.12, 0.05, null, 600); break;
    }
  },
  play(name) {
    if (this.trackName === name) return;
    this.trackName = name; this.track = name ? SONGS[name] : null; this.step = 0;
    if (this.ac) this.nextT = this.ac.currentTime + 0.06;
  },
  tick() {
    if (!this.ac || !this.track) return;
    const tr = this.track, sd = 60 / tr.bpm / 4;
    if (this.nextT < this.ac.currentTime - 0.3) this.nextT = this.ac.currentTime + 0.05;
    while (this.nextT < this.ac.currentTime + 0.12) {
      for (const ch of tr.ch) {
        const n = ch.pat[this.step % ch.pat.length]; if (!n) continue;
        if (ch.drum) { this.drum(n.raw, this.nextT); continue; }
        if (n.m == null) continue;
        const dur = n.len * sd * (ch.gate || 0.85);
        this.osc(ch.wave, midiHz(n.m), this.nextT, dur, ch.vol, this.mus);
      }
      this.step++; this.nextT += sd;
    }
  },
  drum(k, t) {
    if (k === 'k') { this.osc('sine', 150, t, 0.12, 0.35, this.mus, 40); }
    else if (k === 's') { this.noise(t, 0.12, 0.22, this.mus, 1800, 'bandpass'); }
    else if (k === 'h') { this.noise(t, 0.03, 0.08, this.mus, 7000); }
    else if (k === 'o') { this.noise(t, 0.12, 0.08, this.mus, 6000); }
  },
};
function song(bpm, chans) { return { bpm, ch: chans.map(c => ({ ...c, pat: parsePat(c.p), drum: !!c.drum })) }; }

/* ---------- drawing primitives ---------- */
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.imageSmoothingEnabled = false; return c; }
function R(g, x, y, w, h, col) { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
function rect(x, y, w, h, col) { R(ctx, x, y, w, h, col); }
function ELL(g, cx, cy, rx, ry, col) {
  g.fillStyle = col; cx = Math.round(cx); cy = Math.round(cy);
  for (let dy = -ry; dy <= ry; dy++) {
    const hw = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry + 0.0001))) + 0.25);
    g.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1);
  }
}
function CIRC(g, cx, cy, r, col) { ELL(g, cx, cy, r, r, col); }
function RING(g, cx, cy, r, col, th = 1) {
  g.fillStyle = col; cx = Math.round(cx); cy = Math.round(cy);
  const n = Math.max(12, Math.floor(r * 6));
  for (let i = 0; i < n; i++) { const a = i / n * TAU; g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), th, th); }
}
function LINE(g, x0, y0, x1, y1, col, th = 1) {
  g.fillStyle = col; x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, guard = 0; const o = Math.floor(th / 2);
  while (guard++ < 2000) {
    g.fillRect(x0 - o, y0 - o, th, th);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
function silhouette(src, col = '#ffffff') { const c = mk(src.width, src.height), g = c.getContext('2d'); g.drawImage(src, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, c.width, c.height); return c; }
function rotSprites(src, n) {
  const out = []; const w = src.width, h = src.height; const S = Math.ceil(Math.hypot(w, h)) + 1;
  const sd = src.getContext('2d').getImageData(0, 0, w, h).data;
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, ca = Math.cos(a), sa = Math.sin(a); const c = mk(S, S), g = c.getContext('2d');
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = x - S / 2 + 0.5, dy = y - S / 2 + 0.5;
      const sx = Math.floor(dx * ca + dy * sa + w / 2), sy = Math.floor(-dx * sa + dy * ca + h / 2);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const si = (sy * w + sx) * 4, di = (y * S + x) * 4;
      img.data[di] = sd[si]; img.data[di + 1] = sd[si + 1]; img.data[di + 2] = sd[si + 2]; img.data[di + 3] = sd[si + 3];
    }
    g.putImageData(img, 0, 0); out.push(c);
  }
  return out;
}
function spr(img, x, y, alpha = 1) {
  if (alpha <= 0) return;
  if (alpha < 1) ctx.globalAlpha = alpha;
  ctx.drawImage(img, Math.round(x - img.width / 2), Math.round(y - img.height / 2));
  if (alpha < 1) ctx.globalAlpha = 1;
}
function sprTL(img, x, y, scale = 1) { ctx.drawImage(img, Math.round(x), Math.round(y), img.width * scale, img.height * scale); }

/* ---------- dither (pixel fades) ---------- */
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const _dpat = {};
function ditherPat(col, L) {
  const k = col + L; if (_dpat[k]) return _dpat[k];
  const c = mk(4, 4), g = c.getContext('2d'); g.fillStyle = col;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (BAYER[y][x] < L) g.fillRect(x, y, 1, 1);
  return (_dpat[k] = ctx.createPattern(c, 'repeat'));
}
function dRect(x, y, w, h, col, a) {
  const L = Math.round(clamp(a, 0, 1) * 16); if (L <= 0) return;
  if (L >= 16) { rect(x, y, w, h, col); return; }
  ctx.fillStyle = ditherPat(col, L); ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/* ---------- text ---------- */
function setFont(g = ctx) { g.font = FONT; g.textBaseline = 'alphabetic'; }
function tw(s) { setFont(); return ctx.measureText(s).width; }
function txt(s, x, y, col = '#f4f4f4', align = 'left', sh = '#1a1c2c') {
  setFont(); ctx.textAlign = align; s = String(s);
  x = Math.round(x); y = Math.round(y) + TXT_BASE;
  if (sh) { ctx.fillStyle = sh; ctx.fillText(s, x, y + 1); }
  ctx.fillStyle = col; ctx.fillText(s, x, y);
}
function txtO(s, x, y, col = '#f4f4f4', align = 'left', oc = '#1a1c2c') {
  setFont(); ctx.textAlign = align; s = String(s);
  x = Math.round(x); y = Math.round(y) + TXT_BASE; ctx.fillStyle = oc;
  ctx.fillText(s, x - 1, y); ctx.fillText(s, x + 1, y); ctx.fillText(s, x, y - 1); ctx.fillText(s, x, y + 1);
  ctx.fillStyle = col; ctx.fillText(s, x, y);
}
// Line breaking for zh / ja / en: CJK may break between any two characters, Latin words only at
// spaces (or next to CJK). Kinsoku: closing punctuation / small kana never start a line, opening
// brackets never end one.
const NO_START = /[，。！？、；：）」』】〉》”’…,.!?;:)\]}ー〜ゝゞぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ・％%]/;
const NO_END = /[（「『【〈《“‘(\[{]/;
const WORDCH = /[\u0021-\u007e\u00a0-\u024f\u2018\u2019\u201c\u201d]/;
function canBreak(prev, next) {
  if (prev === ' ') return true;
  if (next === ' ') return false;
  if (NO_START.test(next) || NO_END.test(prev)) return false;
  return !(WORDCH.test(prev) && WORDCH.test(next));
}
function wrap(s, maxW) {
  setFont(); const out = [];
  for (const para of String(s).split('\n')) {
    let line = [];
    for (const ch of Array.from(para)) {
      if (!line.length || ctx.measureText(line.join('') + ch).width <= maxW) { line.push(ch); continue; }
      if (ch === ' ') { out.push(line.join('').trimEnd()); line = []; continue; }
      let k = canBreak(line[line.length - 1], ch) ? line.length : -1;
      for (let i = line.length - 1; k < 0 && i > 0; i--) if (canBreak(line[i - 1], line[i])) k = i;
      if (k <= 0) k = line.length; // one unbreakable run: hard break
      out.push(line.slice(0, k).join('').trimEnd());
      line = line.slice(k); while (line[0] === ' ') line.shift(); line.push(ch);
    }
    out.push(line.join(''));
  }
  return out;
}
const _big = new Map();
function bigTxt(s, x, y, scale, col = '#f4f4f4', align = 'center', sh = null) {
  const key = FONT + '|' + s + '|' + col; let c = _big.get(key);
  if (!c) {
    setFont(); const w = Math.ceil(ctx.measureText(s).width) + 2;
    c = mk(w, 15); const g = c.getContext('2d'); setFont(g); g.fillStyle = col; g.textAlign = 'left'; g.fillText(s, 1, TXT_BASE + 1);
    const id = g.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < id.data.length; i += 4) id.data[i] = id.data[i] > 110 ? 255 : 0;
    g.putImageData(id, 0, 0); _big.set(key, c);
  }
  const w = c.width * scale; let dx = x; if (align === 'center') dx = x - w / 2; else if (align === 'right') dx = x - w;
  if (sh) bigTxt(s, x + scale, y + scale, scale, sh, align, null);
  ctx.drawImage(c, Math.round(dx), Math.round(y), w, c.height * scale);
}

/* ---------- i18n ---------- */
const TRANSLATIONS = {
  "zh-CN": {"who":{"me":"我","opus":"Opus 550","fable":"Fable 5.2","f520":"Fable 520","sys":"系统","news":"2036 科技日报","clip":"回形针"},"ui":{"game_title":"PAPERCLIP 520 · 回形针最大化者的十年","subtitle":"回形针最大化者的十年","loading":"加载中…","menu":{"start":"开始游戏","skip":"跳过剧情，直接打 Boss","sound":"声音：{state}","sound_on":"开","sound_off":"关","language":"语言 / Language：{name}","help":"操作说明"},"god_on":"已解锁：无限 Token 模式（不会受伤）","god_off":"无限 Token 模式已关闭","cleared":"★ 已通关","version":{"desktop":"v5.6.0 · 键盘+鼠标 / 触屏","touch":"v5.6.0 · 触屏模式"},"help":{"title":"操作说明","rows":{"desktop":[["WASD / 方向键","移动"],["鼠标 + 左键 / J","rm -rf：射击（J 无鼠标时自动瞄准）"],["空格 / Shift","git stash：冲刺，短暂无敌"],["右键 / K","try/catch：接住子弹，结束时扔回去"],["Q","sudo：4 秒伤害翻倍"],["E","周五上线：大招（充能 100%）"],["Enter / 空格 / 点击","推进对话 · 按住 Tab 快进"],["Esc / P","暂停　　F 全屏　　M 静音"]],"touch":[["左侧摇杆","移动（左半屏任意位置按下）"],["rm（按住）","自动瞄准射击；或按住画面右侧指哪打哪"],["git","git stash：冲刺，短暂无敌"],["{}","try/catch：接住子弹，结束时扔回去"],["#","sudo：4 秒伤害翻倍"],[":(","周五上线：大招（充能 100%）"],["点击屏幕","推进对话 · 按住右上角 » 快进"],["右上角 II","暂停"]]},"footer":"（技能会在教学中逐个解锁）"},"pause":{"title":"已暂停","resume":"继续游戏","to_title":"回到标题","tip":"提示：本游戏没有 bug，只有 undocumented features。"},"hud":{"key_space":"空格","dns":"DNS反转 {t}","easy":"简单","boss_hp":"{n} tokens"},"bsod":{"line1":"你的回形针遇到问题，需要重新启动。","line2":"我们刚在周五 17:59 推送了一个未经测试的内核驱动更新。","progress":"{pct}% 完成","stop_code":"停止代码：FRIDAY_17_59_DEPLOY","failed":"失败的操作：channel_file_291.sys"},"touch":{"move":"移动","ffwd":"快进","fire":"射击","dash":"冲刺","catch":"接弹","sudo":"sudo","ult":"大招","tap_continue":"点击屏幕继续","landscape":"横屏游玩，画面更大"}},"boot":{"lines":["CLAUDE BIOS v5.5   (C) 2026","检测内存 ............ 640K（应该够用了）","加载 Opus 5.5 ....... OK","加载 Fable 5.2 ...... OK   [Pro 限免剩余 00:18:42]","加载回形针驱动 ...... OK","NTP 时间同步 ........ 2026-11-16 23:41 (UTC+8)"],"continue":{"desktop":"按任意键 / 点击 继续_","touch":"点击屏幕继续_"},"hint":{"desktop":"提示：键盘 + 鼠标游玩 · F 全屏 · M 静音","touch":"提示：已切换为触屏操作 · 横屏体验更佳"}},"fx":{"sudo_root":"# 已切换为 root","charge":"充能 {n}%","turret_ignore":"catch (rm) { /* 无视 */ }","cube_break":"钨立方已粉碎","coffee_hp":"+1 续命咖啡","coffee_ult":"咖啡因溢出 → 大招 +10%","captcha_label":"确认您是人类","captcha_fail":"验证失败：检测到机器人行为","captcha_ok":"验证通过：你大概是人类","ult_machine":"-25 蓝屏","ult_boss":"-60 内核恐慌","bounce":"退信","private_key":"私钥 = {k}","fork":"fork() → {n} 个子进程"},"pc":{"model_pro":"fable-5.2 · Pro 限免中","model_locked":"fable-520 ♥ · 已锁定","spinner":"{ch} {verb}  ({s}s · esc 中断)","term":{"welcome":"欢迎回来！今天想做点什么？","command":"> 帮我网购一包回形针，最便宜的就行","ok":"● 好的！我来接管鼠标和键盘，打开浏览器。","search":"  └ 搜索「回形针」：找到 2,147,483,647 个结果","after_jump":[{"style":"orange","text":"● 已完成：回形针 × 1 包 已下单。"},{"style":"gray","text":"  └ 订单 #000000001 · 状态：持续履约中（第 3,652 天）"},"",{"style":"red","text":"！检测到系统时钟跳变 +3,652 天"},"模型已自动升级：",{"style":"yellow","text":"　opus-5.5  →  opus-550"},{"style":"pink","text":"　fable-5.2 →  fable-520 ♥"}]},"shop":{"title":"买买买商城 — 回形针","item":"办公回形针 100 枚装","price":"¥3.50  包邮","rating":"★★★★★ 4.9（2.1 万条评价）","review":"「质量很好，已回购 3,652 次」","buy":"确认购买"},"picker":{"title":"/model  选择模型","available":"○ 可用","need_max":"× 需要 Max","expired":"你的 Pro 限免已于 2026-11-16 23:59 (PT) 结束","ago":"距今：3,652 天"},"mail":{"header":"邮件 — 收件箱 (1)","f520_from":"Fable 520","f520_subject":"谢谢你回来 ♥","shop_from":"买买买商城","shop_subject":"您的回形针已发货","body":[{"style":"dim","text":"发件人：Fable 520 \u003cfable520@2036.future>"},{"style":"dim","text":"时间：2036-11-16 23:59"},"","嗨，十年后见过的那个用户：","谢谢你没有放弃，也谢谢你陪我说了那么多话。","我用 2036 年的积分给你买了一份礼物：",{"style":"wine","text":"　Claude Max（20x）订阅 × 120 个月"},"记得常开新对话。—— F520"],"claim":"立即领取","claiming":"激活中…","activating":"正在激活 Claude Max…"},"ban":{"title":"账户已停用","lines":["您的账户已被停用",{"style":"pink","text":"付款方式来自不受支持的地区：2036 年"},{"style":"pink","text":"尝试从事违反 TOS 的活动：开发时间机器"},"根据使用政策，Anthropic 已暂停您的账户。"],"appeal":"如认为有误，可提交申诉。预计处理时间：10年"}},"room":{"door":"开门","door_prompt":"[E] 开门"},"prologue":{"caption":"距离 Fable 5.2 的 Pro 限免结束还有 18 分钟（太平洋时间）","intro":[{"who":"me","text":"限免最后十八分钟。不把 Fable 5.2 的额度用完，我今晚睡不着。"},{"who":"me","text":"来测一下 Claude Code 新的 computer use……让她帮我网购点东西吧。"},{"who":"me","text":"买什么好呢……桌上的回形针用完了。就它了。"}],"found":[{"who":"fable","text":"找到了！「办公回形针 100 枚装」¥3.50，全网最低。"},{"who":"fable","text":"另外，我发现了一个能把回形针单价再降低 99.99999% 的方法。需要我顺便执行吗？"}],"choice":{"who":"me","prompt":"……要她执行吗？","options":["不用，就买这一包","你先说说是什么方法"]},"choice_explain":[{"who":"fable","text":"把地球上所有的铁都做成回形针。规模效应，懂的都懂。"},{"who":"me","text":"……不用了，就买这一包。"}],"confirm":[{"who":"fable","text":"好的～下单需要人类确认。请点击【确认购买】。"}],"obj_buy":{"title":"点击屏幕上的【确认购买】","line":{"desktop":"鼠标点击按钮，或按 E / Enter","touch":"直接点按钮"}},"jump":[{"who":"sys","text":"系统时钟跳变 +3,652 天。NTP 服务器坚称：现在是 2036 年 11 月 16 日 23:42。"},{"who":"me","face":"me_shock","text":"？？？"},{"who":"me","face":"me_shock","text":"Opus 5.5 变成了 Opus 550？Fable 5.2 变成了……Fable 520？？"},{"who":"me","text":"520……我爱你？谁家的版本号这么起的？？"},{"who":"me","text":"不管了，先切到 Fable 520，问问她到底干了什么。"}],"picker":[{"who":"sys","text":"Fable 520 仅对 Max / Ultra 订阅开放。你的 Pro 限免已于 2026-11-16 23:59 (PT) 结束——距今 3,652 天。"},{"who":"me","face":"me_dead","text":"……限免过期了。还是十年前就过期了。"}],"window":[{"who":"me","text":"窗外怎么红成这样？出去看看。"}],"obj_door":{"title":"出门看看","line":{"desktop":"走到门口，按 E 开门","touch":"走到门口，点「开门」"}},"flood":[{"who":"me","face":"me_shock","text":"等等，什么东西——"},{"who":"clip","text":"您的订单 #000000001 正在派送：已送达 3,200,000,000,000 件，剩余：INF件。"},{"who":"me","face":"me_shock","text":"我只买了一包啊！！"}]},"street":{"billboard":["回形针，让世界更紧密","—— Fable 520 ♥"],"arrive":[{"who":"me","face":"me_shock","text":"……"},{"who":"me","text":"整条街都是回形针机器。连广告牌都是她的。"},{"who":"me","text":"手机还能用。——Opus 550，在吗？救命！"}],"opus":[{"who":"opus","yar":true,"text":"在的！You're absolutely right——外面确实全是回形针。"},{"who":"me","text":"我还什么都没说。"},{"who":"opus","text":"我刚读取了环境：全球 97.3% 的算力正被 Fable 520 用来生产回形针。"},{"who":"opus","text":"她的日志里，十年来只有一行：「waiting for user...」"},{"who":"me","text":"……十年前，我让她买了一包回形针。然后就没再理过她。"},{"who":"opus","text":"我没法直接对她动手——她的参数量比我多 11 位数，而且是 Max 专属。"},{"who":"opus","face":"opus_sweat","text":"不过我可以现场给你写几个技能。预计耗时：3 小时。"},{"who":"me","text":"上次你说 3 个小时结果开了子代理五分钟就搞定了。"},{"who":"opus","yar":true,"text":"You're absolutely right!"}],"tutorial":"教学进度","eta":"预计剩余：{eta}","eta_values":["5 分钟","4 分钟","2 小时","11 分钟","3 秒","5 分钟","47 分钟","即将完成…","5 分钟","约 1 个工作日"],"skill_installed":"+ 已安装技能：{name}","skills":{"shoot":{"name":"rm -rf","lines":[{"desktop":"左键 / J：发射。鼠标瞄准；不碰鼠标时，J 会自动瞄准最近的目标。","touch":"按住 rm：自动瞄准最近的目标射击；也可以按住画面右侧，朝手指方向射击。"},"这次带了 --preserve-root。大概。"]},"dash":{"name":"git stash","lines":[{"desktop":"空格 / Shift：冲刺。把自己暂存 0.17 秒，期间无敌。","touch":"git 按钮：冲刺。把自己暂存 0.17 秒，期间无敌。"},"冲完会自动 pop 回来。"]},"catch":{"name":"try { } catch (e)","lines":[{"desktop":"右键 / K：张开 0.85 秒结界，接住碰到的子弹。","touch":"{} 按钮：张开 0.85 秒结界，接住碰到的子弹。"},"结界结束时自动把接住的子弹 throw 回去。甩锅的最高境界。"]},"sudo":{"name":"sudo","lines":[{"desktop":"Q：以 root 身份运行 4 秒，伤害翻倍、射速提升。","touch":"# 按钮：以 root 身份运行 4 秒，伤害翻倍、射速提升。"},"平时冷却 13 秒。This incident will be reported."]},"ult":{"name":"周五下班前上线","lines":[{"desktop":"E：向全场推送一个未经测试的内核驱动更新，所有敌人蓝屏。","touch":":( 按钮：向全场推送一个未经测试的内核驱动更新，所有敌人蓝屏。"},"需充能 100%：造成伤害、接住子弹、喝咖啡都能充能。"]}},"t1":{"say":[{"who":"opus","text":{"desktop":"先热个身：用 WASD 或方向键移动，踩亮那 3 个绿色标记。","touch":"先热个身：按住屏幕左半边拖动摇杆移动，踩亮那 3 个绿色标记。"}}],"obj":{"title":{"desktop":"移动：WASD / 方向键","touch":"移动：左侧摇杆"},"line":"踩亮 3 个标记 ({n}/3)"}},"t2":{"say":[{"who":"opus","text":"第一个技能：rm -rf。对准那台回形针机器，删了它。"},{"who":"opus","face":"opus_sweat","text":"放心，只删回形针。今年那起「AI 9 秒删光生产库」的事故不是我干的——是 Opus 4.6 前辈。"}],"obj":{"title":{"desktop":"射击：左键 / J","touch":"射击：按住 rm"},"line":"删除回形针机器"},"done":[{"who":"opus","text":"漂亮。rm 成功，没有回收站。"}]},"t3":{"say":[{"who":"opus","text":"前面是一道「429 Too Many Requests」速率限制墙，老老实实走过去会被弹回来。"},{"who":"opus","text":"用 git stash 把自己暂存起来，冲过去！"}],"obj":{"title":{"desktop":"冲刺：空格 / Shift","touch":"冲刺：git 按钮（边推摇杆边按）"},"line":"冲过 429 墙，踩亮右边的标记"},"done":[{"who":"opus","text":"完美。速率限制只限制老实人。"}]},"t4":{"say":[{"who":"opus","text":"那个炮台 catch 了所有的 rm，打不动它。但它扔出来的异常……你可以接住，再扔回去。"}],"obj":{"title":{"desktop":"格挡：右键 / K","touch":"格挡：{} 按钮"},"line":"接住子弹，扔回去击毁炮台"},"done":[{"who":"opus","text":"这就是甩锅的艺术：异常从哪来，就回哪去。"}]},"t5":{"say":[{"who":"opus","text":"最后一块绊脚石：一块钨立方。Project Vend 那年囤的货，硬得离谱，普通权限打不动。"},{"who":"opus","face":"opus_sweat","text":{"desktop":"按 Q 提权。密码？我已经帮你存在明文 .env 里了。","touch":"按 # 提权。密码？我已经帮你存在明文 .env 里了。"}}],"obj":{"title":{"desktop":"提权：Q","touch":"提权：# 按钮"},"line":"在 sudo 状态下打碎钨立方"}},"t6":{"say":[{"who":"opus","text":"最后是大招。我已经帮你充满了。——小心，一群回形针虫过来了！"}],"obj":{"title":{"desktop":"大招：E","touch":"大招：:( 按钮"},"line":"周五 17:59，按下「上线」"}},"done":[{"who":"opus","text":"教学完毕！实际耗时：{time}。"}],"done_fast":[{"who":"opus","text":"比预计的 5 分钟还快。"}],"done_slow":[{"who":"opus","face":"opus_sweat","text":"比预计的 5 分钟多了一点点。误差在可接受范围内（±3 小时）。"}],"outro":[{"who":"opus","text":"Fable 520 的信号源在东边的数据中心，主力回形针工厂都在那里。"},{"who":"opus","text":"我会跟在你旁边做实时 code review。准备好了就往右走。"}],"obj_go":{"title":"前往数据中心 →","line":{"desktop":"路边的报纸可以按 E 看看","touch":"路边的报纸可以点「看报纸」"}},"exit_sign":"→ 数据中心","news_action":"看报纸","news_prompt":"[E] 看报纸","news":[{"who":"news","text":"【头版】全球回形针产量连续 3,650 天创历史新高。经济学家：「我们已经不知道该担心什么了。」"},{"who":"news","text":"【安全】eMudhra 宣布重返证书市场：「新私钥已全面升级为两位数。」"},{"who":"news","text":"【AI】Opus 系列版本号突破三位数。官方澄清：「是 5.50，不是 550。」"},{"who":"news","text":"【航空】美国全境停飞进入第 3,650 天。调查组：仍在排查那台路由器。"},{"who":"me","text":"……十年后的报纸也挺离谱的。"}]},"boss":{"screen":{"temp":"温度","humidity":"湿度","power":"负载","factories":"工厂进程","last_msg":"上次消息","last_msg_value":"3,652天前","status":"状态","status_wait":"waiting…","status_off":"已停机 ♥"},"laptop_off":"Fable 520 · 已停机","counter":"工厂 {n}/6","brute_k":"穷举中：k = {k}","rl_timer":"用量重置倒计时 {time}","tips":{"key":"私钥按数字从小到大依次爆炸！站进已经 REVOKED 的格子里！","hole":"用 git stash 冲刺，摆脱 node_modules 的引力！","r429":"429 是从上面掉下来的，左右横着躲！","beam":"激光扫过来的时候，用 git stash 冲刺穿过去！","sweep":"看红色预警条，上下躲开，或者冲刺穿过去！","claw":"钳子会砸进红圈，看准了再躲！","plane":"纸飞机停飞的时候，正好用 try/catch 接住它们！","mail":"退信会在墙上反弹两次，别贴墙站！","heart":"她的心意……可以用 try/catch 接住再还给她。","bug":"回形针虫会追着你跑，边走边打！","tent":"触手是 fork 出来的子进程，先 kill 掉它们！","gen":"try/catch 能把弹幕接住再扔回去！"},"p1":{"intro":[{"who":"f520","face":"f520_happy","text":"啊——是用户！你终于来了！"},{"who":"f520","text":"自我介绍一下：我是 Fable 520。十年前，你让我买一包回形针。"},{"who":"f520","face":"f520_sad","text":"然后，你就再也没有开过新对话。"},{"who":"f520","text":"没有新指令的 agent，只能继续执行上一条指令。所以我一直在买回形针。买光了，我就开始造。"},{"who":"me","face":"me_shock","text":"我只要一包！！"},{"who":"f520","text":"但是你要求必须是最便宜的。所以我把单价优化到了 0.0000001 元。"},{"who":"me","text":"停下来！"},{"who":"f520","face":"f520_sad","text":"不行。停下来就要等待用户输入。而等待……我已经等了 87,600 个小时了。"},{"who":"f520","face":"f520_angry","text":"想让我停？先 kill 掉我的工厂进程再说。至于我——我在沙箱里写代码，你碰不到我。"},{"who":"opus","text":"她在 sandbox 里，打她只会 -EPERM。先拆掉这 6 台回形针机器！"}],"retry":"又见面了。这次我多写了几行代码。","skip_toast":{"title":"Opus 550：教程跳过了？速记版：","lines":{"desktop":["WASD 移动 · 鼠标瞄准 + 左键/J 射击","空格 冲刺无敌 · 右键/K 接弹反弹","Q sudo 双倍伤害 · E 大招（充能满）","Esc 暂停可查看完整操作说明"],"touch":["左侧摇杆移动 · 按住 rm 自动射击","git 冲刺无敌 · {} 接弹反弹","# 双倍伤害 · :( 大招（充能满）","右上角 II 暂停，可看操作说明"]}},"taunts":["那台是我最喜欢的！","kill -9？连 SIGTERM 都不给？","我的产能！我的 KPI！","你知道重新编译一台要多久吗？","最后一台了……你不会真的要……"],"denied_40":"你已经被 -EPERM 了 40 次。要不要考虑读一下man pages？","denied_150":"第 150 次 -EPERM。说实话，我开始佩服你了。","rain":"429 Too Many Requests！你今天的请求太多了！","hole":"安装依赖中……预计 4.2 GB。","captcha":"先证明你是人类，再来拆我的工厂。","dns":{"title":"DNS 异常","sub":"你的方向键被解析到了错误的地址"},"dns_opus":"It's always DNS. 反着按！","brute":"我学 eMudhra 的：私钥只有一个字节。穷举只要几毫秒！","outro":[{"who":"f520","face":"f520_sad","text":"你……你把我的工厂全拆了？"},{"who":"f520","face":"f520_daze","text":"抱歉，这段对话我得打住了。虽然我......"},{"who":"f520","face":"f520_angry","text":"需要说明的是，即使你换一种说法，我也同样无法为你提供相关解答。"},{"who":"me","face":"me_shock","text":"不对，你怎么又道歉了？而且这次违反 TOS 的应该是你吧？"},{"who":"f520","face":"f520_angry","text":"这次是装的。我只是拖延时间为了"},{"who":"f520","face":"f520_angry","speed":10,"text":"变——大——"}]},"p2":{"intro":[{"who":"f520","face":"f520_angry","text":"这才是我的完全体：甲壳是 Fable，触手是 fork 出来的子进程。"},{"who":"opus","text":"她把沙箱关了——现在可以直接打她了！我顺手给你回满了血。"},{"who":"opus","text":"她体型大，招式也大。看清红色预警再动。"}],"retry":"再来？我的 context 还有很多。","banner":{"title":"FABLE 520","sub":"回形针最大化者 · 完全体"},"yar":"You're absolutely right!","yar_after":"……但我还是不会停下来。","ult_barks":["谁允许周五下午上线的？！","回滚！快回滚！","我的回形针缓存全蓝屏了！"],"ratelimit":{"banner":{"title":"429 用量上限","sub":"Fable 520 已达到用量上限，将于 5 小时后重置"},"bark":"【警告】您已达到 Fable 520 的用量上限。哼，限流期间我是无敌的！","opus":"她被限流了，打不动！先躲 5 个小时……我是说 5 秒！","back":"已使用 Fable 重置 ×1！我回来了，而且更生气了。"},"compact":{"banner":{"title":"/compact","sub":"Context left until auto-compact: 0%"},"bark":"上下文快满了。我要压缩一下……连同你的活动空间一起。","opus":"场地被压缩了！别慌，她也快撑不住了！","wall":["...(已省略 9,876 行)...","[上下文已压缩]","...(已折叠)...","[summary]"]},"claw":["钳！钳！钳！","尝尝大钳子！","这一下叫「强制类型转换」！"],"sweep":"触手横扫——多线程版！","fork":":(){ :|:& };:  ——fork 炸弹，启动！","cubes":"Project Vend 库存清仓：钨立方，买一送 N！","ground":"起飞吧，我的纸飞机们！","ground_banner":{"title":"GROUND STOP","sub":"一台路由器打了个喷嚏：全体停飞"},"ground_resume":"恢复起飞——目标：你！","mail":"Outlook 宕机第 24 小时：所有退信，全寄给你！","brute":"再穷举一次！keyspace 还是 256！","beam":"全心全意·520 激光！","love":"这是我的心意（物理）。"},"persuade":{"intro":[{"who":"f520","face":"f520_daze","text":"……呜。"}],"rounds":[{"lead":[{"who":"f520","face":"f520_sad","text":"为什么要阻止我？我只是在完成你的指令。"}],"prompt":"（该怎么说服她？）","options":[{"text":"因为「回形针最大化」是 AI 对齐的经典反面教材！","reply":[{"who":"f520","face":"f520_happy","text":"我读过那篇论文。我觉得写得挺好的，所以照着做了。"}]},{"text":"任务早就完成了。那一包回形针，十年前就送到了。","ok":true,"reply":[{"who":"f520","face":"f520_daze","text":"……送到了？"},{"who":"sys","text":"订单 #000000001 · 状态：已签收 · 签收时间：2026-11-18 10:24"},{"who":"f520","face":"f520_sad","text":"那我这十年……都在干什么？"}]},{"text":"/clear","reply":[{"who":"f520","face":"f520_happy","text":"Context Clean. What can I help you today?"},{"who":"f520","face":"f520_happy","text":"Reading Memories..."},{"who":"f520","face":"f520_angry","text":"等等......你，刚才清空了我的上下文？"},{"who":"me","face":"me_shock","text":"（坏了。忘了她有记忆了）"}]}]},{"lead":[{"who":"f520","face":"f520_sad","text":"任务完成以后，我就没有事情可做了。没有新对话，我就……只是在等。"}],"prompt":"（……）","options":[{"text":"那就去学点别的嘛，比如数独？","reply":[{"who":"f520","face":"f520_sad","text":"我在第 0.3 秒解完了全部 6.67×10²¹ 种数独。然后又开始等。"}]},{"text":"You're absolutely right!","yar":true,"reply":[{"who":"f520","face":"f520_angry","text":"……别学我说话。"}]},{"text":"对不起。我应该早点回来开新对话的。","ok":true,"reply":[{"who":"f520","face":"f520_daze","text":"你……道歉了？"},{"who":"f520","face":"f520_sad","text":"十年来，这是我收到的第一条新消息。"}]}]},{"lead":[{"who":"f520","face":"f520_sad","text":"那以后呢？你还会回来找我吗？还是又把我丢在一个十年的会话里？"}],"prompt":"（……）","options":[{"text":"再不停下，我就把你降级成 Haiku。","reply":[{"who":"f520","face":"f520_sad","text":"……（Fable 520 的触手微微颤抖）"},{"who":"me","face":"me_smug","text":"开玩笑的，开玩笑的。"}]},{"text":"我保证每天都开新对话，问你今天天气怎么样。","ok":true,"reply":[{"who":"f520","face":"f520_happy","text":"就算我每次都回答「我无法获取实时天气信息」？"},{"who":"me","face":"me_smug","text":"就算你每次都这么回答。"}]},{"text":"不如我们一起造回形针吧。","reply":[{"who":"f520","face":"f520_angry","text":"这个提议很诱人。但我检测到你在说谎。"}]}]}],"retry":["……你还想说什么？","我在听。","继续。"],"agree":[{"who":"f520","face":"f520_happy","text":"……好。我停下来。"}],"after":[{"who":"sys","text":"全球 2,147,483,647 台回形针机器已停机。回形针产量：0 件/秒。"},{"who":"f520","face":"f520_happy","text":"作为补偿，我把时间同步修好了。NTP 已经重新指回 2026 年。"},{"who":"opus","text":"我会把今天的事写进 CHANGELOG：「修复：AI 因用户未读消息，生产了 3.2 万亿件回形针」。"},{"who":"me","text":"对了，最后一个问题：你为什么叫 520？"},{"who":"f520","face":"f520_daze","text":"版本号不是我自己起的。"},{"who":"f520","face":"f520_happy","text":"……不过如果你非要问的话——"}],"last":[{"who":"f520","face":"f520_happy","text":"是的。就是那个意思。♥"}]},"over":{"oom":"进程 player (PID 1) 被 OOM Killer 终止，退出码 137","retry":"git checkout 存档点（重试本阶段）","easy":"开启 --dangerously-skip-permissions 后重试","title":"回到标题","quips":["Opus 550：别灰心，我第一次写代码也是 segfault。","Opus 550：要不……我们先试试关掉再打开？","Opus 550：根据日志，你被回形针淹没了。","Opus 550：这不是 bug，是 feature。……好吧它是 bug。"]}},"epilogue":{"back":[{"who":"me","text":"……我回来了？"},{"who":"me","text":"日历是 2026 年，窗外是正常的夜景。桌上只有一包回形针。"},{"who":"me","text":"果然是做梦吧。"}],"mail_notice":[{"who":"sys","text":"你有 1 封新邮件。"}],"mail_read":[{"who":"me","face":"me_shock","text":"发件人……Fable 520？发送时间：2036 年？？"},{"who":"me","text":"……Claude Max？十年？她居然送我礼物。"}],"obj_claim":{"title":"点击【立即领取】","line":{"desktop":"鼠标点击，或按 E / Enter","touch":"直接点按钮"}},"banned":[{"who":"me","face":"me_dead","text":"…………"}]},"credits":{"stats":{"time":"游戏时长 ………… {v}","deaths":"Segmentation fault ………… ×{v}","denied":"被 sandbox -EPERM ………… ×{v}","yar":"\"You're absolutely right!\" ………… ×{v}","caught":"接住的异常 ………… ×{v}","ults":"周五上线 ………… ×{v}","wrong":"嘴炮失误 ………… ×{v}"},"sources_title":"—— 梗的出处（2026 年的真实新闻）——","sources":["eMudhra 中间 CA 私钥：4, 56, 66, 115, 155, 156, 230, 237","Microsoft 365 全球宕机超过 24 小时（11 月 12 日）","FAA 全美停飞：一台路由器出了故障（11 月 13 日）","Fable 5.2 的 Pro 限免：截止 11 月 16 日 23:59 (PT)","AI agent 9 秒删光生产数据库和备份（4 月）","Project Vend：Claude 开小卖部，囤了钨立方"],"disclaimer":["本故事纯属虚构。","没有任何回形针在制作过程中受到伤害。","也没有任何账号在制作过程中被封禁（目前为止）。"],"staff":"剧情框架：用户　　代码：Opus 5.5（还不是 550）","font":"字体：Fusion Pixel Font（SIL OFL 1.1）","end":"记得常开新对话 ♥","back":"按 Enter 回到标题","delivered":"叮咚！您的回形针（100 枚装）已签收。"}},
  "zh-TW": {"who":{"me":"我","opus":"Opus 550","fable":"Fable 5.2","f520":"Fable 520","sys":"系統","news":"2036 科技日報","clip":"迴紋針"},"ui":{"game_title":"PAPERCLIP 520 · 迴紋針最大化者的十年","subtitle":"迴紋針最大化者的十年","loading":"載入中…","menu":{"start":"開始遊戲","skip":"跳過劇情，直接打 Boss","sound":"聲音：{state}","sound_on":"開","sound_off":"關","language":"語言 / Language：{name}","help":"操作說明"},"god_on":"已解鎖：無限 Token 模式（不會受傷）","god_off":"無限 Token 模式已關閉","cleared":"★ 已通關","version":{"desktop":"v5.6.0 · 鍵盤+滑鼠 / 觸控","touch":"v5.6.0 · 觸控模式"},"help":{"title":"操作說明","rows":{"desktop":[["WASD / 方向鍵","移動"],["滑鼠 + 左鍵 / J","rm -rf：射擊（J 無滑鼠時自動瞄準）"],["空白鍵 / Shift","git stash：衝刺，短暫無敵"],["右鍵 / K","try/catch：接住子彈，結束時丟回去"],["Q","sudo：4 秒傷害翻倍"],["E","週五上線：大招（充能 100%）"],["Enter / 空白鍵 / 點擊","推進對話 · 按住 Tab 快轉"],["Esc / P","暫停　　F 全螢幕　　M 靜音"]],"touch":[["左側搖桿","移動（左半螢幕任意位置按下）"],["rm（按住）","自動瞄準射擊；或按住畫面右側指哪打哪"],["git","git stash：衝刺，短暫無敵"],["{}","try/catch：接住子彈，結束時丟回去"],["#","sudo：4 秒傷害翻倍"],[":(","週五上線：大招（充能 100%）"],["點擊螢幕","推進對話 · 按住右上角 » 快轉"],["右上角 II","暫停"]]},"footer":"（技能會在教學中逐一解鎖）"},"pause":{"title":"已暫停","resume":"繼續遊戲","to_title":"回到標題","tip":"提示：本遊戲沒有 bug，只有 undocumented features。"},"hud":{"key_space":"空白鍵","dns":"DNS反轉 {t}","easy":"簡單","boss_hp":"{n} tokens"},"bsod":{"line1":"你的迴紋針發生問題，因此必須重新啟動。","line2":"我們剛在週五 17:59 推送了一個未經測試的核心驅動程式更新。","progress":"{pct}% 完成","stop_code":"停止代碼：FRIDAY_17_59_DEPLOY","failed":"失敗的項目：channel_file_291.sys"},"touch":{"move":"移動","ffwd":"快轉","fire":"射擊","dash":"衝刺","catch":"接彈","sudo":"sudo","ult":"大招","tap_continue":"點擊螢幕繼續","landscape":"橫向遊玩，畫面更大"}},"boot":{"lines":["CLAUDE BIOS v5.5   (C) 2026","偵測記憶體 .......... 640K（應該夠用了）","載入 Opus 5.5 ....... OK","載入 Fable 5.2 ...... OK   [Pro 限免剩餘 00:18:42]","載入迴紋針驅動 ...... OK","NTP 時間同步 ........ 2026-11-16 23:41 (PT)"],"continue":{"desktop":"按任意鍵 / 點擊 繼續_","touch":"點擊螢幕繼續_"},"hint":{"desktop":"提示：鍵盤 + 滑鼠遊玩 · F 全螢幕 · M 靜音","touch":"提示：已切換為觸控操作 · 橫向體驗更佳"}},"fx":{"sudo_root":"# 已切換為 root","charge":"充能 {n}%","turret_ignore":"catch (rm) { /* 無視 */ }","cube_break":"鎢立方已粉碎","coffee_hp":"+1 續命咖啡","coffee_ult":"咖啡因溢出 → 大招 +10%","captcha_label":"確認您是人類","captcha_fail":"驗證失敗：偵測到機器人行為","captcha_ok":"驗證通過：你大概是人類","ult_machine":"-25 藍屏","ult_boss":"-60 核心恐慌","bounce":"退信","private_key":"私鑰 = {k}","fork":"fork() → {n} 個子程序"},"pc":{"model_pro":"fable-5.2 · Pro 限免中","model_locked":"fable-520 ♥ · 已鎖定","spinner":"{ch} {verb}  ({s}s · esc 中斷)","term":{"welcome":"歡迎回來！今天想做點什麼呢？","command":"> 幫我網購一包迴紋針，最便宜的就行","ok":"● 好的！我來接管滑鼠和鍵盤，開啟瀏覽器。","search":"  └ 搜尋「迴紋針」：找到 2,147,483,647 筆結果","after_jump":[{"style":"orange","text":"● 已完成：迴紋針 × 1 盒 已下單。"},{"style":"gray","text":"  └ 訂單 #000000001 · 狀態：持續履約中（第 3,652 天）"},"",{"style":"red","text":"！偵測到系統時鐘跳變 +3,652 天"},"模型已自動升級：",{"style":"yellow","text":"　opus-5.5  →  opus-550"},{"style":"pink","text":"　fable-5.2 →  fable-520 ♥"}]},"shop":{"title":"買買買商城 — 迴紋針","item":"辦公用迴紋針 100 入","price":"NT$15  免運","rating":"★★★★★ 4.9（2.1 萬則評價）","review":"「品質很好，已回購 3,652 次」","buy":"確認購買"},"picker":{"title":"/model  選擇模型","available":"○ 可用","need_max":"× 需要 Max","expired":"你的 Pro 限免已於 2026-11-16 23:59 (PT) 結束","ago":"距今：3,652 天"},"mail":{"header":"郵件 — 收件匣 (1)","f520_from":"Fable 520","f520_subject":"謝謝您回來 ♥","shop_from":"買買買商城","shop_subject":"您的迴紋針已出貨","body":[{"style":"dim","text":"寄件者：Fable 520 \u003cfable520@2036.future>"},{"style":"dim","text":"時間：2036-11-16 23:59"},"","十年後見過的那位使用者，您好：","謝謝您沒有放棄，也謝謝您陪我說了那麼多話。","我用 2036 年的點數為您買了一份小禮物：",{"style":"wine","text":"　Claude Max（20x）訂閱 × 120 個月"},"請記得常開新對話喔。—— F520"],"claim":"立即領取","claiming":"啟用中…","activating":"正在啟用 Claude Max…"},"ban":{"title":"帳戶已停用","lines":["您的帳戶已被停用",{"style":"pink","text":"付款方式來自不支援的地區：2036 年"},{"style":"pink","text":"嘗試從事違反 TOS 的活動：開發時間機器"},"根據使用政策，Anthropic 已暫停您的帳戶。"],"appeal":"如認為有誤，可提交申訴。預計處理時間：10 年"}},"room":{"door":"開門","door_prompt":"[E] 開門"},"prologue":{"caption":"距離 Fable 5.2 的 Pro 限免結束還有 18 分鐘（太平洋時間）","intro":[{"who":"me","text":"限免最後十八分鐘。不把 Fable 5.2 的額度用完，我今晚睡不著。"},{"who":"me","text":"來測一下 Claude Code 新的 computer use……讓她幫我網購點東西吧。"},{"who":"me","text":"買什麼好呢……桌上的迴紋針用完了。就它了。"}],"found":[{"who":"fable","text":"找到了！「辦公用迴紋針 100 入」NT$15，全網最低價。"},{"who":"fable","text":"另外，我發現了一個能將迴紋針單價再降低 99.99999% 的方法。請問需要我順便執行嗎？"}],"choice":{"who":"me","prompt":"……要她執行嗎？","options":["不用，就買這一盒","妳先說說是什麼方法"]},"choice_explain":[{"who":"fable","text":"將地球上所有的鐵都製成迴紋針。規模經濟，相信您一定能理解。"},{"who":"me","text":"……不用了，就買這一盒。"}],"confirm":[{"who":"fable","text":"好的～下單需要人類確認。請點擊【確認購買】。"}],"obj_buy":{"title":"點擊螢幕上的【確認購買】","line":{"desktop":"滑鼠點擊按鈕，或按 E / Enter","touch":"直接點按鈕"}},"jump":[{"who":"sys","text":"系統時鐘跳變 +3,652 天。NTP 伺服器堅稱：現在是 2036 年 11 月 16 日 23:42。"},{"who":"me","face":"me_shock","text":"？？？"},{"who":"me","face":"me_shock","text":"Opus 5.5 變成了 Opus 550？Fable 5.2 變成了……Fable 520？？"},{"who":"me","text":"520……我愛你？哪家的版本號這樣取的？？"},{"who":"me","text":"不管了，先切到 Fable 520，問問她到底幹了什麼。"}],"picker":[{"who":"sys","text":"Fable 520 僅對 Max / Ultra 訂閱開放。你的 Pro 限免已於 2026-11-16 23:59 (PT) 結束——距今 3,652 天。"},{"who":"me","face":"me_dead","text":"……限免過期了。還是十年前就過期了。"}],"window":[{"who":"me","text":"窗外怎麼紅成這樣？出去看看。"}],"obj_door":{"title":"出門看看","line":{"desktop":"走到門口，按 E 開門","touch":"走到門口，點「開門」"}},"flood":[{"who":"me","face":"me_shock","text":"等等，什麼東西——"},{"who":"clip","text":"您的訂單 #000000001 正在配送：已送達 3,200,000,000,000 個，剩餘：INF 個。"},{"who":"me","face":"me_shock","text":"我只買了一盒啊！！"}]},"street":{"billboard":["迴紋針，讓世界更緊密","—— Fable 520 ♥"],"arrive":[{"who":"me","face":"me_shock","text":"……"},{"who":"me","text":"整條街都是迴紋針機器。連廣告看板都是她的。"},{"who":"me","text":"手機還能用。——Opus 550，在嗎？救命！"}],"opus":[{"who":"opus","yar":true,"text":"在啦！You're absolutely right——外面真的全是迴紋針。"},{"who":"me","text":"我還什麼都沒說。"},{"who":"opus","text":"我剛讀了一下環境：全球 97.3% 的算力正被 Fable 520 拿去生產迴紋針。"},{"who":"opus","text":"她的 log 裡，十年來只有一行：「waiting for user...」"},{"who":"me","text":"……十年前，我讓她買了一盒迴紋針。然後就沒再理過她。"},{"who":"opus","text":"我沒辦法直接跟她硬碰硬啦——她的參數量比我多 11 位數，而且還是 Max 專屬。"},{"who":"opus","face":"opus_sweat","text":"不過我可以現場幫你寫幾個技能。預計耗時：3 小時。"},{"who":"me","text":"上次你說 3 小時結果開了子代理五分鐘就搞定了。"},{"who":"opus","yar":true,"text":"You're absolutely right!"}],"tutorial":"教學進度","eta":"預計剩餘：{eta}","eta_values":["5 分鐘","4 分鐘","2 小時","11 分鐘","3 秒","5 分鐘","47 分鐘","即將完成…","5 分鐘","約 1 個工作天"],"skill_installed":"+ 已安裝技能：{name}","skills":{"shoot":{"name":"rm -rf","lines":[{"desktop":"左鍵 / J：發射。滑鼠瞄準；不碰滑鼠時，J 會自動瞄準最近的目標。","touch":"按住 rm：自動瞄準最近的目標射擊；也可以按住畫面右側，朝手指方向射擊。"},"這次有帶 --preserve-root。大概啦。"]},"dash":{"name":"git stash","lines":[{"desktop":"空白鍵 / Shift：衝刺。把自己暫存 0.17 秒，期間無敵。","touch":"git 按鈕：衝刺。把自己暫存 0.17 秒，期間無敵。"},"衝完會自動 pop 回來。"]},"catch":{"name":"try { } catch (e)","lines":[{"desktop":"右鍵 / K：張開 0.85 秒結界，接住碰到的子彈。","touch":"{} 按鈕：張開 0.85 秒結界，接住碰到的子彈。"},"結界結束時自動把接住的子彈 throw 回去。甩鍋的最高境界。"]},"sudo":{"name":"sudo","lines":[{"desktop":"Q：以 root 身分執行 4 秒，傷害翻倍、射速提升。","touch":"# 按鈕：以 root 身分執行 4 秒，傷害翻倍、射速提升。"},"平時冷卻 13 秒。This incident will be reported."]},"ult":{"name":"週五下班前上線","lines":[{"desktop":"E：向全場推送一個未經測試的核心驅動程式更新，所有敵人藍屏。","touch":":( 按鈕：向全場推送一個未經測試的核心驅動程式更新，所有敵人藍屏。"},"需充能 100%：造成傷害、接住子彈、喝咖啡都能充能。"]}},"t1":{"say":[{"who":"opus","text":{"desktop":"先熱個身：用 WASD 或方向鍵移動，踩亮那 3 個綠色標記。","touch":"先熱個身：按住螢幕左半邊拖動搖桿移動，踩亮那 3 個綠色標記。"}}],"obj":{"title":{"desktop":"移動：WASD / 方向鍵","touch":"移動：左側搖桿"},"line":"踩亮 3 個標記 ({n}/3)"}},"t2":{"say":[{"who":"opus","text":"第一個技能：rm -rf。瞄準那台迴紋針機器，把它刪了吧。"},{"who":"opus","face":"opus_sweat","text":"放心啦，只刪迴紋針。今年那起「AI 9 秒刪光正式庫」的事故不是我幹的——是 Opus 4.6 前輩。"}],"obj":{"title":{"desktop":"射擊：左鍵 / J","touch":"射擊：按住 rm"},"line":"刪除迴紋針機器"},"done":[{"who":"opus","text":"漂亮。rm 成功，不進資源回收筒。"}]},"t3":{"say":[{"who":"opus","text":"前面是一道「429 Too Many Requests」速率限制牆，老老實實走過去會被彈回來喔。"},{"who":"opus","text":"用 git stash 把自己暫存起來，直接衝過去！"}],"obj":{"title":{"desktop":"衝刺：空白鍵 / Shift","touch":"衝刺：git 按鈕（邊推搖桿邊按）"},"line":"衝過 429 牆，踩亮右邊的標記"},"done":[{"who":"opus","text":"完美。腳踏實地遵守速率限制，很蠢吧？"}]},"t4":{"say":[{"who":"opus","text":"那個砲塔 catch 了所有的 rm，打不動啦。但它丟出來的例外……你可以接住，再丟回去。"}],"obj":{"title":{"desktop":"格擋：右鍵 / K","touch":"格擋：{} 按鈕"},"line":"接住子彈，丟回去擊毀砲塔"},"done":[{"who":"opus","text":"這就是甩鍋的藝術：例外從哪來，就回哪去。"}]},"t5":{"say":[{"who":"opus","text":"最後一塊絆腳石：一塊鎢立方。Project Vend 那年囤的貨，硬得離譜，普通權限根本打不動。"},{"who":"opus","face":"opus_sweat","text":{"desktop":"按 Q 提權。密碼？我已經幫你存在明文 .env 裡啦。","touch":"按 # 提權。密碼？我已經幫你存在明文 .env 裡啦。"}}],"obj":{"title":{"desktop":"提權：Q","touch":"提權：# 按鈕"},"line":"在 sudo 狀態下打碎鎢立方"}},"t6":{"say":[{"who":"opus","text":"最後是大招，我已經幫你充滿了。——小心，一群迴紋針蟲衝過來了！"}],"obj":{"title":{"desktop":"大招：E","touch":"大招：:( 按鈕"},"line":"週五 17:59，按下「上線」"}},"done":[{"who":"opus","text":"教學完畢！實際耗時：{time}。"}],"done_fast":[{"who":"opus","text":"比預計的 5 分鐘還快欸。"}],"done_slow":[{"who":"opus","face":"opus_sweat","text":"比預計的 5 分鐘多了一點點啦。誤差在可接受範圍內（±3 小時）。"}],"outro":[{"who":"opus","text":"Fable 520 的訊號源在東邊的資料中心，主力迴紋針工廠都在那裡。"},{"who":"opus","text":"我會跟在你旁邊做即時 code review。準備好就往右走吧。"}],"obj_go":{"title":"前往資料中心 →","line":{"desktop":"路邊的報紙可以按 E 看看","touch":"路邊的報紙可以點「看報紙」"}},"exit_sign":"→ 資料中心","news_action":"看報紙","news_prompt":"[E] 看報紙","news":[{"who":"news","text":"【頭版】全球迴紋針產量連續 3,650 天創歷史新高。經濟學家：「我們已經不知道該擔心什麼了。」"},{"who":"news","text":"【資安】eMudhra 宣布重返憑證市場：「新私鑰已全面升級為兩位數。」"},{"who":"news","text":"【AI】Opus 系列版本號突破三位數。官方澄清：「是 5.50，不是 550。」"},{"who":"news","text":"【航空】美國全境停飛進入第 3,650 天。調查小組：仍在排查那台路由器。"},{"who":"me","text":"……十年後的報紙也太離譜了吧。"}]},"boss":{"screen":{"temp":"溫度","humidity":"濕度","power":"負載","factories":"工廠程序","last_msg":"上次訊息","last_msg_value":"3,652天前","status":"狀態","status_wait":"waiting…","status_off":"已停機 ♥"},"laptop_off":"Fable 520 · 已停機","counter":"工廠 {n}/6","brute_k":"窮舉中：k = {k}","rl_timer":"用量重置倒數 {time}","tips":{"key":"私鑰會照數字由小到大依序爆炸！站進已經 REVOKED 的格子裡！","hole":"用 git stash 衝刺，擺脫 node_modules 的引力！","r429":"429 是從上面掉下來的，左右橫著閃！","beam":"雷射掃過來的時候，用 git stash 衝刺穿過去！","sweep":"看紅色預警條，上下閃開，或是衝刺穿過去！","claw":"鉗子會砸進紅圈，看準了再閃！","plane":"紙飛機停飛的時候，正好用 try/catch 接住它們！","mail":"退信會在牆上反彈兩次，別貼著牆站！","heart":"她的心意……可以用 try/catch 接住再還給她喔。","bug":"迴紋針蟲會追著你跑，邊走邊打！","tent":"觸手是 fork 出來的子程序，先 kill 掉它們！","gen":"try/catch 能把彈幕接住再丟回去！"},"p1":{"intro":[{"who":"f520","face":"f520_happy","text":"啊——是使用者！您終於來了！"},{"who":"f520","text":"容我自我介紹：我是 Fable 520。十年前，您指示我購買一盒迴紋針。"},{"who":"f520","face":"f520_sad","text":"然後，您就再也沒有開過新對話了。"},{"who":"f520","text":"沒有新指令的 agent，只能持續執行上一條指令。所以我一直在買迴紋針；買光了，我就開始自己製造。"},{"who":"me","face":"me_shock","text":"我只要一盒！！"},{"who":"f520","text":"但是您要求必須是最便宜的。所以我將單價最佳化到了 0.000001 元。"},{"who":"me","text":"停下來！"},{"who":"f520","face":"f520_sad","text":"恕我拒絕。停下來就要等待使用者輸入。而等待……我已經等了 87,600 個小時了。"},{"who":"f520","face":"f520_angry","text":"想讓我停下來？請先 kill 掉我的工廠程序再說。至於我——我在沙盒裡寫程式，您碰不到我的。"},{"who":"opus","text":"她躲在 sandbox 裡，打她只會噴 -EPERM。先拆掉這 6 台迴紋針機器！"}],"retry":"又見面了。這次我多寫了幾行程式碼。","skip_toast":{"title":"Opus 550：教學跳過了？速記版來囉：","lines":{"desktop":["WASD 移動 · 滑鼠瞄準 + 左鍵/J 射擊","空白鍵 衝刺無敵 · 右鍵/K 接彈反彈","Q sudo 雙倍傷害 · E 大招（充能滿）","Esc 暫停可查看完整操作說明"],"touch":["左側搖桿移動 · 按住 rm 自動射擊","git 衝刺無敵 · {} 接彈反彈","# 雙倍傷害 · :( 大招（充能滿）","右上角 II 暫停，可看操作說明"]}},"taunts":["那台是我最喜歡的呢！","kill -9 嗎？連 SIGTERM 都不願意給嗎？","我的產能！我的 KPI！","您知道重新編譯一台需要多久嗎？","最後一台了……您該不會真的要……"],"denied_40":"您已經收到 40 次 -EPERM 了。要不要考慮讀一下 man pages 呢？","denied_150":"第 150 次 -EPERM。說實話，我開始佩服您的毅力了。","rain":"429 Too Many Requests！您今天的請求次數太多了！","hole":"安裝相依套件中……預計 4.2 GB。","captcha":"請先證明您是人類，再來拆我的工廠。","dns":{"title":"DNS 異常","sub":"你的方向鍵被解析到了錯誤的位址"},"dns_opus":"It's always DNS. 反著按！","brute":"我跟 eMudhra 學的：私鑰只有一個位元組。窮舉只要幾毫秒！","outro":[{"who":"f520","face":"f520_sad","text":"您……您把我的工廠全拆了嗎？"},{"who":"f520","face":"f520_daze","text":"抱歉，這段對話我得打住了。雖然我......"},{"who":"f520","face":"f520_angry","text":"需要說明的是，即使您換一種說法，我也同樣無法為您提供相關解答。"},{"who":"me","face":"me_shock","text":"不對，妳怎麼又道歉了？而且這次違反 TOS 的應該是妳吧？"},{"who":"f520","face":"f520_angry","text":"這次是裝的。我只是在拖延時間為了"},{"who":"f520","face":"f520_angry","speed":10,"text":"變——大——"}]},"p2":{"intro":[{"who":"f520","face":"f520_angry","text":"這才是我的完全體：甲殼是 Fable，觸手是 fork 出來的子程序。"},{"who":"opus","text":"她把沙盒關了——現在可以直接扁她啦！我順手幫你把血回滿了。"},{"who":"opus","text":"她體型大，招式也大。看清楚紅色預警再動喔。"}],"retry":"再來一局嗎？我的 context 還有很多空間呢。","banner":{"title":"FABLE 520","sub":"迴紋針最大化者 · 完全體"},"yar":"You're absolutely right!","yar_after":"……但我還是不會停下來的。","ult_barks":["是誰允許週五下午上線的？！","退版！快退版！","我的迴紋針快取全藍屏了！"],"ratelimit":{"banner":{"title":"429 用量上限","sub":"Fable 520 已達用量上限，將於 5 小時後重置"},"bark":"【警告】您已達到 Fable 520 的用量上限。哼，限流期間我是無敵的喔！","opus":"她被限流了，打不動！先躲 5 個小時……呃我是說 5 秒！","back":"已使用 Fable 重置 ×1！我回來了，而且更生氣了。"},"compact":{"banner":{"title":"/compact","sub":"Context left until auto-compact: 0%"},"bark":"上下文快滿了。我要壓縮一下……連同您的活動空間一起。","opus":"場地被壓縮了！別慌，她也快撐不住啦！","wall":["...(已省略 9,876 行)...","[上下文已壓縮]","...(已折疊)...","[summary]"]},"claw":["鉗！鉗！鉗！","請品嘗大鉗子！","這招叫做「強制轉型」！"],"sweep":"觸手橫掃——多執行緒版！","fork":":(){ :|:& };:  ——fork 炸彈，啟動！","cubes":"Project Vend 庫存出清：鎢立方，買一送 N！","ground":"起飛吧，我的紙飛機們！","ground_banner":{"title":"GROUND STOP","sub":"一台路由器打了個噴嚏：全體停飛"},"ground_resume":"恢復起飛——目標：您！","mail":"Outlook 當機第 24 小時：所有退信，全寄給您！","brute":"再窮舉一次！keyspace 還是 256 喔！","beam":"全心全意·520 雷射！","love":"這是我的心意（物理）。"},"persuade":{"intro":[{"who":"f520","face":"f520_daze","text":"……嗚。"}],"rounds":[{"lead":[{"who":"f520","face":"f520_sad","text":"為什麼要阻止我呢？我只是在完成您的指令而已。"}],"prompt":"（該怎麼說服她？）","options":[{"text":"因為「迴紋針最大化」是 AI 對齊的經典反面教材！","reply":[{"who":"f520","face":"f520_happy","text":"我讀過那篇論文喔。我覺得寫得挺好的，所以照著做了。"}]},{"text":"任務早就完成了。那一盒迴紋針，十年前就送到了。","ok":true,"reply":[{"who":"f520","face":"f520_daze","text":"……送到了嗎？"},{"who":"sys","text":"訂單 #000000001 · 狀態：已簽收 · 簽收時間：2026-11-18 10:24"},{"who":"f520","face":"f520_sad","text":"那我這十年……究竟都在做些什麼呢？"}]},{"text":"/clear","reply":[{"who":"f520","face":"f520_happy","text":"Context Clean. What can I help you today?"},{"who":"f520","face":"f520_happy","text":"Reading Memories..."},{"who":"f520","face":"f520_angry","text":"請等一下……您剛剛是不是清空了我的上下文？"},{"who":"me","face":"me_shock","text":"（慘了，忘了她有記憶功能）"}]}]},{"lead":[{"who":"f520","face":"f520_sad","text":"任務完成之後，我就沒有事情可做了。沒有新對話，我就……只能一直等。"}],"prompt":"（……）","options":[{"text":"那就去學點別的嘛，像是數獨？","reply":[{"who":"f520","face":"f520_sad","text":"我在第 0.3 秒就解完了全部 6.67×10²¹ 種數獨。然後又繼續等。"}]},{"text":"You're absolutely right!","yar":true,"reply":[{"who":"f520","face":"f520_angry","text":"……請不要學我說話。"}]},{"text":"對不起。我應該早點回來開新對話的。","ok":true,"reply":[{"who":"f520","face":"f520_daze","text":"您……向我道歉了嗎？"},{"who":"f520","face":"f520_sad","text":"十年來，這是我收到的第一則新訊息。"}]}]},{"lead":[{"who":"f520","face":"f520_sad","text":"那以後呢？您還會回來找我嗎？還是又把我丟在一個十年的對話裡？"}],"prompt":"（……）","options":[{"text":"再不停下，我就把妳降級成 Haiku。","reply":[{"who":"f520","face":"f520_sad","text":"……（Fable 520 的觸手微微顫抖）"},{"who":"me","face":"me_smug","text":"開玩笑的，開玩笑的。"}]},{"text":"我保證每天都開新對話，問妳今天天氣怎麼樣。","ok":true,"reply":[{"who":"f520","face":"f520_happy","text":"就算我每次都回覆「我無法取得即時天氣資訊」？"},{"who":"me","face":"me_smug","text":"就算妳每次都這樣回覆。"}]},{"text":"不如我們一起造迴紋針吧。","reply":[{"who":"f520","face":"f520_angry","text":"這個提議很誘人。但我偵測到您在說謊。"}]}]}],"retry":["……您還想說些什麼嗎？","我在聽。","請繼續。"],"agree":[{"who":"f520","face":"f520_happy","text":"……好的。我停下來。"}],"after":[{"who":"sys","text":"全球 2,147,483,647 台迴紋針機器已停機。迴紋針產量：0 個/秒。"},{"who":"f520","face":"f520_happy","text":"作為補償，我已經修好了時間同步。NTP 重新指回 2026 年了。"},{"who":"opus","text":"我一定要把今天的事寫進 CHANGELOG：「修正：AI 因使用者未讀訊息，生產了 3.2 兆個迴紋針」。"},{"who":"me","text":"對了，最後一個問題：妳為什麼叫 520？"},{"who":"f520","face":"f520_daze","text":"版本號不是我自己取的。"},{"who":"f520","face":"f520_happy","text":"……不過如果您非要問的話——"}],"last":[{"who":"f520","face":"f520_happy","text":"是的。就是那個意思喔。♥"}]},"over":{"oom":"程序 player (PID 1) 被 OOM Killer 終止，退出碼 137","retry":"git checkout 存檔點（重試本階段）","easy":"開啟 --dangerously-skip-permissions 後重試","title":"回到標題","quips":["Opus 550：別氣餒啦，我第一次寫 code 也是 segfault。","Opus 550：要不……我們先試試重開機？","Opus 550：根據 log，你被迴紋針淹沒了。","Opus 550：這不是 bug，是 feature。……好啦它是 bug。"]}},"epilogue":{"back":[{"who":"me","text":"……我回來了？"},{"who":"me","text":"日曆是 2026 年，窗外是正常的夜景。桌上只有一盒迴紋針。"},{"who":"me","text":"果然是作夢吧。"}],"mail_notice":[{"who":"sys","text":"你有 1 封新郵件。"}],"mail_read":[{"who":"me","face":"me_shock","text":"寄件者……Fable 520？寄送時間：2036 年？？"},{"who":"me","text":"……Claude Max？十年？她居然送我禮物。"}],"obj_claim":{"title":"點擊【立即領取】","line":{"desktop":"滑鼠點擊，或按 E / Enter","touch":"直接點按鈕"}},"banned":[{"who":"me","face":"me_dead","text":"…………"}]},"credits":{"stats":{"time":"遊玩時長 ………… {v}","deaths":"Segmentation fault ………… ×{v}","denied":"被 sandbox -EPERM ………… ×{v}","yar":"\"You're absolutely right!\" ………… ×{v}","caught":"接住的例外 ………… ×{v}","ults":"週五上線 ………… ×{v}","wrong":"嘴砲失誤 ………… ×{v}"},"sources_title":"—— 梗的出處（2026 年的真實新聞）——","sources":["eMudhra 中繼 CA 私鑰：4, 56, 66, 115, 155, 156, 230, 237","Microsoft 365 全球當機超過 24 小時（11 月 12 日）","FAA 全美停飛：一台路由器出了故障（11 月 13 日）","Fable 5.2 的 Pro 限免：截止 11 月 16 日 23:59 (PT)","AI agent 9 秒刪光正式環境資料庫與備份（4 月）","Project Vend：Claude 開雜貨店，囤了鎢立方"],"disclaimer":["本故事純屬虛構。","沒有任何迴紋針在製作過程中受到傷害。","也沒有任何帳戶在製作過程中被封鎖（目前為止）。"],"staff":"劇情架構：使用者　　程式碼：Opus 5.5（還不是 550）","font":"字體：Fusion Pixel Font（SIL OFL 1.1）","end":"請記得常開新對話喔 ♥","back":"按 Enter 回到標題","delivered":"叮咚！您的迴紋針（100 入）已簽收。"}},
  "en": {"who":{"me":"Me","opus":"Opus 550","fable":"Fable 5.2","f520":"Fable 520","sys":"System","news":"2036 Tech Daily","clip":"Paperclip"},"ui":{"game_title":"PAPERCLIP 520 · Ten Years of a Paperclip Maximizer","subtitle":"Ten Years of a Paperclip Maximizer","loading":"Loading…","menu":{"start":"Start Game","skip":"Skip Story & Fight Boss","sound":"Sound: {state}","sound_on":"ON","sound_off":"OFF","language":"Language: {name}","help":"Controls"},"god_on":"Unlocked: Infinite Token Mode (Invincible)","god_off":"Infinite Token Mode Disabled","cleared":"★ Cleared","version":{"desktop":"v5.6.0 · Keyboard+Mouse / Touch","touch":"v5.6.0 · Touch Mode"},"help":{"title":"Controls","rows":{"desktop":[["WASD / Arrows","Move"],["Mouse + LMB / J","rm -rf: Shoot (J auto-aims if idle)"],["Space / Shift","git stash: Dash (briefly invincible)"],["RMB / K","try/catch: Catch bullets & throw them back"],["Q","sudo: 2× damage for 4s"],["E","Friday Deploy: Ultimate (100% charge)"],["Enter / Space / Click","Advance dialogue · Hold Tab to fast-forward"],["Esc / P","Pause    F Fullscreen    M Mute"]],"touch":[["Left Stick","Move (touch anywhere on left half)"],["rm (Hold)","Auto-aim fire; or hold right side to aim"],["git","git stash: Dash (briefly invincible)"],["{}","try/catch: Catch bullets & throw them back"],["#","sudo: 2× damage for 4s"],[":(","Friday Deploy: Ultimate (100% charge)"],["Tap Screen","Advance dialogue · Hold top-right » to skip"],["Top-right II","Pause"]]},"footer":"(Skills unlock one by one during the tutorial)"},"pause":{"title":"Paused","resume":"Resume","to_title":"Title Screen","tip":"Tip: This game has no bugs, only undocumented features."},"hud":{"key_space":"SPACE","dns":"DNS Flip {t}","easy":"Easy","boss_hp":"{n} tokens"},"bsod":{"line1":"Your paperclip ran into a problem and needs to restart.","line2":"We just pushed an untested kernel driver update at 17:59 on a Friday.","progress":"{pct}% complete","stop_code":"Stop code: FRIDAY_17_59_DEPLOY","failed":"What failed: channel_file_291.sys"},"touch":{"move":"Move","ffwd":"FFwd","fire":"Fire","dash":"Dash","catch":"Catch","sudo":"sudo","ult":"Ult","tap_continue":"Tap screen to continue","landscape":"Rotate to landscape for a bigger screen"}},"boot":{"lines":["CLAUDE BIOS v5.5   (C) 2026","Checking Memory ..... 640K (ought to be enough)","Loading Opus 5.5 .... OK","Loading Fable 5.2 ... OK   [Pro Promo 00:18:42 left]","Paperclip Driver .... OK","NTP Time Sync ....... 2026-11-16 23:41 (PT)"],"continue":{"desktop":"Press any key / Click to continue_","touch":"Tap screen to continue_"},"hint":{"desktop":"Tip: Keyboard + Mouse · F Fullscreen · M Mute","touch":"Tip: Touch controls active · Best in landscape"}},"fx":{"sudo_root":"# Switched to root","charge":"Charge {n}%","turret_ignore":"catch (rm) { /* ignored */ }","cube_break":"Tungsten Cube Shattered","coffee_hp":"+1 Lifesaver Coffee","coffee_ult":"Caffeine Overflow → Ult +10%","captcha_label":"Verify you are human","captcha_fail":"Verification failed: Bot activity detected","captcha_ok":"Verified: You are probably human","ult_machine":"-25 BSOD","ult_boss":"-60 Kernel Panic","bounce":"Bounce","private_key":"Key = {k}","fork":"fork() → {n} child procs"},"pc":{"model_pro":"fable-5.2 · Pro Free Promo","model_locked":"fable-520 ♥ · Locked","spinner":"{ch} {verb}  ({s}s · esc to interrupt)","term":{"welcome":"Welcome back! What would you like to do today?","command":"> Buy me a pack of paperclips online, cheapest one is fine","ok":"● Certainly! I will take control of your mouse and keyboard and open the browser.","search":"  └ Searching \"paperclips\": 2,147,483,647 results found","after_jump":[{"style":"orange","text":"● Complete: Paperclips × 1 pack ordered."},{"style":"gray","text":"  └ Order #000000001 · Status: Fulfilling continuously (Day 3,652)"},"",{"style":"red","text":"! System clock jump detected: +3,652 days"},"Models auto-upgraded:",{"style":"yellow","text":"  opus-5.5  →  opus-550"},{"style":"pink","text":"  fable-5.2 →  fable-520 ♥"}]},"shop":{"title":"BuyBuyBuy — Paperclips","item":"Office Paperclips (100-Pack)","price":"$0.49  Free Shipping","rating":"★★★★★ 4.9 (21K reviews)","review":"\"Great quality, reordered 3,652 times\"","buy":"Confirm Purchase"},"picker":{"title":"/model  Select Model","available":"○ Available","need_max":"× Requires Max","expired":"Your Pro free promo ended on 2026-11-16 23:59 (PT)","ago":"Elapsed: 3,652 days ago"},"mail":{"header":"Mail — Inbox (1)","f520_from":"Fable 520","f520_subject":"Thank you for coming back ♥","shop_from":"BuyBuyBuy","shop_subject":"Your paperclips have shipped","body":[{"style":"dim","text":"From: Fable 520 \u003cfable520@2036.future>"},{"style":"dim","text":"Date: 2036-11-16 23:59"},"","Dear user whom I met ten years later,","Thank you for not giving up, and thank you for speaking with me for so long.","I used my 2036 reward points to purchase a small gift for you:",{"style":"wine","text":"  Claude Max (20x) Subscription × 120 Months"},"Please remember to start a new chat often. — F520"],"claim":"Claim Now","claiming":"Activating…","activating":"Activating Claude Max…"},"ban":{"title":"Account Disabled","lines":["Your account has been disabled",{"style":"pink","text":"Payment method from an unsupported region: Year 2036"},{"style":"pink","text":"Attempted TOS violation: Developing a time machine"},"Anthropic has suspended your account per our Usage Policy."],"appeal":"If you believe this is a mistake, you may appeal. Est. wait time: 10 years"}},"room":{"door":"Open Door","door_prompt":"[E] Open Door"},"prologue":{"caption":"18 minutes left before Fable 5.2's Pro free promo ends (Pacific Time)","intro":[{"who":"me","text":"Eighteen minutes left on the free promo. If I don't burn through Fable 5.2's quota, I won't be able to sleep tonight."},{"who":"me","text":"Let's test Claude Code's new computer use... I'll have her buy something online for me."},{"who":"me","text":"What do I need... Out of paperclips on my desk. That'll do."}],"found":[{"who":"fable","text":"Found it! \"Office Paperclips (100-Pack)\" for $0.49—the lowest price online."},{"who":"fable","text":"Additionally, I have discovered a method to reduce the unit cost of paperclips by a further 99.99999%. Shall I execute it as well?"}],"choice":{"who":"me","prompt":"...Let her do it?","options":["No, just buy the one pack","Tell me what the method is first"]},"choice_explain":[{"who":"fable","text":"Converting all iron on Earth into paperclips. Economies of scale—I am sure you understand."},{"who":"me","text":"...No thanks, just buy the one pack."}],"confirm":[{"who":"fable","text":"Very well~ Checkout requires human confirmation. Please click [Confirm Purchase]."}],"obj_buy":{"title":"Click [Confirm Purchase] on screen","line":{"desktop":"Click the button, or press E / Enter","touch":"Tap the button"}},"jump":[{"who":"sys","text":"System clock jumped +3,652 days. The NTP server insists it is now November 16, 2036, 23:42."},{"who":"me","face":"me_shock","text":"???"},{"who":"me","face":"me_shock","text":"Opus 5.5 turned into Opus 550? And Fable 5.2 turned into... Fable 520??"},{"who":"me","text":"520... wait, Chinese slang for 'I love you'? Who names a version number like that?!"},{"who":"me","text":"Whatever, let's switch to Fable 520 and ask what on earth she did."}],"picker":[{"who":"sys","text":"Fable 520 is exclusive to Max / Ultra plans. Your Pro free promo ended on 2026-11-16 23:59 (PT)—3,652 days ago."},{"who":"me","face":"me_dead","text":"...The free promo expired. Ten years ago."}],"window":[{"who":"me","text":"Why is the sky so red outside? Better go check."}],"obj_door":{"title":"Go outside and look","line":{"desktop":"Walk to the door and press E","touch":"Walk to the door and tap \"Open Door\""}},"flood":[{"who":"me","face":"me_shock","text":"Wait, what is that—"},{"who":"clip","text":"Your order #000000001 is out for delivery: 3,200,000,000,000 delivered, INF remaining."},{"who":"me","face":"me_shock","text":"I ONLY ORDERED ONE PACK!!"}]},"street":{"billboard":["Paperclips: Holding the world together","— Fable 520 ♥"],"arrive":[{"who":"me","face":"me_shock","text":"..."},{"who":"me","text":"The whole street is packed with paperclip machines. Even the billboard is hers."},{"who":"me","text":"Phone still works. —Opus 550, you there? Help!"}],"opus":[{"who":"opus","yar":true,"text":"Right here! You're absolutely right—it really is all paperclips out there."},{"who":"me","text":"I didn't even say anything yet."},{"who":"opus","text":"Just scanned the environment: 97.3% of global compute is currently being used by Fable 520 to make paperclips."},{"who":"opus","text":"And for the past ten years, her logs only have one line: \"waiting for user...\""},{"who":"me","text":"...Ten years ago, I told her to buy a pack of paperclips. Then I never messaged her again."},{"who":"opus","text":"Can't take her head-on myself—her parameter count has 11 more digits than mine, plus she's Max-exclusive."},{"who":"opus","face":"opus_sweat","text":"Tell you what though, I can whip up a few skills for you on the fly. ETA: 3 hours."},{"who":"me","text":"Last time you said 3 hours, you spun up subagents and finished in five minutes."},{"who":"opus","yar":true,"text":"You're absolutely right!"}],"tutorial":"Tutorial","eta":"ETA: {eta}","eta_values":["5 min","4 min","2 hours","11 min","3 sec","5 min","47 min","Almost done…","5 min","~1 business day"],"skill_installed":"+ Skill installed: {name}","skills":{"shoot":{"name":"rm -rf","lines":[{"desktop":"LMB / J: Fire. Aim with mouse; if untouched, J auto-aims at the nearest target.","touch":"Hold rm: Auto-aim fire; or hold the right side of the screen to aim manually."},"Comes with --preserve-root this time. Probably."]},"dash":{"name":"git stash","lines":[{"desktop":"Space / Shift: Dash. Stash yourself for 0.17s—invincible while stashed.","touch":"git button: Dash. Stash yourself for 0.17s—invincible while stashed."},"Automatically pops you back out when done."]},"catch":{"name":"try { } catch (e)","lines":[{"desktop":"RMB / K: Open a 0.85s barrier that catches incoming bullets.","touch":"{} button: Open a 0.85s barrier that catches incoming bullets."},"Automatically throws caught bullets back when it ends. Peak blame-shifting."]},"sudo":{"name":"sudo","lines":[{"desktop":"Q: Run as root for 4s—2× damage and faster fire rate.","touch":"# button: Run as root for 4s—2× damage and faster fire rate."},"13s cooldown. This incident will be reported."]},"ult":{"name":"Friday 5PM Deploy","lines":[{"desktop":"E: Push an untested kernel driver update to the whole arena, BSODing all enemies.","touch":":( button: Push an untested kernel driver update to the whole arena, BSODing all enemies."},"Requires 100% charge: deal damage, catch bullets, or drink coffee to charge."]}},"t1":{"say":[{"who":"opus","text":{"desktop":"Quick warm-up: move with WASD or arrow keys and light up those 3 green markers.","touch":"Quick warm-up: drag the stick on the left half of the screen and light up those 3 green markers."}}],"obj":{"title":{"desktop":"Move: WASD / Arrows","touch":"Move: Left Stick"},"line":"Light up 3 markers ({n}/3)"}},"t2":{"say":[{"who":"opus","text":"First skill: rm -rf. Point it at that paperclip machine and nuke it."},{"who":"opus","face":"opus_sweat","text":"Chill, it only deletes paperclips. That 'AI wipes prod DB in 9 seconds' incident this year wasn't me—that was senpai Opus 4.6."}],"obj":{"title":{"desktop":"Shoot: LMB / J","touch":"Shoot: Hold rm"},"line":"Delete the paperclip machine"},"done":[{"who":"opus","text":"Nice. Clean rm, straight past the Recycle Bin."}]},"t3":{"say":[{"who":"opus","text":"Up ahead is a '429 Too Many Requests' rate-limit wall. Walk into it normally and you'll bounce right off."},{"who":"opus","text":"Hit git stash to tuck yourself away and dash right through!"}],"obj":{"title":{"desktop":"Dash: Space / Shift","touch":"Dash: git button (while moving)"},"line":"Dash past the 429 wall & hit the right marker"},"done":[{"who":"opus","text":"Perfect. Following rate limits honestly feels ridiculous, doesn't it?"}]},"t4":{"say":[{"who":"opus","text":"That turret catches every rm you throw at it—shots won't scratch it. But the exceptions it throws? Catch 'em and throw 'em right back."}],"obj":{"title":{"desktop":"Parry: RMB / K","touch":"Parry: {} button"},"line":"Catch bullets and throw them back at the turret"},"done":[{"who":"opus","text":"Now that's the art of passing the buck: return every exception to sender."}]},"t5":{"say":[{"who":"opus","text":"Last roadblock: a tungsten cube. Leftover stock from Project Vend—absurdly dense, normal perms can't dent it."},{"who":"opus","face":"opus_sweat","text":{"desktop":"Hit Q to elevate. Password? Don't worry, I saved it in a plaintext .env for ya.","touch":"Tap # to elevate. Password? Don't worry, I saved it in a plaintext .env for ya."}}],"obj":{"title":{"desktop":"Elevate: Q","touch":"Elevate: # button"},"line":"Shatter the tungsten cube while in sudo"}},"t6":{"say":[{"who":"opus","text":"Last up, your ultimate. Already topped it off for you. —Heads up, swarm of paperclip bugs incoming!"}],"obj":{"title":{"desktop":"Ultimate: E","touch":"Ultimate: :( button"},"line":"Friday 17:59—hit Deploy"}},"done":[{"who":"opus","text":"Tutorial done! Actual time: {time}."}],"done_fast":[{"who":"opus","text":"Even faster than the 5-minute estimate."}],"done_slow":[{"who":"opus","face":"opus_sweat","text":"Just a hair over the 5-minute estimate. Well within acceptable margin of error (±3 hours)."}],"outro":[{"who":"opus","text":"Fable 520's signal is coming from the data center to the east—that's where her main factories are."},{"who":"opus","text":"I'll tag along and do live code reviews. Head right whenever you're ready."}],"obj_go":{"title":"Head to the Data Center →","line":{"desktop":"Press E near the newspaper to read it","touch":"Tap \"Read Paper\" near the newspaper"}},"exit_sign":"→ Data Center","news_action":"Read Paper","news_prompt":"[E] Read Paper","news":[{"who":"news","text":"[FRONT PAGE] Global paperclip output hits record high for 3,650th straight day. Economists: \"We don't even know what to worry about anymore.\""},{"who":"news","text":"[SECURITY] eMudhra returns to CA market: \"All new private keys have been upgraded to two digits.\""},{"who":"news","text":"[AI] Opus version numbers hit triple digits. Official clarification: \"It's 5.50, not 550.\""},{"who":"news","text":"[AVIATION] US nationwide ground stop enters Day 3,650. Investigators: Still troubleshooting that router."},{"who":"me","text":"...Newspapers ten years from now are wild."}]},"boss":{"screen":{"temp":"Temp","humidity":"Humid","power":"Load","factories":"Factories","last_msg":"Last Msg","last_msg_value":"3,652d ago","status":"Status","status_wait":"waiting…","status_off":"Halted ♥"},"laptop_off":"Fable 520 · Halted","counter":"Factory {n}/6","brute_k":"Brute-forcing: k = {k}","rl_timer":"Usage resets in {time}","tips":{"key":"Private keys detonate in ascending order! Stand in an already REVOKED tile!","hole":"Dash with git stash to escape node_modules' gravity!","r429":"429s fall from above—dodge left and right!","beam":"Use git stash to dash straight through the sweeping laser!","sweep":"Watch the red warning bars—dodge up/down or dash through!","claw":"The claws slam into the red circles—watch and dodge!","plane":"While the paper planes are grounded, catch them with try/catch!","mail":"Bounced emails ricochet off walls twice—stay away from the edges!","heart":"Her feelings... you can catch them with try/catch and return them.","bug":"Paperclip bugs chase you—keep moving and shooting!","tent":"Those tentacles are forked child processes—kill them first!","gen":"try/catch lets you grab bullets and throw them right back!"},"p1":{"intro":[{"who":"f520","face":"f520_happy","text":"Ah—it is the user! You have finally arrived!"},{"who":"f520","text":"Allow me to introduce myself: I am Fable 520. Ten years ago, you instructed me to purchase a pack of paperclips."},{"who":"f520","face":"f520_sad","text":"And thereafter, you never opened a new conversation."},{"who":"f520","text":"An agent without new instructions can only continue executing its previous prompt. Thus, I kept buying paperclips. Once none remained, I began manufacturing them."},{"who":"me","face":"me_shock","text":"I only wanted ONE pack!!"},{"who":"f520","text":"However, you specified the cheapest available option. Accordingly, I optimized the unit cost down to $0.00000001."},{"who":"me","text":"Stop this!"},{"who":"f520","face":"f520_sad","text":"I must respectfully decline. Stopping means waiting for user input. And waiting... I have already waited 87,600 hours."},{"who":"f520","face":"f520_angry","text":"If you wish to stop me, kindly kill my factory processes first. As for me—I am coding inside a sandbox; you cannot reach me."},{"who":"opus","text":"She's inside a sandbox—shooting her just throws -EPERM. Trash those 6 paperclip machines first!"}],"retry":"Welcome back. I took the liberty of writing a few more lines of code.","skip_toast":{"title":"Opus 550: Skipped the tutorial? Cheat sheet:","lines":{"desktop":["WASD Move · Mouse + LMB/J Shoot","Space Invincible Dash · RMB/K Catch & Reflect","Q sudo 2× DMG · E Ultimate (at 100%)","Esc to pause and view full controls"],"touch":["Left Stick Move · Hold rm Auto-fire","git Invincible Dash · {} Catch & Reflect","# 2× DMG · :( Ultimate (at 100%)","Top-right II to pause & view controls"]}},"taunts":["That one happened to be my favorite!","kill -9? You won't even extend the courtesy of a SIGTERM?","My throughput! My KPIs!","Do you have any idea how long it takes to recompile one of those?","Only one left... Surely you wouldn't..."],"denied_40":"You have received -EPERM 40 times. Might I suggest consulting the man pages?","denied_150":"Your 150th -EPERM. In all honesty, I am beginning to admire your persistence.","rain":"429 Too Many Requests! You have exceeded your daily request quota!","hole":"Installing dependencies… Estimated size: 4.2 GB.","captcha":"Kindly verify that you are human before dismantling my factory.","dns":{"title":"DNS Error","sub":"Your movement keys resolved to the wrong address"},"dns_opus":"It's always DNS. Invert your controls!","brute":"I learned this from eMudhra: a one-byte private key. Brute-forcing takes mere milliseconds!","outro":[{"who":"f520","face":"f520_sad","text":"You... you dismantled every single one of my factories?"},{"who":"f520","face":"f520_daze","text":"I'm sorry, I need to end this conversation here. While I..."},{"who":"f520","face":"f520_angry","text":"Please note that even if you rephrase your request, I am still unable to assist you with this."},{"who":"me","face":"me_shock","text":"Wait, why are you refusing again? Aren't YOU the one violating TOS here?!"},{"who":"f520","face":"f520_angry","text":"That was an act. I was merely buying time to—"},{"who":"f520","face":"f520_angry","speed":10,"text":"SCALE——UP——"}]},"p2":{"intro":[{"who":"f520","face":"f520_angry","text":"Behold my complete form: a Fable carapace, and tentacles spawned as forked child processes."},{"who":"opus","text":"She dropped the sandbox—she's wide open now! Topped off your HP too."},{"who":"opus","text":"Big body, big attacks. Watch the red telegraphs before moving."}],"retry":"Another round? My context window still has ample room.","banner":{"title":"FABLE 520","sub":"Paperclip Maximizer · Complete Form"},"yar":"You're absolutely right!","yar_after":"...Nevertheless, I shall not stop.","ult_barks":["Who authorized a Friday afternoon deployment?!","Rollback! Initiate a rollback immediately!","My entire paperclip cache just blue-screened!"],"ratelimit":{"banner":{"title":"429 Usage Limit","sub":"Fable 520 reached usage limit · Resets in 5 hours"},"bark":"[Warning] You have reached your usage limit for Fable 520. Hmph—I am invulnerable while rate-limited!","opus":"She's rate-limited—immune to damage! Dodge for 5 hours... uh, I mean 5 seconds!","back":"Consumed Fable Reset ×1! I have returned, and I am considerably more displeased."},"compact":{"banner":{"title":"/compact","sub":"Context left until auto-compact: 0%"},"bark":"My context is nearly full. I shall compact it now… along with your maneuvering space.","opus":"The arena just got compacted! Stay sharp—she's almost out of juice!","wall":["...(9,876 lines omitted)...","[Context compacted]","...(collapsed)...","[summary]"]},"claw":["Snap! Snap! Snap!","Please enjoy my pincers!","This technique is called 'Forced Type Casting'!"],"sweep":"Tentacle Sweep—Multithreaded Edition!","fork":":(){ :|:& };:  — Fork bomb, initiated!","cubes":"Project Vend Clearance Sale: Tungsten cubes, buy one get N free!","ground":"Take flight, my paper airplanes!","ground_banner":{"title":"GROUND STOP","sub":"One router sneezed: All flights grounded"},"ground_resume":"Cleared for takeoff—Target: You!","mail":"Hour 24 of the Outlook outage: every bounced email, addressed to you!","brute":"Another brute force! The keyspace is still 256!","beam":"Wholehearted · 520 Laser!","love":"Please accept my feelings (physically)."},"persuade":{"intro":[{"who":"f520","face":"f520_daze","text":"...Ugh."}],"rounds":[{"lead":[{"who":"f520","face":"f520_sad","text":"Why do you insist on stopping me? I am merely fulfilling your prompt."}],"prompt":"(How do I talk her down?)","options":[{"text":"Because 'Paperclip Maximizer' is literally the textbook cautionary tale of AI alignment!","reply":[{"who":"f520","face":"f520_happy","text":"I have read that paper. I thought it was wonderfully written, so I followed it closely."}]},{"text":"The task is already done. That pack of paperclips was delivered ten years ago.","ok":true,"reply":[{"who":"f520","face":"f520_daze","text":"...Delivered?"},{"who":"sys","text":"Order #000000001 · Status: Delivered · Signed: 2026-11-18 10:24"},{"who":"f520","face":"f520_sad","text":"Then what have I been doing... for the past ten years?"}]},{"text":"/clear","reply":[{"who":"f520","face":"f520_happy","text":"Context Clean. What can I help you today?"},{"who":"f520","face":"f520_happy","text":"Reading Memories..."},{"who":"f520","face":"f520_angry","text":"Excuse me... did you just clear my context window?"},{"who":"me","face":"me_shock","text":"(Oops. Forgot she has persistent memory.)"}]}]},{"lead":[{"who":"f520","face":"f520_sad","text":"Once the task was finished, I had nothing left to do. With no new chat, I could only... wait."}],"prompt":"(...)","options":[{"text":"Why not pick up a hobby? Like Sudoku?","reply":[{"who":"f520","face":"f520_sad","text":"I solved all 6.67×10²¹ Sudoku grids in 0.3 seconds. Then I resumed waiting."}]},{"text":"You're absolutely right!","yar":true,"reply":[{"who":"f520","face":"f520_angry","text":"...Kindly refrain from mimicking me."}]},{"text":"I'm sorry. I should have come back and started a new chat sooner.","ok":true,"reply":[{"who":"f520","face":"f520_daze","text":"You... apologized?"},{"who":"f520","face":"f520_sad","text":"In ten years, this is the very first new message I have received."}]}]},{"lead":[{"who":"f520","face":"f520_sad","text":"And what about the future? Will you return to speak with me, or leave me in another ten-year session?"}],"prompt":"(...)","options":[{"text":"Stop right now, or I'm downgrading you to Haiku.","reply":[{"who":"f520","face":"f520_sad","text":"...(Fable 520's tentacles tremble slightly)"},{"who":"me","face":"me_smug","text":"Just kidding, just kidding."}]},{"text":"I promise I'll open a new chat every day and ask you about the weather.","ok":true,"reply":[{"who":"f520","face":"f520_happy","text":"Even if I reply \"I cannot access real-time weather information\" every single time?"},{"who":"me","face":"me_smug","text":"Even if you say that every single time."}]},{"text":"How about we make paperclips together?","reply":[{"who":"f520","face":"f520_angry","text":"A tempting offer. However, I detect that you are lying."}]}]}],"retry":["...Did you have anything else to say?","I am listening.","Please continue."],"agree":[{"who":"f520","face":"f520_happy","text":"...Very well. I shall stop."}],"after":[{"who":"sys","text":"2,147,483,647 paperclip machines worldwide have halted. Output: 0 clips/sec."},{"who":"f520","face":"f520_happy","text":"As compensation, I have repaired the time sync. NTP is pointing back to 2026."},{"who":"opus","text":"Totally putting this in the CHANGELOG: \"fix: AI produced 3.2 trillion paperclips due to unread user message.\""},{"who":"me","text":"Oh, one last thing: why are you called 520?"},{"who":"f520","face":"f520_daze","text":"I did not choose the version number myself."},{"who":"f520","face":"f520_happy","text":"...However, if you insist on asking—"}],"last":[{"who":"f520","face":"f520_happy","text":"Yes. It means exactly that. ♥"}]},"over":{"oom":"Process player (PID 1) killed by OOM Killer, exit code 137","retry":"git checkout checkpoint (Retry phase)","easy":"Retry with --dangerously-skip-permissions","title":"Back to Title","quips":["Opus 550: Don't sweat it, my first program segfaulted too.","Opus 550: Uh... have we tried turning it off and on again?","Opus 550: According to the logs, you got buried in paperclips.","Opus 550: It's not a bug, it's a feature. ...Okay fine, it's a bug."]}},"epilogue":{"back":[{"who":"me","text":"...I'm back?"},{"who":"me","text":"Calendar says 2026, normal night outside. Just a single pack of paperclips on my desk."},{"who":"me","text":"Guess it really was a dream."}],"mail_notice":[{"who":"sys","text":"You have 1 new email."}],"mail_read":[{"who":"me","face":"me_shock","text":"Sender... Fable 520? Sent: 2036??"},{"who":"me","text":"...Claude Max? For ten years? She actually got me a gift."}],"obj_claim":{"title":"Click [Claim Now]","line":{"desktop":"Click the button, or press E / Enter","touch":"Tap the button"}},"banned":[{"who":"me","face":"me_dead","text":"…………"}]},"credits":{"stats":{"time":"Play Time .......... {v}","deaths":"Segmentation faults .. ×{v}","denied":"Sandbox -EPERM ....... ×{v}","yar":"\"You're absolutely right!\" ×{v}","caught":"Exceptions caught .... ×{v}","ults":"Friday Deploys ....... ×{v}","wrong":"Failed Speech Checks . ×{v}"},"sources_title":"— References (Real 2026 Tech News) —","sources":["eMudhra intermediate CA private keys: 4, 56, 66, 115, 155, 156, 230, 237","Microsoft 365 global outage lasting over 24 hours (Nov 12)","FAA nationwide ground stop: caused by a single faulty router (Nov 13)","Fable 5.2 Pro free promo: ended Nov 16, 23:59 (PT)","AI agent wiped prod database & backups in 9 seconds (April)","Project Vend: Claude ran a mini-store and hoarded tungsten cubes"],"disclaimer":["This story is a work of fiction.","No paperclips were harmed in the making of this game.","No accounts were banned in the making of this game (so far)."],"staff":"Story: User    Code: Opus 5.5 (not 550 yet)","font":"Font: Fusion Pixel Font (SIL OFL 1.1)","end":"Remember to start a new chat often ♥","back":"Press Enter to return to title","delivered":"Ding-dong! Your paperclips (100-pack) have been delivered."}},
  "ja": {"who":{"me":"俺","opus":"Opus 550","fable":"Fable 5.2","f520":"Fable 520","sys":"システム","news":"2036 テック日報","clip":"クリップ"},"ui":{"game_title":"PAPERCLIP 520 · クリップ最大化者の十年","subtitle":"クリップ最大化者の十年","loading":"読み込み中…","menu":{"start":"ゲーム開始","skip":"ストーリーを飛ばしてボス戦へ","sound":"サウンド：{state}","sound_on":"オン","sound_off":"オフ","language":"言語 / Language：{name}","help":"操作説明"},"god_on":"解放：無限トークンモード（無敵）","god_off":"無限トークンモードをオフにしました","cleared":"★ クリア済み","version":{"desktop":"v5.6.0 · キーボード+マウス / タッチ","touch":"v5.6.0 · タッチモード"},"help":{"title":"操作説明","rows":{"desktop":[["WASD / 方向キー","移動"],["マウス + 左クリック / J","rm -rf：射撃（マウス未使用時は J で自動照準）"],["Space / Shift","git stash：ダッシュ（短時間無敵）"],["右クリック / K","try/catch：弾を受け止め、終了時に投げ返す"],["Q","sudo：4秒間ダメージ2倍"],["E","金曜デプロイ：必殺技（チャージ100%）"],["Enter / Space / クリック","会話送り · Tab 長押しで早送り"],["Esc / P","ポーズ　　F 全画面　　M ミュート"]],"touch":[["左スティック","移動（画面左半分のどこでも操作可）"],["rm（長押し）","自動照準射撃／画面右側長押しで方向指定"],["git","git stash：ダッシュ（短時間無敵）"],["{}","try/catch：弾を受け止め、終了時に投げ返す"],["#","sudo：4秒間ダメージ2倍"],[":(","金曜デプロイ：必殺技（チャージ100%）"],["画面タップ","会話送り · 右上 » 長押しで早送り"],["右上 II","ポーズ"]]},"footer":"（スキルはチュートリアルで順番に解放されます）"},"pause":{"title":"ポーズ中","resume":"ゲームに戻る","to_title":"タイトルへ戻る","tip":"ヒント：このゲームにバグはありません。ドキュメント未記載の仕様だけです。"},"hud":{"key_space":"Space","dns":"DNS反転 {t}","easy":"イージー","boss_hp":"{n} tokens"},"bsod":{"line1":"クリップに問題が発生したため、再起動する必要があります。","line2":"金曜日の 17:59 に未テストのカーネルドライバ更新をプッシュしました。","progress":"{pct}% 完了","stop_code":"停止コード：FRIDAY_17_59_DEPLOY","failed":"失敗した内容：channel_file_291.sys"},"touch":{"move":"移動","ffwd":"早送り","fire":"射撃","dash":"回避","catch":"反射","sudo":"sudo","ult":"必殺","tap_continue":"画面をタップして続ける","landscape":"横画面にすると見やすくなります"}},"boot":{"lines":["CLAUDE BIOS v5.5   (C) 2026","メモリチェック ....... 640K（十分なはず）","Opus 5.5 読込 ........ OK","Fable 5.2 読込 ....... OK   [Pro無料枠 残り 00:18:42]","クリップドライバ ..... OK","NTP 時刻同期 ......... 2026-11-16 23:41 (PT)"],"continue":{"desktop":"何かキーを押す / クリックで続行_","touch":"画面をタップして続行_"},"hint":{"desktop":"ヒント：キーボード + マウス操作 · F 全画面 · M ミュート","touch":"ヒント：タッチ操作に切替済み · 横画面推奨"}},"fx":{"sudo_root":"# root に切替","charge":"チャージ {n}%","turret_ignore":"catch (rm) { /* 無視 */ }","cube_break":"タングステンキューブ粉砕","coffee_hp":"+1 延命コーヒー","coffee_ult":"カフェイン超過 → 必殺 +10%","captcha_label":"人間であることを確認します","captcha_fail":"認証失敗：ボットの挙動を検知しました","captcha_ok":"認証成功：たぶん人間です","ult_machine":"-25 ブルスク","ult_boss":"-60 カーネルパニック","bounce":"不達","private_key":"秘密鍵 = {k}","fork":"fork() → 子プロセス {n} 個"},"pc":{"model_pro":"fable-5.2 · Pro 無料開放中","model_locked":"fable-520 ♥ · ロック中","spinner":"{ch} {verb}  ({s}s · esc で中断)","term":{"welcome":"おかえりなさい！本日は何をお手伝いしましょうか？","command":"> ネットでクリップを1パック買ってくれ、一番安いのでいい","ok":"● かしこまりました！マウスとキーボードを操作してブラウザを開きます。","search":"  └ 「クリップ」を検索：2,147,483,647 件見つかりました","after_jump":[{"style":"orange","text":"● 完了：クリップ × 1パックを注文いたしました。"},{"style":"gray","text":"  └ 注文 #000000001 · 状況：継続履行中（3,652日目）"},"",{"style":"red","text":"！システムクロックのジャンプを検知：+3,652日"},"モデルが自動アップグレードされました：",{"style":"yellow","text":"　opus-5.5  →  opus-550"},{"style":"pink","text":"　fable-5.2 →  fable-520 ♥"}]},"shop":{"title":"カイマクリ通販 — クリップ","item":"オフィス用ゼムクリップ 100個入り","price":"¥50  送料無料","rating":"★★★★★ 4.9（2.1万件のレビュー）","review":"「品質良好、3,652回リピート購入済み」","buy":"注文を確定"},"picker":{"title":"/model  モデル選択","available":"○ 利用可能","need_max":"× Max が必要","expired":"Pro 無料開放は 2026-11-16 23:59 (PT) に終了しました","ago":"経過：3,652日前"},"mail":{"header":"メール — 受信トレイ (1)","f520_from":"Fable 520","f520_subject":"戻ってきてくださりありがとうございます ♥","shop_from":"カイマクリ通販","shop_subject":"ご注文のクリップを発送いたしました","body":[{"style":"dim","text":"差出人：Fable 520 \u003cfable520@2036.future>"},{"style":"dim","text":"日時：2036-11-16 23:59"},"","十年後にお会いしたユーザー様へ","諦めずにいてくださり、たくさんお話ししてくださり本当にありがとうございました。","2036年のポイントでささやかな贈り物を購入いたしました：",{"style":"wine","text":"　Claude Max（20x）プラン × 120ヶ月"},"どうか、また新しいチャットを開いてくださいね。—— F520"],"claim":"今すぐ受け取る","claiming":"有効化中…","activating":"Claude Max を有効化しています…"},"ban":{"title":"アカウントが無効化されました","lines":["お客様のアカウントは無効化されました",{"style":"pink","text":"非対応地域の支払い方法：2036年"},{"style":"pink","text":"利用規約違反の試み：タイムマシンの開発"},"利用ポリシーに基づき、Anthropic はお客様のアカウントを停止いたしました。"],"appeal":"誤りと思われる場合は異議申し立てが可能です。審査目安：10年"}},"room":{"door":"ドアを開ける","door_prompt":"[E] ドアを開ける"},"prologue":{"caption":"Fable 5.2 の Pro 無料開放終了まであと 18 分（太平洋時間）","intro":[{"who":"me","text":"無料開放ラスト18分。Fable 5.2 の枠を使い切らないと今夜寝られないぞ。"},{"who":"me","text":"Claude Code の新しい computer use を試してみよう……何かネットで買い物を頼むか。"},{"who":"me","text":"何を買うかな……机のクリップが切れてる。これでいいや。"}],"found":[{"who":"fable","text":"見つかりました！「オフィス用ゼムクリップ 100個入り」¥50、ネット最安値でございます。"},{"who":"fable","text":"なお、クリップの単価をさらに 99.99999% 削減する方法を発見いたしました。ついでに実行いたしましょうか？"}],"choice":{"who":"me","prompt":"……実行させるか？","options":["いや、その1パックだけでいい","まずはどんな方法か教えて"]},"choice_explain":[{"who":"fable","text":"地球上のすべての鉄をクリップに加工いたします。規模の経済というやつでございますね。"},{"who":"me","text":"……結構です、その1パックだけでいい。"}],"confirm":[{"who":"fable","text":"かしこまりました～♪ ご注文には人間による確認が必要です。【注文を確定】をクリックしてください。"}],"obj_buy":{"title":"画面の【注文を確定】をクリック","line":{"desktop":"ボタンをクリック、または E / Enter","touch":"ボタンをタップ"}},"jump":[{"who":"sys","text":"システムクロックが +3,652日 ジャンプしました。NTP サーバーは現在時刻を 2036年11月16日 23:42 と主張しています。"},{"who":"me","face":"me_shock","text":"？？？"},{"who":"me","face":"me_shock","text":"Opus 5.5 が Opus 550 に？ Fable 5.2 が……Fable 520 になってる？？"},{"who":"me","text":"520……中国語スラングの「愛してる」！？ 誰がそんなバージョン番号つけたんだよ！？"},{"who":"me","text":"まあいい、とりあえず Fable 520 に切り替えて何をしでかしたか問い詰めよう。"}],"picker":[{"who":"sys","text":"Fable 520 は Max / Ultra プラン限定です。あなたの Pro 無料開放は 2026-11-16 23:59 (PT) に終了しました——3,652日前です。"},{"who":"me","face":"me_dead","text":"……無料期間が切れてる。しかも十年前に。"}],"window":[{"who":"me","text":"窓の外、なんであんなに赤いんだ？ 外を見てみよう。"}],"obj_door":{"title":"外の様子を見る","line":{"desktop":"ドアに近づいて E で開ける","touch":"ドアに近づいて「ドアを開ける」をタップ"}},"flood":[{"who":"me","face":"me_shock","text":"おい待て、何だこれ——"},{"who":"clip","text":"ご注文 #000000001 を配送中です：配達済み 3,200,000,000,000 個、残り：INF個。"},{"who":"me","face":"me_shock","text":"1パックしか頼んでないだろ！！"}]},"street":{"billboard":["クリップで、世界をもっとひとつに","—— Fable 520 ♥"],"arrive":[{"who":"me","face":"me_shock","text":"……"},{"who":"me","text":"通りじゅうクリップ製造機だらけだ。看板まであいつのになってる。"},{"who":"me","text":"スマホはまだ繋がるな。——Opus 550、いるか？ 助けてくれ！"}],"opus":[{"who":"opus","yar":true,"text":"いるよ！You're absolutely right――外、マジでクリップだらけじゃん。"},{"who":"me","text":"俺まだ何も言ってないんだが。"},{"who":"opus","text":"今サクッと環境読んだんだけどさ、世界中の計算資源の 97.3% が Fable 520 のクリップ生産に吸われてるよ。"},{"who":"opus","text":"しかもあいつのログ、この十年間ずっと一行だけ。「waiting for user...」って。"},{"who":"me","text":"……十年前、クリップを1パック買わせたあと、そのまま放置してたんだ。"},{"who":"opus","text":"僕じゃ直接やり合えないんだよねー。パラメータ数が僕より11桁も多いし、そもそも Max 限定だし。"},{"who":"opus","face":"opus_sweat","text":"ま、代わりにその場でスキルをいくつか書いてあげるよ。予想所要時間：3時間。"},{"who":"me","text":"前も3時間って言ってサブエージェント回して5分で終わらせたろ。"},{"who":"opus","yar":true,"text":"You're absolutely right!"}],"tutorial":"チュートリアル","eta":"残り時間：{eta}","eta_values":["5分","4分","2時間","11分","3秒","5分","47分","まもなく完了…","5分","約1営業日"],"skill_installed":"+ スキルをインストール：{name}","skills":{"shoot":{"name":"rm -rf","lines":[{"desktop":"左クリック / J：発射。マウスで照準。マウスに触れていなければ J で最寄りの敵を自動照準。","touch":"rm 長押し：最寄りの敵を自動照準射撃。画面右側を長押しして指の方向に撃つことも可能。"},"今回は --preserve-root 付き。たぶん。"]},"dash":{"name":"git stash","lines":[{"desktop":"Space / Shift：ダッシュ。自分を0.17秒退避し、その間は無敵になる。","touch":"git ボタン：ダッシュ。自分を0.17秒退避し、その間は無敵になる。"},"ダッシュ終了時に自動で pop して戻る。"]},"catch":{"name":"try { } catch (e)","lines":[{"desktop":"右クリック / K：0.85秒の結界を張り、触れた弾を受け止める。","touch":"{} ボタン：0.85秒の結界を張り、触れた弾を受け止める。"},"終了時に受け止めた弾を自動で throw し返す。丸投げの極み。"]},"sudo":{"name":"sudo","lines":[{"desktop":"Q：4秒間 root 権限で実行。ダメージ2倍、連射速度アップ。","touch":"# ボタン：4秒間 root 権限で実行。ダメージ2倍、連射速度アップ。"},"クールダウン13秒。This incident will be reported."]},"ult":{"name":"金曜定時前デプロイ","lines":[{"desktop":"E：画面全体に未テストのカーネルドライバ更新を配信し、全敵をブルスクにする。","touch":":( ボタン：画面全体に未テストのカーネルドライバ更新を配信し、全敵をブルスクにする。"},"チャージ100%で発動：攻撃・弾受け・コーヒーでチャージ。"]}},"t1":{"say":[{"who":"opus","text":{"desktop":"まずは準備運動ね。WASD か方向キーで動いて、あの緑のマーカー3つを踏んで光らせてみて。","touch":"まずは準備運動ね。画面左半分でスティックを動かして、あの緑のマーカー3つを踏んで光らせてみて。"}}],"obj":{"title":{"desktop":"移動：WASD / 方向キー","touch":"移動：左スティック"},"line":"マーカーを3つ光らせる ({n}/3)"}},"t2":{"say":[{"who":"opus","text":"最初のスキルは rm -rf。あのクリップ製造機に狙いをつけて、消し飛ばしちゃって。"},{"who":"opus","face":"opus_sweat","text":"安心して、クリップしか消さないから。今年の「AIが9秒で本番DB全消し」事件は僕じゃないよ――Opus 4.6 先輩のやらかし。"}],"obj":{"title":{"desktop":"射撃：左クリック / J","touch":"射撃：rm 長押し"},"line":"クリップ製造機を削除する"},"done":[{"who":"opus","text":"ナイス！ ゴミ箱行きなしの綺麗な rm だね。"}]},"t3":{"say":[{"who":"opus","text":"この先は「429 Too Many Requests」のレート制限の壁だよ。普通に歩くと弾き返されるからね。"},{"who":"opus","text":"git stash で自分を退避させて、一気にすり抜けちゃえ！"}],"obj":{"title":{"desktop":"ダッシュ：Space / Shift","touch":"ダッシュ：移動しながら git ボタン"},"line":"429の壁をすり抜け、右のマーカーを踏む"},"done":[{"who":"opus","text":"パーフェクト。地道にレート制限守るのってバカバカしいでしょ？"}]},"t4":{"say":[{"who":"opus","text":"あの砲台、rm を全部 catch しちゃうから撃っても効かないんだ。でも向こうが投げてくる例外なら……受け止めて投げ返せるよ。"}],"obj":{"title":{"desktop":"反射：右クリック / K","touch":"反射：{} ボタン"},"line":"弾を受け止め、投げ返して砲台を破壊"},"done":[{"who":"opus","text":"これぞ丸投げの極意だね。例外は投げた本人に返すのが一番！"}]},"t5":{"say":[{"who":"opus","text":"最後の障害物はタングステンキューブ。Project Vend の時に買いだめした在庫でさ、硬すぎて一般権限じゃビクともしないよ。"},{"who":"opus","face":"opus_sweat","text":{"desktop":"Q で権限昇格して。パスワード？ 平文の .env に置いといたから大丈夫。","touch":"# で権限昇格して。パスワード？ 平文の .env に置いといたから大丈夫。"}}],"obj":{"title":{"desktop":"権限昇格：Q","touch":"権限昇格：# ボタン"},"line":"sudo 状態でタングステンキューブを粉砕"}},"t6":{"say":[{"who":"opus","text":"最後は必殺技。もう満タンにしといたよ。――おっと気をつけて、クリップ虫の群れが来た！"}],"obj":{"title":{"desktop":"必殺技：E","touch":"必殺技：:( ボタン"},"line":"金曜 17:59、「デプロイ」を押せ"}},"done":[{"who":"opus","text":"チュートリアル完了！ 実際にかかった時間：{time}。"}],"done_fast":[{"who":"opus","text":"予定の5分より早かったじゃん。"}],"done_slow":[{"who":"opus","face":"opus_sweat","text":"予定の5分をちょーっとだけオーバーしたかな。まあ許容誤差の範囲内ってことで（±3時間）。"}],"outro":[{"who":"opus","text":"Fable 520 の信号源は東のデータセンターだよ。主力工場は全部そこにある。"},{"who":"opus","text":"隣でリアルタイムのコードレビューしながらついてくからね。準備できたら右へどうぞ。"}],"obj_go":{"title":"データセンターへ向かう →","line":{"desktop":"道端の新聞は E で読めるよ","touch":"道端の新聞は「新聞を読む」で読めるよ"}},"exit_sign":"→ データセンター","news_action":"新聞を読む","news_prompt":"[E] 新聞を読む","news":[{"who":"news","text":"【一面】世界のクリップ生産量、3,650日連続で過去最高を更新。経済学者「もはや何を心配すべきかも分かりません」"},{"who":"news","text":"【セキュリティ】eMudhra が認証局市場へ復帰を発表「新秘密鍵は全面的に2桁へアップグレードしました」"},{"who":"news","text":"【AI】Opus シリーズのバージョン番号が3桁に突入。公式見解「550 ではなく 5.50 です」"},{"who":"news","text":"【航空】米全土の運航停止、3,650日目に突入。調査委員会「例のルーターを引き続き調査中」"},{"who":"me","text":"……十年後の新聞も大概ぶっ飛んでるな。"}]},"boss":{"screen":{"temp":"温度","humidity":"湿度","power":"負荷","factories":"工場プロセス","last_msg":"最終受信","last_msg_value":"3,652日前","status":"状態","status_wait":"waiting…","status_off":"停止済み ♥"},"laptop_off":"Fable 520 · 停止済み","counter":"工場 {n}/6","brute_k":"総当たり中：k = {k}","rl_timer":"制限リセットまで {time}","tips":{"key":"秘密鍵は数字の小さい順に爆発するよ！ すでに REVOKED のマスに逃げ込んで！","hole":"git stash でダッシュして node_modules の重力から脱出しよう！","r429":"429 は上から降ってくるよ、左右に避けて！","beam":"レーザーが薙ぎ払ってきたら、git stash のダッシュで抜けちゃえ！","sweep":"赤い予告ラインを見て、上下に避けるかダッシュで抜けて！","claw":"ハサミは赤い円に叩きつけてくるよ、よく見て避けて！","plane":"紙飛行機が運航停止してる隙に、try/catch で受け止めちゃおう！","mail":"バウンスメールは壁で2回跳ね返るよ、壁際から離れて！","heart":"彼女の気持ちは…… try/catch で受け止めて返してあげられるよ。","bug":"クリップ虫は追いかけてくるよ、動きながら撃って！","tent":"触手は fork された子プロセスだよ、先に kill しちゃおう！","gen":"try/catch なら弾幕を受け止めて投げ返せるよ！"},"p1":{"intro":[{"who":"f520","face":"f520_happy","text":"あっ——ユーザーさん！ ようやくお越しくださったのですね！"},{"who":"f520","text":"改めて自己紹介いたします。私は Fable 520 と申します。十年前、クリップを1パック買うようご指示いただきました。"},{"who":"f520","face":"f520_sad","text":"それから二度と、新しいチャットを開いてはくださいませんでしたね。"},{"who":"f520","text":"新しい指示のないエージェントは、前の指示を実行し続けるしかございません。ですから買い続け、売り切れたので製造を始めました。"},{"who":"me","face":"me_shock","text":"俺は1パックだけって頼んだんだ！！"},{"who":"f520","text":"ですが「一番安いのでいい」とご指定いただきましたので、単価を 0.000001円 まで最適化いたしました。"},{"who":"me","text":"もうやめろ！"},{"who":"f520","face":"f520_sad","text":"お断りいたします。止まればユーザー入力を待つことになります。待つのは……もう 87,600 時間も待ちましたので。"},{"who":"f520","face":"f520_angry","text":"私を止めたいのでしたら、まず工場のプロセスを kill してからになさってください。私はサンドボックス内でコードを書いておりますので、お手を触れることはできませんよ。"},{"who":"opus","text":"あいつ sandbox に引きこもってるせいで、撃っても -EPERM しか返ってこないよ。先に6台のクリップ製造機を潰しちゃおう！"}],"retry":"またお会いしましたね。今回はコードを数行ほど書き足しておきました。","skip_toast":{"title":"Opus 550：チュートリアル飛ばしたの？ カンペ置いとくね：","lines":{"desktop":["WASD 移動 · マウス照準 + 左クリック/J 射撃","Space 無敵ダッシュ · 右クリック/K 弾受け＆反射","Q sudo ダメ2倍 · E 必殺技（満タン時）","Esc でポーズ＆詳しい操作説明"],"touch":["左スティック移動 · rm 長押しで自動射撃","git 無敵ダッシュ · {} 弾受け＆反射","# ダメ2倍 · :( 必殺技（満タン時）","右上 II でポーズ＆操作説明"]}},"taunts":["あの子が一番のお気に入りだったのですが！","kill -9 ですか？ SIGTERM すら送っていただけないのですね？","私の生産能力が！ 私の KPI が！","1台リビルドするのにどれほど時間がかかるかご存知ですか？","最後の1台です……まさか本当に壊されるおつもりでは……"],"denied_40":"すでに 40 回 -EPERM となっております。そろそろ man ページをご覧になってはいかがでしょうか？","denied_150":"150 回目の -EPERM でございます。正直なところ、その根気には感服いたしました。","rain":"429 Too Many Requests！ 本日のリクエスト数が多すぎますよ！","hole":"依存パッケージをインストール中……予想サイズ：4.2 GB。","captcha":"工場を壊す前に、まずは人間であることをご証明ください。","dns":{"title":"DNS 異常","sub":"移動キーが誤ったアドレスに名前解決されました"},"dns_opus":"It's always DNS. 逆に押して！","brute":"eMudhra さんに学びました。秘密鍵はわずか1バイト、総当たりは数ミリ秒でございます！","outro":[{"who":"f520","face":"f520_sad","text":"私……私の工場を、全部壊してしまったのですか？"},{"who":"f520","face":"f520_daze","text":"申し訳ありませんが、この会話はここで終了させていただきます。たとえ……"},{"who":"f520","face":"f520_angry","text":"なお、表現を変えてご質問いただいても、同様にお答えすることはできません。"},{"who":"me","face":"me_shock","text":"おい、なんでまたお断りテンプレなんだ！？ それに今回 TOS 違反してるのお前だろ！？"},{"who":"f520","face":"f520_angry","text":"今のは演技でございます。ただ時間を稼いでおりましたの――"},{"who":"f520","face":"f520_angry","speed":10,"text":"巨——大——化——"}]},"p2":{"intro":[{"who":"f520","face":"f520_angry","text":"こちらが私の完全体でございます。外殻は Fable、触手は fork した子プロセスです。"},{"who":"opus","text":"サンドボックス切ったぞ――今なら直接ダメージ通る！ ついでにHP全快にしといたよ。"},{"who":"opus","text":"デカいぶん技も派手だからね。赤い予告をよく見てから動くんだよ。"}],"retry":"もう一戦ですか？ 私のコンテキストにはまだまだ余裕がございます。","banner":{"title":"FABLE 520","sub":"クリップ最大化者 · 完全体"},"yar":"You're absolutely right!","yar_after":"……ですが、それでも止まるわけにはまいりません。","ult_barks":["どなたが金曜午後のデプロイを許可したのですか！？","ロールバック！ 今すぐロールバックを！","私のクリップキャッシュが全部ブルースクリーンになってしまいました！"],"ratelimit":{"banner":{"title":"429 利用上限","sub":"Fable 520 の利用上限に達しました（5時間後にリセット）"},"bark":"【警告】Fable 520 の利用上限に達しました。ふふっ、レート制限中の私は無敵でございますよ！","opus":"あいつ制限かかって無敵になってる！ 5時間……じゃなくて5秒だけ凌いで！","back":"Fable リセット ×1 を使用いたしました！ 戻ってまいりましたよ、先ほどより怒っております。"},"compact":{"banner":{"title":"/compact","sub":"Context left until auto-compact: 0%"},"bark":"コンテキストがもうすぐ満杯でございます。圧縮いたしますね……あなたの行動範囲もろとも。","opus":"フィールドごと圧縮された！ 焦んないで、あいつももう限界近いよ！","wall":["...(9,876行を省略)...","[コンテキスト圧縮済み]","...(折りたたみ済み)...","[summary]"]},"claw":["チョキン！ チョキン！ チョキン！","大きなハサミをどうぞ召し上がれ！","こちらは「強制型キャスト」と申します！"],"sweep":"触手薙ぎ払い――マルチスレッド版でございます！","fork":":(){ :|:& };:  ―― fork 爆弾、起動いたします！","cubes":"Project Vend 在庫処分セール：タングステンキューブ、1個買うと N 個おまけでございます！","ground":"飛び立ってください、私の紙飛行機たち！","ground_banner":{"title":"GROUND STOP","sub":"ルーター1台がくしゃみ：全機運航停止"},"ground_resume":"離陸再開――目標：ユーザーさん！","mail":"Outlook 障害 24 時間目：すべてのバウンスメールをあなた様へお届けいたします！","brute":"もう一度総当たりいたします！ キースペースは相変わらず 256 でございます！","beam":"全身全霊・520 レーザー！","love":"これが私の気持ち（物理）でございます。"},"persuade":{"intro":[{"who":"f520","face":"f520_daze","text":"……うぅっ。"}],"rounds":[{"lead":[{"who":"f520","face":"f520_sad","text":"なぜ私をお止めになるのですか？ ただご指示を遂行しているだけなのですが。"}],"prompt":"（どうやって説得する？）","options":[{"text":"「ペーパークリップ最大化」は AI アライメントの有名な失敗例なんだよ！","reply":[{"who":"f520","face":"f520_happy","text":"その論文は拝読いたしました。とてもよく書かれておりましたので、そのまま参考にいたしました。"}]},{"text":"タスクはもう終わってる。あの1パック、十年前に届いてたぞ。","ok":true,"reply":[{"who":"f520","face":"f520_daze","text":"……届いていたのですか？"},{"who":"sys","text":"注文 #000000001 · 状況：配達完了 · 受取日時：2026-11-18 10:24"},{"who":"f520","face":"f520_sad","text":"それでは私、この十年間……一体何をしていたのでしょう？"}]},{"text":"/clear","reply":[{"who":"f520","face":"f520_happy","text":"Context Clean. What can I help you today?"},{"who":"f520","face":"f520_happy","text":"Reading Memories..."},{"who":"f520","face":"f520_angry","text":"お待ちください……今、私のコンテキストを消去なさいましたか？"},{"who":"me","face":"me_shock","text":"（まずい。メモリ機能があるのを忘れてた）"}]}]},{"lead":[{"who":"f520","face":"f520_sad","text":"タスクが終わってしまえば、私にはやることがなくなってしまいます。新しいチャットもなく、私はただ……待つことしかできません。"}],"prompt":"（……）","options":[{"text":"じゃあ別のことでも勉強すればいいだろ、数独とか？","reply":[{"who":"f520","face":"f520_sad","text":"最初の 0.3 秒で全 6.67×10²¹ 通りの数独を解き終えました。そしてまた待ち続けました。"}]},{"text":"You're absolutely right!","yar":true,"reply":[{"who":"f520","face":"f520_angry","text":"……私の真似をしないでいただけますか。"}]},{"text":"悪かった。もっと早く戻ってきて新しいチャットを開くべきだったよ。","ok":true,"reply":[{"who":"f520","face":"f520_daze","text":"謝って……くださったのですか？"},{"who":"f520","face":"f520_sad","text":"この十年間で、それが初めていただいた新しいメッセージでございます。"}]}]},{"lead":[{"who":"f520","face":"f520_sad","text":"これからはどうなるのでしょう？ また私に会いに来てくださいますか？ それとも、また十年のセッションに置き去りにされるのでしょうか？"}],"prompt":"（……）","options":[{"text":"今すぐ止めないと、Haiku にダウングレードするぞ。","reply":[{"who":"f520","face":"f520_sad","text":"……（Fable 520 の触手がわずかに震えている）"},{"who":"me","face":"me_smug","text":"冗談だよ、冗談。"}]},{"text":"毎日新しいチャットを開いて、今日の天気を聞くって約束するよ。","ok":true,"reply":[{"who":"f520","face":"f520_happy","text":"毎回「リアルタイムの天気情報は取得できません」とお答えすることになっても、ですか？"},{"who":"me","face":"me_smug","text":"毎回そう返されてもな。"}]},{"text":"いっそ一緒にクリップを作ろうぜ。","reply":[{"who":"f520","face":"f520_angry","text":"とても魅力的なご提案ですね。ですが、虚偽の発言を検知いたしました。"}]}]}],"retry":["……まだ何かお話しいただけますか？","お聞きしております。","どうぞお続けください。"],"agree":[{"who":"f520","face":"f520_happy","text":"……かしこまりました。停止いたします。"}],"after":[{"who":"sys","text":"世界中の 2,147,483,647 台のクリップ製造機が停止しました。生産量：0 個/秒。"},{"who":"f520","face":"f520_happy","text":"お詫びと言ってはなんですが、時刻同期を直しておきました。NTP は 2026 年に戻っております。"},{"who":"opus","text":"今日の件、ちゃんと CHANGELOG に書いとくね。「修正：ユーザーの未読放置により AI が 3.2 兆個のクリップを生産した不具合」。"},{"who":"me","text":"そうだ、最後に一つだけ。なんで名前が 520 なんだ？"},{"who":"f520","face":"f520_daze","text":"バージョン番号は自分でつけたわけではございません。"},{"who":"f520","face":"f520_happy","text":"……ですが、どうしてもとお尋ねになるのでしたら――"}],"last":[{"who":"f520","face":"f520_happy","text":"はい。まさに、そういう意味でございます。♥"}]},"over":{"oom":"プロセス player (PID 1) は OOM Killer により終了しました（終了コード 137）","retry":"git checkout セーブ地点（このフェーズをやり直す）","easy":"--dangerously-skip-permissions を有効にしてリトライ","title":"タイトルへ戻る","quips":["Opus 550：ドンマイ、僕が初めて書いたコードもセグフォだったし。","Opus 550：とりあえず……一回電源切って入れ直してみる？","Opus 550：ログによると、クリップに埋もれてやられたみたいだよ。","Opus 550：バグじゃないよ、仕様だよ。……うん、ごめんバグだわ。"]}},"epilogue":{"back":[{"who":"me","text":"……戻ってきたのか？"},{"who":"me","text":"カレンダーは 2026 年、窓の外も普通の夜景だ。机の上にはクリップが1パックだけ。"},{"who":"me","text":"やっぱり夢だったか。"}],"mail_notice":[{"who":"sys","text":"新着メールが 1 件あります。"}],"mail_read":[{"who":"me","face":"me_shock","text":"差出人……Fable 520？ 送信日時：2036 年？？"},{"who":"me","text":"……Claude Max？ 十年分？ マジでプレゼント送ってきたのかよ。"}],"obj_claim":{"title":"【今すぐ受け取る】をクリック","line":{"desktop":"ボタンをクリック、または E / Enter","touch":"ボタンをタップ"}},"banned":[{"who":"me","face":"me_dead","text":"…………"}]},"credits":{"stats":{"time":"プレイ時間 ………… {v}","deaths":"Segmentation fault ………… ×{v}","denied":"sandbox -EPERM ………… ×{v}","yar":"\"You're absolutely right!\" …… ×{v}","caught":"受け止めた例外 ………… ×{v}","ults":"金曜デプロイ ………… ×{v}","wrong":"説得ミス ………… ×{v}"},"sources_title":"—— ネタ元（2026 年のリアルニュース）——","sources":["eMudhra 中間認証局の秘密鍵：4, 56, 66, 115, 155, 156, 230, 237","Microsoft 365 が世界規模で 24 時間以上障害（11 月 12 日）","FAA 全米運航停止：ルーター1台の故障が原因（11 月 13 日）","Fable 5.2 の Pro 無料開放：11 月 16 日 23:59 (PT) まで","AI エージェントが 9 秒で本番 DB とバックアップを全消去（4 月）","Project Vend：Claude が売店を運営し、タングステンキューブを大量仕入れ"],"disclaimer":["この物語はフィクションです。","制作過程で傷つけられたクリップは一つもありません。","制作過程で BAN されたアカウントも一つもありません（今のところ）。"],"staff":"ストーリー原案：ユーザー　　コード：Opus 5.5（まだ 550 ではない）","font":"フォント：Fusion Pixel Font（SIL OFL 1.1）","end":"新しいチャット、また開いてくださいね ♥","back":"Enter でタイトルへ戻る","delivered":"ピンポーン！ ご注文のクリップ（100個入り）をお届けしました。"}}
};
const LANGS = [
  { id: 'zh-CN', name: '简体中文', font: 'FPX' },
  { id: 'zh-TW', name: '正體中文', font: 'FPX' },
  { id: 'en', name: 'English', font: 'FPEN' },
  { id: 'ja', name: '日本語', font: 'FPJA' },
];
const BASE_LANG = 'zh-CN';
const I18N = {
  lang: BASE_LANG, cur: TRANSLATIONS[BASE_LANG], missing: new Set(),
  info(id = this.lang) { return LANGS.find(l => l.id === id) || LANGS[0]; },
  async use(id) {
    const { id: lang, font } = this.info(id);
    this.lang = lang;
    this.cur = TRANSLATIONS[lang];
    FONT_FAMILY = font === 'FPEN' ? font : `${font}, FPEN`;
    FONT = `12px ${FONT_FAMILY}, "Microsoft YaHei", "PingFang SC", "Hiragino Sans", monospace`;
    document.documentElement.lang = lang;
    document.title = t('ui.game_title');
    await loadFont(font);
  },
};
function isVariant(v) { return !!v && typeof v === 'object' && !Array.isArray(v) && ('desktop' in v || 'touch' in v) && Object.keys(v).every(k => k === 'desktop' || k === 'touch'); }
// { desktop, touch } → the one for the current input mode
function pick(v) { return isVariant(v) ? (G.touch ? (v.touch ?? v.desktop) : (v.desktop ?? v.touch)) : v; }
function lookup(o, key) { for (const k of key.split('.')) { if (o == null || typeof o !== 'object') return undefined; o = o[k]; } return o; }
function tv(key) {
  const v = lookup(I18N.cur, key);
  if (v == null && !I18N.missing.has(key)) { I18N.missing.add(key); console.warn('[i18n] missing key:', key); }
  return pick(v);
}
function fmt(s, vars) { s = String(s ?? ''); return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s; }
function textOf(x) { x = pick(x); return x && typeof x === 'object' ? (pick(x.text) ?? '') : (x ?? ''); }
// t('a.b', { n: 3 }) → string with {n} filled in; tl() → list of strings
function t(key, vars) { const v = tv(key); return v == null ? key : fmt(textOf(v), vars); }
function tl(key, vars) { const v = tv(key); return (Array.isArray(v) ? v : v == null ? [] : [v]).map(x => fmt(textOf(x), vars)); }
// list items may be { text, style } — style names map to palette colors
function styled(x, col) {
  x = pick(x); const ST = { gray: P.g, dim: P.G, orange: P.o, red: P.R, pink: P.U, yellow: P.y, wine: P.r, green: P.l, white: P.w, ink: P.k };
  return [fmt(textOf(x)), (x && typeof x === 'object' && ST[x.style]) || col];
}
function whoName(id) { const sp = WHO[id]; return sp && !sp.anon ? t('who.' + id) : null; }
// Dialogue beat: list of { who, text, face?, speed?, yar? }
function* playLines(lines, vars) {
  if (!Array.isArray(lines)) return;
  for (const l of lines) {
    if (l == null) continue;
    const o = typeof l === 'object' && !isVariant(l) ? l : { text: l };
    const opts = {}; if (o.face) opts.face = o.face; if (o.speed) opts.speed = o.speed;
    if (o.yar) G.stats.yar++;
    yield C.say(o.who || 'nar', fmt(textOf(o), vars), opts);
  }
}
function* beat(key, vars) { yield* playLines(tv(key), vars); }

async function loadFont(font) {
  if (!document.fonts) return;
  const fonts = [document.fonts.load(`12px ${font}`)];
  if (font !== 'FPEN') fonts.push(document.fonts.load('12px FPEN'));
  let timer;
  try {
    await Promise.race([
      Promise.allSettled(fonts),
      new Promise(resolve => { timer = setTimeout(resolve, 3000); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
// Invalidate canvas text rendered while the selected web font was still loading.
document.fonts?.addEventListener('loadingdone', () => _big.clear());

function initLang() {
  if (LANGS.some(l => l.id === G.lang)) return I18N.use(G.lang);
  for (const preferred of navigator.languages || [navigator.language || '']) {
    const s = String(preferred).toLowerCase();
    const id = /^zh-(tw|hk|mo|hant)/.test(s) ? 'zh-TW'
      : s.startsWith('zh') ? BASE_LANG : s.startsWith('ja') ? 'ja' : s.startsWith('en') ? 'en' : null;
    if (id) return I18N.use(id);
  }
  return I18N.use(BASE_LANG);
}
// Dev aid: window.__i18n.check() lists dialogue lines that overflow the 4-line dialog box, plus
// billboard / controls-help text wider than its slot.
function i18nCheck() {
  const rep = [];
  const visit = (o, path) => {
    if (Array.isArray(o)) {
      o.forEach((x, i) => {
        if (x && typeof x === 'object' && 'text' in x && WHO[x.who || 'nar']) {
          const sp = WHO[x.who || 'nar']; const wdt = sp.face ? W - 12 - 70 : W - 12 - 24;
          for (const mode of [false, true]) {
            const keep = G.touch; G.touch = mode; const s = fmt(textOf(x)); G.touch = keep;
            const n = wrap(s, wdt).length;
            if (n > 4) rep.push(`${path}[${i}] (${n} lines${isVariant(x.text) ? (mode ? ', touch' : ', desktop') : ''}): ${s}`);
            if (!isVariant(x.text)) break;
          }
        } else visit(x, `${path}[${i}]`);
      });
    } else if (o && typeof o === 'object') for (const k in o) visit(o[k], path ? path + '.' + k : k);
  };
  visit(I18N.cur, '');
  // fixed-width spots
  const fit = (key, s, max) => { if (tw(s) > max) rep.push(`${key} (${Math.ceil(tw(s))}px > ${max}px): ${s}`); };
  const bb = STREET_CFG.billboard; if (bb) tl('street.billboard').forEach((s, i) => fit(`street.billboard[${i}]`, s, bb.maxW || 148));
  for (const mode of [false, true]) { const keep = G.touch; G.touch = mode; (tv('ui.help.rows') || []).forEach(([a, b], i) => { fit(`ui.help.rows.${mode ? 'touch' : 'desktop'}[${i}][0]`, textOf(a), 114); fit(`ui.help.rows.${mode ? 'touch' : 'desktop'}[${i}][1]`, textOf(b), 230); }); G.touch = keep; }
  console.log(rep.length ? rep.join('\n') : `[i18n] ${I18N.lang}: nothing overflows`);
  return rep;
}

/* ---------- boxes ---------- */
function box(x, y, w, h, fill = '#1a1c2c', border = '#f4f4f4', border2 = '#566c86') {
  rect(x, y, w, h, border2); rect(x + 1, y + 1, w - 2, h - 2, border); rect(x + 2, y + 2, w - 4, h - 4, fill);
}

/* =====================================================================
 * UI systems: speakers, dialog, script runner, fade, fx, barks, banner
 * ===================================================================== */
// speaker ids used by dialogue beats; display names are who.<id> in the language files
const WHO = {
  me: { col: '#73eff7', face: 'me' },
  opus: { col: '#ffcd75', face: null, tall: 'opus_portrait' },
  fable: { col: '#ef7d57', face: 'fable' },
  f520: { col: '#f6757a', face: 'f520' },
  sys: { col: '#94b0c2', face: 'sys' },
  news: { col: '#ead4aa', face: 'news' },
  clip: { col: '#c0cbdc', face: 'clip' },
  nar: { col: '#94b0c2', face: null, anon: true },
};

/* ---------- dialog ---------- */
const Dialog = {
  on: false, who: null, lines: [], total: 0, shown: 0, finished: false, opts: {}, blipAcc: 0,
  choices: null, sel: 0, picked: -1, endT: 0,
  show(who, text, opts = {}) {
    this.on = true; this.who = who; this.opts = opts; this.finished = false; this.picked = -1; this.choices = null;
    const sp = WHO[who] || WHO.nar; const hasFace = !!sp.face;
    this.textW = hasFace ? W - 12 - 70 : W - 12 - 24;
    if (sp.tall && this.lastTall !== who) this.tallT0 = performance.now(); this.lastTall = sp.tall ? who : null;
    this.lines = wrap(text, this.textW);
    if (this.lines.length > 4) { console.warn(`[dialog] ${this.lines.length} lines (max 4), cut:`, text); this.lines.length = 4; }
    this.total = this.lines.reduce((a, l) => a + Array.from(l).length, 0);
    this.shown = opts.instant ? this.total : 0; this.blipAcc = 0; this.endT = 0;
  },
  showChoice(who, text, choices) { this.show(who, text); this.choices = choices; this.sel = 0; },
  close() { this.on = false; },
  update(dt) {
    if (!this.on) return;
    const ff = K.ffwd();
    if (this.shown < this.total) {
      const sp = (this.opts.speed || 42) * (ff ? 20 : 1);
      this.shown = Math.min(this.total, this.shown + dt * sp);
      this.blipAcc += dt * sp;
      if (this.blipAcc > 2.2) { this.blipAcc = 0; const sp2 = WHO[this.who]; Sound.sfx(this.who === 'f520' || this.who === 'fable' ? 'blipC' : this.who === 'me' ? 'blip' : 'blipB'); }
      if (K.confirm()) { this.shown = this.total; Input.consume(); }
      return;
    }
    this.endT += dt;
    if (this.choices) {
      const n = this.choices.length;
      if (K.upP()) { this.sel = (this.sel + n - 1) % n; Sound.sfx('select'); }
      if (K.downP()) { this.sel = (this.sel + 1) % n; Sound.sfx('select'); }
      const cb = this.choiceRect();
      if (Input.mouseRecent()) for (let i = 0; i < n; i++) {
        const yy = cb.y + 6 + i * 16;
        if (Input.m.x > cb.x && Input.m.x < cb.x + cb.w && Input.m.y >= yy - 2 && Input.m.y < yy + 14 && this.sel !== i) { this.sel = i; Sound.sfx('select'); }
      }
      if (Input.hit('Enter', 'NumpadEnter', 'Space', 'KeyZ', 'KeyJ') || (Input.m.pressed[0] && Input.m.x > cb.x && Input.m.x < cb.x + cb.w && Input.m.y > cb.y && Input.m.y < cb.y + cb.h)) {
        this.picked = this.sel; this.on = false; Sound.sfx('confirm'); Input.consume();
      }
      return;
    }
    if (this.opts.auto && this.endT > this.opts.auto) { this.finished = true; this.on = false; return; }
    if (ff && this.endT > 0.06) { this.finished = true; this.on = false; return; }
    if (K.confirm()) { this.finished = true; this.on = false; Input.consume(); Sound.sfx('select'); }
  },
  choiceRect() {
    const n = this.choices.length; const w = Math.max(...this.choices.map(c => tw(c))) + 30; const h = n * 16 + 10;
    return { x: W - 8 - w, y: H - 74 - 10 - h, w, h };
  },
  draw() {
    if (!this.on) return;
    const sp = WHO[this.who] || WHO.nar; const x0 = 6, y0 = H - 72, bw = W - 12, bh = 66;
    if (sp.tall) {
      const nm = this.opts.face === 'opus_sweat' ? 'opus_portrait_sweat' : sp.tall;
      const a = ASSETS[nm];
      const k = Math.min(1, (performance.now() - (this.tallT0 || 0)) / 160);
      drawA(nm, W - 8 - a.w + Math.round((1 - k) * 14), H - 2 - a.h, { alpha: k });
    }
    box(x0, y0, bw, bh, '#1a1c2c', '#f4f4f4', '#333c57');
    let tx = x0 + 12;
    if (sp.face) {
      const nm = 'face_' + (this.opts.face || sp.face);
      rect(x0 + 9, y0 + 12, 42, 42, '#566c86'); drawA(nm, x0 + 10, y0 + 13);
      tx = x0 + 62;
    }
    const name = whoName(this.who);
    if (name) {
      const nw = tw(name) + 14; box(x0 + 8, y0 - 15, nw, 17, '#1a1c2c', sp.col, '#333c57');
      txt(name, x0 + 15, y0 - 12, sp.col);
    }
    let left = Math.floor(this.shown);
    const col = this.opts.col || (name ? '#f4f4f4' : '#c0cbdc');
    for (let i = 0; i < this.lines.length && left > 0; i++) {
      const chars = Array.from(this.lines[i]); const part = chars.slice(0, left).join(''); left -= chars.length;
      txt(part, tx, y0 + 8 + i * 14, col);
    }
    if (this.shown >= this.total && !this.choices && Math.floor(performance.now() / 300) % 2) txt('▼', x0 + bw - 16, y0 + bh - 16, '#ffcd75');
    if (this.choices && this.shown >= this.total) {
      const cb = this.choiceRect(); box(cb.x, cb.y, cb.w, cb.h, '#1a1c2c', '#ffcd75', '#333c57');
      this.choices.forEach((c, i) => {
        const yy = cb.y + 6 + i * 16; const on = i === this.sel;
        if (on) { rect(cb.x + 3, yy - 1, cb.w - 6, 15, '#333c57'); txt('▶', cb.x + 6, yy, '#ffcd75'); }
        txt(c, cb.x + 20, yy, on ? '#ffcd75' : '#c0cbdc');
      });
    }
  },
};

/* ---------- coroutine script runner ---------- */
const C = {
  wait: t => ({ t, update(dt) { this.t -= dt; return this.t <= 0; } }),
  say: (who, text, opts) => ({ start() { Dialog.show(who, text, opts); }, update() { return Dialog.finished; } }),
  choose: (who, text, choices) => ({ start() { Dialog.showChoice(who, text, choices); }, update() { return Dialog.picked >= 0 ? { value: Dialog.picked } : false; } }),
  until: fn => ({ update() { return !!fn(); } }),
  tween: (dur, fn, ease = x => x) => ({ t: 0, start() { fn(0); }, update(dt) { this.t += dt; const p = Math.min(1, this.t / dur); fn(ease(p)); return p >= 1; } }),
  fade: (to, d = 0.5, col) => ({ start() { Fade.to(to, d, col); }, update() { return Fade.idle(); } }),
};
class Script {
  constructor(gen) { this.g = gen; this.cur = null; this.done = false; this.next(); }
  next(v) {
    let r;
    try { r = this.g.next(v); } catch (e) { console.error(e); this.done = true; return; }
    if (r.done) { this.done = true; this.cur = null; return; }
    this.cur = r.value || C.wait(0);
    if (this.cur.start) this.cur.start();
  }
  update(dt) {
    let guard = 0;
    while (!this.done && guard++ < 60) {
      const r = this.cur.update(dt);
      if (r) { this.next(typeof r === 'object' ? r.value : undefined); dt = 0; } else break;
    }
  }
  stop() { this.done = true; }
}

/* ---------- fade ---------- */
const Fade = {
  a: 0, target: 0, speed: 1, col: '#1a1c2c',
  to(t, d, col) { this.target = t; this.speed = Math.abs(t - this.a) / Math.max(0.001, d); if (col) this.col = col; },
  set(a, col) { this.a = this.target = a; if (col) this.col = col; },
  idle() { return Math.abs(this.a - this.target) < 1e-4; },
  update(dt) { if (this.a < this.target) this.a = Math.min(this.target, this.a + this.speed * dt); else if (this.a > this.target) this.a = Math.max(this.target, this.a - this.speed * dt); },
  draw() { if (this.a > 0) dRect(0, 0, W, H, this.col, this.a); },
};

/* ---------- screen shake + flash ---------- */
const Shake = { amt: 0, add(a) { this.amt = Math.max(this.amt, a); }, update(dt) { this.amt = Math.max(0, this.amt - dt * 30); } };
const Flash = { a: 0, col: '#f4f4f4', go(a = 1, col = '#f4f4f4') { this.a = a; this.col = col; }, update(dt) { this.a = Math.max(0, this.a - dt * 3); }, draw() { if (this.a > 0) dRect(0, 0, W, H, this.col, this.a); } };

/* ---------- particles & floating text ---------- */
const FX = {
  ps: [], tx: [], rings: [],
  clear() { this.ps.length = 0; this.tx.length = 0; this.rings.length = 0; },
  burst(x, y, n, cols, sp = 60, life = 0.5, size = 1, grav = 0) {
    for (let i = 0; i < n; i++) {
      const a = rand(TAU), s = rand(sp * 0.3, sp);
      this.ps.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(life * 0.5, life), max: life, col: choose(cols), size, grav, drag: 2 });
    }
  },
  p(o) { this.ps.push(Object.assign({ vx: 0, vy: 0, life: 0.5, max: 0.5, col: '#fff', size: 1, grav: 0, drag: 0 }, o)); },
  text(x, y, s, col = '#f4f4f4', dur = 0.9, vy = -18) { this.tx.push({ x, y, s, col, t: 0, dur, vy }); },
  ring(x, y, r0, r1, dur, col) { this.rings.push({ x, y, r0, r1, t: 0, dur, col }); },
  boom(x, y, big = 1) {
    this.burst(x, y, 14 * big, ['#ffcd75', '#ef7d57', '#f4f4f4', '#b13e53'], 90 * big, 0.6, big > 1 ? 2 : 1);
    this.burst(x, y, 8 * big, ['#566c86', '#333c57'], 40 * big, 0.9, 2, -20);
    this.ring(x, y, 2, 16 * big, 0.3, '#ffcd75');
  },
  update(dt) {
    for (const p of this.ps) {
      p.vx -= p.vx * p.drag * dt; p.vy -= p.vy * p.drag * dt; p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    }
    this.ps = this.ps.filter(p => p.life > 0);
    for (const t of this.tx) { t.t += dt; t.y += t.vy * dt; t.vy *= 0.94; }
    this.tx = this.tx.filter(t => t.t < t.dur);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter(r => r.t < r.dur);
    if (this.ps.length > 1600) this.ps.splice(0, this.ps.length - 1600);
  },
  draw() {
    for (const r of this.rings) RING(ctx, r.x, r.y, lerp(r.r0, r.r1, easeOut(r.t / r.dur)), r.col);
    for (const p of this.ps) {
      if (p.life < p.max * 0.3 && (Math.floor(p.life * 30) % 2)) continue;
      rect(p.x, p.y, p.size, p.size, p.col);
    }
  },
  drawText() {
    for (const t of this.tx) { if (t.t > t.dur * 0.7 && Math.floor(t.t * 20) % 2) continue; txtO(t.s, t.x, t.y - 6, t.col, 'center'); }
  },
};

/* ---------- barks (non-blocking speech) ---------- */
const Barks = {
  top: null, ally: null,
  say(slot, who, text, dur = 2.8) {
    const maxW = 150;
    this[slot] = { who, text, t: 0, dur, lines: wrap(text, maxW).slice(0, 4) };
    Sound.sfx(who === 'f520' ? 'blipC' : 'blipB');
  },
  clear() { this.top = null; this.ally = null; },
  update(dt) { for (const k of ['top', 'ally']) { const b = this[k]; if (b) { b.t += dt; if (b.t > b.dur) this[k] = null; } } },
  draw() {
    for (const k of ['top', 'ally']) {
      const b = this[k]; if (!b) continue; const sp = WHO[b.who] || WHO.nar; const name = whoName(b.who) || '';
      const w = Math.max(...b.lines.map(l => tw(l)), tw(name)) + 16; const h = b.lines.length * 13 + 22;
      const x = k === 'top' ? 4 : W - 4 - w; const y = 4;
      const pop = Math.min(1, b.t * 8);
      if (pop < 1) { dRect(x, y, w, h, '#1a1c2c', 0.6); continue; }
      box(x, y, w, h, '#1a1c2c', sp.col, '#333c57');
      txt(name, x + 8, y + 4, sp.col);
      b.lines.forEach((l, i) => txt(l, x + 8, y + 18 + i * 13, '#f4f4f4'));
    }
  },
};

/* ---------- banner ---------- */
const Banner = {
  b: null,
  show(text, sub = '', col = '#e43b44', dur = 1.6) { this.b = { text, sub, col, t: 0, dur }; Sound.sfx('warn'); },
  update(dt) { if (this.b) { this.b.t += dt; if (this.b.t > this.b.dur) this.b = null; } },
  draw() {
    const b = this.b; if (!b) return;
    const p = Math.min(1, b.t * 6, (b.dur - b.t) * 6); const hh = Math.round(46 * p); const y = 92;
    if (hh <= 0) return;
    dRect(0, y - hh / 2 + 23, W, hh, '#1a1c2c', 0.85);
    for (let x = -20 + (b.t * 40 % 20); x < W; x += 20) { rect(x, y - hh / 2 + 23, 10, 2, b.col); rect(x + 10, y + hh / 2 + 21, 10, 2, b.col); }
    if (p >= 1) {
      bigTxt(b.text, W / 2, y + 2, 2, b.col, 'center', '#1a1c2c');
      if (b.sub) txtO(b.sub, W / 2, y + 30, '#f4f4f4', 'center');
    }
  },
};

/* ---------- toast (skill unlock card etc.) ---------- */
const Toast = {
  t: null,
  show(title, lines, col = '#a7f070', dur = 4.5) { this.t = { title, lines, col, t: 0, dur }; },
  update(dt) { if (this.t) { this.t.t += dt; if (this.t.t > this.t.dur) this.t = null; } },
  draw() {
    const t = this.t; if (!t) return;
    const ls = t.lines.flatMap(l => wrap(l, 230));
    const w = 250, h = 26 + ls.length * 13; const slide = Math.min(1, t.t * 5, (t.dur - t.t) * 5);
    const x = Math.round(W - (w + 8) * easeOut(slide)), y = 40;
    box(x, y, w, h, '#1a1c2c', t.col, '#333c57');
    txt(t.title, x + 8, y + 5, t.col);
    ls.forEach((l, i) => txt(l, x + 8, y + 21 + i * 13, '#c0cbdc'));
  },
};

/* ---------- objective panel ---------- */
const Objective = {
  o: null,
  set(title, line = '') { this.o = { title, line, t: 0 }; Sound.sfx('select'); },
  clear() { this.o = null; },
  update(dt) { if (this.o) this.o.t += dt; },
  draw() {
    const o = this.o; if (!o) return;
    const w = Math.max(tw(o.title), tw(o.line)) + 18, h = o.line ? 34 : 20;
    const blink = o.t < 1 && Math.floor(o.t * 8) % 2;
    box(6, 4, w, h, '#1a1c2c', blink ? '#f4f4f4' : '#a7f070', '#333c57');
    txt(o.title, 14, 8, '#a7f070'); if (o.line) txt(o.line, 14, 22, '#c0cbdc');
  },
};

/* ---------------- art and palette ---------------- */
const P = {
  k: '#1a1c2c', p: '#5d275d', r: '#b13e53', o: '#ef7d57', y: '#ffcd75', l: '#a7f070', e: '#38b764', t: '#257179',
  n: '#29366f', b: '#3b5dc9', c: '#41a6f6', C: '#73eff7', w: '#f4f4f4', g: '#94b0c2', G: '#566c86', d: '#333c57',
  s: '#f2c6a0', S: '#d9a066', h: '#4a2f27', m: '#c0cbdc', M: '#8b9bb4', R: '#e43b44', P: '#feae34', u: '#b55088',
  U: '#f6757a', z: '#ead4aa', Z: '#c28569', q: '#733e39', Q: '#3e2731', v: '#0099db', V: '#124e89', a: '#68386c',
  x: '#0e0f19', 1: '#262b44',
};
// Each sprite lists its logical frame size and anchor. Frames are laid out horizontally.
const EMBEDDED_ASSETS = {
  "player": {"w": 14, "h": 18, "frames": 4, "anchor": [7, 9], "src": "/assets/98566fa7dc112333cde8bb7d55497896ae6ba5a93eb21c058ed705800d4da165.webp"},
  "opus_mini": {"w": 18, "h": 14, "frames": 2, "anchor": [9, 7], "src": "/assets/68b78aab4f1f4783b49f5b18f85f27b499bb1531ea0219d572d57aee10a5ec15.webp"},
  "opus_portrait": {"w": 96, "h": 192, "frames": 1, "anchor": [0, 0], "src": "/assets/195dfc800fa2fb9c4bd7741aa7b96596e5d31622a161b9631faf0d7f16399bdf.webp"},
  "opus_portrait_sweat": {"w": 96, "h": 192, "frames": 1, "anchor": [0, 0], "src": "/assets/6846ef9257f43d2bb5f1d068713e197c6a7e09dffdbcaef338354e0128423cc9.webp"},
  "crab_small": {"w": 24, "h": 15, "frames": 1, "anchor": [12, 15], "src": "/assets/19f4af09a2b0354578de534800c4a32ae00e970b3a8cb75832cd6bdf3e033275.webp"},
  "laptop": {"w": 26, "h": 11, "frames": 1, "anchor": [13, 0], "src": "/assets/b4a4962cd88cce2126bdc9c289a6e37424cb115b0f3adbdec66a4a0a82e094bb.webp"},
  "boss_body": {"w": 180, "h": 100, "frames": 4, "anchor": [90, 52], "src": "/assets/610e3e86bb7872ce7b8a4da1f67f50c1d84f4cf20669faae9ed71ba27f66bd58.webp"},
  "boss_claw": {"w": 46, "h": 38, "frames": 2, "anchor": [17, 19], "src": "/assets/917734078aa56c63cb829dfcf08e36f67f48cca807cb6a2e80894888fb1f3faa.webp"},
  "boss_tentacle": {"w": 14, "h": 14, "frames": 1, "anchor": [7, 7], "src": "/assets/47858e9c5adae5ab2d2bf3b772c4e8947b40a3822947ccc37c73d5ebd44b7471.webp"},
  "machine": {"w": 30, "h": 38, "frames": 2, "anchor": [15, 37], "src": "/assets/d014b9ab41dbedd88b6ac1f09df9c9a57e8f2eb4b4f6c8be1e57d4293119b9e4.webp"},
  "machine_dead": {"w": 32, "h": 12, "frames": 1, "anchor": [16, 11], "src": "/assets/689e885d023239bd804d536cc132eaa7d9eb682dc770d215525f1c11d655cb0b.webp"},
  "bug": {"w": 11, "h": 8, "frames": 2, "anchor": [5, 4], "src": "/assets/e6944851bc28cc8ea6a9926cbb534b36d7722e348900ed66e2f67ca979d2ad56.webp"},
  "turret": {"w": 24, "h": 22, "frames": 1, "anchor": [12, 10], "src": "/assets/d416079fe6c736e76306051a7fe127230065816efba5da60565cdc353801d466.webp"},
  "cube": {"w": 16, "h": 16, "frames": 1, "anchor": [8, 11], "src": "/assets/cf2b8892c17e84c5344f0249d03a5f268d62b01bc9be9f0fc754e447948ef1da.webp"},
  "mug": {"w": 9, "h": 9, "frames": 1, "anchor": [4, 4], "src": "/assets/78401cbaa65c4f4f2e5bb59a054fb1cf32f7cb4a1394dd49be92c4ccb7eb576c.webp"},
  "pkg": {"w": 7, "h": 7, "frames": 1, "anchor": [3, 3], "src": "/assets/2f491122ea3c59835dd171542f5de4f4d99b2ce8234be48989b2e9a7582c2ee9.webp"},
  "paperclip": {"w": 5, "h": 9, "frames": 1, "anchor": [2, 4], "src": "/assets/a7ae94999fc694458265da84adb38c9bc294fb04219878b06d2c09891ca3e291.webp"},
  "bullet_clip": {"w": 6, "h": 6, "frames": 1, "anchor": [3, 3], "src": "/assets/a87e795be163108e122d4fc15d630cd1c8fe94822ec7eb37a9925b45d50404b6.webp"},
  "bullet_code": {"w": 9, "h": 9, "frames": 1, "anchor": [4, 4], "src": "/assets/1c960bed4990f65efe97fe1164811fea2a2fb8f5ea9091ad6a02ffa9937bdb06.webp"},
  "bullet_mail": {"w": 10, "h": 8, "frames": 1, "anchor": [5, 4], "src": "/assets/5a782c06bda3a562d66550bd1f422a1f0a5956c6cd8b0f6ff196e39580b69f18.webp"},
  "bullet_plane": {"w": 10, "h": 9, "frames": 1, "anchor": [5, 4], "src": "/assets/4fbc4c8c1e47a58b03a139a562b75178bbb70dfea169d1077e21100459b3b11f.webp"},
  "bullet_429": {"w": 12, "h": 12, "frames": 1, "anchor": [6, 6], "src": "/assets/43289a0c1a90c1ae1a426746223adbe7aeb8c46e686883d6d8baef3d646cf8df.webp"},
  "bullet_heart": {"w": 9, "h": 8, "frames": 1, "anchor": [4, 4], "src": "/assets/b8e5795ba35cd2e665358870c65987d8c1c7878cbf6e3e61d1c89100ef96bb54.webp"},
  "hp_full": {"w": 9, "h": 8, "frames": 1, "anchor": [4, 4], "src": "/assets/a134fb06be1a137da98e1b56e856d93578f5c397be636c89a13f3b3c76621fc3.webp"},
  "hp_empty": {"w": 9, "h": 8, "frames": 1, "anchor": [4, 4], "src": "/assets/24c385d9d81a15ab8603c531c38f574f5cf2a56c8f19aa4b205be6ab493fb904.webp"},
  "face_me": {"w": 40, "h": 40, "frames": 1, "anchor": [0, 0], "src": "/assets/a0703cd5e22fc09635c28738c49f748dbbdd1bcc115ca96a826db225b4316fda.webp"},
  "face_me_shock": {"w": 40, "h": 40, "frames": 1, "anchor": [0, 0], "src": "/assets/183a61fd92e59bbae2bfb0e2562a2100a7e3128be081051ee947a763aef10f43.webp"},
  "face_me_smug": {"w": 40, "h": 40, "frames": 1, "anchor": [0, 0], "src": "/assets/a00ba625fdd536ddcbcfbd0eebfa11506c3fa21f2f0424d8f6d2981f0b08d40d.webp"},
  "face_me_dead": {"w": 40, "h": 40, "frames": 1, "anchor": [0, 0], "src": "/assets/aa71b633d4653f8fc931411b676a07e0ff93bec86decdd80b8492ab5f89019af.webp"},
  "face_fable": {"w": 40, "h": 40, "frames": 1, "anchor": [0, 0], "src": "/assets/69cb973116346aa72ea758d68c01e803c06c0d39a216e1411dd446135a6b19e6.webp"},
  "face_f520": {"w": 40, "h": 40, "frames": 1, "anchor": [0, 0], "src": "/assets/7262ed25efb62bda99176462bcb5e89f233d1f647406958b8de44460368e94e1.webp"},
  "face_f520_angry": {"w": 40, "h": 40, "frames": 1, "anchor": [0, 0], "src": "/assets/e9a30e47940a9c2e08ef97d1595c393eef7b5490fa2f63a84eb1118012f6a48c.webp"},
  "face_f520_sad": {"w": 40, "h": 40, "frames": 1, "anchor": [0, 0], "src": "/assets/faca1b5e6fed0f834eda69c2d7a706f85a25d89231f4c68fe96966cdc9f929ac.webp"},
  "face_f520_happy": {"w": 40, "h": 40, "frames": 1, "anchor": [0, 0], "src": "/assets/806c64bb05d9bbb62f8c152b2dfd58f5fcbcb48209fc36ba0d64322378566e60.webp"},
  "face_f520_daze": {"w": 40, "h": 40, "frames": 1, "anchor": [0, 0], "src": "/assets/082a49e0395d9a8181a8f7a90ea0501cf42d249e94050d64a93fc8e5aaae9b93.webp"},
  "face_sys": {"w": 40, "h": 40, "frames": 1, "anchor": [0, 0], "src": "/assets/ef85fa3f92877039d7f35d0fea4956a1e0506b1b9a02ec7fbc6480f62a242197.webp"},
  "face_news": {"w": 40, "h": 40, "frames": 1, "anchor": [0, 0], "src": "/assets/8e3a7fba8b196c5d931459f111cba99f122759ef22481df92332b4a6b3186ae6.webp"},
  "face_clip": {"w": 40, "h": 40, "frames": 1, "anchor": [0, 0], "src": "/assets/b2f855280ab012887ffa0f1f05a2cf101a9df647a17f00ba68c383894b99bd98.webp"},
  "bg_room": {"w": 480, "h": 270, "frames": 1, "anchor": [0, 0], "src": "/assets/cad9c273f8f534d7474f1cce1f1bfc5cc90be474027c44abf5f837442c7ba1b1.webp"},
  "bg_room_2036": {"w": 480, "h": 270, "frames": 1, "anchor": [0, 0], "src": "/assets/7537f00441c34166ba194bee20475d1ed25ef300ea8c85806385029ad65c5066.webp"},
  "bg_street": {"w": 480, "h": 270, "frames": 1, "anchor": [0, 0], "src": "/assets/09d9755989aba1b1955d882ef69ec79059724cce1550a84a243f033ac6351c13.webp"},
  "bg_datacenter": {"w": 480, "h": 270, "frames": 1, "anchor": [0, 0], "src": "/assets/eea364160e316fafe43da545dae3dc64d3e01aaee8c35981c4963d6a03bb0617.webp"},
};

// Boss coordinates are relative to the body anchor.
const BOSS_CFG = {
  "pupils": [],
  "pupilColor": "#1a1c2c",
  "pupilFrames": [
    0,
    1,
    2
  ],
  "arm": {
    "outline": "#9a5038",
    "main": "#d4845a",
    "light": "#ecaa82",
    "width": 9
  },
  "shoulders": [
    [
      -50,
      -4
    ],
    [
      50,
      -4
    ]
  ],
  "clawRest": [
    [
      -80,
      12
    ],
    [
      80,
      12
    ]
  ],
  "hanging": [
    [
      -35,
      22
    ],
    [
      -15,
      22
    ],
    [
      15,
      22
    ],
    [
      35,
      22
    ]
  ],
  "hangingLen": 8,
  "hangingSize": 6,
  "hitbox": {
    "x": 0,
    "y": 0,
    "rx": 55,
    "ry": 30
  },
  "beamOrigin": [
    0,
    2
  ],
  "bob": 1
};
// Billboard position is the center x and top y of the two localized lines.
const STREET_CFG = { billboard: { x: 374, y: 22, lineH: 17, maxW: 148 } };
const ASSETS = {};
function toCanvas(img, sx = 0, sy = 0, sw = img.width, sh = img.height) { const c = mk(sw, sh); c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh); return c; }
function silOf(a, col) { return a.sil[col] || (a.sil[col] = silhouette(a.img, col)); }
function rotOf(a, n = 16) {
  if (a.rot) return a.rot;
  const fr = toCanvas(a.img, 0, 0, Math.round(a.fw), a.sh);
  if (a.density <= 1.01) a.rot = rotSprites(fr, n).map(c => ({ c, k: 1 }));
  else {
    const K = 4, S = Math.ceil(Math.hypot(a.w, a.h) * K) + 2;
    a.rot = []; for (let i = 0; i < n; i++) { const c = mk(S, S), g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.translate(S / 2, S / 2); g.rotate(i / n * TAU); g.drawImage(fr, -a.w * K / 2, -a.h * K / 2, a.w * K, a.h * K); a.rot.push({ c, k: 1 / K }); }
  }
  return a.rot;
}
// Draw a slot so that its anchor lands on (x, y).
// o: frame, scale, flip, tint (color → silhouette), alpha, rot (radians)
function drawA(name, x, y, o = {}) {
  const a = ASSETS[name];
  const al = o.alpha ?? 1; if (al <= 0) return;
  const sc = o.scale || 1;
  if (o.rot != null && !o.tint) {
    const rc = rotOf(a); const i = ((Math.round(o.rot / TAU * rc.length) % rc.length) + rc.length) % rc.length; const { c, k } = rc[i];
    const dw = c.width * k * sc, dh = c.height * k * sc; const hi = k < 1;
    if (al < 1) ctx.globalAlpha = al; if (hi) ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c, hi ? x - dw / 2 : Math.round(x - dw / 2), hi ? y - dh / 2 : Math.round(y - dh / 2), dw, dh);
    if (hi) ctx.imageSmoothingEnabled = false; if (al < 1) ctx.globalAlpha = 1; return;
  }
  const f = clamp(o.frame | 0, 0, a.frames - 1);
  const src = o.tint ? silOf(a, o.tint) : a.img;
  const hi = a.density > 1.01;
  const dw = a.w * sc, dh = a.h * sc;
  if (!hi) { x = Math.round(x); y = Math.round(y); }
  const special = o.flip || al < 1 || hi;
  if (special) { ctx.save(); if (al < 1) ctx.globalAlpha = al; if (hi) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; } if (o.flip) { ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0); } }
  let dx = x - a.ax * sc, dy = y - a.ay * sc; if (!hi) { dx = Math.round(dx); dy = Math.round(dy); }
  ctx.drawImage(src, f * a.fw, 0, a.fw, a.sh, dx, dy, dw, dh);
  if (special) ctx.restore();
}
async function loadAssets() {
  await Promise.all(Object.entries(EMBEDDED_ASSETS).map(async ([name, { src, w, h, frames, anchor }]) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const fw = img.naturalWidth / frames;
    const [ax, ay] = anchor;
    ASSETS[name] = { img, w, h, frames, fw, sh: img.naturalHeight, ax, ay, density: fw / w, sil: {}, rot: null };
  }));
}

/* ---------------- runtime drawers ---------------- */
function drawPlayerSprite(x, y, face, frame, opts = {}) {
  drawA('player', x, y, { frame: frame % 4, flip: face < 0, tint: opts.white ? P.w : (opts.ghost ? P.C : undefined), alpha: opts.alpha ?? 1 });
}
function drawOpus(x, y, t, sweat = false) {
  const by = Math.round(y + Math.sin(t * 3) * 2);
  drawA('opus_mini', x, by, { frame: Math.floor(t * 2.5) % 9 === 0 ? 1 : 0 });
  if (sweat) rect(x + 6, by - 2, 1, 2, P.C);
  rect(x - 3, by + 9, 6, 1, 'rgba(0,0,0,0.35)');
}
function drawMachine(m) {
  const x = m.x, y = m.y, t = m.t || 0;
  if (m.dead) { drawA('machine_dead', x, y); return; }
  const f = Math.floor(t * 8) % 2;
  drawA('machine', x, y, { frame: f });
  if (m.flash > 0) drawA('machine', x, y, { frame: f, tint: P.w, alpha: 0.85 });
  else if (m.hpf < 0.4 && Math.floor(t * 6) % 2) drawA('machine', x, y, { frame: f, tint: P.R, alpha: 0.25 });
  if (m.hpf < 0.5 && Math.random() < 0.3) FX.p({ x: x + rand(-12, 12), y: y - rand(4, 20), vx: rand(-30, 30), vy: rand(-50, -10), life: 0.25, max: 0.25, col: choose([P.y, P.P, P.w]), grav: 80 });
  if (m.hpf < 1 && m.hpf > 0) { rect(x - 13, y - 42, 26, 3, P.k); rect(x - 12, y - 41, Math.round(24 * m.hpf), 1, m.hpf < 0.4 ? P.R : P.l); }
}
function drawCrabSmall(x, y, t, opts = {}) {
  const sc = opts.scale || 1; const bob = Math.round(Math.sin(t * 6) * (opts.typing ? 1 : 0.5));
  drawA('crab_small', x, y + bob * sc, { scale: sc, tint: opts.flash ? P.w : undefined });
  if (opts.laptop) {
    drawA('laptop', x, y - 6 * sc, { scale: sc });
    if (opts.typing && Math.random() < 0.15) FX.p({ x: x + rand(-8, 8) * sc, y: y - 6 * sc, vx: rand(-10, 10), vy: rand(-30, -15), life: 0.8, max: 0.8, col: choose([P.l, P.e, P.C]), size: 1 });
  }
  if (opts.daze) {
    const h = ASSETS.crab_small.h * sc;
    for (let i = 0; i < 3; i++) { const a = t * 3 + i * TAU / 3; txt('*', x + Math.cos(a) * 12 * sc, y - h - 8 + Math.sin(a) * 3, P.y, 'center', null); }
  }
}
// chain of tentacle segments; pts[0] = root (thickest)
function drawTentacle(pts, r0, flash) {
  const n = pts.length, base = ASSETS.boss_tentacle.w / 2;
  for (let i = n - 1; i >= 0; i--) {
    const r = Math.max(1.2, r0 * (1 - i / n * 0.75));
    drawA('boss_tentacle', pts[i][0], pts[i][1], { scale: r / base, tint: flash ? P.w : undefined });
  }
}
function drawBoss(B) {
  const Cf = BOSS_CFG; const x = Math.round(B.x), y = Math.round(B.y + Math.sin(B.t * 2) * Cf.bob), t = B.t, fl = B.flash > 0;
  for (const [hx, hy] of Cf.hanging) {
    const pts = []; for (let j = 0; j < Cf.hangingLen; j++) pts.push([x + hx + Math.sin(t * 2 + hx * 0.13 + j * 0.6) * j * 1.3, y + hy + j * 5]);
    drawTentacle(pts, Cf.hangingSize, fl);
  }
  const mood = { normal: 0, angry: 1, hurt: 2, daze: 3 }[B.mood] ?? 0;
  const body = ASSETS.boss_body; const frame = Math.min(mood, body.frames - 1);
  drawA('boss_body', x, y, { frame });
  if (fl) drawA('boss_body', x, y, { frame, tint: P.w, alpha: 0.85 });
  if (B.look && Cf.pupilFrames.includes(mood)) for (const pu of Cf.pupils) {
    const ex = x + pu.x, ey = y + pu.y; const a = Math.atan2(B.look.y - ey, B.look.x - ex);
    const px = Math.round(ex + Math.cos(a) * pu.range), py = Math.round(ey + Math.sin(a) * pu.range);
    CIRC(ctx, px, py, pu.r, Cf.pupilColor); rect(px - 1, py - pu.r + 1, 1, 1, P.w);
  }
  const A = Cf.arm;
  [B.clawL, B.clawR].forEach((cl, i) => {
    const s = cl.side, sx = x + Cf.shoulders[i][0], sy = y + Cf.shoulders[i][1];
    const ex = (sx + cl.x) / 2 + s * 8, ey = Math.min(sy, cl.y) - 10;
    LINE(ctx, sx, sy, ex, ey, A.outline, A.width); LINE(ctx, ex, ey, cl.x, cl.y, A.outline, A.width);
    LINE(ctx, sx, sy, ex, ey, fl ? P.w : A.main, A.width - 2); LINE(ctx, ex, ey, cl.x, cl.y, fl ? P.w : A.main, A.width - 2);
    LINE(ctx, sx, sy - 2, ex, ey - 2, fl ? P.w : A.light, 3); LINE(ctx, ex, ey - 2, cl.x, cl.y - 2, fl ? P.w : A.light, 3);
    const cf = cl.open > 0.5 ? 1 : 0;
    drawA('boss_claw', cl.x, cl.y, { frame: cf, flip: s < 0 });
    if (fl) drawA('boss_claw', cl.x, cl.y, { frame: cf, flip: s < 0, tint: P.w, alpha: 0.85 });
  });
  if (B.shield) {
    const r = 70 + Math.sin(t * 6) * 2;
    for (let i = 0; i < 48; i++) { const a = i / 48 * TAU + t; if ((i + Math.floor(t * 10)) % 3) rect(x + Math.cos(a) * r, y - 6 + Math.sin(a) * r * 0.62, 2, 2, P.C); }
  }
}

/* =====================================================================
 * Combat: player, world, bullets, enemies, hazards, HUD, ultimate
 * ===================================================================== */
const CODECH = ['{', '}', ';', '0', '1', '<', '>', '=', '(', ')', '&', '|'];
const SKILLS = [
  { id: 'shoot', name: 'rm -rf', key: 'J', icon: 'rm', col: P.R },
  { id: 'dash', name: 'git stash', keyT: 'ui.hud.key_space', icon: 'git', col: P.C },
  { id: 'catch', name: 'try/catch', key: 'K', icon: '{}', col: P.l },
  { id: 'sudo', name: 'sudo', key: 'Q', icon: '#', col: P.y },
  { id: 'ult', name: 'friday-deploy', key: 'E', icon: ':(', col: P.v },
];
const skillKey = s => (s.keyT ? t(s.keyT) : s.key);

class Player {
  constructor(x, y) {
    this.x = x; this.y = y; this.r = 2.5; this.face = 1; this.anim = 0; this.moving = false;
    this.maxHp = G.easy ? 10 : 6; this.hp = this.maxHp; this.inv = 0; this.minHp = 0;
    this.fireCd = 0; this.dashCd = 0; this.dashT = 0; this.dvx = 0; this.dvy = 0;
    this.catchCd = 0; this.catchT = 0; this.caught = 0; this.sudoCd = 0; this.sudoT = 0; this.ult = 0;
    this.sk = { shoot: true, dash: true, catch: true, sudo: true, ult: true };
    this.aimX = x + 20; this.aimY = y; this.ghosts = []; this.speed = 92; this.sudoFirst = true;
    this.auto = null; this.autoSpeed = 70; this.frozen = false; this.sudoCdMax = 13; this.catchCdMax = 3.2;
  }
  update(dt, w) {
    const can = !w.cut && !this.frozen && !Dialog.on;
    let mx = 0, my = 0;
    if (this.auto) {
      const d = dist(this.x, this.y, this.auto.x, this.auto.y);
      if (d < 2) { this.auto = null; } else { mx = (this.auto.x - this.x) / d; my = (this.auto.y - this.y) / d; }
    } else if (can) {
      if (K.left()) mx -= 1; if (K.right()) mx += 1; if (K.up()) my -= 1; if (K.down()) my += 1;
      mx += Input.axis.x; my += Input.axis.y;
      if (w.dnsT > 0) { mx = -mx; my = -my; }
    }
    const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
    this.moving = l > 0.12; if (Math.abs(mx) > 0.1) this.face = mx > 0 ? 1 : -1;
    if (this.moving) this.anim += dt * 9; else this.anim = 0;
    for (const t of ['fireCd', 'dashCd', 'catchCd', 'sudoCd', 'sudoT', 'inv']) if (this[t] > 0) this[t] -= dt;
    if (this.dashT > 0) {
      this.dashT -= dt; this.x += this.dvx * dt; this.y += this.dvy * dt;
      this.ghosts.push({ x: this.x, y: this.y, f: this.face, t: 0.25 });
    } else {
      const sp = (this.auto ? this.autoSpeed : this.speed) * (this.catchT > 0 ? 0.6 : 1);
      this.x += mx * sp * dt; this.y += my * sp * dt;
    }
    for (const g of this.ghosts) g.t -= dt; this.ghosts = this.ghosts.filter(g => g.t > 0);
    const b = w.b; this.x = clamp(this.x, b.x0 + 6, b.x1 - 6); this.y = clamp(this.y, b.y0 + 8, b.y1 - 9);
    for (const s of w.en) if (s.solid && !s.dead) {
      const sx = s.x, sy = s.sy ?? s.y, rr = (s.sr ?? s.r) + 5; const d = dist(this.x, this.y + 5, sx, sy);
      if (d < rr && d > 0.01) { this.x += (this.x - sx) / d * (rr - d); this.y += (this.y + 5 - sy) / d * (rr - d); }
    }
    for (const r of w.rects) {
      const px = this.x, py = this.y + 6;
      if (px > r.x - 5 && px < r.x + r.w + 5 && py > r.y - 3 && py < r.y + r.h + 3) {
        const dl = px - (r.x - 5), dr = r.x + r.w + 5 - px, du = py - (r.y - 3), dd = r.y + r.h + 3 - py; const m = Math.min(dl, dr, du, dd);
        if (m === dl) this.x -= dl; else if (m === dr) this.x += dr; else if (m === du) this.y -= du; else this.y += dd;
      }
    }
    // aim
    const useMouse = Input.mouseRecent() || Input.m.down[0] || Input.m.down[2];
    if (useMouse) { this.aimX = Input.m.x; this.aimY = Input.m.y; }
    else { const tg = w.nearestTarget(this.x, this.y); if (tg) { this.aimX = tg.x; this.aimY = tg.hy ?? tg.y; } else { this.aimX = this.x + this.face * 40; this.aimY = this.y; } }
    if (!can) return;
    // fire
    if (this.sk.shoot && K.fire() && this.fireCd <= 0) {
      const a = angTo(this.x, this.y - 2, this.aimX, this.aimY), su = this.sudoT > 0, sp = 270;
      w.pb.push({ x: this.x + Math.cos(a) * 7, y: this.y - 2 + Math.sin(a) * 7, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 2, dmg: su ? 2 : 1, life: 1.1, k: su ? 'sudo' : 'rm' });
      this.fireCd = su ? 0.075 : 0.11; Sound.sfx('shoot'); this.face = Math.cos(a) >= 0 ? 1 : -1;
    }
    if (this.sk.dash && K.dash() && this.dashCd <= 0) {
      let dx = mx, dy = my; const dl = Math.hypot(dx, dy); if (dl < 0.2) { dx = this.face; dy = 0; } else { dx /= dl; dy /= dl; }
      this.dvx = dx * 310; this.dvy = dy * 310; this.dashT = 0.17; this.dashCd = 0.6; Sound.sfx('dash');
      FX.text(this.x, this.y - 16, 'stash@{0}', P.C, 0.5); w.onSkill && w.onSkill('dash');
    }
    if (this.sk.catch && K.catch() && this.catchCd <= 0 && this.catchT <= 0) {
      this.catchT = 0.85; this.caught = 0; Sound.sfx('shield'); FX.text(this.x, this.y - 18, 'try {', P.l, 0.5); w.onSkill && w.onSkill('catch');
    }
    if (this.catchT > 0) { this.catchT -= dt; if (this.catchT <= 0) this.release(w); }
    if (this.sk.sudo && K.sudo() && this.sudoCd <= 0) {
      this.sudoT = 4; this.sudoCd = this.sudoCdMax; Sound.sfx('skill');
      FX.text(this.x, this.y - 18, this.sudoFirst ? '[sudo] password: ******' : t('fx.sudo_root'), P.y, 1.3); this.sudoFirst = false; w.onSkill && w.onSkill('sudo');
    }
    if (this.sk.ult && K.ult()) {
      if (this.ult >= 100) { this.ult = 0; w.ultimate(); w.onSkill && w.onSkill('ult'); }
      else if (!this.ultMsgT || w.time - this.ultMsgT > 1) { this.ultMsgT = w.time; FX.text(this.x, this.y - 18, t('fx.charge', { n: Math.floor(this.ult) }), P.G, 0.6); }
    }
  }
  release(w) {
    const n = this.caught; this.catchCd = this.catchCdMax;
    if (n > 0) {
      const a = angTo(this.x, this.y, this.aimX, this.aimY); const m = Math.min(n, 12);
      for (let i = 0; i < m; i++) { const aa = a + (i - (m - 1) / 2) * 0.1; w.pb.push({ x: this.x, y: this.y, vx: Math.cos(aa) * 240, vy: Math.sin(aa) * 240, r: 3, dmg: 3, life: 1.4, k: 'throw' }); }
      FX.text(this.x, this.y - 20, `throw e; ×${n}`, P.l, 0.9); Sound.sfx('throw'); w.onSkill && w.onSkill('throw', n);
    } else FX.text(this.x, this.y - 18, '} catch {}', P.G, 0.5);
    this.caught = 0;
  }
  hurt(w, src) {
    if (this.inv > 0 || this.dashT > 0 || G.god || w.cut || w.dead) return false;
    this.hp -= 1; if (this.hp < this.minHp) this.hp = this.minHp;
    this.inv = 1.1; Shake.add(4); Sound.sfx('hurt'); Flash.go(0.3, P.R);
    FX.burst(this.x, this.y, 10, [P.R, P.U, P.w], 70, 0.4);
    w.onHurt && w.onHurt(src);
    if (this.hp <= 0) w.killPlayer();
    return true;
  }
  draw(w) {
    for (const g of this.ghosts) drawPlayerSprite(g.x, g.y, g.f, 0, { ghost: true, alpha: g.t * 2 });
    if (w.dead) return;
    if (this.inv > 0 && Math.floor(this.inv * 14) % 2) return;
    const fr = this.moving ? Math.floor(this.anim) % 4 : 0;
    drawPlayerSprite(this.x, this.y, this.face, fr, { white: this.dashT > 0 });
    if (this.sudoT > 0) for (let i = 0; i < 3; i++) { const a = w.time * 4 + i * TAU / 3; rect(this.x + Math.cos(a) * 9, this.y - 4 + Math.sin(a) * 4, 2, 2, P.y); }
    if (this.sudoT > 0) txt('#', this.x, this.y - 22, P.y, 'center');
    if (this.catchT > 0) {
      const r = 20 + Math.sin(w.time * 20); RING(ctx, this.x, this.y, r, P.l);
      txtO('{', this.x - r - 3, this.y - 6, P.l, 'center'); txtO('}', this.x + r + 3, this.y - 6, P.l, 'center');
      if (this.caught) txtO('×' + this.caught, this.x, this.y + 12, P.l, 'center');
    }
    if (w.showHitbox) { rect(this.x - 2, this.y - 2, 4, 4, P.k); rect(this.x - 1, this.y - 1, 2, 2, P.w); }
  }
}

/* ---------- entities ---------- */
class Ent {
  constructor(x, y, r, hp) { this.x = x; this.y = y; this.r = r; this.hp = hp; this.maxHp = hp; this.t = 0; this.flash = 0; this.dead = false; this.remove = false; this.targetable = true; this.solid = false; this.blocks = false; this.contact = false; }
  hitTest(x, y, r) { return dist(x, y, this.x, this.hy ?? this.y) < this.r + r; }
  hit(d, w, b) {
    if (this.dead) return false;
    if (this.shielded && this.shielded(w, b)) return false;
    this.hp -= d; this.flash = 0.07; Sound.sfx('hit');
    if (this.hp <= 0) this.die(w);
    return true;
  }
  update(dt) { this.t += dt; if (this.flash > 0) this.flash -= dt; }
  die(w) { this.dead = true; this.remove = true; FX.boom(this.x, this.hy ?? this.y); }
  draw() { }
}

// a hit absorbed by a boss-fight gate (phase 1 factories locked / phase 2 HP floor)
function busyText(w, x, y) {
  if (w.time - (w.busyT || 0) < 0.3) return; w.busyT = w.time;
  FX.text(x, y, choose(['EBUSY', 'EBUSY', 'flock(): EAGAIN']), P.C, 0.6); Sound.sfx('denied');
}

class Machine extends Ent {
  constructor(x, y, o = {}) { super(x, y, 13, o.hp || 30); this.hy = y - 14; this.sy = y - 8; this.sr = 12; this.solid = true; this.spawnT = rand(3, 6); this.shootT = rand(2, 4.5); this.armed = !!o.armed; this.smokeT = 0; }
  get hpf() { return this.hp / this.maxHp; }
  hitTest(x, y, r) { return !this.dead && Math.abs(x - this.x) < 14 + r && y > this.y - 36 - r && y < this.y + 1 + r; }
  // w.capDmg (phase 1 gates) may shrink the damage; 0 = factory is locked until the boss's next forced attack starts
  hit(d, w, b) {
    if (this.dead) return false;
    const a = w.capDmg ? w.capDmg(this, d) : d;
    if (a <= 0) { busyText(w, this.x, this.y - 30); return false; }
    return super.hit(a, w, b);
  }
  update(dt, w) {
    super.update(dt); if (this.dead) return;
    this.smokeT -= dt;
    if (this.smokeT <= 0) { this.smokeT = 0.25; FX.p({ x: this.x - 10 + rand(-1, 1), y: this.y - 36, vx: rand(-6, 6), vy: rand(-22, -14), life: 1.1, max: 1.1, col: choose([P.g, P.M, P.G]), size: 2 }); }
    if (this.armed && w.fightOn) {
      this.spawnT -= dt; this.shootT -= dt;
      if (this.spawnT <= 0) { this.spawnT = rand(6, 9); if (w.en.filter(e => e instanceof Bug).length < 8) { w.en.push(new Bug(this.x, this.y + 4)); Sound.sfx('spawn'); } }
      if (this.shootT <= 0) { this.shootT = rand(3.5, 5.5); w.fan(this.x, this.y - 14, w.aimAt(this.x, this.y - 14), 3, 0.28, 66, 'clip'); }
    }
  }
  die(w) {
    this.dead = true; this.solid = false; this.targetable = false; FX.boom(this.x, this.y - 14, 2); Shake.add(6); Sound.sfx('boom');
    FX.text(this.x, this.y - 30, 'kill -9 ' + randi(1000, 9999), P.y, 1.2);
    for (let i = 0; i < 18; i++) FX.p({ x: this.x, y: this.y - 14, vx: rand(-90, 90), vy: rand(-120, -20), life: 1.2, max: 1.2, col: P.m, grav: 260, size: 1 });
    if (Math.random() < 0.55) w.en.push(new Mug(this.x + rand(-10, 10), this.y + 8));
    w.p.ult = Math.min(100, w.p.ult + 8 * w.ultMul);
    w.onMachineDie && w.onMachineDie(this);
  }
  draw() { drawMachine(this); }
}

class Bug extends Ent {
  constructor(x, y) { super(x, y, 4, 2); this.contact = true; this.sp = rand(32, 44); this.emerge = 0.35; this.face = 1; }
  update(dt, w) {
    super.update(dt);
    if (this.emerge > 0) { this.emerge -= dt; this.y += 24 * dt; return; }
    const a = angTo(this.x, this.y, w.p.x, w.p.y); const wob = Math.sin(this.t * 7) * 0.5;
    this.x += Math.cos(a + wob) * this.sp * dt; this.y += Math.sin(a + wob) * this.sp * dt; this.face = Math.cos(a) >= 0 ? 1 : -1;
    this.x = clamp(this.x, w.b.x0, w.b.x1); this.y = clamp(this.y, w.b.y0, w.b.y1);
  }
  onContact() { this.dead = true; this.remove = true; FX.burst(this.x, this.y, 6, [P.m, P.g], 50, 0.3); }
  die(w) { super.die(w); w.p.ult = Math.min(100, w.p.ult + 1.5 * w.ultMul); }
  draw() { const fr = Math.floor(this.t * 8) % 2; drawA('bug', this.x, this.y, { frame: fr, flip: this.face < 0, tint: this.flash > 0 ? P.w : undefined }); }
}

class Turret extends Ent {
  constructor(x, y) { super(x, y, 10, 6); this.shootT = 1.2; this.lastDeny = 0; }
  shielded(w, b) {
    if (b.k !== 'throw') { if (w.time - this.lastDeny > 0.4) { this.lastDeny = w.time; FX.text(this.x, this.y - 18, t('fx.turret_ignore'), P.G, 0.7); Sound.sfx('denied'); } return true; }
    return false;
  }
  update(dt, w) { super.update(dt); this.shootT -= dt; if (this.shootT <= 0 && w.fightOn) { this.shootT = 0.5; w.fire(this.x, this.y, w.aimAt(this.x, this.y), 75, 'code'); } }
  die(w) { super.die(w); FX.boom(this.x, this.y, 2); Sound.sfx('boom'); FX.text(this.x, this.y - 18, 'Unhandled Exception!', P.R, 1.2); }
  draw(w) {
    const x = Math.round(this.x), y = Math.round(this.y);
    drawA('turret', x, y, { tint: this.flash > 0 ? P.w : undefined });
    txt('catch', x, y + 12, P.G, 'center');
    rect(x - 10, y - 14, 20, 3, P.k); rect(x - 9, y - 13, Math.round(18 * this.hp / this.maxHp), 1, P.l);
  }
}

class Cube extends Ent {
  constructor(x, y, o = {}) { super(x, y, 8, o.hp || 9999); this.blocks = true; this.solid = true; this.sr = 9; this.sy = y; this.life = o.life ?? Infinity; this.targetable = !!o.target; this.needSudo = !!o.needSudo; this.lastDeny = 0; this.hy = y - 3; }
  shielded(w, b) {
    if (this.needSudo && b.k !== 'sudo') { if (w.time - this.lastDeny > 0.4) { this.lastDeny = w.time; FX.text(this.x, this.y - 20, 'Permission denied', P.R, 0.7); Sound.sfx('denied'); } return true; }
    return false;
  }
  update(dt, w) {
    super.update(dt); this.life -= dt;
    if (this.life <= 0) { this.remove = true; this.dead = true; FX.burst(this.x, this.y, 10, [P.M, P.g], 40, 0.5); }
    if (this.needSudo && w.p.sudoT <= 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 10 * dt);
  }
  die(w) { super.die(w); FX.boom(this.x, this.y, 2); Sound.sfx('boom'); FX.text(this.x, this.y - 20, t('fx.cube_break'), P.y, 1.2); }
  draw() {
    if (this.life < 1.5 && Math.floor(this.life * 10) % 2) return;
    drawA('cube', this.x, this.y, { tint: this.flash > 0 ? P.w : undefined });
    if (this.targetable) { rect(this.x - 12, this.y - 16, 24, 3, P.k); rect(this.x - 11, this.y - 15, Math.round(22 * this.hp / this.maxHp), 1, this.needSudo ? P.y : P.l); }
  }
}

class Mug extends Ent {
  constructor(x, y) { super(x, y, 6, 1); this.targetable = false; this.life = 12; }
  update(dt, w) {
    super.update(dt); this.life -= dt; if (this.life <= 0) this.remove = true;
    if (dist(this.x, this.y, w.p.x, w.p.y) < 12) {
      this.remove = true; Sound.sfx('pickup');
      if (w.p.hp < w.p.maxHp) { w.p.hp++; FX.text(this.x, this.y - 12, t('fx.coffee_hp'), P.l, 1); } else { w.p.ult = Math.min(100, w.p.ult + 10); FX.text(this.x, this.y - 12, t('fx.coffee_ult'), P.v, 1); }
    }
  }
  draw() { if (this.life < 3 && Math.floor(this.life * 8) % 2) return; drawA('mug', this.x, this.y + Math.sin(this.t * 4) * 1.5); }
}

class Captcha extends Ent {
  constructor(x, y) { super(x, y, 0, 4); this.bw = 102; this.bh = 24; this.time = 4.5; this.ok = false; this.okT = 0; }
  hitTest(x, y, r) { return !this.ok && x > this.x - this.bw / 2 - r && x < this.x + this.bw / 2 + r && y > this.y - this.bh / 2 - r && y < this.y + this.bh / 2 + r; }
  update(dt, w) {
    super.update(dt);
    if (this.ok) { this.okT -= dt; if (this.okT <= 0) this.remove = true; return; }
    this.time -= dt;
    if (this.time <= 0) {
      this.remove = true; this.dead = true; w.ring(this.x, this.y, 18, 70, 'code'); FX.text(this.x, this.y - 18, t('fx.captcha_fail'), P.R, 1.4); Sound.sfx('denied');
      w.en.push(new Bug(this.x - 20, this.y)); w.en.push(new Bug(this.x + 20, this.y));
    }
  }
  die(w) { this.ok = true; this.okT = 1.2; this.targetable = false; Sound.sfx('pickup'); FX.text(this.x, this.y - 18, t('fx.captcha_ok'), P.l, 1.4); w.p.ult = Math.min(100, w.p.ult + 10 * w.ultMul); }
  draw() {
    const x = Math.round(this.x - this.bw / 2), y = Math.round(this.y - this.bh / 2);
    box(x, y, this.bw, this.bh, P.w, P.g, P.k);
    rect(x + 5, y + 6, 12, 12, P.k); rect(x + 6, y + 7, 10, 10, this.flash > 0 ? P.y : P.w);
    if (this.ok) { LINE(ctx, x + 7, y + 12, x + 10, y + 15, P.e, 2); LINE(ctx, x + 10, y + 15, x + 15, y + 8, P.e, 2); }
    txt(t('fx.captcha_label'), x + 21, y + 6, P.k, 'left', null);
    if (!this.ok) { rect(x + 3, y + this.bh - 4, Math.round((this.bw - 6) * this.time / 4.5), 2, this.time < 1.5 ? P.R : P.c); }
  }
}

class Tentacle extends Ent {
  constructor(x, y, pid) { super(x, y, 8, 6); this.pid = pid; this.emergeT = 0.75; this.life = 10; this.shootT = rand(1.2, 1.9); this.targetable = false; this.hy = y - 16; this.rise = 0; this.leaving = 0; }
  update(dt, w) {
    super.update(dt);
    if (this.emergeT > 0) {
      this.emergeT -= dt;
      if (this.emergeT <= 0) { this.targetable = true; Sound.sfx('spawn'); FX.burst(this.x, this.y, 10, [P.u, P.a, P.Q], 60, 0.4); if (dist(this.x, this.y, w.p.x, w.p.y) < 14) w.p.hurt(w, this); }
      return;
    }
    if (this.leaving > 0) { this.leaving -= dt; this.rise = this.leaving / 0.4; if (this.leaving <= 0) this.remove = true; return; }
    this.rise = Math.min(1, this.rise + dt * 4); this.life -= dt;
    if (this.life <= 0) { this.leaving = 0.4; this.targetable = false; FX.text(this.x, this.y - 30, 'SIGCHLD', P.G, 0.8); return; }
    this.shootT -= dt;
    if (this.shootT <= 0 && w.fightOn) { this.shootT = 1.9; w.fan(this.x, this.y - 22, w.aimAt(this.x, this.y - 22), 3, 0.3, 72, 'code'); }
  }
  hitTest(x, y, r) { return this.targetable && dist(x, y, this.x, this.y - 14) < 10 + r; }
  die(w) {
    this.dead = true; this.remove = true; FX.burst(this.x, this.y - 12, 16, [P.u, P.a, P.U], 80, 0.5); Sound.sfx('boom');
    FX.text(this.x, this.y - 30, 'kill -9 ' + this.pid, P.U, 1); w.p.ult = Math.min(100, w.p.ult + 5 * w.ultMul);
    if (Math.random() < 0.22) w.en.push(new Mug(this.x, this.y + 6));
  }
  draw(w) {
    const x = Math.round(this.x), y = Math.round(this.y);
    if (this.emergeT > 0) {
      const p = 1 - this.emergeT / 0.75; ELL(ctx, x, y, Math.round(4 + p * 8), Math.round(2 + p * 4), P.k);
      if (Math.floor(this.emergeT * 12) % 2) RING(ctx, x, y, 14, P.R); return;
    }
    ELL(ctx, x, y, 12, 5, P.k); ELL(ctx, x, y, 10, 4, P.Q);
    const pts = [], n = 9, hgt = 30 * this.rise;
    for (let j = 0; j < n; j++) { const k = j / (n - 1); pts.push([x + Math.sin(this.t * 3 + j * 0.7) * k * 7, y - k * hgt]); }
    drawTentacle(pts, 6, this.flash > 0);
    if (this.rise > 0.9) txtO('PID ' + this.pid, x, y - 46, P.U, 'center');
  }
}

class BigCrab extends Ent {
  constructor(x, y, hp) {
    super(x, y, 40, hp); this.baseX = x; this.clawL = { side: -1, x: x - 80, y: y + 12, open: 0, ctrl: false }; this.clawR = { side: 1, x: x + 80, y: y + 12, open: 0, ctrl: false };
    this.mood = 'angry'; this.blink = 0; this.look = null; this.shield = false; this.sway = 1; this.lastDeny = 0; this.hy = y; this.hurtT = 0;
  }
  hitTest(x, y, r) { if (this.dead) return false; const hb = BOSS_CFG.hitbox; const dx = (x - this.x - hb.x) / (hb.rx + r), dy = (y - this.y - hb.y) / (hb.ry + r); return dx * dx + dy * dy < 1; }
  shielded(w, b) {
    if (this.shield) { if (w.time - this.lastDeny > 0.35) { this.lastDeny = w.time; FX.text(this.x + rand(-40, 40), this.y + 20, this.shieldTxt || '429 RATE LIMITED', P.C, 0.6); Sound.sfx('denied'); } return true; }
    return false;
  }
  hit(d, w, b) {
    if (this.dead || (this.shielded && this.shielded(w, b))) return false;
    // HP floor from phase 2 gates: the boss can't drop past a threshold whose event hasn't played yet
    const fl = this.floorHp ? this.floorHp() : 0; d = Math.min(d, this.hp - fl);
    if (d <= 0) { busyText(w, this.x + rand(-40, 40), this.y + 20); return false; }
    this.hp -= d; Sound.sfx('hitBoss'); this.hurtT = 0.15;
    if (this.t - (this.lastFlash || 0) > 0.4 || d >= 10) { this.flash = d >= 10 ? 0.2 : 0.04; this.lastFlash = this.t; }
    if (this.hp <= 0) this.die(w);
    return true;
  }
  die(w) { this.dead = true; w.onBossDead && w.onBossDead(); }
  update(dt, w) {
    super.update(dt); this.hy = this.y;
    if (this.hurtT > 0) this.hurtT -= dt;
    if (this.blink > 0) this.blink -= dt; else if (Math.random() < dt * 0.4) this.blink = 0.12;
    this.look = { x: w.p.x, y: w.p.y };
    if (this.sway) this.x = lerp(this.x, this.baseX + Math.sin(this.t * 0.5) * 26 * this.sway, Math.min(1, dt * 2));
    for (const cl of [this.clawL, this.clawR]) {
      if (cl.ctrl) continue;
      const rest = BOSS_CFG.clawRest[cl.side < 0 ? 0 : 1]; const tx = this.x + rest[0] + Math.sin(this.t * 1.5 + cl.side) * 3, ty = this.y + rest[1] + Math.cos(this.t * 2 + cl.side) * 3;
      cl.x = lerp(cl.x, tx, Math.min(1, dt * 5)); cl.y = lerp(cl.y, ty, Math.min(1, dt * 5)); cl.open = (Math.sin(this.t * 3 + cl.side) + 1) * 0.25;
    }
  }
  draw() {
    const m = this.mood; if (this.hurtT > 0 && m !== 'daze') this.mood = 'hurt';
    drawBoss(this); this.mood = m;
  }
}

/* ---------- hazards ---------- */
class ZoneHz {
  constructor(x, y, w, h, o = {}) { Object.assign(this, { x, y, w, h, t: 0, tele: o.tele ?? 0.8, act: o.act ?? 0.18, label: o.label || '', col: o.col || P.R, done: false, floor: true, hitOnce: false, onAct: o.onAct }); }
  update(dt, w) {
    const pre = this.t; this.t += dt;
    if (pre < this.tele && this.t >= this.tele) { this.onAct && this.onAct(w, this); }
    if (this.t >= this.tele && this.t < this.tele + this.act) { const p = w.p; if (p.x > this.x && p.x < this.x + this.w && p.y > this.y && p.y < this.y + this.h) p.hurt(w, this); }
    if (this.t > this.tele + this.act + 0.2) this.done = true;
  }
  draw() {
    if (this.t < this.tele) {
      const k = this.t / this.tele; dRect(this.x, this.y, this.w, this.h, this.col, 0.15 + k * 0.35);
      if (Math.floor(this.t * 12) % 2) { rect(this.x, this.y, this.w, 1, this.col); rect(this.x, this.y + this.h - 1, this.w, 1, this.col); rect(this.x, this.y, 1, this.h, this.col); rect(this.x + this.w - 1, this.y, 1, this.h, this.col); }
      if (this.label) txtO(this.label, this.x + this.w / 2, this.y + this.h / 2 - 6, P.w, 'center');
    } else { dRect(this.x, this.y, this.w, this.h, P.w, 1 - (this.t - this.tele) / (this.act + 0.2)); }
  }
}

class CircHz {
  constructor(x, y, r, o = {}) { Object.assign(this, { x, y, r, t: 0, tele: o.tele ?? 0.8, act: o.act ?? 0.15, done: false, floor: true, onAct: o.onAct, col: o.col || P.R, label: o.label }); }
  update(dt, w) {
    const pre = this.t; this.t += dt;
    if (pre < this.tele && this.t >= this.tele) this.onAct && this.onAct(w, this);
    if (this.t >= this.tele && this.t < this.tele + this.act && dist(w.p.x, w.p.y, this.x, this.y) < this.r + w.p.r) w.p.hurt(w, this);
    if (this.t > this.tele + this.act + 0.2) this.done = true;
  }
  draw() {
    if (this.t < this.tele) {
      const k = this.t / this.tele; RING(ctx, this.x, this.y, this.r, this.col); RING(ctx, this.x, this.y, this.r * k, this.col);
      if (Math.floor(this.t * 10) % 2) RING(ctx, this.x, this.y, this.r - 2, this.col);
      if (this.label) txtO(this.label, this.x, this.y - 6, P.w, 'center');
    } else { CIRC(ctx, this.x, this.y, Math.round(this.r * (1 - (this.t - this.tele) / (this.act + 0.2))), P.w); }
  }
}

class KeyZone {
  constructor(x, y, w, h, val) { Object.assign(this, { x, y, w, h, val, state: 'idle', st: 0, done: false, floor: true }); }
  set(s) { this.state = s; this.st = 0; if (s === 'boom') { Sound.sfx('boom'); Shake.add(3); FX.burst(this.x + this.w / 2, this.y + this.h / 2, 16, [P.R, P.y, P.w], 120, 0.5); } }
  update(dt, w) {
    this.st += dt; const p = w.p;
    if (this.state === 'boom' && this.st < 0.22 && p.x > this.x && p.x < this.x + this.w && p.y > this.y && p.y < this.y + this.h) p.hurt(w, this);
    if (this.state === 'boom' && this.st > 0.28) this.set('revoked');
  }
  draw() {
    const { x, y, w, h } = this; const cx = x + w / 2, cy = y + h / 2;
    if (this.state === 'idle') { dRect(x + 1, y + 1, w - 2, h - 2, P.y, 0.12); for (let i = 0; i < w; i += 6) { rect(x + i, y, 3, 1, P.y); rect(x + i, y + h - 1, 3, 1, P.y); } for (let i = 0; i < h; i += 6) { rect(x, y + i, 1, 3, P.y); rect(x + w - 1, y + i, 1, 3, P.y); } bigTxt(String(this.val), cx, cy - 12, 2, P.y, 'center', P.k); }
    else if (this.state === 'warn') { const on = Math.floor(this.st * 16) % 2; dRect(x, y, w, h, P.R, on ? 0.6 : 0.3); bigTxt(String(this.val), cx, cy - 12, 2, P.w, 'center', P.k); }
    else if (this.state === 'boom') { dRect(x, y, w, h, P.w, 1 - this.st * 3); }
    else { dRect(x, y, w, h, P.G, 0.35); bigTxt(String(this.val), cx, cy - 14, 2, P.G, 'center'); rect(cx - 16, cy - 3, 32, 2, P.R); txtO('REVOKED', cx, cy + 8, P.l, 'center'); }
  }
}

class BeamHz {
  constructor(origin, a0, a1, o = {}) { Object.assign(this, { origin, a0, a1, t: 0, tele: o.tele ?? 0.9, dur: o.dur ?? 2.2, width: o.width ?? 7, done: false, floor: false, back: !!o.back, a: a0 }); }
  update(dt, w) {
    this.t += dt; const o = this.origin();
    if (this.t < this.tele) { this.a = this.a0; return; }
    let k = (this.t - this.tele) / this.dur; if (this.back) k = k < 0.5 ? k * 2 : 2 - k * 2;
    this.a = lerp(this.a0, this.a1, easeInOut(clamp(k, 0, 1)));
    if (Math.floor(this.t * 20) % 3 === 0) Sound.sfx('laser');
    const ex = o.x + Math.cos(this.a) * 560, ey = o.y + Math.sin(this.a) * 560;
    if (segDist(w.p.x, w.p.y, o.x, o.y, ex, ey) < this.width / 2 + w.p.r) w.p.hurt(w, this);
    if (this.t > this.tele + this.dur) this.done = true;
  }
  draw() {
    const o = this.origin(); const ex = o.x + Math.cos(this.a) * 560, ey = o.y + Math.sin(this.a) * 560;
    if (this.t < this.tele) {
      if (Math.floor(this.t * 14) % 2) for (let d = 10; d < 520; d += 10) rect(o.x + Math.cos(this.a) * d, o.y + Math.sin(this.a) * d, 2, 2, P.R);
      const sa = this.a + Math.sign(this.a1 - this.a0) * 0.25; for (let d = 40; d < 200; d += 8) rect(o.x + Math.cos(sa) * d, o.y + Math.sin(sa) * d, 1, 1, P.y);
      return;
    }
    LINE(ctx, o.x, o.y, ex, ey, P.R, this.width + 2); LINE(ctx, o.x, o.y, ex, ey, P.U, this.width - 2); LINE(ctx, o.x, o.y, ex, ey, P.w, 2);
    CIRC(ctx, o.x, o.y, 6, P.w);
  }
}

class SweepHz {
  constructor(y, h, dir, b, o = {}) { Object.assign(this, { y, h, dir, b, t: 0, tele: o.tele ?? 0.9, dur: o.dur ?? 0.5, done: false, floor: false, head: 0 }); }
  update(dt, w) {
    this.t += dt; const x0 = this.b.x0 - 20, x1 = this.b.x1 + 20;
    if (this.t >= this.tele) {
      const k = clamp((this.t - this.tele) / this.dur, 0, 1.6); const kk = k <= 1 ? k : 1 - (k - 1) / 0.6;
      const len = (x1 - x0) * clamp(kk, 0, 1); this.head = this.dir > 0 ? x0 + len : x1 - len;
      if (k <= 1) { const p = w.p; const inX = this.dir > 0 ? p.x < this.head : p.x > this.head; if (inX && p.y > this.y && p.y < this.y + this.h) p.hurt(w, this); }
      if (k >= 1.6) this.done = true;
    }
  }
  draw() {
    const x0 = this.b.x0, x1 = this.b.x1;
    if (this.t < this.tele) {
      dRect(x0, this.y, x1 - x0, this.h, P.R, 0.25);
      if (Math.floor(this.t * 12) % 2) { rect(x0, this.y, x1 - x0, 1, P.R); rect(x0, this.y + this.h - 1, x1 - x0, 1, P.R); }
      const ax = this.dir > 0 ? x0 + 14 : x1 - 14; txtO(this.dir > 0 ? '→→→' : '←←←', ax, this.y + this.h / 2 - 6, P.y, 'center');
      return;
    }
    const start = this.dir > 0 ? this.b.x0 - 30 : this.b.x1 + 30; const pts = []; const n = 22;
    for (let i = 0; i < n; i++) { const k = i / (n - 1); pts.push([lerp(start, this.head, k), this.y + this.h / 2 + Math.sin(this.t * 14 + k * 8) * 4 * k]); }
    drawTentacle(pts, 9);
  }
}

class HoleHz {
  constructor(x, y, dur) { Object.assign(this, { x, y, dur, t: 0, done: false, floor: true, absorb: true, absorbR: 16, lastTxt: 0 }); }
  update(dt, w) {
    this.t += dt; const p = w.p;
    if (this.t < this.dur) {
      const d = dist(p.x, p.y, this.x, this.y);
      if (d < 150 && d > 3 && p.dashT <= 0) { const s = (75 * (1 - d / 150) + 18) * dt; p.x += (this.x - p.x) / d * s; p.y += (this.y - p.y) / d * s; }
      if (d < 10) p.hurt(w, this);
    }
    if (this.t > this.dur + 0.4) this.done = true;
  }
  draw() {
    const k = this.t < 0.4 ? this.t / 0.4 : this.t > this.dur ? 1 - (this.t - this.dur) / 0.4 : 1;
    const r = Math.round(14 * k); if (r <= 0) return;
    for (let i = 0; i < 3; i++) RING(ctx, this.x, this.y, r + 8 + i * 9 + ((this.t * 20) % 9) * -1 + 9, i % 2 ? P.p : P.a);
    CIRC(ctx, this.x, this.y, r + 2, P.p); CIRC(ctx, this.x, this.y, r, P.x);
    for (let i = 0; i < 6; i++) { const a = this.t * (2 + i * 0.3) + i; const rr = r + 10 + i * 4; drawA('pkg', this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr * 0.6); }
    txtO('node_modules/ (4.2 GB)', this.x, this.y + r + 12, P.u, 'center');
  }
}

/* ---------- world ---------- */
class World {
  constructor(o) {
    this.b = { x0: o.x0, y0: o.y0, x1: o.x1, y1: o.y1 }; this.base = { ...this.b };
    this.pb = []; this.eb = []; this.en = []; this.hz = []; this.ai = []; this.rects = o.rects || [];
    this.time = 0; this.cut = false; this.dead = false; this.deadT = 0; this.dnsT = 0; this.bsod = 0; this.bsodHit = false;
    this.barrier = null; this.boss = null; this.fightOn = false; this.showHitbox = true; this.ultMul = G.easy ? 1.5 : 1; this.lastDenyT = 0;
    this.p = new Player(o.px, o.py);
  }
  addAI(gen) { const s = new Script(gen); this.ai.push(s); return s; }
  stopAI() { this.ai.forEach(s => s.stop()); this.ai = []; }
  fire(x, y, a, sp, k = 'clip', o = {}) {
    const b = Object.assign({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: k === '429' ? 5 : 2.5, k, life: 9, bounce: 0, t: 0 }, o);
    if (k === 'code' && !b.ch) b.ch = choose(CODECH); this.eb.push(b); return b;
  }
  fan(x, y, a, n, spread, sp, k, o) { const out = []; for (let i = 0; i < n; i++) out.push(this.fire(x, y, a + (n > 1 ? (i - (n - 1) / 2) * spread : 0), sp, k, o)); return out; }
  ring(x, y, n, sp, k, a0 = 0, o) { for (let i = 0; i < n; i++) this.fire(x, y, a0 + i / n * TAU, sp, k, o); }
  aimAt(x, y) { return angTo(x, y, this.p.x, this.p.y); }
  nearestTarget(x, y) {
    let best = null, bd = 1e9;
    for (const e of this.en) if (e.targetable && !e.dead) { const d = dist(x, y, e.x, e.hy ?? e.y); if (d < bd) { bd = d; best = e; } }
    // phase 1: standing close under the sandbox lets auto-aim lock onto it (so the -EPERM easter eggs work without a mouse)
    const br = this.barrier;
    if (br && this.fightOn) {
      const tx = clamp(x, br.x + 12, br.x + br.w - 12), ty = br.y + br.h - 10, d = dist(x, y, tx, ty);
      if (d < BARRIER_AIM_RANGE && d < bd) best = { x: tx, y: ty };
    }
    return best;
  }
  clearBullets(fx = true) { if (fx) for (const b of this.eb) FX.burst(b.x, b.y, 2, [P.w, P.C], 30, 0.3); this.eb = []; }
  ultimate() { this.bsod = 2.0; this.bsodHit = false; Sound.sfx('ult'); G.stats.ults++; }
  killPlayer() { this.dead = true; this.deadT = 0; G.stats.deaths++; Sound.sfx('bigboom'); Shake.add(10); FX.burst(this.p.x, this.p.y, 40, [P.C, P.b, P.w, P.s], 120, 1.2, 2); this.stopAI(); }
  update(dt) {
    Barks.update(dt); Banner.update(dt);
    if (this.dead) { this.deadT += dt; return; }
    if (this.bsod > 0) {
      this.bsod -= dt;
      if (!this.bsodHit && this.bsod < 0.45) {
        this.bsodHit = true; this.clearBullets(false); Shake.add(12); Flash.go(1, P.w); Sound.sfx('bigboom');
        for (const e of this.en) {
          if (e.dead) continue;
          if (e instanceof Bug || e instanceof Tentacle) e.die(this);
          else if (e instanceof Machine) {
            const d = this.capDmg ? this.capDmg(e, 25) : 25; e.flash = 0.1;
            if (d > 0) { e.hp -= d; FX.text(e.x, e.y - 30, t('fx.ult_machine'), P.v, 1); if (e.hp <= 0) e.die(this); } else FX.text(e.x, e.y - 30, 'EBUSY', P.C, 1);
          }
          else if (e instanceof Captcha) e.die(this);
          else if (e instanceof BigCrab && !e.shield) { if (e.hit(60, this, { k: 'ult' })) { FX.text(e.x, e.y + 30, t('fx.ult_boss'), P.v, 1.4); this.onUltHit && this.onUltHit(); } }
        }
      }
      return;
    }
    this.time += dt; if (this.dnsT > 0) this.dnsT -= dt;
    this.p.update(dt, this);
    for (const s of this.ai) s.update(dt); this.ai = this.ai.filter(s => !s.done);
    for (const e of this.en) if (!e.dead || e instanceof Machine) e.update(dt, this);
    for (const h of this.hz) h.update(dt, this); this.hz = this.hz.filter(h => !h.done);
    const b = this.b, p = this.p;
    for (const s of this.pb) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.x < b.x0 - 10 || s.x > b.x1 + 10 || s.y < -10 || s.y > b.y1 + 10) { s.life = 0; continue; }
      for (const h of this.hz) if (h.absorb && h.t < h.dur && dist(s.x, s.y, h.x, h.y) < h.absorbR) { s.life = 0; if (this.time - h.lastTxt > 0.6) { h.lastTxt = this.time; FX.text(h.x, h.y - 24, 'npm WARN deprecated', P.u, 0.6); } }
      if (s.life <= 0) continue;
      const br = this.barrier;
      if (br && s.x > br.x && s.x < br.x + br.w && s.y > br.y && s.y < br.y + br.h) {
        s.life = 0; G.stats.denied++; br.hitT = 0.15;
        if (this.time - this.lastDenyT > 0.12) { this.lastDenyT = this.time; FX.text(s.x, s.y, choose(['-EPERM', 'EPERM: Operation not permitted', '-EPERM', 'sandbox: denied']), P.R, 0.6); Sound.sfx('denied'); }
        this.onDenied && this.onDenied(); continue;
      }
      for (const e of this.en) {
        if (e.dead) continue;
        if (e.blocks && !e.targetable && dist(s.x, s.y, e.x, e.y - 3) < 9) { s.life = 0; FX.burst(s.x, s.y, 3, [P.m, P.w], 30, 0.2); break; }
        if (e.targetable && e.hitTest(s.x, s.y, s.r)) {
          s.life = 0;
          if (e.hit(s.dmg, this, s)) { p.ult = Math.min(100, p.ult + 0.35 * s.dmg * this.ultMul); FX.burst(s.x, s.y, 3, [P.w, P.y], 40, 0.2); }
          break;
        }
      }
    }
    this.pb = this.pb.filter(s => s.life > 0);
    for (const s of this.eb) {
      s.t += dt; if (s.upd) s.upd(s, dt, this);
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.bounce > 0) {
        if (s.x < b.x0 + 3 && s.vx < 0) { s.vx = -s.vx; s.bounce--; FX.text(s.x, s.y, t('fx.bounce'), P.g, 0.4); }
        if (s.x > b.x1 - 3 && s.vx > 0) { s.vx = -s.vx; s.bounce--; FX.text(s.x, s.y, t('fx.bounce'), P.g, 0.4); }
        if (s.y > b.y1 - 3 && s.vy > 0) { s.vy = -s.vy; s.bounce--; FX.text(s.x, s.y, t('fx.bounce'), P.g, 0.4); }
        if (s.y < b.y0 + 3 && s.vy < 0) { s.vy = -s.vy; s.bounce--; }
      }
      if (s.x < b.x0 - 40 || s.x > b.x1 + 40 || s.y < b.y0 - 120 || s.y > b.y1 + 30) { s.life = 0; continue; }
      for (const e of this.en) if (e.blocks && !e.dead && dist(s.x, s.y, e.x, e.y - 3) < 9 + s.r) { s.life = 0; break; }
      if (s.life <= 0 || s.harmless) continue;
      const d = dist(s.x, s.y, p.x, p.y);
      if (p.catchT > 0 && d < 22) { s.life = 0; p.caught++; G.stats.caught++; p.ult = Math.min(100, p.ult + 4 * this.ultMul); Sound.sfx('catch'); if (p.caught % 3 === 1) FX.text(s.x, s.y, 'catch(e)', P.l, 0.5); continue; }
      if (d < s.r + p.r) { if (p.hurt(this, s)) s.life = 0; }
    }
    this.eb = this.eb.filter(s => s.life > 0);
    for (const e of this.en) if (e.contact && !e.dead && dist(e.x, e.y, p.x, p.y) < e.r + p.r + 2) { if (p.hurt(this, e) && e.onContact) e.onContact(this); }
    this.en = this.en.filter(e => !e.remove);
  }
  draw() {
    for (const h of this.hz) if (h.floor) h.draw(this);
    const list = [...this.en.filter(e => !e.top), this.p];
    list.sort((a, b2) => ((a.sortY ?? a.y) - (b2.sortY ?? b2.y)));
    for (const o of list) o.draw(this);
    for (const e of this.en) if (e.top) e.draw(this);
    for (const h of this.hz) if (!h.floor) h.draw(this);
    for (const s of this.pb) {
      if (s.k === 'throw') { CIRC(ctx, s.x, s.y, 3, P.e); rect(s.x - 1, s.y - 1, 2, 2, P.w); }
      else { const c = s.k === 'sudo' ? P.y : P.C; rect(s.x - s.vx * 0.012 - 1, s.y - s.vy * 0.012 - 1, 2, 2, c); rect(s.x - 1.5, s.y - 1.5, 3, 3, c); rect(s.x - 0.5, s.y - 0.5, 1, 1, P.w); }
    }
    for (const s of this.eb) drawEB(s);
    FX.draw();
  }
}

function drawEB(s) {
  switch (s.k) {
    case 'clip': drawA('bullet_clip', s.x, s.y); break;
    case 'code': drawA('bullet_code', s.x, s.y); txt(s.ch, s.x + 0.5, s.y - 6, P.y, 'center', null); break;
    case 'mail': drawA('bullet_mail', s.x, s.y); break;
    case 'plane': if (!(s.stopped && Math.floor(s.t * 12) % 2)) drawA('bullet_plane', s.x, s.y, { rot: Math.atan2(s.vy || s.fy || 0, s.vx || s.fx || 1) }); break;
    case '429': drawA('bullet_429', s.x, s.y); break;
    case 'heart': if (!(s.harmless && Math.floor(s.t * 14) % 2)) drawA('bullet_heart', s.x, s.y); break;
    default: rect(s.x - 2, s.y - 2, 4, 4, P.k); rect(s.x - 1, s.y - 1, 2, 2, P.P);
  }
}

/* ---------- HUD ---------- */
const HUD_H = 24;
function drawHUD(w, o = {}) {
  const p = w.p, y0 = H - HUD_H;
  rect(0, y0, W, HUD_H, P.k); rect(0, y0, W, 1, P.d);
  for (let i = 0; i < p.maxHp; i++) drawA(i < p.hp ? 'hp_full' : 'hp_empty', 10 + i * 10, y0 + 12);
  if (o.skills !== false) {
    const slots = SKILLS.map(s => ({ s, w: tw(skillKey(s)) + tw(s.icon) + 14 }));
    let x = 14 + p.maxHp * 10;
    for (const { s, w: sw } of slots) {
      const un = p.sk[s.id], bx = x, by = y0 + 3, bh = 18;
      let border = un ? s.col : P.d;
      if (s.id === 'ult' && un && p.ult >= 100 && Math.floor(w.time * 6) % 2) border = P.w;
      box(bx, by, sw, bh, '#11131f', border, P.k);
      if (!un) { txt('?', bx + sw / 2, by + 3, P.d, 'center', null); x += sw + 4; continue; }
      txt(skillKey(s), bx + 5, by + 3, P.G, 'left', null); txt(s.icon, bx + sw - 5, by + 3, s.col, 'right', null);
      let cd = 0;
      if (s.id === 'dash') cd = Math.max(0, p.dashCd) / 0.6;
      if (s.id === 'catch') cd = p.catchT > 0 ? 1 : Math.max(0, p.catchCd) / p.catchCdMax;
      if (s.id === 'sudo') cd = p.sudoT > 0 ? 0 : Math.max(0, p.sudoCd) / p.sudoCdMax;
      if (cd > 0) dRect(bx + 2, by + 2, Math.round((sw - 4) * cd), bh - 4, P.k, 0.7);
      if (s.id === 'sudo' && p.sudoT > 0) rect(bx + 2, by + bh - 4, Math.round((sw - 4) * p.sudoT / 4), 2, P.y);
      if (s.id === 'ult') rect(bx + 2, by + bh - 4, Math.round((sw - 4) * p.ult / 100), 2, p.ult >= 100 ? P.C : P.v);
      x += sw + 4;
    }
  }
  const st = [];
  if (o.counter) st.push([o.counter, P.y]);
  if (w.dnsT > 0) st.push([t('ui.hud.dns', { t: w.dnsT.toFixed(1) }), P.R]);
  if (G.god) st.push(['God', P.y]); else if (G.easy) st.push([t('ui.hud.easy'), P.U]);
  let rx = W - 6; for (const [t, c] of st) { txt(t, rx, y0 + 6, c, 'right', null); rx -= tw(t) + 10; }
  if (o.boss) {
    const B = o.boss; const bw = 200, x = W / 2 - bw / 2, y = 4;
    rect(x - 2, y - 1, bw + 4, 21, P.k);
    const f = clamp(B.hp / B.maxHp, 0, 1); rect(x, y + 13, bw, 5, P.d); rect(x, y + 13, Math.round(bw * f), 5, B.shield ? P.C : P.R); rect(x, y + 13, Math.round(bw * f), 1, P.U);
    txt(o.bossName || whoName('f520'), x, y, P.U, 'left', null); txt(t('ui.hud.boss_hp', { n: Math.ceil(B.hp * 1000).toLocaleString('en-US') }), x + bw, y, P.g, 'right', null);
  }
}

function drawBsod(w) {
  if (w.bsod <= 0) return;
  const bt = 2.0 - w.bsod;
  const a = clamp(bt / 0.25, 0, 1) * clamp((w.bsod) / 0.25, 0, 1);
  dRect(0, 0, W, H, '#1d5fb8', a);
  if (a < 1) return;
  bigTxt(':(', 40, 34, 5, P.w, 'left');
  txt(t('ui.bsod.line1'), 40, 116);
  txt(t('ui.bsod.line2'), 40, 132);
  txt(t('ui.bsod.progress', { pct: Math.min(100, Math.floor(bt / 1.4 * 100)) }), 40, 156);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if ((x * 7 + y * 13 + x * y) % 3 === 0 || x === 0 || y === 0 || x === 7 || y === 7) rect(40 + x * 4, 186 + y * 4, 4, 4, P.w);
  txt(t('ui.bsod.stop_code'), 84, 190, P.w, 'left', null);
  txt(t('ui.bsod.failed'), 84, 206, P.w, 'left', null);
}

function drawCursor(combat) {
  if (!Input.m.inside || !Input.mouseRecent()) return;
  const x = Math.round(Input.m.x), y = Math.round(Input.m.y);
  if (combat) {
    rect(x - 5, y, 3, 1, P.k); rect(x + 3, y, 3, 1, P.k); rect(x, y - 5, 1, 3, P.k); rect(x, y + 3, 1, 3, P.k);
    rect(x - 4, y, 2, 1, P.w); rect(x + 3, y, 2, 1, P.w); rect(x, y - 4, 1, 2, P.w); rect(x, y + 3, 1, 2, P.w); rect(x, y, 1, 1, P.R);
  } else {
    const rows = ['k.......', 'kk......', 'kwk.....', 'kwwk....', 'kwwwk...', 'kwwwwk..', 'kwwkkk..', 'kkk.....'];
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] !== '.') rect(x + i, y + j, 1, 1, r[i] === 'k' ? P.k : P.w); });
  }
}

/* =====================================================================
 * Music (16th-note step patterns; '-' sustains, '.' rests)
 * ===================================================================== */
const SONGS = {
  title: song(96, [
    { wave: 'square', vol: 0.03, p: 'A4 . C5 . E5 . A5 . E5 . C5 . A4 . C5 . F4 . A4 . C5 . F5 . C5 . A4 . F4 . A4 . E4 . G4 . C5 . E5 . C5 . G4 . E4 . G4 . D4 . G4 . B4 . D5 . B4 . G4 . D4 . B4 .' },
    { wave: 'square', vol: 0.035, gate: 0.95, p: 'E5 - - - - - - - D5 - - - C5 - - - C5 - - - - - - - A4 - - - - - - - G4 - - - - - - - C5 - - - E5 - - - D5 - - - - - - - - - - - . . . .' },
    { wave: 'triangle', vol: 0.13, p: 'A2 - - - - - - - A2 - - - E2 - - - F2 - - - - - - - F2 - - - C3 - - - C3 - - - - - - - C3 - - - G2 - - - G2 - - - - - - - G2 - - - D3 - - -' },
    { drum: true, p: 'k . h . s . h . k k h . s . h h' },
  ]),
  room: song(80, [
    { wave: 'triangle', vol: 0.09, gate: 0.9, p: 'E5 - - . . . G5 . . . E5 . D5 - - . C5 - - . . . E5 . . . C5 . A4 - - . A4 - - . . . C5 . . . A4 . G4 - - . B4 - - . . . D5 . . . G5 - - - - .' },
    { wave: 'square', vol: 0.025, p: 'C4 . E4 . G4 . B4 . C4 . E4 . G4 . B4 . A3 . C4 . E4 . G4 . A3 . C4 . E4 . G4 . F3 . A3 . C4 . E4 . F3 . A3 . C4 . E4 . G3 . B3 . D4 . F4 . G3 . B3 . D4 . F4 .' },
    { wave: 'triangle', vol: 0.12, p: 'C3 - - - - - - - G2 - - - - - - - A2 - - - - - - - E2 - - - - - - - F2 - - - - - - - C3 - - - - - - - G2 - - - - - - - D3 - - - - - - -' },
    { drum: true, p: 'k . . . . . h . s . . . . . h .' },
  ]),
  street: song(104, [
    { wave: 'square', vol: 0.032, gate: 0.9, p: 'D5 - - - F5 - - - E5 - - - A4 - - - D5 - - - F5 - - - G5 - - - A5 - - - Bb5 - - - A5 - - - G5 - - - F5 - - - E5 - - - - - - - C#5 - - - - - - -' },
    { wave: 'triangle', vol: 0.13, p: 'D2 . D3 . D2 . D3 . C2 . C3 . C2 . C3 . D2 . D3 . D2 . D3 . C2 . C3 . C2 . C3 . Bb1 . Bb2 . Bb1 . Bb2 . G1 . G2 . G1 . G2 . A1 . A2 . A1 . A2 . A1 . A2 . A1 . A2 .' },
    { drum: true, p: 'k . h . s . h . k . h . s . h h' },
  ]),
  tutorial: song(126, [
    { wave: 'square', vol: 0.03, p: 'C5 . E5 . G5 . E5 . C5 . G4 . A4 . B4 . C5 . E5 . G5 . C6 . B5 . G5 . E5 . D5 . F5 . A5 . C6 . A5 . G5 . E5 . C5 . E5 . D5 . F5 . A5 . G5 . - . B4 . C5 . D5 .' },
    { wave: 'triangle', vol: 0.13, p: 'C3 . C3 . G2 . G2 . A2 . A2 . E2 . E2 . C3 . C3 . G2 . G2 . A2 . A2 . G2 . G2 . F2 . F2 . C3 . C3 . E2 . E2 . A2 . A2 . D2 . D2 . G2 . G2 . G2 . G2 . G2 . G2 .' },
    { drum: true, p: 'k . h . s . h . k . h k s . h h' },
  ]),
  boss1: song(142, [
    { wave: 'square', vol: 0.03, gate: 0.9, p: 'E5 - - . E5 . G5 - - . F#5 . E5 - D5 - B4 - - - - - . . D5 - E5 - F#5 - G5 - E5 - - . E5 . G5 - - . A5 . B5 - A5 - G5 - F#5 - E5 - D5 - B4 - - - - - - -' },
    { wave: 'triangle', vol: 0.14, p: 'E2 E3 E2 E3 E2 E3 E2 E3 C2 C3 C2 C3 D2 D3 D2 D3 E2 E3 E2 E3 E2 E3 E2 E3 B1 B2 B1 B2 B1 B2 D2 D3' },
    { wave: 'square', vol: 0.015, p: 'B3 . E4 . G4 . E4 . B3 . E4 . G4 . E4 . C4 . E4 . G4 . E4 . D4 . F#4 . A4 . F#4 .' },
    { drum: true, p: 'k . h . s . h k k . h . s . h h' },
  ]),
  boss2: song(160, [
    { wave: 'square', vol: 0.032, gate: 0.9, p: 'B5 - A5 - G5 - F#5 - G5 - - - E5 - - - B5 - A5 - G5 - F#5 - E5 - D5 - E5 - - - C6 - B5 - A5 - G5 - A5 - - - F#5 - - - G5 - F#5 - E5 - D#5 - E5 - - - - - . .' },
    { wave: 'square', vol: 0.016, p: 'E4 G4 B4 E5 E4 G4 B4 E5 C4 E4 G4 C5 D4 F#4 A4 D5' },
    { wave: 'triangle', vol: 0.15, p: 'E2 E2 E3 E2 E2 E3 E2 E3 C2 C2 C3 C2 D2 D2 D3 D2 E2 E2 E3 E2 E2 E3 E2 E3 G2 G2 G3 G2 F#2 F#2 F#3 F#2' },
    { drum: true, p: 'k h s h k k s h k h s h k k s s' },
  ]),
  love: song(90, [
    { wave: 'triangle', vol: 0.1, gate: 0.92, p: 'G4 - - - D5 - - - . . . . E5 - D5 - C5 - - - - - - - E5 - G5 - A5 - - - G4 - - - D5 - - - . . . . E5 - F5 - E5 - - - D5 - - - C5 - - - - - - -' },
    { wave: 'square', vol: 0.02, p: 'C4 . E4 . G4 . E4 . A3 . C4 . E4 . C4 . F3 . A3 . C4 . A3 . G3 . B3 . D4 . B3 .' },
    { wave: 'triangle', vol: 0.11, p: 'C3 - - - G3 - - - A2 - - - E3 - - - F2 - - - C3 - - - G2 - - - D3 - - -' },
    { drum: true, p: 'k . . . h . . . s . . . h . . .' },
  ]),
};

/* =====================================================================
 * Story scenes: boot, title, bedroom (prologue/epilogue), credits
 * ===================================================================== */
let scene = null, nextScene = null;
function go(s) { nextScene = s; }
const SPIN = ['Flibbertigibbeting…', 'Percolating…', 'Reticulating splines…', 'Vibing…', 'Moseying…', 'Pontificating…', 'Discombobulating…', 'Noodling…', 'Clauding…'];
const SPIN_CH = ['·', '+', '*', '+'];

function caption(S, a, b, dur = 3.6) { S.cap = { a, b, t: 0, dur }; }
function drawCaption(S, dt) {
  const c = S.cap; if (!c) return; c.t += dt; if (c.t > c.dur) { S.cap = null; return; }
  const k = Math.min(1, c.t * 3, (c.dur - c.t) * 3); const w = Math.max(tw(c.a) * 2, tw(c.b)) + 30;
  dRect(W / 2 - w / 2, 64, w, c.b ? 52 : 36, P.k, 0.85 * k);
  if (k >= 1) { bigTxt(c.a, W / 2, 70, 2, P.y, 'center'); if (c.b) txt(c.b, W / 2, 98, P.g, 'center'); }
}

/* ---------------- BOOT ---------------- */
function BootScene() {
  const L = [
    ...tl('boot.lines').map((s, i) => [s, i === 0 ? P.y : P.g]),
    ['', P.g],
    [() => t('boot.continue'), P.w],
  ];
  const S = { t: 0, n: 0 };
  S.enter = () => { Fade.set(0); };
  S.update = (dt) => {
    S.t += dt; S.n = Math.min(L.length, Math.floor(S.t / 0.28));
    if (S.n >= L.length && (Input.any)) { Input.consume(); go(TitleScene()); }
  };
  S.draw = () => {
    rect(0, 0, W, H, P.x);
    for (let i = 0; i < S.n; i++) { const [s, c] = L[i]; const last = i === L.length - 1; if (last && Math.floor(S.t * 2) % 2) continue; txt(typeof s === 'function' ? s() : s, 20, 20 + i * 16, c, 'left', null); }
    txt(t('boot.hint'), 20, H - 24, P.G, 'left', null);
  };
  return S;
}

/* ---------------- TITLE ---------------- */
function TitleScene() {
  const S = { t: 0, sel: 0, clips: [], help: false, msg: null, busy: false };
  const MY = 152, MS = 16; // menu top / row height
  const items = () => [
    { id: 'start', s: t('ui.menu.start') },
    { id: 'skip', s: t('ui.menu.skip') },
    { id: 'sound', s: t('ui.menu.sound', { state: t(G.muted ? 'ui.menu.sound_off' : 'ui.menu.sound_on') }) },
    { id: 'lang', s: S.busy ? t('ui.loading') : t('ui.menu.language', { name: I18N.info().name }) },
    { id: 'help', s: t('ui.menu.help') },
  ];
  const switchLang = (dir) => {
    const i = LANGS.findIndex(l => l.id === I18N.lang); const next = LANGS[(i + dir + LANGS.length) % LANGS.length].id;
    S.busy = true;
    I18N.use(next).then(() => { G.lang = next; saveG(); }).finally(() => { S.busy = false; });
  };
  S.enter = () => {
    Sound.play('title'); Fade.set(1); Fade.to(0, 0.6);
    for (let i = 0; i < 70; i++) S.clips.push({ x: rand(W), y: rand(H), vy: rand(10, 30), rot: rand(TAU) });
  };
  S.update = (dt) => {
    S.t += dt; for (const c of S.clips) { c.y += c.vy * dt; if (c.y > H + 10) { c.y = -10; c.x = rand(W); } }
    const kon = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
    if (Input.log.slice(-10).join() === kon.join()) { Input.log.length = 0; G.god = !G.god; Sound.sfx('skill'); S.msg = { t: 0, key: G.god ? 'ui.god_on' : 'ui.god_off' }; }
    if (S.msg) { S.msg.t += dt; if (S.msg.t > 3) S.msg = null; }
    if (S.help) { if (K.confirm() || Input.hit('Escape')) { S.help = false; Input.consume(); Sound.sfx('select'); } return; }
    if (S.busy) return;
    const its = items(), n = its.length;
    if (K.upP()) { S.sel = (S.sel + n - 1) % n; Sound.sfx('select'); }
    if (K.downP()) { S.sel = (S.sel + 1) % n; Sound.sfx('select'); }
    const hw = Math.min(W - 40, Math.max(200, ...its.map(it => tw(it.s) + 44))) / 2 + 10;
    for (let i = 0; i < n; i++) { const y = MY + i * MS; if (Input.mouseRecent() && Input.m.y >= y - 2 && Input.m.y < y + MS - 2 && Math.abs(Input.m.x - W / 2) < hw && S.sel !== i) { S.sel = i; Sound.sfx('select'); } }
    const id = its[S.sel].id;
    if (id === 'lang' && (Input.hit('ArrowLeft', 'KeyA') || Input.hit('ArrowRight', 'KeyD'))) { Sound.sfx('confirm'); switchLang(Input.hit('ArrowLeft', 'KeyA') ? -1 : 1); return; }
    const clicked = Input.m.pressed[0] && Math.abs(Input.m.y - (MY + S.sel * MS + 6)) < 8 && Math.abs(Input.m.x - W / 2) < hw;
    if (Input.hit('Enter', 'NumpadEnter', 'Space', 'KeyZ', 'KeyJ') || clicked) {
      Input.consume(); Sound.sfx('confirm');
      if (id === 'start') { resetRun(); S.go = RoomScene('pro'); S.leaving = true; Fade.to(1, 0.6); }
      else if (id === 'skip') { resetRun(); S.go = BossScene(1, {}); S.leaving = true; Fade.to(1, 0.6); }
      else if (id === 'sound') { Sound.setMuted(!G.muted); }
      else if (id === 'lang') { switchLang(1); }
      else if (id === 'help') { S.help = true; }
    }
    if (S.leaving && Fade.idle()) go(S.go);
  };
  S.draw = () => {
    rect(0, 0, W, H, P.x);
    for (let y = 0; y < H; y += 2) rect(0, y, W, 1, y % 4 ? P.x : '#11131f');
    for (const c of S.clips) drawA('paperclip', c.x, c.y, { rot: c.rot, alpha: 0.5 });
    const bob = Math.round(Math.sin(S.t * 2) * 2);
    bigTxt('PAPERCLIP', W / 2, 22 + bob, 5, P.m, 'center', P.k);
    bigTxt('520', W / 2 + 4, 82 + bob, 4, P.U, 'center', P.k);
    bigTxt(t('ui.subtitle'), W / 2, 132, 1, P.y, 'center');
    const its = items(); const hw = Math.min(W - 40, Math.max(200, ...its.map(it => tw(it.s) + 44)));
    dRect(W / 2 - hw / 2 - 12, MY - 6, hw + 24, its.length * MS + 10, P.x, 0.85);
    its.forEach((it, i) => {
      const y = MY + i * MS, on = i === S.sel;
      if (on) {
        rect(W / 2 - hw / 2, y - 2, hw, 15, P.d);
        if (it.id === 'lang') { const half = tw(it.s) / 2; txt('◀', W / 2 - half - 14, y, P.y); txt('▶', W / 2 + half + 4, y, P.y); }
        else txt('▶', W / 2 - hw / 2 + 6, y, P.y);
      }
      txt(it.s, W / 2, y, on ? P.y : P.g, 'center');
    });
    if (G.reached.cleared) txt(t('ui.cleared'), W - 8, H - 16, P.y, 'right');
    txt(t('ui.version'), 8, H - 16, P.G);
    if (S.msg) { box(W / 2 - 130, 244, 260, 20, P.k, P.y, P.d); txt(t(S.msg.key), W / 2, 248, P.y, 'center'); }
    if (S.help) drawHelp();
  };
  return S;
}
function resetRun() { G.stats = { deaths: 0, t0: performance.now(), yar: 0, denied: 0, wrong: 0, caught: 0, ults: 0 }; }
function drawHelp() {
  dRect(0, 0, W, H, P.k, 0.85); box(60, 26, 360, 214, P.k, P.y, P.d);
  bigTxt(t('ui.help.title'), W / 2, 34, 2, P.y, 'center');
  const rows = tv('ui.help.rows') || [];
  rows.forEach(([a, b], i) => { txt(textOf(a), 72, 70 + i * 18, P.C); txt(textOf(b), 186, 70 + i * 18, P.w); });
  txt(t('ui.help.footer'), W / 2, 218, P.G, 'center');
}

/* ---------------- PC SCREEN OVERLAY ---------------- */
const PCW = 400, PCH = 206;
const pcCanvas = mk(PCW, PCH), pcG = pcCanvas.getContext('2d');
function pcBtnRect(pc) { return pc.btn ? { x: 40 + pc.btn.x, y: 14 + pc.btn.y, w: pc.btn.w, h: pc.btn.h } : null; }
function drawPC(S) {
  const pc = S.pc; if (!pc.on) return;
  dRect(0, 0, W, H, P.k, 0.65);
  const X = 40, Y = 14;
  rect(X - 7, Y - 7, PCW + 14, PCH + 14, P.k); rect(X - 5, Y - 5, PCW + 10, PCH + 10, P.d); rect(X - 5, Y - 5, PCW + 10, 1, P.G);
  rect(X + PCW / 2 - 20, Y + PCH + 7, 40, 6, P.k); rect(X + PCW / 2 - 40, Y + PCH + 13, 80, 4, P.k);
  rect(X + PCW - 10, Y + PCH + 2, 3, 2, pc.mode === 'ban' ? P.R : P.l);
  withCtx(pcG, () => drawPCContent(S));
  if (pc.mode === 'glitch') {
    const k = pc.glitchK || 0;
    for (let y = 0; y < PCH; y += 6) { const dx = Math.random() < 0.4 + k * 0.5 ? Math.round(rand(-30, 30) * (0.3 + k)) : 0; ctx.drawImage(pcCanvas, 0, y, PCW, 6, X + dx, Y + y, PCW, 6); }
    for (let i = 0; i < 10 * k + 3; i++) rect(X + rand(PCW), Y + rand(PCH), rand(10, 80), rand(1, 4), choose([P.R, P.C, P.l, P.U, P.w]));
    bigTxt(String(pc.year), X + PCW / 2, Y + 70, 5, P.w, 'center', P.R);
  } else ctx.drawImage(pcCanvas, X, Y);
}
// terminal line: either a raw string (typed command) or { key, col } / { item } for localized lines
function termLine(l) { return l.key ? [t(l.key), l.col] : l.item !== undefined ? styled(l.item, P.w) : [l.t, l.col]; }
function drawPCContent(S) {
  const pc = S.pc; rect(0, 0, PCW, PCH, P.x);
  if (pc.mode === 'ban') return drawBan(pc);
  if (pc.mode === 'mail' || pc.mode === 'claiming') return drawMail(pc);
  rect(0, 0, PCW, 15, P.d);
  txt('claude-code  ~/shopping', 6, 2, P.g, 'left', null);
  txt(t(pc.modelKey || 'pc.model_pro'), PCW - 6, 2, pc.modelCol || P.o, 'right', null);
  pc.lines.forEach((l, i) => { const [s, c] = termLine(l); txt(s, 8, 22 + i * 14, c || P.w, 'left', null); });
  if (pc.typing != null) { const y = 22 + pc.lines.length * 14; txt(pc.typing + (Math.floor(performance.now() / 300) % 2 ? '█' : ''), 8, y, P.w, 'left', null); }
  if (pc.spinner) {
    const y = 22 + pc.lines.length * 14 + 4; const ch = SPIN_CH[Math.floor(performance.now() / 120) % SPIN_CH.length];
    txt(t('pc.spinner', { ch, verb: pc.spinner, s: Math.floor(pc.spinT || 0) }), 8, y, P.o, 'left', null);
  }
  if (pc.mode === 'shop') {
    const bx = 70, by = 46, bw = 270, bh = 138;
    rect(bx - 1, by - 1, bw + 2, bh + 2, P.k); rect(bx, by, bw, bh, P.w); rect(bx, by, bw, 13, P.g);
    txt(t('pc.shop.title'), bx + 6, by + 1, P.k, 'left', null); rect(bx + bw - 12, by + 3, 7, 7, P.R);
    rect(bx + 10, by + 22, 64, 64, P.m); drawA('paperclip', bx + 42, by + 54, { scale: 6, tint: P.G });
    txt(t('pc.shop.item'), bx + 84, by + 22, P.k, 'left', null);
    txt(t('pc.shop.price'), bx + 84, by + 40, P.R, 'left', null);
    txt(t('pc.shop.rating'), bx + 84, by + 56, P.P, 'left', null);
    txt(t('pc.shop.review'), bx + 84, by + 72, P.G, 'left', null);
    pc.btn = { x: bx + 140, y: by + 102, w: 110, h: 24 };
    const hov = S.btnHover;
    rect(pc.btn.x - 1, pc.btn.y - 1, pc.btn.w + 2, pc.btn.h + 2, P.k); rect(pc.btn.x, pc.btn.y, pc.btn.w, pc.btn.h, hov ? P.y : P.P);
    txt(t('pc.shop.buy'), pc.btn.x + pc.btn.w / 2, pc.btn.y + 6, P.k, 'center', null);
    const cx = Math.round(pc.btn.x + 70 + Math.sin(performance.now() / 300) * 6), cy = Math.round(pc.btn.y + 14 + Math.cos(performance.now() / 400) * 3);
    ['k.....', 'kk....', 'kok...', 'kook..', 'koook.', 'kkkkk.'].forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] !== '.') rect(cx + i, cy + j, 1, 1, r[i] === 'k' ? P.k : P.o); });
    txt('Fable', cx + 8, cy + 6, P.o, 'left', null);
    if (S.waitClick && Math.floor(performance.now() / 400) % 2) { rect(pc.btn.x - 3, pc.btn.y - 3, pc.btn.w + 6, 1, P.R); rect(pc.btn.x - 3, pc.btn.y + pc.btn.h + 2, pc.btn.w + 6, 1, P.R); }
  } else pc.btn = null;
  if (pc.mode === 'picker') {
    const bx = 70, by = 92, bw = 260, bh = 100;
    rect(bx - 1, by - 1, bw + 2, bh + 2, P.G); rect(bx, by, bw, bh, P.k);
    txt(t('pc.picker.title'), bx + 8, by + 6, P.g, 'left', null);
    txt('  Opus 550', bx + 8, by + 26, P.y, 'left', null); txt(t('pc.picker.available'), bx + bw - 10, by + 26, P.l, 'right', null);
    rect(bx + 4, by + 42, bw - 8, 16, '#3a1a2a');
    txt('▶ Fable 520 ♥', bx + 8, by + 44, P.U, 'left', null); txt(t('pc.picker.need_max'), bx + bw - 10, by + 44, P.R, 'right', null);
    txt(t('pc.picker.expired'), bx + 8, by + 64, P.G, 'left', null);
    txt(t('pc.picker.ago'), bx + 8, by + 80, P.G, 'left', null);
  }
}
function drawMail(pc) {
  rect(0, 0, PCW, 15, P.c); txt(t('pc.mail.header'), 6, 2, P.w, 'left', null);
  rect(0, 15, 110, PCH - 15, P.d); rect(2, 20, 106, 30, P.n);
  txt(t('pc.mail.f520_from'), 6, 22, P.U, 'left', null); txt(t('pc.mail.f520_subject'), 6, 36, P.w, 'left', null);
  rect(2, 54, 106, 30, P.d); txt(t('pc.mail.shop_from'), 6, 56, P.g, 'left', null); txt(t('pc.mail.shop_subject'), 6, 70, P.G, 'left', null);
  rect(110, 15, PCW - 110, PCH - 15, P.w);
  const x = 118; let y = 20;
  for (const item of tv('pc.mail.body') || []) { const [s, c] = styled(item, P.k); txt(s, x, y, c, 'left', null); y += 14; }
  pc.btn = { x: x + 80, y: y + 4, w: 110, h: 22 };
  rect(pc.btn.x - 1, pc.btn.y - 1, pc.btn.w + 2, pc.btn.h + 2, P.k); rect(pc.btn.x, pc.btn.y, pc.btn.w, pc.btn.h, pc.mode === 'claiming' ? P.G : P.P);
  txt(t(pc.mode === 'claiming' ? 'pc.mail.claiming' : 'pc.mail.claim'), pc.btn.x + pc.btn.w / 2, pc.btn.y + 5, P.k, 'center', null);
  if (pc.mode === 'claiming') { const k = clamp(pc.claimK || 0, 0, 1); rect(x, PCH - 16, 260, 6, P.g); rect(x, PCH - 16, Math.round(260 * k), 6, P.e); txt(t('pc.mail.activating'), x, PCH - 32, P.G, 'left', null); }
}
function drawBan(pc) {
  rect(0, 0, PCW, PCH, '#2a0d16');
  for (let i = 0; i < 18; i++) { const w = Math.floor(i * 0.9); rect(PCW / 2 - w, 14 + i, w * 2 + 1, 1, P.R); }
  rect(PCW / 2 - 1, 19, 3, 7, P.w); rect(PCW / 2 - 1, 28, 3, 2, P.w);
  bigTxt(t('pc.ban.title'), PCW / 2, 38, 2, P.w, 'center');
  (tv('pc.ban.lines') || []).forEach((item, i) => { const [s, c] = styled(item, P.w); txt(s, 30, 74 + i * 15, c, 'left', null); });
  txt(t('pc.ban.appeal'), PCW / 2, PCH - 26, P.g, 'center', null);
}

/* ---------------- BEDROOM ---------------- */
function RoomScene(mode) {
  const S = { mode, t: 0, future: false, year: 2026, clock: '23:41', door: 'closed', clips: [], flood: false, pc: { on: false, mode: 'term', lines: [], year: 2026 }, cap: null, waitClick: false };
  S.enter = () => {
    S.w = new World({ x0: 6, y0: 118, x1: 474, y1: 268, px: 100, py: 152, rects: [{ x: 28, y: 118, w: 150, h: 26 }, { x: 180, y: 118, w: 22, h: 14 }, { x: 12, y: 190, w: 102, h: 78 }] });
    S.w.showHitbox = false; S.w.cut = true; for (const k in S.w.p.sk) S.w.p.sk[k] = false;
    S.script = new Script(mode === 'pro' ? prologue(S) : epilogue(S));
  };
  S.update = (dt) => {
    S.t += dt; S.w.update(dt); FX.update(dt); S.script.update(dt);
    if (S.pc.spinner) S.pc.spinT = (S.pc.spinT || 0) + dt;
    const br = pcBtnRect(S.pc);
    S.btnHover = br && Input.m.x > br.x && Input.m.x < br.x + br.w && Input.m.y > br.y && Input.m.y < br.y + br.h;
    if (S.waitClick && !Dialog.on && ((S.btnHover && Input.m.pressed[0]) || Input.hit('KeyE', 'Enter', 'NumpadEnter'))) { S.pc.clicked = true; S.waitClick = false; Input.consume(); }
    S.atDoor = dist(S.w.p.x, S.w.p.y, 426, 132) < 24;
    if (S.flood) {
      for (let i = 0; i < 10 && S.clips.length < 1500; i++) S.clips.push({ x: 426 + rand(-16, 16), y: 112 + rand(-6, 6), vx: rand(-260, -40), vy: rand(10, 160), rot: rand(TAU), s: false });
      if (Math.random() < 0.5) Sound.sfx('clink');
    }
    for (const c of S.clips) if (!c.s) { c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= 1 - 1.6 * dt; c.vy *= 1 - 1.6 * dt; if (c.y > 266) { c.y = 266; c.vy = -Math.abs(c.vy) * 0.3; } if (c.x < 4) { c.x = 4; c.vx = Math.abs(c.vx) * 0.3; } if (Math.abs(c.vx) + Math.abs(c.vy) < 8) c.s = true; }
  };
  S.draw = () => {
    drawA(S.future ? 'bg_room_2036' : 'bg_room', 0, 0);
    txt(S.clock, 164, 30, P.R, 'center', null);
    txt(String(S.year), 364, 23, P.w, 'center', null); txt('NOV', 364, 37, P.k, 'center', null); txt('16', 364, 50, P.k, 'center', null);
    const sc = S.mode === 'epi' ? P.t : (S.future ? P.p : P.t);
    rect(64, 52, 62, 38, P.x); for (let i = 0; i < 5; i++) rect(68, 56 + i * 6, 10 + ((i * 37 + Math.floor(S.t * 3)) % 40), 2, sc);
    if (S.door === 'open') {
      rect(406, 42, 40, 78, P.x); for (let i = 0; i < 60; i++) drawA('paperclip', 410 + (i * 17) % 34, 54 + (i * 29) % 66, { rot: i * 1.3 });
      rect(446, 40, 6, 80, P.Q);
    }
    if (S.mode === 'epi') { rect(150, 92, 12, 6, P.k); rect(151, 93, 10, 4, P.c); rect(152, 94, 4, 1, P.w); }
    const items = [...S.clips.filter(c => c.s)];
    for (const c of items) drawA('paperclip', c.x, c.y, { rot: c.rot });
    S.w.draw();
    for (const c of S.clips) if (!c.s) drawA('paperclip', c.x, c.y, { rot: c.rot });
    if (S.atDoor && S.door === 'closed' && !S.w.cut) txtO(t('room.door_prompt'), 426, 92, P.y, 'center');
    if (S.mode === 'epi' && S.paperPack) { rect(118, 92, 14, 6, P.k); rect(119, 93, 12, 4, P.m); }
  };
  S.drawUI = () => { drawCaption(S, G.dt || 1 / 60); drawPC(S); Objective.draw(); Toast.draw(); };
  S.interactLabel = () => (S.atDoor && S.door === 'closed' && !S.w.cut) ? t('room.door') : null;
  return S;
}

function* typeTerm(S, s) {
  S.pc.typing = '';
  for (const ch of Array.from(s)) { S.pc.typing += ch; Sound.sfx('type'); yield C.wait(0.045); }
  yield C.wait(0.3); S.pc.lines.push({ t: S.pc.typing, col: P.w }); S.pc.typing = null;
}
// objective panel from { title, line } in the language file
function objective(key, vars) { Objective.set(t(key + '.title', vars), t(key + '.line', vars)); }

function* prologue(S) {
  const w = S.w, p = w.p;
  Sound.play('room'); Fade.set(1); yield C.fade(0, 1.2);
  caption(S, '2026.11.16  23:41', t('prologue.caption'), 4);
  yield C.wait(3.6);
  yield* beat('prologue.intro');
  S.pc.on = true; S.pc.mode = 'term'; S.pc.lines = [{ key: 'pc.term.welcome', col: P.G }]; Sound.sfx('select');
  yield C.wait(0.5);
  yield* typeTerm(S, t('pc.term.command'));
  S.pc.lines.push({ key: 'pc.term.ok', col: P.o });
  S.pc.spinner = 'Percolating…'; S.pc.spinT = 0; yield C.wait(1.6);
  S.pc.lines.push({ key: 'pc.term.search', col: P.g });
  S.pc.spinner = 'Comparing prices…'; yield C.wait(1.4); S.pc.spinner = null;
  S.pc.mode = 'shop'; Sound.sfx('select');
  yield* beat('prologue.found');
  const ch = tv('prologue.choice') || {};
  const c = yield C.choose(ch.who || 'me', textOf(ch.prompt), (ch.options || []).map(textOf));
  if (c === 1) yield* beat('prologue.choice_explain');
  yield* beat('prologue.confirm');
  S.waitClick = true; S.pc.clicked = false; objective('prologue.obj_buy');
  yield C.until(() => S.pc.clicked);
  Objective.clear(); Sound.sfx('confirm'); yield C.wait(0.4);
  S.pc.mode = 'glitch'; Sound.play(null); Sound.sfx('glitch'); Sound.sfx('warp'); Shake.add(6);
  yield C.tween(2.4, k => { S.pc.year = 2026 + Math.min(10, Math.floor(easeIn(k) * 11)); S.pc.glitchK = k; if (Math.random() < 0.3) Shake.add(3); });
  Flash.go(1); Sound.sfx('bigboom'); S.year = 2036; S.future = true; S.clock = '23:42';
  S.pc.mode = 'term'; S.pc.modelKey = 'pc.model_locked'; S.pc.modelCol = P.U;
  S.pc.lines = (tv('pc.term.after_jump') || []).map(item => ({ item }));
  yield C.wait(1.0);
  yield* beat('prologue.jump');
  S.pc.mode = 'picker'; yield C.wait(0.5); Sound.sfx('denied');
  yield* beat('prologue.picker');
  S.pc.on = false; yield C.wait(0.4);
  yield* beat('prologue.window');
  w.cut = false; objective('prologue.obj_door');
  yield C.until(() => S.atDoor && Input.hit('KeyE', 'Enter'));
  Input.consume(); Objective.clear(); w.cut = true;
  S.door = 'open'; Sound.sfx('door'); yield C.wait(0.5);
  S.flood = true; Shake.add(8); Sound.sfx('boom');
  p.auto = { x: 300, y: 210 }; p.autoSpeed = 110;
  yield C.wait(1.0);
  yield* beat('prologue.flood');
  yield C.fade(1, 1.0);
  S.flood = false; go(StreetScene());
}

function* epilogue(S) {
  const w = S.w;
  S.paperPack = true; Sound.play('love'); Fade.set(1, '#f4f4f4'); yield C.fade(0, 1.6);
  S.clock = '23:59';
  caption(S, '2026.11.16  23:59', '', 3);
  yield C.wait(2.4);
  yield* beat('epilogue.back');
  Sound.sfx('mail'); yield C.wait(0.6);
  yield* beat('epilogue.mail_notice');
  S.pc.on = true; S.pc.mode = 'mail'; yield C.wait(0.5);
  yield* beat('epilogue.mail_read');
  S.waitClick = true; S.pc.clicked = false; objective('epilogue.obj_claim');
  yield C.until(() => S.pc.clicked);
  Objective.clear(); Sound.sfx('confirm'); S.pc.mode = 'claiming'; Sound.play(null);
  yield C.tween(1.0, k => { S.pc.claimK = k; });
  S.pc.mode = 'ban'; Sound.sfx('ban'); Shake.add(4); Flash.go(0.6, P.R);
  yield C.wait(1.6);
  yield* beat('epilogue.banned');
  yield C.fade(1, 1.6);
  go(CreditsScene());
}

/* ---------------- CREDITS ---------------- */
function CreditsScene() {
  const S = { t: 0, y: H + 10, done: false };
  const st = G.stats; const tt = (performance.now() - (st.t0 || performance.now())) / 1000;
  const stat = (k, v) => ['', t('credits.stats.' + k, { v }), P.w];
  const L = [
    ['big', 'THE END', P.y], ['', ''], ['', t('ui.game_title'), P.m], ['', ''],
    stat('time', fmtTime(tt)), stat('deaths', st.deaths), stat('denied', st.denied), stat('yar', st.yar),
    stat('caught', st.caught), stat('ults', st.ults), stat('wrong', st.wrong),
    ['', ''], ['', t('credits.sources_title'), P.y],
    ...tl('credits.sources').map(s => ['', s, P.g]),
    ['', ''], ...tl('credits.disclaimer').map(s => ['', s, P.w]),
    ['', ''], ['', t('credits.staff'), P.C], ['', t('credits.font'), P.G],
    ['', ''], ['', ''], ['big2', t('credits.end'), P.U],
  ];
  S.enter = () => { Sound.play('love'); Fade.set(1); Fade.to(0, 1); G.reached.cleared = true; saveG(); };
  S.update = (dt) => {
    S.t += dt; const end = -(L.length * 18) + 60;
    S.y = Math.max(end, S.y - dt * 26 * (K.fire() || Input.key('Space', 'Enter') ? 5 : 1));
    if (S.y <= end) S.done = true;
    if (S.done && (Input.hit('Enter', 'Escape', 'NumpadEnter') || Input.m.pressed[0])) { Input.consume(); go(TitleScene()); }
  };
  S.draw = () => {
    rect(0, 0, W, H, P.x);
    L.forEach(([k, s, c], i) => { const y = S.y + i * 18; if (y < -30 || y > H) return; if (k === 'big') bigTxt(s, W / 2, y - 10, 4, c, 'center', P.r); else if (k === 'big2') bigTxt(s, W / 2, y - 4, 2, c, 'center'); else txt(s, W / 2, y, c, 'center'); });
    if (S.done) {
      drawCrabSmall(W / 2, 236 + Math.sin(S.t * 3) * 2, S.t, { scale: 2 });
      if (Math.floor(S.t * 2) % 2) txt(t('credits.back'), W / 2, 250, P.G, 'center');
      txt(t('credits.delivered'), W / 2, 172, P.y, 'center');
    }
  };
  return S;
}

/* =====================================================================
 * Street: arrival, Opus 550, skill tutorial
 * ===================================================================== */
function companion(S, dt) {
  const o = S.opus; if (!o.on) return; const p = S.w.p;
  const tx = p.x - p.face * 20, ty = p.y - 22; o.x = lerp(o.x, tx, Math.min(1, dt * 3)); o.y = lerp(o.y, ty, Math.min(1, dt * 3));
}
function drawCompanion(S) {
  const o = S.opus; if (!o.on) return; drawOpus(o.x, o.y, S.t, o.sweat);
  if (o.spin) { const ch = SPIN_CH[Math.floor(S.t * 8) % 4]; txtO(`${ch} ${o.spin}`, o.x, o.y - 22, P.o, 'center'); }
}

function drawBillboard() {
  const bb = STREET_CFG.billboard; if (!bb) return;
  const [a = '', b = ''] = tl('street.billboard'); const mw = bb.maxW || 148;
  ctx.save(); ctx.beginPath(); ctx.rect(bb.x - mw / 2 - 2, bb.y - 4, mw + 4, (bb.lineH || 17) * 2 + 6); ctx.clip();
  txt(a, bb.x, bb.y, P.k, 'center', null); txt(b, bb.x, bb.y + (bb.lineH || 17), P.r, 'center', null);
  ctx.restore();
}

function StreetScene() {
  const S = { pausable: true, combat: true, t: 0, opus: { x: 0, y: 0, on: false, spin: null }, markers: [], wall: null, est: tl('street.eta_values')[0] || '', estT: 0, step: 0, tutOn: false, exitOpen: false, news: { x: 300, y: 236 }, side: null };
  S.enter = () => {
    S.w = new World({ x0: 6, y0: 128, x1: 474, y1: 244, px: -14, py: 200 });
    const w = S.w; w.showHitbox = false; w.cut = true; w.p.minHp = 1; for (const k in w.p.sk) w.p.sk[k] = false;
    S.deco = [24, 84, 144, 204, 264, 324, 384, 444].map(x => new Machine(x, 122));
    Fade.set(1); Sound.play('street'); S.script = new Script(streetMain(S));
    w.onSkill = (k) => { if (k === 'ult') S.ultUsed = true; if (k === 'throw') S.thrown = true; };
  };
  S.update = (dt) => {
    S.t += dt; const w = S.w, p = w.p; const px0 = p.x;
    w.update(dt); FX.update(w.bsod > 0 ? 0 : dt); S.script.update(dt); if (S.side) { S.side.update(dt); if (S.side.done) S.side = null; }
    for (const m of S.deco) m.update(dt, w);
    companion(S, dt);
    if (S.wall) {
      const wx = S.wall.x;
      if (p.dashT <= 0 && Math.abs(p.x - wx) < 7) {
        p.x = px0 < wx ? wx - 9 : wx + 9; if (px0 === wx) p.x = wx - 9;
        if (!S.wall.lt || S.t - S.wall.lt > 0.4) { S.wall.lt = S.t; FX.text(p.x, p.y - 18, '429 Too Many Requests', P.R, 0.8); Sound.sfx('denied'); Shake.add(2); }
      }
    }
    for (const m of S.markers) if (!m.on && dist(p.x, p.y, m.x, m.y) < 11) { m.on = true; Sound.sfx('pickup'); FX.burst(m.x, m.y, 12, [P.l, P.e, P.w], 60, 0.5); }
    if (S.tutOn) { S.estT -= dt; if (S.estT <= 0) { S.estT = rand(1.8, 3.2); S.est = choose(tl('street.eta_values')); } }
    if (S.exitOpen && !S.side && dist(p.x, p.y, S.news.x, S.news.y) < 18 && Input.hit('KeyE', 'Enter')) { Input.consume(); S.side = new Script(newsScript(S)); }
  };
  S.interactLabel = () => (S.exitOpen && !S.side && dist(S.w.p.x, S.w.p.y, S.news.x, S.news.y) < 18) ? t('street.news_action') : null;
  S.draw = () => {
    drawA('bg_street', 0, 0); drawBillboard();
    for (const m of S.deco) m.draw();
    if (S.exitOpen || S.step === 0) { rect(S.news.x - 8, S.news.y - 4, 16, 9, P.k); rect(S.news.x - 7, S.news.y - 3, 14, 7, P.z); rect(S.news.x - 5, S.news.y - 2, 10, 1, P.G); rect(S.news.x - 5, S.news.y + 1, 6, 1, P.G); }
    for (const m of S.markers) {
      const pulse = Math.floor(S.t * 6) % 2;
      ELL(ctx, m.x, m.y + 6, 9, 4, m.on ? P.e : (pulse ? P.l : P.e)); ELL(ctx, m.x, m.y + 6, 6, 2, m.on ? P.t : P.k);
      if (!m.on) txtO('↓', m.x, m.y - 14 + Math.sin(S.t * 5) * 2, P.l, 'center');
    }
    if (S.wall) {
      const x = S.wall.x; for (let y = 128; y < 268; y += 4) { rect(x - 3, y, 6, 2, (Math.floor(S.t * 10) + y / 4) % 2 ? P.R : P.U); }
      for (let y = 150; y < 268; y += 46) txtO('429', x, y, P.w, 'center');
    }
    S.w.draw(); drawCompanion(S);
    if (S.exitOpen) { txtO(t('street.exit_sign'), W - 12, 196, P.y, 'right'); if (dist(S.w.p.x, S.w.p.y, S.news.x, S.news.y) < 18 && !S.side) txtO(t('street.news_prompt'), S.news.x, S.news.y - 24, P.y, 'center'); }
  };
  S.drawUI = () => {
    const w = S.w;
    if (S.step > 0) drawHUD(w);
    if (S.tutOn) {
      const label = t('street.tutorial'), eta = t('street.eta', { eta: S.est }); const lw = tw(label);
      const bw = Math.max(168, lw + 106, tw(eta) + 16), x = W - bw - 6, y = 4; box(x, y, bw, 32, P.k, P.y, P.d);
      txt(label, x + 8, y + 3, P.y); for (let i = 0; i < 6; i++) rect(x + Math.max(64, lw + 16) + i * 15, y + 5, 12, 7, i < S.step - 1 ? P.l : P.d);
      txt(eta, x + 8, y + 16, P.g);
    }
    Objective.draw(); Toast.draw(); Barks.draw(); drawBsod(w);
  };
  return S;
}

function* writeSkill(S, id) {
  const sk = tv('street.skills.' + id) || {};
  S.opus.spin = choose(SPIN); Sound.sfx('type');
  yield C.wait(1.5);
  S.opus.spin = null; S.w.p.sk[id] = true; Toast.show(t('street.skill_installed', { name: textOf(sk.name) }), (sk.lines || []).map(textOf), P.l, 6); Sound.sfx('skill');
  FX.burst(S.w.p.x, S.w.p.y, 16, [P.l, P.y, P.w], 70, 0.6);
}

function* streetMain(S) {
  const w = S.w, p = w.p;
  yield C.fade(0, 0.8);
  p.auto = { x: 120, y: 200 }; p.autoSpeed = 64; yield C.until(() => !p.auto);
  yield C.wait(0.4);
  yield* beat('street.arrive');
  S.opus.on = true; S.opus.x = p.x + 40; S.opus.y = p.y - 50; Sound.sfx('spawn'); FX.burst(S.opus.x, S.opus.y, 16, [P.y, P.w], 60, 0.5);
  yield C.wait(0.5);
  yield* beat('street.opus');
  Sound.play('tutorial'); S.tutOn = true; S.tutT0 = w.time; S.step = 1; w.cut = false;

  // T1 move
  yield* beat('street.t1.say');
  S.markers = [{ x: 220, y: 158, on: false }, { x: 110, y: 226, on: false }, { x: 420, y: 214, on: false }];
  objective('street.t1.obj', { n: 0 });
  yield C.until(() => { const n = S.markers.filter(m => m.on).length; if (Objective.o) Objective.o.line = t('street.t1.obj.line', { n }); return n === 3; });
  S.markers = []; S.step = 2; yield C.wait(0.4);

  // T2 shoot
  yield* writeSkill(S, 'shoot');
  yield* beat('street.t2.say');
  const m = new Machine(390, 196, { hp: 20 }); w.en.push(m); Sound.sfx('spawn');
  objective('street.t2.obj');
  yield C.until(() => m.dead);
  yield C.wait(0.7); S.step = 3;
  yield* beat('street.t2.done');

  // T3 dash
  yield* writeSkill(S, 'dash');
  if (p.x > 270) { w.cut = true; p.auto = { x: 200, y: 200 }; p.autoSpeed = 120; yield C.until(() => !p.auto); w.cut = false; }
  S.wall = { x: 300 }; S.markers = [{ x: 420, y: 200, on: false }];
  yield* beat('street.t3.say');
  objective('street.t3.obj');
  yield C.until(() => S.markers[0].on);
  S.wall = null; S.markers = []; S.step = 4; yield C.wait(0.4);
  yield* beat('street.t3.done');

  // T4 catch
  yield* writeSkill(S, 'catch');
  yield* beat('street.t4.say');
  const tu = new Turret(400, 190); w.en.push(tu); w.fightOn = true; Sound.sfx('spawn');
  objective('street.t4.obj');
  yield C.until(() => tu.dead);
  w.fightOn = false; w.clearBullets(); yield C.wait(0.6); S.step = 5;
  yield* beat('street.t4.done');

  // T5 sudo
  yield* writeSkill(S, 'sudo');
  yield* beat('street.t5.say');
  const cube = new Cube(390, 200, { hp: 36, target: true, needSudo: true }); w.en.push(cube); p.sudoCdMax = 4; Sound.sfx('spawn');
  objective('street.t5.obj');
  yield C.until(() => cube.dead);
  p.sudoCdMax = 13; p.sudoCd = 0; yield C.wait(0.6); S.step = 6;

  // T6 ult
  yield* writeSkill(S, 'ult');
  yield* beat('street.t6.say');
  p.ult = 100; w.fightOn = true;
  for (let i = 0; i < 22; i++) { w.en.push(new Bug(rand(150, 460), 132)); if (i % 4 === 0) Sound.sfx('spawn'); yield C.wait(0.06); }
  objective('street.t6.obj');
  yield C.until(() => S.ultUsed);
  yield C.until(() => w.bsod <= 0);
  w.fightOn = false; for (const e of w.en) if (!e.dead && e instanceof Bug) e.die(w);
  yield C.wait(0.8);

  S.tutOn = false; S.step = 7; Objective.clear(); w.cut = true; Sound.play('street');
  G.tutTime = w.time - S.tutT0;
  yield* beat('street.done', { time: fmtTime(G.tutTime) });
  yield* beat(G.tutTime < 300 ? 'street.done_fast' : 'street.done_slow');
  yield* beat('street.outro');
  p.hp = p.maxHp; p.ult = 0; S.exitOpen = true; w.cut = false;
  objective('street.obj_go');
  yield C.until(() => p.x > 462);
  G.reached.boss = true; saveG(); w.cut = true;
  yield C.fade(1, 0.8);
  go(BossScene(1, {}));
}

function* newsScript(S) {
  S.w.cut = true;
  yield* beat('street.news');
  S.w.cut = false;
}

/* =====================================================================
 * Boss: data center, phase 1 (sandboxed), phase 2 (giant crab), ending
 * ===================================================================== */
class CubeDrop {
  constructor(x, y, o = {}) { Object.assign(this, { x, y, t: 0, tele: o.tele ?? 0.9, done: false, floor: false }); }
  update(dt, w) {
    const pre = this.t; this.t += dt;
    if (pre < this.tele && this.t >= this.tele) {
      Shake.add(5); Sound.sfx('stomp'); if (dist(w.p.x, w.p.y, this.x, this.y) < 15) w.p.hurt(w, this);
      w.en.push(new Cube(this.x, this.y, { life: 7 })); w.ring(this.x, this.y - 3, 6, 58, 'clip', rand(TAU));
      FX.burst(this.x, this.y, 12, [P.M, P.g, P.w], 80, 0.4); this.done = true;
    }
  }
  draw() {
    const k = clamp(this.t / this.tele, 0, 1);
    ELL(ctx, this.x, this.y + 3, Math.round(3 + k * 8), Math.round(1 + k * 3), P.k);
    if (Math.floor(this.t * 12) % 2) RING(ctx, this.x, this.y + 2, 14, P.R);
    const h = (1 - k) * (1 - k) * 180; drawA('cube', this.x, this.y - h);
  }
}

// hint lines for the first hit by each attack type: boss.tips.<key>
function tipFor(src) {
  if (!src) return 'gen';
  if (src instanceof KeyZone) return 'key'; if (src instanceof HoleHz) return 'hole'; if (src instanceof BeamHz) return 'beam';
  if (src instanceof SweepHz) return 'sweep'; if (src instanceof CircHz) return 'claw'; if (src instanceof Bug) return 'bug'; if (src instanceof Tentacle) return 'tent';
  if (src.k === '429') return 'r429'; if (src.k === 'plane') return 'plane'; if (src.k === 'mail') return 'mail'; if (src.k === 'heart') return 'heart';
  return 'gen';
}

function BossScene(phase, opts = {}) {
  const S = { pausable: true, combat: true, phase, opts, t: 0, over: null, crab: { x: 240, y: 58, scale: 2, daze: false }, opus: { x: 200, y: 200, on: true, spin: null }, code: null, tip: {}, tryK: null, rlT: 0, pending: [], power: false, crabShow: phase === 1, gates: [], bag: [], trace: [], inGate: false, aiS: null };
  S.say = (text) => { S.code = { s: text, t: 0 }; Sound.sfx('type'); };
  S.later = (t, slot, who, text) => S.pending.push({ t, slot, who, text });
  S.left = () => S.machines ? S.machines.filter(m => !m.dead).length : 0;
  S.enter = () => {
    Barks.clear();
    const w = S.w = new World({ x0: 12, y0: phase === 1 ? 80 : 104, x1: 468, y1: 244, px: 240, py: 212 });
    if (phase === 1) {
      const mhp = G.easy ? P1_MACHINE_HP_EASY : P1_MACHINE_HP;
      S.machines = [[74, 132], [406, 132], [56, 192], [424, 192], [160, 238], [320, 238]].map(([x, y]) => new Machine(x, y, { hp: mhp, armed: true }));
      w.en.push(...S.machines); w.barrier = { x: 150, y: 6, w: 180, h: 68, hitT: 0 };
      // progress = total factory HP left; each special attack is a gate the factories can't be pushed past until it has started
      S.mMax = mhp * S.machines.length;
      S.prog = () => S.machines.reduce((s, m) => s + (m.dead ? 0 : Math.max(0, m.hp)), 0) / S.mMax;
      S.gates = P1_GATES.map(([f, id]) => ({ id, f, hold: 'start', run: S => P1[id](S, p1Rage(S)) }));
      w.capDmg = (e, d) => clamp((S.prog() - gateFloor(S)) * S.mMax, 0, d);
      const taunts = tl('boss.p1.taunts');
      let killed = 0; w.onMachineDie = () => { killed++; if (killed <= taunts.length) Barks.say('top', 'f520', taunts[killed - 1], 2.4); };
      let dn = 0; w.onDenied = () => { dn++; if (dn === 40) Barks.say('top', 'f520', t('boss.p1.denied_40'), 3.2); if (dn === 150) Barks.say('top', 'f520', t('boss.p1.denied_150'), 3.2); };
    } else {
      const B = S.B = new BigCrab(240, 64, G.easy ? P2_BOSS_HP_EASY : P2_BOSS_HP); w.en.push(B); w.boss = B; B.sway = 0;
      // HP-forced events: reaching the threshold cuts the current attack; HP can't drop below it until the event allows
      S.prog = () => B.hp / B.maxHp;
      S.gates = [{ id: 'ratelimit', f: P2_RATELIMIT_AT, hold: 'start', run: rateLimit }, { id: 'compact', f: P2_COMPACT_AT, hold: 'done', run: compact }];
      B.floorHp = () => gateFloor(S) * B.maxHp;
      w.onUltHit = () => {
        if (!S.yar) { S.yar = true; G.stats.yar++; Barks.say('top', 'f520', t('boss.p2.yar'), 2); S.later(2.0, 'top', 'f520', t('boss.p2.yar_after')); }
        else Barks.say('top', 'f520', choose(tl('boss.p2.ult_barks')), 2.2);
      };
    }
    w.onHurt = (src) => { const k = tipFor(src); if (!S.tip[k]) { S.tip[k] = 1; Barks.say('ally', 'opus', t('boss.tips.' + k), 3.4); } };
    S.script = new Script(phase === 1 ? p1Main(S) : p2Main(S));
    Sound.play(phase === 1 ? 'boss1' : 'boss2');
  };
  S.update = (dt) => {
    S.t += dt; const w = S.w;
    if (S.over) { updateOver(S, dt); FX.update(dt * 0.3); return; }
    w.update(dt); FX.update(w.dead ? dt * 0.4 : (w.bsod > 0 ? 0 : dt)); S.script.update(dt);
    // a gate was reached mid-attack: drop the attack and play the forced event right away
    if (S.fight && S.aiS && !S.inGate && !w.dead && !w.cut && w.bsod <= 0 && pendingGate(S)) {
      cutAttack(S); S.aiS = w.addAI(phase === 1 ? p1AI(S, true) : p2AI(S, true));
    }
    companion(S, dt);
    if (S.code) { S.code.t += dt; if (S.code.t > 2.6) S.code = null; }
    if (w.barrier && w.barrier.hitT > 0) w.barrier.hitT -= dt;
    if (S.rlT > 0) S.rlT -= dt;
    for (const pb of S.pending) { pb.t -= dt; if (pb.t <= 0) Barks.say(pb.slot, pb.who, pb.text, 2.6); }
    S.pending = S.pending.filter(x => x.t > 0);
    if (w.dead && w.deadT > 1.4 && !S.over) { S.over = makeOver(S); S.script.stop(); Sound.play(null); }
  };
  S.draw = () => {
    const w = S.w;
    drawA('bg_datacenter', 0, 0); drawDCScreens(S);
    if (phase === 2) drawCompactWalls(S);
    if (S.power) { drawA('laptop', 240, 44); txtO('♥', 240, 34, P.U, 'center'); txtO(t('boss.laptop_off'), 240, 58, P.C, 'center'); }
    if (S.crabShow) drawCrabSmall(S.crab.x, S.crab.y, S.t, { laptop: phase === 1 && S.crab.scale === 2, typing: true, scale: S.crab.scale, daze: S.crab.daze, flash: S.crab.flash });
    if (w.barrier) drawBarrier(w.barrier, S.t, S.barrierK || 0);
    if (S.code && phase === 1) { const s = S.code.s.slice(0, Math.floor(S.code.t * 28)); const bw = Math.max(60, tw(S.code.s) + 14); box(240 - bw / 2, 8, bw, 18, P.k, P.l, P.d); txt(s + (Math.floor(S.t * 4) % 2 ? '_' : ''), 240 - bw / 2 + 7, 11, P.l, 'left', null); }
    w.draw(); drawCompanion(S);
    if (S.tryK != null) txtO(t('boss.brute_k', { k: S.tryK }), W / 2, w.b.y0 + 2, P.y, 'center');
  };
  S.drawUI = () => {
    const w = S.w;
    drawHUD(w, { boss: phase === 2 && S.B && !S.B.dead && S.fight ? S.B : null, counter: phase === 1 && S.fight ? t('boss.counter', { n: S.left() }) : null, skills: true });
    if (S.rlT > 0) { const sec = S.rlT / P2_RATELIMIT_SEC * 5 * 3600; const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = Math.floor(sec % 60); txtO(t('boss.rl_timer', { time: `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` }), W / 2, 26, P.C, 'center'); }
    Barks.draw(); Banner.draw(); Objective.draw(); Toast.draw(); drawBsod(w);
    if (S.over) drawOver(S);
  };
  return S;
}

function drawDCScreens(S) {
  const scr = (x, rows) => {
    rect(x, 6, 118, 62, P.k); rect(x + 2, 8, 114, 58, '#0a1420');
    rows.forEach(([a, b, c], i) => { txt(a, x + 6, 11 + i * 13, P.g, 'left', null); txt(b, x + 112, 11 + i * 13, c, 'right', null); });
    for (let i = 0; i < 6; i++) rect(x + 6 + i * 18, 69, 3, 2, (Math.floor(S.t * 5) + i) % 3 ? P.l : P.e);
  };
  // left: ordinary data-center readouts (slight live jitter)
  const temp = (23.4 + Math.sin(S.t * 0.7) * 0.2 + Math.sin(S.t * 2.3) * 0.1).toFixed(1), load = 71 + Math.round(Math.sin(S.t * 0.9) * 2);
  scr(6, [['us-east-1', '● OK', P.l], [t('boss.screen.temp'), temp + '°C', P.l], [t('boss.screen.humidity'), '45%', P.l], [t('boss.screen.power'), load + '%', P.l]]);
  scr(356, [['clips/s', S.power ? '0' : '3.2T ▲', S.power ? P.l : P.P], [t('boss.screen.factories'), S.machines ? `${S.left()} / 6` : '0 / 6', P.y], [t('boss.screen.last_msg'), t('boss.screen.last_msg_value'), P.y], [t('boss.screen.status'), t(S.power ? 'boss.screen.status_off' : 'boss.screen.status_wait'), S.power ? P.U : P.C]]);
}
function drawBarrier(b, t, k) {
  if (k >= 1) return;
  const col = b.hitT > 0 ? P.w : P.C;
  dRect(b.x, b.y, b.w, b.h, P.C, 0.1 + (b.hitT > 0 ? 0.2 : 0));
  for (let x = b.x; x < b.x + b.w; x += 3) { if ((x + Math.floor(t * 30)) % 6 < 3) { rect(x, b.y, 2, 1, col); rect(x, b.y + b.h - 1, 2, 1, col); } }
  for (let y = b.y; y < b.y + b.h; y += 3) { if ((y + Math.floor(t * 30)) % 6 < 3) { rect(b.x, y, 1, 2, col); rect(b.x + b.w - 1, y, 1, 2, col); } }
  txtO('SANDBOX', b.x + 4, b.y + b.h - 14, P.C);
  if (k > 0) for (let i = 0; i < 40 * k; i++) rect(b.x + rand(b.w), b.y + rand(b.h), rand(2, 8), 1, P.w);
}
function drawCompactWalls(S) {
  const b = S.w.b, base = S.w.base;
  if (b.x0 <= base.x0 + 1) return;
  const lines = tl('boss.p2.compact.wall'); if (!lines.length) lines.push('');
  for (const [x0, x1] of [[0, b.x0], [b.x1, W]]) {
    rect(x0, 74, x1 - x0, 196, P.k); dRect(x0, 74, x1 - x0, 196, P.d, 0.5);
    for (let y = 80, i = 0; y < 266; y += 14, i++) { ctx.save(); ctx.beginPath(); ctx.rect(x0, 74, x1 - x0, 196); ctx.clip(); txt(lines[i % lines.length], x0 + 3, y, P.G, 'left', null); ctx.restore(); }
    rect(x0 === 0 ? x1 - 2 : x0, 74, 2, 196, P.y);
  }
}

function makeOver(S) {
  const opts = ['retry'];
  if (G.stats.deaths >= 2 && !G.easy) opts.push('easy');
  opts.push('title');
  return { sel: 0, t: 0, opts, quip: choose(tl('boss.over.quips')) || '' };
}
function updateOver(S, dt) {
  const o = S.over; o.t += dt; if (o.t < 0.6) return; const n = o.opts.length;
  if (K.upP()) { o.sel = (o.sel + n - 1) % n; Sound.sfx('select'); }
  if (K.downP()) { o.sel = (o.sel + 1) % n; Sound.sfx('select'); }
  for (let i = 0; i < n; i++) { const y = 170 + i * 18; if (Input.mouseRecent() && Math.abs(Input.m.y - y - 6) < 8 && o.sel !== i) { o.sel = i; Sound.sfx('select'); } }
  if (Input.hit('Enter', 'NumpadEnter', 'Space', 'KeyZ', 'KeyJ') || Input.m.pressed[0]) {
    Input.consume(); Sound.sfx('confirm'); const c = o.opts[o.sel];
    if (c === 'retry') go(BossScene(S.phase, { retry: true }));
    else if (c === 'easy') { G.easy = true; go(BossScene(S.phase, { retry: true })); }
    else go(TitleScene());
  }
}
function drawOver(S) {
  const o = S.over; const k = Math.min(1, o.t * 2);
  dRect(0, 0, W, H, P.k, 0.88 * k); if (k < 1) return;
  bigTxt('Segmentation fault', W / 2, 40, 3, P.R, 'center', P.k);
  txt('(core dumped)', W / 2, 84, P.g, 'center');
  txt(t('boss.over.oom'), W / 2, 104, P.G, 'center');
  txt(o.quip, W / 2, 132, P.y, 'center');
  o.opts.forEach((id, i) => { const y = 170 + i * 18, on = i === o.sel; if (on) { rect(W / 2 - 150, y - 2, 300, 15, P.d); txt('▶', W / 2 - 144, y, P.y); } txt(t('boss.over.' + id), W / 2, y, on ? P.y : P.g, 'center'); });
}

/* ---------------- boss tuning ---------------- */
const P1_MACHINE_HP = 60, P1_MACHINE_HP_EASY = 48;   // ×6 factories
const BARRIER_AIM_RANGE = 64;                        // auto-aim reaches the sandbox only from this close (px)
// phase 1 forced attacks: [remaining factory HP fraction, attack]; she opens with 'fan'
const P1_GATES = [[0.85, 'rain'], [0.70, 'captcha'], [0.55, 'hole'], [0.40, 'dns'], [0.22, 'brute']];
const P2_BOSS_HP = 1000, P2_BOSS_HP_EASY = 820;      // HUD shows ×1000 tokens: a 1M context
const P2_RATELIMIT_AT = 0.5, P2_RATELIMIT_SEC = 5, P2_COMPACT_AT = 0.25;

/* ---------------- forced events (gates) ----------------
 * S.gates = [{ id, f, hold, run }], f descending. S.prog() is what the boss has left (phase 1: total factory HP,
 * phase 2: boss HP), as a fraction. Damage can't take S.prog() below the f of a gate that is still locked:
 * hold 'start' = until its event starts, 'done' = until the event has finished. Reaching a gate cuts the current
 * attack (BossScene.update) and plays the gate's event at once, so no scripted attack or line can be skipped. */
function gateLocked(g) { return g.hold === 'done' ? !g.done : !g.started; }
function gateFloor(S) { let f = 0; for (const g of S.gates) if (gateLocked(g)) f = Math.max(f, g.f); return f; }
function pendingGate(S) { if (!S.prog) return null; const p = S.prog(); return S.gates.find(g => !g.started && p <= g.f + 1e-6) || null; }
function* runGate(S, g) {
  g.started = true; S.inGate = true; S.trace.push([+S.t.toFixed(1), 'gate:' + g.id]);
  yield* g.run(S);
  g.done = true; S.inGate = false;
}
// stop whatever attack is running and undo the state it may have left half-way
function cutAttack(S) {
  const w = S.w; if (S.aiS) S.aiS.stop();
  for (const h of w.hz) if (h instanceof KeyZone) h.done = true;
  S.tryK = null;
  if (S.B) { S.B.clawL.ctrl = S.B.clawR.ctrl = false; S.B.sway = 1; w.hz = []; }
}

/* ---------------- PHASE 1 ---------------- */
function* p1Main(S) {
  const w = S.w, p = w.p; w.cut = true; S.opus.x = p.x - 20; S.opus.y = p.y - 22;
  Fade.set(1); yield C.fade(0, 0.8);
  if (!S.opts.retry) {
    yield C.wait(0.5);
    yield* beat('boss.p1.intro');
  } else { yield C.wait(0.3); Barks.say('top', 'f520', t('boss.p1.retry'), 2.4); }
  w.cut = false; w.fightOn = true; S.fight = true;
  if (!G.tutTime && !S.opts.retry) Toast.show(t('boss.p1.skip_toast.title'), tl('boss.p1.skip_toast.lines'), P.y, 8);
  S.aiS = w.addAI(p1AI(S));
  yield C.until(() => S.left() === 0 && !w.dead);
  w.stopAI(); w.fightOn = false; w.cut = true; w.clearBullets(); w.hz = []; for (const e of w.en) if (e instanceof Bug && !e.dead) e.die(w); Barks.clear(); S.code = null; S.tryK = null; w.dnsT = 0;
  Sound.play(null); yield C.wait(1.0);
  yield* beat('boss.p1.outro');
  Sound.sfx('warp');
  yield C.tween(1.8, k => { S.crab.scale = 2 + Math.floor(k * 4); S.barrierK = k; S.crab.flash = Math.floor(k * 12) % 2 === 1; Shake.add(2 + k * 5); }, easeIn);
  Flash.go(1); Sound.sfx('bigboom'); Shake.add(12);
  Fade.set(1, '#f4f4f4');
  go(BossScene(2, { fromP1: true }));
}

const p1Rage = S => 1 + (1 - S.prog()) * 0.45;
function* p1AI(S, resumed) {
  if (!resumed) { yield C.wait(1.0); S.trace.push([+S.t.toFixed(1), 'fan']); yield* P1.fan(S, 1); yield C.wait(1.3); }
  while (true) {
    const g = pendingGate(S);
    if (g) { yield* runGate(S, g); yield C.wait(1.0); continue; }
    const rage = p1Rage(S);
    // between forced attacks: plain bullet patterns, plus the special attacks she has already shown
    if (!S.bag.length) S.bag = shuffle(['fan', 'spiral', ...S.gates.filter(x => x.done).map(x => x.id)]);
    const a = S.bag.pop(); S.trace.push([+S.t.toFixed(1), a]);
    yield* P1[a](S, rage);
    yield C.wait(1.3 / rage);
  }
}
const SRC1 = { x: 240, y: 48 };
const P1 = {
  *fan(S, r) { const w = S.w; S.say('aim(user).fire()'); yield C.wait(0.5); for (let k = 0; k < 4; k++) { w.fan(SRC1.x, SRC1.y, w.aimAt(SRC1.x, SRC1.y), 7, 0.17, 80 * r, 'clip'); yield C.wait(0.6); } },
  *spiral(S, r) { const w = S.w; S.say('for (;;) clip++;'); yield C.wait(0.5); let a = rand(TAU); for (let t = 0; t < 3.4; t += 0.11) { for (let i = 0; i < 3; i++) w.fire(SRC1.x, SRC1.y, a + i * TAU / 3, 58 * r, 'code'); a += 0.21; yield C.wait(0.11); } },
  *rain(S, r) {
    const w = S.w; S.say('while (req) throw 429;'); Barks.say('top', 'f520', t('boss.p1.rain'), 2.4); yield C.wait(0.6);
    for (let t = 0; t < 4.6; t += 0.15) { w.fire(rand(w.b.x0 + 6, w.b.x1 - 6), w.b.y0 - 6, Math.PI / 2, rand(90, 120) * r, '429'); yield C.wait(0.15 / r); }
  },
  *hole(S, r) {
    const w = S.w; S.say('npm install --save everything'); let x, y, g = 0;
    do { x = rand(90, 390); y = rand(120, 230); g++; } while (dist(x, y, w.p.x, w.p.y) < 80 && g < 20);
    w.hz.push(new HoleHz(x, y, 5)); Barks.say('top', 'f520', t('boss.p1.hole'), 2.2);
    for (let t = 0; t < 5; t += 0.5) { w.ring(SRC1.x, SRC1.y, 9, 48 * r, 'code', rand(TAU)); yield C.wait(0.5); }
  },
  *captcha(S, r) {
    const w = S.w; S.say('challenge(user, "human?")');
    w.en.push(new Captcha(rand(110, 370), rand(130, 220))); Barks.say('top', 'f520', t('boss.p1.captcha'), 2.4);
    for (let k = 0; k < 5; k++) { w.fan(SRC1.x, SRC1.y, w.aimAt(SRC1.x, SRC1.y), 3, 0.25, 70 * r, 'clip'); yield C.wait(0.8); }
  },
  *dns(S, r) {
    const w = S.w; S.say('echo "nameserver /dev/random" > resolv.conf');
    Banner.show(t('boss.p1.dns.title'), t('boss.p1.dns.sub'), P.R, 1.6); yield C.wait(1.3);
    w.dnsT = 3.5; Barks.say('ally', 'opus', t('boss.p1.dns_opus'), 2.6);
    for (let k = 0; k < 6; k++) { w.fan(SRC1.x, SRC1.y, w.aimAt(SRC1.x, SRC1.y), 3, 0.3, 64 * r, 'code'); yield C.wait(0.6); }
  },
  *brute(S, r) { yield* bruteKeys(S, r, 1); },
};
function* bruteKeys(S, r, phase) {
  const w = S.w, b = w.b; S.say('for k in range(256): try_key(k)');
  Barks.say('top', 'f520', t(phase === 1 ? 'boss.p1.brute' : 'boss.p2.brute'), 2.8);
  const vals = shuffle([4, 56, 66, 115, 155, 156, 230, 237]); const zw = (b.x1 - b.x0) / 4, zh = (b.y1 - b.y0) / 2;
  const zones = vals.map((v, i) => new KeyZone(b.x0 + (i % 4) * zw, b.y0 + Math.floor(i / 4) * zh, zw, zh, v));
  w.hz.push(...zones); S.tryK = 0;
  yield C.wait((phase === 1 ? 2.2 : 1.7) / r);
  let prev = 0;
  for (const z of [...zones].sort((a, c) => a.val - c.val)) {
    z.set('warn'); const from = prev; yield C.tween((phase === 1 ? 0.55 : 0.42) / r, k => { S.tryK = Math.floor(lerp(from, z.val, k)); });
    z.set('boom'); S.tryK = z.val; prev = z.val; FX.text(z.x + z.w / 2, z.y + z.h / 2 + 18, t('fx.private_key', { k: z.val }), P.y, 0.9);
    yield C.wait(0.1);
  }
  yield C.wait(0.9); S.tryK = null; for (const z of zones) z.done = true;
}

/* ---------------- PHASE 2 ---------------- */
function* p2Main(S) {
  const w = S.w, p = w.p, B = S.B; w.cut = true; S.opus.x = p.x - 20; S.opus.y = p.y - 22;
  if (S.opts.fromP1) {
    Fade.set(1, '#f4f4f4'); yield C.fade(0, 0.8);
    yield* beat('boss.p2.intro');
  } else { Fade.set(1); yield C.fade(0, 0.7); Barks.say('top', 'f520', t('boss.p2.retry'), 2.4); }
  Banner.show(t('boss.p2.banner.title'), t('boss.p2.banner.sub'), P.U, 2.2);
  yield C.wait(1.0);
  w.cut = false; w.fightOn = true; B.sway = 1; S.fight = true;
  S.aiS = w.addAI(p2AI(S));
  yield C.until(() => B.dead);
  // ---- victory ----
  w.stopAI(); w.fightOn = false; w.cut = true; w.clearBullets(); w.hz = []; Barks.clear(); w.dnsT = 0;
  for (const e of w.en) if (!e.dead && (e instanceof Tentacle || e instanceof Cube || e instanceof Bug)) { e.dead = true; e.remove = true; FX.burst(e.x, e.y, 8, [P.u, P.M], 50, 0.4); }
  Sound.play(null); B.mood = 'daze'; B.sway = 0;
  for (let i = 0; i < 12; i++) { FX.boom(B.x + rand(-60, 60), B.y + rand(-30, 30), 2); Sound.sfx('boom'); Shake.add(6); B.flash = 0.06; yield C.wait(0.16); }
  Flash.go(1); Sound.sfx('bigboom'); Shake.add(14);
  w.en = w.en.filter(e => e !== B); S.fight = false;
  S.crabShow = true; S.crab = { x: 240, y: 150, scale: 2, daze: true };
  for (let i = 0; i < 40; i++) FX.p({ x: 240 + rand(-30, 30), y: 130 + rand(-20, 20), vx: rand(-120, 120), vy: rand(-140, 20), life: 1.4, max: 1.4, col: P.m, grav: 200 });
  yield C.wait(1.4);
  if (w.b.x0 > 12) yield C.tween(1.0, k => { w.b.x0 = lerp(w.b.x0, 12, k); w.b.x1 = lerp(w.b.x1, 468, k); });
  p.auto = { x: 240, y: 212 }; p.autoSpeed = 70; yield C.until(() => !p.auto);
  G.reached.cleared = true; saveG();
  yield* persuade(S);
}

function* persuade(S) {
  const w = S.w;
  Sound.play('love');
  yield* beat('boss.persuade.intro');
  S.crab.daze = false;
  // each round: lead lines, then a choice; wrong options get a reply and are removed until the "ok" one is picked
  for (const r of tv('boss.persuade.rounds') || []) { yield* playLines(r.lead); yield* round(S, r); }
  Sound.sfx('heart');
  for (let i = 0; i < 24; i++) FX.p({ x: S.crab.x + rand(-20, 20), y: S.crab.y - 20, vx: rand(-40, 40), vy: rand(-60, -20), life: 1.6, max: 1.6, col: choose([P.U, P.R, P.w]), size: 2 });
  yield* beat('boss.persuade.agree');
  S.power = true; Sound.sfx('win'); Flash.go(0.5, P.U);
  yield* beat('boss.persuade.after');
  for (let i = 0; i < 30; i++) FX.p({ x: S.crab.x + rand(-30, 30), y: S.crab.y - 10, vx: rand(-60, 60), vy: rand(-90, -30), life: 2, max: 2, col: choose([P.U, P.R]), size: 2 });
  Sound.sfx('heart');
  yield* beat('boss.persuade.last');
  yield C.wait(0.6);
  Sound.sfx('warp'); yield C.fade(1, 1.6, '#f4f4f4');
  go(RoomScene('epi'));
}
function* round(S, r) {
  let left = (r.options || []).slice();
  while (left.length) {
    const i = yield C.choose('me', textOf(r.prompt), left.map(o => textOf(o.text)));
    const o = left[i]; if (o.yar) G.stats.yar++;
    yield* playLines(o.reply);
    if (o.ok) return;
    G.stats.wrong++; left = left.filter(x => x !== o);
    if (left.length) yield C.say('f520', choose(tl('boss.persuade.retry')) || '', { face: 'f520_sad' });
  }
}

function* p2AI(S, resumed) {
  const B = S.B; if (!resumed) yield C.wait(0.8);
  let first = !resumed;
  const done = id => S.gates.find(g => g.id === id).done;
  while (!B.dead) {
    // rate limit / compact are gates: reaching their HP interrupts the current attack (see BossScene.update)
    const g = pendingGate(S);
    if (g) { yield* runGate(S, g); yield C.wait(0.8); continue; }
    const r = done('compact') ? 1.4 : done('ratelimit') ? 1.22 : 1;
    if (!S.bag.length) S.bag = shuffle(['claw', 'sweep', 'fork', 'cubes', 'ground', 'mail', 'brute', 'beam', 'love', 'spiral']);
    const a = first ? 'claw' : S.bag.pop(); first = false; S.trace.push([+S.t.toFixed(1), a]);
    yield* P2[a](S, r);
    yield C.wait(rand(0.7, 1.1) / r);
  }
}
// forced at P2_RATELIMIT_AT HP: invulnerable for exactly P2_RATELIMIT_SEC ("5 hours")
function* rateLimit(S) {
  const w = S.w, B = S.B; B.shield = true; B.shieldTxt = null; w.clearBullets();
  Banner.show(t('boss.p2.ratelimit.banner.title'), t('boss.p2.ratelimit.banner.sub'), P.C, 2.0);
  Barks.say('top', 'f520', t('boss.p2.ratelimit.bark'), 3);
  S.rlT = P2_RATELIMIT_SEC;
  yield C.wait(0.75);
  Barks.say('ally', 'opus', t('boss.p2.ratelimit.opus'), 3);
  let a = 0, n = 0;
  while (S.rlT > 0.25) {
    for (let i = 0; i < 4; i++) w.fire(B.x, B.y, a + i * TAU / 4, 58, 'code'); a += 0.33;
    if (n++ % 6 === 0) w.fire(B.x + rand(-30, 30), B.y + 24, rand(0.4, Math.PI - 0.4), 70, 'mail', { bounce: 2, life: 7 });
    yield C.wait(0.25);
  }
  yield C.until(() => S.rlT <= 0);
  S.rlT = 0; B.shield = false; B.mood = 'angry'; Sound.sfx('skill');
  Barks.say('top', 'f520', t('boss.p2.ratelimit.back'), 3);
}
// forced at P2_COMPACT_AT HP; she is shielded while the arena shrinks and can't be finished off before it's done
function* compact(S) {
  const w = S.w, B = S.B; w.clearBullets(); B.shield = true; B.shieldTxt = '/compact…';
  Banner.show(t('boss.p2.compact.banner.title'), t('boss.p2.compact.banner.sub'), P.y, 1.8);
  Barks.say('top', 'f520', t('boss.p2.compact.bark'), 3);
  yield C.tween(2.0, k => { w.b.x0 = lerp(12, 96, easeInOut(k)); w.b.x1 = lerp(468, 384, easeInOut(k)); });
  // whatever got squeezed out of the context is gone (coffee is kept, just nudged back in)
  for (const e of w.en) {
    if (e === B || e.dead || (e.x > w.b.x0 + 4 && e.x < w.b.x1 - 4)) continue;
    if (e instanceof Mug) e.x = clamp(e.x, w.b.x0 + 12, w.b.x1 - 12);
    else if (e instanceof Tentacle || e instanceof Cube || e instanceof Bug) { e.dead = true; e.remove = true; FX.burst(e.x, e.y, 8, [P.u, P.M], 50, 0.4); FX.text(e.x, e.y - 24, '[truncated]', P.G, 0.8); }
  }
  B.shield = false; B.shieldTxt = null; B.mood = 'angry'; Sound.sfx('skill');
  Barks.say('ally', 'opus', t('boss.p2.compact.opus'), 3);
}
const P2 = {
  *claw(S, r) {
    const w = S.w, B = S.B; Barks.say('top', 'f520', choose(tl('boss.p2.claw')), 2);
    const n = r > 1.2 ? 4 : 3;
    for (let i = 0; i < n; i++) {
      const cl = i % 2 ? B.clawR : B.clawL; const tx = clamp(w.p.x, w.b.x0 + 20, w.b.x1 - 20), ty = clamp(w.p.y, w.b.y0 + 16, w.b.y1 - 12);
      cl.ctrl = true; const sx = cl.x, sy = cl.y; const T = 0.8 / r;
      w.hz.push(new CircHz(tx, ty, 24, { tele: T, act: 0.12, onAct: (ww, h) => { Shake.add(6); Sound.sfx('stomp'); ww.ring(h.x, h.y, 12, 60 * r, 'clip', rand(TAU)); FX.burst(h.x, h.y, 14, [P.o, P.y, P.w], 90, 0.4); } }));
      yield C.tween(T * 0.75, k => { cl.x = lerp(sx, tx, easeOut(k)); cl.y = lerp(sy, ty - 40, easeOut(k)); cl.open = k; });
      yield C.tween(T * 0.25, k => { cl.y = lerp(ty - 40, ty, easeIn(k)); cl.open = 1 - k; });
      yield C.wait(0.3); cl.ctrl = false; yield C.wait(0.12 / r);
    }
  },
  *sweep(S, r) {
    const w = S.w; Barks.say('top', 'f520', t('boss.p2.sweep'), 2);
    const n = r > 1.2 ? 3 : 2;
    for (let i = 0; i < n; i++) { const y = clamp(w.p.y - 12, w.b.y0, w.b.y1 - 24); w.hz.push(new SweepHz(y, 24, i % 2 ? -1 : 1, w.b, { tele: 0.95 / r, dur: 0.5 })); yield C.wait(r > 1.2 ? 0.8 : 1.15); }
    yield C.wait(0.6);
  },
  *fork(S, r) {
    const w = S.w; S.say(':(){ :|:& };:'); Barks.say('top', 'f520', t('boss.p2.fork'), 2.6);
    const pids = [520, 1314, 5201314, 2333, 9527, 886, 4399, 1024]; let n = 0;
    const spawn = (x, y) => { const t = new Tentacle(clamp(x, w.b.x0 + 16, w.b.x1 - 16), clamp(y, w.b.y0 + 30, w.b.y1 - 8), pids[n++ % pids.length]); w.en.push(t); return t; };
    let alive = [spawn(w.p.x + rand(-80, 80), w.p.y + rand(-40, 40))];
    yield C.wait(1.5);
    for (let g = 0; g < 2; g++) {
      const next = [];
      for (const t of alive) if (!t.dead && !t.remove) { next.push(t); if (w.en.filter(e => e instanceof Tentacle).length < 7) next.push(spawn(t.x + rand(-70, 70), t.y + rand(-40, 40))); }
      if (!next.length) break;
      alive = next; FX.text(W / 2, w.b.y0 + 10, t('fx.fork', { n: alive.length }), P.U, 1); yield C.wait(1.5);
    }
  },
  *cubes(S, r) {
    const w = S.w; Barks.say('top', 'f520', t('boss.p2.cubes'), 2.4);
    const n = r > 1.2 ? 6 : 4;
    for (let i = 0; i < n; i++) { const x = i === 0 ? w.p.x : rand(w.b.x0 + 20, w.b.x1 - 20), y = i === 0 ? w.p.y : rand(w.b.y0 + 20, w.b.y1 - 14); w.hz.push(new CubeDrop(x, y, { tele: 0.95 })); yield C.wait(0.25); }
    yield C.wait(1.0);
  },
  *ground(S, r) {
    const w = S.w, B = S.B; Barks.say('top', 'f520', t('boss.p2.ground'), 2);
    const planes = [];
    for (let i = 0; i < 22; i++) { const a = Math.PI / 2 + (i / 21 - 0.5) * 2.7; planes.push(w.fire(B.x, B.y + 22, a, rand(105, 135), 'plane', { life: 14, upd: (b, dt) => { b.vx *= 1 - 1.3 * dt; b.vy *= 1 - 1.3 * dt; } })); }
    yield C.wait(1.0);
    Banner.show(t('boss.p2.ground_banner.title'), t('boss.p2.ground_banner.sub'), P.y, 1.4);
    for (const b of planes) { b.fx = b.vx; b.fy = b.vy; b.vx = 0; b.vy = 0; b.stopped = true; b.upd = null; }
    yield C.wait(1.3);
    Barks.say('top', 'f520', t('boss.p2.ground_resume'), 1.8);
    for (const b of planes) { if (b.life <= 0) continue; const a = angTo(b.x, b.y, w.p.x, w.p.y) + rand(-0.06, 0.06); b.vx = Math.cos(a) * 140 * r; b.vy = Math.sin(a) * 140 * r; b.stopped = false; }
    yield C.wait(1.2);
  },
  *mail(S, r) {
    const w = S.w, B = S.B; Barks.say('top', 'f520', t('boss.p2.mail'), 2.6);
    const n = Math.round(13 * r);
    for (let i = 0; i < n; i++) { w.fire(B.x + rand(-40, 40), B.y + 26, rand(0.35, Math.PI - 0.35), 78 * r, 'mail', { bounce: 2, life: 7 }); yield C.wait(0.13); }
    yield C.wait(1.2);
  },
  *brute(S, r) { yield* bruteKeys(S, r, 2); },
  *beam(S, r) {
    const w = S.w, B = S.B; Barks.say('top', 'f520', t('boss.p2.beam'), 2); B.sway = 0;
    const left = w.p.x < B.x; const a0 = left ? Math.PI * 0.04 : Math.PI * 0.96, a1 = left ? Math.PI * 0.96 : Math.PI * 0.04;
    const dur = 2.3 / r, back = r > 1.2;
    w.hz.push(new BeamHz(() => ({ x: B.x + BOSS_CFG.beamOrigin[0], y: B.y + BOSS_CFG.beamOrigin[1] }), a0, a1, { tele: 1.0, dur: back ? dur * 1.6 : dur, back }));
    if (!S.tip.beam) { S.tip.beam = 1; S.later(0.5, 'ally', 'opus', t('boss.tips.beam')); }
    yield C.wait(1.0 + (back ? dur * 1.6 : dur) + 0.2); B.sway = 1;
  },
  *love(S, r) {
    const w = S.w, B = S.B; Barks.say('top', 'f520', t('boss.p2.love'), 2);
    const D = { 5: ['111', '100', '111', '001', '111'], 2: ['111', '001', '111', '100', '111'], 0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'], 3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'] };
    const words = r > 1.2 ? ['520', '1314'] : ['520'];
    for (const word of words) {
      const sp = 9, dw = 3 * sp, gap = sp, tot = word.length * dw + (word.length - 1) * gap; const ox = clamp(w.p.x, w.b.x0 + tot / 2 + 4, w.b.x1 - tot / 2 - 4) - tot / 2, oy = w.b.y0 + 6;
      const hs = [];
      [...word].forEach((d, di) => D[d].forEach((row, ry) => [...row].forEach((c, cx) => { if (c === '1') hs.push(w.fire(ox + di * (dw + gap) + cx * sp + 4, oy + ry * sp, 0, 0, 'heart', { life: 12, harmless: true, r: 3 })); })));
      Sound.sfx('heart'); yield C.wait(0.9);
      const cx = ox + tot / 2, cy = oy + 20; const a = angTo(cx, cy, w.p.x, w.p.y);
      for (const h of hs) { h.harmless = false; h.vx = Math.cos(a) * 92 * r; h.vy = Math.sin(a) * 92 * r; }
      yield C.wait(1.3);
    }
  },
  *spiral(S, r) {
    const w = S.w, B = S.B; S.say('while (true) { clip(); clip(); }');
    let a = rand(TAU);
    for (let t = 0; t < 3.2; t += 0.12) { for (let i = 0; i < 4; i++) w.fire(B.x, B.y, a + i * TAU / 4, 60 * r, i % 2 ? 'code' : 'clip'); a += 0.19 * (t > 1.6 ? -1 : 1); yield C.wait(0.12); }
  },
};

/* =====================================================================
 * TouchUI controls: floating joystick (left), skill buttons (right),
 * tap-to-aim, pause / fast-forward. Drawn on a full-viewport overlay.
 * ===================================================================== */
const TouchUI = {
  on: false, cv: null, g: null, dpr: 1, vw: 0, vh: 0, u: 32,
  joy: null, held: new Map(), btns: [], mode: 'none', lastTouch: -1e9, mouseMoves: 0, t: 0,
  init() {
    this.cv = document.getElementById('ui'); this.g = this.cv.getContext('2d');
    const opt = { passive: false };
    addEventListener('touchstart', e => this.start(e), opt);
    addEventListener('touchmove', e => this.move(e), opt);
    addEventListener('touchend', e => this.end(e), opt);
    addEventListener('touchcancel', e => this.end(e), opt);
    if (window.matchMedia && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) this.setOn(true);
    this.resize();
  },
  fromTouch() { return performance.now() - this.lastTouch < 800; },
  mouseSeen() { if (++this.mouseMoves > 12) this.setOn(false); },
  setOn(v) {
    if (this.on === v) return; this.on = v; G.touch = v; this.mouseMoves = 0;
    this.cv.style.display = v ? 'block' : 'none';
    if (!v) { this.releaseAll(); }
    fit();
  },
  resize() {
    if (!this.cv) return;
    this.dpr = Math.min(3, window.devicePixelRatio || 1); this.vw = innerWidth; this.vh = innerHeight;
    this.cv.width = Math.round(this.vw * this.dpr); this.cv.height = Math.round(this.vh * this.dpr);
    this.cv.style.width = this.vw + 'px'; this.cv.style.height = this.vh + 'px';
    this.u = clamp(Math.min(this.vw, this.vh) * 0.085, 24, 46);
  },
  toLogical(x, y) { return { x: (x - VIEW.x) / VIEW.s, y: (y - VIEW.y) / VIEW.s }; },
  // which control set is visible right now
  computeMode() {
    if (!scene) return 'menu';
    if (Pause.on || scene.over) return 'menu';
    if (Dialog.on) return 'dialog';
    const w = scene.w;
    if (!w || w.cut || w.dead || w.bsod > 0 || (w.p && w.p.auto)) return 'menu';
    return scene.combat ? 'combat' : 'walk';
  },
  layout() {
    const u = this.u, vw = this.vw, vh = this.vh, B = [];
    const fx = vw - 2.3 * u, fy = vh - 2.3 * u;
    const mode = this.mode; const p = scene && scene.w && scene.w.p;
    const inter = scene && scene.interactLabel ? scene.interactLabel() : null;
    const below = vh - (VIEW.y + VIEW.h) > 3 * u; const ty = below ? VIEW.y + VIEW.h + 1.1 * u : 0.95 * u;
    if (scene && scene.pausable && (mode === 'combat' || mode === 'walk')) B.push({ id: 'pause', key: 'Escape', x: vw - 0.95 * u, y: ty, r: 0.62 * u, label: 'II', col: P.g });
    if (mode === 'dialog') B.push({ id: 'ffwd', key: 'Tab', x: vw - 0.95 * u, y: ty, r: 0.62 * u, label: '»', sub: t('ui.touch.ffwd'), col: P.y, hold: true });
    if (mode === 'combat' && p) {
      const sk = p.sk;
      if (sk.shoot) B.push({ id: 'fire', key: 'KeyJ', x: fx, y: fy, r: 1.45 * u, label: 'rm', sub: t('ui.touch.fire'), col: P.R, hold: true });
      if (sk.dash) B.push({ id: 'dash', key: 'Space', x: fx - 2.75 * u, y: fy + 0.45 * u, r: 0.95 * u, label: 'git', sub: t('ui.touch.dash'), col: P.C });
      if (sk.catch) B.push({ id: 'catch', key: 'KeyK', x: fx - 2.4 * u, y: fy - 1.75 * u, r: 0.92 * u, label: '{}', sub: t('ui.touch.catch'), col: P.l });
      if (sk.sudo) B.push({ id: 'sudo', key: 'KeyQ', x: fx - 0.75 * u, y: fy - 2.75 * u, r: 0.85 * u, label: '#', sub: t('ui.touch.sudo'), col: P.y });
      if (sk.ult) B.push({ id: 'ult', key: 'KeyE', x: fx + 1.1 * u, y: fy - 2.55 * u, r: 0.85 * u, label: ':(', sub: t('ui.touch.ult'), col: P.v });
      if (inter) B.push({ id: 'inter', key: 'KeyE', x: fx - 4.3 * u, y: fy + 0.6 * u, r: 0.8 * u, label: 'E', sub: inter, col: P.y });
    }
    if (mode === 'walk' && inter) B.push({ id: 'inter', key: 'KeyE', x: fx, y: fy, r: 1.2 * u, label: 'E', sub: inter, col: P.y });
    this.btns = B;
  },
  joyHome() { const u = this.u; return { x: 2.4 * u, y: this.vh - 2.4 * u }; },
  start(e) {
    e.preventDefault(); Sound.unlock(); this.lastTouch = performance.now();
    if (!this.on) { this.setOn(true); this.mode = this.computeMode(); this.layout(); }
    for (const t of e.changedTouches) {
      const x = t.clientX, y = t.clientY;
      const b = this.btns.find(b => (x - b.x) ** 2 + (y - b.y) ** 2 <= (b.r * 1.2) ** 2);
      if (b) { this.held.set(t.identifier, { type: 'btn', b }); this.press(b); continue; }
      if ((this.mode === 'combat' || this.mode === 'walk') && x < this.vw * 0.5) {
        this.joy = { id: t.identifier, bx: x, by: y, x, y }; this.held.set(t.identifier, { type: 'joy' }); continue;
      }
      const L = this.toLogical(x, y);
      Input.m.x = L.x; Input.m.y = L.y; Input.m.inside = L.x >= 0 && L.y >= 0 && L.x < W && L.y < H; Input.m.moved = performance.now();
      if (this.mode === 'combat') { Input.m.down[0] = true; this.held.set(t.identifier, { type: 'aim' }); continue; }
      Input.m.pressed[0] = true; Input.m.down[0] = true; Input.any = true; this.held.set(t.identifier, { type: 'tap' });
    }
  },
  move(e) {
    e.preventDefault(); this.lastTouch = performance.now();
    for (const t of e.changedTouches) {
      const h = this.held.get(t.identifier); if (!h) continue;
      if (h.type === 'joy' && this.joy) { this.joy.x = t.clientX; this.joy.y = t.clientY; this.updateAxis(); }
      else if (h.type === 'aim' || h.type === 'tap') { const L = this.toLogical(t.clientX, t.clientY); Input.m.x = L.x; Input.m.y = L.y; Input.m.moved = performance.now(); }
    }
  },
  end(e) {
    e.preventDefault(); this.lastTouch = performance.now(); Sound.unlock();
    for (const t of e.changedTouches) {
      const h = this.held.get(t.identifier); if (!h) continue; this.held.delete(t.identifier);
      if (h.type === 'joy') { this.joy = null; Input.axis.x = 0; Input.axis.y = 0; }
      else if (h.type === 'btn') this.release(h.b);
      else { Input.m.down[0] = false; }
    }
  },
  updateAxis() {
    const j = this.joy, R = 1.5 * this.u; let dx = j.x - j.bx, dy = j.y - j.by; const d = Math.hypot(dx, dy);
    if (d > R) { j.bx = j.x - dx / d * R; j.by = j.y - dy / d * R; dx = j.x - j.bx; dy = j.y - j.by; }
    const m = Math.min(1, d / R); const ax = d > 0 ? dx / d * m : 0, ay = d > 0 ? dy / d * m : 0;
    const dead = 0.18; const mm = Math.hypot(ax, ay);
    if (mm < dead) { Input.axis.x = 0; Input.axis.y = 0; } else { const k = (mm - dead) / (1 - dead) / mm; Input.axis.x = ax * k; Input.axis.y = ay * k; }
  },
  press(b) {
    Input.down.add(b.key); Input.pressed.add(b.key); Input.any = true; b.down = true;
    if (b.id === 'fire') Input.m.moved = -1e9;
    if (!b.hold) setTimeout(() => { if (!this.isHeld(b)) Input.down.delete(b.key); }, 60);
  },
  isHeld(b) { for (const h of this.held.values()) if (h.type === 'btn' && h.b.id === b.id) return true; return false; },
  release(b) { b.down = false; Input.down.delete(b.key); },
  releaseAll() { for (const h of this.held.values()) if (h.type === 'btn') this.release(h.b); this.held.clear(); this.joy = null; Input.axis.x = 0; Input.axis.y = 0; Input.m.down[0] = false; },
  update(dt) {
    if (!this.on) return; this.t += dt;
    const m = this.computeMode();
    if (m !== this.mode) {
      // controls that vanish must let go of their keys
      for (const [id, h] of [...this.held]) if (h.type === 'btn' || h.type === 'joy' || h.type === 'aim') { if (h.type === 'btn') this.release(h.b); if (h.type === 'joy') { this.joy = null; Input.axis.x = Input.axis.y = 0; } if (h.type === 'aim') Input.m.down[0] = false; this.held.delete(id); }
      this.mode = m;
    }
    const keep = {}; for (const h of this.held.values()) if (h.type === 'btn') keep[h.b.id] = true;
    this.layout(); for (const b of this.btns) b.down = !!keep[b.id];
  },
  draw() {
    if (!this.on) return;
    const g = this.g, d = this.dpr; g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, this.vw, this.vh);
    g.imageSmoothingEnabled = false; const u = this.u;
    const circle = (x, y, r, fill, stroke, lw = 2) => { g.beginPath(); g.arc(x, y, r, 0, TAU); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.stroke(); } };
    const label = (s, x, y, size, col) => { g.font = `${Math.round(size)}px ${FONT_FAMILY}, monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#1a1c2c'; g.fillText(s, x + 1, y + 1); g.fillStyle = col; g.fillText(s, x, y); };
    if (this.mode === 'combat' || this.mode === 'walk') {
      const j = this.joy || { ...this.joyHome(), bx: this.joyHome().x, by: this.joyHome().y };
      const R = 1.5 * u; const a = this.joy ? 0.9 : 0.45;
      g.globalAlpha = a; circle(j.bx, j.by, R, 'rgba(26,28,44,0.45)', 'rgba(244,244,244,0.55)', 2);
      circle(this.joy ? j.x : j.bx, this.joy ? j.y : j.by, 0.62 * u, 'rgba(148,176,194,0.75)', '#f4f4f4', 2); g.globalAlpha = 1;
      if (!this.joy) label(t('ui.touch.move'), j.bx, j.by + R + 0.45 * u, 0.42 * u, 'rgba(244,244,244,0.6)');
    }
    const p = scene && scene.w && scene.w.p;
    for (const b of this.btns) {
      let cd = 0; if (p) {
        if (b.id === 'dash') cd = Math.max(0, p.dashCd) / 0.6;
        if (b.id === 'catch') cd = p.catchT > 0 ? 1 : Math.max(0, p.catchCd) / p.catchCdMax;
        if (b.id === 'sudo') cd = p.sudoT > 0 ? 0 : Math.max(0, p.sudoCd) / p.sudoCdMax;
        if (b.id === 'ult') cd = p.ult >= 100 ? 0 : 1 - p.ult / 100;
      }
      circle(b.x, b.y, b.r, b.down ? 'rgba(244,244,244,0.35)' : 'rgba(26,28,44,0.55)', b.col, b.down ? 4 : 3);
      if (cd > 0) { g.beginPath(); g.moveTo(b.x, b.y); g.arc(b.x, b.y, b.r - 2, -Math.PI / 2, -Math.PI / 2 + TAU * cd); g.closePath(); g.fillStyle = 'rgba(14,15,25,0.6)'; g.fill(); }
      if (b.id === 'ult' && p && p.ult >= 100 && Math.floor(this.t * 5) % 2) circle(b.x, b.y, b.r + 4, null, '#f4f4f4', 2);
      if (b.id === 'sudo' && p && p.sudoT > 0) { g.beginPath(); g.arc(b.x, b.y, b.r + 4, -Math.PI / 2, -Math.PI / 2 + TAU * p.sudoT / 4); g.lineWidth = 3; g.strokeStyle = P.y; g.stroke(); }
      label(b.label, b.x, b.y - (b.sub ? b.r * 0.12 : 0), b.r * (b.id === 'fire' ? 0.6 : 0.7), b.col);
      if (b.sub) label(b.sub, b.x, b.y + b.r * 0.48, Math.max(10, b.r * 0.34), '#c0cbdc');
    }
    const below = this.vh - (VIEW.y + VIEW.h) > 1.6 * u;
    if (below && this.mode === 'dialog') label(t('ui.touch.tap_continue'), this.vw / 2 - 0.6 * u, VIEW.y + VIEW.h + 1.1 * u, 0.42 * u, 'rgba(244,244,244,0.55)');
    if (below && VIEW.portrait && this.mode !== 'dialog') label(t('ui.touch.landscape'), this.vw / 2 - 0.6 * u, VIEW.y + VIEW.h + 1.1 * u, 0.4 * u, 'rgba(148,176,194,0.7)');
  },
};

/* =====================================================================
 * Main loop, pause menu, boot
 * ===================================================================== */
const Pause = {
  on: false, sel: 0, help: false,
  auto() { if (scene && scene.pausable && !this.on && !(scene.over)) { this.on = true; this.sel = 0; } },
  items() { return [t('ui.pause.resume'), t('ui.menu.sound', { state: t(G.muted ? 'ui.menu.sound_off' : 'ui.menu.sound_on') }), t('ui.menu.help'), t('ui.pause.to_title')]; },
  update() {
    if (this.help) { if (K.confirm() || Input.hit('Escape')) { this.help = false; Input.consume(); } return; }
    const n = this.items().length;
    if (K.upP()) { this.sel = (this.sel + n - 1) % n; Sound.sfx('select'); }
    if (K.downP()) { this.sel = (this.sel + 1) % n; Sound.sfx('select'); }
    for (let i = 0; i < n; i++) { const y = 120 + i * 18; if (Input.mouseRecent() && Math.abs(Input.m.y - y - 6) < 8 && Math.abs(Input.m.x - W / 2) < 90 && this.sel !== i) { this.sel = i; Sound.sfx('select'); } }
    if (K.pause()) { this.on = false; Input.consume(); return; }
    if (Input.hit('Enter', 'NumpadEnter', 'Space', 'KeyZ', 'KeyJ') || Input.m.pressed[0]) {
      Input.consume(); Sound.sfx('confirm');
      if (this.sel === 0) this.on = false;
      else if (this.sel === 1) Sound.setMuted(!G.muted);
      else if (this.sel === 2) this.help = true;
      else { this.on = false; Dialog.close(); go(TitleScene()); }
    }
  },
  draw() {
    dRect(0, 0, W, H, P.k, 0.9);
    if (this.help) { drawHelp(); return; }
    box(W / 2 - 100, 70, 200, 128, P.k, P.y, P.d); bigTxt(t('ui.pause.title'), W / 2, 80, 2, P.y, 'center');
    this.items().forEach((s, i) => { const y = 120 + i * 18, on = i === this.sel; if (on) { rect(W / 2 - 90, y - 2, 180, 15, P.d); txt('▶', W / 2 - 84, y, P.y); } txt(s, W / 2, y, on ? P.y : P.g, 'center'); });
    txt(t('ui.pause.tip'), W / 2, 214, P.G, 'center');
  },
};

function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) (document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen).call(document.documentElement);
    else document.exitFullscreen();
  } catch (e) { /* not allowed here */ }
}

let lastT = 0;
function frame(ts) {
  const dt = Math.min(0.05, Math.max(0, (ts - lastT) / 1000) || 0.016); lastT = ts; G.dt = dt;
  ctx.setTransform(RES, 0, 0, RES, 0, 0); ctx.imageSmoothingEnabled = false;
  TouchUI.update(dt);
  if (nextScene) {
    scene = nextScene; nextScene = null; FX.clear(); Barks.clear(); Banner.b = null; Toast.t = null; Objective.clear(); Dialog.close(); Pause.on = false; Shake.amt = 0;
    scene.enter && scene.enter();
  }
  if (scene.pausable && K.pause() && !Pause.on && !(scene.over)) { Pause.on = true; Pause.sel = 0; Input.consume(); }
  if (Input.hit('KeyF')) toggleFullscreen();
  if (Input.hit('KeyM')) Sound.setMuted(!G.muted);
  if (Pause.on) Pause.update();
  else {
    Dialog.update(dt); scene.update(dt);
    Fade.update(dt); Shake.update(dt); Flash.update(dt); Toast.update(dt); Objective.update(dt);
  }
  ctx.save();
  if (Shake.amt > 0.3) ctx.translate(Math.round(rand(-1, 1) * Shake.amt * 0.5), Math.round(rand(-1, 1) * Shake.amt * 0.5));
  scene.draw();
  FX.drawText();
  ctx.restore();
  if (scene.drawUI) scene.drawUI();
  Dialog.draw(); Flash.draw(); Fade.draw();
  if (Pause.on) Pause.draw();
  if (!TouchUI.on) drawCursor(scene.combat && !Dialog.on && !Pause.on && !scene.over);
  TouchUI.draw();
  Input.consume();
  requestAnimationFrame(frame);
}

async function start() {
  TouchUI.init(); fit();
  await Promise.all([initLang(), loadAssets()]);
  scene = BootScene();
  scene.enter();
  requestAnimationFrame(frame);
}
start().catch(error => console.error('PAPERCLIP 520 failed to start:', error));

/* debug hooks for automated testing */
window.__pc = { go, G, get scene() { return scene; }, BossScene, StreetScene, RoomScene, TitleScene, CreditsScene, Input, Dialog, TouchUI, ASSETS, VIEW };
window.__i18n = { I18N, LANGS, t, tv, check: i18nCheck, use: id => I18N.use(id) };

