/* SOL DUNK — browser client. Rendering, input, audio, betting flow. */
(() => {
  'use strict';
  const E = window.DunkEngine, PAY = window.DunkPaytable, BOT = window.DunkBot, POTS = window.DunkPots, MS = window.DunkMissions, SP = window.DunkSpecial;
  const CFG = Object.assign({ serverUrl: null, network: 'devnet', demoStart: 10, minBet: 0.001, maxBet: 100, solIconUrl: null }, window.SOL_DUNK_CONFIG || {});
  const W = E.WORLD, P = E.PHYS, DT = E.DT, NL = E.LEVELS, NH = E.HOOPS_PER_LEVEL, EV = E.EV;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const round9 = (x) => Math.round(x * 1e9) / 1e9;
  const FONT_ROUND = 'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
  const FONT_DISPLAY = 'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'; // canvas numbers and labels

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
  // Score, XP, achievements, missions and cosmetics. All of it is presentation:
  // nothing here changes bets, ring layouts, physics or payouts, and XP never depends on bet size.
  const NT = E.DIFFS.length;
  const blankLv = () => E.DIFFS.map(() => Array.from({ length: NL }, () => [0, 0])); // [attempts, clears] per tier/level
  function fixProfile(p) {
    if (!Array.isArray(p.lv) || p.lv.length !== NT) p.lv = blankLv();
    if (!Array.isArray(p.best) || p.best.length !== NT) p.best = E.DIFFS.map(() => 0);
    if (!Array.isArray(p.deep) || p.deep.length !== NT) p.deep = E.DIFFS.map(() => 0);
    if (!Array.isArray(p.owned)) p.owned = [];
    for (const k of ['ball:classic', 'wing:angel', 'flame:fire', 'trail:classic', 'trail:none', 'rim:red', 'court:arena']) if (!p.owned.includes(k)) p.owned.push(k);
    if (!Array.isArray(p.fresh)) p.fresh = [];
    p.ach = p.ach || {}; p.tot = Object.assign({ swish: 0, perfect: 0 }, p.tot || {});
    p.eq = Object.assign({ ball: 'classic', wing: 'angel', flame: 'fire', trail: 'classic', rim: 'red', court: 'arena' }, p.eq || {});
    p.card = Object.assign({ name: '', emblem: 'ball', color: 0, title: 'rookie' }, p.card || {});
    p.mNew = p.mNew | 0; // missions finished since the Missions tab was last opened
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

  // Cosmetics. The ball is always drawn at its exact hitbox size whatever the skin, and rings at their exact
  // collision size. Six categories: ball, wings, flame, trail, rims and court. None of them changes the game.
  const BALLS = {
    classic: { name: 'Classic', grad: ['#ffc27a', '#ff8a2a', '#d9620f', '#a8460a'], seam: 'rgba(52,18,2,0.85)', rim: 'rgba(160,200,255,0.35)', halo: '255,140,40' },
    retro: { name: 'Retro', grad: ['#ffffff', '#f2f2f5', '#d6d8e0', '#a7abb8'], seam: 'rgba(25,25,35,0.75)', rim: 'rgba(160,200,255,0.35)', halo: '255,255,255', panels: ['#e0302a', '#1f5fd6'] },
    street: { name: 'Street', grad: ['#c98552', '#9a5a2c', '#6e3c1c', '#3e210f'], seam: 'rgba(22,10,4,0.9)', rim: 'rgba(255,210,170,0.22)', halo: '214,130,70', dots: true },
    neon: { name: 'Neon', grad: ['#33467f', '#18224a', '#0b1128', '#05070f'], seam: '#5ff3ff', glow: '#3fd6ff', rim: 'rgba(95,243,255,0.45)', halo: '63,214,255' },
    tiger: { name: 'Tiger', grad: ['#ffd27a', '#ff9a1f', '#e06a00', '#9c4300'], seam: null, rim: 'rgba(255,230,190,0.4)', halo: '255,150,40', tiger: '#1d0f06' },
    frost: { name: 'Frost', grad: ['#ffffff', '#e2f5ff', '#a4dbff', '#5aa6e6'], seam: 'rgba(36,86,160,0.7)', rim: 'rgba(255,255,255,0.6)', halo: '160,220,255' },
    candy: { name: 'Candy', grad: ['#ffffff', '#fbf1f3', '#efd5db', '#c49aa4'], seam: null, rim: 'rgba(255,255,255,0.7)', halo: '255,110,140', swirl: '#e3263f' },
    lava: { name: 'Lava', grad: ['#5c1c0d', '#2c0b05', '#170402', '#0a0201'], seam: '#ff8a2a', glow: '#ff4d12', rim: 'rgba(255,120,40,0.4)', halo: '255,90,31' },
    camo: { name: 'Camo', grad: ['#a3ad75', '#83904f', '#5f6c38', '#3a4422'], seam: 'rgba(18,22,8,0.85)', rim: 'rgba(230,240,200,0.3)', halo: '150,170,95', camo: ['#55642f', '#2f3a1b', '#c2bd8e'] },
    melon: { name: 'Melon', grad: ['#86e889', '#45b552', '#26843c', '#145726'], seam: 'rgba(8,48,18,0.85)', rim: 'rgba(210,255,210,0.35)', halo: '90,220,110', stripes: 'rgba(16,92,36,0.85)' },
    planet: { name: 'Planet', grad: ['#86d6ff', '#2f88e2', '#1652aa', '#0a2a66'], seam: null, rim: 'rgba(170,225,255,0.75)', halo: '90,170,255', land: ['#5cc46f', '#2f8f4c', '#c9b27a'] },
    moon: { name: 'Moon', grad: ['#f4f4ef', '#d2d3ce', '#a3a49f', '#64655f'], seam: null, rim: 'rgba(255,255,255,0.5)', halo: '225,225,212', craters: true },
    eight: { name: '8-Ball', grad: ['#5b6070', '#23262f', '#0c0e13', '#000000'], seam: null, rim: 'rgba(200,210,255,0.38)', halo: '150,160,200', shine: true, eight: true },
    pixel: { name: 'Pixel', grad: ['#ffc27a', '#ff8a2a', '#d9620f', '#a8460a'], seam: null, rim: null, halo: '255,140,40', pixel: ['#ffe0a8', '#ffab52', '#f27a1c', '#c9530c', '#8a3606'], pseam: '#4a1a05' },
    chrome: { name: 'Chrome', grad: ['#ffffff', '#c9ced8', '#7d8494', '#3a3f4b'], seam: 'rgba(16,20,28,0.55)', rim: 'rgba(255,255,255,0.75)', halo: '205,214,232', chrome: true, shine: true },
    galaxy: { name: 'Galaxy', grad: ['#9a6cff', '#5230b0', '#24125a', '#0c0626'], seam: '#ff86e6', glow: '#d65cff', rim: 'rgba(210,170,255,0.45)', halo: '191,90,242', stars: true },
    diamond: { name: 'Diamond', grad: ['#ffffff', '#dcf7ff', '#93daf6', '#3f90c6'], seam: null, rim: 'rgba(255,255,255,0.85)', halo: '170,230,255', facets: true, shine: true },
    gold: { name: 'Gold', grad: ['#fff8d0', '#ffd84a', '#d9a300', '#7f5200'], seam: 'rgba(92,56,0,0.85)', rim: 'rgba(255,255,255,0.55)', halo: '255,214,10', shine: true }
  };
  // shape: feather (default), bat, bfly (butterfly) or mech. Every shape sits in the same short, compact span.
  const WINGS = {
    angel: { name: 'Angel', near: ['#ffffff', '#f1f3f8', '#cfd5e2'], far: ['#c9cfdb', '#8e96a6'], hi: 'rgba(255,255,255,0.65)', vein: 'rgba(40,50,70,0.22)', edge: 'rgba(30,36,54,0.45)', farEdge: 'rgba(10,12,20,0.5)' },
    shadow: { name: 'Shadow', near: ['#626877', '#2d313b', '#16181e'], far: ['#3c404a', '#1a1c22'], hi: 'rgba(255,255,255,0.13)', vein: 'rgba(255,255,255,0.16)', edge: 'rgba(0,0,0,0.65)', farEdge: 'rgba(0,0,0,0.6)' },
    bat: { name: 'Bat', shape: 'bat', near: ['#8a68ab', '#52346f', '#28173b'], far: ['#4c3562', '#22142f'], hi: 'rgba(255,255,255,0.12)', vein: 'rgba(16,6,26,0.7)', edge: 'rgba(12,4,20,0.75)', farEdge: 'rgba(0,0,0,0.6)' },
    aqua: { name: 'Aqua', near: ['#f0fffd', '#9cf3ff', '#45b9ff'], far: ['#82d2e8', '#2f7fb0'], hi: 'rgba(255,255,255,0.6)', vein: 'rgba(10,80,120,0.25)', edge: 'rgba(10,60,100,0.5)', farEdge: 'rgba(5,30,60,0.5)' },
    butterfly: { name: 'Butterfly', shape: 'bfly', near: ['#fff1fb', '#ff9fd6', '#9b6bff'], far: ['#c987d6', '#6a4cb0'], hi: 'rgba(255,255,255,0.4)', vein: 'rgba(60,20,90,0.5)', edge: 'rgba(48,16,80,0.62)', farEdge: 'rgba(24,8,40,0.55)', spots: 'rgba(255,255,255,0.85)' },
    ember: { name: 'Ember', near: ['#ffe8c4', '#ff9a3c', '#e0451a'], far: ['#d4743a', '#7a2a10'], hi: 'rgba(255,255,255,0.45)', vein: 'rgba(120,30,0,0.3)', edge: 'rgba(90,20,0,0.5)', farEdge: 'rgba(60,10,0,0.5)' },
    mech: { name: 'Mech', shape: 'mech', near: ['#eef1f7', '#a3acbe', '#5d6678'], far: ['#7f8799', '#454c5c'], hi: 'rgba(255,255,255,0.42)', vein: 'rgba(18,24,38,0.55)', edge: 'rgba(12,16,26,0.78)', farEdge: 'rgba(0,0,0,0.55)', rivets: true },
    neon: { name: 'Neon', near: ['#22325a', '#141d3a', '#0a1024'], far: ['#16203a', '#0a0f1f'], hi: 'rgba(95,243,255,0.1)', vein: 'rgba(95,243,255,0.4)', edge: 'rgba(110,246,255,0.95)', farEdge: 'rgba(95,243,255,0.45)', glow: '63,214,255' },
    phoenix: { name: 'Phoenix', near: ['#fff6b8', '#ffa22e', '#e2321a'], far: ['#e07a2c', '#8a200e'], hi: 'rgba(255,255,220,0.55)', vein: 'rgba(150,34,0,0.35)', edge: 'rgba(120,24,0,0.55)', farEdge: 'rgba(70,10,0,0.5)', glow: '255,140,40' },
    gold: { name: 'Gold', near: ['#fff8d6', '#ffd84a', '#c99400'], far: ['#d6b04a', '#8a6a10'], hi: 'rgba(255,255,255,0.55)', vein: 'rgba(110,70,0,0.3)', edge: 'rgba(90,60,0,0.55)', farEdge: 'rgba(60,40,0,0.5)' }
  };
  // Flames: a base palette and a hotter "nova" palette (5+ swishes in a row), edge to white-hot core.
  // Prism shifts through the colours as it burns (its palettes are rewritten every frame, see prismTick).
  const FLAMES = {
    fire: { name: 'Fire', base: { outer: [255, 60, 16], mid: [255, 124, 20], inner: [255, 196, 72], core: [255, 244, 212] },
      nova: { outer: [104, 72, 255], mid: [60, 144, 255], inner: [140, 218, 255], core: [236, 248, 255] },
      hex: ['#fff1c4', '#ffc65a', '#ff9a2a', '#ff6a1f'], novaHex: ['#bfe8ff', '#7cb8ff', '#9a7bff', '#ffffff'] },
    ice: { name: 'Ice', base: { outer: [40, 96, 255], mid: [64, 160, 255], inner: [150, 222, 255], core: [240, 252, 255] },
      nova: { outer: [150, 60, 255], mid: [186, 110, 255], inner: [228, 186, 255], core: [255, 246, 255] } },
    toxic: { name: 'Toxic', base: { outer: [16, 140, 52], mid: [72, 214, 64], inner: [188, 255, 96], core: [246, 255, 224] },
      nova: { outer: [0, 140, 170], mid: [30, 210, 214], inner: [150, 255, 236], core: [238, 255, 252] } },
    aurora: { name: 'Aurora', base: { outer: [0, 128, 118], mid: [28, 214, 158], inner: [160, 255, 212], core: [236, 255, 248] },
      nova: { outer: [120, 44, 220], mid: [214, 80, 214], inner: [255, 172, 232], core: [255, 244, 252] } },
    rose: { name: 'Rose', base: { outer: [214, 20, 84], mid: [255, 72, 140], inner: [255, 160, 200], core: [255, 236, 246] },
      nova: { outer: [130, 40, 255], mid: [184, 92, 255], inner: [228, 172, 255], core: [255, 246, 255] } },
    eclipse: { name: 'Eclipse', base: { outer: [30, 20, 44], mid: [78, 42, 98], inner: [255, 104, 44], core: [255, 222, 158] },
      nova: { outer: [14, 14, 26], mid: [44, 46, 72], inner: [120, 196, 255], core: [236, 248, 255] } },
    plasma: { name: 'Plasma', base: { outer: [196, 0, 156], mid: [255, 56, 196], inner: [255, 168, 238], core: [255, 240, 255] },
      nova: { outer: [0, 112, 255], mid: [0, 196, 255], inner: [168, 240, 255], core: [255, 255, 255] } },
    prism: { name: 'Prism', prism: true, base: { outer: [230, 30, 120], mid: [255, 120, 60], inner: [255, 230, 120], core: [255, 252, 240] },
      nova: { outer: [40, 90, 255], mid: [40, 220, 200], inner: [180, 255, 200], core: [255, 255, 255] } },
    gold: { name: 'Gold', base: { outer: [230, 110, 0], mid: [255, 170, 20], inner: [255, 222, 110], core: [255, 252, 226] },
      nova: { outer: [255, 190, 40], mid: [255, 226, 130], inner: [255, 246, 206], core: [255, 255, 255] } }
  };
  // Trails follow the ball when it isn't burning. Classic is the soft streak in the flame's colour.
  const TRAILS = {
    classic: { name: 'Classic' },
    none: { name: 'Off' },
    comet: { name: 'Comet' },
    sparkle: { name: 'Sparkle' },
    bubbles: { name: 'Bubbles' },
    pixel: { name: 'Pixel' },
    rainbow: { name: 'Rainbow' }
  };
  // Rims recolour the ordinary rings only: the checkpoint ring stays gold and a missed ring grey.
  const RIMS = {
    red: { name: 'Red', pal: { edge: '#3a0805', body: '#a5261a', mid: '#dd3a22', hi: '#ff8a64', spec: '255,236,224', back: '#7c1b12', bounce: '150,175,255' } },
    chrome: { name: 'Chrome', pal: { edge: '#1c2029', body: '#7d8596', mid: '#c4cad6', hi: '#f2f5fa', spec: '255,255,255', back: '#5a6172', bounce: '150,175,255' } },
    cobalt: { name: 'Cobalt', pal: { edge: '#061436', body: '#1f4fb6', mid: '#3d7dff', hi: '#8fb6ff', spec: '235,244,255', back: '#173c8c', bounce: '150,175,255' } },
    mint: { name: 'Mint', pal: { edge: '#032a20', body: '#11826a', mid: '#2cc79e', hi: '#8ff0d2', spec: '235,255,248', back: '#0d634f', bounce: '150,175,255' } },
    violet: { name: 'Violet', pal: { edge: '#1d0838', body: '#6a2cc0', mid: '#9a55f5', hi: '#cfa8ff', spec: '246,238,255', back: '#4f2091', bounce: '150,175,255' } },
    pink: { name: 'Pink', pal: { edge: '#3a0822', body: '#b0216a', mid: '#ec3f93', hi: '#ff9cc9', spec: '255,238,246', back: '#86184f', bounce: '150,175,255' } }
  };

  // Courts: the backdrop and floor, the same on every level (see COURT_ART for how each is painted).
  const COURTS = {
    arena: { name: 'Arena' }, street: { name: 'Street' }, rooftop: { name: 'Rooftop' },
    beach: { name: 'Beach' }, neon: { name: 'Neon' }, orbit: { name: 'Orbit' }
  };
  const hex3 = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const mix3 = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  for (const F of Object.values(FLAMES)) {
    F.trail = F.base.mid.join(',');
    F.hex = F.hex || [F.base.core, F.base.inner, F.base.mid, F.base.outer].map(hex3);
    F.novaHex = F.novaHex || [F.nova.inner, F.nova.mid, F.nova.outer, F.nova.core].map(hex3);
  }
  const COS = { ball: BALLS, wing: WINGS, flame: FLAMES, trail: TRAILS, rim: RIMS, court: COURTS };
  const CATS = ['ball', 'wing', 'flame', 'trail', 'rim', 'court'];
  const TNAME = { ball: 'Ball', wing: 'Wings', flame: 'Flame', trail: 'Trail', rim: 'Rims', court: 'Court' };
  const DEF_EQ = { ball: 'classic', wing: 'angel', flame: 'fire', trail: 'classic', rim: 'red', court: 'arena' };
  // How each item unlocks: a player level (lvl), an achievement (ach) or a finished career chapter (ch, 0-based).
  // r: rarity, 0 common, 1 rare, 2 epic, 3 legendary. Order is the locker order.
  const UNLOCKS = [
    { t: 'ball', id: 'classic', lvl: 1, r: 0 }, { t: 'ball', id: 'retro', lvl: 2, r: 0 }, { t: 'ball', id: 'street', lvl: 3, r: 0 },
    { t: 'ball', id: 'neon', lvl: 4, r: 1 }, { t: 'ball', id: 'tiger', lvl: 5, r: 1 }, { t: 'ball', id: 'frost', lvl: 6, r: 1 },
    { t: 'ball', id: 'candy', lvl: 7, r: 1 }, { t: 'ball', id: 'lava', lvl: 8, r: 2 }, { t: 'ball', id: 'camo', lvl: 10, r: 1 },
    { t: 'ball', id: 'melon', lvl: 12, r: 1 }, { t: 'ball', id: 'planet', lvl: 14, r: 2 }, { t: 'ball', id: 'moon', lvl: 16, r: 2 },
    { t: 'ball', id: 'eight', lvl: 18, r: 2 }, { t: 'ball', id: 'pixel', lvl: 20, r: 2 }, { t: 'ball', id: 'chrome', ch: 2, r: 2 },
    { t: 'ball', id: 'galaxy', ach: 'nova5', r: 3 }, { t: 'ball', id: 'diamond', ch: 5, r: 3 }, { t: 'ball', id: 'gold', ach: 'champion', r: 3 },
    { t: 'wing', id: 'angel', lvl: 1, r: 0 }, { t: 'wing', id: 'shadow', lvl: 5, r: 1 }, { t: 'wing', id: 'bat', lvl: 7, r: 1 },
    { t: 'wing', id: 'aqua', lvl: 10, r: 1 }, { t: 'wing', id: 'butterfly', lvl: 13, r: 2 }, { t: 'wing', id: 'ember', lvl: 15, r: 1 },
    { t: 'wing', id: 'mech', lvl: 17, r: 2 }, { t: 'wing', id: 'neon', lvl: 22, r: 2 }, { t: 'wing', id: 'phoenix', ch: 3, r: 3 },
    { t: 'wing', id: 'gold', ach: 'perfect', r: 3 },
    { t: 'flame', id: 'fire', lvl: 1, r: 0 }, { t: 'flame', id: 'ice', lvl: 3, r: 1 }, { t: 'flame', id: 'toxic', lvl: 7, r: 1 },
    { t: 'flame', id: 'aurora', lvl: 11, r: 2 }, { t: 'flame', id: 'rose', lvl: 13, r: 1 }, { t: 'flame', id: 'eclipse', lvl: 19, r: 2 },
    { t: 'flame', id: 'plasma', lvl: 24, r: 2 }, { t: 'flame', id: 'prism', ch: 4, r: 3 }, { t: 'flame', id: 'gold', ach: 'streak10', r: 3 },
    { t: 'trail', id: 'classic', lvl: 1, r: 0 }, { t: 'trail', id: 'none', lvl: 1, r: 0 }, { t: 'trail', id: 'sparkle', lvl: 4, r: 1 },
    { t: 'trail', id: 'comet', ch: 1, r: 1 }, { t: 'trail', id: 'bubbles', lvl: 9, r: 1 }, { t: 'trail', id: 'pixel', lvl: 14, r: 2 },
    { t: 'trail', id: 'rainbow', lvl: 21, r: 2 },
    { t: 'rim', id: 'red', lvl: 1, r: 0 }, { t: 'rim', id: 'chrome', lvl: 3, r: 0 }, { t: 'rim', id: 'cobalt', lvl: 6, r: 1 },
    { t: 'rim', id: 'mint', lvl: 9, r: 1 }, { t: 'rim', id: 'violet', lvl: 12, r: 1 }, { t: 'rim', id: 'pink', lvl: 16, r: 2 },
    { t: 'court', id: 'arena', lvl: 1, r: 0 }, { t: 'court', id: 'street', ch: 0, r: 1 }, { t: 'court', id: 'rooftop', lvl: 8, r: 1 },
    { t: 'court', id: 'beach', lvl: 11, r: 2 }, { t: 'court', id: 'neon', lvl: 15, r: 2 }, { t: 'court', id: 'orbit', lvl: 20, r: 3 }
  ];
  const RARITY = ['Common', 'Rare', 'Epic', 'Legendary'];
  const UNLOCK_BY = Object.fromEntries(UNLOCKS.map((u) => [u.t + ':' + u.id, u]));
  const itemName = (u) => COS[u.t][u.id].name + ' ' + TNAME[u.t].toLowerCase();
  const isOwned = (t, id) => profile.owned.includes(t + ':' + id);
  // what the game draws: the equipped item, or the one being tried on in the locker (nav.try)
  const wear = (t) => (nav.try && nav.try.t === t ? nav.try.id : profile.eq[t]);
  const eqBall = () => BALLS[wear('ball')] || BALLS.classic;
  const eqWing = () => WINGS[wear('wing')] || WINGS.angel;
  const eqFlame = () => FLAMES[wear('flame')] || FLAMES.fire;
  const eqTrail = () => (TRAILS[wear('trail')] ? wear('trail') : 'classic');
  const eqRim = () => (RIMS[wear('rim')] ? wear('rim') : 'red');
  const eqCourt = () => (COURTS[wear('court')] ? wear('court') : 'arena');
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
  // Prism: the palettes walk around the colour wheel as it burns (the CSS heat colours keep its starting look)
  function hsl3(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
  }
  function prismTick(t) {
    const F = FLAMES.prism, h = t * 70;
    const set = (P, a) => { P.outer = hsl3(a, 1, 0.46); P.mid = hsl3(a + 28, 1, 0.56); P.inner = hsl3(a + 56, 1, 0.76); P.core = [255, 252, 246]; };
    set(F.base, h); set(F.nova, h + 150);
    F.trail = F.base.mid.join(',');
    F.hex = [F.base.core, F.base.inner, F.base.mid, F.base.outer].map(hex3);
    F.novaHex = [F.nova.inner, F.nova.mid, F.nova.outer, F.nova.core].map(hex3);
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
  const unlockReq = (u) => (u.lvl ? 'Level ' + u.lvl : u.ach ? ACH_BY[u.ach].name : 'Chapter ' + (u.ch + 1));
  const unlockHow = (u) => (u.lvl ? 'Reach level ' + u.lvl : u.ach ? ACH_BY[u.ach].desc : 'Finish career chapter ' + (u.ch + 1) + ', ' + CAREER[u.ch].name);

  // Daily missions: three a UTC day (easy, medium, hard), the same for everyone; weekly ones run from Monday 00:00
  // UTC. Their targets, XP and SOL rewards are in src/missions.cjs, shared with the server, which judges them from the
  // runs it verifies. Where they stand (progress, done, paid, SOL played) comes from the bank: the demo keeps it in the
  // profile, the server keeps the real one.
  const DTEXT = {
    swish: (n) => `Swish ${n} rings`, points: (n) => `Score ${n} points`, clears: (n) => `Clear ${n} levels`,
    best: (n) => `Swish ${n} in a row`, score: (n) => `Score ${n} in one run`, level: (n) => `Reach level ${n}`,
    mov: (n) => `Swish ${n} moving rings`, perfect: (n) => (n === 1 ? 'Swish every ring in a level' : `Swish every ring in ${n} levels`)
  };
  const mview = () => bank.missions.view(); // { daily, weekly, need, played, dayEnds, weekEnds }
  const dailySet = () => mview().daily;
  const dailyText = (c) => DTEXT[c.k](c.n);
  function leftOf(ms) {
    const mins = Math.max(1, Math.round(ms / 60000)), d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60);
    return d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + (mins % 60) + 'm' : mins + 'm';
  }
  const untilMidnight = () => leftOf(mview().dayEnds - Date.now());
  // ---------------------------------------------------------------- missions
  // Three kinds, all about how you play, whatever you bet:
  //   daily   3 a UTC day (easy, medium, hard), the same for everyone; XP, and SOL once the day's play reaches its need.
  //   weekly  3 a week with bigger totals, from Monday 00:00 UTC; XP, and SOL once the week's play reaches its need.
  //   career  6 chapters of 4 missions at your own pace. Each chapter ends in an item you can't get any other way.
  // "sum" missions add up across runs; the others have to happen within one run. Keys are run facts (runFacts).
  const MTEXT = {
    swish: (n) => (n === 1 ? 'Swish a ring' : `Swish ${n} rings`),
    points: (n) => `Score ${n} points`,
    clears: (n) => (n === 1 ? 'Clear a level' : `Clear ${n} levels`),
    best: (n) => `Swish ${n} in a row`,
    score: (n) => `Score ${n} in one run`,
    level: (n) => `Reach level ${n}`,
    mov: (n) => (n === 1 ? 'Swish a moving ring' : `Swish ${n} moving rings`),
    perfect: (n, sum) => (sum ? (n === 1 ? 'Get a perfect level' : `Get ${n} perfect levels`) : `Get ${n} perfect levels in one run`),
    fires: (n) => (n === 1 ? 'Catch fire' : `Catch fire ${n} times`),
    novas: (n) => (n === 1 ? 'Go supernova' : `Go supernova ${n} times`)
  };
  const weeklySet = () => mview().weekly;
  const weeklyText = (c) => MTEXT[c.k](c.n, true);
  const untilMonday = () => leftOf(mview().weekEnds - Date.now());
  // [key, target, XP, sum]
  const CAREER = [
    { name: 'First bounce', reward: 'court:street', m: [['swish', 10, 30, 1], ['clears', 2, 30, 1], ['score', 15, 30, 0], ['mov', 1, 30, 1]] },
    { name: 'Heating up', reward: 'trail:comet', m: [['fires', 3, 40, 1], ['best', 4, 40, 0], ['swish', 40, 40, 1], ['points', 120, 40, 1]] },
    { name: 'Swish city', reward: 'ball:chrome', m: [['perfect', 1, 60, 1], ['mov', 10, 50, 1], ['clears', 8, 50, 1], ['score', 30, 50, 0]] },
    { name: 'Supernova', reward: 'wing:phoenix', m: [['novas', 2, 70, 1], ['swish', 100, 60, 1], ['level', 3, 60, 0], ['points', 400, 60, 1]] },
    { name: 'Clutch', reward: 'flame:prism', m: [['perfect', 3, 80, 1], ['best', 7, 80, 0], ['clears', 20, 70, 1], ['mov', 30, 70, 1]] },
    { name: 'Hall of fame', reward: 'ball:diamond', title: 'hof', m: [['best', 10, 100, 0], ['perfect', 2, 100, 0], ['swish', 250, 90, 1], ['score', 50, 90, 0]] }
  ];
  const careerText = (m) => MTEXT[m[0]](m[1], !!m[3]);
  function careerState() {
    const c = profile.career;
    if (!c || typeof c.ch !== 'number' || !Array.isArray(c.p) || !Array.isArray(c.done)) profile.career = { ch: 0, p: [0, 0, 0, 0], done: [false, false, false, false] };
    return profile.career;
  }
  const careerDone = () => careerState().ch >= CAREER.length;
  // what a mission would stand at if the run ended now (r = runFacts)
  const sumNow = (p, n, v, sum) => Math.min(n, sum ? p + v : Math.max(p, v));

  // ---------------------------------------------------------------- player card: emblem, colour, name and title
  const EMBLEMS = {
    ball: '<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M3.6 12h16.8M12 3.4v17.2M6.1 5.9c2.4 1.6 3.4 3.8 3.4 6.1s-1 4.5-3.4 6.1M17.9 5.9c-2.4 1.6-3.4 3.8-3.4 6.1s1 4.5 3.4 6.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    flame: '<path fill="currentColor" d="M12 22.5c-4.1 0-7.4-2.9-7.4-7 0-3.1 1.9-5.2 3.4-6.9.6-.6 1.5-.2 1.5.6 0 1.3.8 2.4 1.9 2.4 1 0 1.7-.8 1.7-1.9 0-2.1-1.1-3.9-1.1-6.1 0-.8.9-1.4 1.6-.9 3.4 2.3 6.2 6.5 6.2 12.2 0 4.7-3.4 7.6-7.8 7.6Z"/>',
    star: '<path fill="currentColor" d="M12 2.8l2.75 5.8 6.25.75-4.65 4.35 1.25 6.25L12 16.8l-5.6 3.15 1.25-6.25L3 9.35l6.25-.75z"/>',
    bolt: '<path fill="currentColor" d="M13.4 2.4 4.9 13.3h5.9l-1.6 8.3 8.9-11.4h-6z"/>',
    crown: '<path fill="currentColor" d="M3.2 8.2l4.6 3.6L12 5l4.2 6.8 4.6-3.6-1.7 10.3H4.9zM5 20h14v1.8H5z"/>',
    wing: '<path fill="currentColor" d="M20.5 5.2c-5.9-.4-11 1.6-14.1 5.6-1.3 1.7-2.1 3.6-2.6 5.8l1.9.6c.3-1 .8-2 1.4-2.9 1.1.5 2.5.6 3.8.2-1 .9-2.2 1.6-3.6 1.9 1.6 1 3.6 1.2 5.6.4C17.7 15.6 20 11.2 20.5 5.2Z"/>',
    diamond: '<path fill="currentColor" d="M7 3.5h10l4.3 5.4L12 20.8 2.7 8.9zm.8 1.8L5.5 8.2h3.6zm8.4 0-1.3 2.9h3.6zM10.9 5.3 9.6 8.2h4.8l-1.3-2.9zM5.6 10l5.1 6.6-2.3-6.6zm4.8 0L12 15.6l1.6-5.6zm5.2 0-2.3 6.6 5.1-6.6z"/>',
    rocket: '<path fill="currentColor" d="M14.6 3.1c2.9-.9 5.4-.6 6.3-.4.2.9.5 3.4-.4 6.3-.8 2.7-2.8 5.2-5.4 7.1l.3 3.5-3.2 2.3-.9-3.4-3.3-3.3-3.4-.9 2.3-3.2 3.5.3c1.9-2.6 4.4-4.6 7.1-5.4Zm1.1 3.6a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8ZM5.2 15.7c1.4 0 2.9 1.5 2.9 2.9 0 1.6-1.7 2.9-4.9 3 .1-3.2 1.4-5.9 2-5.9Z"/>',
    moon: '<path fill="currentColor" d="M14.9 2.6A9.6 9.6 0 1 0 21.4 15 7.8 7.8 0 0 1 14.9 2.6Z"/>',
    heart: '<path fill="currentColor" d="M12 21.2s-8.6-5.1-8.6-11.2A4.9 4.9 0 0 1 12 6.9 4.9 4.9 0 0 1 20.6 10c0 6.1-8.6 11.2-8.6 11.2Z"/>'
  };
  const CARD_COLORS = ['#ff7a1a', '#f5c542', '#2fd36b', '#3d7dff', '#a25dff', '#ff4fa3', '#5ff3ff', '#e8ecf5'];
  const TITLES = [
    { id: 'rookie', name: 'Rookie' }, { id: 'hooper', name: 'Hooper', lvl: 5 }, { id: 'fire', name: 'Fire starter', ach: 'fire3' },
    { id: 'perfect', name: 'Perfectionist', ach: 'perfect' }, { id: 'nova', name: 'Supernova', ach: 'nova5' }, { id: 'collector', name: 'Swish collector', ach: 'swish100' },
    { id: 'diver', name: 'Deep diver', ach: 'deep6' }, { id: 'unstoppable', name: 'Unstoppable', ach: 'streak10' }, { id: 'veteran', name: 'Veteran', lvl: 20 },
    { id: 'champion', name: 'Champion', ach: 'champion' }, { id: 'hof', name: 'Hall of famer', ch: 5 }
  ];
  const TITLE_BY = Object.fromEntries(TITLES.map((t) => [t.id, t]));
  const titleOpen = (t) => (t.lvl ? lvlOf(profile.xp).l >= t.lvl : t.ach ? !!profile.ach[t.ach] : t.ch != null ? careerState().ch > t.ch : true);
  const titleReq = (t) => (t.lvl ? 'Reach level ' + t.lvl : t.ach ? ACH_BY[t.ach].desc : t.ch != null ? 'Finish career chapter ' + (t.ch + 1) : '');
  const emblemSvg = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true">${EMBLEMS[id] || EMBLEMS.ball}</svg>`;
  const cardColor = () => CARD_COLORS[profile.card.color] || CARD_COLORS[0];

  function grantUnlocks() {
    const L = lvlOf(profile.xp).l, got = [];
    for (const u of UNLOCKS) {
      const key = u.t + ':' + u.id;
      if (profile.owned.includes(key)) continue;
      if ((u.lvl && L >= u.lvl) || (u.ach && profile.ach[u.ach]) || (u.ch != null && careerState().ch > u.ch)) { profile.owned.push(key); profile.fresh.push(key); got.push(u); }
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
    let rendering = false;
    function on() { return rendering || (settings.sound && ctx() && ac.state === 'running'); }
    // tests: play one sound into an offline context and resolve to its samples (mono, 44.1 kHz)
    function render(name, args, secs) {
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, keep = [ac, master, noise];
      const off = new OAC(1, Math.ceil(44100 * (secs || 1)), 44100);
      ac = off; master = off.createGain(); master.gain.value = 0.55; master.connect(off.destination);
      noise = off.createBuffer(1, 44100, 44100);
      const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      rendering = true;
      try { api[name].apply(null, args || []); } finally { rendering = false; [ac, master, noise] = keep; }
      return off.startRendering().then((b) => Array.from(b.getChannelData(0)));
    }
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
    const api = {
      unlock, render,
      flap(fire) {
        // a soft wing beat: a breath of air that falls in pitch, never quite the same twice, and no tone
        if (!on()) return; const t = ac.currentTime, v = rnd(0.85, 1.05), k = rnd(0.88, 1.12);
        hiss(t, 0.11, 1500 * k, 520 * k, 0.5, 0.06 * v, 'lowpass');
        hiss(t, 0.06, 380 * k, 200, 0.7, 0.035 * v, 'lowpass');
        if (fire > 0.2) hiss(t + 0.01, 0.22, 700, 260, 0.7, 0.04 * fire, 'lowpass'); // the flame breathes with it
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
      unlockItem() { if (!on()) return; const t = ac.currentTime; tone(1318.5, t, 0.55, 'sine', 0.07); tone(1975.5, t + 0.09, 0.7, 'sine', 0.05); tone(2637, t + 0.18, 0.5, 'sine', 0.025); },
      goal() { if (!on()) return; const t = ac.currentTime; tone(1567.98, t, 0.2, 'sine', 0.045); tone(2093, t + 0.09, 0.34, 'sine', 0.04); },
      // the arena: k from 0 (a murmur) to 1 (a roar)
      cheer(k) {
        if (!on()) return; const t = ac.currentTime, d = 0.6 + 0.8 * k;
        hiss(t, d, 650, 1400, 0.55, 0.035 + 0.06 * k, 'bandpass');
        hiss(t + 0.03, d * 0.85, 1500, 2700, 0.9, 0.018 + 0.035 * k, 'bandpass');
        hiss(t + 0.02, d * 0.8, 280, 520, 0.8, 0.025 + 0.035 * k, 'bandpass');
      },
      applause(k) {
        if (!on()) return; const t = ac.currentTime, n = Math.round(24 + 44 * k), span = 0.8 + 0.9 * k;
        for (let i = 0; i < n; i++) {
          const u = Math.random(), at = t + 0.05 + u * span, a = (0.016 + 0.026 * k) * (1 - 0.75 * u);
          hiss(at, 0.03 + Math.random() * 0.02, rnd(1000, 2600), rnd(650, 1300), 1.5, a, 'bandpass');
        }
      }
    };
    return api;
  })();
  function buzz(ms) { if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* ignore */ } } }

  // ---------------------------------------------------------------- challenge pot, demo (rules in src/pots.cjs)
  // The demo runs the same pot with demo SOL. There are no other players in the demo, so the other entrants are
  // simulated, and labelled so: a field drawn from the pot's key, each a casual, average or good player who plays a
  // few runs with the simulator's chance of making the challenge. The real pot (ServerBank) has only real players.
  const DemoPot = {
    s: null, last: null, fee: POTS.ENTRY,
    load() {
      if (this.s) return this.s;
      const s = store.get('pot', null), day = POTS.dayKey(Date.now());
      this.s = s && s.key ? s : { key: day, open: POTS.dayStart(day), carryIn: 0, me: null };
      this.last = store.get('potLast', null);
      return this.s;
    },
    save() { store.set('pot', this.s); store.set('potLast', this.last); },
    field(key, open) {
      const close = POTS.closesAt(key), g = POTS.goalFor(key), r = POTS.rng('field|' + key), out = [];
      const n = 24 + Math.floor(r() * 48);
      for (let i = 0; i < n; i++) {
        const join = open + r() * (close - open) * 0.9, u = r(), skill = u < 0.35 ? 0 : u < 0.8 ? 1 : 2;
        const runs = 1 + Math.floor(-Math.log(1 - r() * 0.999) * 5);
        let k = -1;
        for (let j = 0; j < runs; j++) if (r() < g.p[skill]) { k = j; break; }
        out.push({ join, done: k < 0 ? null : join + ((k + 1) / (runs + 1)) * (close - join) });
      }
      return out;
    },
    // close the pot once its day is over (or now, when the demo's "close now" asks), pay out and open the next one
    roll(force) {
      const s = this.load(), now = Date.now(), close = POTS.closesAt(s.key);
      if (!force && now < close) return false;
      const sim = this.field(s.key, s.open), mine = s.me ? 1 : 0, myDone = !!(s.me && s.me.done);
      const winners = sim.filter((x) => x.done !== null).length + (myDone ? 1 : 0);
      const r = POTS.split((sim.length + mine) * this.fee, s.carryIn, winners, false);
      const won = myDone ? round9(r.share) : 0;
      if (won) wallet.balance = round9(wallet.balance + won);
      this.last = { key: s.key, goal: POTS.goalFor(s.key).text, entrants: sim.length + mine, winners, share: round9(r.share), rolled: winners ? 0 : round9(r.carry), me: s.me ? { done: myDone, won } : null };
      const today = POTS.dayKey(now), sameDay = String(s.key).slice(0, 10) === today;
      const key = force && sameDay ? today + '#' + ((+String(s.key).split('#')[1] || 0) + 1) : today;
      this.s = { key, open: force && sameDay ? now : POTS.dayStart(today), carryIn: winners ? 0 : round9(r.carry), me: null };
      this.save(); saveAll();
      return true;
    },
    view() {
      const s = this.load(), now = Date.now(), g = POTS.goalFor(s.key);
      const joined = this.field(s.key, s.open).filter((x) => x.join <= now), mine = s.me ? 1 : 0;
      return {
        key: s.key, goal: { id: g.id, kind: g.kind, n: g.n, tier: g.tier, text: g.text, sub: POTS.tierText(g.tier) },
        fee: this.fee, rake: POTS.RAKE, entrants: joined.length + mine,
        completed: joined.filter((x) => x.done !== null && x.done <= now).length + (s.me && s.me.done ? 1 : 0),
        pool: round9(POTS.poolOf((joined.length + mine) * this.fee, s.carryIn)), carryIn: s.carryIn, closesAt: POTS.closesAt(s.key), simulated: true,
        me: s.me ? { entered: true, done: !!s.me.done, best: s.me.best || 0 } : { entered: false }, last: this.last
      };
    },
    enter() {
      this.roll();
      const s = this.load();
      if (s.me) throw new Error('You’re already in this pot');
      if (POTS.closesAt(s.key) - Date.now() < 60000) throw new Error('This pot is about to close. The next one opens at midnight UTC.');
      if (wallet.balance + 1e-12 < this.fee) throw new Error('Not enough demo SOL for the entry.');
      wallet.balance = round9(wallet.balance - this.fee);
      s.me = { at: Date.now(), done: false, best: 0 };
      this.save(); saveAll();
      return this.view();
    },
    // a level the demo bank has just verified: did it complete the challenge? (runs started after entering only)
    check(cur) {
      this.roll();
      const s = this.load();
      if (!s.me || !(cur.potAt >= s.me.at)) return null;
      const pr = POTS.progress(POTS.goalFor(s.key), cur.levels, cur.di);
      if (!pr.counts) return { counts: false, done: !!s.me.done };
      if (pr.value > (s.me.best || 0)) s.me.best = pr.value;
      const just = !s.me.done && pr.done;
      if (just) { s.me.done = true; s.me.doneAt = Date.now(); }
      this.save();
      return { counts: true, done: !!s.me.done, just, value: pr.value, target: pr.target };
    }
  };

  // ---------------------------------------------------------------- missions, demo (rules in src/missions.cjs)
  // The same rules as the server, on demo SOL: progress from the levels the demo bank verifies, SOL once the window's
  // play reaches its need. The state lives in the profile.
  const DemoMissions = {
    need: MS.NEED,
    view() {
      if (!profile.ms) { // carry over today's and this week's progress from the old local-time missions, as already paid
        const now = Date.now(), old = (o, key) => (o && o[key] && Array.isArray(o.list) && o.list.length === 3 ? o.list.map((c) => ({ p: c.p | 0, done: !!c.done, paid: !!c.done })) : null);
        const ms = MS.roll(null, now), d = profile.daily && profile.daily.day === ms.day && old(profile.daily, 'day'), w = profile.weekly && profile.weekly.wk === ms.week && old(profile.weekly, 'wk');
        if (d) ms.d = d; if (w) ms.w = w;
        profile.ms = ms;
      }
      profile.ms = MS.roll(profile.ms, Date.now()); return MS.view(profile.ms, Date.now(), this.need);
    },
    pay(paid) {
      let sum = 0;
      for (const p of paid) sum += p.amount;
      if (sum) { wallet.balance = round9(wallet.balance + sum); stats.missionSol = round9((stats.missionSol || 0) + sum); }
      return paid;
    },
    play(amount) { const r = MS.play(profile.ms, amount, Date.now(), this.need); profile.ms = r.s; return this.pay(r.paid); },
    run(levels) { const r = MS.run(profile.ms, levels, Date.now(), this.need); profile.ms = r.s; return { done: r.done, paid: this.pay(r.paid) }; }
  };
  // a level as the banks verify it, for missions and the pot: only the rings that counted (a max win stops at the
  // capped ring, which isn't a clear), and which of them were moving
  function verifiedLevel(def, r, capIndex) {
    const n = capIndex >= 0 ? capIndex + 1 : r.outcomes.length, o = r.outcomes.slice(0, n);
    return { outcomes: o.join(''), clear: r.result === 'clear' && capIndex < 0, mov: o.map((x, k) => (def.hoops[k].amp ? '1' : '0')).join('') };
  }

  // ---------------------------------------------------------------- special level, demo (rules in src/special.cjs)
  // One attempt at a time: a fresh course from its own seed (HMAC-SHA256(serverSeed, clientSeed:nonce:special)), the
  // entry up front and the prize for clearing every ring, checked by replaying the taps, exactly as the server does.
  const DemoSpecial = {
    cur: null, fee: SP.ENTRY,
    tally() { const day = SP.dayKey(Date.now()), t = store.get('special', null); return t && t.day === day ? t : { day, tries: 0, wins: 0 }; },
    view() {
      const day = SP.dayKey(Date.now()), R = SP.recipeFor(day), t = this.tally(), x = SP.prizeOf(R.id);
      return { day, recipe: { id: R.id, name: R.name, blurb: R.blurb, rings: R.n }, fee: this.fee, prize: round9(this.fee * x), x, odds: (SP.PRIZES[R.id] || { p: [] }).p, closesAt: SP.closesAt(day), me: { tries: t.tries, wins: t.wins, blocked: false } };
    },
    start() {
      const v = this.view();
      if (!(v.prize > v.fee)) throw new Error('There’s no special level today');
      if (wallet.balance + 1e-12 < v.fee) throw new Error('Not enough demo SOL for the entry.');
      wallet.balance = round9(wallet.balance - v.fee);
      const paid = DemoMissions.play(v.fee);
      const t = this.tally(); t.tries++; store.set('special', t);
      const serverSeed = randomHex(32), clientSeed = randomHex(8), nonce = wallet.nonce++;
      this.cur = { serverSeed, clientSeed, nonce, recipe: v.recipe.id, fee: v.fee, prize: v.prize, day: v.day, seed: deriveLevelSeed(serverSeed, clientSeed, nonce, 'special') };
      saveAll();
      return { seedHash: hex(sha256(utf8(serverSeed))), clientSeed, nonce, seed: this.cur.seed, recipe: v.recipe.id, fee: v.fee, prize: v.prize, missions: { paid }, special: this.view() };
    },
    finish(taps) {
      const c = this.cur;
      if (!c) throw new Error('No special level in progress');
      this.cur = null;
      const r = E.replay(SP.generate(c.seed, c.recipe), taps), won = r.result === 'clear';
      if (won) {
        wallet.balance = round9(wallet.balance + c.prize);
        const t = this.tally(); if (t.day === c.day) { t.wins++; store.set('special', t); }
      }
      saveAll();
      return { status: won ? 'won' : 'lost', payout: won ? c.prize : 0, serverSeed: c.serverSeed, outcomes: r.outcomes, special: this.view() };
    }
  };

  // ---------------------------------------------------------------- bank: demo (local) and server (real SOL)
  const LocalBank = {
    real: false,
    cur: null,
    balance() { return wallet.balance; },
    async start(di, bet) {
      if (!(bet >= CFG.minBet)) throw new Error('Minimum bet is ' + CFG.minBet + ' SOL');
      if (bet > wallet.balance + 1e-12) throw new Error('Not enough demo SOL for that bet.');
      wallet.balance = round9(wallet.balance - bet);
      const paid = DemoMissions.play(bet);
      const serverSeed = randomHex(32), clientSeed = randomHex(8), nonce = wallet.nonce++;
      saveAll();
      this.cur = { di, bet, serverSeed, clientSeed, nonce, level: 1, total: 1, streak: 0, levels: [], potAt: Date.now() };
      return { seedHash: hex(sha256(utf8(serverSeed))), clientSeed, nonce, levelSeed: deriveLevelSeed(serverSeed, clientSeed, nonce, 1), missions: { paid } };
    },
    // Re-verifies the level by replaying the taps, exactly as the server does.
    async level(L, taps) {
      const c = this.cur;
      const def = E.generateLevel(deriveLevelSeed(c.serverSeed, c.clientSeed, c.nonce, L), c.di, L);
      const r = E.replay(def, taps);
      const a = E.applyLevel(PAY.PAYTABLE[c.di][L - 1], r.outcomes, c.total, E.DIFFS[c.di].maxWin, c.streak);
      c.total = a.total; c.streak = a.streak; c.level = L;
      c.levels.push(verifiedLevel(def, r, a.capped ? a.capIndex : -1));
      const pot = DemoPot.check(c);
      const status = a.capped ? 'maxwin' : r.result === 'clear' ? (L >= NL ? 'final' : 'checkpoint') : 'bust';
      let payout = 0, missions = null;
      if (status === 'maxwin' || status === 'final') payout = this._pay();
      if (status !== 'checkpoint') { missions = DemoMissions.run(c.levels); saveAll(); } // the run is over
      return { status, total: c.total, payout, serverSeed: status === 'checkpoint' ? null : c.serverSeed, pot, missions };
    },
    async next() { const c = this.cur; c.level++; return { levelSeed: deriveLevelSeed(c.serverSeed, c.clientSeed, c.nonce, c.level) }; },
    async cashout() { const payout = this._pay(), missions = DemoMissions.run(this.cur.levels); saveAll(); return { payout, serverSeed: this.cur.serverSeed, missions }; },
    _pay() { const c = this.cur; const payout = round9(c.bet * c.total); wallet.balance = round9(wallet.balance + payout); saveAll(); return payout; },
    pot: {
      async state() { DemoPot.roll(); return DemoPot.view(); },
      async enter() { return DemoPot.enter(); },
      async closeNow() { DemoPot.roll(true); return DemoPot.view(); } // demo only
    },
    missions: { view: () => DemoMissions.view(), async state() { return DemoMissions.view(); } },
    special: {
      async state() { return DemoSpecial.view(); },
      async start() { return DemoSpecial.start(); },
      async finish(taps) { return DemoSpecial.finish(taps); }
    }
  };

  // Real SOL: talks to server/server.mjs. Only active when SOL_DUNK_CONFIG.serverUrl is set.
  const ServerBank = {
    real: true, token: null, address: null, bal: 0, runId: null, specId: null, mv: null,
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
      return { seedHash: j.serverSeedHash, clientSeed, nonce: j.nonce, levelSeed: j.levelSeed, missions: this.mfrom(j.missions) };
    },
    async level(L, taps) {
      const j = await this.api('/api/run/level', { runId: this.runId, level: L, taps });
      return { status: j.status, total: j.total, payout: (j.payoutLamports || 0) / 1e9, serverSeed: j.serverSeed || null, pot: j.pot || null, missions: this.mfrom(j.missions) };
    },
    async next() { return this.api('/api/run/continue', { runId: this.runId }); },
    async cashout() { const j = await this.api('/api/run/cashout', { runId: this.runId }); return { payout: j.payoutLamports / 1e9, serverSeed: j.serverSeed, missions: this.mfrom(j.missions) }; },
    // the server's missions in SOL; keeps its latest view for the Missions page
    mconv(v) {
      const L = 1e9, one = (m) => Object.assign({}, m, { reward: m.rewardLamports / L });
      return { day: v.day, week: v.week, dayEnds: v.dayEnds, weekEnds: v.weekEnds, need: { day: v.needLamports.day / L, week: v.needLamports.week / L }, played: { day: v.playedLamports.day / L, week: v.playedLamports.week / L }, daily: v.daily.map(one), weekly: v.weekly.map(one) };
    },
    mfrom(j) {
      if (!j) return null;
      if (j.view) this.mv = this.mconv(j.view);
      return { done: j.done || [], paid: (j.paid || []).map((p) => Object.assign({}, p, { amount: p.lamports / 1e9 })) };
    },
    missions: {
      view() { return ServerBank.mv || MS.view(null, Date.now()); },
      async state() { ServerBank.mv = ServerBank.mconv(await ServerBank.api('/api/missions')); return ServerBank.mv; }
    },
    special: {
      view(j) { const L = 1e9; return { day: j.day, recipe: j.recipe, fee: j.feeLamports / L, prize: j.prizeLamports / L, x: j.x, odds: j.odds, closesAt: j.closesAt, me: j.me || { tries: 0, wins: 0, blocked: false } }; },
      async state() { return this.view(await ServerBank.api('/api/special')); },
      async start() {
        const clientSeed = randomHex(8), j = await ServerBank.api('/api/special/start', { clientSeed });
        ServerBank.specId = j.runId;
        return { seedHash: j.serverSeedHash, clientSeed, nonce: j.nonce, seed: j.seed, recipe: j.recipe, fee: j.feeLamports / 1e9, prize: j.prizeLamports / 1e9, missions: ServerBank.mfrom(j.missions), special: this.view(j.special) };
      },
      async finish(taps) {
        const j = await ServerBank.api('/api/special/finish', { runId: ServerBank.specId, taps });
        return { status: j.status, payout: j.payoutLamports / 1e9, serverSeed: j.serverSeed, outcomes: j.outcomes, special: this.view(j.special) };
      }
    },
    pot: {
      view(j) {
        const L = j.last;
        return {
          key: j.key, goal: j.goal, fee: j.feeLamports / 1e9, rake: j.rake, entrants: j.entrants, completed: j.completed,
          pool: j.poolLamports / 1e9, carryIn: j.carryInLamports / 1e9, closesAt: j.closesAt, simulated: false, me: j.me || null,
          last: L ? { key: L.key, goal: L.goal, entrants: L.entrants, winners: L.winners, share: L.shareLamports / 1e9, rolled: L.rolledLamports / 1e9, me: L.me ? { done: L.me.done, won: L.me.wonLamports / 1e9 } : null } : null
        };
      },
      async state() { return this.view(await ServerBank.api('/api/pot')); },
      async enter() { return this.view(await ServerBank.api('/api/pot/enter', {})); }
    }
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
  const VIEW_W = 352, VIEW_TOP = -10, VIEW_BOT = 680, VIEW_H = VIEW_BOT - VIEW_TOP, BALL_SX = 56; // the ball sits about 16% in, so more of the course shows ahead (76 before engine v13 spread the rings out)
  const RV = P.R; // drawn ball radius = collision radius
  const cv = $('game'), cx = cv.getContext('2d');
  let vw = 0, vh = 0, dpr = 1, scale = 1, offX = 0, offY = 0;
  // canvas sharpness: up to 2x, stepped down if a phone can't keep up during play (see frame)
  let dprCap = 2;
  const perf = { avg: 1 / 60, slow: 0 };
  let bgEl = null;      // cached backdrop, rebuilt on resize
  let sheetTopC = -1, heroT = 0, heroB = 0;   // the page's window onto the arena, in screen px (layout read only when it changes)
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    bgEl = null; sheetTopC = -1;
    vw = window.innerWidth; vh = window.innerHeight;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    scale = Math.min(vw / VIEW_W, vh / VIEW_H);
    offX = (vw - VIEW_W * scale) / 2;
    offY = (vh - VIEW_H * scale) / 2 - VIEW_TOP * scale;
    document.documentElement.style.setProperty('--col', Math.round(VIEW_W * scale) + 'px'); // the play column, for the HUD
  }
  window.addEventListener('resize', resize);
  resize();

  // Courts. Each is one backdrop for every level (no per-level colours), painted once and cached: a sky painted in
  // screen space, an optional far layer that sits on the floor line and drifts at a fraction of the court's speed
  // (parallax), and a floor drawn each frame. All of them stay dark so the rings and the ball carry the colour.
  const EDGE = '#05070d', EDGE0 = 'rgba(5,7,13,0)';
  const seeded = (k) => E.makeRng('art|' + k);
  function vignette(g, vw, vh, a) {
    const vg = g.createRadialGradient(vw / 2, vh * 0.45, Math.min(vw, vh) * 0.3, vw / 2, vh * 0.45, Math.max(vw, vh) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,' + (a || 0.5) + ')');
    g.fillStyle = vg; g.fillRect(0, 0, vw, vh);
  }
  function vgrad(g, vh, stops) { const l = g.createLinearGradient(0, 0, 0, vh); stops.forEach(([t, c]) => l.addColorStop(t, c)); return l; }
  function glowAt(g, x, y, r, col, a, sx, sy) {
    g.save(); g.translate(x, y); g.scale(sx || 1, sy || 1);
    const rg = g.createRadialGradient(0, 0, 0, 0, 0, r);
    rg.addColorStop(0, 'rgba(' + col + ',' + a + ')'); rg.addColorStop(1, 'rgba(' + col + ',0)');
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill(); g.restore();
  }
  function starField(g, vw, vh, n, top, key, big) {
    const rng = seeded('stars' + key);
    for (let i = 0; i < n; i++) {
      const x = rng() * vw, y = rng() * vh * top, s = rng(), a = 0.25 + 0.6 * rng() * (1 - y / (vh * top)) ;
      g.fillStyle = 'rgba(235,240,255,' + a.toFixed(3) + ')';
      g.beginPath(); g.arc(x, y, (s < 0.92 ? 0.55 : big || 1.2) * (vw > 600 ? 1 : 0.9), 0, Math.PI * 2); g.fill();
    }
  }
  function moon(g, x, y, r, col) {
    glowAt(g, x, y, r * 5, col || '220,230,255', 0.12);
    const mg = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    mg.addColorStop(0, '#fbfaf3'); mg.addColorStop(1, '#cfd3dc');
    g.fillStyle = mg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(150,158,175,0.35)';
    for (const [dx, dy, rr] of [[-0.3, 0.1, 0.22], [0.25, -0.25, 0.15], [0.2, 0.35, 0.12]]) { g.beginPath(); g.arc(x + dx * r, y + dy * r, rr * r, 0, Math.PI * 2); g.fill(); }
  }
  // the floor: a lit edge fading into the court's colour, then into the dark
  function floorBase(c, x0, w, F, light, a, col) {
    const fg = c.createLinearGradient(0, F, 0, F + 150);
    fg.addColorStop(0, 'rgba(' + light + ',' + a + ')'); fg.addColorStop(0.07, col); fg.addColorStop(1, EDGE);
    c.fillStyle = fg; c.fillRect(x0, F, w, 4000);
  }
  function floorFade(c, x0, w, F) {
    const fade = c.createLinearGradient(0, F + 6, 0, F + 120);
    fade.addColorStop(0, EDGE0); fade.addColorStop(1, EDGE);
    c.fillStyle = fade; c.fillRect(x0, F + 6, w, 4000);
  }
  // boards (or seams) receding toward you, anchored to the court so they scroll with it
  function recede(c, x0, w, F, mid, step, col, S, spread) {
    c.strokeStyle = col; c.lineWidth = 1 / S; c.beginPath();
    for (let x = Math.floor(x0 / step) * step; x < x0 + w + step; x += step) { c.moveTo(x, F); c.lineTo(mid + (x - mid) * (spread || 2.4), F + 120); }
    c.stroke();
  }
  function across(c, x0, w, F, ys, col, S) {
    c.strokeStyle = col; c.lineWidth = 1 / S; c.beginPath();
    for (const y of ys) { c.moveTo(x0, F + y); c.lineTo(x0 + w, F + y); }
    c.stroke();
  }
  // a row of building silhouettes with a few lit windows, for the far layers
  function skyline(g, tw, fh, key, o) {
    const rng = seeded(key);
    let x = -10;
    while (x < tw + 10) {
      const bw = o.minW + rng() * (o.maxW - o.minW), bh = o.minH + rng() * (o.maxH - o.minH);
      g.fillStyle = o.fill; g.fillRect(x, fh - bh, bw + 1, bh);
      if (rng() < (o.roof || 0)) { g.fillRect(x + bw * 0.4, fh - bh - 12, 2, 12); }
      if (o.win) for (let wy = fh - bh + 8; wy < fh - 10; wy += 9) for (let wx = x + 5; wx < x + bw - 5; wx += 8) {
        if (rng() < o.lit) { g.fillStyle = o.win + (0.18 + 0.4 * rng()).toFixed(2) + ')'; g.fillRect(wx, wy, 3, 4); }
      }
      x += bw + (o.gap ? rng() * o.gap : 0);
    }
  }
  const COURT_ART = {
    arena: {
      light: '61,123,255', edge: 'rgba(255,255,255,0.32)',
      sky(g, vw, vh, playW) {
        const rgb = this.light;
        g.fillStyle = vgrad(g, vh, [[0, '#0b1120'], [0.6, '#070a14'], [1, EDGE]]); g.fillRect(0, 0, vw, vh);
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
        vignette(g, vw, vh);
      },
      // behind the court: the courtside crowd and the LED board (drawArena)
      farDraw: (c, left, width) => drawArena(c, left, width),
      floor(c, x0, w, F, S, mid, width) {
        floorBase(c, x0, w, F, this.light, 0.24, 'rgba(17,21,34,0.97)');
        recede(c, x0, w, F, mid, 34, 'rgba(255,255,255,0.055)', S);
        floorFade(c, x0, w, F);
        // the spotlight's reflection on the polished boards, under the middle of the view
        c.save(); c.beginPath(); c.rect(x0, F, w, 200); c.clip();
        c.translate(mid, F + 16); c.scale(1, 0.12);
        const sr = width * 0.44, sheen = c.createRadialGradient(0, 0, 0, 0, 0, sr);
        sheen.addColorStop(0, 'rgba(190,210,255,0.15)'); sheen.addColorStop(1, 'rgba(190,210,255,0)');
        c.fillStyle = sheen; c.beginPath(); c.arc(0, 0, sr, 0, Math.PI * 2); c.fill(); c.restore();
      }
    },
    street: {
      light: '255,160,80', edge: 'rgba(255,236,214,0.26)',
      sky(g, vw, vh) {
        g.fillStyle = vgrad(g, vh, [[0, '#0e1219'], [0.55, '#0a0d13'], [1, EDGE]]); g.fillRect(0, 0, vw, vh);
        glowAt(g, vw * 0.16, vh * 0.04, Math.max(vw, vh) * 0.62, '255,150,60', 0.17);   // a sodium streetlight
        glowAt(g, vw * 0.16, vh * 0.04, Math.min(vw, vh) * 0.09, '255,214,160', 0.5);
        glowAt(g, vw * 0.88, vh * 0.3, Math.max(vw, vh) * 0.4, '90,130,210', 0.07);
        glowAt(g, vw / 2, vh * 0.92, vw * 0.9, this.light, 0.12, 1, 0.3);
        vignette(g, vw, vh, 0.55);
      },
      far: { tw: 640, h: 230, p: 0.22, paint(g, tw, fh) {
        skyline(g, tw, fh, 'street', { minW: 50, maxW: 120, minH: 70, maxH: 190, fill: '#0b0e15', win: 'rgba(255,190,120,', lit: 0.12, gap: 18, roof: 0.3 });
        // a chain-link fence in front
        const top = fh - 118;
        g.strokeStyle = 'rgba(190,200,220,0.075)'; g.lineWidth = 1;
        g.beginPath();
        for (let x = -top; x < tw + 130; x += 12) { g.moveTo(x, top); g.lineTo(x + 118, fh); g.moveTo(x + 118, top); g.lineTo(x, fh); }
        g.stroke();
        g.fillStyle = 'rgba(150,160,180,0.22)';
        for (let x = 0; x < tw; x += 160) g.fillRect(x, top - 4, 3, 122);
        g.fillRect(0, top - 4, tw, 2.5);
      } },
      floor(c, x0, w, F, S) {
        floorBase(c, x0, w, F, this.light, 0.2, 'rgba(25,26,30,0.98)');
        across(c, x0, w, F, [12], 'rgba(255,255,255,0.16)', S / 2.2);
        c.save(); c.setLineDash([14, 12]); across(c, x0, w, F, [44], 'rgba(245,197,66,0.12)', S / 2); c.restore();
        floorFade(c, x0, w, F);
      }
    },
    rooftop: {
      light: '255,128,96', edge: 'rgba(255,226,214,0.28)',
      sky(g, vw, vh) {
        g.fillStyle = vgrad(g, vh, [[0, '#0b0a1f'], [0.5, '#16112f'], [0.82, '#2a1838'], [1, EDGE]]); g.fillRect(0, 0, vw, vh);
        glowAt(g, vw / 2, vh * 0.86, vw * 0.95, '255,110,90', 0.16, 1, 0.42);
        starField(g, vw, vh, Math.round(vw * vh / 9000), 0.5, 'roof');
        moon(g, vw * 0.78, vh * 0.15, Math.min(vw, vh) * 0.055);
        vignette(g, vw, vh, 0.5);
      },
      far: { tw: 720, h: 300, p: 0.16, paint(g, tw, fh) {
        skyline(g, tw, fh - 20, 'roof-back', { minW: 40, maxW: 90, minH: 120, maxH: 270, fill: '#141026', win: 'rgba(255,214,150,', lit: 0.16, roof: 0.5 });
        g.save(); g.translate(0, 20);
        skyline(g, tw, fh - 20, 'roof-front', { minW: 60, maxW: 130, minH: 60, maxH: 150, fill: '#0c0a18', win: 'rgba(255,196,130,', lit: 0.1, gap: 30, roof: 0.2 });
        g.restore();
        g.fillStyle = '#0a0913'; g.fillRect(0, fh - 16, tw, 16); // the roof's low wall
        g.fillStyle = 'rgba(255,200,180,0.12)'; g.fillRect(0, fh - 16, tw, 1.5);
      } },
      floor(c, x0, w, F, S, mid) {
        floorBase(c, x0, w, F, this.light, 0.2, 'rgba(30,29,40,0.97)');
        recede(c, x0, w, F, mid, 92, 'rgba(255,255,255,0.06)', S, 2.2);
        across(c, x0, w, F, [20, 52], 'rgba(255,255,255,0.05)', S);
        floorFade(c, x0, w, F);
      }
    },
    beach: {
      light: '150,190,255', edge: 'rgba(230,240,255,0.28)',
      sky(g, vw, vh) {
        g.fillStyle = vgrad(g, vh, [[0, '#06101f'], [0.55, '#0a1d36'], [0.85, '#102a46'], [1, EDGE]]); g.fillRect(0, 0, vw, vh);
        starField(g, vw, vh, Math.round(vw * vh / 6000), 0.62, 'beach', 1.3);
        moon(g, vw * 0.7, vh * 0.17, Math.min(vw, vh) * 0.075, '200,220,255');
        glowAt(g, vw / 2, vh * 0.92, vw, this.light, 0.1, 1, 0.3);
        vignette(g, vw, vh, 0.5);
      },
      far: { tw: 760, h: 260, p: 0.2, paint(g, tw, fh) {
        // the sea: a dark band with moonlight glinting on it
        const sea = g.createLinearGradient(0, fh - 70, 0, fh);
        sea.addColorStop(0, '#0d2340'); sea.addColorStop(1, '#081626');
        g.fillStyle = sea; g.fillRect(0, fh - 70, tw, 70);
        g.fillStyle = 'rgba(200,225,255,0.5)'; g.fillRect(0, fh - 70, tw, 1);
        const rng = seeded('sea');
        for (let i = 0; i < 70; i++) { const y = fh - 66 + rng() * 60; g.fillStyle = 'rgba(190,215,255,' + (0.05 + 0.18 * rng()).toFixed(2) + ')'; g.fillRect(rng() * tw, y, 6 + rng() * 22, 1); }
        // palms
        const palm = (x, h, lean) => {
          g.strokeStyle = '#04070d'; g.lineWidth = 6; g.lineCap = 'round';
          g.beginPath(); g.moveTo(x, fh); g.quadraticCurveTo(x + lean * 0.4, fh - h * 0.6, x + lean, fh - h); g.stroke();
          g.fillStyle = '#04070d';
          for (let k = 0; k < 7; k++) {
            const a = -Math.PI / 2 + (k - 3) * 0.5, L = 46 + (k % 2) * 10, tx = x + lean, ty = fh - h;
            g.beginPath(); g.moveTo(tx, ty);
            g.quadraticCurveTo(tx + Math.cos(a) * L * 0.6, ty + Math.sin(a) * L * 0.6 - 14, tx + Math.cos(a) * L, ty + Math.sin(a) * L + 18);
            g.quadraticCurveTo(tx + Math.cos(a) * L * 0.5, ty + Math.sin(a) * L * 0.5 - 4, tx, ty + 3);
            g.fill();
          }
        };
        palm(120, 200, 26); palm(168, 150, -18); palm(520, 220, -30);
      } },
      floor(c, x0, w, F, S) {
        floorBase(c, x0, w, F, this.light, 0.16, 'rgba(40,36,38,0.97)');
        across(c, x0, w, F, [14], 'rgba(255,255,255,0.08)', S / 2.5);
        floorFade(c, x0, w, F);
      }
    },
    neon: {
      light: '255,64,200', edge: 'rgba(255,140,230,0.7)',
      sky(g, vw, vh) {
        g.fillStyle = vgrad(g, vh, [[0, '#08031a'], [0.45, '#170634'], [0.78, '#3a0c4c'], [1, EDGE]]); g.fillRect(0, 0, vw, vh);
        starField(g, vw, vh, Math.round(vw * vh / 9000), 0.55, 'neon');
        // a striped sun low on the horizon
        const r = Math.min(vw, vh) * 0.21, cx = vw / 2, cy = vh * 0.64;
        glowAt(g, cx, cy, r * 2.4, '255,80,170', 0.16);
        g.globalAlpha = 0.72;
        const sg = g.createLinearGradient(0, cy - r, 0, cy + r);
        sg.addColorStop(0, '#ffe08a'); sg.addColorStop(0.5, '#ff8a5a'); sg.addColorStop(1, '#ff3fa3');
        g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
        g.fillStyle = sg; g.fillRect(cx - r, cy - r, r * 2, r * 2);
        g.fillStyle = '#2a0942';
        for (let i = 0; i < 7; i++) { const y = cy + r * (0.05 + i * 0.14), hh = r * (0.02 + i * 0.012); g.fillRect(cx - r, y, r * 2, hh); }
        g.restore(); g.globalAlpha = 1;
        vignette(g, vw, vh, 0.5);
      },
      far: { tw: 680, h: 140, p: 0.14, paint(g, tw, fh) {
        const rng = seeded('mtn'), pts = [[0, fh - 40]];
        for (let x = 30; x < tw; x += 30 + rng() * 40) pts.push([x, fh - 20 - rng() * 90]);
        pts.push([tw, fh - 40]);
        g.beginPath(); g.moveTo(0, fh); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(tw, fh); g.closePath();
        g.fillStyle = '#12051f'; g.fill();
        g.strokeStyle = 'rgba(95,243,255,0.55)'; g.lineWidth = 1.5; g.lineJoin = 'round';
        g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
      } },
      floor(c, x0, w, F, S, mid) {
        floorBase(c, x0, w, F, this.light, 0.34, 'rgba(22,6,34,0.97)');
        recede(c, x0, w, F, mid, 34, 'rgba(255,70,210,0.32)', S, 2.8);
        across(c, x0, w, F, [5, 12, 22, 36, 55, 80], 'rgba(255,70,210,0.28)', S);
        floorFade(c, x0, w, F);
      }
    },
    orbit: {
      light: '90,220,255', edge: 'rgba(150,236,255,0.6)',
      sky(g, vw, vh) {
        g.fillStyle = vgrad(g, vh, [[0, '#03040b'], [0.6, '#060818'], [1, EDGE]]); g.fillRect(0, 0, vw, vh);
        glowAt(g, vw * 0.24, vh * 0.3, Math.max(vw, vh) * 0.42, '140,70,255', 0.16, 1.3, 0.8);
        glowAt(g, vw * 0.82, vh * 0.48, Math.max(vw, vh) * 0.36, '30,200,220', 0.1);
        glowAt(g, vw * 0.6, vh * 0.12, Math.max(vw, vh) * 0.3, '255,60,160', 0.07, 1.4, 0.6);
        starField(g, vw, vh, Math.round(vw * vh / 2600), 0.95, 'orbit', 1.5);
        // a ringed planet
        const r = Math.min(vw, vh) * 0.085, x = vw * 0.8, y = vh * 0.14;
        g.save(); g.translate(x, y); g.rotate(-0.35);
        g.strokeStyle = 'rgba(220,200,255,0.35)'; g.lineWidth = r * 0.12;
        g.beginPath(); g.ellipse(0, 0, r * 1.9, r * 0.42, 0, Math.PI, Math.PI * 2); g.stroke();
        const pg = g.createRadialGradient(-r * 0.4, -r * 0.4, r * 0.1, 0, 0, r);
        pg.addColorStop(0, '#d8c2ff'); pg.addColorStop(0.6, '#7a55d6'); pg.addColorStop(1, '#2a1660');
        g.fillStyle = pg; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(0, 0, r * 1.9, r * 0.42, 0, 0, Math.PI); g.stroke();
        g.restore();
        vignette(g, vw, vh, 0.45);
      },
      far: { tw: 480, h: 70, p: 0.35, paint(g, tw, fh) {
        // the station's railing
        g.fillStyle = 'rgba(120,200,240,0.16)';
        for (let x = 10; x < tw; x += 80) g.fillRect(x, fh - 40, 3, 40);
        g.fillStyle = 'rgba(150,236,255,0.5)'; g.fillRect(0, fh - 42, tw, 2);
        g.fillStyle = 'rgba(150,236,255,0.1)'; g.fillRect(0, fh - 22, tw, 1.5);
      } },
      floor(c, x0, w, F, S, mid) {
        floorBase(c, x0, w, F, this.light, 0.26, 'rgba(18,22,34,0.97)');
        recede(c, x0, w, F, mid, 64, 'rgba(150,230,255,0.08)', S, 2.3);
        across(c, x0, w, F, [26], 'rgba(150,230,255,0.07)', S);
        floorFade(c, x0, w, F);
      }
    }
  };
  const courtArt = () => COURT_ART[eqCourt()];
  const glowRgb = () => courtArt().light;
  function backdrop() {
    if (bgEl) return bgEl;
    const el = document.createElement('canvas'), A = courtArt(), k = A === COURT_ART.arena ? 0.5 : Math.min(1.5, Math.max(1, dpr * 0.75));
    el.width = Math.max(2, Math.round(vw * k)); el.height = Math.max(2, Math.round(vh * k));
    const g = el.getContext('2d');
    g.scale(el.width / vw, el.height / vh);
    A.sky(g, vw, vh, Math.min(vw, VIEW_W * scale));
    return (bgEl = el);
  }
  // the far layer: one tile, cached per court and pixel density, repeated across the view
  const farC = { key: '', el: null };
  function farStrip(A) {
    const k = Math.max(1, Math.round(scale * dpr * 2) / 2), key = eqCourt() + '|' + k;
    if (farC.key === key) return farC.el;
    const el = document.createElement('canvas');
    el.width = Math.ceil(A.far.tw * k); el.height = Math.ceil(A.far.h * k);
    const g = el.getContext('2d'); g.setTransform(k, 0, 0, k, 0, 0);
    A.far.paint(g, A.far.tw, A.far.h);
    farC.key = key; farC.el = el;
    return el;
  }
  function drawFar(c, left, width) {
    const A = courtArt();
    if (A.farDraw) { A.farDraw(c, left, width); return; }
    if (!A.far) return;
    const el = farStrip(A), tw = A.far.tw, base = view.camX * (1 - A.far.p);
    for (let x = base + Math.floor((left - base) / tw) * tw; x < left + width; x += tw) c.drawImage(el, x, W.FLOOR - A.far.h, tw, A.far.h);
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

  // The trail behind the ball (world space), hidden while it burns. Classic is a short soft streak in the flame's
  // colour, Comet a longer bright one with sparks, Rainbow a striped ribbon; Sparkle, Bubbles and Pixel leave
  // particles behind instead (trailFx).
  const trail = [];
  const trailT = () => { const k = eqTrail(); return k === 'comet' ? 0.26 : k === 'rainbow' ? 0.24 : 0.16; };
  function pushTrail(x, y) {
    if (ball.hidden || ball.glide || REDUCED) { trail.length = 0; return; } // no streak while gliding into place
    const lastP = trail[trail.length - 1];
    if (lastP && Math.abs(lastP.x - x) + Math.abs(lastP.y - y) > 80) trail.length = 0; // teleports leave no streak
    trail.push({ x, y, t: view.time });
    const T = trailT();
    while (trail.length > 2 && view.time - trail[0].t > T) trail.shift();
  }
  const RAINBOW = ['255,77,77', '255,160,40', '255,226,60', '70,214,110', '64,150,255', '160,90,255'];
  function drawTrail(c) {
    const kind = eqTrail(), n = trail.length;
    if (kind !== 'classic' && kind !== 'comet' && kind !== 'rainbow') return;
    if (n < 3 || ball.fire > 0.35) return;
    const head = trail[n - 1], tail = trail[0];
    const len = Math.hypot(head.x - tail.x, head.y - tail.y);
    if (len < 6) return;
    const wk = kind === 'classic' ? 0.9 : 0.95, L = [], Rt = [];
    for (let i = 0; i < n; i++) {
      const a = trail[Math.max(0, i - 1)], b = trail[Math.min(n - 1, i + 1)], p = trail[i];
      let dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const w = RV * wk * Math.pow(i / (n - 1), 0.6);
      L.push(p.x - dy * w, p.y + dx * w); Rt.push(p.x + dy * w, p.y - dx * w);
    }
    const fadeIn = Math.min(1, len / 36) * Math.max(0, 1 - ball.fire * 2.5);
    const band = (u0, u1, col, a) => { // the strip between two fractions of the ribbon's width
      c.beginPath();
      for (let i = 0; i < n; i++) { const x = L[2 * i] + (Rt[2 * i] - L[2 * i]) * u0, y = L[2 * i + 1] + (Rt[2 * i + 1] - L[2 * i + 1]) * u0; i ? c.lineTo(x, y) : c.moveTo(x, y); }
      for (let i = n - 1; i >= 0; i--) c.lineTo(L[2 * i] + (Rt[2 * i] - L[2 * i]) * u1, L[2 * i + 1] + (Rt[2 * i + 1] - L[2 * i + 1]) * u1);
      c.closePath();
      const g = c.createLinearGradient(tail.x, tail.y, head.x, head.y);
      g.addColorStop(0, 'rgba(' + col + ',0)'); g.addColorStop(1, 'rgba(' + col + ',' + (a * fadeIn).toFixed(3) + ')');
      c.fillStyle = g; c.fill();
    };
    if (kind === 'rainbow') { for (let k = 0; k < 6; k++) band(k / 6, (k + 1) / 6 + 0.01, RAINBOW[k], 0.5); return; }
    if (kind === 'comet') { band(0, 1, '150,200,255', 0.34); band(0.28, 0.72, '235,246,255', 0.7); return; }
    band(0, 1, eqFlame().trail, 0.26);
  }
  const TFX = { acc: 0, lx: null, ly: null };
  function trailFx(x, y) {
    const kind = eqTrail(), parts0 = kind === 'sparkle' || kind === 'bubbles' || kind === 'pixel' || kind === 'comet';
    if (!parts0 || ball.hidden || ball.glide || REDUCED) { TFX.lx = null; return; }
    if (TFX.lx == null) { TFX.lx = x; TFX.ly = y; return; }
    const d = Math.hypot(x - TFX.lx, y - TFX.ly); TFX.lx = x; TFX.ly = y;
    if (d > 80) return; // a teleport
    TFX.acc += d * Math.max(0, 1 - ball.fire * 1.6);
    const step = kind === 'sparkle' ? 10 : kind === 'bubbles' ? 13 : kind === 'pixel' ? 6 : 15;
    while (TFX.acc >= step) {
      TFX.acc -= step;
      const bx = x - ball.vx * 0.03 + rnd(-3, 3), by = y + rnd(-RV * 0.55, RV * 0.55);
      if (kind === 'sparkle') spawn({ x: bx, y: by, vx: rnd(-18, 18), vy: rnd(-26, 8), life: rnd(0.45, 0.8), max: 0.8, size: rnd(2.4, 4.4), color: Math.random() < 0.3 ? '#ffe08a' : '#ffffff', kind: 9, rot: rnd(0, 1), vr: rnd(-3, 3) });
      else if (kind === 'bubbles') spawn({ x: bx, y: by, vx: rnd(-14, 14), vy: rnd(-55, -20), g: -40, life: rnd(0.6, 1.05), max: 1.05, size: rnd(2.2, 4.8), color: '#c4ecff', kind: 10, drag: 1.5 });
      else if (kind === 'pixel') spawn({ x: Math.round(bx / 4) * 4, y: Math.round(by / 4) * 4, life: rnd(0.28, 0.48), max: 0.48, size: rnd(2.8, 4.2), color: ['#ffe0a8', '#ffab52', '#f27a1c', '#ffffff'][(Math.random() * 4) | 0], kind: 11 });
      else spawn({ x: bx, y: by, vx: rnd(-30, 30) - ball.vx * 0.2, vy: rnd(-30, 30), life: rnd(0.25, 0.45), max: 0.45, size: rnd(0.9, 1.6), color: '#d8ecff', kind: 0, drag: 2 });
    }
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
    flare: 0, flick: 1, // the flame's flare (a flap or a swish fans it) and flicker
    tilt: 0, tiltV: 0,        // whole ball + wings lean: kicks back on a flap, noses down as it falls
    st: 0, stV: 0,            // takeoff stretch (springy)
    sq: 0, sqV: 0, sqX: 0, sqY: -1, // impact squash along the contact normal
    lastRim: -1
  };
  const view = { st: null, offset: 0, prevHoops: [], camX: 0, camY: 0, camV: 0, camT: null, zoom: 1, shake: 0, time: 0, pulse: 0, flash: 0, flashCol: '255,255,255' };
  let phase = 'lobby'; // lobby | ready | play | clearing | checkpoint | over | paused
  let pendingTap = false, acc = 0;
  const run = { mode: 'run', recipe: null, prize: 0, di: 1, bet: 0.1, level: 1, total: 1, streak: 0, best: 0, hoops: 0, swishes: 0, rims: 0, taps: [], seedHash: '', clientSeed: '', nonce: 0, serverSeed: '', levelSeed: '', st: null, busy: false,
    score: 0, cleared: 0, perfect: 0, mov: 0, tilt: 0, fires: 0, novas: 0, lvlSw: 0, newBest: false, prog: null, lost: false };
  const RUN_FRESH = { score: 0, cleared: 0, perfect: 0, mov: 0, tilt: 0, fires: 0, novas: 0, lvlSw: 0, newBest: false, prog: null, lost: false };
  const attract = { st: null, bot: null, wait: 0, level: 1, streak: 0, acc: 0, tap: false };
  // navigation: which tab is open, the page pushed over it (if any), which page Challenges shows (ch), and what the
  // locker's live preview should show (fx: force a flame streak)
  const nav = { tab: 'play', page: null, cat: 'ball', fx: null, cover: false, try: null };
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
    shirt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8.6 3.4c.5 1.9 1.8 3 3.4 3s2.9-1.1 3.4-3l2.8.9c-.4 2.6.1 4.8 1.4 6.4v9.8H4.4v-9.8c1.3-1.6 1.8-3.8 1.4-6.4z"/><path d="M9.6 13.6h4.8"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 2.5h10V4h3.5v2.6a4.6 4.6 0 0 1-4.3 4.6A5.6 5.6 0 0 1 13.2 14v3h3.3v4.5h-9V17h3.3v-3a5.6 5.6 0 0 1-3-2.8 4.6 4.6 0 0 1-4.3-4.6V4H7V2.5Zm10 3.4v3.4a2.6 2.6 0 0 0 1.5-2.4v-1H17ZM7 5.9H5.5v1a2.6 2.6 0 0 0 1.5 2.4V5.9Z"/></svg>',
    flame: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 23c-4.4 0-8-3.1-8-7.5 0-3.3 2-5.6 3.7-7.4.6-.6 1.6-.2 1.6.7 0 1.4.9 2.6 2.1 2.6 1.1 0 1.8-.9 1.8-2.1 0-2.3-1.2-4.2-1.2-6.6 0-.9 1-1.5 1.7-1C17 3.9 20 8.4 20 14.5 20 19.6 16.4 23 12 23Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    medal: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.5 1.5h4l2.2 5-2.1 2.6H9.4L6.5 1.5Zm11 0h-4l-1.3 3 2.1 4.6 3.2-7.6Z" opacity=".55"/><circle cx="12" cy="15.5" r="7"/><path d="M12 11.6l1.15 2.35 2.6.38-1.88 1.83.44 2.59L12 17.53l-2.31 1.22.44-2.59-1.88-1.83 2.6-.38z" fill="#000" opacity=".3"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5l2.4 7.1 7.1 2.4-7.1 2.4L12 20.5l-2.4-7.1L2.5 11l7.1-2.4z"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 10V7.5a5 5 0 0 1 10 0V10h1a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h1Zm2 0h6V7.5a3 3 0 0 0-6 0V10Z"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 2.8a1 1 0 0 1 1 1v.6c1.5-.8 3.3-1 5.2-.2 1.9.8 3.6.7 5.6-.3a.9.9 0 0 1 1.3.8v8.6a1 1 0 0 1-.5.9c-2.4 1.3-4.7 1.4-7 .4-1.6-.7-3.1-.6-4.6.3v6.3a1 1 0 0 1-2 0V3.8a1 1 0 0 1 1-1Z"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 5.5 6.5 6.5L9 18.5"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.2 4.8a2.4 2.4 0 0 1 3.4 3.4L8.4 18.4 4 19.6l1.2-4.4z"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6.5C10.3 5 7.6 4.3 4 4.5v13c3.6-.2 6.3.5 8 2 1.7-1.5 4.4-2.2 8-2v-13c-3.6-.2-6.3.5-8 2Zm0 0v13"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10m6 10V4m6 16v-7m4 7H3"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 5 5.8v5.5c0 4.4 2.9 8.1 7 9.7 4.1-1.6 7-5.3 7-9.7V5.8z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.1"/><path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="6.5" width="17" height="13" rx="2.6"/><path d="M6.5 6.5 15 4a1.6 1.6 0 0 1 2 1.2l.3 1.3"/><path d="M20.5 10.6h-3.6a2.4 2.4 0 0 0 0 4.8h3.6"/></svg>',
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 9.5a4 4 0 0 1 0 5"/><path d="M18.5 7a7.5 7.5 0 0 1 0 10"/></svg>',
    buzz: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="3.5" width="8" height="17" rx="2.2"/><path d="M4.6 9v6M19.4 9v6M2 10.8v2.4M22 10.8v2.4"/></svg>',
    gift: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 11h7v10H5a1 1 0 0 1-1-1zm9 0h7v9a1 1 0 0 1-1 1h-6zM3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v1A1.5 1.5 0 0 1 19.5 10H13V6h-2v4H4.5A1.5 1.5 0 0 1 3 8.5zM8.6 2.6c1.4-.4 2.6.8 3.4 2.9.8-2.1 2-3.3 3.4-2.9 1.6.5 1.6 2.6-.3 3.4H8.9C7 5.2 7 3.1 8.6 2.6Z"/></svg>'
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
    ui.potCap.classList.toggle('prize', run.mode === 'special');
    if (run.mode === 'special') { // the special pays only for clearing every ring: count the rings, show the prize
      const st = run.st;
      ui.mult.textContent = (st ? st.outcomes.length : 0) + '/' + (st ? st.hoops.length : 0);
      ui.pot._cu = (ui.pot._cu || 0) + 1; ui.pot.textContent = fmtSol(run.prize); potShown = run.prize;
      return;
    }
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

  function hideStreak() { clearTimeout(STK.timer); STK.el.classList.remove('on', 'pump', 'broke', 'tuck'); }

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

  // Goals reached during a run (missions, achievements) get a small notice at the bottom the moment
  // they happen. They are awarded when the run ends, whatever happens next, as before.
  // One at a time. A pot notice (money) goes to the front and cuts the current one short; when several goals land
  // together each one shows for less time, so they don't trail on long after the moment.
  const NOTE = { el: $('notice'), q: [], busy: false, timer: 0, cur: null };
  function notice(kind, icon, title, sub, first) {
    const n = { kind, icon, title, sub, first: !!first };
    if (first) NOTE.q.unshift(n); else NOTE.q.push(n);
    if (!NOTE.busy) nextNotice();
    else if (first && NOTE.cur && !NOTE.cur.first) { clearTimeout(NOTE.timer); NOTE.el.classList.remove('show'); NOTE.timer = setTimeout(nextNotice, 260); }
  }
  function nextNotice() {
    const n = NOTE.q.shift(), el = NOTE.el;
    NOTE.cur = n || null;
    if (!n) { NOTE.busy = false; return; }
    NOTE.busy = true;
    el.className = n.kind;
    el.innerHTML = `<span class="ni">${n.icon}</span><span class="nb"><span class="nt">${n.title}</span><span class="ns">${n.sub}</span></span>`;
    void el.offsetWidth; el.classList.add('show');
    Sound.goal(); buzz(8);
    NOTE.timer = setTimeout(() => { el.classList.remove('show'); NOTE.timer = setTimeout(nextNotice, 320); }, n.first ? 2600 : NOTE.q.length ? 1500 : 2200);
  }
  function clearNotices() { NOTE.q.length = 0; clearTimeout(NOTE.timer); NOTE.el.classList.remove('show'); NOTE.busy = false; NOTE.cur = null; }
  // what a daily mission would stand at if the run ended now
  function dailyNow(c, r) { const v = r[c.k] || 0; return Math.min(c.n, c.sum ? c.p + v : Math.max(c.p, v)); }
  // every unfinished mission with where it would stand if the run ended now: daily first, then weekly, then career
  function openMissions(r) {
    const out = [];
    for (const c of dailySet()) if (!c.done) out.push({ id: 'd:' + c.k, kind: 'daily', text: dailyText(c), p: dailyNow(c, r), n: c.n, xp: c.xp, sol: c.reward });
    for (const c of weeklySet()) if (!c.done) out.push({ id: 'w:' + c.k, kind: 'weekly', text: weeklyText(c), p: Math.min(c.n, c.p + (r[c.k] || 0)), n: c.n, xp: c.xp, sol: c.reward });
    const cs = careerState(), C = CAREER[cs.ch];
    if (C) C.m.forEach((m, i) => { if (!cs.done[i]) out.push({ id: 'c:' + cs.ch + ':' + i, kind: 'career', text: careerText(m), p: sumNow(cs.p[i], m[1], r[m[0]] || 0, m[3]), n: m[1], xp: m[2] }); });
    return out;
  }
  const KIND_NAME = { daily: 'Daily mission', weekly: 'Weekly mission', career: 'Career mission' };
  function liveGoals() {
    if (!run.told || phase === 'lobby' || run.mode === 'special') return;
    const pp = potProgress();
    if (pp && pp.done && !run.told.pot) { run.told.pot = 1; potNotice(); }
    const r = runFacts(0);
    const mv = mview(), met = { daily: mv.played.day >= mv.need.day - 1e-9, weekly: mv.played.week >= mv.need.week - 1e-9 };
    for (const m of openMissions(r)) {
      if (run.told[m.id] || m.p < m.n) continue;
      run.told[m.id] = 1; notice('n-' + m.kind, m.kind === 'career' ? ICON.flag : ICON.check, KIND_NAME[m.kind] + ' done', m.text + ' · +' + m.xp + ' XP' + (m.sol && met[m.kind] ? ' · +' + fmtSol(m.sol) + ' SOL' : ''));
    }
    for (const a of ACH) {
      if (profile.ach[a.id] || run.told[a.id] || a.id === 'double' || a.id === 'swish100' || !a.test(r)) continue;
      run.told[a.id] = 1; notice('n-ach', ICON.medal, a.name, a.desc + ' · +' + a.xp + ' XP');
    }
  }
  // the next goal, shown under each level's banner: the pot challenge if you're in it, else the next mission
  function goalLine() {
    if (run.mode === 'special') return '';
    const pl = potLine();
    if (pl) return pl;
    for (const m of openMissions(runFacts(0))) if (!run.told[m.id] && m.p < m.n) return m.text + ' · ' + m.p + '/' + m.n;
    return '';
  }

  function shareText(head) {
    const em = { S: '🏀', F: '🔥', N: '💥', R: '⚪', X: '❌' };
    const url = CFG.shareUrl || (/^https?:/.test(location.protocol) && !/claude|usercontent|localhost/.test(location.host) ? location.origin + location.pathname : 'https://nickrileyh.github.io/sol-dunk/');
    return [run.mode === 'special' ? `SOL DUNK · Special: ${SP.BY[run.recipe].name}` : `SOL DUNK · ${E.DIFFS[run.di].name}`, head, `Score ${run.score} · best streak ${run.best}`, ...(run.log || []).map((lv) => lv.map((o) => em[o]).join('')), url].join('\n');
  }
  async function copyText(t) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(t); return true; } } catch (e) { /* fall back */ }
    try {
      const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', '');
      Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0', userSelect: 'text', webkitUserSelect: 'text' });
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch (e) { return false; }
  }
  async function shareRun() {
    if (!run.share || !armed(ui.res)) return;
    Sound.click();
    if (navigator.share) { try { await navigator.share({ text: run.share }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    toast((await copyText(run.share)) ? 'Run copied. Paste it anywhere to share.' : 'Sharing isn\'t available here.');
  }
  function flash(col, a) { if (REDUCED) return; view.flashCol = col; view.flash = Math.max(view.flash, a); }

  // progress changed: the tab bar's dots follow it (the Profile and Missions tabs show the rest)
  function refreshProfileHud() { syncBadges(); }
  // no run under way: every mission at its saved progress
  const runFacts0 = () => ({});
  function setPips(st) {
    let h = '';
    const n = st ? st.hoops.length : NH;
    for (let i = 0; i < n; i++) {
      const o = st ? st.outcomes[i] : null;
      const now = st && !st.done && i === st.next;
      h += '<span class="seg-i' + (i === n - 1 ? ' cp' : '') + (o ? ' on' + (o === 'S' ? ' sw' : '') : '') + (now ? ' now' : '') + '"></span>';
    }
    ui.pips.innerHTML = h;
    // a special has more rings: thinner segments in about the same width
    ui.pips.style.gridTemplateColumns = n === NH ? '' : 'repeat(' + n + ', ' + Math.max(3, Math.floor((128 - (n - 1) * 2) / n)) + 'px)';
    ui.pips.style.gap = n === NH ? '' : '2px';
    ui.level.textContent = run.mode === 'special' ? SP.BY[run.recipe].name : 'Level ' + run.level;
  }
  function setBalance() {
    ui.bal.textContent = fmtBal(bank.balance());
    ui.balTag.textContent = bank.real ? (CFG.network === 'mainnet-beta' ? '' : 'Devnet') : 'Demo';
  }
  function showPrompt(t, s) { ui.promptT.textContent = t; ui.promptS.textContent = s || ''; ui.prompt.classList.add('show'); }
  function hidePrompt() { ui.prompt.classList.remove('show'); }
  let bannerTimer = 0, bannerUntil = 0;
  function banner(t, s, ms) {
    ui.bannerT.textContent = t; ui.bannerS.textContent = s || '';
    ui.banner.classList.add('show'); clearTimeout(bannerTimer);
    bannerUntil = performance.now() + (ms || 1300) + 350; // until it has faded out
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
  const LADDER = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]; // the bet stepper's steps
  function stepBet(dir) {
    const b = prefs.bet, up = LADDER.find((x) => x > b + 1e-9), down = LADDER.filter((x) => x < b - 1e-9).pop();
    setBet(dir > 0 ? (up != null ? up : b) : (down != null ? down : CFG.minBet));
  }
  function avgClear(di, L) { return PAY.AVG_CLEAR[di][L - 1]; }
  // the most a run can really pay on each tier: every ring a swish through all 8 levels, or the tier's cap if that's lower
  const TOP = PAY.PAYTABLE.map((rows, di) => {
    let m = 1, st = 0;
    for (const t of rows) for (let i = 0; i < NH; i++) { st = Math.min(t.swish.length, st + 1); m *= t.swish[st - 1]; }
    return Math.min(E.DIFFS[di].maxWin, Math.floor(m));
  });
  function buildLobby() {
    const d = $('diffs');
    d.innerHTML = E.DIFFS.map((D, i) => `<button role="radio" id="diff${i}" data-di="${i}" aria-checked="${i === prefs.di}" aria-label="${D.name}, wins up to ${TOP[i]}×">${D.name}</button>`).join('');
    d.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { prefs.di = +b.dataset.di; Sound.click(); refreshLobby(); saveAll(); }));
    $('betDown').addEventListener('click', () => { stepBet(-1); Sound.click(); });
    $('betUp').addEventListener('click', () => { stepBet(1); Sound.click(); });
    const inp = $('betInput');
    inp.addEventListener('input', () => { const v = parseFloat(inp.value.replace(',', '.')); if (v > 0) { prefs.bet = v; refreshLobby(true); } });
    inp.addEventListener('blur', () => { setBet(prefs.bet); });
    inp.addEventListener('focus', () => { try { inp.select(); } catch (e) { /* ignore */ } });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { inp.blur(); startRun(); } });
    $('playBtn').addEventListener('click', () => startRun());
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
    $('diffInfo').innerHTML = `${D.blurb} · Win up to <b>${fmtBet(prefs.bet * TOP[di])} SOL</b>` + (profile.best[di] ? ` <span class="dim">· Best ${profile.best[di]}</span>` : '');
    refreshProfileHud();
    if (!keepInput) $('betInput').value = fmtBet(prefs.bet);
    $('playAmt').textContent = fmtBet(prefs.bet) + ' SOL';
    const short = prefs.bet > bank.balance() + 1e-12, broke = bank.balance() < CFG.minBet;
    const top = Math.min(CFG.maxBet, Math.max(CFG.minBet, bank.balance()));
    $('betDown').disabled = prefs.bet <= CFG.minBet + 1e-9; $('betUp').disabled = prefs.bet >= top - 1e-9;
    $('playBtn').disabled = short;
    const err = $('lobbyErr');
    if (broke && !bank.real) err.innerHTML = 'You\u2019re out of demo SOL. <button class="link" id="quickReset">Reset to ' + CFG.demoStart + ' SOL</button>';
    else err.textContent = short ? 'That bet is more than your balance.' : '';
    const qr = $('quickReset');
    if (qr) qr.addEventListener('click', () => { wallet.balance = CFG.demoStart; saveAll(); setBet(Math.min(prefs.bet, CFG.demoStart)); toast('Demo balance reset to ' + CFG.demoStart + ' SOL'); });
    setBalance();
  }

  // ---------------------------------------------------------------- challenge pot: lobby row, sheet, run progress
  let potState = null, potBusy = false;
  async function refreshPot() {
    if (potBusy) return;
    potBusy = true;
    try { potState = await bank.pot.state(); } catch (e) { potState = potState || null; }
    potBusy = false;
    renderPotRow();
    // a pot you were in has closed since you last looked: say how it went
    const L = potState && potState.last;
    if (L && L.me && prefs.potSeen !== L.key) {
      prefs.potSeen = L.key; saveAll();
      if (L.me.won > 0) { toast('Pot closed: you won ' + fmtSol(L.me.won) + ' SOL'); Sound.cash(); setBalance(); }
      else toast('Pot closed: ' + L.winners + ' of ' + L.entrants + ' made it');
    }
  }
  const leftText = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };
  // the pot's card on the Challenges tab and its page, kept current while they're open
  function renderPotRow() {
    if (phase !== 'lobby') return;
    if (nav.page === 'pot') renderPage(true);
    if (nav.tab === 'challenges') renderChallenges(true);
  }
  // where the run stands on the pot challenge (null if you're not in it, it's done, or this tier doesn't count)
  function potLevels() {
    return (run.log || []).map((lv, i, a) => ({ outcomes: lv.filter((o) => o !== 'X').map((o) => (o === 'R' ? 'R' : 'S')).join(''), clear: i < a.length - 1 }));
  }
  function potProgress() {
    const p = potState;
    if (!p || !p.me || !p.me.entered || p.me.done || !run.log) return null;
    return POTS.progress(p.goal.id, potLevels(), run.di);
  }
  function potLine() {
    const p = potState;
    if (!p || !p.me || !p.me.entered || p.me.done) return '';
    if (run.di < p.goal.tier) return 'The pot challenge counts ' + p.goal.sub;
    const pr = potProgress();
    return pr ? 'Pot · ' + p.goal.text + ' · ' + pr.value + '/' + pr.target : '';
  }
  function potNotice() { notice('n-pot', ICON.trophy, 'Pot challenge done', 'You’re in for a share of the pot' + (potState ? ' · ' + fmtBal(potState.pool) + ' SOL' : ''), true); }
  // a level the bank verified: the official word on the pot
  function potResult(note) {
    if (!note || !potState || !potState.me) return;
    if (note.value > (potState.me.best || 0)) potState.me.best = note.value;
    if (note.done) potState.me.done = true;
    if (note.just) { run.potJust = true; if (!run.told.pot) { run.told.pot = 1; potNotice(); } }
  }
  function potHtml() {
    const p = potState;
    if (!p) return '<p>The pot isn’t available right now. Try again in a moment.</p>';
    const inn = !!(p.me && p.me.entered), done = !!(p.me && p.me.done), left = p.closesAt - Date.now();
    const each = p.completed ? p.pool / p.completed : 0;
    let me;
    if (done) me = `<div class="pot-me done">${ICON.check}<div><b>You made it</b><span>You’ll split the pot with everyone else who does. If it closed now: ${fmtSol(each)} SOL each.</span></div></div>`;
    else if (inn) me = `<div class="pot-me">${ICON.target}<div><b>You’re in</b><span>Make it in any run ${p.goal.sub} before the pot closes.${p.me.best ? ' Best so far: ' + p.me.best + ' / ' + p.goal.n + '.' : ''}</span></div></div>`;
    else me = `<button class="btn btn-go" id="potEnter">Enter for ${fmtBet(p.fee)} SOL</button><div class="err" id="potErr" role="alert"></div>`;
    const L = p.last;
    const last = L ? `<div class="pot-last"><span class="k">Last pot</span><span>${L.goal} · ${L.winners ? L.winners + ' of ' + L.entrants + ' made it · ' + fmtSol(L.share) + ' SOL each' : 'nobody made it · ' + fmtSol(L.rolled) + ' SOL rolled over'}${L.me ? (L.me.won > 0 ? ' · <b class="won">you won ' + fmtSol(L.me.won) + ' SOL</b>' : ' · you didn’t make it') : ''}</span></div>` : '';
    return `<div class="pot-goal"><span class="pot-ic">${ICON.trophy}</span><div><b>${p.goal.text}</b><span>In one run ${p.goal.sub}</span></div></div>
      <div class="big pot-big"><span class="num">${fmtBal(p.pool)}</span><span class="unit">SOL</span></div>
      <div class="tiles"><div><b>${p.entrants}</b><span>Entered</span></div><div><b>${p.completed}</b><span>Made it</span></div><div><b class="sm">${left > 0 ? leftText(left) : 'Closing'}</b><span>Left</span></div></div>
      ${me}
      <p class="pot-rules">Everyone who completes the challenge before the pot closes (midnight UTC) splits it equally. The house keeps ${Math.round(p.rake * 100)}% of each entry; if nobody makes it, the pot rolls over to the next one. Only runs you start after entering count, and your runs are bets as usual.${p.carryIn > 0 ? ' This pot includes ' + fmtSol(p.carryIn) + ' SOL rolled over.' : ''}</p>
      ${last}
      ${p.simulated ? `<div class="pot-demo"><p>Demo: the other entrants are simulated, from how often players at different skill levels make the challenge.</p><button class="btn btn-plain" id="potClose">Close this pot now</button></div>` : ''}`;
  }

  // ---------------------------------------------------------------- Challenges tab: today's special, the daily pot and the missions
  // One short page: a card for each challenge with its name, prize and button (the details are on its page, a tap
  // away), then today's missions, with this week's and the career a tap away.
  let specState = null, specBusy = false;
  async function refreshSpecial() {
    if (specBusy) return;
    specBusy = true;
    try { specState = await bank.special.state(); } catch (e) { specState = specState || null; }
    specBusy = false;
    syncBadges();
    if (phase === 'lobby') { if (nav.page === 'special') renderPage(true); if (nav.tab === 'challenges') renderChallenges(true); }
  }
  const oneIn = (p) => (p > 0 ? 'about 1 in ' + Math.max(1, Math.round(1 / p)) : '–');
  function specialHtml() {
    const s = specState;
    if (!s) return '<div class="empty">The special level isn’t available right now. Try again in a moment.</div>';
    const left = s.closesAt - Date.now(), o = s.odds || [], back = (p) => Math.round((p || 0) * s.x * 100);
    const play = s.me.blocked ? '<div class="empty">The special level isn’t available on this account.</div>'
      : `<button class="btn btn-go" id="spPlay">Play for ${fmtBet(s.fee)} SOL</button><div class="err" id="spErr" role="alert"></div>`;
    return `<div class="sp-card">
        <div class="sp-head"><div class="sp-name">${s.recipe.name}</div><div class="sp-blurb">${s.recipe.blurb} · ${s.recipe.rings} rings</div></div>
        <canvas class="sp-course" id="spCourse" aria-hidden="true"></canvas>
        <div class="sp-cap">A sample course. Every attempt gets a new one from its own seed.</div>
      </div>
      <div class="sp-prize"><span class="k">Clear every ring to win</span><div class="big"><span class="num">${fmtSol(s.prize)}</span><span class="unit">SOL</span></div><span class="x">${s.x.toFixed(2)}× your ${fmtBet(s.fee)} SOL entry</span></div>
      ${play}
      <div class="tiles"><div><b>${s.me.tries}</b><span>Tries today</span></div><div><b>${s.me.wins}</b><span>Wins today</span></div><div><b class="sm">${left > 0 ? leftText(left) : 'Soon'}</b><span>Next special</span></div></div>
      <div class="sec-h"><h3>How often it’s beaten</h3></div>
      <div class="group sp-odds">${[['A casual player', o[0]], ['An average player', o[1]], ['A strong player', o[2]]].map(([k, p]) => `<div class="row"><span>${k}</span><b>${oneIn(p)}</b></div>`).join('')}</div>
      <p class="pot-rules">Miss any ring and the entry is gone; clear them all and the prize is paid at once. From the simulator: a strong player gets back about ${back(o[2])}% of their entries over time, an average one about ${back(o[1])}%. A new special comes every day at midnight UTC. Its rings don’t count toward missions or the pot, but the entry counts as play for mission SOL.</p>`;
  }
  // a sketch of a course: the rings in order, how far each one bobs, and the gold finish
  function drawCourse(el, def) {
    const k = Math.min(window.devicePixelRatio || 1, 2), w = el.clientWidth || 340, ht = el.clientHeight || 118;
    el.width = Math.round(w * k); el.height = Math.round(ht * k);
    const g = el.getContext('2d'); g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, w, ht);
    const hs = def.hoops, x0 = -30, x1 = hs[hs.length - 1].x + 50, pad = 16, yT = E.Y_MIN - 70, yB = E.Y_MAX + 70;
    const sx = (x) => pad + (x - x0) / (x1 - x0) * (w - pad * 2), sy = (y) => 8 + (y - yT) / (yB - yT) * (ht - 16);
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 1.4; g.setLineDash([2, 5]);
    g.beginPath(); g.moveTo(sx(0), sy(def.startY)); for (const h of hs) g.lineTo(sx(h.x), sy(h.y0)); g.stroke(); g.setLineDash([]);
    const half = Math.max(5, Math.min(9, (w - pad * 2) / hs.length * 0.32));
    for (const h of hs) {
      const cx = sx(h.x), cy = sy(h.y0);
      if (h.amp) { g.strokeStyle = 'rgba(255,255,255,0.13)'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, sy(h.y0 - h.amp)); g.lineTo(cx, sy(h.y0 + h.amp)); g.stroke(); }
      const a = h.tilt * 1.8, dx = Math.cos(a) * half, dy = Math.sin(a) * half, col = h.cp ? '#f5c542' : 'rgba(236,240,250,0.92)';
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(cx - dx, cy - dy); g.lineTo(cx + dx, cy + dy); g.stroke();
      for (const sg of [-1, 1]) { g.beginPath(); g.arc(cx + sg * dx, cy + sg * dy, 2.1, 0, Math.PI * 2); g.fill(); }
    }
    g.fillStyle = '#ff8a2a'; g.beginPath(); g.arc(sx(0), sy(def.startY), 4.2, 0, Math.PI * 2); g.fill();
  }
  function specialCard() {
    const s = specState;
    if (!s) return '';
    const act = s.me.blocked ? '<span class="pill off">Not available</span>' : `<button class="pill" id="chSpPlay">Play ${fmtBet(s.fee)}</button>`;
    return `<div class="cc"><button class="cc-open" data-page="special" aria-label="Today’s special: ${s.recipe.name}. Details"><span class="cc-k">Today’s special</span><span class="cc-n">${s.recipe.name}</span><span class="cc-s">${s.recipe.blurb} · ${s.recipe.rings} rings</span><span class="chev">${ICON.chev}</span></button>
      <div class="cc-act"><span class="cc-v">Win <b class="num">${fmtSol(s.prize)}</b> SOL</span>${act}</div></div>`;
  }
  function potCard() {
    const p = potState;
    if (!p) return '';
    const inn = !!(p.me && p.me.entered), done = !!(p.me && p.me.done);
    const act = done ? '<span class="pill ok">Made it</span>' : inn ? '<span class="pill in">You’re in</span>' : `<button class="pill" id="chPotEnter">Enter ${fmtBet(p.fee)}</button>`;
    return `<div class="cc"><button class="cc-open" data-page="pot" aria-label="Daily pot: ${p.goal.text}. Details"><span class="cc-k">Daily pot</span><span class="cc-n">${p.goal.text}</span><span class="cc-s">In one run ${p.goal.sub}</span><span class="chev">${ICON.chev}</span></button>
      <div class="cc-act"><span class="cc-v"><b class="num gold">${fmtBal(p.pool)}</b> SOL pot · ${p.entrants} in</span>${act}</div></div>`;
  }
  function renderChallenges(keep) {
    const body = $('cBody'), y = body.scrollTop;
    body.innerHTML = `<div class="vcol"><h2 class="vtitle">Challenges</h2>${specialCard()}${potCard()}${missionsHtml()}</div>`;
    if (keep) body.scrollTop = y;
    wireChallenges();
    if (specState && prefs.specSeen !== specState.day) { prefs.specSeen = specState.day; saveAll(); syncBadges(); }
  }
  async function enterPot(e) {
    const b = e.currentTarget; b.disabled = true;
    try { potState = await bank.pot.enter(); setBalance(); Sound.click(); buzz(8); toast('You’re in. Make it in any run ' + potState.goal.sub + '.'); renderPotRow(); }
    catch (err) { const el = nav.page === 'pot' ? $('potErr') : null; if (el) el.textContent = err.message; else toast(err.message); b.disabled = false; }
  }
  function wireChallenges() {
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    on('chSpPlay', () => startSpecial());
    on('chPotEnter', enterPot);
  }

  // ---------------------------------------------------------------- run flow
  async function startRun() {
    if (run.busy || (phase !== 'lobby' && phase !== 'over')) return;
    Sound.unlock();
    const bet = prefs.bet;
    run.busy = true;
    let r;
    try {
      r = await bank.start(prefs.di, bet);
      Object.assign(run, { mode: 'run', recipe: null, prize: 0, di: prefs.di, bet, level: 1, total: 1, streak: 0, best: 0, hoops: 0, swishes: 0, rims: 0, seedHash: r.seedHash, clientSeed: r.clientSeed, nonce: r.nonce, serverSeed: '', levelSeed: r.levelSeed }, RUN_FRESH);
      run.log = []; run.told = {}; run.share = ''; run.potJust = false; // every ring of the run, and the goals already announced
      $('lobbyErr').textContent = '';
    } catch (e) {
      $('lobbyErr').textContent = e.message; run.busy = false;
      if (ui.lobby.classList.contains('hide')) { toast(e.message); backToLobby(); }
      return;
    }
    run.busy = false;
    stats.runs++; stats.wagered = round9(stats.wagered + bet); saveAll();
    enterRun(r.missions);
  }
  // a special level attempt: the entry up front, one long level, the prize for clearing every ring
  async function startSpecial() {
    if (run.busy || (phase !== 'lobby' && phase !== 'over')) return;
    Sound.unlock();
    run.busy = true;
    let r;
    try {
      r = await bank.special.start();
      Object.assign(run, { mode: 'special', recipe: r.recipe, prize: r.prize, di: SP.BY[r.recipe].base[0], bet: r.fee, level: 1, total: 1, streak: 0, best: 0, hoops: 0, swishes: 0, rims: 0, seedHash: r.seedHash, clientSeed: r.clientSeed, nonce: r.nonce, serverSeed: '', levelSeed: r.seed }, RUN_FRESH);
      run.log = []; run.told = {}; run.share = ''; run.potJust = false;
      if (r.special) specState = r.special;
    } catch (e) {
      run.busy = false;
      const el = nav.page === 'special' ? $('spErr') : null;
      if (el && phase === 'lobby') el.textContent = e.message; else toast(e.message);
      if (phase === 'over') { backToLobby(); setTab('challenges'); }
      return;
    }
    run.busy = false;
    stats.runs++; stats.wagered = round9(stats.wagered + run.bet); saveAll();
    enterRun(r.missions);
  }
  function enterRun(missions) {
    closePage(true); endTry(); show(ui.lobby, false); show(vL, false); show(vP, false); show(vC, false); show(ui.res, false); show(ui.cp, false); nav.cover = false;
    ball.lastVis = 0; // a new run lets the old flame die down quietly
    setHudMode(true); setBalance();
    clearCallouts(); clearNotices(); potShown = run.bet; setStreakHud();
    beginLevel(true);
    paidNote(missions);
  }
  // mission SOL that a bet has just unlocked
  function paidNote(m) {
    const sum = m && m.paid ? m.paid.reduce((a, p) => a + p.amount, 0) : 0;
    if (sum > 0) { notice('n-pot', ICON.gift, 'Mission rewards', '+' + fmtSol(sum) + ' SOL paid to your balance', true); setBalance(); }
  }

  function beginLevel(first) {
    const sp = run.mode === 'special';
    const def = sp ? SP.generate(run.levelSeed, run.recipe) : E.generateLevel(run.levelSeed, run.di, run.level);
    const prev = view.st;
    view.prevHoops = keepBehind(prev);
    view.offset = first && prev ? ball.x + 140 : ball.x + 24;
    run.st = E.createState(def); view.st = run.st; run.taps = []; run.lvlStart = run.total;
    if (autoBot) autoBot = BOT.createBot(autoBot.p, E.makeRng('auto' + Math.random()));
    settleOffset();
    ball.glide = { fx: ball.x, fy: ball.y, tx: view.offset, ty: def.startY, t: 0, d: 0.45 };
    ball.fall = null; ball.hidden = false;
    phase = 'ready';
    run.lvlSw = 0; run.log.push([]);
    if (!sp) profile.lv[run.di][run.level - 1][0]++;
    setPips(run.st); setPot(); setStreakHud(); setHeat(run.streak);
    if (run.level > 1) { banner('Level ' + run.level, goalLine(), 1400); liveGoals(); }
    showPrompt(run.level === 1 ? 'Tap to fly' : 'Tap to go', sp ? 'Clear all ' + def.hoops.length + ' rings to win ' + fmtSol(run.prize) + ' SOL' : run.level === 1 ? (newPlayer() ? 'Drop down through each ring' : potLine()) : '');
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
    if (run.streak === 3) run.fires++; else if (run.streak === 5) run.novas++;
    const sp = run.mode === 'special';
    const m = sp ? 1 : E.hoopMultiplier(PAY.PAYTABLE[run.di][run.level - 1], o, run.streak);
    const cap = E.DIFFS[run.di].maxWin;
    let capped = false;
    if (!sp) { run.total = run.total * m; if (run.total >= cap) { run.total = cap; capped = true; } }
    const pts = ringPoints(o, run.streak);
    run.log[run.log.length - 1].push(o === 'S' ? (run.streak >= 5 ? 'N' : run.streak >= 3 ? 'F' : 'S') : 'R');
    scoreFx(o, h, st, m, run.streak, pts);
    view.pulse = 1;
    setPot(true); setPips(st); setHeat(run.streak); bumpScore();
    if (o === 'S') {
      setStreakHud('pump');
      const s = run.streak;
      if (s === 3) { callout('ON FIRE', 'Swish streak ×3', 'fire'); flash(heatRgb(0), 0.1); buzz([10, 25, 14]); Sound.cheer(0.25); }
      else if (s === 5) { callout('SUPERNOVA', 'Max streak bonus', 'nova'); flash(heatRgb(1), 0.13); buzz([12, 25, 12, 25, 18]); Sound.cheer(0.55); }
      else if (s >= 10 && s % 5 === 0) { callout(s === 10 ? 'UNSTOPPABLE' : s + ' IN A ROW', s + ' swishes in a row', 'nova'); flash(heatRgb(1), 0.14); Sound.cheer(0.85); }
    } else if (was > 1) setStreakHud('broke'); // a 2+ streak was burning: douse() plays the hiss
    addPoints(pts);
    if (capped) { endWin('maxwin'); return true; }
    liveGoals();
    return false;
  }
  function addPoints(n) {
    run.score += n;
    const b = profile.best[run.di];
    if (!run.newBest && b > 0 && run.score > b) {
      run.newBest = true;
      callout('NEW BEST', 'Beat your best of ' + b, 'gold'); Sound.best(); Sound.cheer(0.4); buzz([8, 30, 8]);
    }
  }

  function onClear() {
    phase = 'clearing';
    run.cleared++;
    if (run.mode === 'special') { specialFinish(true); return; }
    profile.lv[run.di][run.level - 1][1]++;
    if (!REDUCED) view.shake = Math.max(view.shake, 2);
    confetti(ball.x, ball.y - 30, 56);
    Sound.checkpoint(); buzz([12, 40, 12]);
    if (run.lvlSw === NH) {
      run.perfect++;
      callout('PERFECT LEVEL', `${NH} of ${NH} swishes · +${PERFECT_BONUS}`, 'gold');
      flash('255,214,10', 0.14); Sound.perfect(); Sound.applause(0.45); confetti(ball.x, ball.y - 30, 40);
      addPoints(PERFECT_BONUS); view.pulse = 1;
    }
    if (run.level < NL) liveGoals();
    ball.glide = null;
    ball.fall = { vx: Math.max(120, run.st.ball.vx), vy: -240, hover: true, t: 0 };
    if (run.level >= NL) { endWin('final'); return; }
    const L = run.level;
    bank.level(L, run.taps.slice()).then((r) => {
      if (r.status !== 'checkpoint' || Math.abs(r.total - run.total) > 1e-9) return verifyFail();
      potResult(r.pot);
      setTimeout(() => showCheckpoint(), REDUCED ? 100 : CALL.busy ? 900 : 450);
    }).catch(netFail);
  }

  const BUST_TITLES = { rimout: 'Rimmed out', over: 'Over the rim', under: 'Under the rim', floor: 'Hit the floor', timeout: 'Out of time' };
  function onBust(kind, h) {
    phase = 'over';
    run.lost = true; setHeat(0); // the flame goes out with the run
    clearCallouts(); clearNotices();
    if (run.log && run.log.length) run.log[run.log.length - 1].push('X');
    if (run.streak > 1) setStreakHud('broke');
    const lostPot = run.bet * run.total;
    if (h) hoopVis(h).flash = -1;
    ball.fall = { vx: run.st.ball.vx * 0.6, vy: Math.min(run.st.ball.vy, 200), hover: false, t: 0 };
    if (!REDUCED) view.shake = 6;
    Sound.bust(); buzz([30, 60, 50]);
    if (run.mode === 'special') { specialFinish(false, kind); return; }
    const L = run.level, taps = run.taps.slice();
    bank.level(L, taps).then((r) => {
      if (r.status !== 'bust') return verifyFail();
      potResult(r.pot);
      run.serverSeed = r.serverSeed || '';
      record(0, 'bust', r.missions);
      setTimeout(() => showResult(BUST_TITLES[kind] || 'Missed', '−' + fmtBet(run.bet), 'loss', `Lost a ${fmtSol(lostPot)} SOL pot on level ${L}`), REDUCED ? 200 : 650);
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
      hideStreak(); clearNotices();
      winFx(1);
      record(r.payout, 'cashout', r.missions);
      show(ui.cp, false);
      showResult('Cashed out', '+' + fmtSol(r.payout - run.bet), 'win', `${fmtSol(r.payout)} SOL · ${fmtMult(run.total)} after level ${run.level}`, r.payout - run.bet);
    } catch (e) { run.busy = false; netFail(e); }
  }

  function endWin(kind) {
    phase = 'over';
    clearCallouts(); clearNotices(); hideStreak();
    const L = run.level;
    bank.level(L, run.taps.slice()).then((r) => {
      if (r.status !== kind || Math.abs(r.total - run.total) > 1e-9) return verifyFail();
      potResult(r.pot);
      run.serverSeed = r.serverSeed || '';
      winFx(kind === 'maxwin' ? 1.6 : 1.3);
      record(r.payout, kind, r.missions);
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

  // the special level is over: the bank replays the taps and says whether it was cleared
  function specialFinish(won, kind) {
    phase = 'over';
    clearCallouts(); clearNotices();
    if (won) {
      hideStreak();
      if (!REDUCED) view.shake = Math.max(view.shake, 2);
      confetti(ball.x, ball.y - 30, 56); Sound.checkpoint(); buzz([12, 40, 12]);
      ball.glide = null; ball.fall = { vx: Math.max(120, run.st.ball.vx), vy: -240, hover: true, t: 0 };
    }
    const R = SP.BY[run.recipe], n = run.st.hoops.length, at = Math.min(n, run.hoops + 1);
    bank.special.finish(run.taps.slice()).then((r) => {
      if (r.status !== (won ? 'won' : 'lost')) return verifyFail();
      if (r.special) specState = r.special;
      run.serverSeed = r.serverSeed || '';
      recordSpecial(r.payout, won);
      if (won) { winFx(1.4); setTimeout(() => showResult('Special cleared', '+' + fmtSol(r.payout - run.bet), 'win', `${R.name} · all ${n} rings · ${fmtSol(r.payout)} SOL`, r.payout - run.bet), 700); }
      else setTimeout(() => showResult(BUST_TITLES[kind] || 'Missed', '−' + fmtBet(run.bet), 'loss', `${R.name} · out at ring ${at} of ${n}`), REDUCED ? 200 : 650);
    }).catch(netFail);
  }
  function recordSpecial(payout, won) {
    stats.returned = round9(stats.returned + payout);
    stats.hoops += run.hoops; stats.swishes += run.swishes;
    stats.history.unshift({ t: Date.now(), kind: 'special', recipe: run.recipe, di: run.di, bet: run.bet, payout, level: 1, mult: won ? run.prize / run.bet : 0, result: won ? 'won' : 'lost', seedHash: run.seedHash, serverSeed: run.serverSeed, clientSeed: run.clientSeed, nonce: run.nonce });
    stats.history.length = Math.min(stats.history.length, 30);
    // XP for the points; the special doesn't count toward missions, trophies or the pot
    const before = lvlOf(profile.xp), xp = run.score + (won ? 25 : 0);
    profile.tot.swish += run.swishes; profile.xp += xp;
    run.prog = { xp, runXp: xp, before, after: lvlOf(profile.xp), newBest: false, prevBest: 0, achs: [], dailies: [], weeklies: [], careers: [], chapter: null, unlocks: grantUnlocks(), paid: [] };
    saveAll(); setBalance();
  }
  function record(payout, result, missions) {
    stats.returned = round9(stats.returned + payout);
    stats.hoops += run.hoops; stats.swishes += run.swishes;
    stats.deepest = Math.max(stats.deepest, run.level);
    if (payout > 0) stats.best = Math.max(stats.best, run.total);
    stats.history.unshift({ t: Date.now(), di: run.di, bet: run.bet, payout, level: run.level, mult: payout > 0 ? run.total : 0, result, seedHash: run.seedHash, serverSeed: run.serverSeed, clientSeed: run.clientSeed, nonce: run.nonce });
    stats.history.length = Math.min(stats.history.length, 30);
    run.prog = progress(payout, missions);
    saveAll(); setBalance();
  }

  // What the run earned outside the bet: personal best, XP, achievements, missions, unlocks.
  function runFacts(payout) {
    return { di: run.di, score: run.score, points: run.score, swish: run.swishes, best: run.best, perfect: run.perfect,
      clears: run.cleared, level: run.level, mov: run.mov, tilt: run.tilt, fires: run.fires, novas: run.novas, paid: payout > 0, total: run.total };
  }
  function progress(payout, mres) {
    const r = runFacts(payout), di = run.di, before = lvlOf(profile.xp);
    const prevBest = profile.best[di], newBest = run.score > prevBest;
    if (newBest) profile.best[di] = run.score;
    profile.deep[di] = Math.max(profile.deep[di], run.level);
    profile.tot.swish += run.swishes; profile.tot.perfect += run.perfect;
    const runXp = run.score + run.cleared * 5 + run.perfect * 15;
    let xp = runXp;
    const achs = ACH.filter((a) => !profile.ach[a.id] && a.test(r));
    for (const a of achs) { profile.ach[a.id] = Date.now(); xp += a.xp; }
    const dailies = [], weeklies = [], careers = [];
    // daily and weekly missions: the bank moved them on with this run's verified levels and says what it finished
    const mv = mview();
    for (const d of (mres && mres.done) || []) {
      const c = (d.win === 'day' ? mv.daily : mv.weekly)[d.slot];
      if (!c || c.k !== d.k) continue;
      (d.win === 'day' ? dailies : weeklies).push(c); xp += d.xp;
    }
    // career: the current chapter's missions; finishing all four opens the next chapter and its reward
    const cs = careerState(), C = CAREER[cs.ch];
    let chapter = null;
    if (C) {
      C.m.forEach((m, i) => {
        if (cs.done[i]) return;
        cs.p[i] = sumNow(cs.p[i], m[1], r[m[0]] || 0, m[3]);
        if (cs.p[i] >= m[1]) { cs.done[i] = true; careers.push(m); xp += m[2]; }
      });
      if (cs.done.every(Boolean)) { chapter = cs.ch; cs.ch++; cs.p = [0, 0, 0, 0]; cs.done = [false, false, false, false]; }
    }
    profile.mNew += dailies.length + weeklies.length + careers.length;
    profile.xp += xp;
    const unlocks = grantUnlocks();
    return { xp, runXp, before, after: lvlOf(profile.xp), newBest, prevBest, achs, dailies, weeklies, careers, chapter, unlocks, paid: (mres && mres.paid) || [] };
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
    show(ui.cp, true); armCard(ui.cp, 600); STK.el.classList.add('tuck');
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
    Sound.click(); show(ui.cp, false); STK.el.classList.remove('tuck');
    run.level++;
    beginLevel(false);
  }

  function showResult(title, amount, cls, sub, rollTo) {
    const pr = run.prog, nb = !!(pr && pr.newBest && run.score > 0);
    $('resTitle').textContent = title;
    if (rollTo != null) countUp($('resNum'), 0, rollTo, (x) => '+' + fmtSol(x), 800); else { $('resNum')._cu = ($('resNum')._cu || 0) + 1; $('resNum').textContent = amount; }
    $('resAmount').className = 'big ' + cls;
    $('resSub').textContent = sub;
    const sp = run.mode === 'special';
    run.share = shareText(sp ? (cls === 'win' ? 'Cleared it' : title + ' at ring ' + Math.min(run.st ? run.st.hoops.length : 0, run.hoops + 1)) : cls === 'win' ? title + ' at ' + fmtMult(run.total) : title + ' on level ' + run.level);
    $('resStats').innerHTML = [[run.score, nb ? 'New best' : 'Score', nb], [run.hoops, 'Rings'], [run.best, 'Best streak']]
      .map(([v, k, hi]) => `<div${hi ? ' class="hi"' : ''}><b>${v}</b><span>${k}</span></div>`).join('');
    $('againT').textContent = sp ? 'Try again' : 'Play again';
    $('againAmt').textContent = fmtBet(sp ? run.bet : prefs.bet) + ' SOL';
    $('lobbyBtn').textContent = sp ? 'Back' : 'Change bet';
    showProgress(pr);
    show(ui.res, true); armCard(ui.res, 600); refreshPot(); if (sp) refreshSpecial();
    setTimeout(() => ui.res.focus({ preventScroll: true }), 60);
    refreshLobby();
  }
  function gainChip(cls, icon, text, i) { return `<span class="gain ${cls}" style="animation-delay:${(0.35 + i * 0.09).toFixed(2)}s">${icon}<span>${text}</span></span>`; }
  // a new ball, wing or flame: its picture, and one tap to use it
  function unlockChip(u, i) {
    const on = profile.eq[u.t] === u.id;
    return `<button class="gain unlock${on ? ' on' : ''}" data-t="${u.t}" data-id="${u.id}" style="animation-delay:${(0.35 + i * 0.09).toFixed(2)}s" aria-label="Use the new ${itemName(u)}"><canvas width="48" height="48"></canvas><span>New ${itemName(u)}</span><em>${on ? 'In use' : 'Use'}</em></button>`;
  }
  function wireUnlockChips() {
    document.querySelectorAll('#resGains .gain.unlock').forEach((b) => {
      const t = b.dataset.t, id = b.dataset.id;
      drawThumb(b.querySelector('canvas'), t, id);
      b.addEventListener('click', () => {
        if (!armed(ui.res)) return;
        profile.eq[t] = id; saveAll(); Sound.click(); buzz(8);
        if (t === 'flame') applyFlameTheme();
        if (t === 'court') bgEl = null;
        profile.fresh = profile.fresh.filter((k) => k !== t + ':' + id); syncBadges();
        document.querySelectorAll(`#resGains .gain.unlock[data-t="${t}"]`).forEach((x) => { const on = x.dataset.id === id; x.classList.toggle('on', on); x.querySelector('em').textContent = on ? 'In use' : 'Use'; });
      });
    });
  }
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
    if (run.potJust && potState) g.push(['pot', ICON.trophy, 'Pot challenge done · in for a share']);
    const paid = (pr.paid || []).reduce((a, p) => a + p.amount, 0);
    if (paid > 0) g.push(['pot', ICON.gift, 'Mission rewards · +' + fmtSol(paid) + ' SOL']);
    // mission SOL earned but waiting for the window's play: say how much more unlocks it
    if (run.mode !== 'special' && (pr.dailies.length || pr.weeklies.length)) {
      const mv = mview();
      for (const [list, win, when] of [[mv.daily, 'day', 'today'], [mv.weekly, 'week', 'this week']]) {
        const wait = list.filter((c) => c.done && !c.paid).reduce((a, c) => a + c.reward, 0), more = mv.need[win] - mv.played[win];
        if (wait > 0 && more > 0) g.push(['', ICON.gift, `${fmtBet(wait)} SOL waiting · play ${fmtBet(Math.ceil(more * 100) / 100)} more SOL ${when}`]);
      }
    }
    pr.unlocks.forEach((u) => g.push(['unlock', '', 'New ' + itemName(u), u]));
    pr.achs.forEach((x) => g.push(['ach', ICON.medal, x.name + ' · +' + x.xp + ' XP']));
    if (pr.chapter != null) g.push(['ach', ICON.flag, 'Chapter ' + (pr.chapter + 1) + ' done · ' + CAREER[pr.chapter].name]);
    pr.dailies.forEach((c) => g.push(['daily', ICON.check, dailyText(c) + ' · +' + c.xp + ' XP']));
    pr.weeklies.forEach((c) => g.push(['daily', ICON.check, weeklyText(c) + ' · +' + c.xp + ' XP']));
    pr.careers.forEach((m) => g.push(['daily', ICON.flag, careerText(m) + ' · +' + m[2] + ' XP']));
    if (!g.length && run.mode === 'special' && specState) g.push(['', ICON.trophy, `${specState.recipe.name} today: ${specState.me.wins} of ${specState.me.tries} cleared`]);
    else if (!g.length) { // nothing new this run: show the next mission, so there's always a goal
      const m = openMissions(runFacts0())[0];
      if (m) g.push(['', ICON.target, `${m.text} · ${m.p}/${m.n}`]);
    }
    const room = (vh < 720 ? 3 : 4) - (pr.unlocks.length ? 1 : 0), more = g.length > room ? g.length - (room - 1) : 0;
    $('resGains').innerHTML = g.slice(0, more ? room - 1 : room).map((x, i) => (x[3] ? unlockChip(x[3], i) : gainChip(x[0], x[1], x[2], i))).join('') +
      (more ? gainChip('', ICON.spark, '+' + more + ' more', room - 1) : '');
    wireUnlockChips();
    if (pr.achs.length || pr.unlocks.length || pr.dailies.length || pr.weeklies.length || pr.careers.length || paid > 0) xpTimers.push(setTimeout(() => Sound.unlockItem(), up ? 1500 : 500));
  }
  function backToLobby() {
    show(ui.res, false); show(ui.cp, false); hidePrompt(); clearNotices();
    setHudMode(false);
    phase = 'lobby';
    run.st = null; run.streak = 0; view.st = null; view.prevHoops = []; ball.lastVis = 0;
    attract.wait = 0.3; attract.st = null;
    setTab('play', true); refreshLobby(); refreshPot();
  }
  if (window.ResizeObserver) { try { const ro = new ResizeObserver(() => { sheetTopC = -1; }); ro.observe(ui.lobby); ro.observe($('vLocker')); } catch (e) { /* optional */ } }

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
    if (ball.fire > 0.1) ball.lickAcc += 1.5 * ball.fire;
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
      floatText(hx - 10, hy - 70, label, null, col, o === 'S' ? 19 + Math.min(streak, 5) * 1.1 : 17);
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
    const big = clamp(Math.log(Math.max(1, run.total)) / Math.log(20), 0, 1); // 1× murmur, 20×+ a roar
    Sound.applause(Math.max(0.25, big, (k || 1) - 1)); if (big > 0.3 || k > 1) Sound.cheer(Math.max(big, 0.5));
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
    if (nav.cover && phase === 'lobby') { requestAnimationFrame(frame); return; } // a full page covers the arena
    view.time += dt;
    if (eqFlame().prism) prismTick(view.time);
    // a phone that can't hold about 40 fps during play for 2 s draws at a lower resolution, so the game stays smooth
    if (!dbg.hold && dt > 0 && dt < 0.1) {
      perf.avg += (dt - perf.avg) * 0.05;
      if (phase === 'play' && perf.avg > 0.025) {
        perf.slow += dt;
        if (perf.slow > 2 && dprCap > 1 && (window.devicePixelRatio || 1) > 1) { dprCap = Math.max(1, dprCap - 0.5); perf.slow = 0; resize(); }
      } else perf.slow = 0;
    }

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
    pushTrail(dxw, dyw); trailFx(dxw, dyw);
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
    const vis = dbg.fx != null ? dbg.fx : phase === 'lobby' ? (nav.fx != null ? nav.fx : Math.min(attract.streak, 4)) : run.lost ? 0 : run.streak;
    const fireT = vis >= 5 ? 1 : vis === 4 ? 0.82 : vis === 3 ? 0.64 : vis === 2 ? 0.3 : 0;
    ball.fire = lerp(ball.fire, fireT, 1 - Math.exp(-dt * (fireT > ball.fire ? 5 : 3.5)));
    if (ball.fire < 0.004) ball.fire = 0;
    if (fireT > 0) ball.nova = lerp(ball.nova, vis >= 5 ? 1 : 0, 1 - Math.exp(-dt * 3));
    if (vis === 0 && ball.lastVis >= 2 && ball.fire > 0.12 && !ball.hidden) douse(dxw, dyw);
    ball.lastVis = vis;
    // the flame: burning gas shed by the ball (see updateFlame)
    ball.flare *= Math.exp(-dt * 6);
    ball.flick = 0.86 + 0.14 * noise1(view.time * 9.5 + 40);
    updateFlame(Math.min(dt, 1 / 20));
    if (ball.fire > 0.04 && !ball.hidden) {
      const f = ball.fire, n = ball.nova, dx = ball.fdx, dy = ball.fdy;
      // now and then the very tip of a tongue lifts away as a wisp
      ball.lickAcc += dt * (REDUCED ? 2 : 7) * f;
      while (ball.lickAcc >= 1) {
        ball.lickAcc -= 1;
        const p = flame.T[(Math.random() * flame.T.length) | 0].pts[0];
        if (!p) break;
        spawn({ x: dxw + p.x, y: dyw + p.y, vx: p.vx * 0.5, vy: p.vy * 0.5 - 40, g: -300, life: rnd(0.14, 0.26), max: 0.26, size: RV * rnd(0.16, 0.28) * (0.6 + 0.6 * f), kind: 6, n, drag: 2.4, rot: -Math.PI / 2 + rnd(-0.5, 0.5) });
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
    // zoom: in the lobby the live arena shows through the page's rounded window, so the view zooms to fit
    // a span of the world into it: on Play the demo ball's flight and the floor line (world y 130 to 676), in
    // the Locker the flight alone (130 to 560) so the ball you're dressing shows bigger, except for courts.
    // In a run it pulls back a little on faster levels, whose rings are spaced farther apart, so the next
    // ring comes into view as early as on level 1.
    let zoomT = 1, centreY = null, centreW = 0;
    const lk = nav.tab === 'locker', sheet = lk ? vL : ui.lobby;
    if (phase === 'lobby' && !sheet.classList.contains('hide')) {
      if (sheetTopC < 0) {
        const h = lk ? $('lkHero') : $('hero');
        heroT = sheet.offsetTop + h.offsetTop; heroB = heroT + h.offsetHeight; sheetTopC = heroT;
      }
      const near = lk && nav.cat !== 'court', top = 130, bot = near ? 560 : 676; // courts show their floor line
      zoomT = clamp((heroB - heroT - 8) / ((bot - top) * scale), 0.45, 1);
      centreY = (heroT + heroB) / 2; centreW = (top + bot) / 2;
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
    const camYT = centreY == null ? 0 : centreW - (centreY - oy) / S; // the middle of the framed span at the window's middle
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
    const bannerOn = performance.now() < bannerUntil;
    view.scoreA = lerp(view.scoreA == null ? 1 : view.scoreA, bannerOn ? 0 : CALL.busy ? 0.2 : 1, bannerOn ? 0.3 : 0.12);
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
    drawFar(c, worldLeft, worldW);
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
  // The far side of the arena, behind the court: the courtside crowd in silhouette against the haze, and an
  // LED board along the baseline. The crowd is further away, so it drifts slower than the court; the board
  // moves with it. The crowd is painted once into a tile that repeats.
  const STANDS_W = 420, STANDS_H = 40, BOARD_H = 10;
  let standsEl = null, standsK = 0;
  function standsTile() {
    const k = Math.max(1, Math.round(scale * dpr * 2) / 2);
    if (standsEl && standsK === k) return standsEl;
    const el = standsEl || document.createElement('canvas');
    el.width = Math.ceil(STANDS_W * k); el.height = Math.ceil(STANDS_H * k);
    const g = el.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, STANDS_W, STANDS_H);
    const rnd = E.makeRng('crowd');
    // two rows of heads and shoulders: the back row smaller and fainter
    const row = (base, rMin, rMax, gap, alpha) => {
      g.fillStyle = 'rgba(4,7,17,' + alpha + ')';
      g.beginPath();
      for (let x = rnd() * gap; x < STANDS_W + gap; x += gap * (0.8 + rnd() * 0.45)) {
        const r = rMin + rnd() * (rMax - rMin), y = base - r * (1.5 + rnd() * 0.5);
        for (const dx of [0, -STANDS_W]) { // wrap around the tile's edge so it repeats seamlessly
          g.moveTo(x + dx + r, y); g.arc(x + dx, y, r, 0, Math.PI * 2);
          g.moveTo(x + dx + r * 1.7, base); g.ellipse(x + dx, base, r * 1.7, r * 1.25, 0, 0, Math.PI * 2);
        }
      }
      g.rect(0, base, STANDS_W, STANDS_H - base);
      g.fill();
    };
    row(STANDS_H - 14, 2.6, 3.4, 8, 0.3);
    row(STANDS_H - 2, 3.4, 4.4, 11, 0.62);
    standsK = k;
    return (standsEl = el);
  }
  function drawArena(c, left, width) {
    const F = W.FLOOR, top = F - BOARD_H, x0 = left - 20, w = width + 40;
    const tile = standsTile(), shift = view.camX * 0.65; // the stands move at 35% of the court's speed
    for (let u = Math.floor((left - shift) / STANDS_W) * STANDS_W; u < left - shift + width; u += STANDS_W) {
      c.drawImage(tile, u + shift, top - STANDS_H, STANDS_W, STANDS_H);
    }
    const glow = c.createLinearGradient(0, top - 18, 0, top); // the board lights the front row
    glow.addColorStop(0, 'rgba(' + COURT_ART.arena.light + ',0)'); glow.addColorStop(1, 'rgba(' + COURT_ART.arena.light + ',0.15)');
    c.fillStyle = glow; c.fillRect(x0, top - 18, w, 18);
    const bd = c.createLinearGradient(0, top, 0, F);
    bd.addColorStop(0, '#0f1730'); bd.addColorStop(1, '#070b18');
    c.fillStyle = bd; c.fillRect(x0, top, w, BOARD_H);
    c.fillStyle = 'rgba(130,165,255,0.5)'; c.fillRect(x0, top, w, 0.7);
    c.font = '800 6.5px ' + FONT_DISPLAY; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(140,175,255,0.4)';
    for (let x = Math.floor((left - 60) / 160) * 160; x < left + width + 60; x += 160) c.fillText('SOL DUNK', x, top + BOARD_H / 2 + 0.4);
  }
  function drawCourt(c, left, width, S, bx, by, rings) {
    const A = courtArt(), x0 = left - 20, w = width + 40, F = W.FLOOR;
    A.floor(c, x0, w, F, S, left + width / 2, width);
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
    fl.addColorStop(0, 'rgba(255,255,255,0)'); fl.addColorStop(0.5, A.edge); fl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = fl; c.fillRect(x0, F, w, 1 / S);
  }

  // ---------------------------------------------------------------- rings: shaded torus sprites
  // Each ring is drawn exactly at its collision size (tube centre = rim peg, tube width = peg size).
  // Sprites are cached per size, colour and pixel density.
  // Painted steel rims: no neon glow. A dark edge at exactly the tube's collision width, the tube shaded from
  // its underside up to a top lit by the spotlight, a narrow specular streak, and a cool bounce light off the
  // court underneath. The streak and the bounce fade toward the sides; the far side sits in shadow.
  const RING_PAL = {
    red: { edge: '#3a0805', body: '#a5261a', mid: '#dd3a22', hi: '#ff8a64', spec: '255,236,224', back: '#7c1b12', bounce: '150,175,255' },
    gold: { edge: '#3e2b02', body: '#b5831a', mid: '#efb52e', hi: '#ffe08a', spec: '255,250,232', back: '#8c6512', bounce: '160,184,255' },
    grey: { edge: '#0e121b', body: '#262c3a', mid: '#353d50', hi: '#56607a', spec: '200,210,235', back: '#1e2330', bounce: '110,140,220' }
  };
  const RING_RY = 0.34;
  function lerpHex(a, b, t) {
    const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(((A >> sh) & 255) + (((B >> sh) & 255) - ((A >> sh) & 255)) * t);
    return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
  }
  function hexRgb(h) { const n = parseInt(h.slice(1), 16); return ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255); }
  function ringHalf(c, rx, ry, lw, pal, front) {
    const a0 = front ? 0 : Math.PI, a1 = front ? Math.PI : Math.PI * 2;
    const arc = (oy, b0, b1) => { c.beginPath(); c.ellipse(0, oy, rx, ry, 0, b0, b1); c.stroke(); };
    // light that fades toward the sides of the ring, brightest a little left of centre (the light is up and left)
    const fade = (rgb, a, mid) => {
      const g = c.createLinearGradient(-rx, 0, rx, 0);
      g.addColorStop(0, 'rgba(' + rgb + ',0)'); g.addColorStop(mid - 0.1, 'rgba(' + rgb + ',' + a + ')');
      g.addColorStop(mid + 0.08, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
      return g;
    };
    // the lit front blends into the shaded back's colours toward the sides, so the halves meet without a seam
    const sides = (end, mid) => {
      const g = c.createLinearGradient(-rx, 0, rx, 0);
      g.addColorStop(0, end); g.addColorStop(0.22, mid); g.addColorStop(0.78, mid); g.addColorStop(1, end);
      return g;
    };
    const backTop = lerpHex(pal.back, pal.mid, 0.45);
    // flat ends, so the halves meet without dark knots at the sides; the back half runs a little past its
    // ends underneath the front, so the front's ends always sit on matching colour
    c.lineCap = 'butt';
    const ov = front ? 0 : 0.04;
    c.strokeStyle = pal.edge; c.lineWidth = lw; arc(0, a0 - ov, a1 + ov);
    if (front) {
      c.strokeStyle = sides(pal.back, pal.body); c.lineWidth = lw * 0.82; arc(lw * 0.02, a0, a1);
      c.strokeStyle = fade(pal.bounce, 0.22, 0.45); c.lineWidth = lw * 0.16; arc(lw * 0.3, a0, a1);
      c.strokeStyle = sides(backTop, pal.mid); c.lineWidth = lw * 0.5; arc(-lw * 0.13, a0, a1);
      c.strokeStyle = fade(hexRgb(pal.hi), 0.5, 0.45); c.lineWidth = lw * 0.24; arc(-lw * 0.22, a0, a1);
      c.lineCap = 'round';
      c.strokeStyle = fade(pal.spec, 0.95, 0.42); c.lineWidth = lw * 0.11; arc(-lw * 0.27, 0.08 * Math.PI, 0.92 * Math.PI);
    } else {
      // a little longer than half, so the front's flat ends sit on matching colour (no hairline at the sides)
      c.strokeStyle = pal.back; c.lineWidth = lw * 0.8; arc(lw * 0.02, a0 - 0.035, a1 + 0.035);
      c.strokeStyle = backTop; c.lineWidth = lw * 0.48; arc(-lw * 0.13, a0 - 0.035, a1 + 0.035);
      c.lineCap = 'round';
      c.strokeStyle = fade(pal.spec, 0.3, 0.5); c.lineWidth = lw * 0.09; arc(-lw * 0.26, 1.1 * Math.PI, 1.9 * Math.PI);
    }
    c.lineCap = 'butt';
  }
  const ringCache = new Map();
  function ringSprites(w, palKey) {
    const k = Math.max(1, Math.round(scale * dpr * 4) / 4);
    const key = w + '|' + palKey + '|' + k;
    let sp = ringCache.get(key);
    if (sp) return sp;
    const pal = RING_PAL[palKey] || RIMS[palKey].pal, lw = P.RP * 2, rx = w / 2, ry = rx * RING_RY, pad = lw + 6;
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
    const sp = ringSprites(h.w, h.st === 2 ? 'grey' : h.cp ? 'gold' : eqRim());
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
  // fixed patterns for the skins, in ball radii (the same every time)
  const PAT = (() => {
    const rng = E.makeRng('ball-patterns'), R = () => rng() * 2 - 1, disc = () => { let x, y; do { x = R(); y = R(); } while (x * x + y * y > 1); return [x, y]; };
    const dots = Array.from({ length: 64 }, () => [...disc(), 0.022 + 0.03 * rng(), rng() < 0.62]);
    // tiger stripes: bands reaching in from the top or the bottom edge, [x, from top (1) or bottom (-1), length, width, sway]
    const tiger = [[-0.86, -1, 1.5, 0.15, 0.08], [-0.64, 1, 1.3, 0.2, 0.12], [-0.38, -1, 1.02, 0.18, -0.12], [-0.12, 1, 0.9, 0.17, 0.1], [0.14, -1, 1.1, 0.2, 0.12], [0.4, 1, 1.05, 0.18, -0.1], [0.64, -1, 1.25, 0.2, -0.1], [0.86, 1, 1.5, 0.15, 0.06]];
    const camo = Array.from({ length: 16 }, (_, i) => [R() * 1.1, R() * 1.1, 0.2 + 0.2 * rng(), i % 3, rng() * 6.28]);
    const land = [[-0.35, -0.2, 0.42], [-0.05, -0.38, 0.3], [0.42, 0.25, 0.38], [0.18, 0.52, 0.26], [-0.55, 0.42, 0.22], [0.62, -0.42, 0.2], [-0.8, -0.1, 0.18]].map(([x, y, r]) => [x, y, r, Array.from({ length: 4 }, () => [R() * r * 0.7, R() * r * 0.7, r * (0.45 + 0.4 * rng())])]);
    const craters = [[-0.38, -0.28, 0.2], [0.3, -0.45, 0.13], [0.42, 0.2, 0.22], [-0.1, 0.42, 0.15], [-0.62, 0.25, 0.1], [0.1, -0.05, 0.08], [0.68, -0.12, 0.09], [-0.25, 0.75, 0.1], [0.02, -0.78, 0.09]];
    return { dots, tiger, camo, land, craters };
  })();
  function drawPixelBall(c, r, rot, sk) {
    // the seams turn in quarter-turn steps, like an old sprite
    const q = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2), n = 11, cell = (2 * r) / n, w = cell * 0.5, cr = Math.cos(-q), sr = Math.sin(-q);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = -r + (i + 0.5) * cell, y = -r + (j + 0.5) * cell;
      if (x * x + y * y > (r - cell * 0.12) * (r - cell * 0.12)) continue;
      const l = Math.hypot(x + 0.42 * r, y + 0.48 * r) / (1.6 * r), k = l < 0.22 ? 0 : l < 0.45 ? 1 : l < 0.68 ? 2 : l < 0.86 ? 3 : 4;
      const u = x * cr - y * sr, v = x * sr + y * cr;
      const seam = Math.abs(v) < w || Math.abs(u) < w || Math.abs(Math.hypot(u + 1.34 * r, v) - 1.02 * r) < w || Math.abs(Math.hypot(u - 1.34 * r, v) - 1.02 * r) < w;
      c.fillStyle = seam ? sk.pseam : sk.pixel[k];
      c.fillRect(x - cell / 2, y - cell / 2, cell + 0.25, cell + 0.25);
    }
  }
  function drawBallBody(c, r, rot, sk) {
    sk = sk || eqBall();
    if (sk.pixel) { drawPixelBall(c, r, rot, sk); return; }
    const G = sk.grad;
    const g = c.createRadialGradient(-r * 0.38, -r * 0.42, r * 0.05, 0, 0, r * 1.02);
    g.addColorStop(0, G[0]); g.addColorStop(0.45, G[1]); g.addColorStop(0.85, G[2]); g.addColorStop(1, G[3]);
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.save(); c.beginPath(); c.arc(0, 0, r - 0.3, 0, Math.PI * 2); c.clip();
    if (sk.chrome) { // a mirror: sky above the horizon, ground below; reflections don't turn with the ball
      const sky = c.createLinearGradient(0, -r, 0, r * 0.12);
      sky.addColorStop(0, 'rgba(255,255,255,0.95)'); sky.addColorStop(1, 'rgba(150,162,186,0.9)');
      c.fillStyle = sky; c.fillRect(-r, -r, r * 2, r * 1.12);
      const gr = c.createLinearGradient(0, r * 0.12, 0, r);
      gr.addColorStop(0, 'rgba(58,64,78,0.95)'); gr.addColorStop(1, 'rgba(10,12,18,0.95)');
      c.fillStyle = gr; c.fillRect(-r, r * 0.12, r * 2, r);
      c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(-r, r * 0.1, r * 2, r * 0.05);
    }
    c.rotate(rot);
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
    if (sk.dots) for (const [x, y, s, dark] of PAT.dots) { c.fillStyle = dark ? 'rgba(20,8,2,0.26)' : 'rgba(255,226,196,0.16)'; c.beginPath(); c.arc(x * r, y * r, s * r, 0, Math.PI * 2); c.fill(); }
    if (sk.tiger) {
      c.fillStyle = sk.tiger;
      for (const [x, dir, len, wd, sw] of PAT.tiger) {
        const x0 = x * r, y0 = -dir * r * 1.06, hw = wd * r / 2, tx = x0 + sw * r, ty = y0 + dir * len * r, mx = x0 + sw * r * 1.3, my = y0 + dir * len * r * 0.5;
        c.beginPath(); c.moveTo(x0 - hw, y0);
        c.quadraticCurveTo(mx - hw * 0.7, my, tx, ty);
        c.quadraticCurveTo(mx + hw * 0.7, my, x0 + hw, y0);
        c.closePath(); c.fill();
      }
    }
    if (sk.camo) for (const [x, y, s, k, a] of PAT.camo) {
      c.fillStyle = sk.camo[k];
      for (let j = 0; j < 3; j++) { const b = a + j * 2.1; c.beginPath(); c.arc((x + Math.cos(b) * s * 0.45) * r, (y + Math.sin(b) * s * 0.45) * r, s * r * (0.75 - j * 0.12), 0, Math.PI * 2); c.fill(); }
    }
    if (sk.swirl) { // a peppermint: eight wedges twisting out from the middle
      c.fillStyle = sk.swirl;
      const N = 8, tw = 1.25, R2 = r * 1.06;
      for (let i = 0; i < N; i += 2) {
        const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
        c.beginPath(); c.moveTo(0, 0);
        for (let t = 0.2; t <= 1.001; t += 0.2) c.lineTo(Math.cos(a0 + t * tw) * R2 * t, Math.sin(a0 + t * tw) * R2 * t);
        c.arc(0, 0, R2, a0 + tw, a1 + tw);
        for (let t = 1; t >= 0.199; t -= 0.2) c.lineTo(Math.cos(a1 + t * tw) * R2 * t, Math.sin(a1 + t * tw) * R2 * t);
        c.closePath(); c.fill();
      }
    }
    if (sk.land) {
      for (const [x, y, s, sub] of PAT.land) {
        c.fillStyle = sk.land[s > 0.3 ? 0 : 1];
        c.beginPath(); c.arc(x * r, y * r, s * r * 0.7, 0, Math.PI * 2); c.fill();
        for (const [dx, dy, rr] of sub) { c.beginPath(); c.arc((x + dx) * r, (y + dy) * r, rr * r, 0, Math.PI * 2); c.fill(); }
      }
      c.fillStyle = 'rgba(255,255,255,0.55)';
      for (const [x, y, w] of [[-0.2, -0.62, 0.5], [0.35, 0.02, 0.4], [-0.5, 0.18, 0.3]]) { c.beginPath(); c.ellipse(x * r, y * r, w * r, r * 0.07, -0.2, 0, Math.PI * 2); c.fill(); }
    }
    if (sk.craters) for (const [x, y, s] of PAT.craters) {
      c.fillStyle = 'rgba(80,80,74,0.32)'; c.beginPath(); c.arc(x * r, y * r, s * r, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,250,0.28)'; c.beginPath(); c.arc((x + s * 0.18) * r, (y + s * 0.22) * r, s * r * 0.78, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(96,96,90,0.3)'; c.beginPath(); c.arc((x - s * 0.08) * r, (y - s * 0.1) * r, s * r * 0.7, 0, Math.PI * 2); c.fill();
    }
    if (sk.eight) {
      c.fillStyle = '#f7f7f4'; c.beginPath(); c.arc(r * 0.16, -r * 0.1, r * 0.42, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#0d0f14'; c.font = '800 ' + (r * 0.56).toFixed(2) + 'px ' + FONT_ROUND; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('8', r * 0.16, -r * 0.07);
    }
    if (sk.facets) { // a cut gem: a table in the middle, facets out to the edge
      const I = [], O = [];
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, b = (k + 0.5) / 8 * Math.PI * 2; I.push([Math.cos(a) * r * 0.44, Math.sin(a) * r * 0.44]); O.push([Math.cos(b) * r * 1.08, Math.sin(b) * r * 1.08]); }
      const tri = (p, q, s, col) => { c.fillStyle = col; c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(q[0], q[1]); c.lineTo(s[0], s[1]); c.closePath(); c.fill(); };
      for (let k = 0; k < 8; k++) {
        tri(I[k], O[k], I[(k + 1) % 8], 'rgba(255,255,255,' + [0.42, 0.08, 0.3, 0.04, 0.36, 0.12, 0.22, 0.06][k] + ')');
        tri(O[k], I[(k + 1) % 8], O[(k + 1) % 8], 'rgba(30,90,150,' + [0.12, 0.3, 0.06, 0.24, 0.1, 0.34, 0.08, 0.2][k] + ')');
      }
      c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); I.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = r * 0.03; c.stroke();
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
    if (sk.seam) seams(r * 0.085, sk.seam);
    c.restore();
    if (sk.land) { // a thin bright atmosphere round the planet
      const at = c.createRadialGradient(0, 0, r * 0.78, 0, 0, r);
      at.addColorStop(0, 'rgba(150,210,255,0)'); at.addColorStop(1, 'rgba(170,225,255,0.55)');
      c.fillStyle = at; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    }
    if (sk.rim) { c.strokeStyle = sk.rim; c.lineWidth = r * 0.07; c.beginPath(); c.arc(0, 0, r - r * 0.04, Math.PI * 0.62, Math.PI * 1.08); c.stroke(); }
    const hl = c.createRadialGradient(-r * 0.4, -r * 0.5, 0, -r * 0.4, -r * 0.5, r * (sk.shine ? 0.62 : 0.5));
    hl.addColorStop(0, 'rgba(255,255,255,' + (sk.shine ? 0.75 : 0.45) + ')'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = hl; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
  }
  // Wing outlines, all in the same span (s = the wing's size) so every shape stays short and close to the ball.
  function wingPath(c, s, shape) {
    c.beginPath();
    if (shape === 'bat') { // a membrane between finger bones, scalloped between the tips
      c.moveTo(0.04 * s, -0.12 * s);
      c.bezierCurveTo(-0.12 * s, -0.62 * s, -0.56 * s, -1.0 * s, -1.06 * s, -0.9 * s);
      c.quadraticCurveTo(-0.8 * s, -0.72 * s, -0.95 * s, -0.46 * s);
      c.quadraticCurveTo(-0.7 * s, -0.42 * s, -0.66 * s, -0.17 * s);
      c.quadraticCurveTo(-0.34 * s, -0.2 * s, 0.04 * s, 0.06 * s);
      c.quadraticCurveTo(0.12 * s, -0.03 * s, 0.04 * s, -0.12 * s);
    } else if (shape === 'bfly') { // a big upper lobe and a small lower one
      c.moveTo(0.03 * s, -0.1 * s);
      c.bezierCurveTo(-0.1 * s, -0.74 * s, -0.8 * s, -1.1 * s, -1.03 * s, -0.8 * s);
      c.bezierCurveTo(-1.14 * s, -0.6 * s, -0.86 * s, -0.37 * s, -0.52 * s, -0.27 * s);
      c.bezierCurveTo(-0.8 * s, -0.2 * s, -0.8 * s, 0.05 * s, -0.55 * s, 0.09 * s);
      c.bezierCurveTo(-0.32 * s, 0.13 * s, -0.1 * s, 0.07 * s, 0.03 * s, -0.1 * s);
    } else if (shape === 'mech') { // plates with straight edges
      c.moveTo(0.07 * s, -0.1 * s); c.lineTo(-0.18 * s, -0.64 * s); c.lineTo(-1.0 * s, -0.94 * s); c.lineTo(-0.9 * s, -0.66 * s);
      c.lineTo(-0.74 * s, -0.6 * s); c.lineTo(-0.72 * s, -0.4 * s); c.lineTo(-0.54 * s, -0.35 * s); c.lineTo(-0.5 * s, -0.15 * s);
      c.lineTo(-0.28 * s, -0.08 * s); c.lineTo(0.07 * s, 0.06 * s);
    } else { // feathers
      c.moveTo(0.04 * s, -0.12 * s);
      c.bezierCurveTo(-0.1 * s, -0.66 * s, -0.62 * s, -1.02 * s, -1.02 * s, -0.86 * s);
      c.quadraticCurveTo(-1.1 * s, -0.66 * s, -0.88 * s, -0.6 * s);
      c.quadraticCurveTo(-0.98 * s, -0.42 * s, -0.74 * s, -0.38 * s);
      c.quadraticCurveTo(-0.82 * s, -0.2 * s, -0.56 * s, -0.18 * s);
      c.quadraticCurveTo(-0.6 * s, -0.02 * s, -0.34 * s, -0.02 * s);
      c.quadraticCurveTo(-0.14 * s, 0.1 * s, 0.04 * s, 0.06 * s);
      c.quadraticCurveTo(0.12 * s, -0.03 * s, 0.04 * s, -0.12 * s);
    }
    c.closePath();
  }
  function wingDetail(c, s, wg, far) {
    const sh = wg.shape;
    c.strokeStyle = far ? 'rgba(20,24,36,0.25)' : wg.vein; c.lineCap = 'round'; c.lineJoin = 'round';
    if (sh === 'bat') {
      c.lineWidth = 1.1; c.beginPath();
      c.moveTo(0.02 * s, -0.08 * s); c.lineTo(-0.42 * s, -0.66 * s);
      for (const [tx, ty] of [[-1.06, -0.9], [-0.95, -0.46], [-0.66, -0.17]]) { c.moveTo(-0.42 * s, -0.66 * s); c.lineTo(tx * s, ty * s); }
      c.stroke();
    } else if (sh === 'bfly') {
      c.lineWidth = 0.8; c.beginPath();
      for (const [tx, ty] of [[-0.95, -0.86], [-1.0, -0.6], [-0.7, -0.33], [-0.68, 0.0]]) { c.moveTo(0, -0.06 * s); c.quadraticCurveTo(tx * 0.45 * s, ty * 0.6 * s, tx * s, ty * s); }
      c.stroke();
      if (!far && wg.spots) { c.fillStyle = wg.spots; for (const [x, y, rr] of [[-0.84, -0.74, 0.075], [-0.66, -0.86, 0.05], [-0.62, -0.02, 0.05]]) { c.beginPath(); c.arc(x * s, y * s, rr * s, 0, Math.PI * 2); c.fill(); } }
    } else if (sh === 'mech') {
      c.lineWidth = 0.9; c.beginPath();
      c.moveTo(-0.4 * s, -0.72 * s); c.lineTo(-0.36 * s, -0.12 * s); c.moveTo(-0.68 * s, -0.83 * s); c.lineTo(-0.63 * s, -0.37 * s);
      c.stroke();
      if (!far && wg.rivets) { c.fillStyle = 'rgba(255,255,255,0.55)'; for (const [x, y] of [[-0.12, -0.55], [-0.3, -0.66], [-0.52, -0.74], [-0.76, -0.84]]) { c.beginPath(); c.arc(x * s, y * s, 0.028 * s, 0, Math.PI * 2); c.fill(); } }
    } else {
      c.lineWidth = 0.8;
      for (const [tx, ty] of [[-0.88, -0.6], [-0.74, -0.38], [-0.56, -0.18]]) { c.beginPath(); c.moveTo(-0.12 * s, -0.14 * s); c.quadraticCurveTo((tx * 0.5 - 0.06) * s, (ty * 0.5 - 0.16) * s, tx * s, ty * s); c.stroke(); }
    }
  }
  function drawWing(c, r, flap, far, wg) {
    wg = wg || eqWing();
    const s = r * (far ? 1.2 : 1.35), sh = wg.shape; // short, compact wings
    const fold = 1 - clamp(-flap, 0, 1) * 0.22; // foreshortened on the downstroke
    c.save();
    c.rotate(flap); c.scale(1, fold);
    if (!far) { c.save(); c.translate(1.2, 2.2); wingPath(c, s, sh); c.fillStyle = 'rgba(0,0,0,0.28)'; c.fill(); c.restore(); }
    wingPath(c, s, sh);
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
    wingDetail(c, s, wg, far);
    c.restore();
    wingPath(c, s, sh);
    c.strokeStyle = far ? wg.farEdge : wg.edge; c.lineWidth = 0.9; c.lineJoin = 'round'; c.stroke();
    if (wg.glow && !far) { // a soft light along the edge, without shadowBlur
      c.globalCompositeOperation = 'lighter'; c.strokeStyle = 'rgba(' + wg.glow + ',0.28)'; c.lineWidth = 3.2; c.stroke();
      c.globalCompositeOperation = 'source-over';
    }
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
  // Fire is burning gas, so the flame is drawn as gas. Five tongues leave the back of the ball, and each sheds a
  // parcel of burning gas every few milliseconds. A parcel leaves with most of the ball's speed, slows to the
  // still air, rises faster and faster as hot gas does, is stirred by the air and burns out. Each tongue is a
  // ribbon drawn through its parcels, widest near the ball and burning down to a point. Because the gas stays
  // roughly where it was while the ball flies on, the flame trails the ball's real path: it bends behind a
  // flap, sweeps up as the ball falls and stands up when it slows. Each tongue breathes on its own, so it swells,
  // thins and flickers, and when one thins to nothing at the ball, the part already out breaks away and burns
  // off as a separate lick. Layers run from the edge colour in to a white-hot core.
  const NZ = new Float32Array(256);
  for (let i = 0; i < 256; i++) NZ[i] = Math.random() * 2 - 1;
  function noise1(x) { // smooth 1D noise, about -1..1
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f), a = NZ[i & 255];
    return a + (NZ[(i + 1) & 255] - a) * u;
  }
  // tongues: [angle from the way the flame streams, size, seed]
  const FLAME_T = [[-1.2, 0.62, 3.1], [-0.6, 0.86, 7.7], [0, 1, 1.3], [0.6, 0.86, 5.9], [1.2, 0.62, 9.4]];
  const flame = { T: FLAME_T.map(([ang, size, seed]) => ({ ang, size, seed, acc: 0, pts: [] })), dx: 0, dy: -1 };
  const F_STEP = 1 / 80; // each tongue sheds a parcel every 12.5 ms
  function breath(T, t) { // how much gas a tongue gives off right now; at 0 it pinches off
    const calm = REDUCED ? 0.35 : 1;
    return clamp(0.64 + calm * (0.7 * noise1(t * 4.4 + T.seed * 5) + 0.12 * noise1(t * 13 + T.seed)), 0, 1.25);
  }
  const EM = { x: 0, y: 0, nx: 0, ny: 0 };
  function emitter(T) { // where a tongue leaves the ball (relative to its centre) and the way it points
    const a = Math.atan2(ball.fdy, ball.fdx) + T.ang + (REDUCED ? 0 : 0.16 * noise1(view.time * 2.2 + T.seed * 3));
    EM.nx = Math.cos(a); EM.ny = Math.sin(a); EM.x = EM.nx * RV * 0.8; EM.y = EM.ny * RV * 0.8;
    return EM;
  }
  function updateFlame(dt) {
    // the ball's motion as the flame feels it: vertical motion counts half, so a flap or a fall bends the flame
    // without flinging it about. The gas is tracked relative to the ball.
    const evx = ball.vx, evy = ball.vy * 0.5;
    const wx = -evx, wy = -evy - 240, wl = Math.hypot(wx, wy) || 1, kd = 1 - Math.exp(-dt * 12);
    flame.dx += (wx / wl - flame.dx) * kd; flame.dy += (wy / wl - flame.dy) * kd;
    const dl = Math.hypot(flame.dx, flame.dy) || 1;
    ball.fdx = flame.dx / dl; ball.fdy = flame.dy / dl;
    const f = ball.fire, live = f > 0.02 && !ball.hidden, t = view.time, stir0 = REDUCED ? 25 : 80;
    const Lmax2 = Math.pow(RV * (3 + 2.2 * f), 2);                  // and no tongue reaches further than this
    const life = (0.14 + 0.11 * f) * (1 + 0.25 * ball.flare), drag = Math.exp(-dt * 10), lift = 1000 * dt;
    for (const T of flame.T) {
      if (ball.hidden) T.pts.length = 0;
      for (let i = T.pts.length - 1; i >= 0; i--) {
        const p = T.pts[i], rel = Math.hypot(p.vx - evx, p.vy - evy);
        p.age += dt * (1 + Math.max(0, rel - 260) / 260);             // gas torn away fast burns out sooner
        if (p.age >= p.life || p.x * p.x + p.y * p.y > Lmax2) { T.pts.splice(i, 1); continue; }
        p.vx *= drag; p.vy = p.vy * drag - lift;                       // slows to the air and rises
        const stir = stir0 * p.age / p.life;                           // older gas is stirred more
        p.x += (p.vx - evx + stir * noise1(p.y * 0.05 + t * 2.3 + T.seed)) * dt;
        p.y += (p.vy - evy + stir * 0.7 * noise1(p.x * 0.05 - t * 2.1 + T.seed * 1.7)) * dt;
      }
      if (!live) { T.acc = 0; continue; }
      T.acc += dt;
      const E2 = emitter(T), push = 110 + 60 * ball.flare;
      while (T.acc >= F_STEP) {
        T.acc -= F_STEP;
        const a = T.acc, vx0 = evx * 0.5 + E2.nx * push, vy0 = evy * 0.5 + E2.ny * push; // left `a` seconds ago
        T.pts.push({ x: E2.x + (vx0 - evx) * a, y: E2.y + (vy0 - evy) * a, vx: vx0, vy: vy0, age: a, life: life * (0.9 + 0.2 * Math.random()), w: breath(T, t - a) });
      }
      if (T.pts.length > 48) T.pts.splice(0, T.pts.length - 48);
    }
  }
  const FLAME_LAYERS = [ // [ribbon width, ribbon length, colour, alpha, cap front radius, cap half-width]; caps in ball radii
    [1, 1, 'outer', 0.97, 1.12, 1.3],
    [0.74, 0.8, 'mid', 0.97, 1.02, 1.1],
    [0.5, 0.6, 'inner', 0.97, 0.9, 0.92],
    [0.28, 0.4, 'core', 0.92, 0.78, 0.72]
  ];
  const RBX = [], RBY = [], RBH = [];
  // one tongue in one layer: a ribbon through its parcels (relative to the ball), newest first
  function ribbon(c, T, W, ws, ls) {
    const E2 = emitter(T), pts = T.pts;
    let m = 0, tipX = 0, tipY = 0;
    const prof = (u) => Math.pow(1 - u, 0.62) * (1 + 0.4 * Math.sin(Math.PI * u));
    RBX[0] = E2.x; RBY[0] = E2.y; RBH[0] = W * ws * breath(T, view.time); m = 1;
    let lastU = 0;
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i], u = p.age / (p.life * ls), x = p.x, y = p.y;
      if (u >= 1) { // the tip burns out between this parcel and the last one
        const k = (1 - lastU) / Math.max(1e-6, u - lastU);
        tipX = RBX[m - 1] + (x - RBX[m - 1]) * k; tipY = RBY[m - 1] + (y - RBY[m - 1]) * k;
        break;
      }
      RBX[m] = x; RBY[m] = y; RBH[m] = W * ws * p.w * prof(u); m++; lastU = u;
      if (i === 0) { tipX = x; tipY = y; RBH[m - 1] = 0; }
    }
    if (m < 2) return;
    c.beginPath();
    const L = [], R = [];
    for (let i = 0; i < m; i++) {
      const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
      let tx = RBX[b] - RBX[a], ty = RBY[b] - RBY[a];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      L.push(RBX[i] - ty * RBH[i], RBY[i] + tx * RBH[i]); R.push(RBX[i] + ty * RBH[i], RBY[i] - tx * RBH[i]);
    }
    c.moveTo(R[0], R[1]); c.lineTo(L[0], L[1]);
    for (let i = 1; i < m - 1; i++) c.quadraticCurveTo(L[2 * i], L[2 * i + 1], (L[2 * i] + L[2 * i + 2]) / 2, (L[2 * i + 1] + L[2 * i + 3]) / 2);
    c.quadraticCurveTo(L[2 * m - 2], L[2 * m - 1], tipX, tipY);
    c.quadraticCurveTo(R[2 * m - 2], R[2 * m - 1], (R[2 * m - 2] + R[2 * m - 4]) / 2, (R[2 * m - 1] + R[2 * m - 3]) / 2);
    for (let i = m - 2; i > 0; i--) c.quadraticCurveTo(R[2 * i], R[2 * i + 1], (R[2 * i] + R[2 * i - 2]) / 2, (R[2 * i + 1] + R[2 * i - 1]) / 2);
    c.closePath(); c.fill();
  }
  function drawFlame(c, r, f, n, t) {
    const P = flamePal(n), dx = ball.fdx, dy = ball.fdy;
    // a soft glow first, flickering with the fire
    c.globalCompositeOperation = 'lighter';
    const gr = r * (2.2 + 1.8 * f), gx = dx * r * 0.9, gy = dy * r * 0.9;
    const gl = c.createRadialGradient(dx * r * 0.6, dy * r * 0.6, r * 0.3, gx, gy, gr);
    gl.addColorStop(0, rgba(P.outer, 0.4 * f * ball.flick)); gl.addColorStop(1, rgba(P.outer, 0));
    c.fillStyle = gl; c.beginPath(); c.arc(gx, gy, gr, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'source-over';
    const g = 0.5 + 0.5 * Math.min(1, f * 1.6), a = Math.min(1, f * 3), ang = Math.atan2(dy, dx), fan = 1 + 0.1 * ball.flare;
    const W = r * (0.5 + 0.32 * f) * (1 + 0.22 * ball.flare);
    for (const Ly of FLAME_LAYERS) {
      c.fillStyle = rgba(P[Ly[2]], Ly[3] * a);
      const rf = r * (1 + (Ly[4] - 1) * g), w = (r * Ly[5] * g + r * 0.55 * (1 - g)) * fan;
      c.beginPath(); c.ellipse(0, 0, rf, w, ang, 0, Math.PI * 2); c.fill(); // wraps the front of the ball
      for (const T of flame.T) ribbon(c, T, W * T.size, Ly[0], Ly[1]);
    }
  }

  const BEHIND = [false, false, false, false, false, true, true, true, true, true, true, true]; // embers, flame licks, smoke, air puffs and trail bits sit behind the ball
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
      } else if (p.kind === 9) { // a twinkle: a four-point star
        const sz = p.size * (0.4 + 0.6 * Math.sin(t * Math.PI)), q = sz * 0.28;
        c.globalCompositeOperation = 'lighter'; c.globalAlpha = Math.min(1, t * 1.8) * (0.75 + 0.25 * Math.sin(p.life * 40));
        c.fillStyle = p.color; c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
        c.beginPath(); c.moveTo(0, -sz); c.lineTo(q, -q); c.lineTo(sz, 0); c.lineTo(q, q); c.lineTo(0, sz); c.lineTo(-q, q); c.lineTo(-sz, 0); c.lineTo(-q, -q); c.closePath(); c.fill(); c.restore();
      } else if (p.kind === 10) { // a bubble
        const rr = p.size * (0.7 + 0.3 * (1 - t));
        c.globalAlpha = Math.min(1, t * 2) * 0.7; c.strokeStyle = p.color; c.lineWidth = 0.9;
        c.beginPath(); c.arc(p.x, p.y, rr, 0, Math.PI * 2); c.stroke();
        c.fillStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); c.arc(p.x - rr * 0.35, p.y - rr * 0.35, rr * 0.22, 0, Math.PI * 2); c.fill();
      } else if (p.kind === 11) { // a pixel
        const sz = p.size * (0.5 + 0.5 * t);
        c.globalAlpha = Math.min(1, t * 1.6); c.fillStyle = p.color; c.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
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
    if (e.target.closest && e.target.closest('button, input, .sheet, .card, .panel, a, .scrim, .view, #tabbar')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    flapInput();
  }, { passive: false });
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      if (tag === 'INPUT' || (tag === 'BUTTON' && phase !== 'play' && phase !== 'ready' && phase !== 'paused')) return;
      if (nav.page) return; // a page is open: Space scrolls it, and nothing starts or resumes behind it
      const panelOpen = !ui.panel.classList.contains('hide');
      if (e.code === 'Space' && !panelOpen && !e.repeat) {
        if (phase === 'lobby') { e.preventDefault(); if (nav.tab === 'play') startRun(); return; }
        if (phase === 'over' && armed(ui.res)) { e.preventDefault(); show(ui.res, false); if (run.mode === 'special') startSpecial(); else startRun(); return; }
      }
      e.preventDefault();
      if (!e.repeat) flapInput();
    } else if (phase === 'checkpoint' && tag !== 'BUTTON' && armed(ui.cp) && (e.code === 'KeyC' || e.code === 'Enter')) {
      e.preventDefault();
      if (e.code === 'KeyC') cashOut(); else keepGoing();
    } else if (e.code === 'Escape') {
      if (!ui.panel.classList.contains('hide')) closePanel();
      else if (nav.page) closePage();
      else if (phase === 'play') pause();
      else if (phase === 'paused') resume();
      else if (phase === 'lobby' && nav.tab === 'locker') setTab('profile');
      else if (phase === 'lobby' && nav.tab !== 'play') setTab('play');
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && phase === 'play') pause(); });
  // Resuming counts in 3-2-1, so the ball doesn't drop the moment you tap (faster levels leave little slack)
  let resumeTimer = 0, resuming = false;
  function pause() { clearTimeout(resumeTimer); resuming = false; phase = 'paused'; acc = 0; hidePrompt(); showPause(true); }
  function resume() {
    if (resuming) return;
    showPause(false);
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
  function goPlay() { hidePrompt(); showPause(false); phase = 'play'; acc = 0; last = performance.now(); }
  ['gesturestart', 'dblclick'].forEach((n) => document.addEventListener(n, (e) => e.preventDefault()));

  $('cashBtn').addEventListener('click', cashOut);
  $('goBtn').addEventListener('click', keepGoing);
  $('againBtn').addEventListener('click', () => { if (!armed(ui.res)) return; show(ui.res, false); if (run.mode === 'special') startSpecial(); else startRun(); });
  $('lobbyBtn').addEventListener('click', () => { Sound.click(); const sp = run.mode === 'special'; backToLobby(); if (sp) setTab('challenges'); });
  $('shareBtn').addEventListener('click', shareRun);
  $('pauseBtn').addEventListener('click', () => { if (phase === 'play') pause(); else if (phase === 'paused') resume(); });

  // ---------------------------------------------------------------- where everything lives
  // Tabs (Play, Missions, Locker, Profile) are the places. Pages push in over the current tab with a back button:
  // How to play, Odds & fairness, Wallet, Trophies and Recent runs. Sheets rise from the bottom only for a task you
  // finish there: entering the pot and editing the player card. Each thing has one home; the level capsule, the
  // balance and the next-mission row are shortcuts to theirs.
  function openPanel(kind) {
    Sound.click();
    const body = $('panelBody'), title = $('panelTitle');
    const map = { card: ['Player card', cardHtml] };
    const [t, fn] = map[kind] || map.card;
    title.textContent = t; body.innerHTML = fn(); body.dataset.kind = kind;
    body.scrollTop = 0;
    ui.scrim.classList.add('show'); show(ui.panel, true); document.body.classList.add('panel-open');
    wirePanel(kind);
    setTimeout(() => $('panelClose').focus({ preventScroll: true }), 30);
  }
  function closePanel() { ui.scrim.classList.remove('show'); show(ui.panel, false); document.body.classList.remove('panel-open'); }
  $('panelClose').addEventListener('click', closePanel);
  ui.scrim.addEventListener('click', closePanel);
  // any [data-page] button opens its page, including ones drawn later (Profile rows, the Odds link, the pause card)
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-page]'); if (b && !b.disabled) openPage(b.dataset.page); });
  $('balBtn').addEventListener('click', () => openPage('wallet'));
  // sound and vibration: the mute capsule, the switches on Profile and the ones on the pause card are one setting each
  function syncSettings() {
    $('muteBtn').setAttribute('aria-label', settings.sound ? 'Mute sound' : 'Turn sound on');
    $('muteIcon').innerHTML = settings.sound
      ? '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 9.5a4 4 0 0 1 0 5"/><path d="M18.5 7a7.5 7.5 0 0 1 0 10"/>'
      : '<path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m16 9 5 6M21 9l-5 6"/>';
    document.querySelectorAll('.switch[data-set]').forEach((s) => s.setAttribute('aria-checked', String(!!settings[s.dataset.set])));
  }
  function toggleSetting(k) {
    settings[k] = !settings[k]; saveAll(); syncSettings();
    if (k === 'sound') { Sound.unlock(); Sound.click(); } else buzz(10);
  }
  $('muteBtn').addEventListener('click', () => toggleSetting('sound'));
  document.addEventListener('click', (e) => { const s = e.target.closest && e.target.closest('.switch[data-set]'); if (s) toggleSetting(s.dataset.set); });
  syncSettings();

  // How to play: one quiet row per idea, each with a small original glyph, so it scans at a glance
  const HOW_ICON = {
    tap: '<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="7" opacity=".55"/><circle cx="12" cy="12" r="10.3" opacity=".22"/>',
    rim: '<ellipse cx="11" cy="15.5" rx="8.5" ry="3"/><circle cx="18" cy="9" r="3.4" fill="currentColor" stroke="none"/>',
    swish: '<ellipse cx="12" cy="16" rx="8.5" ry="3"/><path d="M12 3v11M8.6 10.6 12 14l3.4-3.4"/>',
    fire: '<path d="M12 21.2c-3.7 0-6.2-2.5-6.2-5.8 0-3.5 2.7-5.4 3.7-8.7.9 1.7 2 2.6 2.7 2.6.4-2.3-.2-4.6-1.2-6.7 3.9 1.6 7.2 5.8 7.2 10.5 0 4.3-2.6 8.1-6.2 8.1z"/>',
    flag: '<ellipse cx="12" cy="16.5" rx="8.5" ry="3"/><path d="M12 13.5V3.2l5.4 2.1L12 7.4"/>',
    star: '<path d="m12 3.3 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9-4.3-4.1 5.9-.8z"/>',
    mission: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="m8.4 12.2 2.5 2.5 4.8-5"/>',
    trophy: '<path d="M7.6 3.8h8.8v5.4a4.4 4.4 0 0 1-8.8 0z"/><path d="M7.6 5.6H4.8v1.2a3.3 3.3 0 0 0 3.1 3.3M16.4 5.6h2.8v1.2a3.3 3.3 0 0 1-3.1 3.3M12 13.6v3.6M8.4 20.2h7.2"/>'
  };
  function howHtml() {
    const row = (icon, tone, title, text) => `<div class="hrow"><span class="hic ${tone}"><svg viewBox="0 0 24 24" aria-hidden="true">${HOW_ICON[icon]}</svg></span><div><h3>${title}</h3><p>${text}</p></div></div>`;
    return `<div class="how">` +
      row('tap', 'blue', 'Tap to flap', `Drop the ball down through every ring. Fly past one, go under it or hit the floor and the run ends.`) +
      row('rim', 'red', 'Rims', `Touch the rim and you can still score: if the ball comes down over the opening it drops in. It only bounces out when it comes down past the rim.`) +
      row('swish', 'green', 'Swish', `Go through without touching the ring for a swish. Swishes pay more than rim hits, and swishes in a row pay more each time, up to 5 in a row. Your streak carries into the next level.`) +
      row('fire', 'heat', 'Fire', `Two swishes in a row and the ball starts to smoulder. Three and it's <b>on fire</b>; five and it burns at full heat (blue-white with the Fire flame). Touch a rim and the flame goes out. Flames from the locker change the colours, never the pay.`) +
      row('flag', 'gold', 'Checkpoints', `Every ${NH} rings, the gold ring ends the level. Cash out your pot, or keep going for more.`) +
      row('star', 'gold', 'Score and XP', `Rings also score points: a rim hit +1, a swish +2, and each swish in a row +1 more, up to +6. Swish all ${NH} rings in a level for a <b>Perfect level</b> (+${PERFECT_BONUS}). Points, missions and trophies earn XP, which unlocks balls, wings, flames, trails, rims and courts in the Locker. Score and XP never change what a run pays.`) +
      row('mission', 'purple', 'Missions', `Three new missions every day and every week (new ones at midnight UTC, and on Mondays), and a career of six chapters, each ending in an item you can only get there. They count in every run, whatever you bet. Daily and weekly missions also pay SOL once you've played ${fmtBet(mview().need.day)} SOL that day or ${fmtBet(mview().need.week)} SOL that week (bets and special level entries); rewards earned before then wait, and go when the day or week ends.`) +
      row('trophy', 'gold', 'Challenges', `<b>Special level</b>: one a day, the same for everyone, with a twist like every ring moving. Pay the entry, then clear every ring of a fresh course to win the prize. <b>Daily pot</b>: buy in, then meet the day's challenge in any regular run to share the pot.`) +
      `</div>`;
  }
  // locker thumbnails, drawn with the same code as the game
  const FLAME_PATH = typeof Path2D === 'function' ? new Path2D('M12 23c-4.4 0-8-3.1-8-7.5 0-3.3 2-5.6 3.7-7.4.6-.6 1.6-.2 1.6.7 0 1.4.9 2.6 2.1 2.6 1.1 0 1.8-.9 1.8-2.1 0-2.3-1.2-4.2-1.2-6.6 0-.9 1-1.5 1.7-1C17 3.9 20 8.4 20 14.5 20 19.6 16.4 23 12 23Z') : null;
  function drawThumb(el, t, id) {
    const g = el.getContext('2d'), s = el.width;
    g.clearRect(0, 0, s, s); g.save();
    if (t === 'court') { thumbCourt(g, s, id); g.restore(); return; }
    g.translate(s / 2, s / 2);
    if (t === 'ball') { drawBallBody(g, s * 0.32, 0.45, BALLS[id]); }
    else if (t === 'wing') { const r = s * 0.42; g.translate(r * 0.95, r * 0.92); drawWing(g, r, -0.1, false, WINGS[id]); }
    else if (t === 'rim') {
      const rx = s * 0.37, ry = rx * RING_RY, lw = s * 0.075;
      g.translate(0, s * 0.03); ringHalf(g, rx, ry, lw, RIMS[id].pal, false); ringHalf(g, rx, ry, lw, RIMS[id].pal, true);
    } else if (t === 'trail') thumbTrail(g, s, id);
    else if (FLAME_PATH) {
      const F = FLAMES[id], Pb = F.base, k = s / 30;
      g.translate(-12 * k, -12.5 * k); g.scale(k, k);
      const gr = g.createLinearGradient(0, 2, 0, 23);
      if (F.prism) ['#ff3f7f', '#ffa53a', '#ffe36a', '#4fe08a', '#3f8cff', '#b06bff'].forEach((c, i) => gr.addColorStop(i / 5, c));
      else { gr.addColorStop(0, hex3(Pb.outer)); gr.addColorStop(0.45, hex3(Pb.mid)); gr.addColorStop(0.8, hex3(Pb.inner)); gr.addColorStop(1, hex3(Pb.core)); }
      g.shadowColor = hex3(F.prism ? [255, 120, 200] : Pb.mid); g.shadowBlur = 10; g.fillStyle = gr; g.fill(FLAME_PATH);
    }
    g.restore();
  }
  // a trail: the equipped ball flying right, with the trail behind it
  function thumbTrail(g, s, id) {
    const r = s * 0.15, bx = s * 0.2, by = -s * 0.06, x0 = -s * 0.42, rng = E.makeRng('thumb' + id);
    const ribbon = (u0, u1, col, a) => {
      g.beginPath(); g.moveTo(x0, by); g.quadraticCurveTo((x0 + bx) / 2, by + s * 0.1 + (u0 - 0.5) * r * 1.6, bx, by + (u0 - 0.5) * r * 1.9);
      g.lineTo(bx, by + (u1 - 0.5) * r * 1.9); g.quadraticCurveTo((x0 + bx) / 2, by + s * 0.1 + (u1 - 0.5) * r * 1.6, x0, by); g.closePath();
      const gr = g.createLinearGradient(x0, 0, bx, 0); gr.addColorStop(0, 'rgba(' + col + ',0)'); gr.addColorStop(1, 'rgba(' + col + ',' + a + ')');
      g.fillStyle = gr; g.fill();
    };
    if (id === 'classic') ribbon(0, 1, eqFlame().trail, 0.55);
    else if (id === 'comet') { ribbon(0, 1, '150,200,255', 0.55); ribbon(0.28, 0.72, '235,246,255', 0.9); }
    else if (id === 'rainbow') for (let k = 0; k < 6; k++) ribbon(k / 6, (k + 1) / 6 + 0.02, RAINBOW[k], 0.85);
    else if (id !== 'none') for (let i = 0; i < 7; i++) {
      const u = i / 7, x = x0 + (bx - x0) * (0.15 + 0.75 * u), y = by + s * 0.06 * Math.sin(u * 3) + (rng() - 0.5) * r * 1.4, a = 0.3 + 0.7 * u, sz = s * (0.025 + 0.025 * u);
      g.globalAlpha = a;
      if (id === 'sparkle') { const q = sz * 0.3; g.fillStyle = i % 3 ? '#ffffff' : '#ffe08a'; g.beginPath(); g.moveTo(x, y - sz * 1.6); g.lineTo(x + q, y - q); g.lineTo(x + sz * 1.6, y); g.lineTo(x + q, y + q); g.lineTo(x, y + sz * 1.6); g.lineTo(x - q, y + q); g.lineTo(x - sz * 1.6, y); g.lineTo(x - q, y - q); g.closePath(); g.fill(); }
      else if (id === 'bubbles') { g.strokeStyle = '#c4ecff'; g.lineWidth = Math.max(1, s * 0.012); g.beginPath(); g.arc(x, y - s * 0.04, sz * 1.3, 0, Math.PI * 2); g.stroke(); }
      else { g.fillStyle = ['#ffe0a8', '#ffab52', '#f27a1c'][i % 3]; g.fillRect(x - sz, y - sz, sz * 2, sz * 2); }
      g.globalAlpha = 1;
    }
    else { g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = Math.max(1, s * 0.014); g.setLineDash([s * 0.03, s * 0.04]); g.beginPath(); g.moveTo(x0 + s * 0.08, by + s * 0.05); g.quadraticCurveTo((x0 + bx) / 2, by + s * 0.1, bx - r * 1.3, by); g.stroke(); g.setLineDash([]); }
    g.save(); g.translate(bx, by); drawBallBody(g, r, 0.4, eqBall()); g.restore();
  }
  // a court: its sky, far layer and floor, framed like a window onto it
  function thumbCourt(g, s, id) {
    const A = COURT_ART[id], fy = s * 0.72, k = s / 300;
    A.sky(g, s, s * 1.05, s);
    if (A.far) { g.save(); g.translate(0, fy - A.far.h * k); g.scale(k, k); g.beginPath(); g.rect(0, 0, s / k, A.far.h); g.clip(); A.far.paint(g, A.far.tw, A.far.h); g.restore(); }
    g.save(); g.translate(0, fy); g.scale(k, k); A.floor(g, 0, s / k, 0, k * 1.4, s / k / 2, s / k); g.restore();
    const fl = g.createLinearGradient(0, 0, s, 0);
    fl.addColorStop(0, 'rgba(255,255,255,0)'); fl.addColorStop(0.5, A.edge); fl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = fl; g.fillRect(0, fy, s, Math.max(1, s / 90));
  }
  // Odds & fairness: what each ring pays on a tier, how often an average player clears each level, and how a run
  // can be checked. Opened from the Play sheet it shows the tier you have picked.
  let oddsTier = null;
  function oddsHtml() {
    const di = oddsTier == null ? prefs.di : oddsTier;
    const D = E.DIFFS[di], rows = [];
    for (let L = 1; L <= NL; L++) {
      const pt = PAY.PAYTABLE[di][L - 1];
      rows.push(`<tr><td>${L}</td><td class="r">${fmtX(pt.rim)}</td><td class="r">${fmtX(pt.swish[0])}</td><td class="r">${fmtX(pt.swish[pt.swish.length - 1])}</td><td class="r">${Math.round(avgClear(di, L) * 100)}%</td></tr>`);
    }
    return `<div class="seg odds-seg" id="oddsSeg" role="group" aria-label="Tier">${E.DIFFS.map((d, i) => `<button data-t="${i}" aria-pressed="${i === di}">${d.name}</button>`).join('')}</div>
      <div class="tbl"><table><thead><tr><th>Level</th><th class="r">Rim</th><th class="r">Swish</th><th class="r">5+ streak</th><th class="r">Avg clears</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      <div class="prose"><p>Each ring multiplies your pot. ${D.name} pays up to <b>${TOP[di]}×</b> your bet. An average player who cashes out at the first checkpoint gets back about ${Math.round(PAY.AVG_RTP[di][0] * 100)}% of their bet over time, and less the deeper they go. Skilled players do better.</p></div>
      <div class="sec-h"><h3>Fairness</h3></div>
      <div class="prose">${fairHtml()}</div>`;
  }
  function fairHtml() {
    const h = stats.history[0];
    const canVerify = h && h.serverSeed && h.seedHash;
    const last = h ? `<h3>Your last run</h3><span class="mono">hash ${h.seedHash}</span><span class="mono">seed ${h.serverSeed || 'revealed when the run ends'}</span><span class="mono">client ${h.clientSeed} · nonce ${h.nonce}</span>
      ${canVerify ? '<button class="btn btn-plain verify" id="fairVerify">Verify this run</button><div class="verify-out" id="fairOut"></div>' : ''}` : '';
    return `<p>Every ring position comes from a seed that is locked in before you tap. You see its SHA-256 hash first, and the seed itself when the run ends.</p>
      <p>Each level is built from <b>HMAC-SHA256(seed, client seed:nonce:level)</b>, and a special level from <b>HMAC-SHA256(seed, client seed:nonce:special)</b>. Every payout is checked by replaying your taps through the same physics.</p>${last}`;
  }
  function walletHtml() {
    if (!CFG.serverUrl) {
      return `<div class="tiles"><div><b>${fmtBal(wallet.balance)}</b><span>Demo SOL</span></div><div><b>${stats.runs}</b><span>Runs</span></div><div><b>${stats.best ? fmtMult(stats.best) : '–'}</b><span>Best</span></div></div>
        <div class="prose"><p>You're playing with demo SOL. Real SOL play runs through the SOL DUNK server with Phantom or Solflare.</p></div>
        <button class="btn btn-plain" id="resetBal">Reset to ${CFG.demoStart} demo SOL</button>`;
    }
    if (!bank.real || !ServerBank.token) {
      return `<div class="prose"><p>Connect a Solana wallet to play with real SOL on <b>${CFG.network}</b>.</p></div><button class="btn btn-primary" id="wConnect">Connect wallet</button>
        <p class="err" id="wErr"></p><div class="prose"><p>On a phone, open this page in the Phantom or Solflare browser.</p></div>`;
    }
    return `<div class="tiles"><div><b>${fmtBal(ServerBank.bal)}</b><span>Balance SOL</span></div><div><b>${ServerBank.address.slice(0, 4)}…${ServerBank.address.slice(-4)}</b><span>Wallet</span></div><div><b>${CFG.network}</b><span>Network</span></div></div>
      <div class="group"><div class="row"><label class="k" for="wAmt">Amount</label><label class="bet-field"><input id="wAmt" class="bet-input" inputmode="decimal" value="0.1"><span class="unit">SOL</span></label></div></div>
      <div class="actions"><button class="btn btn-plain" id="wWithdraw">Withdraw</button><button class="btn btn-green" id="wDeposit">Deposit</button></div>
      <p class="err" id="wErr"></p>`;
  }
  // trophies: the whole case, earned ones lit
  function trophiesHtml() {
    const got = ACH.filter((a) => profile.ach[a.id]).length;
    return `<p class="vsub">${got ? `${got} of ${ACH.length} earned. Each one adds XP, and some open titles for your player card.` : `None yet. Each one adds XP, and some open titles for your player card.`}</p>
      <div class="trophies">${ACH.map((a) => `<div class="tro${profile.ach[a.id] ? ' got' : ''}"><span class="ti">${ICON.medal}</span><b>${a.name}</b><span>${a.desc}</span></div>`).join('')}</div>`;
  }
  // recent runs: what each one ended as, on which tier, and what it paid
  const agoText = (t) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return m + ' min ago';
    if (m < 60 * 24) return Math.round(m / 60) + ' h ago';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  function statsHtml() {
    const rtp = stats.wagered > 0 ? (stats.returned / stats.wagered * 100).toFixed(1) + '%' : '–', net = stats.returned - stats.wagered;
    return `<div class="tiles"><div><b>${stats.runs}</b><span>Runs</span></div><div><b>${rtp}</b><span>Return</span></div><div><b class="${net >= 0 ? 'pos' : 'neg'}">${net >= 0 ? '+' : '−'}${fmtSol(Math.abs(net))}</b><span>Net SOL</span></div></div>
      <div class="sec-h"><h3>Best scores</h3></div>
      <div class="bests">${E.DIFFS.map((D, i) => `<div><b>${profile.best[i] || '–'}</b><span>${D.name}</span><em>${profile.deep[i] ? 'Level ' + profile.deep[i] : '&nbsp;'}</em></div>`).join('')}</div>
      <div class="sec-h"><h3>Recent runs</h3>${stats.history.length ? '<span>Newest first</span>' : ''}</div>
      ${runsHtml()}`;
  }
  function settingsHtml() {
    const sw = (k, ic, name) => `<div class="mrow-sw"><span class="mi mi-${k}">${ic}</span><span class="mn" id="sw-${k}">${name}</span><button class="switch" role="switch" data-set="${k}" aria-checked="${!!settings[k]}" aria-labelledby="sw-${k}"></button></div>`;
    return `<div class="menu-list">${sw('sound', ICON.sound, 'Sound')}${sw('haptics', ICON.buzz, 'Vibration')}</div>`;
  }
  function runsHtml() {
    if (!stats.history.length) return '<div class="empty">Your runs will show up here.</div>';
    const spName = (h) => (SP.BY[h.recipe] ? SP.BY[h.recipe].name : 'Special level');
    const what = (h) => (h.kind === 'special' ? (h.result === 'won' ? 'Cleared ' + spName(h) + ' · ' + fmtMult(h.mult) : 'Missed ' + spName(h))
      : h.result === 'bust' ? 'Out on level ' + h.level : h.result === 'maxwin' ? 'Max win · ' + fmtMult(h.mult) : h.result === 'final' ? 'All ' + NL + ' levels · ' + fmtMult(h.mult) : 'Cashed out at ' + fmtMult(h.mult));
    return `<div class="runs">${stats.history.map((h) => {
        const p = h.payout - h.bet;
        return `<div class="rr"><span class="rr-t"><b>${what(h)}</b><span>${h.kind === 'special' ? 'Special level' : E.DIFFS[h.di].name} · ${fmtBet(h.bet)} SOL · ${agoText(h.t)}</span></span><span class="rr-v num ${p >= 0 ? 'pos' : 'neg'}">${p >= 0 ? '+' : '−'}${fmtSol(Math.abs(p))}<span class="unit">SOL</span></span></div>`;
      }).join('')}</div>`;
  }
  function wirePanel(kind) {
    if (kind === 'card') wireCard();
  }
  function wirePage(kind) {
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    if (kind === 'special') on('spPlay', () => startSpecial());
    if (kind === 'pot') {
      on('potEnter', enterPot);
      on('potClose', async () => { if (!bank.pot.closeNow) return; potState = await bank.pot.closeNow(); setBalance(); renderPotRow(); refreshPot(); });
    }
    if (kind === 'odds') document.querySelectorAll('#oddsSeg button').forEach((b) => b.addEventListener('click', () => { oddsTier = +b.dataset.t; Sound.click(); renderPage(true); }));
    on('fairVerify', () => {
      const h = stats.history[0];
      if (!h || !h.serverSeed) return;
      const ok = hex(sha256(utf8(h.serverSeed))) === h.seedHash;
      const out = $('fairOut');
      if (!ok) { out.className = 'verify-out bad'; out.textContent = 'The revealed seed does not match the hash shown before the run.'; return; }
      const rows = [];
      if (h.kind === 'special') rows.push(`<li><span>Special</span><span class="mono-s">${deriveLevelSeed(h.serverSeed, h.clientSeed, h.nonce, 'special').slice(0, 16)}…</span></li>`);
      else for (let L = 1; L <= h.level; L++) rows.push(`<li><span>Level ${L}</span><span class="mono-s">${deriveLevelSeed(h.serverSeed, h.clientSeed, h.nonce, L).slice(0, 16)}…</span></li>`);
      out.className = 'verify-out good';
      out.innerHTML = `<p><b>Verified.</b> The revealed seed hashes to the value you saw before the run, so the rings were fixed before your first tap.</p><ul class="list group">${rows.join('')}</ul>`;
    });
    on('resetBal', () => {
      if (phase !== 'lobby' && phase !== 'over') { toast('Finish this run first.'); return; }
      wallet.balance = CFG.demoStart; saveAll(); refreshLobby(); renderPage(true); Sound.click(); toast('Demo balance reset to ' + CFG.demoStart + ' SOL');
    });
    on('wConnect', async () => { try { await ServerBank.connect(); bank = ServerBank; await bank.missions.state().catch(() => null); setBalance(); refreshLobby(); refreshPot(); refreshSpecial(); renderPage(true); } catch (e) { $('wErr').textContent = e.message; } });
    on('wDeposit', async () => { try { await ServerBank.deposit(parseFloat($('wAmt').value)); setBalance(); renderPage(true); toast('Deposit credited'); } catch (e) { $('wErr').textContent = e.message; } });
    on('wWithdraw', async () => { try { await ServerBank.withdraw(parseFloat($('wAmt').value)); setBalance(); renderPage(true); toast('Withdrawal sent'); } catch (e) { $('wErr').textContent = e.message; } });
  }

  // ---------------------------------------------------------------- pages
  const PAGES = {
    special: ['Today’s special', specialHtml],
    pot: ['Daily pot', potHtml],
    week: ['This week', weekHtml],
    career: ['Career', careerHtml],
    trophies: ['Trophies', trophiesHtml],
    stats: ['Stats', statsHtml],
    wallet: ['Wallet', walletHtml],
    settings: ['Settings', settingsHtml],
    how: ['How to play', howHtml],
    odds: ['Odds & fairness', oddsHtml]
  };
  const TAB_NAME = { play: 'Play', challenges: 'Challenges', profile: 'Profile', locker: 'Locker' };
  const vPg = $('vPage');
  function openPage(kind) {
    if (!PAGES[kind]) return;
    if (!ui.panel.classList.contains('hide')) closePanel();
    Sound.click();
    if (kind === 'odds' && !nav.page) oddsTier = null; // from the Play sheet or Profile: the tier you have picked
    const fresh = !nav.page;
    nav.page = kind;
    $('pgBackT').textContent = phase === 'lobby' ? TAB_NAME[nav.tab] : 'Back';
    renderPage();
    $('pgBody').scrollTop = 0;
    show(vPg, true); document.body.classList.add('page-open');
    if (fresh) nav.cover = true;
    setTimeout(() => $('pgBack').focus({ preventScroll: true }), 30);
  }
  function renderPage(keepScroll) {
    const body = $('pgBody'), y = body.scrollTop, [t, fn] = PAGES[nav.page];
    body.innerHTML = `<div class="vcol"><h2 class="vtitle" id="pgTitle">${t.replace('&', '&amp;')}</h2>${fn()}</div>`;
    body.dataset.kind = nav.page;
    wirePage(nav.page);
    body.querySelectorAll('canvas[data-t]').forEach((c) => drawThumb(c, c.dataset.t, c.dataset.id));
    if (nav.page === 'special' && specState) {
      const day = specState.day, id = specState.recipe.id;
      requestAnimationFrame(() => { const c = $('spCourse'); if (c && SP.BY[id]) drawCourse(c, SP.generate('preview|' + day, id)); });
    }
    if (keepScroll) body.scrollTop = y;
  }
  function closePage(quiet) {
    if (!nav.page) return;
    nav.page = null;
    show(vPg, false); document.body.classList.remove('page-open');
    nav.cover = nav.tab === 'profile' || nav.tab === 'challenges';
    if (phase === 'lobby') { // what the page changed (the wallet, an entry) shows on the tab underneath
      if (nav.tab === 'profile') renderProfileView();
      if (nav.tab === 'challenges') renderChallenges(true);
    }
    sheetTopC = -1;
    if (!quiet) Sound.click();
    if (phase === 'paused') setTimeout(() => $('resumeBtn').focus({ preventScroll: true }), 30);
  }
  $('pgBack').addEventListener('click', () => closePage());

  // ---------------------------------------------------------------- navigation: Play, Challenges, Profile
  // Three tabs along the bottom, in the lobby only. Play is the bet under the live arena; Challenges and Profile are
  // full pages, and the arena stops drawing behind them. The Locker opens from Profile (it stays under the Profile
  // tab, with a back button) and keeps the arena on show above the collection, so whatever you pick flies there.
  const TABS = ['play', 'challenges', 'profile', 'locker'];
  const vP = $('vProfile'), vL = $('vLocker'), vC = $('vChallenges');
  const tabOf = (t) => (t === 'locker' ? 'profile' : t);
  function setTab(t, quiet) {
    if (!TABS.includes(t)) t = 'play';
    const was = nav.tab;
    if (nav.page) { // a tab tap leaves the page; on its own tab it goes back to where the page was opened
      closePage(true);
      if (was === t && !quiet) { Sound.click(); buzz(6); return; }
    }
    if (was === 'locker' && t !== 'locker') endTry();
    nav.tab = t; document.body.dataset.tab = t;
    if (was !== t) { document.body.classList.add('instant'); requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('instant'))); }
    document.querySelectorAll('#tabbar [data-tab]').forEach((b) => {
      const on = b.dataset.tab === tabOf(t);
      b.setAttribute('aria-selected', String(on));
      if (on && tabOf(was) !== tabOf(t) && !quiet) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    });
    const inLobby = phase === 'lobby';
    show(ui.lobby, inLobby && t === 'play');
    show(vL, inLobby && t === 'locker');
    show(vP, t === 'profile'); show(vC, t === 'challenges');
    nav.cover = t === 'profile' || t === 'challenges';
    sheetTopC = -1;
    if (t === 'challenges') { if (profile.mNew) { profile.mNew = 0; saveAll(); } renderChallenges(); $('cBody').scrollTop = 0; refreshSpecial(); refreshPot(); }
    if (t === 'locker') renderLocker();
    if (t === 'profile') { renderProfileView(); if (was !== 'locker') $('pBody').scrollTop = 0; }
    lockerFx();
    syncBadges();
    if (!quiet && was !== t) { Sound.click(); buzz(6); }
  }
  // dots: Challenges for a special you haven't seen or missions finished since you last looked, Profile for new items
  function syncBadges() {
    const newSpecial = !!specState && prefs.specSeen !== specState.day;
    $('badgeC').classList.toggle('on', (newSpecial || profile.mNew > 0) && nav.tab !== 'challenges');
    $('badgeP').classList.toggle('on', profile.fresh.length > 0 && nav.tab !== 'locker');
  }
  $('lkBack').addEventListener('click', () => setTab('profile'));
  document.querySelectorAll('#tabbar [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  // full pages: the top bar turns to material once the page scrolls under it, as on iOS
  document.querySelectorAll('.view > .vscroll').forEach((el) => el.addEventListener('scroll', () => el.parentElement.classList.toggle('scrolled', el.scrollTop > 6), { passive: true }));

  // ---------------------------------------------------------------- Missions tab
  const ring = (p) => `<span class="mring${p > 0 ? '' : ' zero'}"><svg viewBox="0 0 36 36"><circle class="trk" cx="18" cy="18" r="15"/><circle class="val" cx="18" cy="18" r="15" pathLength="100" stroke-dasharray="${(Math.max(0.0001, p) * 100).toFixed(1)} 100"/></svg><span class="ck">${ICON.check}</span></span>`;
  function mRow(text, p, n, xp, done, sol, paid) {
    const right = done ? '<b>Done</b>' + (sol ? `<small class="${paid ? 'paid' : ''}">${fmtBet(sol)} SOL ${paid ? 'paid' : 'waiting'}</small>` : '')
      : `<b>+${xp} XP</b>` + (sol ? `<small>+${fmtBet(sol)} SOL</small>` : '');
    return `<div class="mrow${done ? ' done' : ''}">${ring(done ? 1 : p / n)}<span class="mt"><b>${text}</b><span>${done ? 'Done' : p + ' / ' + n}</span></span><span class="mxp">${right}</span></div>`;
  }
  // a window's SOL pays once this much has been played in it (bets on runs and special level entries)
  function needRow(mv, win) {
    const need = mv.need[win], got = mv.played[win], met = got >= need - 1e-9, when = win === 'day' ? 'today' : 'this week';
    const shown = Math.min(need, Math.floor(got * 100 + 1e-6) / 100);
    return `<div class="mneed${met ? ' met' : ''}"><div class="mn-h"><span>${met ? 'SOL rewards unlocked ' + when : 'Play ' + fmtBet(need) + ' SOL ' + when + ' to collect the SOL'}</span><b>${fmtBet(shown)} / ${fmtBet(need)} SOL</b></div>
      <div class="bar"><i style="width:${(Math.min(1, got / need) * 100).toFixed(1)}%"></i></div></div>`;
  }
  const rewardOf = (C) => { const [t, id] = C.reward.split(':'); return { t, id, u: UNLOCK_BY[C.reward] }; };
  function missionsHtml() {
    const mv = mview(), d = mv.daily, w = mv.weekly, cs = careerState();
    const wDone = w.filter((c) => c.done).length;
    const row = (page, ic, name, val) => `<button data-page="${page}"><span class="mi mi-${page}">${ic}</span><span class="mn">${name}</span><span class="mv">${val}</span><span class="chev">${ICON.chev}</span></button>`;
    return `<div class="sec-h"><h3>Daily missions</h3><span>${ICON.clock}New in ${untilMidnight()}</span></div>
      <div class="group">${needRow(mv, 'day')}${d.map((c) => mRow(dailyText(c), c.p, c.n, c.xp, c.done, c.reward, c.paid)).join('')}</div>
      <div class="menu-list">${row('week', ICON.target, 'This week', wDone + ' of ' + w.length + ' done')}${row('career', ICON.flag, 'Career', CAREER[cs.ch] ? 'Chapter ' + (cs.ch + 1) + ' of ' + CAREER.length : 'All done')}</div>`;
  }
  function weekHtml() {
    const mv = mview(), w = mv.weekly;
    return `<p class="vsub">New missions in ${untilMonday()}.</p>
      <div class="group">${needRow(mv, 'week')}${w.map((c) => mRow(weeklyText(c), c.p, c.n, c.xp, c.done, c.reward, c.paid)).join('')}</div>`;
  }
  function careerHtml() {
    const cs = careerState(), C = CAREER[cs.ch];
    let career;
    if (C) {
      const r = rewardOf(C), n = cs.done.filter(Boolean).length;
      career = `<div class="chap">
        <div class="chap-top"><span class="rew${r.t === 'court' ? ' court' : ''}"><canvas width="132" height="132" data-t="${r.t}" data-id="${r.id}"></canvas></span>
          <div><div class="chap-k">Chapter ${cs.ch + 1} of ${CAREER.length} · ${n} of 4 done</div><div class="chap-n">${C.name}</div>
          <div class="chap-r">Finish all four to unlock <b>${COS[r.t][r.id].name} ${TNAME[r.t].toLowerCase()}</b>${C.title ? ' and the <b>' + TITLE_BY[C.title].name + '</b> title' : ''}.</div></div></div>
        <div class="chap-bar"><i style="width:${(n / 4 * 100).toFixed(0)}%"></i></div>
        ${C.m.map((m, i) => mRow(careerText(m), cs.p[i], m[1], m[2], cs.done[i])).join('')}
      </div>`;
    } else career = `<div class="empty">You've finished every chapter. All the career rewards are in your locker.</div>`;
    const chapters = CAREER.map((K, i) => {
      const r = rewardOf(K), st = i < cs.ch ? 'done' : i === cs.ch ? 'now' : 'locked';
      return `<div class="chli ${st}"><span class="cs">${st === 'done' ? ICON.check : st === 'now' ? ICON.target : ICON.lock}</span><b>${i + 1}. ${K.name}</b><span class="cr">${COS[r.t][r.id].name}<canvas width="52" height="52" data-t="${r.t}" data-id="${r.id}"></canvas></span></div>`;
    }).join('');
    return `<p class="vsub">Chapters at your own pace, for XP and items you can only get here.</p>${career}<div class="chlist">${chapters}</div>`;
  }

  // ---------------------------------------------------------------- Locker tab
  // Tap anything to see it on the arena above; tap something you own to wear it. Locked items show how to get them.
  function lockerFx() { // what the arena shows while you browse: a flame burning for flames, none for trails
    nav.fx = nav.tab !== 'locker' ? null : nav.cat === 'flame' ? 4 : nav.cat === 'trail' ? 0 : null;
  }
  function endTry() {
    if (!nav.try) return;
    const t = nav.try.t; nav.try = null;
    if (t === 'court') bgEl = null;
    if (t === 'flame') applyFlameTheme();
  }
  function tryItem(t, id) {
    endTry();
    if (profile.eq[t] !== id) nav.try = { t, id };
    if (t === 'court') bgEl = null;
  }
  function renderLocker() {
    const cats = $('lkCats');
    cats.innerHTML = CATS.map((t) => {
      const fresh = profile.fresh.some((k) => k.startsWith(t + ':'));
      return `<button role="tab" data-cat="${t}" aria-selected="${t === nav.cat}"><canvas width="56" height="56"></canvas>${TNAME[t]}${fresh ? '<span class="new"></span>' : ''}</button>`;
    }).join('');
    cats.querySelectorAll('button').forEach((b) => {
      const t = b.dataset.cat;
      drawThumb(b.querySelector('canvas'), t, profile.eq[t]);
      b.addEventListener('click', () => { if (nav.cat === t) return; endTry(); nav.cat = t; lockerFx(); Sound.click(); renderLocker(); $('lkGrid').scrollTop = 0; });
    });
    const t = nav.cat, items = UNLOCKS.filter((u) => u.t === t);
    const grid = $('lkGrid');
    grid.innerHTML = items.map((u) => {
      const has = isOwned(t, u.id), eq = profile.eq[t] === u.id, sel = nav.try && nav.try.t === t && nav.try.id === u.id;
      const fresh = profile.fresh.includes(t + ':' + u.id), nm = COS[t][u.id].name;
      return `<button class="item${t === 'court' ? ' court' : ''}${has ? '' : ' locked'}${eq ? ' eq' : ''}${sel ? ' sel' : ''}" data-id="${u.id}" aria-pressed="${eq}" aria-label="${nm}, ${RARITY[u.r]}${has ? (eq ? ', equipped' : '') : ', locked: ' + unlockReq(u)}">` +
        `<canvas width="112" height="112"></canvas><span class="nm">${has ? nm : unlockReq(u)}</span>` +
        (u.r ? `<span class="rb r${u.r}"></span>` : '') + (has ? (fresh ? '<span class="new"></span>' : '') : `<span class="lock">${ICON.lock}</span>`) + '</button>';
    }).join('');
    grid.querySelectorAll('.item').forEach((b) => {
      drawThumb(b.querySelector('canvas'), t, b.dataset.id);
      b.addEventListener('click', () => lockerTap(t, b.dataset.id));
    });
    lockerInfo();
    // seen: new items lose their dot once their shelf has been opened
    const before = profile.fresh.length;
    profile.fresh = profile.fresh.filter((k) => !k.startsWith(t + ':'));
    if (profile.fresh.length !== before) { saveAll(); syncBadges(); }
  }
  function lockerInfo() {
    const t = nav.cat, id = nav.try && nav.try.t === t ? nav.try.id : profile.eq[t], u = UNLOCK_BY[t + ':' + id];
    const has = isOwned(t, id), eq = profile.eq[t] === id, nm = COS[t][id].name + ' ' + TNAME[t].toLowerCase();
    const items = UNLOCKS.filter((x) => x.t === t), own = items.filter((x) => isOwned(t, x.id)).length;
    const sub = has ? `<span class="rar r${u.r}">${RARITY[u.r]}</span> · ${own} of ${items.length} unlocked` : `<span class="rar r${u.r}">${RARITY[u.r]}</span> · ${unlockHow(u)}`;
    const act = eq ? '<button class="li-a on" tabindex="-1">Equipped</button>' : has ? '<button class="li-a" id="lkEquip">Equip</button>' : `<span class="li-a lock">${ICON.lock}Preview</span>`;
    $('lkInfo').innerHTML = `<div class="li-t"><b>${nm}</b><span class="li-s">${sub}</span></div>${act}`;
    const eb = $('lkEquip');
    if (eb) eb.addEventListener('click', () => lockerTap(t, id));
  }
  function lockerTap(t, id) {
    const has = isOwned(t, id);
    if (has) {
      endTry();
      const changed = profile.eq[t] !== id;
      profile.eq[t] = id; saveAll();
      if (t === 'flame') applyFlameTheme();
      if (t === 'court') bgEl = null;
      if (changed) { Sound.click(); buzz(10); }
    } else { tryItem(t, id); Sound.click(); }
    renderLocker(); refreshProfileHud();
  }

  // ---------------------------------------------------------------- Profile tab
  const inkFor = (hex) => { const n = parseInt(hex.slice(1), 16), l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); return l > 170 ? '#0b0f1a' : '#ffffff'; };
  const avStyle = (ci) => { const c = CARD_COLORS[ci] || CARD_COLORS[0]; return `--av:${c};--av-ink:${inkFor(c)}`; };
  const playerName = () => profile.card.name || 'Player';
  // Profile, top to bottom: who you are (card, level), how you play (stats, with trophies and recent runs a tap
  // away), settings (wallet, sound, vibration) and help (how to play, odds & fairness).
  function renderProfileView() {
    const v = lvlOf(profile.xp), T = TITLE_BY[profile.card.title] || TITLES[0];
    const got = ACH.filter((a) => profile.ach[a.id]).length, fresh = profile.fresh.length > 0;
    const row = (page, ic, name, val) => `<button data-page="${page}"><span class="mi mi-${page}">${ic}</span><span class="mn">${name}</span><span class="mv num">${val || ''}</span><span class="chev">${ICON.chev}</span></button>`;
    $('pBody').innerHTML = `<div class="vcol"><h2 class="vtitle">Profile</h2>
      <button class="pcard" id="pfCard" aria-label="Edit your player card"><span class="pav" style="${avStyle(profile.card.color)}">${emblemSvg(profile.card.emblem)}</span>
        <span class="pid"><span class="pname">${esc(playerName())}</span><span class="ptitle">${ICON.medal}${T.name}</span>
          <span class="plv"><span>Level ${v.l}</span><span class="num">${v.into} / ${v.need} XP</span></span><span class="pxp"><i style="width:${(v.into / v.need * 100).toFixed(1)}%"></i></span></span>
        <span class="chev">${ICON.chev}</span></button>
      <div class="menu-list"><button id="pfLocker"><span class="mi mi-locker">${ICON.shirt}</span><span class="mn">Locker</span><span class="mv">${fresh ? '<i class="dot" aria-label="New items"></i>' : ''}</span><span class="chev">${ICON.chev}</span></button>${row('trophies', ICON.medal, 'Trophies', got + ' of ' + ACH.length)}${row('stats', ICON.chart, 'Stats', stats.runs === 1 ? '1 run' : stats.runs + ' runs')}</div>
      <div class="menu-list">${row('wallet', ICON.wallet, 'Wallet', fmtBal(bank.balance()) + ' SOL')}${row('settings', ICON.gear, 'Settings')}</div>
      <div class="menu-list">${row('how', ICON.book, 'How to play')}${row('odds', ICON.shield, 'Odds &amp; fairness')}</div></div>`;
    $('pfCard').addEventListener('click', () => openPanel('card'));
    $('pfLocker').addEventListener('click', () => setTab('locker'));
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // the player card editor: name, emblem, colour and title
  function cardHtml() {
    const c = profile.card;
    return `<div class="pe-prev"><span class="pav" id="peAv" style="${avStyle(c.color)}">${emblemSvg(c.emblem)}</span><span class="pid"><span class="pname" id="peName">${esc(playerName())}</span><span class="ptitle" id="peTitle">${ICON.medal}${(TITLE_BY[c.title] || TITLES[0]).name}</span></span></div>
      <h3>Name</h3><label class="pe-name"><input id="peIn" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Player" value="${esc(c.name)}"><span>16 max</span></label>
      <h3>Emblem</h3><div class="pe-ems" style="${avStyle(c.color)}">${Object.keys(EMBLEMS).map((k) => `<button data-em="${k}" aria-pressed="${k === c.emblem}" aria-label="${k}">${emblemSvg(k)}</button>`).join('')}</div>
      <h3>Colour</h3><div class="pe-cols">${CARD_COLORS.map((col, i) => `<button data-col="${i}" style="background:${col}" aria-pressed="${i === c.color}" aria-label="Colour ${i + 1}"></button>`).join('')}</div>
      <h3>Title</h3><div class="pe-titles">${TITLES.map((T) => { const open = titleOpen(T); return `<button data-ti="${T.id}" aria-pressed="${T.id === c.title}"${open ? '' : ` disabled title="${titleReq(T)}"`}>${open ? '' : ICON.lock}${T.name}</button>`; }).join('')}</div>
      <p class="reset-note">Locked titles come from trophies, levels and the career.</p>`;
  }
  function wireCard() {
    const c = profile.card, redraw = () => { $('panelBody').innerHTML = cardHtml(); wireCard(); renderProfileView(); refreshProfileHud(); };
    const inp = $('peIn');
    inp.addEventListener('input', () => { c.name = inp.value.replace(/\s+/g, ' ').slice(0, 16); $('peName').textContent = c.name.trim() || 'Player'; });
    inp.addEventListener('change', () => { c.name = c.name.trim(); saveAll(); renderProfileView(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    document.querySelectorAll('#panelBody [data-em]').forEach((b) => b.addEventListener('click', () => { c.emblem = b.dataset.em; saveAll(); Sound.click(); redraw(); }));
    document.querySelectorAll('#panelBody [data-col]').forEach((b) => b.addEventListener('click', () => { c.color = +b.dataset.col; saveAll(); Sound.click(); redraw(); }));
    document.querySelectorAll('#panelBody [data-ti]').forEach((b) => b.addEventListener('click', () => { c.title = b.dataset.ti; saveAll(); Sound.click(); redraw(); }));
  }

  // ---------------------------------------------------------------- pause card
  function showPause(on) {
    const el = $('pauseCard');
    if (on) {
      $('pauseSub').textContent = run.mode === 'special' ? SP.BY[run.recipe].name + ' · ring ' + Math.min(run.st.hoops.length, run.hoops + 1) + ' of ' + run.st.hoops.length + ' · ' + fmtSol(run.prize) + ' SOL to win'
        : 'Level ' + run.level + ' · ' + fmtSol(run.bet * run.total) + ' SOL pot';
      syncSettings();
    }
    show(el, on);
  }
  $('resumeBtn').addEventListener('click', () => { if (phase === 'paused') resume(); });

  // ---------------------------------------------------------------- boot (keeps balance across a republish)
  function boot(snap) {
    if (snap && typeof snap.balance === 'number') {
      wallet.balance = snap.balance; Object.assign(stats, snap.stats || {}); Object.assign(prefs, snap.prefs || {}); Object.assign(settings, snap.settings || {});
      if (snap.profile) fixProfile(Object.assign(profile, snap.profile));
    }
    if (!(wallet.balance >= 0)) wallet.balance = CFG.demoStart;
    grantUnlocks(); syncSettings(); applyFlameTheme(); buildLobby(); setTab('play', true); refreshLobby(); setHudMode(false); refreshPot(); refreshSpecial();
    setInterval(() => { if (phase === 'lobby' && !document.hidden) { refreshPot(); if (nav.tab === 'challenges') refreshSpecial(); } }, 30000); // entrants, pot and time left move on
    attract.wait = 0;
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
    run, stats, wallet, view, E, PAY, ball, profile, nav, settings, prefs, geom: () => ({ scale, offX, offY }),
    phase: () => phase,
    dbg,
    unfreeze: () => { dbg.frozen = false; goPlay(); },
    tap: () => flapInput(),
    autoplay: (skill) => { autoBot = skill ? BOT.createBot(skill, E.makeRng('auto' + Math.random())) : null; },
    fx: (streak) => { dbg.fx = streak; }, // show the flame for a streak without touching the run
    hold: (on) => { dbg.hold = !!on; },   // stop the clock with the last frame on screen
    step: (n) => { dbg.steps = n | 0; },  // while held: play n frames of 1/60 s
    stepsLeft: () => dbg.steps | 0,
    pot: () => potState, // the challenge pot as the client sees it
    special: () => specState, // today's special level as the client sees it
    missions: () => mview(), // daily and weekly missions, with SOL and the play that unlocks it
    mode: () => run.mode,
    bal: () => bank.balance(),
    sfx: (name, args, secs) => Sound.render(name, args, secs), // a sound's samples, rendered offline
    ballScreen: () => ({ x: view.bsx, y: view.bsy }),
    equip: (t, id) => { if (COS[t] && COS[t][id]) { profile.eq[t] = id; if (t === 'flame') applyFlameTheme(); if (t === 'court') { bgEl = null; } } }, // test hook: try a skin without unlocking it
    thumb: (el, t, id) => drawThumb(el, t, id) // test hook: draw a locker picture into a canvas
  };
})();
