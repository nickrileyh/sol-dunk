/* SOL DUNK — browser client. Rendering, input, audio, betting flow. */
(() => {
  'use strict';
  const E = window.DunkEngine, PAY = window.DunkPaytable, BOT = window.DunkBot;
  const CFG = Object.assign({ serverUrl: null, network: 'devnet', demoStart: 10, minBet: 0.001, maxBet: 100, solIconUrl: null }, window.SOL_DUNK_CONFIG || {});
  const W = E.WORLD, P = E.PHYS, DT = E.DT, NL = E.LEVELS, NH = E.HOOPS_PER_LEVEL, EV = E.EV;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const round9 = (x) => Math.round(x * 1e9) / 1e9;
  const FONT_ROUND = 'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
  const FONT_DISPLAY = '"Big Shoulders Display", "Arial Narrow", "Roboto Condensed", sans-serif';

  // ---------------------------------------------------------------- format
  function fmtSol(x) { const a = Math.abs(x); return x.toFixed(a >= 100 ? 2 : a >= 10 ? 3 : 4); }
  function fmtBal(x) { return x >= 1 ? x.toFixed(2) : x.toFixed(4); }
  function fmtBet(x) { return (Math.round(x * 1e4) / 1e4).toString(); }
  function fmtMult(m) { return (m < 10 ? m.toFixed(2) : m < 100 ? m.toFixed(1) : Math.round(m).toString()) + '×'; }
  function fmtX(m) { return '×' + m.toFixed(3); }

  // ---------------------------------------------------------------- storage
  const store = {
    get(k, d) { try { const v = localStorage.getItem('soldunk.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('soldunk.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };

  // ---------------------------------------------------------------- sha256 / hmac (sync, for provably-fair seeds)
  const K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const ror = (x, n) => (x >>> n) | (x << (32 - n));
  function sha256(msg) {
    const l = msg.length, total = ((l + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total); buf.set(msg); buf[l] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, (l * 8) >>> 0); dv.setUint32(total - 8, Math.floor(l / 536870912));
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a, h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = ror(w[i - 15], 7) ^ ror(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = ror(w[i - 2], 17) ^ ror(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (ror(e, 6) ^ ror(e, 11) ^ ror(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
        const t2 = ((ror(a, 2) ^ ror(a, 13) ^ ror(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    const out = new Uint8Array(32), od = new DataView(out.buffer);
    [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => od.setUint32(i * 4, v >>> 0));
    return out;
  }
  function hmac256(key, msg) {
    if (key.length > 64) key = sha256(key);
    const k = new Uint8Array(64); k.set(key);
    const ip = new Uint8Array(64 + msg.length), op = new Uint8Array(96);
    for (let i = 0; i < 64; i++) { ip[i] = k[i] ^ 0x36; op[i] = k[i] ^ 0x5c; }
    ip.set(msg, 64); op.set(sha256(ip), 64);
    return sha256(op);
  }
  const utf8 = (s) => new TextEncoder().encode(s);
  const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
  function randomHex(n) { const a = new Uint8Array(n); if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (let i = 0; i < n; i++) a[i] = (Math.random() * 256) | 0; return hex(a); }
  // Level seed = HMAC-SHA256(serverSeed, clientSeed:nonce:level). Same derivation on the server.
  function deriveLevelSeed(serverSeed, clientSeed, nonce, level) { return hex(hmac256(utf8(serverSeed), utf8(clientSeed + ':' + nonce + ':' + level))); }

  // ---------------------------------------------------------------- settings / stats / wallet
  const settings = Object.assign({ sound: true, haptics: true }, store.get('settings', {}));
  const stats = Object.assign({ runs: 0, wagered: 0, returned: 0, best: 0, hoops: 0, swishes: 0, deepest: 0, history: [] }, store.get('stats', {}));
  const prefs = Object.assign({ di: 1, bet: 0.1 }, store.get('prefs', {}));
  const wallet = { balance: store.get('balance', CFG.demoStart), nonce: store.get('nonce', 0) };
  function saveAll() {
    store.set('settings', settings); store.set('stats', stats); store.set('prefs', prefs);
    store.set('balance', wallet.balance); store.set('nonce', wallet.nonce);
    store.set('profile', profile);
  }

  // ---------------------------------------------------------------- progression
  // Score, XP, achievements, daily challenges and cosmetics. All of it is presentation:
  // nothing here changes bets, ring layouts, physics or payouts, and XP never depends on bet size.
  const NT = E.DIFFS.length;
  const blankLv = () => E.DIFFS.map(() => Array.from({ length: NL }, () => [0, 0])); // [attempts, clears] per tier/level
  function fixProfile(p) {
    if (!Array.isArray(p.lv) || p.lv.length !== NT) p.lv = blankLv();
    if (!Array.isArray(p.best) || p.best.length !== NT) p.best = E.DIFFS.map(() => 0);
    if (!Array.isArray(p.deep) || p.deep.length !== NT) p.deep = E.DIFFS.map(() => 0);
    if (!Array.isArray(p.owned)) p.owned = [];
    for (const k of ['ball:classic', 'wing:angel', 'flame:fire']) if (!p.owned.includes(k)) p.owned.push(k);
    if (!Array.isArray(p.fresh)) p.fresh = [];
    p.ach = p.ach || {}; p.tot = Object.assign({ swish: 0, perfect: 0 }, p.tot || {});
    p.eq = Object.assign({ ball: 'classic', wing: 'angel', flame: 'fire' }, p.eq || {});
    return p;
  }
  const profile = fixProfile(Object.assign({ xp: 0 }, store.get('profile', {})));

  // Flappy-Dunk-style points: rim +1, swish +2, every swish in a row +1 more (up to +6). Perfect level +10.
  const ringPoints = (o, streak) => (o === 'S' ? 1 + Math.min(streak, 5) : 1);
  const PERFECT_BONUS = 10;
  const xpNeed = (l) => 50 + 25 * (l - 1); // XP from level l to l + 1
  function lvlOf(xp) {
    let l = 1, need = xpNeed(1);
    while (xp >= need && l < 99) { xp -= need; l++; need = xpNeed(l); }
    return { l, into: xp, need };
  }

  // Cosmetics. The ball is always drawn at its exact hitbox size whatever the skin.
  const BALLS = {
    classic: { name: 'Classic', grad: ['#ffc27a', '#ff8a2a', '#d9620f', '#a8460a'], seam: 'rgba(52,18,2,0.85)', rim: 'rgba(160,200,255,0.35)', halo: '255,140,40' },
    retro: { name: 'Retro', grad: ['#ffffff', '#f2f2f5', '#d6d8e0', '#a7abb8'], seam: 'rgba(25,25,35,0.75)', rim: 'rgba(160,200,255,0.35)', halo: '255,255,255', panels: ['#e0302a', '#1f5fd6'] },
    neon: { name: 'Neon', grad: ['#33467f', '#18224a', '#0b1128', '#05070f'], seam: '#5ff3ff', glow: '#3fd6ff', rim: 'rgba(95,243,255,0.45)', halo: '63,214,255' },
    frost: { name: 'Frost', grad: ['#ffffff', '#e2f5ff', '#a4dbff', '#5aa6e6'], seam: 'rgba(36,86,160,0.7)', rim: 'rgba(255,255,255,0.6)', halo: '160,220,255' },
    lava: { name: 'Lava', grad: ['#5c1c0d', '#2c0b05', '#170402', '#0a0201'], seam: '#ff8a2a', glow: '#ff4d12', rim: 'rgba(255,120,40,0.4)', halo: '255,90,31' },
    melon: { name: 'Melon', grad: ['#86e889', '#45b552', '#26843c', '#145726'], seam: 'rgba(8,48,18,0.85)', rim: 'rgba(210,255,210,0.35)', halo: '90,220,110', stripes: 'rgba(16,92,36,0.85)' },
    galaxy: { name: 'Galaxy', grad: ['#9a6cff', '#5230b0', '#24125a', '#0c0626'], seam: '#ff86e6', glow: '#d65cff', rim: 'rgba(210,170,255,0.45)', halo: '191,90,242', stars: true },
    gold: { name: 'Gold', grad: ['#fff8d0', '#ffd84a', '#d9a300', '#7f5200'], seam: 'rgba(92,56,0,0.85)', rim: 'rgba(255,255,255,0.55)', halo: '255,214,10', shine: true }
  };
  const WINGS = {
    angel: { name: 'Angel', near: ['#ffffff', '#f1f3f8', '#cfd5e2'], far: ['#c9cfdb', '#8e96a6'], hi: 'rgba(255,255,255,0.65)', vein: 'rgba(40,50,70,0.22)', edge: 'rgba(30,36,54,0.45)', farEdge: 'rgba(10,12,20,0.5)' },
    shadow: { name: 'Shadow', near: ['#626877', '#2d313b', '#16181e'], far: ['#3c404a', '#1a1c22'], hi: 'rgba(255,255,255,0.13)', vein: 'rgba(255,255,255,0.16)', edge: 'rgba(0,0,0,0.65)', farEdge: 'rgba(0,0,0,0.6)' },
    aqua: { name: 'Aqua', near: ['#f0fffd', '#9cf3ff', '#45b9ff'], far: ['#82d2e8', '#2f7fb0'], hi: 'rgba(255,255,255,0.6)', vein: 'rgba(10,80,120,0.25)', edge: 'rgba(10,60,100,0.5)', farEdge: 'rgba(5,30,60,0.5)' },
    ember: { name: 'Ember', near: ['#ffe8c4', '#ff9a3c', '#e0451a'], far: ['#d4743a', '#7a2a10'], hi: 'rgba(255,255,255,0.45)', vein: 'rgba(120,30,0,0.3)', edge: 'rgba(90,20,0,0.5)', farEdge: 'rgba(60,10,0,0.5)' },
    gold: { name: 'Gold', near: ['#fff8d6', '#ffd84a', '#c99400'], far: ['#d6b04a', '#8a6a10'], hi: 'rgba(255,255,255,0.55)', vein: 'rgba(110,70,0,0.3)', edge: 'rgba(90,60,0,0.55)', farEdge: 'rgba(60,40,0,0.5)' }
  };
  // Flames: a base palette and a hotter "nova" palette (5+ swishes in a row), edge to white-hot core.
  const FLAMES = {
    fire: { name: 'Fire', base: { outer: [255, 60, 16], mid: [255, 124, 20], inner: [255, 196, 72], core: [255, 244, 212] },
      nova: { outer: [104, 72, 255], mid: [60, 144, 255], inner: [140, 218, 255], core: [236, 248, 255] },
      hex: ['#fff1c4', '#ffc65a', '#ff9a2a', '#ff6a1f'], novaHex: ['#bfe8ff', '#7cb8ff', '#9a7bff', '#ffffff'] },
    ice: { name: 'Ice', base: { outer: [40, 96, 255], mid: [64, 160, 255], inner: [150, 222, 255], core: [240, 252, 255] },
      nova: { outer: [150, 60, 255], mid: [186, 110, 255], inner: [228, 186, 255], core: [255, 246, 255] } },
    toxic: { name: 'Toxic', base: { outer: [16, 140, 52], mid: [72, 214, 64], inner: [188, 255, 96], core: [246, 255, 224] },
      nova: { outer: [0, 140, 170], mid: [30, 210, 214], inner: [150, 255, 236], core: [238, 255, 252] } },
    rose: { name: 'Rose', base: { outer: [214, 20, 84], mid: [255, 72, 140], inner: [255, 160, 200], core: [255, 236, 246] },
      nova: { outer: [130, 40, 255], mid: [184, 92, 255], inner: [228, 172, 255], core: [255, 246, 255] } },
    gold: { name: 'Gold', base: { outer: [230, 110, 0], mid: [255, 170, 20], inner: [255, 222, 110], core: [255, 252, 226] },
      nova: { outer: [255, 190, 40], mid: [255, 226, 130], inner: [255, 246, 206], core: [255, 255, 255] } }
  };
  const hex3 = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const mix3 = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  for (const F of Object.values(FLAMES)) {
    F.trail = F.base.mid.join(',');
    F.hex = F.hex || [F.base.core, F.base.inner, F.base.mid, F.base.outer].map(hex3);
    F.novaHex = F.novaHex || [F.nova.inner, F.nova.mid, F.nova.outer, F.nova.core].map(hex3);
  }
  const COS = { ball: BALLS, wing: WINGS, flame: FLAMES };
  const UNLOCKS = [
    { t: 'ball', id: 'classic', lvl: 1 }, { t: 'ball', id: 'retro', lvl: 2 }, { t: 'ball', id: 'neon', lvl: 4 }, { t: 'ball', id: 'frost', lvl: 6 },
    { t: 'ball', id: 'lava', lvl: 8 }, { t: 'ball', id: 'melon', lvl: 12 }, { t: 'ball', id: 'galaxy', ach: 'nova5' }, { t: 'ball', id: 'gold', ach: 'champion' },
    { t: 'wing', id: 'angel', lvl: 1 }, { t: 'wing', id: 'shadow', lvl: 5 }, { t: 'wing', id: 'aqua', lvl: 10 }, { t: 'wing', id: 'ember', lvl: 15 }, { t: 'wing', id: 'gold', ach: 'perfect' },
    { t: 'flame', id: 'fire', lvl: 1 }, { t: 'flame', id: 'ice', lvl: 3 }, { t: 'flame', id: 'toxic', lvl: 7 }, { t: 'flame', id: 'rose', lvl: 13 }, { t: 'flame', id: 'gold', ach: 'streak10' }
  ];
  const TNAME = { ball: 'Ball', wing: 'Wings', flame: 'Flame' };
  const itemName = (u) => COS[u.t][u.id].name + ' ' + TNAME[u.t].toLowerCase();
  const isOwned = (t, id) => profile.owned.includes(t + ':' + id);
  const eqBall = () => BALLS[profile.eq.ball] || BALLS.classic;
  const eqWing = () => WINGS[profile.eq.wing] || WINGS.angel;
  const eqFlame = () => FLAMES[profile.eq.flame] || FLAMES.fire;
  const flameHex = (nova) => (nova ? eqFlame().novaHex : eqFlame().hex);
  const heatHex = (nova, k) => hex3((nova ? eqFlame().nova : eqFlame().base)[k || 'mid']);
  const heatRgb = (nova, k) => (nova ? eqFlame().nova : eqFlame().base)[k || 'mid'].join(',');
  const heatText = (nova) => mix3((nova ? eqFlame().nova : eqFlame().base).inner, (nova ? eqFlame().nova : eqFlame().base).core, 0.45).join(',');
  // the multiplier glow, callouts and streak meter take the equipped flame's colours
  function applyFlameTheme() {
    const F = eqFlame(), st = document.documentElement.style, j = (a) => a.join(',');
    for (const [k, P] of [['heat', F.base], ['nova', F.nova]]) {
      st.setProperty('--' + k, j(P.mid)); st.setProperty('--' + k + '-hi', j(P.inner));
      st.setProperty('--' + k + '-edge', j(P.outer)); st.setProperty('--' + k + '-text', j(mix3(P.inner, P.core, 0.45)));
    }
  }

  // r = what happened in the run (see runFacts)
  const ACH = [
    { id: 'swish1', name: 'Clean', desc: 'Swish a ring', xp: 10, test: (r) => r.swish >= 1 },
    { id: 'cp1', name: 'Checkpoint', desc: 'Clear level 1', xp: 10, test: (r) => r.clears >= 1 },
    { id: 'fire3', name: 'Heating up', desc: 'Swish 3 in a row', xp: 20, test: (r) => r.best >= 3 },
    { id: 'moving', name: 'Moving target', desc: 'Swish a moving ring', xp: 15, test: (r) => r.mov >= 1 },
    { id: 'nova5', name: 'Supernova', desc: 'Swish 5 in a row', xp: 40, test: (r) => r.best >= 5 },
    { id: 'perfect', name: 'Perfect level', desc: 'Swish all 6 rings in a level', xp: 50, test: (r) => r.perfect >= 1 },
    { id: 'tilted', name: 'Angles', desc: 'Swish a tilted ring', xp: 25, test: (r) => r.tilt >= 1 },
    { id: 'deep4', name: 'Deep run', desc: 'Reach level 4', xp: 40, test: (r) => r.level >= 4 },
    { id: 'score50', name: 'High flyer', desc: 'Score 50 in one run', xp: 40, test: (r) => r.score >= 50 },
    { id: 'double', name: 'Double up', desc: 'Cash out at 2× or more', xp: 60, test: (r) => r.paid && r.total >= 2 },
    { id: 'legend', name: 'Legendary', desc: 'Clear level 1 on Legend', xp: 60, test: (r) => r.di === NT - 1 && r.clears >= 1 },
    { id: 'deep6', name: 'Into the deep', desc: 'Reach level 6', xp: 80, test: (r) => r.level >= 6 },
    { id: 'streak10', name: 'Unstoppable', desc: 'Swish 10 in a row', xp: 100, test: (r) => r.best >= 10 },
    { id: 'swish100', name: 'Swish collector', desc: 'Swish 100 rings in total', xp: 50, test: () => profile.tot.swish >= 100 },
    { id: 'champion', name: 'Champion', desc: 'Clear all 8 levels', xp: 250, test: (r) => r.clears >= NL }
  ];
  const ACH_BY = Object.fromEntries(ACH.map((a) => [a.id, a]));
  const unlockReq = (u) => (u.lvl ? 'Level ' + u.lvl : ACH_BY[u.ach].name);

  // Daily challenges: three a day (easy, medium, hard), the same for everyone on a given date.
  // "sum" challenges add up over the day; the others have to happen within one run.
  const DAILY = [
    { k: 'swish', sum: true, n: [[10, 40], [18, 60], [28, 100]], text: (n) => `Swish ${n} rings` },
    { k: 'points', sum: true, n: [[50, 40], [90, 60], [140, 100]], text: (n) => `Score ${n} points` },
    { k: 'clears', sum: true, n: [[2, 40], [4, 60], [7, 100]], text: (n) => `Clear ${n} levels` },
    { k: 'best', n: [[3, 40], [4, 60], [6, 100]], text: (n) => `Swish ${n} in a row` },
    { k: 'score', n: [[20, 40], [32, 60], [48, 100]], text: (n) => `Score ${n} in one run` },
    { k: 'level', n: [[2, 40], [3, 60], [5, 100]], text: (n) => `Reach level ${n}` },
    { k: 'mov', sum: true, n: [[2, 40], [5, 60], [9, 100]], text: (n) => `Swish ${n} moving rings` },
    { k: 'perfect', sum: true, n: [[1, 50], [1, 70], [2, 110]], text: (n) => (n === 1 ? 'Swish every ring in a level' : `Swish every ring in ${n} levels`) }
  ];
  const DAILY_BY = Object.fromEntries(DAILY.map((d) => [d.k, d]));
  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dailySet() {
    const day = today();
    if (!profile.daily || profile.daily.day !== day || !Array.isArray(profile.daily.list)) {
      const rng = E.makeRng('daily|' + day), pool = DAILY.map((d) => d.k), list = [];
      for (let slot = 0; slot < 3; slot++) {
        const k = pool.splice(Math.floor(rng() * pool.length), 1)[0], [n, xp] = DAILY_BY[k].n[slot];
        list.push({ k, n, xp, p: 0, done: false });
      }
      profile.daily = { day, list };
    }
    return profile.daily.list;
  }
  const dailyText = (c) => DAILY_BY[c.k].text(c.n);
  function untilMidnight() {
    const now = new Date(), m = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const mins = Math.max(1, Math.round((m - now) / 60000));
    return mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm' : mins + 'm';
  }
  function grantUnlocks() {
    const L = lvlOf(profile.xp).l, got = [];
    for (const u of UNLOCKS) {
      const key = u.t + ':' + u.id;
      if (profile.owned.includes(key)) continue;
      if ((u.lvl && L >= u.lvl) || (u.ach && profile.ach[u.ach])) { profile.owned.push(key); profile.fresh.push(key); got.push(u); }
    }
    return got;
  }

  // ---------------------------------------------------------------- audio (synthesized, no assets)
  const Sound = (() => {
    let ac = null, master = null, noise = null;
    function ctx() {
      if (ac) return ac;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ac = new AC();
        master = ac.createGain(); master.gain.value = 0.55; master.connect(ac.destination);
        noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ac = null; }
      return ac;
    }
    function unlock() { const c = ctx(); if (c && c.state === 'suspended') c.resume().catch(() => {}); }
    function on() { return settings.sound && ctx() && ac.state === 'running'; }
    function env(g, t, a, d, peak) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
    function tone(freq, t, dur, type, peak, to) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      env(g, t, 0.005, dur, peak); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
    }
    function hiss(t, dur, f0, f1, q, peak, type) {
      const s = ac.createBufferSource(); s.buffer = noise;
      const f = ac.createBiquadFilter(); f.type = type || 'bandpass'; f.Q.value = q || 1;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ac.createGain(); env(g, t, 0.01, dur, peak);
      s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    }
    const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5, 1568, 1760];
    return {
      unlock,
      flap(fire) {
        if (!on()) return; const t = ac.currentTime; hiss(t, 0.08, 800, 1600, 1.2, 0.13); tone(200, t, 0.06, 'sine', 0.05, 130);
        if (fire > 0.2) hiss(t, 0.2, 240, 820, 0.7, 0.09 * fire, 'lowpass'); // the flame whooshes
      },
      swish(streak) {
        if (!on()) return; const t = ac.currentTime;
        hiss(t, 0.26, 5200, 1800, 0.8, 0.2, 'bandpass');
        const n = SCALE[Math.min(SCALE.length - 1, Math.max(0, streak - 1))];
        tone(n, t + 0.02, 0.34, 'sine', 0.13); tone(n * 2, t + 0.02, 0.2, 'sine', 0.035);
      },
      rim(power) {
        if (!on()) return; const t = ac.currentTime, p = clamp(power / 500, 0.15, 1);
        [430, 1130, 1720].forEach((f, i) => tone(f * rnd(0.98, 1.02), t, 0.22 - i * 0.05, 'sine', 0.1 * p / (i + 1)));
      },
      score() { if (!on()) return; const t = ac.currentTime; tone(659.25, t, 0.16, 'sine', 0.09); tone(987.77, t + 0.05, 0.2, 'sine', 0.06); },
      fire() { if (!on()) return; const t = ac.currentTime; hiss(t, 0.5, 300, 2400, 0.7, 0.18, 'lowpass'); },
      douse() { if (!on()) return; const t = ac.currentTime; hiss(t, 0.4, 3000, 600, 0.6, 0.1, 'bandpass'); },
      checkpoint() { if (!on()) return; const t = ac.currentTime; [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.085, 0.32, 'sine', 0.1)); },
      cash() { if (!on()) return; const t = ac.currentTime; for (let i = 0; i < 9; i++) tone(rnd(1700, 2600), t + i * 0.045, 0.09, 'sine', 0.05); tone(1046.5, t, 0.45, 'sine', 0.07); },
      bust() { if (!on()) return; const t = ac.currentTime; tone(300, t, 0.45, 'triangle', 0.09, 90); tone(110, t + 0.02, 0.25, 'sine', 0.12, 45); },
      click() { if (!on()) return; tone(1400, ac.currentTime, 0.025, 'sine', 0.035); },
      streakBreak() { if (!on()) return; const t = ac.currentTime; tone(392, t, 0.24, 'triangle', 0.05, 185); hiss(t, 0.2, 1400, 380, 0.7, 0.05, 'lowpass'); },
      best() { if (!on()) return; const t = ac.currentTime; [783.99, 1046.5, 1567.98].forEach((f, i) => { tone(f, t + i * 0.07, 0.36, 'sine', 0.08); tone(f * 2, t + i * 0.07, 0.2, 'sine', 0.02); }); },
      perfect() {
        if (!on()) return; const t = ac.currentTime;
        hiss(t, 1.1, 420, 1700, 0.45, 0.1, 'bandpass'); hiss(t + 0.05, 0.9, 900, 2600, 0.6, 0.05, 'bandpass'); // crowd swell
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + 0.04 + i * 0.03, 0.7, 'triangle', 0.045));
      },
      levelUp() { if (!on()) return; const t = ac.currentTime; [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => { tone(f, t + i * 0.075, 0.32, 'triangle', 0.06); tone(f * 2, t + i * 0.075, 0.18, 'sine', 0.02); }); },
      unlock() { if (!on()) return; const t = ac.currentTime; tone(1318.5, t, 0.55, 'sine', 0.07); tone(1975.5, t + 0.09, 0.7, 'sine', 0.05); tone(2637, t + 0.18, 0.5, 'sine', 0.025); }
    };
  })();
  function buzz(ms) { if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } } }

  // ---------------------------------------------------------------- bank: demo (local) and server (real SOL)
  const LocalBank = {
    real: false,
    cur: null,
    balance() { return wallet.balance; },
    async start(di, bet) {
      if (!(bet >= CFG.minBet)) throw new Error('Minimum bet is ' + CFG.minBet + ' SOL');
      if (bet > wallet.balance + 1e-12) throw new Error('Not enough demo SOL for that bet.');
      wallet.balance = round9(wallet.balance - bet);
      const serverSeed = randomHex(32), clientSeed = randomHex(8), nonce = wallet.nonce++;
      saveAll();
      this.cur = { di, bet, serverSeed, clientSeed, nonce, level: 1, total: 1, streak: 0 };
      return { seedHash: hex(sha256(utf8(serverSeed))), clientSeed, nonce, levelSeed: deriveLevelSeed(serverSeed, clientSeed, nonce, 1) };
    },
    // Re-verifies the level by replaying the taps, exactly as the server does.
    async level(L, taps) {
      const c = this.cur;
      const def = E.generateLevel(deriveLevelSeed(c.serverSeed, c.clientSeed, c.nonce, L), c.di, L);
      const r = E.replay(def, taps);
      const a = E.applyLevel(PAY.PAYTABLE[c.di][L - 1], r.outcomes, c.total, E.DIFFS[c.di].maxWin, c.streak);
      c.total = a.total; c.streak = a.streak; c.level = L;
      const status = a.capped ? 'maxwin' : r.result === 'clear' ? (L >= NL ? 'final' : 'checkpoint') : 'bust';
      let payout = 0;
      if (status === 'maxwin' || status === 'final') payout = this._pay();
      return { status, total: c.total, payout, serverSeed: status === 'checkpoint' ? null : c.serverSeed };
    },
    async next() { const c = this.cur; c.level++; return { levelSeed: deriveLevelSeed(c.serverSeed, c.clientSeed, c.nonce, c.level) }; },
    async cashout() { const payout = this._pay(); return { payout, serverSeed: this.cur.serverSeed }; },
    _pay() { const c = this.cur; const payout = round9(c.bet * c.total); wallet.balance = round9(wallet.balance + payout); saveAll(); return payout; }
  };

  // Real SOL: talks to server/server.mjs. Only active when SOL_DUNK_CONFIG.serverUrl is set.
  const ServerBank = {
    real: true, token: null, address: null, bal: 0, runId: null,
    async api(path, body) {
      const res = await fetch(CFG.serverUrl.replace(/\/$/, '') + path, {
        method: body ? 'POST' : 'GET',
        headers: Object.assign({ 'content-type': 'application/json' }, this.token ? { authorization: 'Bearer ' + this.token } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || ('Server error ' + res.status));
      if (typeof j.balance === 'number') this.bal = j.balance / 1e9;
      return j;
    },
    provider() { return (window.phantom && window.phantom.solana) || (window.solana && window.solana.isPhantom ? window.solana : null) || window.solflare || null; },
    async connect() {
      const p = this.provider();
      if (!p) throw new Error('No Solana wallet found. Open this page in Phantom or Solflare.');
      const r = await p.connect();
      this.address = (r && r.publicKey ? r.publicKey : p.publicKey).toString();
      const { message } = await this.api('/api/auth/nonce', { address: this.address });
      const signed = await p.signMessage(utf8(message), 'utf8');
      const sig = signed.signature || signed;
      const j = await this.api('/api/auth/verify', { address: this.address, signature: b58encode(new Uint8Array(sig)) });
      this.token = j.token;
      await this.api('/api/me');
    },
    balance() { return this.bal; },
    async deposit(sol) {
      const p = this.provider();
      const { message } = await this.api('/api/deposit/prepare', { lamports: Math.round(sol * 1e9) });
      const r = await p.request({ method: 'signAndSendTransaction', params: { message } });
      return this.api('/api/deposit/confirm', { signature: r.signature });
    },
    async withdraw(sol) { return this.api('/api/withdraw', { lamports: Math.round(sol * 1e9) }); },
    async start(di, bet) {
      const clientSeed = randomHex(8);
      const j = await this.api('/api/run/start', { difficulty: di, lamports: Math.round(bet * 1e9), clientSeed });
      this.runId = j.runId;
      return { seedHash: j.serverSeedHash, clientSeed, nonce: j.nonce, levelSeed: j.levelSeed };
    },
    async level(L, taps) {
      const j = await this.api('/api/run/level', { runId: this.runId, level: L, taps });
      return { status: j.status, total: j.total, payout: (j.payoutLamports || 0) / 1e9, serverSeed: j.serverSeed || null };
    },
    async next() { return this.api('/api/run/continue', { runId: this.runId }); },
    async cashout() { const j = await this.api('/api/run/cashout', { runId: this.runId }); return { payout: j.payoutLamports / 1e9, serverSeed: j.serverSeed }; }
  };
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58encode(bytes) {
    const digits = [0];
    for (const byte of bytes) {
      let carry = byte;
      for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let s = ''; for (const b of bytes) { if (b === 0) s += '1'; else break; }
    for (let i = digits.length - 1; i >= 0; i--) s += B58[digits[i]];
    return s;
  }
  let bank = LocalBank;

  // ---------------------------------------------------------------- canvas & view
  // The client shows a 352-unit-wide window of the 400-unit world (a little zoomed in),
  // world y from -10 to 680. Physics never depends on this.
  const VIEW_W = 352, VIEW_TOP = -10, VIEW_BOT = 680, VIEW_H = VIEW_BOT - VIEW_TOP, BALL_SX = 84; // the ball sits 24% in, so more of the course shows ahead
  const RV = P.R; // drawn ball radius = collision radius
  const cv = $('game'), cx = cv.getContext('2d');
  let vw = 0, vh = 0, dpr = 1, scale = 1, offX = 0, offY = 0;
  let bgEl = null;      // cached backdrop, rebuilt on resize
  let sheetTopC = -1;   // cached top of the bet sheet (layout read only when it changes)
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    bgEl = null; sheetTopC = -1;
    vw = window.innerWidth; vh = window.innerHeight;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    scale = Math.min(vw / VIEW_W, vh / VIEW_H);
    offX = (vw - VIEW_W * scale) / 2;
    offY = (vh - VIEW_H * scale) / 2 - VIEW_TOP * scale;
  }
  window.addEventListener('resize', resize);
  resize();

  // One backdrop for every level (no per-level colours): a night arena under one spotlight, with a
  // blue light washing down, haze pooling over the court and a vignette. Painted once at half
  // resolution (smooth gradients scale up invisibly); one blit per frame.
  const LIGHT = '61,123,255';
  const EDGE = '#05070d', EDGE0 = 'rgba(5,7,13,0)';
  const glowRgb = () => LIGHT;
  function backdrop() {
    if (bgEl) return bgEl;
    const el = document.createElement('canvas');
    el.width = Math.max(2, Math.round(vw * 0.5)); el.height = Math.max(2, Math.round(vh * 0.5));
    const g = el.getContext('2d');
    g.scale(el.width / vw, el.height / vh);
    const rgb = LIGHT;
    const lg = g.createLinearGradient(0, 0, 0, vh);
    lg.addColorStop(0, '#0b1120'); lg.addColorStop(0.6, '#070a14'); lg.addColorStop(1, EDGE);
    g.fillStyle = lg; g.fillRect(0, 0, vw, vh);
    // the level's light: a broad wash up high, and haze pooling over the court
    const playW = Math.min(vw, VIEW_W * scale);
    let rg = g.createRadialGradient(vw / 2, vh * 0.3, 0, vw / 2, vh * 0.3, Math.max(vw, vh) * 0.7);
    rg.addColorStop(0, 'rgba(' + rgb + ',0.12)'); rg.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = rg; g.fillRect(0, 0, vw, vh);
    g.save(); g.translate(vw / 2, vh * 0.92); g.scale(1, Math.min(0.4, 0.4 * vh / vw * 0.55 * 2));
    rg = g.createRadialGradient(0, 0, 0, 0, 0, vw * 0.95);
    rg.addColorStop(0, 'rgba(' + rgb + ',0.28)'); rg.addColorStop(0.55, 'rgba(' + rgb + ',0.08)'); rg.addColorStop(1, 'rgba(' + rgb + ',0)');
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, vw * 0.95, 0, Math.PI * 2); g.fill(); g.restore();
    // one spotlight from above: a long, soft elliptical beam over the play area
    const bh = vh * 1.05;
    g.save(); g.translate(vw / 2, -vh * 0.05); g.scale(Math.min(1, 0.62 * playW / bh), 1);
    const bm = g.createRadialGradient(0, 0, 0, 0, 0, bh);
    bm.addColorStop(0, 'rgba(200,214,255,0.15)'); bm.addColorStop(0.4, 'rgba(200,214,255,0.06)'); bm.addColorStop(1, 'rgba(200,214,255,0)');
    g.fillStyle = bm; g.beginPath(); g.arc(0, 0, bh, 0, Math.PI * 2); g.fill(); g.restore();
    const sg = g.createRadialGradient(vw / 2, 0, 0, vw / 2, 0, playW * 0.62);
    sg.addColorStop(0, 'rgba(215,225,255,0.16)'); sg.addColorStop(1, 'rgba(215,225,255,0)');
    g.fillStyle = sg; g.fillRect(0, 0, vw, vh);
    const vg = g.createRadialGradient(vw / 2, vh * 0.45, Math.min(vw, vh) * 0.3, vw / 2, vh * 0.45, Math.max(vw, vh) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = vg; g.fillRect(0, 0, vw, vh);
    return (bgEl = el);
  }
  // the big multiplier behind play, rasterised once per value instead of every frame
  const mult = { key: '', el: null, w: 0, h: 0 };
  function multSprite(text, col) {
    const px = 91 * scale * dpr; // largest drawn size (with pulse), in device pixels
    const key = text + '|' + col + '|' + px.toFixed(1);
    if (mult.key === key) return mult;
    const el = mult.el || document.createElement('canvas');
    const font = '800 ' + px.toFixed(1) + 'px ' + FONT_DISPLAY;
    let g = el.getContext('2d');
    g.font = font;
    const w = Math.ceil(g.measureText(text).width + px * 0.25), h = Math.ceil(px * 1.35);
    el.width = w; el.height = h;
    g = el.getContext('2d');
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgb(' + col + ')'; g.fillText(text, w / 2, h / 2);
    Object.assign(mult, { key, el, w: w / dpr, h: h / dpr });
    return mult;
  }

  // ---------------------------------------------------------------- fire palette
  // Fire runs from a near-white core out to its edge colour; a 5+ swish streak burns in the flame's hotter "nova"
  // palette (blue-white for the Fire flame). Every flame skin brings both palettes (FLAMES).
  const palMix = { outer: [0, 0, 0], mid: [0, 0, 0], inner: [0, 0, 0], core: [0, 0, 0] };
  function flamePal(n) {
    const F = eqFlame(), A = F.base, B = F.nova;
    for (const k in palMix) {
      const a = A[k], b = B[k], o = palMix[k];
      o[0] = Math.round(a[0] + (b[0] - a[0]) * n); o[1] = Math.round(a[1] + (b[1] - a[1]) * n); o[2] = Math.round(a[2] + (b[2] - a[2]) * n);
    }
    return palMix;
  }
  function rgba(c3, a) { return 'rgba(' + c3[0] + ',' + c3[1] + ',' + c3[2] + ',' + clamp(a, 0, 1).toFixed(3) + ')'; }
  // colour of a flame lick by age: t = 1 when born (hot) down to 0 (cool red edge)
  function lickRgba(n, t, a) {
    const P = flamePal(n), hot = t > 0.5;
    const A = hot ? P.mid : P.outer, B = hot ? P.inner : P.mid, u = hot ? (t - 0.5) * 2 : t * 2;
    return 'rgba(' + Math.round(A[0] + (B[0] - A[0]) * u) + ',' + Math.round(A[1] + (B[1] - A[1]) * u) + ',' + Math.round(A[2] + (B[2] - A[2]) * u) + ',' + clamp(a, 0, 1).toFixed(3) + ')';
  }
  let smokeEl = null; // one soft round sprite, reused for every puff of smoke
  function smokeSprite() {
    if (smokeEl) return smokeEl;
    smokeEl = document.createElement('canvas'); smokeEl.width = smokeEl.height = 64;
    const g = smokeEl.getContext('2d'), rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(150,160,185,0.9)'); rg.addColorStop(0.5, 'rgba(120,130,155,0.4)'); rg.addColorStop(1, 'rgba(110,120,145,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    return smokeEl;
  }

  // a short, soft motion trail behind the ball (world space)
  const trail = [];
  const TRAIL_T = 0.16;
  function pushTrail(x, y) {
    if (ball.hidden || ball.glide || REDUCED) { trail.length = 0; return; } // no streak while gliding into place
    const lastP = trail[trail.length - 1];
    if (lastP && Math.abs(lastP.x - x) + Math.abs(lastP.y - y) > 80) trail.length = 0; // teleports leave no streak
    trail.push({ x, y, t: view.time });
    while (trail.length > 2 && view.time - trail[0].t > TRAIL_T) trail.shift();
  }
  function drawTrail(c) {
    const n = trail.length;
    if (n < 3 || ball.fire > 0.35) return;
    const head = trail[n - 1], tail = trail[0];
    const len = Math.hypot(head.x - tail.x, head.y - tail.y);
    if (len < 6) return;
    const L = [], Rt = [];
    for (let i = 0; i < n; i++) {
      const a = trail[Math.max(0, i - 1)], b = trail[Math.min(n - 1, i + 1)], p = trail[i];
      let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const w = RV * 0.9 * Math.pow(i / (n - 1), 0.6);
      L.push(p.x - dy * w, p.y + dx * w); Rt.push(p.x + dy * w, p.y - dx * w);
    }
    c.beginPath(); c.moveTo(L[0], L[1]);
    for (let i = 2; i < L.length; i += 2) c.lineTo(L[i], L[i + 1]);
    for (let i = Rt.length - 2; i >= 0; i -= 2) c.lineTo(Rt[i], Rt[i + 1]);
    c.closePath();
    const g = c.createLinearGradient(tail.x, tail.y, head.x, head.y);
    const a = Math.min(1, len / 36) * 0.26 * Math.max(0, 1 - ball.fire * 2.5), tc = eqFlame().trail;
    g.addColorStop(0, 'rgba(' + tc + ',0)'); g.addColorStop(1, 'rgba(' + tc + ',' + a.toFixed(3) + ')');
    c.fillStyle = g; c.fill();
  }

  // ---------------------------------------------------------------- particles & texts
  const parts = [];
  function spawn(o) { if (parts.length > 420) parts.shift(); parts.push(Object.assign({ x: 0, y: 0, vx: 0, vy: 0, g: 0, life: 0.6, max: 0.6, size: 3, color: '#fff', kind: 0, rot: 0, vr: 0, drag: 0 }, o)); }
  const texts = [];
  function floatText(x, y, text, sub, color, size) { texts.push({ x, y, text, sub, color, size: size || 20, life: 1.0, max: 1.0 }); }

  // ---------------------------------------------------------------- game state
  const ball = {
    x: 0, y: 300, px: 0, py: 300, ox: 0, oy: 0, rot: 0, rv: 0, flap: 0, flapV: 0, vy: 0, vx: 160, glide: null, fall: null, hidden: false,
    fire: 0, nova: 0, fdx: -0.3, fdy: -0.95, lickAcc: 0, emberAcc: 0, lastVis: 0, // the flame on swish streaks
    fsp: [], tips: [], flare: 0, flick: 1, // the flame's spine and tongue tips (relative to the ball), flap flare, flicker
    tilt: 0, tiltV: 0,        // whole ball + wings lean: kicks back on a flap, noses down as it falls
    st: 0, stV: 0,            // takeoff stretch (springy)
    sq: 0, sqV: 0, sqX: 0, sqY: -1, // impact squash along the contact normal
    lastRim: -1
  };
  const view = { st: null, offset: 0, prevHoops: [], camX: 0, camY: 0, camV: 0, camT: null, zoom: 1, shake: 0, time: 0, pulse: 0, flash: 0, flashCol: '255,255,255' };
  let phase = 'lobby'; // lobby | ready | play | clearing | checkpoint | over | paused
  let pendingTap = false, acc = 0;
  const run = { di: 1, bet: 0.1, level: 1, total: 1, streak: 0, best: 0, hoops: 0, swishes: 0, rims: 0, taps: [], seedHash: '', clientSeed: '', nonce: 0, serverSeed: '', levelSeed: '', st: null, busy: false,
    score: 0, cleared: 0, perfect: 0, mov: 0, tilt: 0, lvlSw: 0, newBest: false, prog: null, lost: false };
  const RUN_FRESH = { score: 0, cleared: 0, perfect: 0, mov: 0, tilt: 0, lvlSw: 0, newBest: false, prog: null, lost: false };
  const attract = { st: null, bot: null, wait: 0, level: 1, streak: 0, acc: 0, tap: false };
  // rings from the level just played that are already behind the ball (never the unplayed ones ahead)
  function keepBehind(st) {
    if (!st) return [];
    return st.hoops.filter((h) => view.offset + h.x + h.w < ball.x - 4 && h.st !== 0).map((h) => ({ h, off: view.offset, t: st.tick * DT }));
  }
  function hoopVis(h) { return h.vis || (h.vis = { flash: 0 }); }

  // ---------------------------------------------------------------- HUD / DOM
  const ui = {
    pot: $('hudPot'), level: $('hudLevel'), pips: $('pips'), bal: $('balTxt'), balTag: $('balTag'),
    prompt: $('prompt'), promptT: $('promptText'), promptS: $('promptSub'),
    banner: $('banner'), bannerT: $('bannerT'), bannerS: $('bannerS'),
    lobby: $('lobby'), cp: $('checkpoint'), res: $('result'), panel: $('panel'), scrim: $('scrim'), toast: $('toast'),
    potCap: $('potCap'), mult: $('hudMult'), delta: $('potDelta')
  };
  const ICON = {
    flame: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 23c-4.4 0-8-3.1-8-7.5 0-3.3 2-5.6 3.7-7.4.6-.6 1.6-.2 1.6.7 0 1.4.9 2.6 2.1 2.6 1.1 0 1.8-.9 1.8-2.1 0-2.3-1.2-4.2-1.2-6.6 0-.9 1-1.5 1.7-1C17 3.9 20 8.4 20 14.5 20 19.6 16.4 23 12 23Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    medal: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.5 1.5h4l2.2 5-2.1 2.6H9.4L6.5 1.5Zm11 0h-4l-1.3 3 2.1 4.6 3.2-7.6Z" opacity=".55"/><circle cx="12" cy="15.5" r="7"/><path d="M12 11.6l1.15 2.35 2.6.38-1.88 1.83.44 2.59L12 17.53l-2.31 1.22.44-2.59-1.88-1.83 2.6-.38z" fill="#000" opacity=".3"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5l2.4 7.1 7.1 2.4-7.1 2.4L12 20.5l-2.4-7.1L2.5 11l7.1-2.4z"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 10V7.5a5 5 0 0 1 10 0V10h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1Zm2 0h6V7.5a3 3 0 0 0-6 0V10Z"/></svg>'
  };
  // numbers roll to their new value instead of jumping
  function countUp(el, from, to, fmt, ms) {
    const id = (el._cu = (el._cu || 0) + 1);
    if (REDUCED || !(Math.abs(to - from) > 1e-12)) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const tick = (t) => {
      if (el._cu !== id) return;
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(tick);
    };
    el.textContent = fmt(from);
    requestAnimationFrame(tick);
  }
  let potShown = 0, potUpTimer = 0;
  function fmtDelta(d) { return d >= 0.0001 ? fmtSol(d) : d >= 0.000001 ? d.toFixed(6) : d.toExponential(1); }
  function setPot(animate) {
    const v = run.bet * run.total;
    ui.mult.textContent = fmtMult(run.total);
    if (animate && v > potShown + 1e-12) { // a green "+gain" under the pot and a brief glow
      ui.delta.textContent = '+' + fmtDelta(v - potShown) + ' SOL';
      ui.delta.classList.remove('go'); void ui.delta.offsetWidth; ui.delta.classList.add('go');
      ui.potCap.classList.add('up'); clearTimeout(potUpTimer); potUpTimer = setTimeout(() => ui.potCap.classList.remove('up'), 700);
    }
    if (animate) countUp(ui.pot, potShown, v, fmtSol, 320); else { ui.pot._cu = (ui.pot._cu || 0) + 1; ui.pot.textContent = fmtSol(v); }
    potShown = v;
  }

  // the big multiplier warms with the swish streak, like the ball, and bumps on every ring
  function setHeat(streak) { ui.mult.classList.toggle('hot', streak >= 3 && streak < 5); ui.mult.classList.toggle('nova', streak >= 5); }
  function bumpScore() { if (REDUCED) return; const el = ui.mult; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

  // streak meter: flame, count, five heat bars (the swish pay tiers) and what the next swish pays
  const STK = { el: $('streak'), n: $('stkN'), t: $('stkT'), next: $('stkNext'), heat: $('streak').querySelectorAll('.heat i'), timer: 0, rect: null, k: 0, under: false };
  const streakName = (s) => (s >= 10 ? 'Unstoppable' : s >= 5 ? 'Supernova' : s === 4 ? 'Blazing' : s === 3 ? 'On fire' : s === 2 ? 'Double' : 'Swish');
  // the streak meter fades out of the way while the ball flies behind it
  function streakDodge() {
    const el = STK.el;
    let under = false;
    if (phase === 'play' && !ball.hidden && el.classList.contains('on') && view.bsr) {
      if (!STK.rect || ++STK.k % 12 === 0) STK.rect = el.getBoundingClientRect();
      const R = STK.rect, r = view.bsr + 8;
      under = view.bsx + r > R.left && view.bsx - r < R.right && view.bsy + r > R.top && view.bsy - r < R.bottom;
    }
    if (under !== STK.under) { STK.under = under; el.classList.toggle('under', under); }
  }
  function setStreakHud(mode) {
    const s = run.streak, el = STK.el;
    clearTimeout(STK.timer);
    if (mode === 'broke') {
      el.classList.remove('pump'); void el.offsetWidth; el.classList.add('broke');
      STK.timer = setTimeout(() => el.classList.remove('broke', 'on'), 650);
      return;
    }
    el.classList.remove('broke');
    if (s <= 1) { el.classList.remove('on', 'pump'); return; }
    el.classList.add('on');
    el.classList.toggle('t3', s >= 3 && s < 5); el.classList.toggle('t5', s >= 5);
    STK.n.textContent = s; STK.t.textContent = streakName(s);
    STK.heat.forEach((i, k) => i.classList.toggle('f', k < Math.min(s, 5)));
    STK.next.textContent = 'Next swish ' + fmtX(E.hoopMultiplier(PAY.PAYTABLE[run.di][run.level - 1], 'S', s + 1));
    if (mode === 'pump') { el.classList.remove('pump'); void el.offsetWidth; el.classList.add('pump'); }
  }

  function hideStreak() { clearTimeout(STK.timer); STK.el.classList.remove('on', 'pump', 'broke'); }

  // big moments (streak tiers, perfect level, new best): one at a time, newest wins if they pile up
  const CALL = { el: $('callout'), t: $('callT'), s: $('callS'), q: [], busy: false };
  function callout(t, s, cls) {
    CALL.q.push({ t, s, cls });
    if (CALL.q.length > 2) CALL.q.splice(0, CALL.q.length - 2);
    if (!CALL.busy) nextCallout();
  }
  function nextCallout() {
    const c = CALL.q.shift();
    if (!c) { CALL.busy = false; return; }
    CALL.busy = true;
    CALL.t.textContent = c.t; CALL.s.textContent = c.s || '';
    CALL.el.className = c.cls || '';
    void CALL.el.offsetWidth;
    CALL.el.classList.add('show');
    setTimeout(nextCallout, 800);
  }
  function clearCallouts() { CALL.q.length = 0; }
  function flash(col, a) { if (REDUCED) return; view.flashCol = col; view.flash = Math.max(view.flash, a); }

  // lobby: level ring on the profile capsule and today's challenge strip
  function refreshProfileHud() {
    const v = lvlOf(profile.xp);
    $('profLv').textContent = 'Level ' + v.l;
    $('xpArc').style.strokeDashoffset = (94.25 * (1 - v.into / v.need)).toFixed(2);
    $('profDot').classList.toggle('on', profile.fresh.length > 0);
    const list = dailySet(), cur = list.find((c) => !c.done), done = list.filter((c) => c.done).length;
    $('dailyBtn').classList.toggle('done', !cur);
    $('dailyIc').innerHTML = cur ? ICON.target : ICON.check;
    $('dailyT').textContent = cur ? dailyText(cur) : 'Daily challenges done';
    $('dailyP').textContent = cur ? `${cur.p}/${cur.n}` : `${done}/${list.length}`;
    $('dailyFill').style.width = ((cur ? cur.p / cur.n : 1) * 100).toFixed(0) + '%';
    $('dailyBtn').setAttribute('aria-label', cur ? `Daily challenge: ${dailyText(cur)}, ${cur.p} of ${cur.n}. ${done} of ${list.length} done today.` : 'Daily challenges done');
  }
  function setPips(st) {
    let h = '';
    for (let i = 0; i < NH; i++) {
      const o = st ? st.outcomes[i] : null;
      const now = st && !st.done && i === st.next;
      h += '<span class="seg-i' + (i === NH - 1 ? ' cp' : '') + (o ? ' on' + (o === 'S' ? ' sw' : '') : '') + (now ? ' now' : '') + '"></span>';
    }
    ui.pips.innerHTML = h;
    ui.level.textContent = 'Level ' + run.level;
  }
  function setBalance() {
    ui.bal.textContent = fmtBal(bank.balance());
    ui.balTag.textContent = bank.real ? (CFG.network === 'mainnet-beta' ? '' : 'Devnet') : 'Demo';
  }
  function showPrompt(t, s) { ui.promptT.textContent = t; ui.promptS.textContent = s || ''; ui.prompt.classList.add('show'); }
  function hidePrompt() { ui.prompt.classList.remove('show'); }
  let bannerTimer = 0;
  function banner(t, s, ms) {
    ui.bannerT.textContent = t; ui.bannerS.textContent = s || '';
    ui.banner.classList.add('show'); clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => ui.banner.classList.remove('show'), ms || 1300);
  }
  let toastTimer = 0;
  function toast(msg) { ui.toast.textContent = msg; ui.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2600); }
  // optional SOL token icon next to amounts: set SOL_DUNK_CONFIG.solIconUrl to the official asset
  if (CFG.solIconUrl) document.querySelectorAll('.sol-ico').forEach((el) => { const im = new Image(); im.alt = ''; im.src = CFG.solIconUrl; el.appendChild(im); });
  function setHudMode(play) { document.body.classList.toggle('hud-play', play); document.body.classList.toggle('hud-lobby', !play); }
  function show(el, on) { el.classList.toggle('hide', !on); }
  function armCard(el, ms) {
    el.classList.add('arming'); clearTimeout(el._arm);
    el._arm = setTimeout(() => el.classList.remove('arming'), REDUCED ? 250 : ms);
  }
  const armed = (el) => !el.classList.contains('hide') && !el.classList.contains('arming');

  // ---------------------------------------------------------------- lobby
  const CHIPS = [0.01, 0.05, 0.1, 0.5, 1];
  function avgClear(di, L) { return PAY.AVG_CLEAR[di][L - 1]; }
  function buildLobby() {
    const d = $('diffs');
    d.innerHTML = E.DIFFS.map((D, i) => `<button role="radio" id="diff${i}" data-di="${i}" aria-checked="${i === prefs.di}" aria-label="${D.name}, wins up to ${D.maxWin}×"><span class="tn">${D.name}</span><span class="tx">${D.maxWin}×</span></button>`).join('');
    d.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { prefs.di = +b.dataset.di; Sound.click(); refreshLobby(); saveAll(); }));
    $('chips').innerHTML = CHIPS.map((c) => `<button data-chip="${c}" aria-pressed="false">${c}</button>`).join('');
    $('chips').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { setBet(+b.dataset.chip); Sound.click(); }));
    $('betHalf').addEventListener('click', () => { setBet(prefs.bet / 2); Sound.click(); });
    $('betDouble').addEventListener('click', () => { setBet(prefs.bet * 2); Sound.click(); });
    const inp = $('betInput');
    inp.addEventListener('input', () => { const v = parseFloat(inp.value.replace(',', '.')); if (v > 0) { prefs.bet = v; refreshLobby(true); } });
    inp.addEventListener('blur', () => { setBet(prefs.bet); });
    inp.addEventListener('focus', () => { try { inp.select(); } catch (e) { /* ignore */ } });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { inp.blur(); startRun(); } });
    $('playBtn').addEventListener('click', () => startRun());
    $('profBtn').addEventListener('click', () => openPanel('profile'));
    $('dailyBtn').addEventListener('click', () => openPanel('profile'));
  }
  function setBet(v) {
    const max = Math.min(CFG.maxBet, Math.max(CFG.minBet, bank.balance()));
    prefs.bet = clamp(Math.round(v * 1e4) / 1e4, CFG.minBet, max);
    refreshLobby(); saveAll();
  }
  function refreshLobby(keepInput) {
    sheetTopC = -1;
    const di = prefs.di, D = E.DIFFS[di];
    document.querySelectorAll('#diffs button').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.di === di)));
    $('diffInfo').innerHTML = `${D.blurb}. Win up to <b>${fmtBet(prefs.bet * D.maxWin)} SOL</b> on this bet` + (profile.best[di] ? ` <span class="dim">· Best score ${profile.best[di]}</span>` : '') + '.';
    refreshProfileHud();
    if (!keepInput) $('betInput').value = fmtBet(prefs.bet);
    $('playAmt').textContent = fmtBet(prefs.bet) + ' SOL';
    document.querySelectorAll('#chips button').forEach((b) => b.setAttribute('aria-pressed', String(Math.abs(+b.dataset.chip - prefs.bet) < 1e-9)));
    const short = prefs.bet > bank.balance() + 1e-12, broke = bank.balance() < CFG.minBet;
    $('playBtn').disabled = short;
    const err = $('lobbyErr');
    if (broke && !bank.real) err.innerHTML = 'You\u2019re out of demo SOL. <button class="link" id="quickReset">Reset to ' + CFG.demoStart + ' SOL</button>';
    else err.textContent = short ? 'That bet is more than your balance.' : '';
    const qr = $('quickReset');
    if (qr) qr.addEventListener('click', () => { wallet.balance = CFG.demoStart; saveAll(); setBet(Math.min(prefs.bet, CFG.demoStart)); toast('Demo balance reset to ' + CFG.demoStart + ' SOL'); });
    setBalance();
  }

  // ---------------------------------------------------------------- run flow
  async function startRun() {
    if (run.busy || (phase !== 'lobby' && phase !== 'over')) return;
    Sound.unlock();
    const bet = prefs.bet;
    run.busy = true;
    try {
      const r = await bank.start(prefs.di, bet);
      Object.assign(run, { di: prefs.di, bet, level: 1, total: 1, streak: 0, best: 0, hoops: 0, swishes: 0, rims: 0, seedHash: r.seedHash, clientSeed: r.clientSeed, nonce: r.nonce, serverSeed: '', levelSeed: r.levelSeed }, RUN_FRESH);
      $('lobbyErr').textContent = '';
    } catch (e) {
      $('lobbyErr').textContent = e.message; run.busy = false;
      if (ui.lobby.classList.contains('hide')) { toast(e.message); backToLobby(); }
      return;
    }
    run.busy = false;
    stats.runs++; stats.wagered = round9(stats.wagered + bet); saveAll();
    show(ui.lobby, false); show(ui.res, false); show(ui.cp, false);
    ball.lastVis = 0; // a new run lets the old flame die down quietly
    setHudMode(true); setBalance();
    clearCallouts(); potShown = run.bet; setStreakHud();
    beginLevel(true);
  }

  function beginLevel(first) {
    const def = E.generateLevel(run.levelSeed, run.di, run.level);
    const prev = view.st;
    view.prevHoops = keepBehind(prev);
    view.offset = first && prev ? ball.x + 140 : ball.x + 24;
    run.st = E.createState(def); view.st = run.st; run.taps = []; run.lvlStart = run.total;
    if (autoBot) autoBot = BOT.createBot(autoBot.p, E.makeRng('auto' + Math.random()));
    settleOffset();
    ball.glide = { fx: ball.x, fy: ball.y, tx: view.offset, ty: def.startY, t: 0, d: 0.55 };
    ball.fall = null; ball.hidden = false;
    phase = 'ready';
    run.lvlSw = 0;
    profile.lv[run.di][run.level - 1][0]++;
    setPips(run.st); setPot(); setStreakHud(); setHeat(run.streak);
    if (run.level > 1) banner('Level ' + run.level, '', 1200);
    showPrompt(run.level === 1 ? 'Tap to fly' : 'Tap to go', run.level === 1 && newPlayer() ? 'Drop down through each ring' : '');
  }

  function settleOffset() { ball.x += ball.ox; ball.y += ball.oy; ball.ox = 0; ball.oy = 0; }
  function beginPlay() {
    hidePrompt();
    const fx = ball.x + ball.ox, fy = ball.y + ball.oy; // where the ball is drawn right now
    ball.glide = null;
    ball.x = view.offset + run.st.ball.x; ball.y = run.st.ball.y; ball.px = ball.x; ball.py = ball.y;
    ball.ox = fx - ball.x; ball.oy = fy - ball.y;
    phase = 'play'; pendingTap = true; acc = DT;
  }

  let autoBot = null; // test hook: window.__solDunk.autoplay('pro')
  const dbg = { freezeOnRim: false, frozen: false, fx: null, hold: false }; // test hooks: freeze on a rim contact, force a flame, hold the frame
  function physicsTick() {
    const st = run.st, b = st.ball;
    ball.px = view.offset + b.x; ball.py = b.y;
    if (autoBot && st.tick > 0 && BOT.decide(autoBot, st)) pendingTap = true;
    const tap = pendingTap; pendingTap = false;
    if (tap) run.taps.push(st.tick);
    const hi = st.next;
    const ev = E.step(st, tap);
    ball.x = view.offset + b.x; ball.y = b.y; ball.vy = b.vy; ball.vx = b.vx;
    if (ev) handleEvents(ev, st, hi);
  }

  function handleEvents(ev, st, hi) {
    const h = st.hoops[hi];
    if (ev & EV.FLAP) { hopFx(); Sound.flap(ball.fire); }
    if (ev & EV.RIM) { rimFx(h, st); if (dbg.freezeOnRim) { dbg.freezeOnRim = false; dbg.frozen = true; phase = 'paused'; acc = 0; } }
    if (ev & EV.SCORE) {
      const o = st.outcomes[st.outcomes.length - 1];
      if (onScore(o, h, st)) return;
    }
    if (ev & EV.CLEAR) { onClear(); return; }
    if (ev & (EV.MISS | EV.FLOOR)) onBust(st.result === 'floor' ? 'floor' : st.missKind, h);
  }

  function onScore(o, h, st) {
    run.hoops++;
    const was = run.streak;
    run.streak = o === 'S' ? run.streak + 1 : 0;
    if (o === 'S') { run.swishes++; run.lvlSw++; if (h.amp) run.mov++; if (h.tilt) run.tilt++; } else run.rims++;
    run.best = Math.max(run.best, run.streak);
    const pt = PAY.PAYTABLE[run.di][run.level - 1];
    const m = E.hoopMultiplier(pt, o, run.streak);
    const cap = E.DIFFS[run.di].maxWin;
    run.total = run.total * m;
    let capped = false;
    if (run.total >= cap) { run.total = cap; capped = true; }
    const pts = ringPoints(o, run.streak);
    scoreFx(o, h, st, m, run.streak, pts);
    view.pulse = 1;
    setPot(true); setPips(st); setHeat(run.streak); bumpScore();
    if (o === 'S') {
      setStreakHud('pump');
      const s = run.streak;
      if (s === 3) { callout('ON FIRE', 'Swish streak ×3', 'fire'); flash(heatRgb(0), 0.1); buzz([10, 25, 14]); }
      else if (s === 5) { callout('SUPERNOVA', 'Max streak bonus', 'nova'); flash(heatRgb(1), 0.13); buzz([12, 25, 12, 25, 18]); }
      else if (s >= 10 && s % 5 === 0) { callout(s === 10 ? 'UNSTOPPABLE' : s + ' IN A ROW', s + ' swishes in a row', 'nova'); flash(heatRgb(1), 0.14); }
    } else if (was > 1) setStreakHud('broke'); // a 2+ streak was burning: douse() plays the hiss
    addPoints(pts);
    if (capped) { endWin('maxwin'); return true; }
    return false;
  }
  function addPoints(n) {
    run.score += n;
    const b = profile.best[run.di];
    if (!run.newBest && b > 0 && run.score > b) {
      run.newBest = true;
      callout('NEW BEST', 'Beat your best of ' + b, 'gold'); Sound.best(); buzz([8, 30, 8]);
    }
  }

  function onClear() {
    phase = 'clearing';
    run.cleared++;
    profile.lv[run.di][run.level - 1][1]++;
    if (!REDUCED) view.shake = Math.max(view.shake, 2);
    confetti(ball.x, ball.y - 30, 56);
    Sound.checkpoint(); buzz([12, 40, 12]);
    if (run.lvlSw === NH) {
      run.perfect++;
      callout('PERFECT LEVEL', `${NH} of ${NH} swishes · +${PERFECT_BONUS}`, 'gold');
      flash('255,214,10', 0.14); Sound.perfect(); confetti(ball.x, ball.y - 30, 40);
      addPoints(PERFECT_BONUS); view.pulse = 1;
    }
    ball.glide = null;
    ball.fall = { vx: Math.max(120, run.st.ball.vx), vy: -240, hover: true, t: 0 };
    if (run.level >= NL) { endWin('final'); return; }
    const L = run.level;
    bank.level(L, run.taps.slice()).then((r) => {
      if (r.status !== 'checkpoint' || Math.abs(r.total - run.total) > 1e-9) return verifyFail();
      setTimeout(() => showCheckpoint(), REDUCED ? 100 : CALL.busy ? 1150 : 650);
    }).catch(netFail);
  }

  function onBust(kind, h) {
    phase = 'over';
    run.lost = true; setHeat(0); // the flame goes out with the run
    clearCallouts();
    if (run.streak > 1) setStreakHud('broke');
    const lostPot = run.bet * run.total;
    if (h) hoopVis(h).flash = -1;
    ball.fall = { vx: run.st.ball.vx * 0.6, vy: Math.min(run.st.ball.vy, 200), hover: false, t: 0 };
    if (!REDUCED) view.shake = 6;
    Sound.bust(); buzz([30, 60, 50]);
    const titles = { rimout: 'Rimmed out', over: 'Over the rim', under: 'Under the rim', floor: 'Hit the floor', timeout: 'Out of time' };
    const L = run.level, taps = run.taps.slice();
    bank.level(L, taps).then((r) => {
      if (r.status !== 'bust') return verifyFail();
      run.serverSeed = r.serverSeed || '';
      record(0, 'bust');
      setTimeout(() => showResult(titles[kind] || 'Missed', '−' + fmtBet(run.bet), 'loss', `Lost a ${fmtSol(lostPot)} SOL pot on level ${L}`), REDUCED ? 200 : 800);
    }).catch(netFail);
  }

  async function cashOut() {
    if (phase !== 'checkpoint' || run.busy || !armed(ui.cp)) return;
    run.busy = true;
    try {
      const r = await bank.cashout();
      run.serverSeed = r.serverSeed || '';
      run.busy = false;
      phase = 'over';
      hideStreak();
      winFx(1);
      record(r.payout, 'cashout');
      show(ui.cp, false);
      showResult('Cashed out', '+' + fmtSol(r.payout - run.bet), 'win', `${fmtSol(r.payout)} SOL · ${fmtMult(run.total)} after level ${run.level}`, r.payout - run.bet);
    } catch (e) { run.busy = false; netFail(e); }
  }

  function endWin(kind) {
    phase = 'over';
    clearCallouts(); hideStreak();
    const L = run.level;
    bank.level(L, run.taps.slice()).then((r) => {
      if (r.status !== kind || Math.abs(r.total - run.total) > 1e-9) return verifyFail();
      run.serverSeed = r.serverSeed || '';
      winFx(kind === 'maxwin' ? 1.6 : 1.3);
      record(r.payout, kind);
      const t = kind === 'maxwin' ? 'Max win' : 'Champion';
      const s = kind === 'maxwin' ? `${E.DIFFS[run.di].maxWin}× cap · ${fmtSol(r.payout)} SOL` : `All ${NL} levels · ${fmtSol(r.payout)} SOL`;
      setTimeout(() => showResult(t, '+' + fmtSol(r.payout - run.bet), 'win', s, r.payout - run.bet), 700);
    }).catch(netFail);
  }

  function verifyFail() {
    phase = 'over';
    toast('That run could not be verified. Your balance was refreshed.');
    setBalance(); backToLobby();
  }
  function netFail(e) { toast(e && e.message ? e.message : 'Connection problem. Try again.'); phase = 'over'; setBalance(); backToLobby(); }

  function record(payout, result) {
    stats.returned = round9(stats.returned + payout);
    stats.hoops += run.hoops; stats.swishes += run.swishes;
    stats.deepest = Math.max(stats.deepest, run.level);
    if (payout > 0) stats.best = Math.max(stats.best, run.total);
    stats.history.unshift({ t: Date.now(), di: run.di, bet: run.bet, payout, level: run.level, mult: payout > 0 ? run.total : 0, result, seedHash: run.seedHash, serverSeed: run.serverSeed, clientSeed: run.clientSeed, nonce: run.nonce });
    stats.history.length = Math.min(stats.history.length, 30);
    run.prog = progress(payout);
    saveAll(); setBalance();
  }

  // What the run earned outside the bet: personal best, XP, achievements, daily challenges, unlocks.
  function runFacts(payout) {
    return { di: run.di, score: run.score, points: run.score, swish: run.swishes, best: run.best, perfect: run.perfect,
      clears: run.cleared, level: run.level, mov: run.mov, tilt: run.tilt, paid: payout > 0, total: run.total };
  }
  function progress(payout) {
    const r = runFacts(payout), di = run.di, before = lvlOf(profile.xp);
    const prevBest = profile.best[di], newBest = run.score > prevBest;
    if (newBest) profile.best[di] = run.score;
    profile.deep[di] = Math.max(profile.deep[di], run.level);
    profile.tot.swish += run.swishes; profile.tot.perfect += run.perfect;
    const runXp = run.score + run.cleared * 5 + run.perfect * 15;
    let xp = runXp;
    const achs = ACH.filter((a) => !profile.ach[a.id] && a.test(r));
    for (const a of achs) { profile.ach[a.id] = Date.now(); xp += a.xp; }
    const dailies = [];
    for (const c of dailySet()) {
      if (c.done) continue;
      const v = r[c.k] || 0;
      c.p = Math.min(c.n, DAILY_BY[c.k].sum ? c.p + v : Math.max(c.p, v));
      if (c.p >= c.n) { c.done = true; dailies.push(c); xp += c.xp; }
    }
    profile.xp += xp;
    const unlocks = grantUnlocks();
    return { xp, runXp, before, after: lvlOf(profile.xp), newBest, prevBest, achs, dailies, unlocks };
  }

  function showCheckpoint() {
    phase = 'checkpoint';
    const L = run.level, pot = run.bet * run.total;
    $('cpKicker').textContent = 'Checkpoint ' + L + ' of ' + (NL - 1);
    $('cpTitle').innerHTML = 'Level ' + L + ' cleared' + (run.lvlSw === NH ? '<span class="cp-badge">PERFECT</span>' : '');
    countUp($('cpPot'), run.bet * (run.lvlStart || 1), pot, fmtSol, 750);
    $('cpMult').textContent = fmtMult(run.total) + ' · +' + fmtDelta(pot - run.bet) + ' SOL profit';
    // what the next level can pay (every ring swished, streak carried) and whether the streak carries over
    const nx = L + 1, di = run.di, pt = PAY.PAYTABLE[di][nx - 1];
    let up = run.total, s = run.streak;
    for (let i = 0; i < NH; i++) { s++; up *= E.hoopMultiplier(pt, 'S', s); }
    up = Math.min(up, E.DIFFS[di].maxWin);
    $('cpNextL').textContent = 'Next: Level ' + nx;
    $('cpUpTo').textContent = 'Up to ' + fmtMult(up);
    $('cpUpTo').setAttribute('title', 'If you swish all ' + NH + ' rings: ' + fmtSol(run.bet * up) + ' SOL');
    const sk = $('cpStreak');
    sk.className = 'nx-s' + (run.streak >= 5 ? ' nova' : '');
    sk.innerHTML = run.streak > 1 ? ICON.flame + `Your ${run.streak}-swish streak carries over` : '';
    $('cashAmt').textContent = fmtSol(pot) + ' SOL';
    $('goSub').textContent = 'Level ' + nx;
    show(ui.cp, true); armCard(ui.cp, 650);
    // focus the card, not a button: a Space meant as a flap must never press "Keep going"
    setTimeout(() => ui.cp.focus({ preventScroll: true }), 60);
  }

  async function keepGoing() {
    if (phase !== 'checkpoint' || run.busy || !armed(ui.cp)) return;
    run.busy = true;
    try {
      const r = await bank.next();
      run.levelSeed = r.levelSeed;
      run.busy = false;
    } catch (e) { run.busy = false; netFail(e); return; }
    Sound.click(); show(ui.cp, false);
    run.level++;
    beginLevel(false);
  }

  function showResult(title, amount, cls, sub, rollTo) {
    const pr = run.prog, nb = !!(pr && pr.newBest && run.score > 0);
    $('resTitle').textContent = title;
    if (rollTo != null) countUp($('resNum'), 0, rollTo, (x) => '+' + fmtSol(x), 800); else { $('resNum')._cu = ($('resNum')._cu || 0) + 1; $('resNum').textContent = amount; }
    $('resAmount').className = 'big ' + cls;
    $('resSub').textContent = sub;
    $('resStats').innerHTML = [[run.score, nb ? 'New best' : 'Score', nb], [run.hoops, 'Rings'], [run.best, 'Best streak']]
      .map(([v, k, hi]) => `<div${hi ? ' class="hi"' : ''}><b>${v}</b><span>${k}</span></div>`).join('');
    $('againAmt').textContent = fmtBet(prefs.bet) + ' SOL';
    showProgress(pr);
    show(ui.res, true); armCard(ui.res, 700);
    setTimeout(() => ui.res.focus({ preventScroll: true }), 60);
    refreshLobby();
  }
  function gainChip(cls, icon, text, i) { return `<span class="gain ${cls}" style="animation-delay:${(0.35 + i * 0.09).toFixed(2)}s">${icon}<span>${text}</span></span>`; }
  let xpTimers = [];
  function showProgress(pr) {
    const box = $('resXp'), fill = $('xpFill');
    xpTimers.forEach(clearTimeout); xpTimers = [];
    if (!pr) { box.style.display = 'none'; $('resGains').innerHTML = ''; return; }
    box.style.display = '';
    const b = pr.before, a = pr.after, up = a.l > b.l;
    $('xpGain').textContent = '+' + pr.xp + ' XP';
    $('xpLvl').textContent = 'Level ' + b.l;
    box.classList.remove('up');
    fill.style.transition = 'none'; fill.style.width = (b.into / b.need * 100).toFixed(1) + '%';
    void fill.offsetWidth;
    xpTimers.push(setTimeout(() => {
      fill.style.transition = 'width 0.8s cubic-bezier(.2,.9,.2,1)';
      fill.style.width = (up ? 100 : a.into / a.need * 100).toFixed(1) + '%';
    }, 250));
    if (up) xpTimers.push(setTimeout(() => {
      box.classList.add('up'); $('xpLvl').textContent = 'Level up! You\'re level ' + a.l;
      fill.style.transition = 'none'; fill.style.width = '0%'; void fill.offsetWidth;
      fill.style.transition = 'width 0.6s cubic-bezier(.2,.9,.2,1)'; fill.style.width = (a.into / a.need * 100).toFixed(1) + '%';
      Sound.levelUp(); buzz([10, 40, 10]);
    }, 1100));
    const g = [];
    pr.unlocks.forEach((u) => g.push(['unlock', ICON.spark, 'New ' + itemName(u)]));
    pr.achs.forEach((x) => g.push(['ach', ICON.medal, x.name + ' · +' + x.xp + ' XP']));
    pr.dailies.forEach((c) => g.push(['daily', ICON.check, dailyText(c) + ' · +' + c.xp + ' XP']));
    if (!g.length) { // nothing new this run: show the next daily challenge, so there's always a goal
      const c = dailySet().find((x) => !x.done);
      if (c) g.push(['', ICON.target, `${dailyText(c)} · ${c.p}/${c.n}`]);
    }
    const room = vh < 720 ? 3 : 4, more = g.length > room ? g.length - (room - 1) : 0;
    $('resGains').innerHTML = g.slice(0, more ? room - 1 : room).map((x, i) => gainChip(x[0], x[1], x[2], i)).join('') +
      (more ? gainChip('', ICON.spark, '+' + more + ' more', room - 1) : '');
    if (pr.achs.length || pr.unlocks.length || pr.dailies.length) xpTimers.push(setTimeout(() => Sound.unlock(), up ? 1500 : 500));
  }
  function backToLobby() {
    show(ui.res, false); show(ui.cp, false); hidePrompt();
    setHudMode(false);
    phase = 'lobby';
    run.st = null; run.streak = 0; view.st = null; view.prevHoops = []; ball.lastVis = 0;
    attract.wait = 0.3; attract.st = null;
    show(ui.lobby, true); refreshLobby();
  }
  if (window.ResizeObserver) { try { new ResizeObserver(() => { sheetTopC = -1; }).observe(ui.lobby); } catch (e) { /* optional */ } }

  // ---------------------------------------------------------------- guidance for new players
  const newPlayer = () => stats.runs <= 2;
  // a dotted path from the ball to the first ring, shown before the first few runs start
  function drawGuide(c, bx, by) {
    if (phase !== 'ready' || run.level !== 1 || !newPlayer() || !run.st || ball.glide) return;
    const h = run.st.hoops[0], hx = view.offset + h.x, hy = E.hoopY(h, 0);
    const tx = hx - 6, ty = hy - 4, mx = (bx + tx) / 2, my = Math.min(by, hy) - 90;
    const a = 0.32 + 0.1 * Math.sin(view.time * 3);
    c.save();
    c.strokeStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')'; c.lineWidth = 2.2; c.lineCap = 'round';
    c.setLineDash([0.1, 9]); c.lineDashOffset = -view.time * 22;
    c.beginPath(); c.moveTo(bx + 14, by - 10); c.quadraticCurveTo(mx, my, tx, ty - 26); c.stroke();
    c.setLineDash([]);
    // a small down-chevron just above the ring
    c.lineWidth = 2.4; c.strokeStyle = 'rgba(255,255,255,' + (a + 0.15).toFixed(3) + ')';
    const cy = ty - 22 + Math.sin(view.time * 4) * 2;
    c.beginPath(); c.moveTo(tx - 7, cy - 4); c.lineTo(tx, cy + 3); c.lineTo(tx + 7, cy - 4); c.stroke();
    c.restore();
  }

  // ---------------------------------------------------------------- effects
  function hopFx() {
    ball.flapV = -20;
    if (REDUCED) return;
    ball.flare = 1;      // a flap fans the flame (it throws off a few more wisps)...
    if (ball.fire > 0.1) ball.lickAcc += 2.5 * ball.fire;
    // ...and pushes a puff of air down from the wings
    spawn({ x: ball.x - RV * 0.35, y: ball.y + RV * 0.8, vx: ball.vx * 0.25, vy: 140, life: 0.28, max: 0.28, size: RV * 0.62, kind: 8, drag: 5 });
    ball.tiltV -= 6.2;   // lean back on the push...
    ball.stV += 1.7;     // ...stretch up a touch...
    ball.rv -= 4.2;      // ...and a little back-spin
  }
  function rimFx(h, st) {
    const p = st.impact;
    // contact normal from the nearer rim end, so the squash flattens the ball against that end
    const t = st.tick * DT, hy = E.hoopY(h, t), half = h.w / 2;
    let nx = 0, ny = -1, best = Infinity;
    for (let sd = -1; sd <= 1; sd += 2) {
      const px = view.offset + h.x + sd * half * h.c, py = hy + sd * half * h.s;
      const dx = ball.x - px, dy = ball.y - py, d = Math.hypot(dx, dy);
      if (d < best) { best = d; nx = dx / (d || 1); ny = dy / (d || 1); }
    }
    if (!REDUCED) { ball.sqX = nx; ball.sqY = ny; ball.sq = clamp(p / 2600, 0.03, 0.13); ball.sqV = 0; ball.st = 0; ball.stV = 0; }
    ball.rv += (nx > 0 ? 1 : -1) * clamp(p / 70, 1, 7);
    // knocks closer together than this are one sound and one spray
    if (view.time - ball.lastRim < 0.07) return;
    ball.lastRim = view.time;
    for (let i = 0; i < 6; i++) spawn({ x: ball.x - nx * P.R + rnd(-3, 3), y: ball.y - ny * P.R + rnd(-3, 3), vx: nx * rnd(40, 140) + rnd(-60, 60), vy: ny * rnd(40, 140) - rnd(20, 90), g: 900, life: 0.32, max: 0.32, size: 1.7, color: '#ffb067', kind: 0 });
    if (!REDUCED) view.shake = Math.max(view.shake, clamp(p / 260, 0.5, 1.3));
    Sound.rim(p); buzz(8);
  }
  function scoreFx(o, h, st, m, streak, pts) {
    const v = hoopVis(h);
    v.flash = 1;
    if (ball.fire > 0.3) v.heat = 1;
    const hx = view.offset + h.x, hy = E.hoopY(h, st.tick * DT);
    if (o === 'S') {
      const nova = streak >= 5, hot = streak >= 3, pal = hot ? flameHex(nova) : null;
      for (let i = 0; i < 16; i++) { const a = rnd(0, Math.PI * 2), s = rnd(60, 230); spawn({ x: hx, y: hy + 6, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.55 - 30, life: 0.55, max: 0.55, size: rnd(1.4, 2.8), color: pal ? pal[i % 4] : '#ffffff', kind: 0, drag: 2.2 }); }
      spawn({ x: hx, y: hy, kind: 3, life: 0.5, max: 0.5, size: h.w / 2 + P.RP, color: nova ? heatHex(1, 'inner') : hot ? heatHex(0, 'inner') : '#ffffff' });
      if (streak === 3 || streak === 5) ignite(nova ? 1 : 0);
      if (!REDUCED && streak >= 2) ball.flare = Math.max(ball.flare, streak === 3 || streak === 5 ? 1.6 : 0.9); // each swish feeds the fire
      Sound.swish(streak); buzz(10);
    } else { Sound.score(); }
    if (m != null) {
      const label = (o === 'S' ? streakName(streak) : 'Rim') + (pts ? ' +' + pts : '');
      const col = o === 'S' ? (streak >= 5 ? heatHex(1, 'inner') : streak >= 3 ? heatHex(0, 'inner') : '#ffffff') : 'rgba(222,230,255,0.75)';
      // up and behind the ball's path, so the label never sits on the ball
      floatText(hx - 10, hy - 70, label, fmtX(m), col, o === 'S' ? 19 + Math.min(streak, 5) * 1.1 : 17);
      if (o === 'S' && (streak === 3 || streak === 5 || streak === 10)) Sound.fire();
    }
  }
  // the moment the ball catches fire: a ring of flame bursts off it
  function ignite(n) {
    const N = REDUCED ? 5 : 12;
    for (let i = 0; i < N; i++) {
      const a = (i + rnd(-0.4, 0.4)) / N * Math.PI * 2, sp = rnd(90, 210);
      spawn({ x: ball.x + Math.cos(a) * RV * 0.6, y: ball.y + Math.sin(a) * RV * 0.6, vx: Math.cos(a) * sp + ball.vx * 0.6, vy: Math.sin(a) * sp - 40, life: rnd(0.24, 0.4), max: 0.4, size: RV * rnd(0.35, 0.6), kind: 6, n, burst: true, drag: 4 });
    }
    spawn({ x: ball.x, y: ball.y, kind: 3, life: 0.4, max: 0.4, size: RV * 1.1, color: heatHex(n ? 1 : 0, 'inner') });
  }
  // the streak broke: the flame goes out in a puff of smoke
  function douse(x, y) {
    for (let i = 0; i < (REDUCED ? 3 : 9); i++) spawn({ x: x + rnd(-8, 8), y: y + rnd(-8, 4), vx: rnd(-40, 20) + ball.vx * 0.2, vy: rnd(-150, -70), life: rnd(0.7, 1.1), max: 1.1, size: RV * rnd(0.6, 1.05), kind: 7, drag: 1.2 });
    Sound.douse();
  }
  function confetti(x, y, n) {
    const cols = ['#ff7a1a', '#f5c542', '#ffffff', '#3d7bff', '#ffd9a8'];
    for (let i = 0; i < n; i++) spawn({ x: x + rnd(-30, 30), y: y + rnd(-10, 10), vx: rnd(-260, 260), vy: rnd(-520, -160), g: 900, drag: 1.2, life: rnd(1.1, 1.8), max: 1.8, size: rnd(4, 7), color: cols[i % cols.length], kind: 1, rot: rnd(0, 6), vr: rnd(-12, 12) });
  }
  function winFx(k) {
    Sound.cash(); buzz([10, 30, 10, 30, 60]);
    const n = Math.round(26 * (k || 1));
    for (let i = 0; i < n; i++) spawn({ x: ball.x + rnd(-20, 20), y: ball.y + rnd(-20, 10), vx: rnd(-220, 220), vy: rnd(-560, -220), g: 1000, life: rnd(1.2, 1.9), max: 1.9, size: rnd(7, 10), color: i % 2 ? '#f5c542' : '#ffd36b', kind: 4, rot: rnd(0, 6), vr: rnd(-8, 8) });
    confetti(ball.x, ball.y - 40, Math.round(36 * (k || 1)));
  }

  // ---------------------------------------------------------------- attract mode (lobby background)
  function attractStep(dt) {
    if (!attract.st) {
      attract.wait -= dt;
      if (attract.wait > 0) return;
      attract.level = 1 + Math.floor(Math.random() * 3);
      const def = E.generateLevel('demo-' + Math.random().toString(36).slice(2), 1, attract.level);
      view.prevHoops = keepBehind(view.st);
      view.offset = ball.x + 40;
      attract.st = E.createState(def); view.st = attract.st;
      attract.bot = BOT.createBot('perfect', E.makeRng('a' + Math.random()));
      attract.tap = true; attract.acc = 0; attract.streak = 0;
      settleOffset();
      ball.glide = { fx: ball.x, fy: ball.y, tx: view.offset, ty: def.startY, t: 0, d: 0.5 };
      return;
    }
    if (ball.glide) return;
    attract.acc += dt;
    let n = 0;
    while (attract.acc >= DT && n++ < 10) {
      attract.acc -= DT;
      const st = attract.st, b = st.ball;
      ball.px = view.offset + b.x; ball.py = b.y;
      const hi = st.next;
      const ev = E.step(st, attract.tap);
      ball.x = view.offset + b.x; ball.y = b.y; ball.vy = b.vy; ball.vx = b.vx;
      if (ev & EV.FLAP) hopFx();
      if (ev & EV.SCORE) {
        const o = st.outcomes[st.outcomes.length - 1];
        attract.streak = o === 'S' ? attract.streak + 1 : 0;
        const v = hoopVis(st.hoops[hi]); v.flash = 1;
        if (o === 'S') spawn({ x: view.offset + st.hoops[hi].x, y: E.hoopY(st.hoops[hi], st.tick * DT), kind: 3, life: 0.5, max: 0.5, size: st.hoops[hi].w / 2 + P.RP, color: '#ffffff' });
      }
      if (st.done) {
        attract.st = null; attract.wait = 0.15;
        ball.fall = { vx: b.vx, vy: -200, hover: true, t: 0 };
        break;
      }
      attract.tap = BOT.decide(attract.bot, st);
    }
  }

  // ---------------------------------------------------------------- main loop
  let last = performance.now();
  function frame(tNow) {
    let dt = (tNow - last) / 1000; last = tNow;
    if (dbg.hold) { // frozen for tests; step(n) plays n more frames of 1/60 s
      if (!(dbg.steps > 0)) { requestAnimationFrame(frame); return; }
      dbg.steps--; dt = 1 / 60;
    }
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    view.time += dt;

    if (phase === 'play') {
      acc += dt;
      let n = 0;
      while (acc >= DT && n++ < 12) { acc -= DT; physicsTick(); if (phase !== 'play') { acc = 0; break; } }
    } else if (phase === 'lobby') attractStep(dt);

    // cosmetic ball motion outside physics
    if (ball.glide) {
      const g = ball.glide; g.t += dt / g.d;
      const k = g.t >= 1 ? 1 : 1 - Math.pow(1 - g.t, 3);
      ball.px = ball.x; ball.py = ball.y;
      ball.x = lerp(g.fx, g.tx, k); ball.y = lerp(g.fy, g.ty, k);
      ball.vx = 0; ball.vy = 0;
      if (g.t >= 1) { ball.glide = null; ball.fall = null; }
    } else if (ball.fall && (phase !== 'play' && (phase !== 'lobby' || !attract.st))) {
      const f = ball.fall; f.t += dt;
      ball.px = ball.x; ball.py = ball.y;
      if (f.hover) {
        f.vy = lerp(f.vy, Math.sin(view.time * 3) * 30, 1 - Math.exp(-dt * 3));
        f.vx = lerp(f.vx, 60, 1 - Math.exp(-dt * 1.5));
        if (Math.floor(view.time * 3) !== Math.floor((view.time - dt) * 3)) ball.flapV = -14;
      } else f.vy += P.G * dt;
      ball.x += f.vx * dt; ball.y += f.vy * dt;
      if (!f.hover && ball.y > W.FLOOR - P.R) { ball.y = W.FLOOR - P.R; f.vy *= -0.35; f.vx *= 0.7; if (Math.abs(f.vy) < 40) f.vy = 0; }
      ball.vy = f.vy; ball.vx = f.vx;
    } else if (phase === 'ready' && run.st) {
      const bob = Math.sin(view.time * 4) * 5;
      ball.px = ball.x; ball.py = ball.y;
      ball.x = view.offset + run.st.ball.x; ball.y = run.st.ball.y + bob;
      if (Math.floor(view.time * 2.2) !== Math.floor((view.time - dt) * 2.2)) ball.flapV = -16;
      ball.vy = Math.cos(view.time * 4) * 20; ball.vx = 0;
    }
    const alpha = phase === 'play' ? clamp(acc / DT, 0, 1) : 1;
    const ix = lerp(ball.px, ball.x, alpha), iy = lerp(ball.py, ball.y, alpha);
    updateFx(dt, ix, iy);
    render(alpha, ix + ball.ox, iy + ball.oy);
    streakDodge();
    requestAnimationFrame(frame);
  }

  function updateFx(dt, ix, iy) {
    const ko = Math.exp(-dt * 10); ball.ox *= ko; ball.oy *= ko;
    if (Math.abs(ball.ox) + Math.abs(ball.oy) < 0.05) { ball.ox = 0; ball.oy = 0; }
    const dxw = ix + ball.ox, dyw = iy + ball.oy; // the ball as drawn
    pushTrail(dxw, dyw);
    // wing: damped spring; taps kick it down
    ball.flapV += (-200 * ball.flap - 16 * ball.flapV) * dt;
    ball.flap += ball.flapV * dt;
    // character: the ball leans with its vertical speed (back when rising, nose-down when
    // falling) on a slightly bouncy spring, so every hop has a little lean-and-settle
    const sub = Math.max(1, Math.ceil(dt / 0.008)), h = dt / sub;
    const lean = ball.hidden ? 0 : clamp(ball.vy / P.VMAX, -1, 1) * 0.2;
    for (let i = 0; i < sub; i++) {
      ball.tiltV += (170 * (lean - ball.tilt) - 15 * ball.tiltV) * h; ball.tilt += ball.tiltV * h;
      ball.stV += (-420 * ball.st - 15 * ball.stV) * h; ball.st += ball.stV * h;
      ball.sqV += (-900 * ball.sq - 26 * ball.sqV) * h; ball.sq += ball.sqV * h;
    }
    ball.tilt = clamp(ball.tilt, -0.6, 0.45);
    ball.rv *= Math.exp(-dt * 4.5);
    ball.rot += (ball.vx / P.R * 0.3 + ball.rv) * dt;
    // fire: the ball smoulders on a double swish, burns from three in a row and turns blue-white from five
    const vis = dbg.fx != null ? dbg.fx : phase === 'lobby' ? Math.min(attract.streak, 4) : run.lost ? 0 : run.streak;
    const fireT = vis >= 5 ? 1 : vis === 4 ? 0.82 : vis === 3 ? 0.64 : vis === 2 ? 0.3 : 0;
    ball.fire = lerp(ball.fire, fireT, 1 - Math.exp(-dt * (fireT > ball.fire ? 5 : 3.5)));
    if (ball.fire < 0.004) ball.fire = 0;
    if (fireT > 0) ball.nova = lerp(ball.nova, vis >= 5 ? 1 : 0, 1 - Math.exp(-dt * 3));
    if (vis === 0 && ball.lastVis >= 2 && ball.fire > 0.12 && !ball.hidden) douse(dxw, dyw);
    ball.lastVis = vis;
    // the flame streams off the ball along a spine that trails it like a streamer in the wind (see updateSpine)
    ball.flare *= Math.exp(-dt * 6);
    ball.flick = 0.86 + 0.14 * noise1(view.time * 9.5 + 40);
    updateSpine(Math.min(dt, 1 / 30));
    if (ball.fire > 0.04 && !ball.hidden) {
      const f = ball.fire, n = ball.nova, dx = ball.fdx, dy = ball.fdy;
      // the tips of the tongues break off as wisps that drift back and rise
      ball.lickAcc += dt * (REDUCED ? 4 : 20) * f;
      while (ball.lickAcc >= 1) {
        ball.lickAcc -= 1;
        const T = ball.tips[(Math.random() * ball.tips.length) | 0];
        if (!T) break;
        spawn({ x: dxw + T.x, y: dyw + T.y, vx: ball.vx * 0.5 + T.dx * 50, vy: ball.vy * 0.5 + T.dy * 50 - 30, g: -300, life: rnd(0.16, 0.3), max: 0.3, size: RV * rnd(0.22, 0.36) * (0.6 + 0.6 * f), kind: 6, n, drag: 2.4, rot: Math.atan2(T.dy, T.dx) });
      }
      ball.emberAcc += dt * (REDUCED ? 3 : 16) * f;
      while (ball.emberAcc >= 1) {
        ball.emberAcc -= 1;
        const pal = flameHex(n > 0.5);
        spawn({ x: dxw + rnd(-0.6, 0.6) * RV, y: dyw + rnd(-0.6, 0.6) * RV, vx: ball.vx * 0.3 + dx * rnd(40, 120) + rnd(-30, 30), vy: ball.vy * 0.3 + dy * rnd(40, 120) - 50, life: rnd(0.45, 0.85), max: 0.85, size: rnd(1, 2.2), color: pal[(Math.random() * 3) | 0], kind: 5, drag: 1.4 });
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy += p.g * dt;
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
    }
    for (let i = texts.length - 1; i >= 0; i--) { const t = texts[i]; t.life -= dt; t.y -= 30 * dt; if (t.life <= 0) texts.splice(i, 1); }
    const springs = (h) => {
      const v = h.vis; if (!v) return;
      if (v.flash > 0) v.flash = Math.max(0, v.flash - dt * 2.2);
      if (v.heat > 0) v.heat = Math.max(0, v.heat - dt * 2.4);
    };
    if (view.st) view.st.hoops.forEach(springs);
    view.prevHoops.forEach((p) => springs(p.h));
    view.shake *= Math.exp(-dt * 9);
    view.pulse *= Math.exp(-dt * 3.5);
    view.flash *= Math.exp(-dt * 6);
    // zoom: in the lobby the view zooms out and lifts the world so the demo play fits above the bet
    // sheet. In a run it pulls back a little on faster levels, whose rings are spaced farther apart,
    // so the next ring comes into view as early as on level 1.
    let zoomT = 1, centreY = null;
    if (phase === 'lobby' && !ui.lobby.classList.contains('hide')) {
      if (sheetTopC < 0) sheetTopC = ui.lobby.offsetTop;
      const sheetTop = sheetTopC;
      zoomT = clamp((sheetTop - 84) / (360 * scale), 0.55, 1);
      centreY = (64 + sheetTop - 10) / 2;
    } else if (phase !== 'lobby' && run.st) zoomT = levelZoom(run.level);
    view.zoom = lerp(view.zoom, zoomT, 1 - Math.exp(-dt * 4));
    const S = scale * view.zoom;
    // camera: follows the drawn ball with velocity feed-forward, so the ball holds the same
    // spot on screen at every speed, and bounces still read as motion. In a run the ball keeps its
    // level-1 spot on screen whatever the zoom, so all of the extra view lies ahead of it, on every
    // screen size alike (wide screens fade their sides to the same window).
    const ballSX = offX + BALL_SX * scale, ox0 = (vw - VIEW_W * S) / 2;
    const target = phase === 'lobby' ? dxw - BALL_SX / view.zoom : dxw - (ballSX - ox0) / S;
    if (view.camT != null && dt > 0 && Math.abs(target - view.camT) < 60) {
      view.camV = lerp(view.camV, (target - view.camT) / dt, 1 - Math.exp(-dt * 4));
    } else if (view.camT == null) view.camX = target;
    view.camT = target;
    view.camX += view.camV * dt;
    view.camX = lerp(view.camX, target, 1 - Math.exp(-dt * (phase === 'play' ? 8 : 5)));
    const oy = (vh - VIEW_H * S) / 2 - VIEW_TOP * S;
    const camYT = centreY == null ? 0 : 300 - (centreY - oy) / S;
    view.camY = lerp(view.camY, camYT, 1 - Math.exp(-dt * 4));
  }

  // how far the view pulls back on a level: rings spread out 4% a level, the view widens 3.5%
  const levelZoom = (L) => 1 / (1 + 0.035 * (L - 1));

  // ---------------------------------------------------------------- rendering
  function render(alpha, bx, by) {
    const c = cx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalCompositeOperation = 'source-over';
    // backdrop (cached): the night arena, the same on every level
    c.drawImage(backdrop(), 0, 0, vw, vh);

    // the score, huge and quiet, behind everything (Flappy Dunk style); the pot sits in the HUD
    view.scoreA = lerp(view.scoreA == null ? 1 : view.scoreA, CALL.busy ? 0.25 : 1, 0.12);
    if (phase !== 'lobby' && run.st && run.score > 0) {
      const p = view.pulse, best = profile.best[run.di], cy = offY + 205 * scale, fa = view.scoreA;
      const col = run.newBest ? '245,197,66' : run.streak >= 5 ? heatText(1) : run.streak >= 3 ? heatText(0) : '255,255,255';
      const m = multSprite(String(run.score), col), k = (84 + p * 9) / 91;
      c.globalAlpha = Math.min(1, 0.09 + p * 0.26) * fa;
      c.drawImage(m.el, vw / 2 - m.w * k / 2, cy - m.h * k / 2, m.w * k, m.h * k);
      if (best > 0) {
        c.globalAlpha = (run.newBest ? 0.55 : 0.26) * fa;
        c.font = '800 ' + (15 * scale).toFixed(1) + 'px ' + FONT_DISPLAY; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillStyle = run.newBest ? '#f5c542' : '#ffffff';
        c.fillText(run.newBest ? 'NEW BEST' : 'BEST ' + best, vw / 2, cy + 48 * scale);
      }
      c.globalAlpha = 1;
    }

    // shake: smooth, decaying wobble rather than per-frame noise
    const sh = REDUCED ? 0 : view.shake, tt = view.time;
    const sx = sh > 0.05 ? sh * (Math.sin(tt * 61) * 0.6 + Math.sin(tt * 97 + 1.7) * 0.4) : 0;
    const sy = sh > 0.05 ? sh * (Math.sin(tt * 73 + 0.6) * 0.6 + Math.sin(tt * 89 + 2.9) * 0.4) : 0;
    const S = scale * view.zoom, k = S * dpr;
    const ox = (vw - VIEW_W * S) / 2, oy = (vh - VIEW_H * S) / 2 - VIEW_TOP * S;
    c.setTransform(k, 0, 0, k, (ox + sx) * dpr - view.camX * k, (oy + sy) * dpr - view.camY * k);
    view.bsx = ox + sx + (bx - view.camX) * S; view.bsy = oy + sy + (by - view.camY) * S;
    view.bsr = P.R * S;
    const worldLeft = view.camX - ox / S, worldW = vw / S;
    view.wl = view.camX + (offX - ox) / S; view.wr = view.camX + (offX + VIEW_W * scale - ox) / S; // the window everyone sees
    if (!(view.time - view.hudAt < 0.4)) { // where the HUD ends, so ring labels float below it (small phones)
      view.hudAt = view.time;
      const bot = (q) => { const e = document.querySelector(q), r = e && e.getBoundingClientRect(); return r && r.height && r.right > offX && r.left < offX + VIEW_W * scale ? r.bottom : 0; };
      view.hudBot = phase === 'lobby' ? 0 : Math.max(bot('#hud .hud-left .lvl'), bot('#streak.on'), bot('#hud .hud-mid'));
    }
    view.wt = view.hudBot ? view.camY + (view.hudBot - oy) / S : null;
    const st = view.st;
    const tNow = st ? (phase === 'play' ? (st.tick - 1 + alpha) * DT : st.tick * DT) : 0;
    const hoops = [];
    for (const p of view.prevHoops) hoops.push({ h: p.h, off: p.off, t: p.t });
    if (st) for (const h of st.hoops) hoops.push({ h, off: view.offset, t: Math.max(0, tNow) });
    const vis = hoops.filter((o) => { const x = o.off + o.h.x; return x > worldLeft - 80 && x < worldLeft + worldW + 80; });
    drawCourt(c, worldLeft, worldW, S, bx, by, vis);
    if (ball.fire > 0.05 && !ball.hidden && !REDUCED) fireLight(c, bx, by);
    view.nextRing = st && phase !== 'over' && phase !== 'clearing' ? st.hoops[st.next] || null : null;
    view.ringStreak = phase === 'lobby' ? attract.streak : run.streak;

    for (const o of vis) if (o.h.amp && o.h.st === 0) {
      const x = o.off + o.h.x;
      c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1.5; c.setLineDash([1.5, 6]); c.lineCap = 'round';
      c.beginPath(); c.moveTo(x, o.h.y0 - o.h.amp); c.lineTo(x, o.h.y0 + o.h.amp); c.stroke(); c.setLineDash([]);
    }
    const tgt = st && !st.done ? st.hoops[st.next] : null;
    for (const o of vis) { const j = tgt && o.h !== tgt && o.h.st === 0 ? st.hoops.indexOf(o.h) - st.next : 0; o.later = j > 0 ? (j === 1 ? 0.66 : 0.46) : 0; }
    for (const o of vis) drawRing(c, o, true);
    drawGuide(c, bx, by);
    if (!ball.hidden) drawTrail(c);
    drawParts(c, true);
    view.drawX = bx; view.drawY = by;
    if (!ball.hidden) drawBall(c, bx, by);
    for (const o of vis) drawRing(c, o, false);
    drawParts(c, false);
    drawTexts(c);
    if (view.flash > 0.004) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = 'rgba(' + view.flashCol + ',' + view.flash.toFixed(3) + ')'; c.fillRect(0, 0, vw, vh);
      c.globalCompositeOperation = 'source-over';
    }

    // wide screens: fade the sides so everyone sees the same distance ahead
    if (offX > 2 && (phase !== 'lobby' || view.zoom > 0.98)) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const l = c.createLinearGradient(offX - 40, 0, offX + 6, 0);
      l.addColorStop(0, EDGE); l.addColorStop(1, EDGE0);
      c.fillStyle = EDGE; c.fillRect(0, 0, Math.max(0, offX - 40), vh);
      c.fillStyle = l; c.fillRect(offX - 40, 0, 46, vh);
      const r0 = offX + VIEW_W * scale;
      const r = c.createLinearGradient(r0 - 6, 0, r0 + 40, 0);
      r.addColorStop(0, EDGE0); r.addColorStop(1, EDGE);
      c.fillStyle = r; c.fillRect(r0 - 6, 0, 46, vh);
      c.fillStyle = EDGE; c.fillRect(r0 + 40, 0, vw, vh);
    }
  }

  // ---------------------------------------------------------------- court
  // A polished floor that catches the level's light, boards receding toward you, the ball's shadow
  // and, when it burns, the glow of its flame on the boards.
  function fireLight(c, x, y) {
    const R = RV * (6 + 3 * ball.fire), g = c.createRadialGradient(x, y, RV, x, y, R), Pf = flamePal(ball.nova);
    g.addColorStop(0, rgba(Pf.mid, 0.12 * ball.fire * ball.flick)); g.addColorStop(1, rgba(Pf.mid, 0));
    c.globalCompositeOperation = 'lighter'; c.fillStyle = g;
    c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'source-over';
  }
  function drawCourt(c, left, width, S, bx, by, rings) {
    const lr = glowRgb(), x0 = left - 20, w = width + 40, F = W.FLOOR;
    const fg = c.createLinearGradient(0, F, 0, F + 150);
    fg.addColorStop(0, 'rgba(' + lr + ',0.24)'); fg.addColorStop(0.07, 'rgba(17,21,34,0.97)'); fg.addColorStop(1, EDGE);
    c.fillStyle = fg; c.fillRect(x0, F, w, 420);
    const mid = left + width / 2, step = 34;
    c.strokeStyle = 'rgba(255,255,255,0.055)'; c.lineWidth = 1 / S;
    c.beginPath();
    for (let x = Math.floor(x0 / step) * step; x < x0 + w + step; x += step) { c.moveTo(x, F); c.lineTo(mid + (x - mid) * 2.4, F + 120); }
    c.stroke();
    const fade = c.createLinearGradient(0, F + 6, 0, F + 120);
    fade.addColorStop(0, EDGE0); fade.addColorStop(1, EDGE);
    c.fillStyle = fade; c.fillRect(x0, F + 6, w, 420);
    // each ring casts a soft shadow on the boards below it, so the rings sit in the space
    if (rings) for (const o of rings) {
      const h = o.h, x = o.off + h.x, d = clamp((F - E.hoopY(h, o.t)) / 700, 0, 1);
      const rx = (h.w / 2 + P.RP) * (1 + 0.5 * d), a = (0.42 - 0.3 * d) * (h.st === 1 ? 0.4 : 1);
      const sg = c.createRadialGradient(x, F + 3, 0, x, F + 3, rx);
      sg.addColorStop(0, 'rgba(0,0,0,' + a.toFixed(3) + ')'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      c.save(); c.translate(x, F + 3); c.scale(1, 0.13); c.translate(-x, -(F + 3));
      c.fillStyle = sg; c.beginPath(); c.arc(x, F + 3, rx, 0, Math.PI * 2); c.fill(); c.restore();
    }
    if (!ball.hidden) {
      const hgt = clamp((F - by) / 560, 0, 1), sw = RV * (1.7 - 0.8 * hgt);
      c.fillStyle = 'rgba(0,0,0,' + (0.55 * (1 - hgt) + 0.1).toFixed(3) + ')';
      c.beginPath(); c.ellipse(bx, F + 3, sw, sw * 0.17, 0, 0, Math.PI * 2); c.fill();
      if (ball.fire > 0.03) {
        const pal = flamePal(ball.nova), rr = 130 * (1 - 0.45 * hgt);
        c.save(); c.globalCompositeOperation = 'lighter'; c.translate(bx, F + 1); c.scale(1, 0.2);
        const pg = c.createRadialGradient(0, 0, 0, 0, 0, rr);
        pg.addColorStop(0, rgba(pal.mid, 0.4 * ball.fire * ball.flick * (1 - 0.6 * hgt))); pg.addColorStop(1, rgba(pal.mid, 0));
        c.fillStyle = pg; c.beginPath(); c.arc(0, 0, rr, 0, Math.PI * 2); c.fill(); c.restore();
      }
    }
    const fl = c.createLinearGradient(left, 0, left + width, 0);
    fl.addColorStop(0, 'rgba(255,255,255,0)'); fl.addColorStop(0.5, 'rgba(255,255,255,0.32)'); fl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = fl; c.fillRect(x0, F, w, 1 / S);
  }

  // ---------------------------------------------------------------- rings: shaded torus sprites
  // Each ring is drawn exactly at its collision size (tube centre = rim peg, tube width = peg size).
  // Sprites are cached per size, colour and pixel density.
  // Painted steel rims: no neon glow, light from the spotlight above, the far side in shadow.
  const RING_PAL = {
    red: { dark: '#4a0a07', back: '#a3231b', mid: '#e5352b', light: '#ff9a88' },
    gold: { dark: '#4c3500', back: '#a77a12', mid: '#f0b92a', light: '#fff2bf' },
    grey: { dark: '#131722', back: '#262b39', mid: '#363d4f', light: '#5f6880' }
  };
  const RING_RY = 0.34;
  function lerpHex(a, b, t) {
    const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(((A >> sh) & 255) + (((B >> sh) & 255) - ((A >> sh) & 255)) * t);
    return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
  }
  function ringHalf(c, rx, ry, lw, pal, front) {
    const a0 = front ? 0 : Math.PI, a1 = front ? Math.PI : Math.PI * 2, top = front ? pal.mid : pal.back;
    c.lineCap = 'round';
    const steps = 6; // tube cross-section: shadowed underside up to the lit top
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      c.strokeStyle = lerpHex(pal.dark, top, Math.min(1, t * 1.5));
      c.lineWidth = lw * (1 - t * 0.6);
      c.beginPath(); c.ellipse(0, -lw * 0.08 * t, rx, ry, 0, a0, a1); c.stroke();
    }
    c.strokeStyle = pal.light; c.globalAlpha = front ? 0.85 : 0.3; c.lineWidth = lw * 0.18;
    c.beginPath(); c.ellipse(0, -lw * 0.26, rx, ry, 0, front ? 0.12 * Math.PI : 1.08 * Math.PI, front ? 0.88 * Math.PI : 1.92 * Math.PI); c.stroke();
    if (front) {
      c.strokeStyle = '#ffffff'; c.globalAlpha = 0.7; c.lineWidth = lw * 0.1;
      c.beginPath(); c.ellipse(0, -lw * 0.29, rx, ry, 0, 0.6 * Math.PI, 0.72 * Math.PI); c.stroke();
    }
    c.globalAlpha = 1;
  }
  const ringCache = new Map();
  function ringSprites(w, palKey) {
    const k = Math.max(1, Math.round(scale * dpr * 4) / 4);
    const key = w + '|' + palKey + '|' + k;
    let sp = ringCache.get(key);
    if (sp) return sp;
    const pal = RING_PAL[palKey], lw = P.RP * 2, rx = w / 2, ry = rx * RING_RY, pad = lw + 6;
    const Wd = 2 * rx + pad * 2, Ht = 2 * ry + pad * 2;
    const make = (front) => {
      const el = document.createElement('canvas');
      el.width = Math.ceil(Wd * k); el.height = Math.ceil(Ht * k);
      const g = el.getContext('2d');
      g.setTransform(k, 0, 0, k, (Wd / 2) * k, (Ht / 2) * k);
      ringHalf(g, rx, ry, lw, pal, front);
      return el;
    };
    sp = { back: make(false), front: make(true), w: Wd, h: Ht };
    if (ringCache.size > 96) ringCache.clear();
    ringCache.set(key, sp);
    return sp;
  }
  function drawRing(c, o, back) {
    const h = o.h, v = hoopVis(h);
    const x = o.off + h.x, y = E.hoopY(h, o.t);
    const sp = ringSprites(h.w, h.st === 2 ? 'grey' : h.cp ? 'gold' : 'red');
    const next = h === view.nextRing && h.st === 0;
    c.save();
    c.translate(x, y);
    const lf = !back && next && h.cp ? clamp((x - (view.drawX || 0) - 70) / 80, 0, 1) : 0;
    if (lf > 0) { // the gold ring ahead says what it is, and gets out of the way as the ball arrives
      c.font = '800 11px ' + FONT_DISPLAY; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = 'rgba(245,197,66,' + ((0.62 + 0.18 * Math.sin(view.time * 5)) * lf).toFixed(3) + ')';
      c.fillText('CHECKPOINT', 0, -(h.w / 2) * RING_RY - P.RP - 13);
    }
    c.rotate(h.tilt);
    c.globalAlpha = h.st === 1 ? 0.32 : o.later || 1;
    c.drawImage(back ? sp.back : sp.front, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
    c.globalAlpha = 1;
    const rx = h.w / 2, ry = rx * RING_RY;
    if (v.heat > 0) {
      // a rim the burning ball just swished through glows hot for a moment
      c.globalCompositeOperation = 'lighter';
      c.strokeStyle = rgba(flamePal(ball.nova).mid, 0.42 * v.heat); c.lineWidth = P.RP * (0.7 + 0.5 * v.heat); c.lineCap = 'round';
      c.beginPath(); c.ellipse(0, 0, rx, ry, 0, back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI); c.stroke();
      c.globalCompositeOperation = 'source-over';
    }
    if (!back && h.cp && h.st === 0 && !REDUCED) {
      // a slow glint travels along the gold checkpoint ring
      const ph = (view.time * 0.5) % 1, ang = (0.88 - 0.76 * ph) * Math.PI;
      c.globalCompositeOperation = 'lighter';
      c.strokeStyle = 'rgba(255,246,214,' + (0.7 * Math.sin(ph * Math.PI)).toFixed(3) + ')';
      c.lineWidth = P.RP * 0.42; c.lineCap = 'round';
      c.beginPath(); c.ellipse(0, -P.RP * 0.42, rx, ry, 0, ang - 0.1, ang + 0.1); c.stroke();
      c.globalCompositeOperation = 'source-over';
    }
    if (next && ball.fire > 0.08 && !REDUCED) {
      // the burning ball lights up the ring it's heading for, brighter as it closes in
      const k = clamp(1 - Math.abs(x - (view.drawX || 0)) / 170, 0, 1) * ball.fire;
      if (k > 0.01) {
        c.globalCompositeOperation = 'lighter';
        c.strokeStyle = rgba(flamePal(ball.nova).mid, 0.5 * k); c.lineWidth = P.RP * (0.45 + 0.6 * k); c.lineCap = 'round';
        c.beginPath(); c.ellipse(0, 0, rx, ry, 0, back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI); c.stroke();
        c.globalCompositeOperation = 'source-over';
      }
    }
    if (!back && v.flash !== 0) {
      const a = Math.abs(v.flash), frx = rx + P.RP + 3, fry = ry + P.RP + 2;
      c.strokeStyle = v.flash < 0 ? 'rgba(255,90,78,0.85)' : 'rgba(255,255,255,' + (0.5 * a).toFixed(3) + ')';
      c.lineWidth = 1 + 1.5 * a;
      c.beginPath(); c.ellipse(0, 0, frx + (1 - a) * 12, fry + (1 - a) * 5, 0, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
  }

  // ---------------------------------------------------------------- ball & wings
  const STARS = [[-0.5, -0.3, 0.05], [0.3, -0.55, 0.04], [0.55, 0.2, 0.05], [-0.2, 0.55, 0.035], [0.08, 0.1, 0.03], [-0.66, 0.26, 0.03], [0.4, 0.62, 0.03], [-0.28, -0.72, 0.03], [0.72, -0.2, 0.025]];
  function drawBallBody(c, r, rot, sk) {
    sk = sk || eqBall();
    const G = sk.grad;
    const g = c.createRadialGradient(-r * 0.38, -r * 0.42, r * 0.05, 0, 0, r * 1.02);
    g.addColorStop(0, G[0]); g.addColorStop(0.45, G[1]); g.addColorStop(0.85, G[2]); g.addColorStop(1, G[3]);
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.save(); c.beginPath(); c.arc(0, 0, r - 0.3, 0, Math.PI * 2); c.clip(); c.rotate(rot);
    if (sk.panels) { // tricolour side panels
      c.globalAlpha = 0.9;
      c.fillStyle = sk.panels[0]; c.beginPath(); c.arc(-r * 1.34, 0, r * 1.02, 0, Math.PI * 2); c.fill();
      c.fillStyle = sk.panels[1]; c.beginPath(); c.arc(r * 1.34, 0, r * 1.02, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
    }
    if (sk.stripes) {
      c.strokeStyle = sk.stripes; c.lineWidth = r * 0.16; c.lineCap = 'round';
      for (const k of [-0.64, -0.22, 0.22, 0.64]) { c.beginPath(); c.moveTo(k * r, -r); c.quadraticCurveTo(k * r + (k < 0 ? -1 : 1) * r * 0.2, 0, k * r, r); c.stroke(); }
    }
    if (sk.stars) { c.fillStyle = 'rgba(255,255,255,0.9)'; for (const [x, y, s] of STARS) { c.beginPath(); c.arc(x * r, y * r, s * r, 0, Math.PI * 2); c.fill(); } }
    const seams = (w, col) => {
      c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'round';
      c.beginPath(); c.moveTo(-r, 0); c.quadraticCurveTo(0, r * 0.08, r, 0); c.stroke();
      c.beginPath(); c.moveTo(0, -r); c.lineTo(0, r); c.stroke();
      c.beginPath(); c.arc(-r * 1.34, 0, r * 1.02, -0.88, 0.88); c.stroke();
      c.beginPath(); c.arc(r * 1.34, 0, r * 1.02, Math.PI - 0.88, Math.PI + 0.88); c.stroke();
    };
    if (sk.glow) { c.globalAlpha = 0.32; seams(r * 0.32, sk.glow); c.globalAlpha = 1; } // soft glow without shadowBlur
    seams(r * 0.085, sk.seam);
    c.restore();
    c.strokeStyle = sk.rim; c.lineWidth = r * 0.07;
    c.beginPath(); c.arc(0, 0, r - r * 0.04, Math.PI * 0.62, Math.PI * 1.08); c.stroke();
    const hl = c.createRadialGradient(-r * 0.4, -r * 0.5, 0, -r * 0.4, -r * 0.5, r * (sk.shine ? 0.62 : 0.5));
    hl.addColorStop(0, 'rgba(255,255,255,' + (sk.shine ? 0.75 : 0.45) + ')'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = hl; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
  }
  function wingPath(c, s) {
    c.beginPath();
    c.moveTo(0.04 * s, -0.12 * s);
    c.bezierCurveTo(-0.1 * s, -0.66 * s, -0.62 * s, -1.02 * s, -1.02 * s, -0.86 * s);
    c.quadraticCurveTo(-1.1 * s, -0.66 * s, -0.88 * s, -0.6 * s);
    c.quadraticCurveTo(-0.98 * s, -0.42 * s, -0.74 * s, -0.38 * s);
    c.quadraticCurveTo(-0.82 * s, -0.2 * s, -0.56 * s, -0.18 * s);
    c.quadraticCurveTo(-0.6 * s, -0.02 * s, -0.34 * s, -0.02 * s);
    c.quadraticCurveTo(-0.14 * s, 0.1 * s, 0.04 * s, 0.06 * s);
    c.quadraticCurveTo(0.12 * s, -0.03 * s, 0.04 * s, -0.12 * s);
    c.closePath();
  }
  function drawWing(c, r, flap, far, wg) {
    wg = wg || eqWing();
    const s = r * (far ? 1.2 : 1.35); // short, compact wings
    const fold = 1 - clamp(-flap, 0, 1) * 0.22; // foreshortened on the downstroke
    c.save();
    c.rotate(flap); c.scale(1, fold);
    if (!far) { c.save(); c.translate(1.2, 2.2); wingPath(c, s); c.fillStyle = 'rgba(0,0,0,0.28)'; c.fill(); c.restore(); }
    wingPath(c, s);
    const g = c.createLinearGradient(-0.2 * s, -0.95 * s, -0.55 * s, 0.05 * s);
    if (far) { g.addColorStop(0, wg.far[0]); g.addColorStop(1, wg.far[1]); }
    else { g.addColorStop(0, wg.near[0]); g.addColorStop(0.55, wg.near[1]); g.addColorStop(1, wg.near[2]); }
    c.fillStyle = g; c.fill();
    c.save(); c.clip();
    c.beginPath();
    c.moveTo(0.1 * s, -0.2 * s);
    c.bezierCurveTo(-0.2 * s, -0.36 * s, -0.55 * s, -0.56 * s, -0.86 * s, -0.66 * s);
    c.lineTo(-1.2 * s, -1.2 * s); c.lineTo(0.3 * s, -1.2 * s); c.closePath();
    c.fillStyle = far ? 'rgba(255,255,255,0.12)' : wg.hi; c.fill();
    c.strokeStyle = far ? 'rgba(20,24,36,0.25)' : wg.vein; c.lineWidth = 0.8; c.lineCap = 'round';
    const tips = [[-0.88, -0.6], [-0.74, -0.38], [-0.56, -0.18]];
    for (const [tx, ty] of tips) { c.beginPath(); c.moveTo(-0.12 * s, -0.14 * s); c.quadraticCurveTo((tx * 0.5 - 0.06) * s, (ty * 0.5 - 0.16) * s, tx * s, ty * s); c.stroke(); }
    c.restore();
    wingPath(c, s);
    c.strokeStyle = far ? wg.farEdge : wg.edge; c.lineWidth = 0.9; c.lineJoin = 'round'; c.stroke();
    c.restore();
  }
  function drawBall(c, x, y) {
    const r = RV;
    const glide = clamp(ball.vy / 900, -0.4, 0.6) * 0.45;
    const a = clamp(ball.flap, -0.95, 0.6) + glide;
    // impact squash flattens the ball against the rim, anchored at the contact point so the
    // contact stays exact; otherwise a small takeoff stretch after each flap
    const q = ball.sq > 0.002 ? ball.sq : 0, nx = ball.sqX, ny = ball.sqY;
    c.save(); c.translate(x - nx * r * q, y - ny * r * q);
    if (ball.fire > 0.01) drawFlame(c, r, ball.fire, ball.nova, view.time);
    const hc = eqBall().halo, halo = c.createRadialGradient(0, 0, r * 0.8, 0, 0, r * 1.9);
    halo.addColorStop(0, 'rgba(' + hc + ',0.13)'); halo.addColorStop(1, 'rgba(' + hc + ',0)');
    c.fillStyle = halo; c.beginPath(); c.arc(0, 0, r * 1.9, 0, Math.PI * 2); c.fill();
    c.save(); c.rotate(ball.tilt); c.translate(r * 0.18, -r * 0.55); drawWing(c, r, a * 0.9 + 0.08, true); c.restore();
    c.save();
    if (q) { const ang = Math.atan2(ny, nx); c.rotate(ang); c.scale(1 - q, 1 + q * 0.5); c.rotate(-ang); }
    else if (ball.st) { const st = clamp(ball.st, -0.06, 0.09); c.scale(1 - st * 0.55, 1 + st); }
    drawBallBody(c, r, ball.rot + ball.tilt);
    if (ball.fire > 0.04) {
      // the leather glows with the heat, hottest on the side the flame streams from
      const Pl = flamePal(ball.nova), f = ball.fire, dl = Math.hypot(ball.fdx, ball.fdy) || 1;
      c.globalCompositeOperation = 'lighter';
      const hg = c.createRadialGradient(ball.fdx / dl * r * 0.55, ball.fdy / dl * r * 0.55, 0, 0, 0, r);
      hg.addColorStop(0, rgba(Pl.inner, 0.5 * f * (0.8 + 0.2 * ball.flick))); hg.addColorStop(0.7, rgba(Pl.mid, 0.16 * f)); hg.addColorStop(1, rgba(Pl.outer, 0.04 * f));
      c.fillStyle = hg; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
      c.globalCompositeOperation = 'source-over';
    }
    c.restore();
    c.save(); c.rotate(ball.tilt); c.translate(-r * 0.16, -r * 0.42); drawWing(c, r, a, false); c.restore();
    c.restore();
  }


  // ---------------------------------------------------------------- the flame
  // The flame hangs off a spine of points that trails the ball like a streamer in the wind: the burning gas stays
  // roughly where it was while the ball flies on, and rises as heat does. So the flame bends behind a flap, swings
  // up as the ball falls, stretches when the ball is fast and stands up when it slows. Three tongues (a long middle
  // one and two shorter sides) run along the spine, each waving and growing and shrinking on its own, and their tips
  // break off as rising wisps. Layers run from the edge colour in to a white-hot core.
  const FS_N = 7; // points on the spine; the first sits at the ball's centre
  for (let k = 0; k < FS_N; k++) ball.fsp.push({ x: 0, y: -k * 6 });
  for (let j = 0; j < 3; j++) ball.tips.push({ x: 0, y: -RV * 2, dx: 0, dy: -1 });
  const NZ = new Float32Array(256);
  for (let i = 0; i < 256; i++) NZ[i] = Math.random() * 2 - 1;
  function noise1(x) { // smooth 1D noise, about -1..1
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f), a = NZ[i & 255];
    return a + (NZ[(i + 1) & 255] - a) * u;
  }
  function updateSpine(dt) {
    const S = ball.fsp, f = Math.max(ball.fire, 0.05);
    // the wind the flame feels: the ball's own motion, reversed (vertical motion counts a little less), plus the rise of hot gas
    const wx = -ball.vx, wy = -0.6 * ball.vy - 240, ws = Math.hypot(wx, wy);
    const L = RV * (1.5 + 2.9 * f) * (0.88 + 0.3 * clamp(ws / 520, 0, 1)) * (1 + 0.25 * ball.flare) * 1.15;
    const seg = L / (FS_N - 1), stiff = 1 - Math.exp(-dt * 7.5);
    for (let k = 1; k < FS_N; k++) {
      const q = S[k], p0 = S[k - 1], mob = 0.42 - 0.035 * k; // older gas, further out, follows more lazily
      q.x += wx * dt * mob; q.y += wy * dt * mob;
      if (k > 1) { const p1 = S[k - 2]; q.x += (2 * p0.x - p1.x - q.x) * stiff * 0.9; q.y += (2 * p0.y - p1.y - q.y) * stiff * 0.9; } // curve, don't fold
      const dx = q.x - p0.x, dy = q.y - p0.y, d = Math.hypot(dx, dy) || 1;
      q.x = p0.x + dx / d * seg; q.y = p0.y + dy / d * seg;
    }
    const d1 = Math.hypot(S[1].x, S[1].y) || 1;
    ball.fdx = S[1].x / d1; ball.fdy = S[1].y / d1;
  }
  // the spine as a smooth curve (Catmull-Rom), resampled, with arc length
  const SP = [];
  for (let i = 0; i <= 4 * (FS_N - 1); i++) SP.push({ x: 0, y: 0, s: 0 });
  function buildSpine() {
    const S = ball.fsp;
    let j = 0;
    for (let k = 0; k < FS_N - 1; k++) {
      const a = S[Math.max(0, k - 1)], b = S[k], c2 = S[k + 1], d = S[Math.min(FS_N - 1, k + 2)];
      for (let i = 0; i < 4; i++, j++) {
        const t = i / 4, t2 = t * t, t3 = t2 * t, o = SP[j];
        o.x = 0.5 * (2 * b.x + (c2.x - a.x) * t + (2 * a.x - 5 * b.x + 4 * c2.x - d.x) * t2 + (3 * b.x - a.x - 3 * c2.x + d.x) * t3);
        o.y = 0.5 * (2 * b.y + (c2.y - a.y) * t + (2 * a.y - 5 * b.y + 4 * c2.y - d.y) * t2 + (3 * b.y - a.y - 3 * c2.y + d.y) * t3);
      }
    }
    SP[j].x = S[FS_N - 1].x; SP[j].y = S[FS_N - 1].y;
    for (let i = 1; i < SP.length; i++) SP[i].s = SP[i - 1].s + Math.hypot(SP[i].x - SP[i - 1].x, SP[i].y - SP[i - 1].y);
    return SP[SP.length - 1].s;
  }
  const AT = { x: 0, y: 0, tx: 1, ty: 0 };
  function spineAt(s) { // the point at arc length s (straight on past the end) and the direction there
    let i = 1;
    while (i < SP.length - 1 && SP[i].s < s) i++;
    const a = SP[i - 1], b = SP[i], l = b.s - a.s || 1e-6, u = (s - a.s) / l;
    AT.tx = (b.x - a.x) / l; AT.ty = (b.y - a.y) / l; AT.x = a.x + (b.x - a.x) * u; AT.y = a.y + (b.y - a.y) * u;
    return AT;
  }
  const TONGUES = [[0, 1, 0.64, 0.3], [-1, 0.66, 0.48, 2.1], [1, 0.74, 0.48, 4.7]]; // [side, length, base half-width, seed]
  const BODY = [0, 0.56, 0.96, 9.1]; // the flame's body: the tongues split out of it
  const FLAME_LAYERS = [ // [front radius, half-width, length, colour, alpha, seed] in ball radii
    [1.12, 1.3, 1, 'outer', 0.97, 0],
    [1.02, 1.1, 0.8, 'mid', 0.97, 1.9],
    [0.9, 0.92, 0.62, 'inner', 0.97, 3.7],
    [0.78, 0.72, 0.42, 'core', 0.92, 5.3]
  ];
  const TPL = [], TPR = [];
  for (let i = 0; i <= 9; i++) { TPL.push([0, 0]); TPR.push([0, 0]); }
  // one tongue: from the ball along the spine, off to its side, waving as it goes and tapering to a point
  function tongue(c, len, w, T, t, calm, tip) {
    const N = 9, side = T[0], sd = T[3];
    for (let i = 0; i <= N; i++) {
      const u = i / N, A = spineAt(len * u), nx = -A.ty, ny = A.tx;
      const off = side * w * (0.44 + 0.4 * u) + w * 0.45 * calm * Math.pow(u, 1.3) * noise1(t * 4.4 - u * 2.6 + sd * 5);
      const h = w * T[2] * Math.pow(1 - u, 0.85), cx = A.x + nx * off, cy = A.y + ny * off;
      TPL[i][0] = cx + nx * h; TPL[i][1] = cy + ny * h; TPR[i][0] = cx - nx * h; TPR[i][1] = cy - ny * h;
      if (tip && i === N) { tip.x = cx; tip.y = cy; tip.dx = A.tx; tip.dy = A.ty; }
    }
    c.beginPath(); c.moveTo(TPR[0][0], TPR[0][1]); c.lineTo(TPL[0][0], TPL[0][1]);
    for (let i = 1; i < N; i++) { const p = TPL[i], q = TPL[i + 1]; c.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
    for (let i = N - 1; i > 0; i--) { const p = TPR[i], q = TPR[i - 1]; c.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2); }
    c.closePath(); c.fill();
  }
  function drawFlame(c, r, f, n, t) {
    const P = flamePal(n), calm = REDUCED ? 0.3 : 1, dx = ball.fdx, dy = ball.fdy;
    const L = buildSpine() / 1.15;
    // a soft glow first, flickering with the fire
    c.globalCompositeOperation = 'lighter';
    const gr = r * (2.2 + 1.8 * f), gx = dx * r * 0.9, gy = dy * r * 0.9;
    const gl = c.createRadialGradient(dx * r * 0.6, dy * r * 0.6, r * 0.3, gx, gy, gr);
    gl.addColorStop(0, rgba(P.outer, 0.4 * f * ball.flick)); gl.addColorStop(1, rgba(P.outer, 0));
    c.fillStyle = gl; c.beginPath(); c.arc(gx, gy, gr, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'source-over';
    const g = 0.5 + 0.5 * Math.min(1, f * 1.6), a = Math.min(1, f * 3), ang = Math.atan2(dy, dx), fan = 1 + 0.1 * ball.flare;
    for (let li = 0; li < FLAME_LAYERS.length; li++) {
      const Ly = FLAME_LAYERS[li];
      const rf = r * (1 + (Ly[0] - 1) * g), w = (r * Ly[1] * g + r * 0.55 * (1 - g)) * fan;
      c.fillStyle = rgba(P[Ly[3]], Ly[4] * a);
      c.beginPath(); c.ellipse(0, 0, rf, w, ang, 0, Math.PI * 2); c.fill(); // wraps the front of the ball
      tongue(c, L * Ly[2] * BODY[1], w, BODY, t, calm * 0.6, null);
      for (let j = 0; j < TONGUES.length; j++) {
        const T = TONGUES[j];
        const len = L * Ly[2] * T[1] * (1 + calm * (0.16 * noise1(t * 3.3 + T[3] * 7) + 0.07 * noise1(t * 10 + T[3] * 3 + Ly[5] * 11)));
        tongue(c, len, w, T, t, calm, li === 0 ? ball.tips[j] : null);
      }
    }
  }

  const BEHIND = [false, false, false, false, false, true, true, true, true]; // embers, flame licks, smoke and air puffs sit behind the ball
  function drawParts(c, behind) {
    for (const p of parts) {
      if (BEHIND[p.kind] !== behind) continue;
      const t = p.life / p.max;
      const add = p.kind === 0 || p.kind === 3 || p.kind === 5 || (p.kind === 6 && p.burst);
      c.globalCompositeOperation = add ? 'lighter' : 'source-over';
      if (p.kind === 0) { c.globalAlpha = t; c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size * (0.5 + t * 0.5), 0, Math.PI * 2); c.fill(); }
      else if (p.kind === 1) { c.globalAlpha = Math.min(1, t * 2); c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillStyle = p.color; c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); c.restore(); }
      else if (p.kind === 3) { c.globalAlpha = t * 0.6; c.strokeStyle = p.color; c.lineWidth = 2 * t + 0.5; c.beginPath(); const rr = p.size + (1 - t) * 28; c.ellipse(p.x, p.y, rr, rr * RING_RY, 0, 0, Math.PI * 2); c.stroke(); }
      else if (p.kind === 4) {
        c.globalAlpha = Math.min(1, t * 2); c.save(); c.translate(p.x, p.y); c.scale(Math.cos(p.rot), 1);
        c.fillStyle = p.color; c.beginPath(); c.arc(0, 0, p.size, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(-p.size * 0.25, -p.size * 0.3, p.size * 0.35, 0, Math.PI * 2); c.fill();
        c.restore();
      } else if (p.kind === 5) { c.globalAlpha = Math.min(1, t * 1.6) * 0.9; c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size * (0.4 + t * 0.6), 0, Math.PI * 2); c.fill(); }
      else if (p.kind === 6) {
        // a flame wisp: a small flat teardrop, pointed the way it flies
        const sz = p.size * (0.35 + 0.65 * t);
        c.globalAlpha = 1; c.fillStyle = lickRgba(p.n, t, Math.min(1, t * 3) * 0.95);
        c.save(); c.translate(p.x, p.y); c.rotate(p.burst ? Math.atan2(p.vy, p.vx) : p.rot);
        c.beginPath(); c.arc(0, 0, sz * 0.7, Math.PI / 2, Math.PI * 1.5, false);
        c.quadraticCurveTo(sz * 0.6, -sz * 0.7, sz * 1.9, 0); c.quadraticCurveTo(sz * 0.6, sz * 0.7, 0, sz * 0.7); c.fill(); c.restore();
      } else if (p.kind === 7) {
        const sz = p.size * (1.7 - 0.7 * t);
        c.globalAlpha = 0.55 * t; c.drawImage(smokeSprite(), p.x - sz, p.y - sz, sz * 2, sz * 2);
      } else if (p.kind === 8) { // an air puff from a flap
        const rr = p.size * (1.8 - 0.8 * t);
        c.globalAlpha = 0.28 * t; c.strokeStyle = "#ffffff"; c.lineWidth = 0.6 + 1.8 * t; c.lineCap = 'round';
        c.beginPath(); c.arc(p.x, p.y - rr * 0.7, rr, Math.PI * 0.2, Math.PI * 0.8); c.stroke();
      }
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  }
  // Ring labels start fully in view, then drift back at a quarter of the court's speed, so they stay
  // readable with the ball sitting near the left edge. They fade while the ball flies through them.
  function drawTexts(c) {
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    const wl = view.wl != null ? view.wl : view.camX, wr = view.wr != null ? view.wr : view.camX + VIEW_W;
    for (const t of texts) {
      const k = t.life / t.max, a = k > 0.8 ? (1 - k) * 5 : Math.min(1, k * 2.5);
      const s = 1 + (k > 0.85 ? (k - 0.85) * 1.6 : 0);
      c.font = '800 ' + (t.size * s).toFixed(1) + 'px ' + FONT_DISPLAY;
      const half = c.measureText(t.text).width / 2 + 8;
      if (t.cx == null) t.x = clamp(t.x, wl + half, wr - half);
      else t.x += (view.camX - t.cx) * 0.75;
      t.cx = view.camX;
      t.x = Math.min(t.x, wr - half);
      if (view.wt != null) t.y = Math.max(t.y, view.wt + t.size * 0.9 + 4); // never behind the HUD
      const bx = view.drawX, by = view.drawY, r = RV + 4;
      const onBall = bx != null && !ball.hidden && Math.abs(bx - t.x) < half + r && by > t.y - t.size - r && by < t.y + 18 + r;
      t.dim = lerp(t.dim == null ? 1 : t.dim, onBall ? 0.28 : 1, 0.25);
      c.globalAlpha = clamp(a, 0, 1) * t.dim;
      c.fillStyle = t.color; c.fillText(t.text, t.x, t.y);
      if (t.sub) {
        c.font = '700 12px ' + FONT_ROUND;
        c.fillStyle = 'rgba(47,211,107,0.95)'; c.fillText(t.sub, t.x, t.y + 15);
      }
    }
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- input
  function flapInput() {
    Sound.unlock();
    if (phase === 'ready') { beginPlay(); return; }
    if (phase === 'play') { pendingTap = true; return; }
    if (phase === 'paused') resume();
  }
  cv.addEventListener('touchstart', (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  window.addEventListener('pointerdown', (e) => {
    if (e.target.closest && e.target.closest('button, input, .sheet, .card, .panel, a, .scrim')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    flapInput();
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      if (tag === 'INPUT' || (tag === 'BUTTON' && phase !== 'play' && phase !== 'ready' && phase !== 'paused')) return;
      const panelOpen = !ui.panel.classList.contains('hide');
      if (e.code === 'Space' && !panelOpen && !e.repeat) {
        if (phase === 'lobby') { e.preventDefault(); startRun(); return; }
        if (phase === 'over' && armed(ui.res)) { e.preventDefault(); show(ui.res, false); startRun(); return; }
      }
      e.preventDefault();
      if (!e.repeat) flapInput();
    } else if (phase === 'checkpoint' && tag !== 'BUTTON' && armed(ui.cp) && (e.code === 'KeyC' || e.code === 'Enter')) {
      e.preventDefault();
      if (e.code === 'KeyC') cashOut(); else keepGoing();
    } else if (e.code === 'Escape') {
      if (!ui.panel.classList.contains('hide')) closePanel();
      else if (phase === 'play') pause();
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && phase === 'play') pause(); });
  // Resuming counts in 3-2-1, so the ball doesn't drop the moment you tap (faster levels leave little slack)
  let resumeTimer = 0, resuming = false;
  function pause() { clearTimeout(resumeTimer); resuming = false; phase = 'paused'; acc = 0; showPrompt('Paused', 'Tap to resume'); }
  function resume() {
    if (resuming) return;
    if (REDUCED) { goPlay(); return; }
    resuming = true;
    let n = 3;
    const tick = () => {
      if (phase !== 'paused') { resuming = false; return; }
      if (n === 0) { resuming = false; goPlay(); return; }
      showPrompt(String(n), 'Get ready'); Sound.click(); n--;
      resumeTimer = setTimeout(tick, 380);
    };
    tick();
  }
  function goPlay() { hidePrompt(); phase = 'play'; acc = 0; last = performance.now(); }
  ['gesturestart', 'dblclick'].forEach((n) => document.addEventListener(n, (e) => e.preventDefault()));

  $('cashBtn').addEventListener('click', cashOut);
  $('goBtn').addEventListener('click', keepGoing);
  $('againBtn').addEventListener('click', () => { if (!armed(ui.res)) return; show(ui.res, false); startRun(); });
  $('lobbyBtn').addEventListener('click', () => { Sound.click(); backToLobby(); });
  $('pauseBtn').addEventListener('click', () => { if (phase === 'play') pause(); else if (phase === 'paused') resume(); });

  // ---------------------------------------------------------------- panels
  function openPanel(kind) {
    Sound.click();
    const body = $('panelBody'), title = $('panelTitle');
    const map = { how: ['How to play', howHtml], odds: ['Odds', oddsHtml], stats: ['Stats', statsHtml], fair: ['Fairness', fairHtml], menu: ['Settings', menuHtml], wallet: ['Wallet', walletHtml], profile: ['Profile', profileHtml] };
    const [t, fn] = map[kind] || map.how;
    title.textContent = t; body.innerHTML = fn();
    body.scrollTop = 0;
    ui.scrim.classList.add('show'); show(ui.panel, true);
    wirePanel(kind);
    setTimeout(() => $('panelClose').focus({ preventScroll: true }), 30);
  }
  function closePanel() { ui.scrim.classList.remove('show'); show(ui.panel, false); }
  $('panelClose').addEventListener('click', closePanel);
  ui.scrim.addEventListener('click', closePanel);
  document.querySelectorAll('[data-panel]').forEach((b) => b.addEventListener('click', () => openPanel(b.dataset.panel)));
  $('menuBtn').addEventListener('click', () => openPanel('menu'));
  $('balBtn').addEventListener('click', () => openPanel('wallet'));
  function syncMute() {
    $('muteBtn').setAttribute('aria-label', settings.sound ? 'Mute sound' : 'Turn sound on');
    $('muteIcon').innerHTML = settings.sound
      ? '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 9.5a4 4 0 0 1 0 5"/><path d="M18.5 7a7.5 7.5 0 0 1 0 10"/>'
      : '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9 5 6M21 9l-5 6"/>';
  }
  $('muteBtn').addEventListener('click', () => { settings.sound = !settings.sound; saveAll(); syncMute(); Sound.unlock(); Sound.click(); });
  syncMute();

  function howHtml() {
    return `<p><b>Tap</b> to flap. Drop the ball down through every ring. Fly past one, go under it or hit the floor and the run ends.</p>
      <h3>Swish</h3><p>Go through without touching the ring for a swish. Swishes pay more than rim hits, and swishes in a row pay more each time, up to 5 in a row. Your streak carries into the next level.</p>
      <h3>Fire</h3><p>Two swishes in a row and the ball starts to smoulder. Three and it's <b>on fire</b>; five and it burns at full heat (blue-white with the Fire flame). Touch a rim and the flame goes out. Flames from the locker change the colours, never the pay.</p>
      <h3>Checkpoints</h3><p>Every ${NH} rings, the gold ring ends the level. Cash out your pot, or keep going for more.</p>
      <h3>Score and XP</h3><p>Rings also score points: a rim hit +1, a swish +2, and each swish in a row +1 more, up to +6. Swish all ${NH} rings in a level for a <b>Perfect level</b> (+${PERFECT_BONUS}). Points, daily challenges and achievements earn XP, which unlocks balls, wings and flames. Score and XP never change what a run pays.</p>`;
  }
  // ---------------------------------------------------------------- profile: level, daily challenges, locker, achievements
  function profileHtml() {
    const v = lvlOf(profile.xp), list = dailySet();
    const nextU = UNLOCKS.filter((u) => u.lvl && u.lvl > v.l).sort((a, b) => a.lvl - b.lvl)[0];
    const C = 182.2; // 2 * pi * 29
    const head = `<div class="lvhead"><div class="lvring"><svg viewBox="0 0 66 66"><circle class="trk" cx="33" cy="33" r="29"/><circle class="val" cx="33" cy="33" r="29" stroke-dasharray="${C}" stroke-dashoffset="${(C * (1 - v.into / v.need)).toFixed(1)}"/></svg><b>${v.l}</b></div>
      <div class="lvinfo"><b>Level ${v.l}</b><span>${v.into} / ${v.need} XP to level ${v.l + 1}${nextU ? `<br>Next unlock: ${itemName(nextU)} at level ${nextU.lvl}` : ''}</span></div></div>`;
    const ch = list.map((c) => `<div class="chal${c.done ? ' done' : ''}"><span class="ck">${ICON.check}</span><span class="ct">${dailyText(c)}</span><span class="cx">${c.done ? 'Done' : '+' + c.xp + ' XP'}</span><span class="cb"><i style="width:${(c.p / c.n * 100).toFixed(0)}%"></i></span><span class="cp">${c.p}/${c.n}</span></div>`).join('');
    const locker = ['ball', 'wing', 'flame'].map((t) => {
      const items = UNLOCKS.filter((u) => u.t === t), own = items.filter((u) => isOwned(t, u.id)).length;
      return `<div class="locker-h"><span>${TNAME[t]}</span><span>${own} of ${items.length}</span></div><div class="locker">` + items.map((u) => {
        const has = isOwned(t, u.id), eq = profile.eq[t] === u.id, fresh = profile.fresh.includes(t + ':' + u.id), nm = COS[t][u.id].name;
        return `<button class="item${has ? '' : ' locked'}${eq ? ' eq' : ''}" data-t="${t}" data-id="${u.id}" aria-pressed="${eq}" aria-label="${nm}${has ? (eq ? ', equipped' : '') : ', locked: ' + unlockReq(u)}"><canvas width="96" height="96"></canvas>` +
          (has ? (fresh ? '<span class="new"></span>' : '') : `<span class="lock">${ICON.lock}</span><span class="req">${unlockReq(u)}</span>`) + '</button>';
      }).join('') + `</div><div class="item-name" id="itemName-${t}">Equipped: ${COS[t][profile.eq[t]].name}</div>`;
    }).join('');
    const got = ACH.filter((a) => profile.ach[a.id]).length;
    const achs = ACH.map((a) => {
      const u = UNLOCKS.find((x) => x.ach === a.id), has = !!profile.ach[a.id];
      return `<div class="ach${has ? ' got' : ''}"><span class="ai">${ICON.medal}</span><span><div class="an">${a.name}</div><div class="ad">${a.desc}${u ? ' · unlocks ' + itemName(u) : ''}</div></span><span class="ax">${has ? 'Done' : '+' + a.xp + ' XP'}</span></div>`;
    }).join('');
    return head + `<h3>Today's challenges</h3><div class="group">${ch}</div><p class="reset-note">New challenges in ${untilMidnight()}. XP comes from play, never from bet size.</p>` +
      `<h3>Locker</h3>${locker}<h3>Achievements · ${got} of ${ACH.length}</h3><div class="group achs">${achs}</div>`;
  }
  // locker thumbnails, drawn with the same code as the game
  const FLAME_PATH = typeof Path2D === 'function' ? new Path2D('M12 23c-4.4 0-8-3.1-8-7.5 0-3.3 2-5.6 3.7-7.4.6-.6 1.6-.2 1.6.7 0 1.4.9 2.6 2.1 2.6 1.1 0 1.8-.9 1.8-2.1 0-2.3-1.2-4.2-1.2-6.6 0-.9 1-1.5 1.7-1C17 3.9 20 8.4 20 14.5 20 19.6 16.4 23 12 23Z') : null;
  function drawThumb(el, t, id) {
    const g = el.getContext('2d'), s = el.width;
    g.clearRect(0, 0, s, s); g.save(); g.translate(s / 2, s / 2);
    if (t === 'ball') { drawBallBody(g, s * 0.32, 0.45, BALLS[id]); }
    else if (t === 'wing') { const r = s * 0.42; g.translate(r * 0.95, r * 0.92); drawWing(g, r, -0.1, false, WINGS[id]); }
    else if (FLAME_PATH) {
      const Pb = FLAMES[id].base, k = s / 30;
      g.translate(-12 * k, -12.5 * k); g.scale(k, k);
      const gr = g.createLinearGradient(0, 2, 0, 23);
      gr.addColorStop(0, hex3(Pb.outer)); gr.addColorStop(0.45, hex3(Pb.mid)); gr.addColorStop(0.8, hex3(Pb.inner)); gr.addColorStop(1, hex3(Pb.core));
      g.shadowColor = hex3(Pb.mid); g.shadowBlur = 10; g.fillStyle = gr; g.fill(FLAME_PATH);
    }
    g.restore();
  }
  function wireProfile() {
    document.querySelectorAll('#panelBody .item').forEach((b) => {
      const t = b.dataset.t, id = b.dataset.id;
      drawThumb(b.querySelector('canvas'), t, id);
      b.addEventListener('click', () => {
        const u = UNLOCKS.find((x) => x.t === t && x.id === id);
        if (!isOwned(t, id)) { toast(itemName(u) + ': ' + (u.lvl ? 'reach level ' + u.lvl : ACH_BY[u.ach].desc.toLowerCase()) + ' to unlock'); Sound.click(); return; }
        profile.eq[t] = id; saveAll(); Sound.click(); buzz(8);
        if (t === 'flame') applyFlameTheme();
        document.querySelectorAll(`#panelBody .item[data-t="${t}"]`).forEach((x) => { const on = x.dataset.id === id; x.classList.toggle('eq', on); x.setAttribute('aria-pressed', String(on)); });
        $('itemName-' + t).textContent = 'Equipped: ' + COS[t][id].name;
      });
    });
    if (profile.fresh.length) { profile.fresh = []; saveAll(); refreshProfileHud(); }
  }
  let oddsTier = null;
  function oddsHtml() {
    const di = oddsTier == null ? prefs.di : oddsTier;
    const D = E.DIFFS[di], rows = [];
    for (let L = 1; L <= NL; L++) {
      const pt = PAY.PAYTABLE[di][L - 1];
      rows.push(`<tr><td>${L}</td><td class="r">${fmtX(pt.rim)}</td><td class="r">${fmtX(pt.swish[0])}</td><td class="r">${fmtX(pt.swish[pt.swish.length - 1])}</td><td class="r">${Math.round(avgClear(di, L) * 100)}%</td></tr>`);
    }
    return `<div class="seg" id="oddsSeg">${E.DIFFS.map((d, i) => `<button data-t="${i}" aria-pressed="${i === di}">${d.name}</button>`).join('')}</div>
      <div class="tbl"><table><thead><tr><th>Level</th><th class="r">Rim</th><th class="r">Swish</th><th class="r">5+ streak</th><th class="r">Avg clears</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      <p>Each ring multiplies your pot. ${D.name} pays up to <b>${D.maxWin}×</b> your bet. An average player who cashes out at the first checkpoint gets back about 90% of their bet over time. Skilled players do better.</p>`;
  }
  function statsHtml() {
    const rtp = stats.wagered > 0 ? (stats.returned / stats.wagered * 100).toFixed(1) + '%' : '–';
    const net = stats.returned - stats.wagered;
    const hist = stats.history.slice(0, 12).map((h) => {
      const p = h.payout - h.bet;
      return `<li><span>${E.DIFFS[h.di].name} · Level ${h.level}</span><span class="${p >= 0 ? 'pos' : 'neg'}">${p >= 0 ? '+' : '−'}${fmtSol(Math.abs(p))} SOL</span></li>`;
    }).join('');
    return `<div class="tiles">
        <div><b>${stats.runs}</b><span>Runs</span></div><div><b>${rtp}</b><span>Return</span></div><div><b class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${fmtSol(Math.abs(net))}</b><span>Net SOL</span></div>
      </div>
      <h3>Best scores</h3><div class="bests">${E.DIFFS.map((D, i) => `<div><b>${profile.best[i] || '–'}</b><span>${D.name}</span><em>${profile.deep[i] ? 'Level ' + profile.deep[i] : '&nbsp;'}</em></div>`).join('')}</div>
      <h3>Recent runs</h3>${hist ? `<ul class="list group">${hist}</ul>` : '<p>Your runs will show up here.</p>'}`;
  }
  function fairHtml() {
    const h = stats.history[0];
    const canVerify = h && h.serverSeed && h.seedHash;
    const last = h ? `<h3>Last run</h3><span class="mono">hash ${h.seedHash}</span><span class="mono">seed ${h.serverSeed || 'revealed when the run ends'}</span><span class="mono">client ${h.clientSeed} · nonce ${h.nonce}</span>
      ${canVerify ? '<button class="btn btn-plain verify" id="fairVerify">Verify this run</button><div class="verify-out" id="fairOut"></div>' : ''}` : '';
    return `<p>Every ring position comes from a seed that is locked in before you tap. You see its SHA-256 hash first, and the seed itself when the run ends.</p>
      <p>Each level is built from <b>HMAC-SHA256(seed, client seed:nonce:level)</b>, and every payout is checked by replaying your taps through the same physics.</p>${last}`;
  }
  function menuHtml() {
    return `<div class="group">
        <div class="row"><span class="k">Sound</span><button class="switch" role="switch" id="swSound" aria-checked="${settings.sound}" aria-label="Sound"></button></div>
        <div class="row"><span class="k">Vibration</span><button class="switch" role="switch" id="swHaptics" aria-checked="${settings.haptics}" aria-label="Vibration"></button></div>
      </div>
      ${bank.real ? '' : `<h3>Demo balance</h3><button class="btn btn-plain" id="resetBal">Reset to ${CFG.demoStart} SOL</button>`}`;
  }
  function walletHtml() {
    if (!CFG.serverUrl) {
      return `<div class="tiles"><div><b>${fmtBal(wallet.balance)}</b><span>Demo SOL</span></div><div><b>${stats.runs}</b><span>Runs</span></div><div><b>${stats.best ? fmtMult(stats.best) : '–'}</b><span>Best</span></div></div>
        <p>You're playing with demo SOL. Real SOL play runs through the SOL DUNK server with Phantom or Solflare.</p>
        <button class="btn btn-plain" id="resetBal">Reset demo balance</button>`;
    }
    if (!bank.real || !ServerBank.token) {
      return `<p>Connect a Solana wallet to play with real SOL on <b>${CFG.network}</b>.</p><button class="btn btn-primary" id="wConnect">Connect wallet</button>
        <p class="err" id="wErr"></p><p>On a phone, open this page in the Phantom or Solflare browser.</p>`;
    }
    return `<div class="tiles"><div><b>${fmtBal(ServerBank.bal)}</b><span>Balance SOL</span></div><div><b>${ServerBank.address.slice(0, 4)}…${ServerBank.address.slice(-4)}</b><span>Wallet</span></div><div><b>${CFG.network}</b><span>Network</span></div></div>
      <div class="group"><div class="row"><label class="k" for="wAmt">Amount</label><label class="bet-field"><input id="wAmt" class="bet-input" inputmode="decimal" value="0.1"><span class="unit">SOL</span></label></div></div>
      <div class="actions" style="margin-top:12px"><button class="btn btn-plain" id="wWithdraw">Withdraw</button><button class="btn btn-green" id="wDeposit">Deposit</button></div>
      <p class="err" id="wErr"></p>`;
  }
  function wirePanel(kind) {
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    if (kind === 'profile') wireProfile();
    if (kind === 'odds') document.querySelectorAll('#oddsSeg button').forEach((b) => b.addEventListener('click', () => { oddsTier = +b.dataset.t; $('panelBody').innerHTML = oddsHtml(); wirePanel('odds'); }));
    on('fairVerify', () => {
      const h = stats.history[0];
      if (!h || !h.serverSeed) return;
      const ok = hex(sha256(utf8(h.serverSeed))) === h.seedHash;
      const out = $('fairOut');
      if (!ok) { out.className = 'verify-out bad'; out.textContent = 'The revealed seed does not match the hash shown before the run.'; return; }
      const rows = [];
      for (let L = 1; L <= h.level; L++) rows.push(`<li><span>Level ${L}</span><span class="mono-s">${deriveLevelSeed(h.serverSeed, h.clientSeed, h.nonce, L).slice(0, 16)}…</span></li>`);
      out.className = 'verify-out good';
      out.innerHTML = `<p><b>Verified.</b> The revealed seed hashes to the value you saw before the run, so the rings were fixed before your first tap.</p><ul class="list group">${rows.join('')}</ul>`;
    });
    on('swSound', (e) => { settings.sound = !settings.sound; e.currentTarget.setAttribute('aria-checked', settings.sound); saveAll(); syncMute(); Sound.unlock(); Sound.click(); });
    on('swHaptics', (e) => { settings.haptics = !settings.haptics; e.currentTarget.setAttribute('aria-checked', settings.haptics); saveAll(); buzz(10); });
    on('resetBal', () => {
      if (phase !== 'lobby' && phase !== 'over') { toast('Finish this run first.'); return; }
      wallet.balance = CFG.demoStart; saveAll(); refreshLobby(); closePanel(); toast('Demo balance reset to ' + CFG.demoStart + ' SOL');
    });
    on('wConnect', async () => { try { await ServerBank.connect(); bank = ServerBank; setBalance(); refreshLobby(); openPanel('wallet'); } catch (e) { $('wErr').textContent = e.message; } });
    on('wDeposit', async () => { try { await ServerBank.deposit(parseFloat($('wAmt').value)); setBalance(); openPanel('wallet'); toast('Deposit credited'); } catch (e) { $('wErr').textContent = e.message; } });
    on('wWithdraw', async () => { try { await ServerBank.withdraw(parseFloat($('wAmt').value)); setBalance(); openPanel('wallet'); toast('Withdrawal sent'); } catch (e) { $('wErr').textContent = e.message; } });
  }

  // ---------------------------------------------------------------- boot (keeps balance across a republish)
  function boot(snap) {
    if (snap && typeof snap.balance === 'number') {
      wallet.balance = snap.balance; Object.assign(stats, snap.stats || {}); Object.assign(prefs, snap.prefs || {}); Object.assign(settings, snap.settings || {});
      if (snap.profile) fixProfile(Object.assign(profile, snap.profile));
    }
    if (!(wallet.balance >= 0)) wallet.balance = CFG.demoStart;
    syncMute(); applyFlameTheme(); buildLobby(); refreshLobby(); setHudMode(false);
    attract.wait = 0;
    if (document.fonts && document.fonts.load) document.fonts.load('800 20px "Big Shoulders Display"').catch(() => {}); // canvas text uses it too
    requestAnimationFrame((t) => { last = t; frame(t); });
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) {
    hot.snapshot(() => {
      // a run in progress can't survive a reload, so the snapshot refunds its bet
      const inRun = !bank.real && (phase === 'ready' || phase === 'play' || phase === 'clearing' || phase === 'checkpoint' || phase === 'paused');
      return { balance: round9(wallet.balance + (inRun ? run.bet : 0)), stats, prefs, settings, profile };
    });
  }
  if (hot && hot.ready) hot.ready(boot); else boot((hot && hot.data) || {});
  window.__solDunk = {
    run, stats, wallet, view, E, PAY, ball, profile, geom: () => ({ scale, offX, offY }),
    phase: () => phase,
    dbg,
    unfreeze: () => { dbg.frozen = false; goPlay(); },
    tap: () => flapInput(),
    autoplay: (skill) => { autoBot = skill ? BOT.createBot(skill, E.makeRng('auto' + Math.random())) : null; },
    fx: (streak) => { dbg.fx = streak; }, // show the flame for a streak without touching the run
    hold: (on) => { dbg.hold = !!on; },   // stop the clock with the last frame on screen
    step: (n) => { dbg.steps = n | 0; },  // while held: play n frames of 1/60 s
    stepsLeft: () => dbg.steps | 0,
    ballScreen: () => ({ x: view.bsx, y: view.bsy }),
    equip: (t, id) => { if (COS[t] && COS[t][id]) { profile.eq[t] = id; if (t === 'flame') applyFlameTheme(); } } // test hook: try a skin without unlocking it
  };
})();
