/* SOL DUNK — browser client. Rendering, input, audio, betting flow. */
(() => {
  'use strict';
  const E = window.DunkEngine, PAY = window.DunkPaytable, BOT = window.DunkBot, POTS = window.DunkPots, MS = window.DunkMissions, SP = window.DunkSpecial, DU = window.DunkDuel, LV = window.DunkLevels, TR = window.DunkTrophies;
  const CFG = Object.assign({ serverUrl: null, network: 'devnet', demoStart: 10, minBet: 0.001, maxBet: 100, solIconUrl: null }, window.SOL_DUNK_CONFIG || {});
  const W = E.WORLD, P = E.PHYS, DT = E.DT, NL = E.LEVELS, NH = E.HOOPS_PER_LEVEL, EV = E.EV;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const round9 = (x) => Math.round(x * 1e9) / 1e9;
  const FONT_ROUND = 'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
  const FONT_DISPLAY = '"SD Display", ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif'; // canvas numbers and labels: the display face (style.css)

  // ---------------------------------------------------------------- format
  function fmtSol(x) { const a = Math.abs(x); return x.toFixed(a >= 100 ? 2 : a >= 10 ? 3 : 4); }
  function fmtBal(x) { return x >= 1 ? x.toFixed(2) : x.toFixed(4); }
  // a display amount: fmtSol's precision without the trailing zeros, but at least two decimals (0.13, 0.10, 0.1186)
  function fmtAmt(x) { const [i, f = ''] = fmtSol(x).split('.'), t = f.replace(/0+$/, ''); return i + '.' + (t.length >= 2 ? t : (t + '00').slice(0, 2)); }
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
  if (stats.runPlayed == null) stats.runPlayed = stats.wagered || 0; // bets on regular runs (the specials open at SP.UNLOCK entries)
  const prefs = Object.assign({ di: 0, bet: 0.1 }, store.get('prefs', {}));
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
    // engine v14 has two modes (the owner asked for Easy and Hard): Easy is the old Pro and Hard the old Legend, the
    // same rings, so their records carry over; Rookie's and All-Star's best score and deepest level join the nearest
    if (NT === 2) {
      if (Array.isArray(p.lv) && p.lv.length === 4) p.lv = [p.lv[1], p.lv[3]];
      for (const k of ['best', 'deep']) if (Array.isArray(p[k]) && p[k].length === 4) p[k] = [Math.max(p[k][0] || 0, p[k][1] || 0), Math.max(p[k][2] || 0, p[k][3] || 0)];
    }
    if (!Array.isArray(p.lv) || p.lv.length !== NT) p.lv = blankLv();
    if (!Array.isArray(p.best) || p.best.length !== NT) p.best = E.DIFFS.map(() => 0);
    if (!Array.isArray(p.deep) || p.deep.length !== NT) p.deep = E.DIFFS.map(() => 0);
    if (!Array.isArray(p.owned)) p.owned = [];
    // flames, rims and courts are no longer things you own: the game's colours are fixed (Solana's)
    p.owned = p.owned.filter((k) => /^(ball|wing|trail):/.test(k));
    for (const k of ['ball:classic', 'wing:angel', 'trail:classic', 'trail:none']) if (!p.owned.includes(k)) p.owned.push(k);
    if (!Array.isArray(p.fresh)) p.fresh = [];
    p.fresh = p.fresh.filter((k) => /^(ball|wing|trail):/.test(k));
    p.ach = p.ach || {}; p.tot = Object.assign({ swish: 0, perfect: 0 }, p.tot || {});
    p.eq = Object.assign({ ball: 'classic', wing: 'angel', trail: 'classic' }, p.eq || {});
    delete p.eq.flame; delete p.eq.rim; delete p.eq.court;
    p.card = Object.assign({ name: '', emblem: 'ball', color: 0, title: 'rookie' }, p.card || {});
    p.mNew = p.mNew | 0; // missions finished since the Missions tab was last opened
    return p;
  }
  const profile = fixProfile(Object.assign({ xp: 0 }, store.get('profile', {})));
  if (profile.xpv !== 2) { // levels take more XP now: saved XP moves to the new curve at the same level, the same way through it
    profile.xp = profile.xp > 0 ? LV.fromOld(profile.xp) : 0; profile.xpv = 2; store.set('profile', profile);
  }
  if (store.get('modes', 0) < 2) { // the four old tiers become the two modes (see fixProfile)
    const M = [0, 0, 1, 1];
    prefs.di = M[prefs.di] || 0;
    for (const h of stats.history) if (h.di != null) h.di = M[h.di] || 0;
    store.set('modes', 2); saveAll();
  }
  if (!(prefs.di >= 0 && prefs.di < NT)) prefs.di = 0;

  // Flappy-Dunk-style points: rim +1, swish +2, every swish in a row +1 more (up to +6). Perfect level +10.
  const ringPoints = (o, streak) => (o === 'S' ? 1 + Math.min(streak, 5) : 1);
  const PERFECT_BONUS = 10;
  const lvlOf = LV.lvlOf; // { l, into, need }: the level curve is in src/levels.cjs, shared with the server

  // Cosmetics. The ball is always drawn at its exact hitbox size whatever the skin, and rings at their exact
  // collision size. Three categories: ball, wings and trail. None of them changes the game. The game's colours are
  // Solana's and can't be changed (the owner asked for that): one flame, one rim colour and one court (below).
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
  // The flame: a base palette (on fire, 3-4 in a row) and a hotter "nova" palette (5+), edge to white-hot core.
  // Solana's colours: it burns purple, then green at full heat.
  const FLAMES = {
    sol: { name: 'Solana', base: { outer: [88, 24, 196], mid: [153, 69, 255], inner: [206, 164, 255], core: [248, 242, 255] },
      nova: { outer: [0, 150, 98], mid: [20, 241, 149], inner: [160, 255, 214], core: [240, 255, 249] } }
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
  // The rings: Solana purple steel (the checkpoint ring is green and a missed ring grey, see RING_PAL).
  const RIMS = {
    sol: { name: 'Solana', pal: { edge: '#1a0638', body: '#6424c8', mid: '#9945ff', hi: '#d2adff', spec: '250,244,255', back: '#45188e', bounce: '20,241,149' } }
  };
  // The court: the backdrop and floor, the same on every level (see COURT_ART for how it's painted).
  const COURTS = { arena: { name: 'Arena' } };
  const hex3 = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  const mix3 = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  for (const F of Object.values(FLAMES)) {
    F.trail = F.base.mid.join(',');
    F.hex = F.hex || [F.base.core, F.base.inner, F.base.mid, F.base.outer].map(hex3);
    F.novaHex = F.novaHex || [F.nova.inner, F.nova.mid, F.nova.outer, F.nova.core].map(hex3);
  }
  const COS = { ball: BALLS, wing: WINGS, trail: TRAILS };
  const CATS = ['ball', 'wing', 'trail'];
  const TNAME = { ball: 'Ball', wing: 'Wings', trail: 'Trail' };
  const DEF_EQ = { ball: 'classic', wing: 'angel', trail: 'classic' };
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
    { t: 'wing', id: 'mech', lvl: 17, r: 2 }, { t: 'wing', id: 'neon', ch: 4, r: 3 }, { t: 'wing', id: 'phoenix', ch: 3, r: 3 },
    { t: 'wing', id: 'gold', ach: 'perfect', r: 3 },
    { t: 'trail', id: 'classic', lvl: 1, r: 0 }, { t: 'trail', id: 'none', lvl: 1, r: 0 }, { t: 'trail', id: 'sparkle', ch: 0, r: 1 },
    { t: 'trail', id: 'comet', ch: 1, r: 1 }, { t: 'trail', id: 'bubbles', lvl: 9, r: 1 }, { t: 'trail', id: 'pixel', lvl: 14, r: 2 },
    { t: 'trail', id: 'rainbow', lvl: 21, r: 2 }
  ];
  const RARITY = ['Common', 'Rare', 'Epic', 'Legendary'];
  const UNLOCK_BY = Object.fromEntries(UNLOCKS.map((u) => [u.t + ':' + u.id, u]));
  const itemName = (u) => COS[u.t][u.id].name + ' ' + TNAME[u.t].toLowerCase();
  const isOwned = (t, id) => profile.owned.includes(t + ':' + id);
  // what the game draws: the equipped item, or the one being tried on in the locker (nav.try)
  const wear = (t) => (nav.try && nav.try.t === t ? nav.try.id : profile.eq[t]);
  const eqBall = () => BALLS[wear('ball')] || BALLS.classic;
  const eqWing = () => WINGS[wear('wing')] || WINGS.angel;
  const eqFlame = () => FLAMES.sol;
  const eqTrail = () => (TRAILS[wear('trail')] ? wear('trail') : 'classic');
  const eqRim = () => 'sol';
  const eqCourt = () => 'arena';
  const flameHex = (nova) => (nova ? eqFlame().novaHex : eqFlame().hex);
  const heatHex = (nova, k) => hex3((nova ? eqFlame().nova : eqFlame().base)[k || 'mid']);
  const heatRgb = (nova, k) => (nova ? eqFlame().nova : eqFlame().base)[k || 'mid'].join(',');
  const heatText = (nova) => mix3((nova ? eqFlame().nova : eqFlame().base).inner, (nova ? eqFlame().nova : eqFlame().base).core, 0.45).join(',');
  // the multiplier, callouts and streak meter burn in the flame's colours (fixed: Solana purple, then green)
  function applyFlameTheme() {
    const F = eqFlame(), st = document.documentElement.style, j = (a) => a.join(',');
    for (const [k, P] of [['heat', F.base], ['nova', F.nova]]) {
      st.setProperty('--' + k, j(P.mid)); st.setProperty('--' + k + '-hi', j(P.inner));
      st.setProperty('--' + k + '-edge', j(P.outer)); st.setProperty('--' + k + '-text', j(mix3(P.inner, P.core, 0.45)));
    }
  }

  // r = what happened in the run (see runFacts)
  // Trophies: the goals, their XP and their SOL live in src/trophies.cjs, shared with the server. r: a run's facts.
  const ACH = TR.LIST.map((t) => ({ id: t.id, name: t.name, desc: t.desc, xp: t.xp, sol: TR.reward(t),
    test: (r) => t.test(Object.assign({}, r, { hard: r.di === NT - 1, totalSwish: profile.tot.swish, nl: NL })) }));
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
    mov: (n) => `Swish ${n} moving rings`, perfect: (n) => (n === 1 ? 'Swish every ring in a level' : `Swish every ring in ${n} levels`),
    greens: (n) => (n === 1 ? 'Swish a green ring' : `Swish ${n} green rings`), fires: (n) => (n === 1 ? 'Catch fire' : `Catch fire ${n} times`),
    runs: (n) => `Play ${n} runs`
  };
  // Missions come in rounds of three: finishing all three opens the next round (three a day, three a week), each paying
  // more SOL once more has been bet in the window.
  const mview = () => bank.missions.view(); // MS.view: { daily, weekly (the open round), round, need, played, paid, waiting, due, next, all, .. }
  const tview = () => bank.trophies.view(); // trophy SOL: { rate, played, claimed, open, list: [{ id, reward, earned, claimed, can, more }] }
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
    novas: (n) => (n === 1 ? 'Swish 5 in a row' : `Swish 5 in a row ${n} times`),
    greens: (n) => (n === 1 ? 'Swish a green ring' : `Swish ${n} green rings`),
    runs: (n) => `Play ${n} runs`,
    days: (n) => `Finish a daily round on ${n} days`
  };
  const weeklySet = () => mview().weekly;
  const weeklyText = (c) => MTEXT[c.k](c.n, true);
  const untilMonday = () => leftOf(mview().weekEnds - Date.now());
  // [key, target, XP, sum]
  const CAREER = [
    { name: 'First bounce', reward: 'trail:sparkle', m: [['swish', 10, 30, 1], ['clears', 2, 30, 1], ['score', 15, 30, 0], ['mov', 1, 30, 1]] },
    { name: 'Heating up', reward: 'trail:comet', m: [['fires', 3, 40, 1], ['best', 4, 40, 0], ['swish', 40, 40, 1], ['points', 120, 40, 1]] },
    { name: 'Swish city', reward: 'ball:chrome', m: [['perfect', 1, 60, 1], ['mov', 10, 50, 1], ['clears', 8, 50, 1], ['score', 30, 50, 0]] },
    { name: 'Supernova', reward: 'wing:phoenix', m: [['novas', 2, 70, 1], ['swish', 100, 60, 1], ['level', 3, 60, 0], ['points', 400, 60, 1]] },
    { name: 'Clutch', reward: 'wing:neon', m: [['perfect', 3, 80, 1], ['best', 7, 80, 0], ['clears', 20, 70, 1], ['mov', 30, 70, 1]] },
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
  const CARD_COLORS = ['#9945ff']; // one colour theme: every player card's emblem sits on Solana purple
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
  const cardColor = () => CARD_COLORS[0];

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
      // claiming SOL: a bright run up with a shimmer on top; then each coin that lands in the balance pings a step higher
      claim() {
        if (!on()) return; const t = ac.currentTime;
        [1046.5, 1318.5, 1568, 2093].forEach((f, i) => { tone(f, t + i * 0.055, 0.34, 'sine', 0.06); tone(f * 2, t + i * 0.055, 0.14, 'sine', 0.014); });
        hiss(t + 0.04, 0.4, 5200, 9500, 0.7, 0.025, 'highpass');
      },
      coin(k) { if (!on()) return; const t = ac.currentTime, f = 1975.5 * Math.pow(2, Math.min(12, k * 2) / 12); tone(f, t, 0.13, 'sine', 0.045); tone(f * 1.5, t + 0.014, 0.1, 'sine', 0.016); },
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

  // ---------------------------------------------------------------- daily pot, demo (rules in src/pots.cjs)
  // The demo runs the same pot game on demo SOL: one course a day, attempts into the pot, the best three split it.
  // There are no other players in the demo, so the field is simulated, and labelled so: a few dozen of the game's own
  // autopilots, from novices to pros, each flying the day's course a few times at moments spread over the day (their
  // attempts come in as the day goes on). The real pot (ServerBank) has only real players.
  const DemoPot = {
    s: null, last: null, fee: POTS.ENTRY, cur: null, fld: null, busy: null,
    load() {
      if (this.s) return this.s;
      let s = store.get('pot', null);
      this.last = store.get('potLast', null);
      if (s && !s.seed) { // a challenge pot from before the pot was its own game: an entry in it comes back
        if (s.me) wallet.balance = round9(wallet.balance + this.fee);
        s = null; this.last = null;
      }
      const day = POTS.dayKey(Date.now());
      this.s = s && s.open != null ? s : this.fresh(day, POTS.dayStart(day), 0);
      this.save();
      return this.s;
    },
    fresh(key, open, carryIn) { return { key, open, seed: randomHex(16), theme: POTS.themeFor(key).id, carryIn, me: { attempts: 0, best: null } }; },
    save() { store.set('pot', this.s); store.set('potLast', this.last); },
    // the simulated field: each entrant's attempts and when they come in, flown once a pot (a few frames' work)
    async field() {
      const s = this.load();
      if (this.fld && this.fld.key === s.key) return this.fld.list;
      if (this.busy && this.busy.key === s.key) return this.busy.p;
      const key = s.key, p = (async () => {
        const r = POTS.rng('potfield|' + key + '|' + s.seed), close = POTS.closesAt(key), def = POTS.course(s.seed, s.theme), list = [];
        const n = 16 + Math.floor(r() * 26), SK = ['novice', 'casual', 'average', 'good', 'pro'], WT = [0.2, 0.3, 0.3, 0.15, 0.05];
        for (let i = 0; i < n; i++) {
          let u = r(), k = 0;
          while (k < 4 && u > WT[k]) { u -= WT[k]; k++; }
          const who = Array.from({ length: 8 }, () => B58[Math.floor(r() * 58)]).join(''), tries = 1 + Math.floor(r() * r() * 5), at = [];
          for (let j = 0; j < tries; j++) {
            const t = s.open + r() * (close - s.open) * 0.95, st = E.createState(def), bot = BOT.createBot(SK[k], E.makeRng('potbot|' + key + '|' + i + '|' + j)), taps = [];
            let tap = true;
            while (!st.done) { if (tap) taps.push(st.tick); E.step(st, tap); tap = BOT.decide(bot, st); }
            at.push({ t, rings: st.outcomes.length, score: DU.score(st.outcomes), taps });
          }
          list.push({ id: 'f' + i, who: who.slice(0, 4) + '…' + who.slice(4), at });
          if (i % 4 === 3) await new Promise((res) => setTimeout(res, 0));
        }
        this.fld = { key, list }; this.busy = null;
        return list;
      })();
      this.busy = { key, p };
      return p;
    },
    // everyone's best as it stands at `now` (the field's attempts come in through the day), and the player's
    entries(list, now) {
      const out = [];
      let n = 0;
      for (const f of list) {
        let best = null;
        for (const a of f.at) if (a.t <= now) { n++; if (POTS.better(a, best)) best = a; }
        if (best) out.push({ id: f.id, who: f.who, rings: best.rings, score: best.score, taps: best.taps });
      }
      const me = this.s.me;
      if (me.best) out.push({ id: 'me', who: 'You', rings: me.best.rings, score: me.best.score, taps: me.best.taps });
      return { list: POTS.standings(out), attempts: n + me.attempts };
    },
    async view() {
      await this.roll();
      const s = this.load(), list0 = await this.field(), { list, attempts } = this.entries(list0, Date.now()), T = POTS.THEME_BY[s.theme];
      const mine = list.find((e) => e.id === 'me'), top = list[0];
      return {
        key: s.key, seed: s.seed, theme: { id: T.id, name: T.name, blurb: T.blurb }, rings: POTS.RINGS, legacy: false,
        fee: this.fee, rake: POTS.RAKE, places: POTS.PLACES, pool: round9(POTS.poolOf(attempts * this.fee, s.carryIn)), carryIn: s.carryIn,
        entrants: list.length, attempts, closesAt: POTS.closesAt(s.key), cutoffMs: POTS.CUTOFF_MS, simulated: true,
        board: list.slice(0, 10).map((e) => ({ who: e.who, rings: e.rings, score: e.score, place: e.place, me: e.id === 'me' })),
        marks: list.map((e) => [e.rings, e.score]),
        leader: top ? { rings: top.rings, score: top.score, taps: top.taps, me: top.id === 'me' } : null,
        me: { attempts: s.me.attempts, best: s.me.best ? { rings: s.me.best.rings, score: s.me.best.score, taps: s.me.best.taps } : null, place: mine ? mine.place : null, blocked: false },
        last: this.last
      };
    },
    async start() {
      const v = await this.view(), s = this.s;
      if (v.closesAt - Date.now() < POTS.CUTOFF_MS) throw new Error('This pot is about to close. The next one opens at midnight UTC.');
      if (wallet.balance + 1e-12 < this.fee) throw new Error('Not enough demo SOL for the entry.');
      wallet.balance = round9(wallet.balance - this.fee);
      DemoRake.add('pot', this.fee);
      const ready = DemoMissions.play(this.fee);
      s.me.attempts++;
      this.cur = { key: s.key, seed: s.seed, theme: s.theme };
      this.save(); saveAll();
      const L = v.leader, ghost = L && !L.me ? { name: 'Leader', taps: L.taps, rings: L.rings, score: L.score } : v.me.best ? { name: 'Your best', taps: v.me.best.taps, rings: v.me.best.rings, score: v.me.best.score } : null;
      return { seed: s.seed, theme: s.theme, fee: this.fee, ghost, missions: { ready }, pot: await this.view() };
    },
    // an attempt's taps, replayed on the course it was flown on: the player's best if it beats it (and the pot's still open)
    async finish(taps) {
      const c = this.cur;
      if (!c) throw new Error('No attempt in progress');
      this.cur = null;
      await this.roll();
      const s = this.load(), f = DU.fly(POTS.course(c.seed, c.theme), taps), late = s.key !== c.key, improved = !late && POTS.better(f, s.me.best);
      if (improved) s.me.best = { rings: f.rings, score: f.score, taps: taps.slice(), at: Date.now() };
      this.save(); saveAll();
      const v = await this.view();
      return { you: { rings: f.rings, score: f.score, cleared: f.cleared }, improved, late, best: s.me.best ? { rings: s.me.best.rings, score: s.me.best.score } : null, place: v.me.place, pot: v, serverSeed: c.seed };
    },
    // close the pot once its day is over (or now, when the demo's "close now" asks, as if the day had ended), pay the
    // best three and open the next
    async roll(force) {
      const s = this.load(), now = Date.now(), close = POTS.closesAt(s.key);
      if (!force && now < close) return false;
      const list0 = await this.field();
      if (this.s !== s) return false; // closed meanwhile
      const { list, attempts } = this.entries(list0, force ? Infinity : close);
      const r = POTS.settle(attempts * this.fee, s.carryIn, list, false), mine = list.find((e) => e.id === 'me'), won = round9(r.pays.me || 0);
      if (won) wallet.balance = round9(wallet.balance + won);
      this.last = {
        key: s.key, theme: POTS.THEME_BY[s.theme].name, entrants: list.length, refunded: false, rolled: round9(r.carry),
        results: list.slice(0, POTS.PLACES.length).map((e) => ({ who: e.who, rings: e.rings, score: e.score, place: e.place, won: round9(r.pays[e.id] || 0) })),
        me: s.me.attempts ? { place: mine ? mine.place : null, rings: mine ? mine.rings : 0, won } : null
      };
      const today = POTS.dayKey(now), sameDay = String(s.key).slice(0, 10) === today;
      const key = force && sameDay ? today + '#' + ((+String(s.key).split('#')[1] || 0) + 1) : today;
      this.s = this.fresh(key, force && sameDay ? now : POTS.dayStart(today), round9(r.carry));
      this.fld = null;
      this.save(); saveAll();
      return true;
    }
  };

  // ---------------------------------------------------------------- missions, demo (rules in src/missions.cjs)
  // The same rules as the server, on demo SOL: progress from the levels the demo bank verifies, SOL released once the
  // window's play reaches its need and paid when it's claimed. The state lives in the profile.
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
    play(amount) { const r = MS.play(profile.ms, amount, Date.now(), this.need); profile.ms = r.s; profile.ms.ready = round9(profile.ms.ready); return r.ready; },
    run(levels) { const r = MS.run(profile.ms, levels, Date.now(), this.need); profile.ms = r.s; profile.ms.ready = round9(profile.ms.ready); return { done: r.done, opened: r.opened, ready: r.ready }; },
    // claim released SOL: one mission (its window and place in that window's list) or, with no window, all of it
    claim(win, i) {
      this.view();
      const r = MS.claim(profile.ms, win, i);
      if (r.error) throw new Error(r.error === 'claimed' ? 'Already claimed.' : r.error === 'locked' ? 'Finish this mission and bet its round’s need first.' : 'Mission not found.');
      const x = round9(r.amount);
      profile.ms.ready = round9(profile.ms.ready);
      if (x > 0) { wallet.balance = round9(wallet.balance + x); stats.missionSol = round9((stats.missionSol || 0) + x); }
      saveAll();
      return x;
    }
  };
  // ---------------------------------------------------------------- rakeback, demo (rules in src/levels.cjs)
  // Every bet sets a little SOL aside (20% of the house's cut of it); each level up releases it to claim.
  const DemoRake = {
    s() { profile.rb = LV.fix(profile.rb); return profile.rb; },
    view() { const s = this.s(); return { acc: s.acc, ready: s.ready, paid: s.paid }; },
    add(kind, amount) { const s = LV.add(this.s(), kind, amount); s.acc = round9(s.acc); },
    levelUp() { const s = this.s(), x = LV.release(s, false); s.acc = 0; s.ready = round9(s.ready); return x; },
    async claim() {
      const s = this.s(), x = round9(LV.claim(s));
      if (x > 0) { wallet.balance = round9(wallet.balance + x); s.paid = round9(s.paid); stats.rakeback = round9((stats.rakeback || 0) + x); saveAll(); }
      return x;
    }
  };
  // Trophy SOL on demo SOL, by the server's rule (src/trophies.cjs): a trophy earned in a run pays a little SOL, which
  // can be claimed once 0.2% of everything bet covers it. What's been claimed lives in the profile.
  const DemoTrophies = {
    state() { if (!profile.troc || typeof profile.troc !== 'object') profile.troc = {}; return { e: profile.ach, c: profile.troc, sw: profile.tot.swish }; },
    view() { return TR.view(this.state(), stats.wagered, TR.UNIT); },
    claim(id) {
      const r = TR.claim(this.state(), id, stats.wagered, TR.UNIT);
      if (r.error) throw new Error(r.error === 'more' ? 'Bet ' + fmtBet(Math.ceil(r.more * 100) / 100) + ' SOL more to claim this.' : r.error === 'claimed' ? 'Already claimed.' : 'Earn this trophy first.');
      wallet.balance = round9(wallet.balance + r.amount); stats.trophySol = round9((stats.trophySol || 0) + r.amount); saveAll();
      return { amount: r.amount, view: this.view() };
    }
  };
  // a level as the banks verify it, for missions and the pot: only the rings that counted (a max win stops at the
  // capped ring, which isn't a clear), and which of them were moving
  function verifiedLevel(def, r, capIndex) {
    const n = capIndex >= 0 ? capIndex + 1 : r.outcomes.length, o = r.outcomes.slice(0, n);
    return { outcomes: o.join(''), clear: r.result === 'clear' && capIndex < 0, mov: o.map((x, k) => (def.hoops[k].amp ? '1' : '0')).join(''), tilt: o.map((x, k) => (def.hoops[k].tilt ? '1' : '0')).join('') };
  }

  // ---------------------------------------------------------------- special levels, demo (rules in src/special.cjs)
  // Three a day, each course set for the player's level in that special (kept in the profile: up after a clear, down
  // after a miss). One attempt at a time: a fresh course from its own seed (HMAC-SHA256(serverSeed, clientSeed:nonce:
  // special)), the entry up front and the prize for clearing every ring, checked by replaying the taps, as the server does.
  const DemoSpecial = {
    cur: null, fee: SP.ENTRY,
    tally() {
      const day = SP.dayKey(Date.now()), t = store.get('special', null);
      return t && t.day === day && Array.isArray(t.tries) ? t : { day, tries: [0, 0, 0], wins: [0, 0, 0] };
    },
    view() {
      const day = SP.dayKey(Date.now()), t = this.tally();
      const unlock = { need: round9(SP.UNLOCK * this.fee), played: stats.runPlayed || 0 };
      return {
        day, fee: this.fee, closesAt: SP.closesAt(day), target: SP.TARGET, unlock,
        // each prize is on the special after the ones cleared today; all cleared, it's done until tomorrow
        specials: SP.todayFor(profile.skill, day, t.wins).map((c) => {
          const R = SP.BY[c.recipe], N = c.next && !c.done ? SP.BY[c.next] : null;
          return { slot: c.slot, x: c.x, prize: round9(this.fee * c.x), recipe: { id: R.id, name: R.name, blurb: R.blurb }, at: c.at, of: c.of, done: c.done, next: N ? { id: N.id, name: N.name } : null,
            course: { grade: c.g, rings: c.n, chance: c.chance, level: c.level, levelName: c.levelName }, me: { tries: t.tries[c.slot] || 0, wins: t.wins[c.slot] || 0 } };
        }),
        me: { blocked: false, skill: SP.rating(profile.skill), locked: unlock.played + 1e-9 < unlock.need }
      };
    },
    start(slot) {
      const v = this.view(), sp = v.specials[slot];
      if (!sp) throw new Error('There’s no such special level today');
      if (v.me.locked) throw new Error('Bet ' + fmtBet(v.unlock.need) + ' SOL in regular runs to unlock the special levels.');
      if (sp.done) throw new Error(`You’ve cleared all ${sp.of} of today’s ${sp.x}× specials. New ones come at midnight UTC.`);
      if (wallet.balance + 1e-12 < v.fee) throw new Error('Not enough demo SOL for the entry.');
      wallet.balance = round9(wallet.balance - v.fee);
      DemoRake.add('special', v.fee);
      const ready = DemoMissions.play(v.fee);
      const t = this.tally(); t.tries[slot]++; store.set('special', t);
      const serverSeed = randomHex(32), clientSeed = randomHex(8), nonce = wallet.nonce++;
      const c = this.cur = { serverSeed, clientSeed, nonce, slot, recipe: sp.recipe.id, g: sp.course.grade, n: sp.course.rings, fee: v.fee, prize: sp.prize, day: v.day, seed: deriveLevelSeed(serverSeed, clientSeed, nonce, 'special') };
      saveAll();
      return { seedHash: hex(sha256(utf8(serverSeed))), clientSeed, nonce, seed: c.seed, slot, recipe: c.recipe, grade: c.g, rings: c.n, chance: sp.course.chance, x: sp.x, fee: v.fee, prize: c.prize, missions: { ready }, special: this.view() };
    },
    finish(taps) {
      const c = this.cur;
      if (!c) throw new Error('No special level in progress');
      this.cur = null;
      const r = E.replay(SP.generate(c.seed, c.recipe, c.g, c.n), taps), won = r.result === 'clear';
      if (won) {
        wallet.balance = round9(wallet.balance + c.prize);
        const t = this.tally(); if (t.day === c.day) { t.wins[c.slot]++; store.set('special', t); }
      }
      profile.skill = SP.addSpecial(profile.skill, c.slot, won, r.outcomes.length); // that special's level moves
      saveAll();
      return { status: won ? 'won' : 'lost', payout: won ? c.prize : 0, serverSeed: c.serverSeed, outcomes: r.outcomes, special: this.view() };
    }
  };

  // ---------------------------------------------------------------- duels, demo (rules in src/duel.cjs)
  // One course, two flights, further wins; the house keeps DU.RAKE of each entry. The demo has no other players, so
  // the rival is the game's autopilot, set near the player's level: a win raises the next rival a little, a loss
  // lowers it, as matching players by rating would. The flight is checked by replaying the taps, as the server does.
  const DemoDuel = {
    cur: null,
    tally() {
      const day = SP.dayKey(Date.now()), t = store.get('duel', null) || {};
      if (t.day !== day) { t.day = day; t.w = 0; t.l = 0; t.d = 0; }
      if (typeof t.lv !== 'number') t.lv = 1.2;
      return t;
    },
    view() {
      const t = this.tally(), fee = DU.ENTRY;
      return { demo: true, fee, prize: DU.pot(Math.round(fee * 1e9)) / 1e9, rake: DU.RAKE, rings: DU.RINGS, today: { w: t.w, l: t.l, d: t.d }, last: t.last || null, waiting: [] };
    },
    start() {
      const v = this.view();
      if (wallet.balance + 1e-12 < v.fee) throw new Error('Not enough demo SOL for the entry.');
      wallet.balance = round9(wallet.balance - v.fee);
      DemoRake.add('pot', v.fee);
      const ready = DemoMissions.play(v.fee);
      const serverSeed = randomHex(32), clientSeed = randomHex(8), nonce = wallet.nonce++, seed = deriveLevelSeed(serverSeed, clientSeed, nonce, 'duel');
      // the rival's flight: the autopilot on the same course
      const t = this.tally(), rng = E.makeRng('rival|' + seed), k = Math.max(0, Math.min(SP.ANCHORS.length - 1, Math.round(t.lv + rng() - 0.5)));
      const st = E.createState(DU.generate(seed)), bot = BOT.createBot(SP.ANCHORS[k], rng), taps = [];
      let tap = true;
      while (!st.done) { if (tap) taps.push(st.tick); E.step(st, tap); tap = BOT.decide(bot, st); }
      const f = DU.flight(st);
      this.cur = { serverSeed, clientSeed, nonce, seed, fee: v.fee, rival: { name: 'Rival', taps, rings: f.rings, score: f.score, cleared: f.cleared } };
      saveAll();
      return { seedHash: hex(sha256(utf8(serverSeed))), clientSeed, nonce, seed, fee: v.fee, prize: v.prize, rival: this.cur.rival, missions: { ready }, duel: this.view() };
    },
    finish(taps, stop) {
      const c = this.cur;
      if (!c) throw new Error('No duel in progress');
      this.cur = null;
      const you = DU.fly(DU.generate(c.seed), taps, stop), cmp = DU.compare(you, c.rival);
      const payout = DU.payouts(Math.round(c.fee * 1e9), cmp).a / 1e9;
      wallet.balance = round9(wallet.balance + payout);
      const t = this.tally();
      if (cmp > 0) { t.w++; t.lv = Math.min(4, t.lv + 0.3); } else if (cmp < 0) { t.l++; t.lv = Math.max(0, t.lv - 0.3); } else t.d++;
      t.last = { status: cmp > 0 ? 'won' : cmp < 0 ? 'lost' : 'draw', you: { rings: you.rings, score: you.score }, rival: { rings: c.rival.rings, score: c.rival.score }, payout, t: Date.now() };
      store.set('duel', t); saveAll();
      return { status: t.last.status, payout, you: t.last.you, rival: t.last.rival, serverSeed: c.serverSeed, duel: this.view() };
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
      DemoRake.add('run', bet);
      const ready = DemoMissions.play(bet);
      const serverSeed = randomHex(32), clientSeed = randomHex(8), nonce = wallet.nonce++;
      saveAll();
      this.cur = { di, bet, serverSeed, clientSeed, nonce, level: 1, total: 1, streak: 0, levels: [] };
      return { seedHash: hex(sha256(utf8(serverSeed))), clientSeed, nonce, levelSeed: deriveLevelSeed(serverSeed, clientSeed, nonce, 1), missions: { ready } };
    },
    // Re-verifies the level by replaying the taps, exactly as the server does.
    async level(L, taps) {
      const c = this.cur;
      const def = E.generateLevel(deriveLevelSeed(c.serverSeed, c.clientSeed, c.nonce, L), c.di, L);
      const r = E.replay(def, taps);
      const a = E.applyLevel(PAY.PAYTABLE[c.di][L - 1], r.outcomes, c.total, E.DIFFS[c.di].maxWin, c.streak);
      c.total = a.total; c.streak = a.streak; c.level = L;
      c.levels.push(verifiedLevel(def, r, a.capped ? a.capIndex : -1));
      profile.skill = SP.addLevel(profile.skill, c.di, L, a.capped ? a.capIndex + 1 : r.outcomes.length, !a.capped && r.result !== 'clear'); // rates the player for the special levels
      const status = a.capped ? 'maxwin' : r.result === 'clear' ? (L >= NL ? 'final' : 'checkpoint') : 'bust';
      let payout = 0, missions = null;
      if (status === 'maxwin' || status === 'final') payout = this._pay();
      if (status !== 'checkpoint') { missions = DemoMissions.run(c.levels); saveAll(); } // the run is over
      return { status, total: c.total, payout, serverSeed: status === 'checkpoint' ? null : c.serverSeed, missions };
    },
    async next() { const c = this.cur; c.level++; return { levelSeed: deriveLevelSeed(c.serverSeed, c.clientSeed, c.nonce, c.level) }; },
    async cashout() { const payout = this._pay(), missions = DemoMissions.run(this.cur.levels); saveAll(); return { payout, serverSeed: this.cur.serverSeed, missions }; },
    _pay() { const c = this.cur; const payout = round9(c.bet * c.total); wallet.balance = round9(wallet.balance + payout); saveAll(); return payout; },
    pot: {
      async state() { return DemoPot.view(); },
      async start() { return DemoPot.start(); },
      async finish(taps) { return DemoPot.finish(taps); },
      async closeNow() { await DemoPot.roll(true); return DemoPot.view(); } // demo only
    },
    missions: { view: () => DemoMissions.view(), async state() { return DemoMissions.view(); }, async claim(win, i) { return DemoMissions.claim(win, i); } },
    rakeback: { view: () => DemoRake.view(), levelUp: () => DemoRake.levelUp(), claim: () => DemoRake.claim() },
    trophies: { view: () => DemoTrophies.view(), async state() { return DemoTrophies.view(); }, async claim(id) { return DemoTrophies.claim(id); } },
    special: {
      async state() { return DemoSpecial.view(); },
      async start(slot) { return DemoSpecial.start(slot); },
      async finish(taps) { return DemoSpecial.finish(taps); }
    },
    duel: { async state() { return DemoDuel.view(); }, async start() { return DemoDuel.start(); }, async finish(taps, stop) { return DemoDuel.finish(taps, stop); } }
  };

  // Real SOL: talks to server/server.mjs. Only active when SOL_DUNK_CONFIG.serverUrl is set.
  const ServerBank = {
    real: true, token: null, address: null, bal: 0, runId: null, specId: null, mv: null, modeMax: null, rb: { acc: 0, ready: 0, paid: 0 },
    // the most each mode takes right now: the server sets it from the house's bankroll
    async betLimits() { const c = await this.api('/api/config'); this.modeMax = (c.difficulties || []).map((d) => d.maxBet / 1e9); },
    async api(path, body) {
      const res = await fetch(CFG.serverUrl.replace(/\/$/, '') + path, {
        method: body ? 'POST' : 'GET',
        headers: Object.assign({ 'content-type': 'application/json' }, this.token ? { authorization: 'Bearer ' + this.token } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || ('Server error ' + res.status));
      if (typeof j.balance === 'number') this.bal = j.balance / 1e9;
      if (j.rakeback) this.rb = { acc: j.rakeback.accLamports / 1e9, ready: j.rakeback.readyLamports / 1e9, paid: j.rakeback.paidLamports / 1e9 };
      if (j.trophies && j.trophies.list) this.tv = this.tconv(j.trophies); // the server's word on trophy SOL, whenever it sends it
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
      return { status: j.status, total: j.total, payout: (j.payoutLamports || 0) / 1e9, serverSeed: j.serverSeed || null, missions: this.mfrom(j.missions) };
    },
    async next() { return this.api('/api/run/continue', { runId: this.runId }); },
    async cashout() { const j = await this.api('/api/run/cashout', { runId: this.runId }); return { payout: j.payoutLamports / 1e9, serverSeed: j.serverSeed, missions: this.mfrom(j.missions) }; },
    // the server's missions in SOL; keeps its latest view for the Missions page
    mconv(v) {
      const L = 1e9, one = (m) => Object.assign({}, m, { reward: m.rewardLamports / L, need: m.needLamports / L }), sol = (o) => ({ day: o.day / L, week: o.week / L });
      return MS.shape({ day: v.day, week: v.week, dayEnds: v.dayEnds, weekEnds: v.weekEnds, base: sol(v.baseNeedLamports), played: sol(v.playedLamports), days: v.days | 0, readyAll: (v.readyLamports || 0) / L, all: { day: v.all.day.map(one), week: v.all.week.map(one) } });
    },
    mfrom(j) {
      if (!j) return null;
      if (j.view) this.mv = this.mconv(j.view);
      return { done: j.done || [], opened: j.opened || [], ready: (j.ready || []).map((p) => Object.assign({}, p, { amount: p.lamports / 1e9 })) };
    },
    // rakeback: the server sets it aside with every bet and releases it when its own count of your XP levels up
    rakeback: { view: () => ServerBank.rb, levelUp: () => 0, async claim() { return (await ServerBank.api('/api/rakeback/claim', {})).claimedLamports / 1e9; } },
    tconv(v) {
      const L = 1e9;
      return { rate: v.rate, played: v.playedLamports / L, claimed: v.claimedLamports / L, open: v.open,
        list: v.list.map((x) => ({ id: x.id, xp: x.xp, reward: x.rewardLamports / L, earned: x.earned, claimed: x.claimedLamports / L, can: x.can, more: x.moreLamports / L })) };
    },
    trophies: {
      view() { return ServerBank.tv || TR.view(null, 0, TR.UNIT); },
      async state() { await ServerBank.api('/api/trophies'); return this.view(); },
      async claim(id) { const j = await ServerBank.api('/api/trophies/claim', { id }); return { amount: j.lamports / 1e9, view: this.view() }; }
    },
    missions: {
      view() { return ServerBank.mv || MS.view(null, Date.now()); },
      async state() { ServerBank.mv = ServerBank.mconv(await ServerBank.api('/api/missions')); return ServerBank.mv; },
      async claim(win, i) {
        const j = await ServerBank.api('/api/missions/claim', win == null ? {} : { win, i });
        if (j.missions) ServerBank.mv = ServerBank.mconv(j.missions);
        return (j.claimedLamports || 0) / 1e9;
      }
    },
    special: {
      view(j) {
        const L = 1e9;
        return {
          day: j.day, fee: j.feeLamports / L, closesAt: j.closesAt, target: j.target,
          unlock: { need: (j.unlockLamports || 0) / L, played: ((j.me && j.me.playedLamports) || 0) / L },
          specials: j.specials.map((x) => ({ slot: x.slot, x: x.x, prize: x.prizeLamports / L, recipe: x.recipe, course: x.course, me: x.me })),
          me: j.me || { blocked: false, skill: null, locked: true }
        };
      },
      async state() { return this.view(await ServerBank.api('/api/special')); },
      async start(slot) {
        const clientSeed = randomHex(8), j = await ServerBank.api('/api/special/start', { clientSeed, slot });
        ServerBank.specId = j.runId;
        return { seedHash: j.serverSeedHash, clientSeed, nonce: j.nonce, seed: j.seed, slot: j.slot, recipe: j.recipe, grade: j.grade, rings: j.rings, chance: j.chance, x: j.prizeLamports / j.feeLamports, fee: j.feeLamports / 1e9, prize: j.prizeLamports / 1e9, missions: ServerBank.mfrom(j.missions), special: this.view(j.special) };
      },
      async finish(taps) {
        const j = await ServerBank.api('/api/special/finish', { runId: ServerBank.specId, taps });
        return { status: j.status, payout: j.payoutLamports / 1e9, serverSeed: j.serverSeed, outcomes: j.outcomes, special: this.view(j.special) };
      }
    },
    duel: {
      view(j) {
        const L = 1e9, f = (x) => (x ? { ...x, payout: (x.payoutLamports || 0) / L } : null);
        return { demo: false, fee: j.feeLamports / L, prize: j.prizeLamports / L, rake: j.rake, rings: j.rings, today: j.today || { w: 0, l: 0, d: 0 }, last: f(j.last), waiting: j.waiting || [], blocked: !!j.blocked };
      },
      async state() { return this.view(await ServerBank.api('/api/duel')); },
      async start() {
        const j = await ServerBank.api('/api/duel/start', { clientSeed: randomHex(8) });
        ServerBank.duelId = j.runId;
        return { seedHash: j.serverSeedHash, clientSeed: j.clientSeed, nonce: j.nonce, seed: j.seed, fee: j.feeLamports / 1e9, prize: j.prizeLamports / 1e9, rival: j.rival || null, missions: ServerBank.mfrom(j.missions), duel: this.view(j.duel) };
      },
      async finish(taps, stop) {
        const j = await ServerBank.api('/api/duel/finish', { runId: ServerBank.duelId, taps, stop: stop == null ? undefined : stop });
        return { status: j.status, payout: (j.payoutLamports || 0) / 1e9, you: j.you, rival: j.rival || null, serverSeed: j.serverSeed || '', duel: this.view(j.duel) };
      }
    },
    pot: {
      view(j) {
        const m = (x) => (x || 0) / 1e9, L = j.last;
        return {
          key: j.key, seed: j.seed, theme: j.theme, rings: j.rings, legacy: !!j.legacy, fee: m(j.feeLamports), rake: j.rake, places: j.places,
          pool: m(j.poolLamports), carryIn: m(j.carryInLamports), entrants: j.entrants, attempts: j.attempts, closesAt: j.closesAt, cutoffMs: j.cutoffMs, simulated: false,
          board: j.board || [], marks: j.marks || [], leader: j.leader || null, me: j.me || null,
          last: L ? { key: L.key, theme: L.theme, entrants: L.entrants, refunded: !!L.refunded, rolled: m(L.rolledLamports), results: (L.results || []).map((r) => ({ who: r.who, rings: r.rings, score: r.score, place: r.place, won: m(r.wonLamports) })), me: L.me ? { place: L.me.place, rings: L.me.rings, won: m(L.me.wonLamports) } : null } : null
        };
      },
      async state() { return this.view(await ServerBank.api('/api/pot')); },
      async start() {
        const j = await ServerBank.api('/api/pot/start', {});
        ServerBank.potId = j.runId;
        return { seed: j.seed, theme: j.theme, fee: j.feeLamports / 1e9, ghost: j.ghost || null, missions: ServerBank.mfrom(j.missions), pot: this.view(j.pot) };
      },
      async finish(taps) {
        const j = await ServerBank.api('/api/pot/finish', { runId: ServerBank.potId, taps });
        return { you: j.you, improved: !!j.improved, late: !!j.late, best: j.best || null, place: j.place, pot: this.view(j.pot), serverSeed: j.serverSeed || '' };
      }
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
  // Practice: a free run on a real course. Nothing is at stake and nothing is recorded (no SOL, XP, missions, trophies,
  // stats, pot or special-level rating). Each level is checked by the same replay, so it plays exactly like a run.
  const PracticeBank = {
    cur: null,
    async start(di) {
      const serverSeed = randomHex(32), clientSeed = randomHex(8);
      this.cur = { di, serverSeed, clientSeed, nonce: 0, level: 1, total: 1, streak: 0 };
      return { seedHash: hex(sha256(utf8(serverSeed))), clientSeed, nonce: 0, levelSeed: deriveLevelSeed(serverSeed, clientSeed, 0, 1), missions: null };
    },
    async level(L, taps) {
      const c = this.cur, def = E.generateLevel(deriveLevelSeed(c.serverSeed, c.clientSeed, c.nonce, L), c.di, L), r = E.replay(def, taps);
      const a = E.applyLevel(PAY.PAYTABLE[c.di][L - 1], r.outcomes, c.total, E.DIFFS[c.di].maxWin, c.streak);
      c.total = a.total; c.streak = a.streak; c.level = L;
      const status = a.capped ? 'maxwin' : r.result === 'clear' ? (L >= NL ? 'final' : 'checkpoint') : 'bust';
      return { status, total: c.total, payout: 0, serverSeed: status === 'checkpoint' ? null : c.serverSeed, missions: null };
    },
    async next() { const c = this.cur; c.level++; return { levelSeed: deriveLevelSeed(c.serverSeed, c.clientSeed, c.nonce, c.level) }; },
    async cashout() { return { payout: 0, serverSeed: this.cur.serverSeed, missions: null }; }
  };
  const runBank = () => (run.mode === 'practice' ? PracticeBank : bank); // the bank the run in progress talks to
  const practicing = () => run.mode === 'practice';
  const course = () => run.mode === 'special' || run.mode === 'duel' || run.mode === 'pot'; // one long course with no checkpoints

  // ---------------------------------------------------------------- canvas & view
  // The client shows a 352-unit-wide window of the 400-unit world (a little zoomed in),
  // world y from -10 to 680. Physics never depends on this.
  const VIEW_W = 352, VIEW_TOP = -10, VIEW_BOT = 680, VIEW_H = VIEW_BOT - VIEW_TOP, BALL_SX = 56; // the ball sits about 16% in, so more of the course shows ahead (76 before engine v13 spread the rings out)
  const RV = P.R; // drawn ball radius = collision radius
  const cv = $('game'), cx = cv.getContext('2d');
  let vw = 0, vh = 0, dpr = 1, scale = 1, offX = 0, offY = 0;
  // A run's window onto the court, in screen px: [runL, runR], with the ball at runBX. On a phone it's the play column
  // (VIEW_W wide). On a desktop it's wider (the owner asked for the play area to be wider than a phone's), but only
  // behind the ball: the window's right edge stays (VIEW_W - BALL_SX) * scale ahead of the ball, the same distance
  // ahead as a phone at every level, so nobody sees more of the course coming. The payout tables are priced for that
  // view. The extra width shows the rings already passed, and the ball sits DESK_BALL_F of the way across.
  const DESK_BALL_F = 0.44;
  let runL = 0, runR = 0, runBX = 0;
  // A desktop run from the Play tab plays inside that tab's window onto the arena (the owner asked to play in the
  // preview window instead of zooming into a run screen): the sidebar and the bet stay where they are, and the
  // stage (stL, stT, stW, stH) is the window instead of the screen. The view of the course is framed into it the same
  // way: its height holds the world from VIEW_TOP to VIEW_BOT, and its right edge is a phone's distance ahead of the
  // ball, so the ball sits up to WIN_BALL_F of the way across (past that the hall carries on at the sides, as above).
  // A window too small for the cards (WIN_MIN_W x WIN_MIN_H) keeps the screen-wide run.
  const WIN_BALL_F = 0.5, WIN_MIN_W = 440, WIN_MIN_H = 520;
  let inWin = false, stL = 0, stT = 0, stW = 0, stH = 0;
  // canvas sharpness: up to 2x, stepped down if a phone can't keep up during play (see frame)
  let dprCap = 2;
  const perf = { avg: 1 / 60, slow: 0 };
  let bgEl = null;      // cached backdrop, rebuilt on resize
  let sheetTopC = -1, heroT = 0, heroB = 0, heroL = 0, heroR = 0;   // the page's window onto the arena, in screen px (layout read only when it changes)
  // Desktop: a window at least 1024 x 600 gets the desktop layout (a sidebar, the arena beside the controls, pages
  // in two columns). The run itself keeps the same window onto the court as a phone, so nobody sees further ahead.
  let desk = false;
  // a keyboard and mouse: prompts say "Press Space" and buttons show their keys
  const KB = !!(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches);
  document.body.classList.toggle('kb', KB);
  const HUD_DIRTY = { on: true }; // the in-play HUD changed shape: measure it again at the start of the next frame
  function resize() {
    HUD_DIRTY.on = true;
    dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    bgEl = null; sheetTopC = -1;
    vw = window.innerWidth; vh = window.innerHeight;
    desk = vw >= 1024 && vh >= 600; document.body.classList.toggle('desk', desk);
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    document.documentElement.style.setProperty('--col', Math.round(VIEW_W * Math.min(vw / VIEW_W, vh / VIEW_H)) + 'px'); // the play column, for the HUD and the pages
    if (inWin && !desk) { leaveWin(); show(ui.lobby, false); } // too small for the desktop layout: the run carries on screen-wide
    else if (inWin) measureHero();
    layoutStage(inWin);
  }
  // the stage, the scale and the run's window onto the court (runL..runR, the ball at runBX) for the screen or the
  // Play tab's window; keep says to keep the picture where it is when the scale changes (going into or out of the window)
  function layoutStage(keep) {
    const was = scale;
    if (inWin) { stL = heroL; stT = heroT; stW = Math.max(1, heroR - heroL); stH = Math.max(1, heroB - heroT); }
    else { stL = 0; stT = 0; stW = vw; stH = vh; }
    scale = Math.min(stW / VIEW_W, stH / VIEW_H);
    offX = stL + (stW - VIEW_W * scale) / 2;
    offY = stT + (stH - VIEW_H * scale) / 2 - VIEW_TOP * scale;
    const ahead = (VIEW_W - BALL_SX) * scale, runW = inWin ? Math.min(stW, Math.max(VIEW_W * scale, ahead / (1 - WIN_BALL_F)))
      : desk ? Math.min(vw, Math.max(VIEW_W * scale, ahead / (1 - DESK_BALL_F))) : VIEW_W * scale;
    runL = stL + (stW - runW) / 2; runR = runL + runW; runBX = runR - ahead;
    if (keep && was && was !== scale) view.zoom *= was / scale; // S = scale * zoom stays put, then eases to the new framing
    if (was !== scale) bgEl = null; // the backdrop's spotlight is as wide as the view
    const css = document.documentElement.style, px = (v) => Math.round(v) + 'px';
    css.setProperty('--runw', px(runW)); // a run's window (wider on a desktop)
    css.setProperty('--runl', px(runL)); css.setProperty('--stt', px(stT)); css.setProperty('--sth', px(stH)); css.setProperty('--stb', px(vh - stT - stH));
    HUD_DIRTY.on = true;
  }
  // into the Play tab's window for a desktop run, if it's big enough for the cards; false keeps the screen-wide run
  function enterWin() {
    measureHero();
    if (!(heroR - heroL >= WIN_MIN_W && heroB - heroT >= WIN_MIN_H)) return false;
    inWin = true; document.body.classList.add('inwin');
    layoutStage(true);
    return true;
  }
  function leaveWin() {
    if (!inWin) return;
    inWin = false; document.body.classList.remove('inwin');
    layoutStage(true);
  }
  window.addEventListener('resize', resize);
  resize();

  // The court: one backdrop for every level (no per-level colours), painted once and cached: a sky painted in
  // screen space, the courtside crowd and LED board behind the court (drawArena), and a floor drawn each frame.
  // Black and Solana purple, and dark, so the rings and the ball carry the colour.
  const EDGE = '#06040b', EDGE0 = 'rgba(6,4,11,0)';
  function vignette(g, vw, vh, a) {
    const vg = g.createRadialGradient(vw / 2, vh * 0.45, Math.min(vw, vh) * 0.3, vw / 2, vh * 0.45, Math.max(vw, vh) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,' + (a || 0.5) + ')');
    g.fillStyle = vg; g.fillRect(0, 0, vw, vh);
  }
  function vgrad(g, vh, stops) { const l = g.createLinearGradient(0, 0, 0, vh); stops.forEach(([t, c]) => l.addColorStop(t, c)); return l; }
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
  const COURT_ART = {
    arena: {
      light: '153,69,255', edge: 'rgba(255,255,255,0.32)',
      sky(g, vw, vh, playW) {
        const rgb = this.light;
        // night above, and the hall's haze gathering low over the court: the top stays near black, so the ball,
        // the rings and the HUD's numbers are what's lit
        g.fillStyle = vgrad(g, vh, [[0, '#030207'], [0.38, '#06040d'], [0.74, '#0c0719'], [0.9, '#120a26'], [1, EDGE]]); g.fillRect(0, 0, vw, vh);
        // one spotlight from above: a narrow, soft violet beam down the middle of the play area
        const bh = vh * 0.98;
        g.save(); g.translate(vw / 2, -vh * 0.08); g.scale(Math.min(1, 0.5 * playW / bh), 1);
        const bm = g.createRadialGradient(0, 0, 0, 0, 0, bh);
        bm.addColorStop(0, 'rgba(196,168,255,0.2)'); bm.addColorStop(0.5, 'rgba(170,130,255,0.06)'); bm.addColorStop(1, 'rgba(170,130,255,0)');
        g.fillStyle = bm; g.beginPath(); g.arc(0, 0, bh, 0, Math.PI * 2); g.fill(); g.restore();
        // where the beam lands: a wide pool of violet light on the far side of the court
        g.save(); g.translate(vw / 2, vh * 0.9); g.scale(1, Math.min(0.42, 0.46 * vh / vw));
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, vw * 0.9);
        rg.addColorStop(0, 'rgba(' + rgb + ',0.3)'); rg.addColorStop(0.5, 'rgba(' + rgb + ',0.09)'); rg.addColorStop(1, 'rgba(' + rgb + ',0)');
        g.fillStyle = rg; g.beginPath(); g.arc(0, 0, vw * 0.9, 0, Math.PI * 2); g.fill(); g.restore();
        vignette(g, vw, vh, 0.42);
      },
      // behind the court: the courtside crowd and the LED board (drawArena)
      farDraw: (c, left, width) => drawArena(c, left, width),
      floor(c, x0, w, F, S, mid, width) {
        floorBase(c, x0, w, F, this.light, 0.34, 'rgba(20,12,38,0.98)');
        recede(c, x0, w, F, mid, 34, 'rgba(190,160,255,0.085)', S);
        floorFade(c, x0, w, F);
        // the spotlight's reflection on the polished boards, under the middle of the view
        c.save(); c.beginPath(); c.rect(x0, F, w, 200); c.clip();
        c.translate(mid, F + 16); c.scale(1, 0.12);
        const sr = width * 0.44, sheen = c.createRadialGradient(0, 0, 0, 0, 0, sr);
        sheen.addColorStop(0, 'rgba(206,176,255,0.2)'); sheen.addColorStop(1, 'rgba(206,176,255,0)');
        c.fillStyle = sheen; c.beginPath(); c.arc(0, 0, sr, 0, Math.PI * 2); c.fill(); c.restore();
      }
    }
  };
  const courtArt = () => COURT_ART[eqCourt()];
  const glowRgb = () => courtArt().light;
  function backdrop() {
    if (bgEl) return bgEl;
    const el = document.createElement('canvas'), A = courtArt(), k = 0.5; // soft gradients only: half resolution is enough
    el.width = Math.max(2, Math.round(vw * k)); el.height = Math.max(2, Math.round(vh * k));
    const g = el.getContext('2d');
    g.scale(el.width / vw, el.height / vh);
    A.sky(g, vw, vh, Math.min(vw, VIEW_W * scale));
    return (bgEl = el);
  }
  // behind the court: the courtside crowd and the LED board
  function drawFar(c, left, width) { courtArt().farDraw(c, left, width); }
  // Text drawn on the canvas during play (ring labels, the checkpoint label, BEST, the LED board, the 8-ball) is
  // rasterised once per string, size and colour and then just stamped, so a frame never sets a canvas font:
  // setting one can make the browser recompute the page's styles in the middle of the frame, and on a phone that
  // shows up as a hitch right when something scores.
  const TXT = new Map();
  const newCanvas = (w, h) => { const el = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : document.createElement('canvas'); el.width = w; el.height = h; return el; };
  function textSprite(text, weight, px, family, color) { // px: font size in device pixels
    px = Math.max(4, Math.round(px));
    const key = text + '|' + weight + '|' + px + '|' + color + '|' + family;
    let t = TXT.get(key);
    if (t) return t;
    const font = weight + ' ' + px + 'px ' + family, pad = Math.ceil(px * 0.25) + 2;
    let el = newCanvas(8, 8), g = el.getContext('2d');
    g.font = font;
    const tw = g.measureText(text).width, w = Math.ceil(tw) + pad * 2, h = Math.ceil(px * 1.3) + pad * 2;
    el.width = w; el.height = h; g = el.getContext('2d'); // resizing resets the context
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color;
    g.fillText(text, w / 2, h / 2);
    t = { el, w, h, tw, px };
    if (TXT.size > 96) TXT.delete(TXT.keys().next().value); // the oldest goes first
    TXT.set(key, t);
    return t;
  }
  // stamp a text sprite centred on (x, y) in the current space, where k device pixels make one unit
  function drawText(c, t, x, y, k, s) {
    const sc = (s || 1) / k;
    c.drawImage(t.el, x - t.w * sc / 2, y - t.h * sc / 2, t.w * sc, t.h * sc);
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
  // The display face is inlined in style.css. Canvas text stamped before it has loaded would come out in a fallback
  // face and stay cached, so once it's in, everything is stamped again.
  if (document.fonts && document.fonts.load) document.fonts.load('800 16px "SD Display"').then(() => { TXT.clear(); mult.key = ''; }).catch(() => {});

  // ---------------------------------------------------------------- fire palette
  // Fire runs from a near-white core out to its edge colour; a 5+ swish streak burns in the flame's hotter "nova"
  // palette (Solana green after purple). The flame brings both palettes (FLAMES).
  // Going from the base palette to the full-heat one, the fire burns through white-hot on the way (orange, then
  // white-hot, then green), the way heating up looks. A straight mix of the two
  // palettes passed through a muddy grey-pink halfway.
  const palMix = { outer: [0, 0, 0], mid: [0, 0, 0], inner: [0, 0, 0], core: [0, 0, 0] };
  const HOT = { outer: 0.75, mid: 0.8, inner: 0.85, core: 1 }; // how far each layer goes toward white-hot halfway
  function flamePal(n) {
    const F = eqFlame(), A = F.base, B = F.nova;
    const lo = n < 0.5, u = lo ? n * 2 : (n - 0.5) * 2, e = u * u * (3 - 2 * u);
    for (const k in palMix) {
      const a = A[k], b = B[k], o = palMix[k], h = F.dark ? 0 : HOT[k]; // a dark flame stays dark
      for (let i = 0; i < 3; i++) {
        const w = (a[i] + b[i]) / 2 + ((A.core[i] + B.core[i]) / 2 - (a[i] + b[i]) / 2) * h; // the white-hot midpoint
        o[i] = Math.round(lo ? a[i] + (w - a[i]) * e : w + (b[i] - w) * e);
      }
    }
    return palMix;
  }
  function rgba(c3, a) { return 'rgba(' + c3[0] + ',' + c3[1] + ',' + c3[2] + ',' + clamp(a, 0, 1).toFixed(3) + ')'; }
  // Soft round glows (the fire's light, its pool on the floor, the rings' shadows): one gradient per colour, made
  // for a unit circle and drawn scaled, with the strength in globalAlpha, instead of a new gradient every frame.
  const GLOWS = new Map();
  function softGlow(c, x, y, rx, ry, c3, a, inner) {
    if (!(a > 0.002) || !(rx > 0) || !(ry > 0)) return;
    const key = (typeof c3 === 'string' ? c3 : c3.join(',')) + '|' + (inner || 0);
    let g = GLOWS.get(key);
    if (!g) {
      g = c.createRadialGradient(0, 0, inner || 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(' + key.split('|')[0] + ',1)'); g.addColorStop(1, 'rgba(' + key.split('|')[0] + ',0)');
      if (GLOWS.size > 32) GLOWS.delete(GLOWS.keys().next().value);
      GLOWS.set(key, g);
    }
    c.save(); c.translate(x, y); c.scale(rx, ry);
    c.globalAlpha = Math.min(1, a); c.fillStyle = g;
    c.beginPath(); c.arc(0, 0, 1, 0, Math.PI * 2); c.fill();
    c.restore();
  }
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
    score: 0, cleared: 0, perfect: 0, greens: 0, mov: 0, tilt: 0, fires: 0, novas: 0, lvlSw: 0, newBest: false, prog: null, lost: false };
  const RUN_FRESH = { score: 0, cleared: 0, perfect: 0, greens: 0, mov: 0, tilt: 0, fires: 0, novas: 0, lvlSw: 0, newBest: false, prog: null, lost: false };
  const attract = { st: null, bot: null, wait: 0, level: 1, streak: 0, acc: 0, tap: false };
  // navigation: which tab is open, the page pushed over it (if any), which page Challenges shows (ch), and what the
  // locker's live preview should show (fx: force a flame streak)
  const nav = { tab: 'play', page: null, cat: 'ball', fx: null, cover: false, try: null, sp: 0, seg: 'day' }; // sp: the special whose page is open
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
    versus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="12" r="5.2" fill="currentColor"/><circle cx="16.4" cy="12" r="5.2"/></svg>', // a duel: your ball and the rival's
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
  // Each trophy has its own glyph (original line drawings on the 24-unit grid, like the How to play ones), so the
  // trophy case reads at a glance instead of fifteen identical medals.
  const TRO_ICON = {
    swish1: '<ellipse cx="12" cy="16" rx="8.5" ry="3"/><path d="M12 3v11M8.6 10.6 12 14l3.4-3.4"/>',
    cp1: '<path d="M6 21.5V3.2M6 4.4c4-2.1 6.4 1.9 11.4-.1v8.2c-5 2-7.4-2-11.4.1"/>',
    fire3: '<g stroke="none">' + EMBLEMS.flame + '</g>',
    moving: '<ellipse cx="12" cy="12" rx="8.2" ry="2.9"/><path d="M12 6.2V2.4M9.9 4.3 12 2.2l2.1 2.1M12 17.8v3.8M9.9 19.7l2.1 2.1 2.1-2.1"/>',
    nova5: '<path fill="currentColor" stroke="none" d="M12 1.5l2.4 7.1 7.1 2.4-7.1 2.4L12 20.5l-2.4-7.1L2.5 11l7.1-2.4z"/>',
    perfect: '<g stroke="none">' + EMBLEMS.star + '</g>',
    tilted: '<ellipse cx="12" cy="13" rx="9" ry="3.2" transform="rotate(-24 12 13)"/><circle cx="6.2" cy="5.6" r="2.3" fill="currentColor" stroke="none"/>',
    deep4: '<path d="m6.5 6.2 5.5 5.5 5.5-5.5M6.5 12.8l5.5 5.5 5.5-5.5"/>',
    score50: '<path d="M12 19V4.2M6.2 10 12 4.2 17.8 10"/><path d="M5.5 21.6h13" opacity=".5"/>',
    double: '<text x="12" y="16.4" text-anchor="middle" font-family="SD Display, ui-rounded, sans-serif" font-weight="700" font-size="12" fill="currentColor" stroke="none">2×</text>',
    legend: '<g stroke="none">' + EMBLEMS.crown + '</g>',
    deep6: '<path d="m6.5 3.4 5.5 5.5 5.5-5.5M6.5 9.4l5.5 5.5 5.5-5.5M6.5 15.4l5.5 5.5 5.5-5.5"/>',
    streak10: '<g stroke="none">' + EMBLEMS.bolt + '</g>',
    swish100: '<ellipse cx="12" cy="6.4" rx="8" ry="2.6"/><ellipse cx="12" cy="12" rx="8" ry="2.6"/><ellipse cx="12" cy="17.6" rx="8" ry="2.6"/>'
  };
  const TRO_SVG = {};
  const troIcon = (id) => TRO_SVG[id] || (TRO_SVG[id] = TRO_ICON[id]
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + TRO_ICON[id] + '</svg>'
    : id === 'champion' ? ICON.trophy : ICON.medal);
  // numbers roll to their new value instead of jumping
  // Numbers that count up (the pot, the checkpoint pot, a win) tick in the game's own frame, after the canvas is
  // drawn, so their writes to the page come last in the frame instead of landing before the next frame's work.
  const COUNTS = [];
  function countUp(el, from, to, fmt, ms) {
    const id = (el._cu = (el._cu || 0) + 1);
    if (REDUCED || !(Math.abs(to - from) > 1e-12)) { el.textContent = fmt(to); return; }
    COUNTS.push({ el, id, from, to, fmt, ms, t0: performance.now() });
    el.textContent = fmt(from);
  }
  function tickCounts(now) {
    for (let i = COUNTS.length - 1; i >= 0; i--) {
      const u = COUNTS[i];
      if (u.el._cu !== u.id) { COUNTS.splice(i, 1); continue; } // replaced by a newer count, or set directly
      const k = clamp((now - u.t0) / u.ms, 0, 1), e = 1 - Math.pow(1 - k, 3), txt = u.fmt(u.from + (u.to - u.from) * e);
      if (u.el.textContent !== txt) u.el.textContent = txt;
      if (k >= 1) COUNTS.splice(i, 1);
    }
  }
  let potShown = 0, potUpTimer = 0;
  function fmtDelta(d) { return d >= 0.0001 ? fmtSol(d) : d >= 0.000001 ? d.toFixed(6) : '0'; }
  function setPot(animate) {
    ui.potCap.classList.toggle('prize', course() && run.mode !== 'pot');
    ui.potCap.classList.toggle('rank', run.mode === 'pot'); // a pot attempt shows where it would place, not an amount
    ui.potCap.classList.toggle('practice', practicing());
    if (practicing()) { ui.mult.textContent = fmtMult(run.total); ui.pot._cu = (ui.pot._cu || 0) + 1; ui.pot.textContent = 'Practice'; potShown = 0; return; }
    if (run.mode === 'pot') { // rings so far, and where that would place on today's board
      const pl = run.place || potPlace();
      ui.mult.textContent = String(run.hoops);
      ui.pot._cu = (ui.pot._cu || 0) + 1; ui.pot.textContent = run.hoops ? ordinal(pl) + ' place' : run.ghostOf ? ringsText(run.ghostOf.rings) + ' to beat' : 'First on the board'; potShown = 0;
      return;
    }
    if (run.mode === 'duel') { // rings against rings: yours, then the rival's so far
      ui.mult.textContent = run.hoops + (ghost ? '–' + ghost.st.outcomes.length : '');
      ui.pot._cu = (ui.pot._cu || 0) + 1; ui.pot.textContent = fmtAmt(run.prize); potShown = run.prize;
      return;
    }
    if (run.mode === 'special') { // the special pays only for clearing every ring: count the rings, show the prize
      const st = run.st;
      ui.mult.textContent = (st ? st.outcomes.length : 0) + '/' + (st ? st.hoops.length : 0);
      ui.pot._cu = (ui.pot._cu || 0) + 1; ui.pot.textContent = fmtAmt(run.prize); potShown = run.prize;
      return;
    }
    const v = run.bet * run.total;
    ui.mult.textContent = fmtMult(run.total);
    if (animate && v > potShown + 1e-12) { // a green "+gain" under the pot and a brief glow
      ui.delta.textContent = '+' + fmtDelta(v - potShown) + ' SOL';
      if (!REDUCED) hudAnim(ui.delta, 'up', [
        { opacity: 0, transform: 'translateY(-8px)', easing: 'ease-out' }, { opacity: 1, transform: 'none', offset: 0.15, easing: 'ease-out' },
        { opacity: 1, offset: 0.7, easing: 'ease-out' }, { opacity: 0, transform: 'translateY(8px)' }], { duration: 1000 });
      ui.potCap.classList.add('up'); clearTimeout(potUpTimer); potUpTimer = setTimeout(() => ui.potCap.classList.remove('up'), 700);
    }
    if (animate) countUp(ui.pot, potShown, v, fmtSol, 320); else { ui.pot._cu = (ui.pot._cu || 0) + 1; ui.pot.textContent = fmtSol(v); }
    potShown = v;
  }

  // the big multiplier warms with the swish streak, like the ball, and bumps on every ring
  function setHeat(streak) {
    ui.mult.classList.toggle('hot', streak >= 3 && streak < 5); ui.mult.classList.toggle('nova', streak >= 5);
    const f = $('heatFrame'); // the screen's edges glow with the flame while a streak burns
    if (f) { f.classList.toggle('hot', streak >= 3 && streak < 5); f.classList.toggle('nova', streak >= 5); }
  }
  // each swish on a streak flares the frame (its own layer, so the flare never fights the steady glow's fade)
  function pulseHeat(k) { const f = $('heatPulse'); if (f && !REDUCED) { f.className = run.streak >= 5 ? 'nova' : ''; hudAnim(f, 'pulse', [{ opacity: 0.35 + 0.65 * k }, { opacity: 0 }], { duration: 750, easing: 'cubic-bezier(.2,.7,.3,1)' }); } }
  // (Re)start a short HUD animation with the Web Animations API. Restarting a CSS animation by removing its class,
  // reading offsetWidth and adding it back makes the browser lay out the whole page in the middle of a frame,
  // which on a phone can drop a frame right as the ball goes through a ring. This runs on the compositor instead.
  function hudAnim(el, name, frames, opts) {
    if (!el.animate) return null;
    const a = el._anims || (el._anims = {});
    if (a[name]) a[name].cancel();
    return (a[name] = el.animate(frames, opts));
  }
  const EASE_OUT = 'cubic-bezier(.2, .9, .2, 1)';
  function bumpScore(big) { if (!REDUCED) hudAnim(ui.mult, 'bump', [{ transform: 'scale(' + (big ? 1.34 : 1.2) + ')' }, { transform: 'scale(0.97)', offset: 0.55 }, { transform: 'scale(1)' }], { duration: big ? 560 : 450, easing: EASE_OUT }); }

  // streak meter: flame, count, five heat bars (the swish pay tiers) and what the next swish pays
  const STK = { el: $('streak'), n: $('stkN'), t: $('stkT'), next: $('stkNext'), heat: $('streak').querySelectorAll('.heat i'), timer: 0, rect: null, k: 0, under: false };
  const streakName = (s) => (s >= 10 ? 'Unstoppable' : s >= 5 ? 'Supernova' : s === 4 ? 'Blazing' : s === 3 ? 'On fire' : s === 2 ? 'Double' : 'Swish');
  // the streak meter fades out of the way while the ball flies behind it
  function streakDodge() {
    const el = STK.el;
    let under = false;
    if (phase === 'play' && !ball.hidden && el.classList.contains('on') && view.bsr && STK.rect) {
      const R = STK.rect, r = view.bsr + 8;
      under = view.bsx + r > R.left && view.bsx - r < R.right && view.bsy + r > R.top && view.bsy - r < R.bottom;
    }
    if (under !== STK.under) { STK.under = under; el.classList.toggle('under', under); }
  }
  function setStreakHud(mode) {
    const s = run.streak, el = STK.el;
    clearTimeout(STK.timer);
    if (mode === 'broke') { // a different animation from the pump, so switching classes starts it without a reflow
      el.classList.remove('pump'); el.classList.add('broke');
      STK.timer = setTimeout(() => el.classList.remove('broke', 'on'), 650);
      return;
    }
    el.classList.remove('broke');
    STK.dirty = true; HUD_DIRTY.on = true;
    if (s <= 1) { el.classList.remove('on', 'pump'); return; }
    el.classList.add('on');
    el.classList.toggle('t3', s >= 3 && s < 5); el.classList.toggle('t5', s >= 5);
    STK.n.textContent = s; STK.t.textContent = streakName(s);
    STK.heat.forEach((i, k) => i.classList.toggle('f', k < Math.min(s, 5)));
    STK.next.textContent = 'Next swish ' + fmtX(E.hoopMultiplier(PAY.PAYTABLE[run.di][run.level - 1], 'S', s + 1));
    if (mode === 'pump' && !REDUCED) hudAnim(el, 'pump', [{ transform: 'scale(1)' }, { transform: 'scale(1.09)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: 350, easing: 'ease-out' });
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
    const e = EASE_OUT;
    hudAnim(CALL.el, 'pop', REDUCED
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
      : [{ opacity: 0, transform: 'scale(0.55)', easing: e }, { opacity: 1, transform: 'scale(1.1)', offset: 0.14, easing: e },
        { transform: 'scale(1)', offset: 0.26, easing: e }, { opacity: 1, transform: 'none', offset: 0.76, easing: e },
        { opacity: 0, transform: 'translateY(-16px) scale(0.98)' }], { duration: 1300 });
    setTimeout(nextCallout, 800);
  }
  function clearCallouts() { CALL.q.length = 0; }

  // Goals reached during a run (missions, achievements) get a small notice at the bottom the moment
  // they happen. They are awarded when the run ends, whatever happens next, as before.
  // One at a time. A pot notice (money) goes to the front and cuts the current one short; when several goals land
  // together each one shows for less time, so they don't trail on long after the moment.
  const NOTE = { el: $('notice'), q: [], busy: false, timer: 0, cur: null, parts: null, icons: new Map() };
  // A notice arrives in the middle of a frame (a ring scored), so it fills in text and reuses each icon, parsed once:
  // setting innerHTML there makes the browser restyle the page on the spot.
  function noteIcon(svg) {
    let n = NOTE.icons.get(svg);
    if (!n) { const t = document.createElement('template'); t.innerHTML = svg; n = t.content.firstElementChild || t.content; NOTE.icons.set(svg, n); }
    return n;
  }
  NOTE.el.innerHTML = '<span class="ni"></span><span class="nb"><span class="nt"></span><span class="ns"></span></span>';
  NOTE.parts = ['.ni', '.nt', '.ns'].map((q) => NOTE.el.querySelector(q));
  [ICON.check, ICON.flag, ICON.medal, ICON.trophy, ICON.gift, ICON.target].concat(ACH.map((a) => troIcon(a.id))).forEach((i) => { if (i) noteIcon(i); }); // parsed now, not mid-run
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
    const [ni, nt, ns] = NOTE.parts;
    el.className = n.kind;
    if (ni.firstChild !== noteIcon(n.icon)) ni.replaceChildren(noteIcon(n.icon));
    nt.textContent = n.title; ns.textContent = n.sub;
    el.classList.add('show'); // it has been hidden since the last one left, so its transition starts from there
    Sound.goal(); buzz(8);
    NOTE.timer = setTimeout(() => { el.classList.remove('show'); NOTE.timer = setTimeout(nextNotice, 320); }, n.first ? 2600 : NOTE.q.length ? 1500 : 2200);
  }
  function clearNotices() { NOTE.q.length = 0; clearTimeout(NOTE.timer); NOTE.el.classList.remove('show'); NOTE.busy = false; NOTE.cur = null; }
  // what a daily mission would stand at if the run ended now
  function dailyNow(c, r) { const v = r[c.k] || 0; return Math.min(c.n, c.sum ? c.p + v : Math.max(c.p, v)); }
  // every unfinished mission with where it would stand if the run ended now: daily first, then weekly, then career
  function openMissions(r) {
    const out = [];
    for (const c of dailySet()) if (!c.done) out.push({ id: 'd:' + c.round + c.k, kind: 'daily', text: dailyText(c), p: dailyNow(c, r), p0: c.p, n: c.n, xp: c.xp, sol: c.reward });
    for (const c of weeklySet()) if (!c.done) out.push({ id: 'w:' + c.round + c.k, kind: 'weekly', text: weeklyText(c), p: sumNow(c.p, c.n, r[c.k] || 0, c.sum), p0: c.p, n: c.n, xp: c.xp, sol: c.reward });
    const cs = careerState(), C = CAREER[cs.ch];
    if (C) C.m.forEach((m, i) => { if (!cs.done[i]) out.push({ id: 'c:' + cs.ch + ':' + i, kind: 'career', text: careerText(m), p: sumNow(cs.p[i], m[1], r[m[0]] || 0, m[3]), p0: cs.p[i], n: m[1], xp: m[2] }); });
    return out;
  }
  // the mission to chase: of those still open, the one nearest done; a daily or weekly one (they pay SOL) before a career one
  function nearestMission(r) {
    let best = null;
    for (const m of openMissions(r)) {
      if (m.p >= m.n || (run.told && run.told[m.id])) continue;
      const v = (m.sol ? 1 : 0) + m.p / m.n;
      if (!best || v > best.v + 1e-9) best = Object.assign({ v }, m);
    }
    return best;
  }
  // close enough to say so: most of the way there and only a ring or two (or a few points) short
  const nearDone = (m) => m.n > 2 && m.p < m.n && m.p / m.n >= 0.6 && m.n - m.p <= (m.n >= 40 ? 6 : m.n >= 12 ? 2 : 1);
  const KIND_NAME = { daily: 'Daily mission', weekly: 'Weekly mission', career: 'Career mission' };
  function liveGoals() {
    if (!run.told || phase === 'lobby' || run.mode !== 'run') return; // specials and practice runs don't count toward goals
    const r = runFacts(0);
    const mv = mview(), met = { daily: mv.played.day >= mv.need.day - 1e-9, weekly: mv.played.week >= mv.need.week - 1e-9 };
    for (const m of openMissions(r)) {
      if (run.told[m.id]) continue;
      if (m.p < m.n) { // nearly done, and this run moved it: one nudge per mission
        if (m.sol && !run.told['~' + m.id] && m.p > m.p0 && nearDone(m)) { run.told['~' + m.id] = 1; notice('n-near', ICON.target, 'Almost there', m.text + ' · ' + m.p + '/' + m.n + ' · ' + fmtBet(m.sol) + ' SOL'); }
        continue;
      }
      run.told[m.id] = 1; notice('n-' + m.kind, m.kind === 'career' ? ICON.flag : ICON.check, KIND_NAME[m.kind] + ' done', m.text + ' · +' + m.xp + ' XP' + (m.sol && met[m.kind] ? ' · +' + fmtBet(m.sol) + ' SOL' : ''));
    }
    for (const a of ACH) {
      if (profile.ach[a.id] || run.told[a.id] || a.id === 'double' || a.id === 'swish100' || !a.test(r)) continue;
      run.told[a.id] = 1; notice('n-ach', troIcon(a.id), a.name, a.desc + ' · +' + a.xp + ' XP');
    }
  }
  // the next goal, shown under each level's banner: the mission nearest done
  function goalLine() {
    if (course()) return '';
    if (practicing()) return 'Practice · nothing is at stake';
    const m = nearestMission(runFacts(0));
    return m ? m.text + ' · ' + m.p + '/' + m.n : '';
  }

  function shareText(head) {
    const em = { S: '🏀', F: '🔥', N: '💥', R: '⚪', X: '❌' };
    const url = CFG.shareUrl || (/^https?:/.test(location.protocol) && !/claude|usercontent|localhost/.test(location.host) ? location.origin + location.pathname : 'https://nickrileyh.github.io/sol-dunk/');
    return [run.mode === 'pot' ? 'SOL DUNK · Daily pot: ' + (POTS.THEME_BY[run.theme] ? POTS.THEME_BY[run.theme].name : '') : run.mode === 'duel' ? 'SOL DUNK · Duel' : run.mode === 'special' ? `SOL DUNK · Special: ${SP.BY[run.recipe].name}` : `SOL DUNK · ${E.DIFFS[run.di].name}`, head, `Score ${run.score} · best streak ${run.best}`, ...(run.log || []).map((lv) => lv.map((o) => em[o]).join('')), url].join('\n');
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
  // The ring pips are built once per level; after that a ring scored only changes classes on the existing ones,
  // so each pip eases to its new colour (rebuilding them every ring made them snap, and re-parsed HTML mid-frame).
  function setPips(st) {
    const n = st ? st.hoops.length : NH;
    if (ui.pips.children.length !== n) {
      let h = '';
      for (let i = 0; i < n; i++) h += '<span class="seg-i' + (i === n - 1 ? ' cp' : '') + '"></span>';
      ui.pips.innerHTML = h;
      // a special has more rings: thinner segments in about the same width
      ui.pips.style.gridTemplateColumns = n === NH ? '' : 'repeat(' + n + ', ' + Math.max(3, Math.floor((128 - (n - 1) * 2) / n)) + 'px)';
      ui.pips.style.gap = n === NH ? '' : '2px';
    }
    for (let i = 0; i < n; i++) {
      const o = st ? st.outcomes[i] : null, el = ui.pips.children[i], cl = el.classList;
      if (cl.contains('on') !== !!o) cl.toggle('on', !!o);
      if (cl.contains('sw') !== (o === 'S')) cl.toggle('sw', o === 'S');
      const now = !!(st && !st.done && i === st.next);
      if (cl.contains('now') !== now) cl.toggle('now', now);
    }
    const lv = run.mode === 'pot' ? (POTS.THEME_BY[run.theme] ? POTS.THEME_BY[run.theme].name : 'Daily pot') : run.mode === 'duel' ? (ghost ? 'You – Rival' : 'Duel') : run.mode === 'special' ? SP.BY[run.recipe].name : 'Level ' + run.level;
    if (ui.level.textContent !== lv) { ui.level.textContent = lv; HUD_DIRTY.on = true; }
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
  function setHudMode(play) { document.body.classList.toggle('hud-play', play); document.body.classList.toggle('hud-lobby', !play); HUD_DIRTY.on = true; }
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
  // the most a run can really pay on each tier: every ring a swish through all 8 levels, or the tier's cap if that's lower
  const TOP = PAY.PAYTABLE.map((rows, di) => {
    let m = 1, st = 0;
    for (const t of rows) for (let i = 0; i < NH; i++) { st = Math.min(t.swish.length, st + 1); m *= t.swish[st - 1]; }
    return Math.min(E.DIFFS[di].maxWin, Math.floor(m));
  });
  // each mode's colour (Easy blue, Hard gold) and the ink that reads on it when its tile is picked
  function bumpBet() { const f = document.querySelector('.bet-field'); if (f && !REDUCED) hudAnim(f, 'bump', [{ transform: 'scale(0.9)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.34, 1.56, .64, 1)' }); }
  function buildLobby() {
    const d = $('diffs');
    d.innerHTML = E.DIFFS.map((D, i) => `<button role="radio" id="diff${i}" data-di="${i}" aria-checked="${i === prefs.di}" aria-label="${D.name}, wins up to ${TOP[i]}×"><span class="tn">${D.name}</span><span class="tx">${TOP[i]}×</span></button>`).join('');
    d.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { if (prefs.di === +b.dataset.di) return; prefs.di = +b.dataset.di; Sound.click(); buzz(6); refreshLobby(); saveAll(); }));
    $('betDown').addEventListener('click', () => { const b = prefs.bet; stepBet(-1); Sound.click(); if (prefs.bet !== b) bumpBet(); });
    $('betUp').addEventListener('click', () => { const b = prefs.bet; stepBet(1); Sound.click(); if (prefs.bet !== b) bumpBet(); });
    const inp = $('betInput');
    inp.addEventListener('input', () => { const v = parseFloat(inp.value.replace(',', '.')); if (v > 0) { prefs.bet = v; refreshLobby(true); } else fitBet(); });
    inp.addEventListener('blur', () => { setBet(prefs.bet); });
    inp.addEventListener('focus', () => { try { inp.select(); } catch (e) { /* ignore */ } });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { inp.blur(); startRun(); } });
    $('playBtn').addEventListener('click', () => startRun());
    $('practiceBtn').addEventListener('click', () => { Sound.click(); startPractice(); });
  }
  // the amount's field is as wide as its digits, so the amount and its "SOL" sit centred as one
  function fitBet() { const inp = $('betInput'), v = inp.value, dots = (v.match(/[.,]/g) || []).length; inp.style.width = (Math.max(1, v.length - dots) * 1.04 + dots * 0.5 + 0.2).toFixed(2) + 'ch'; }
  // the biggest bet the picked mode takes: the build's limit, or with a server its live limit for that mode
  const betCap = () => (bank.modeMax && bank.modeMax[prefs.di] >= CFG.minBet ? Math.min(CFG.maxBet, bank.modeMax[prefs.di]) : CFG.maxBet);
  function setBet(v) {
    const max = Math.min(betCap(), Math.max(CFG.minBet, bank.balance()));
    prefs.bet = clamp(Math.round(v * 1e4) / 1e4, CFG.minBet, max);
    refreshLobby(); saveAll();
  }
  function refreshLobby(keepInput) {
    sheetTopC = -1;
    const di = prefs.di, D = E.DIFFS[di];
    document.querySelectorAll('#diffs button').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.di === di)));
    $('diffInfo').innerHTML = D.blurb + (profile.best[di] ? ` <span class="dim">· Best ${profile.best[di]}</span>` : '');
    const wl = $('winLine'); wl.innerHTML = `Win up to <b>${fmtBet(prefs.bet * TOP[di])} SOL</b>`;
    refreshProfileHud();
    if (!keepInput) $('betInput').value = fmtBet(prefs.bet);
    fitBet();
    $('playAmt').textContent = fmtBet(prefs.bet) + ' SOL';
    const short = prefs.bet > bank.balance() + 1e-12, broke = bank.balance() < CFG.minBet;
    const top = Math.min(betCap(), Math.max(CFG.minBet, bank.balance()));
    if (prefs.bet > betCap() + 1e-9) { prefs.bet = Math.max(CFG.minBet, Math.floor(betCap() * 1e4) / 1e4); return refreshLobby(keepInput); } // this mode takes less
    $('betDown').disabled = prefs.bet <= CFG.minBet + 1e-9; $('betUp').disabled = prefs.bet >= top - 1e-9;
    $('playBtn').disabled = short;
    const err = $('lobbyErr');
    if (broke && !bank.real) err.innerHTML = 'You\u2019re out of demo SOL. <button class="link" id="quickReset">Reset to ' + CFG.demoStart + ' SOL</button>';
    else err.textContent = short ? 'That bet is more than your balance.' : '';
    const qr = $('quickReset');
    if (qr) qr.addEventListener('click', () => { wallet.balance = CFG.demoStart; saveAll(); setBet(Math.min(prefs.bet, CFG.demoStart)); toast('Demo balance reset to ' + CFG.demoStart + ' SOL'); });
    setBalance();
  }

  // ---------------------------------------------------------------- the daily pot: its card, its page and its runs
  // A game of its own (rules in src/pots.cjs): the day's course, the same for everyone; every attempt goes into the
  // pot and the best one counts; the best three split it when the day ends.
  let potState = null, potBusy = false;
  const ordinal = (n) => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const ringsText = (n) => n + (n === 1 ? ' ring' : ' rings');
  async function refreshPot() {
    if (potBusy) return;
    potBusy = true;
    try { const last = potState && potState.last; potState = await bank.pot.state(); if (!potState.last && last) potState.last = last; } catch (e) { potState = potState || null; }
    potBusy = false;
    renderPotRow();
    // a pot you played has closed since you last looked: say how it went
    const L = potState && potState.last;
    if (L && L.me && prefs.potSeen !== L.key) {
      prefs.potSeen = L.key; saveAll();
      if (L.me.won > 0) { toast('Pot closed: you came ' + ordinal(L.me.place) + ' and won ' + fmtAmt(L.me.won) + ' SOL'); Sound.cash(); setBalance(); celebrate(130); }
      else if (L.refunded) toast('The old challenge pot closed: your entry came back');
      else toast('Pot closed: you came ' + (L.me.place ? ordinal(L.me.place) : 'in') + ' of ' + L.entrants);
    }
  }
  const leftText = (ms) => { const m = Math.max(1, Math.round(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };
  // the pot's card on the Challenges tab and its page, kept current while they're open
  function renderPotRow() {
    if (phase !== 'lobby') return;
    if (nav.page === 'pot') renderPage(true);
    if (nav.tab === 'challenges') renderChallenges(true);
  }
  // the board: the best ten (and you, if you're further down)
  function potBoard(p, n) {
    const rows = p.board.slice(0, n), mine = p.me && p.me.best && !rows.some((b) => b.me) ? { who: 'You', rings: p.me.best.rings, score: p.me.best.score, place: p.me.place, me: true } : null;
    const li = (b) => `<li class="${b.me ? 'me' : ''}${b.place <= 3 ? ' top' : ''}"><span class="pl">${ordinal(b.place)}</span><span class="who">${b.me ? 'You' : b.who}</span><span class="sc">${b.score}</span><b class="num">${b.rings}</b></li>`;
    return rows.length ? `<ol class="pboard">${rows.map(li).join('')}${mine ? '<li class="gap" aria-hidden="true">···</li>' + li(mine) : ''}</ol>` : '';
  }
  function potHtml() {
    const p = potState;
    if (!p) return '<p>The pot isn’t available right now. Try again in a moment.</p>';
    if (p.legacy) return `<div class="empty">Today’s pot is the old challenge pot. It closes at midnight UTC and every entry in it comes back. The new pot starts then.</div>`;
    const left = p.closesAt - Date.now(), T = p.theme, me = p.me || { attempts: 0 }, pays = POTS.placePays(p.pool);
    const play = me.blocked ? '<div class="empty">The pot isn’t available on this account.</div>'
      : left < (p.cutoffMs || POTS.CUTOFF_MS) ? '<div class="empty">This pot is about to close. The next one opens at midnight UTC.</div>'
      : `<button class="btn btn-primary" id="potPlay">${me.attempts ? 'Fly again' : 'Fly'} for ${fmtBet(p.fee)} SOL</button><div class="err" id="potErr" role="alert"></div>`;
    const mine = me.best ? `<div class="pot-me${me.place <= 3 ? ' done' : ''}">${me.place <= 3 ? ICON.check : ICON.target}<div><b>${ordinal(me.place)} place · ${ringsText(me.best.rings)}</b><span>Your best of ${me.attempts} ${me.attempts === 1 ? 'attempt' : 'attempts'}, score ${me.best.score}. ${me.place <= 3 ? 'If it closed now, you’d take ' + fmtAmt(pays[me.place - 1]) + ' SOL.' : 'Get into the top three to win a share.'}</span></div></div>` : '';
    const L = p.last;
    const last = L ? `<div class="pot-last"><span class="k">Last pot${L.theme ? ' · ' + L.theme : ''}</span><span>${L.refunded ? 'Every entry came back' : L.results.length ? L.results.map((r) => ordinal(r.place) + ' ' + r.who + ' · ' + ringsText(r.rings) + ' · ' + fmtAmt(r.won) + ' SOL').join('<br>') : 'Nobody played it · ' + fmtAmt(L.rolled) + ' SOL rolled over'}${L.me ? (L.me.won > 0 ? '<br><b class="won">You came ' + ordinal(L.me.place) + ' and won ' + fmtAmt(L.me.won) + ' SOL</b>' : L.me.place ? '<br>You came ' + ordinal(L.me.place) : '') : ''}</span></div>` : '';
    return `<div class="pot-goal"><span class="pot-ic">${ICON.trophy}</span><div><b>${T ? T.name : 'Today’s course'}</b><span>${T ? T.blurb : ''} · ${p.rings} rings</span></div></div>
      <div class="sp-card"><canvas class="sp-course" id="potCourse" aria-hidden="true"></canvas><div class="sp-cap">The first 16 rings of today’s course. It’s the same for everyone, all day.</div></div>
      <div class="sp-prize pot"><span class="k">In the pot</span><div class="big"><span class="num">${fmtAmt(p.pool)}</span><span class="unit">SOL</span></div></div>
      <div class="tiles places">${pays.map((v, i) => `<div><b>${fmtAmt(v)}</b><span>${ordinal(i + 1)} · ${Math.round(p.places[i] * 100)}%</span></div>`).join('')}</div>
      ${play}
      ${mine}
      ${p.board.length ? `<div class="sec-h"><h3>Today’s board</h3><span class="sec-k">Rings</span></div>${potBoard(p, 10)}` : '<div class="empty">Nobody has flown today’s course yet.</div>'}
      <div class="tiles"><div><b>${p.entrants}</b><span>Players</span></div><div><b>${p.attempts}</b><span>Attempts</span></div><div><b class="sm">${left > 0 ? leftText(left) : 'Closing'}</b><span>Left</span></div></div>
      <p class="pot-rules">Fly today’s course as often as you like. Each attempt costs ${fmtBet(p.fee)} SOL and goes into the pot, and your best one counts: the most rings, then the higher score. At midnight UTC the best three split the pot: ${p.places.map((x) => Math.round(x * 100) + '%').join(', ')}. The house keeps ${Math.round(p.rake * 100)}% of each entry. You race the leader’s best flight as a pale ball.${p.carryIn > 0 ? ' This pot includes ' + fmtAmt(p.carryIn) + ' SOL rolled over.' : ''}</p>
      ${last}
      ${p.simulated ? `<div class="pot-demo"><p>Demo: the other players are simulated. They’re the game’s autopilot, from novice to pro, flying today’s course through the day.</p><button class="btn btn-plain" id="potClose">Close this pot now</button></div>` : ''}`;
  }
  // a pot attempt: the entry goes into the pot, and the leader's best flight (or your own, if you lead) flies beside you
  async function startPot() {
    if (run.busy || (phase !== 'lobby' && phase !== 'over')) return;
    Sound.unlock();
    run.busy = true;
    let r;
    try {
      r = await bank.pot.start();
      const others = (r.pot.marks || []).map(([rings, score]) => ({ rings, score })), me = r.pot.me && r.pot.me.best;
      if (me) { const i = others.findIndex((o) => o.rings === me.rings && o.score === me.score); if (i >= 0) others.splice(i, 1); } // race the others, not your own best
      Object.assign(run, { mode: 'pot', recipe: null, theme: r.theme, potSeed: r.seed, ghostOf: r.ghost, others, myBest: me || null, prize: 0, di: 0, bet: r.fee, level: 1, total: 1, streak: 0, best: 0, hoops: 0, swishes: 0, rims: 0, seedHash: '', clientSeed: '', nonce: 0, serverSeed: r.seed, levelSeed: r.seed, place: 0 }, RUN_FRESH);
      run.log = []; run.told = {}; run.share = '';
      potState = Object.assign(r.pot, { last: potState && potState.last });
    } catch (e) {
      run.busy = false;
      const el = nav.page === 'pot' ? $('potErr') : null;
      if (el && phase === 'lobby') el.textContent = e.message; else toast(e.message);
      if (phase === 'over') { backToLobby(); setTab('challenges'); }
      return;
    }
    run.busy = false;
    stats.runs++; stats.wagered = round9(stats.wagered + run.bet); saveAll();
    enterRun(r.missions);
  }
  // where this flight would place now, among everyone else's best; said out loud as it climbs into the top three
  function potPlace() { return POTS.placeOf({ rings: run.hoops, score: run.score }, run.others || []); }
  function potLive() {
    const pl = potPlace();
    if (pl < run.place || !run.place) {
      if (run.place && pl <= 3 && !run.told['pl' + pl]) { run.told['pl' + pl] = 1; notice('n-pot', ICON.trophy, pl === 1 ? 'In the lead' : 'Into ' + ordinal(pl) + ' place', pl === 1 ? 'Best flight on today’s course so far' : 'In the money if it holds', true); }
      run.place = pl;
    }
    const b = run.myBest;
    if (b && !run.told.pb && POTS.better({ rings: run.hoops, score: run.score }, b) && run.hoops > b.rings) { run.told.pb = 1; notice('n-pot', ICON.check, 'New best', 'Past your best of ' + ringsText(b.rings), true); }
    setPot();
  }
  // the attempt is over: the bank replays it and says whether it's the player's best and where it stands
  function potFinish(how, kind) {
    phase = 'over';
    clearCallouts(); clearNotices();
    if (how === 'clear') {
      hideStreak();
      if (!REDUCED) view.shake = Math.max(view.shake, 2);
      Sound.checkpoint(); buzz([12, 40, 12]);
      ball.glide = null; ball.fall = { vx: Math.max(120, run.st.ball.vx), vy: -240, hover: true, t: 0 };
    }
    bank.pot.finish(run.taps.slice()).then((r) => {
      potState = Object.assign(r.pot, { last: potState && potState.last });
      run.serverSeed = r.serverSeed || run.potSeed;
      recordPot(r);
      const you = r.you, best = r.best, wait = REDUCED ? 200 : 650, top = r.place && r.place <= 3;
      const sub = r.late ? 'The pot had closed before this flight came in' : r.improved ? ordinal(r.place) + ' place on today’s board · score ' + you.score : best ? 'Your best: ' + ringsText(best.rings) + ' · ' + ordinal(r.place) + ' place' : '';
      const title = r.improved ? (r.place === 1 ? 'In the lead' : 'New best') : how === 'clear' ? 'Course cleared' : BUST_TITLES[kind] || 'Missed';
      if (r.improved && top) { confetti(ball.x, ball.y - 30, 40); winFx(0.8); }
      setTimeout(() => showResult(title, String(you.rings), r.improved && top ? 'win' : '', sub), r.improved && top ? 700 : wait);
    }).catch(netFail);
  }
  function recordPot(r) {
    stats.hoops += run.hoops; stats.swishes += run.swishes;
    stats.history.unshift({ t: Date.now(), kind: 'pot', theme: run.theme, di: 0, bet: run.bet, payout: 0, level: 1, mult: 0, result: r.improved ? 'best' : 'done', rings: r.you.rings, place: r.place, seedHash: '', serverSeed: run.serverSeed, clientSeed: '', nonce: 0 });
    stats.history.length = Math.min(stats.history.length, 30);
    // XP for the points, as in a special; the pot doesn't count toward missions or trophies (its entry counts as play)
    const before = lvlOf(profile.xp), steps = LV.stepsOf(profile.xp), xp = LV.specialXp(run.score, false);
    profile.tot.swish += run.swishes; profile.xp += xp;
    if (LV.stepsOf(profile.xp) > steps) bank.rakeback.levelUp();
    run.prog = { xp, runXp: xp, before, after: lvlOf(profile.xp), newBest: false, prevBest: 0, achs: [], dailies: [], weeklies: [], careers: [], chapter: null, unlocks: grantUnlocks(), paid: [] };
    saveAll(); setBalance();
  }

  // ---------------------------------------------------------------- duels: one course, two flights, further wins (rules in src/duel.cjs)
  let duelState = null;
  async function refreshDuel() {
    try { duelState = await bank.duel.state(); } catch (e) { duelState = duelState || null; }
    if (phase === 'lobby') { if (nav.page === 'duel') renderPage(true); if (nav.tab === 'challenges') renderChallenges(true); }
  }
  function duelHtml() {
    const d = duelState;
    if (!d) return '<p>Duels aren’t available right now. Try again in a moment.</p>';
    if (d.blocked) return '<div class="empty">Duels aren’t available on this account.</div>';
    const t = d.today, L = d.last, rings = (n) => n + (n === 1 ? ' ring' : ' rings');
    const how = (x) => (x.status === 'won' ? `<b class="won">you won ${fmtSol(x.payout)} SOL</b>` : x.status === 'draw' ? 'a draw, the pot was split' : x.status === 'refunded' ? 'nobody took it on, so the entry came back' : 'your rival got further');
    const last = L ? `<div class="pot-last"><span class="k">Last duel</span><span>You ${rings(L.you.rings)}${L.rival ? ' · rival ' + L.rival.rings : ''} · ${how(L)}</span></div>` : '';
    const wait = d.waiting && d.waiting.length ? `<div class="pot-me">${ICON.target}<div><b>${d.waiting.length === 1 ? 'Your mark is waiting' : d.waiting.length + ' marks are waiting'}</b><span>${d.waiting.map((w) => rings(w.rings)).join(', ')}. The next player to enter races it. If nobody does within 24 hours, the entry comes back.</span></div></div>` : '';
    return `<div class="pot-goal"><span class="pot-ic">${ICON.versus}</span><div><b>Race a rival over the same rings</b><span>Whoever gets further takes the pot</span></div></div>
      <div class="du-vs" aria-hidden="true"><span class="du-b you"></span><span class="du-n">You</span><span class="du-line"></span><span class="du-n">Rival</span><span class="du-b"></span></div>
      <div class="sp-prize pot"><span class="k">The winner takes</span><div class="big"><span class="num">${fmtAmt(d.prize)}</span><span class="unit">SOL</span></div></div>
      <button class="btn btn-primary" id="duPlay">Play for ${fmtBet(d.fee)} SOL</button><div class="err" id="duErr" role="alert"></div>
      ${wait}
      <div class="tiles"><div><b>${t.w}</b><span>Won today</span></div><div><b>${t.l}</b><span>Lost today</span></div><div><b>${d.rings}</b><span>Rings</span></div></div>
      <p class="pot-rules">You both pay ${fmtBet(d.fee)} SOL and fly the same course. It starts easy and gets harder with every ring. More rings wins. Level on rings, the better score wins. Level on both, the pot is split. Your rival shows as a pale ball beside yours. The house keeps ${Math.round(d.rake * 100)}% of each entry.</p>
      ${last}
      ${d.demo ? '<div class="pot-demo"><p>Demo: your rival is the game’s autopilot, set near your level. With real SOL you race another player’s flight.</p></div>' : ''}`;
  }

  // ---------------------------------------------------------------- Challenges tab: today's specials and the daily pot (the missions have their own tab)
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
  // a special's page (nav.sp): a sketch of the course set for the player, the prize, Play, today's tallies, the level
  // it's set for and the rules
  function specialHtml() {
    const s = specState;
    const c = s && s.specials ? s.specials[nav.sp] || s.specials[0] : null;
    if (!c) return '<div class="empty">The special levels aren’t available right now. Try again in a moment.</div>';
    const left = s.closesAt - Date.now(), pct = Math.round((s.target || SP.TARGET) * 100);
    const play = s.me && s.me.blocked ? '<div class="empty">The special levels aren’t available on this account.</div>'
      : c.done ? `<div class="group sp-lock sp-done"><b>All ${c.of} cleared today</b><p>You’ve cleared every ${c.x}× special for today. New ones come in ${left > 0 ? leftText(left) : 'a moment'}.</p></div>`
      : s.me && s.me.locked ? `<div class="group sp-lock">${unlockRow(s)}<p>Your regular runs also set the level you start at.</p></div>`
      : `<button class="btn btn-primary" id="spPlay">Play for ${fmtBet(s.fee)} SOL</button><div class="err" id="spErr" role="alert"></div>`;
    return `<div class="sp-card">
        <div class="sp-head"><div class="sp-blurb">${c.recipe.blurb} · ${c.course.rings} rings</div></div>
        <canvas class="sp-course" id="spCourse" aria-hidden="true"></canvas>
        <div class="sp-cap">A sample course. Every attempt gets a new one from its own seed.</div>
      </div>
      <div class="sp-prize"><span class="k">Clear every ring to win</span><div class="big"><span class="num">${fmtAmt(c.prize)}</span><span class="unit">SOL</span></div><span class="x">${c.x}× your ${fmtBet(s.fee)} SOL entry</span></div>
      ${play}
      <div class="tiles"><div><b>${c.me.tries}</b><span>Tries today</span></div><div><b>${Math.min(c.me.wins, c.of || c.me.wins)}<i> / ${c.of || 1}</i></b><span>Cleared today</span></div><div><b class="sm">${left > 0 ? leftText(left) : 'Soon'}</b><span>New specials</span></div></div>
      <div class="sec-h"><h3>Set for you</h3></div>
      <div class="group sp-odds">
        <div class="row"><span>Your level</span><b>${c.course.levelName || SP.levelName(c.course.level)}</b></div>
        <div class="row"><span>Players at your level clear it</span><b>${oneIn(c.course.chance)}</b></div>
      </div>
      <p class="foot">Clear it and the next course is harder. Miss and it gets a little easier.</p>
      <p class="pot-rules">Clear every ring to win the prize. Miss one and the entry is gone.${SP.BY[c.recipe.id] && SP.BY[c.recipe.id].ob ? ' Touch a wall and the attempt ends.' : ''} Clear it and a new special takes its place${c.next ? ` (next: ${c.next.name})` : ''}: ${c.of || SP.PER_SLOT} a day for each prize. Your level settles where you clear it ${oneIn(SP.TARGET / c.x)}, so over time you get back about ${pct}% of your entries, whatever your level: the house keeps about ${100 - pct}%. They open once you’ve bet ${fmtBet((s.unlock && s.unlock.need) || SP.UNLOCK * s.fee)} SOL in regular runs. New specials come every day at midnight UTC. Special rings don’t count toward missions or the pot.</p>`;
  }
  // a sketch of a course: the rings in order, how wide each is, how far it bobs, and the green finish
  function drawCourse(el, def) {
    const k = Math.min(window.devicePixelRatio || 1, 2), w = el.clientWidth || 340, ht = el.clientHeight || 132;
    el.width = Math.round(w * k); el.height = Math.round(ht * k);
    const g = el.getContext('2d'); g.setTransform(k, 0, 0, k, 0, 0); g.clearRect(0, 0, w, ht);
    const hs = def.hoops, x0 = -30, x1 = hs[hs.length - 1].x + 50, pad = 18, yT = E.Y_MIN - 70, yB = E.Y_MAX + 70;
    const sx = (x) => pad + (x - x0) / (x1 - x0) * (w - pad * 2), sy = (y) => 10 + (y - yT) / (yB - yT) * (ht - 20);
    g.lineCap = 'round';
    // the way through: a dotted line from the ball to each ring in turn
    g.strokeStyle = 'rgba(185,140,255,0.3)'; g.lineWidth = 1.4; g.setLineDash([1.5, 5]);
    g.beginPath(); g.moveTo(sx(0), sy(def.startY)); for (const h of hs) g.lineTo(sx(h.x), sy(h.y0)); g.stroke(); g.setLineDash([]);
    if (def.walls) { // walls: slabs from their top down to the floor of the sketch, with the game's purple cap
      for (const wl of def.walls) {
        const wx = sx((wl.x0 + wl.x1) / 2), wy = Math.max(6, sy(wl.y0));
        g.fillStyle = 'rgba(90,69,160,0.55)'; g.fillRect(wx - 1.8, wy, 3.6, ht - 4 - wy);
        g.fillStyle = '#9945ff'; g.fillRect(wx - 3, wy, 6, 2);
      }
    }
    const half0 = Math.max(5.5, Math.min(10, (w - pad * 2) / hs.length * 0.34)), wMax = Math.max(...hs.map((h) => h.w));
    for (const h of hs) { // how far each ring bobs: a soft track behind it
      if (!h.amp) continue;
      const cx = sx(h.x);
      g.strokeStyle = 'rgba(185,140,255,0.16)'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, sy(h.y0 - h.amp)); g.lineTo(cx, sy(h.y0 + h.amp)); g.stroke();
    }
    // the rings as the game draws them: purple hoops seen from a little above, the finish in green, each in its own light
    for (const h of hs) {
      const cx = sx(h.x), cy = sy(h.y0), half = Math.max(3, half0 * Math.pow(h.w / wMax, 2.4)); // a tighter ring reads as clearly smaller
      const ry = Math.max(1.5, half * 0.36), a = h.v ? -Math.PI / 2 : h.tilt * 1.8, rgb = h.cp ? '20,241,149' : '153,69,255';
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.shadowColor = 'rgba(' + rgb + ',0.75)'; g.shadowBlur = h.cp ? 9 : 6;
      g.strokeStyle = h.cp ? '#14f195' : '#b98cff'; g.lineWidth = 2;
      g.beginPath(); g.ellipse(0, 0, half, ry, 0, 0, Math.PI * 2); g.stroke();
      if (h.pw) { g.shadowBlur = 0; g.globalAlpha = 0.45; g.setLineDash([2, 3]); g.lineWidth = 1.2; const k = 1 + h.pw / h.w * 1.6; g.beginPath(); g.ellipse(0, 0, half * k, ry * k, 0, 0, Math.PI * 2); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
      g.restore();
    }
    g.shadowColor = 'rgba(255,255,255,0.6)'; g.shadowBlur = 8;
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(sx(0), sy(def.startY), 4, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0; g.shadowColor = 'transparent';
  }
  // today's three specials in one card: a row each with its prize multiple, twist, length, prize and Play; tap a row for its page
  function specialCard() {
    const s = specState;
    if (!s || !s.specials) return '';
    const left = s.closesAt - Date.now(), blocked = s.me && s.me.blocked, locked = !blocked && s.me && s.me.locked;
    const act = (c) => (blocked ? '<span class="pill off">Not available</span>' : locked ? '<span class="pill off">Locked</span>' : c.done ? '<span class="pill ok">Cleared</span>'
      : `<button class="pill go" data-slot="${c.slot}" id="chSpPlay${c.slot}" aria-label="Play ${c.recipe.name} for ${fmtBet(s.fee)} SOL">Play ${fmtBet(s.fee)}</button>`);
    const rows = s.specials.map((c) => `<div class="spr"><button class="spr-open" data-page="special" data-slot="${c.slot}" aria-label="${c.recipe.name}, win ${fmtAmt(c.prize)} SOL, ${c.done ? c.of : c.at} of ${c.of} cleared today. Details"><span class="spr-k"><span class="spr-x">${c.x}×</span><span class="spr-dots" aria-hidden="true">${Array.from({ length: c.of || 0 }, (x, i) => `<i${i < (c.done ? c.of : c.at) ? ' class="on"' : ''}></i>`).join('')}</span></span><span class="spr-t"><b>${c.recipe.name}</b><span>${c.course.rings} rings · ${c.recipe.blurb}</span></span></button>
      <div class="spr-act"><span class="spr-win">${c.done ? `All ${c.of} cleared today` : `Win <b class="num">${fmtAmt(c.prize)}</b> SOL`}</span>${act(c)}</div></div>`).join('');
    return `<div class="cc sp sp-cc"><div class="cc-h"><span class="cc-k">${ICON.star}Today’s specials</span><span class="cc-t">${left > 0 ? 'New in ' + leftOf(left) : 'New soon'}</span></div>${locked ? unlockRow(s) : ''}${rows}</div>`;
  }
  // the specials open once the player has bet SP.UNLOCK entries in regular runs: how far along they are
  function unlockRow(s) {
    const u = s.unlock || { need: 0, played: 0 }, shown = Math.min(u.need, Math.floor(u.played * 100 + 1e-6) / 100);
    return `<div class="sp-unlock"><div class="mn-h"><span>Bet ${fmtBet(u.need)} SOL in regular runs to unlock</span><b>${fmtBet(shown)} / ${fmtBet(u.need)} SOL</b></div>
      <div class="bar"><i style="width:${(Math.min(1, u.need ? u.played / u.need : 1) * 100).toFixed(1)}%"></i></div></div>`;
  }
  // the duel in one card: what it is, what the winner takes and Play; tap the row for its page
  function duelCard() {
    const d = duelState;
    if (!d || d.blocked) return '';
    const t = d.today, rec = t.w + t.l + t.d ? `${t.w} won · ${t.l} lost today` : 'One on one';
    return `<div class="cc du"><div class="cc-h"><span class="cc-k">${ICON.versus}Duel</span><span class="cc-t">${rec}</span></div>
      <div class="spr"><button class="spr-open" data-page="duel" aria-label="Duel: race a rival over the same rings, win ${fmtAmt(d.prize)} SOL. Details"><span class="spr-x">1v1</span><span class="spr-t"><b>Race a rival</b><span>The same rings for both · further wins</span></span></button>
      <div class="spr-act"><span class="spr-win">Win <b class="num">${fmtAmt(d.prize)}</b> SOL</span><button class="pill go" id="chDuel" aria-label="Play a duel for ${fmtBet(d.fee)} SOL">Play ${fmtBet(d.fee)}</button></div></div></div>`;
  }
  function potCard() {
    const p = potState;
    if (!p) return '';
    const T = p.theme, me = p.me || {}, open = !p.legacy && p.closesAt - Date.now() >= (p.cutoffMs || POTS.CUTOFF_MS);
    const act = me.blocked ? '<span class="pill off">Not available</span>' : !open ? '<span class="pill off">Closed</span>' : `<button class="pill go" id="chPot" aria-label="Fly today’s pot course for ${fmtBet(p.fee)} SOL">Fly ${fmtBet(p.fee)}</button>`;
    const you = me.best ? `You: ${ordinal(me.place)} · ${ringsText(me.best.rings)}` : p.entrants ? p.entrants + (p.entrants === 1 ? ' player' : ' players') + ' in' : 'Nobody in yet';
    return `<div class="cc pot"><div class="cc-h"><span class="cc-k">${ICON.trophy}Daily pot</span><span class="cc-t">Closes in ${leftOf(p.closesAt - Date.now())}<span class="chev">${ICON.chev}</span></span></div><button class="cc-open" data-page="pot" aria-label="Daily pot: ${fmtAmt(p.pool)} SOL. ${T ? T.name : ''}. Details"><span class="cc-big"><span class="num" data-count="${p.pool}">${fmtAmt(p.pool)}</span><span class="unit">SOL</span></span><span class="cc-g">${T ? T.name : 'Today’s course'}</span><span class="cc-s">${T ? T.blurb : ''} · the best three split it</span></button>
      ${p.board.length ? potBoard({ board: p.board.slice(0, 3), me: null }, 3).replace('class="pboard"', 'class="pboard mini"') : ''}
      <div class="cc-act"><span class="cc-v">${you}</span>${act}</div></div>`;
  }
  let potCountAt = 0; // when the pot card's count-up started
  function potCount(fresh) {
    const n = document.querySelector('#cBody .cc-big .num[data-count]');
    if (!n || REDUCED) return;
    const to = +n.dataset.count, now = performance.now();
    if (fresh) potCountAt = now;
    const k = (now - potCountAt) / 800;
    if (k < 1) countUp(n, to * (1 - Math.pow(1 - k, 3)), to, fmtAmt, 800 * (1 - k));
  }
  // a tab's blocks rise in one after another when you open it; if the tab redraws while they rise (fresh data for
  // the special or the pot), the new blocks pick the rise up where it was instead of starting it again
  let riseAt = { el: null, t0: 0 };
  function riseIn(view, fresh) {
    if (REDUCED || !view || !view.animate) return;
    const now = performance.now();
    if (fresh) riseAt = { el: view, t0: now };
    else if (riseAt.el !== view || now - riseAt.t0 > 760) return;
    const off = now - riseAt.t0;
    view.querySelectorAll('.vcol > :not(.vtitle):not(.dk-cols), .dk-col > *').forEach((c, i) => c.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }],
      { duration: 550, delay: Math.min(i, 4) * 40 - off, easing: 'cubic-bezier(.34, 1.56, .64, 1)', fill: 'backwards' }));
  }
  function renderChallenges(keep) {
    const body = $('cBody'), y = body.scrollTop;
    body.innerHTML = `<div class="vcol"><h2 class="vtitle">Challenges</h2><div class="dk-cols"><div class="dk-col">${specialCard()}</div><div class="dk-col">${duelCard()}${potCard()}</div></div></div>`;
    if (keep) body.scrollTop = y;
    wireChallenges(); potCount(!keep); if (keep) riseIn($('vChallenges'), false);
    if (specState && prefs.specSeen !== specState.day) { prefs.specSeen = specState.day; saveAll(); syncBadges(); }
  }
  function wireChallenges() {
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    document.querySelectorAll('#cBody .spr .pill[data-slot]').forEach((b) => b.addEventListener('click', () => startSpecial(+b.dataset.slot)));
    on('chPot', () => startPot());
    on('chDuel', () => startDuel());
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
      run.log = []; run.told = {}; run.share = ''; // every ring of the run, and the goals already announced
      $('lobbyErr').textContent = '';
    } catch (e) {
      $('lobbyErr').textContent = e.message; run.busy = false;
      if (ui.lobby.classList.contains('hide') || inWin) { toast(e.message); backToLobby(); }
      return;
    }
    run.busy = false;
    stats.runs++; stats.wagered = round9(stats.wagered + bet); stats.runPlayed = round9(stats.runPlayed + bet); saveAll();
    enterRun(r.missions);
  }
  // a special level attempt: the entry up front, one long level, the prize for clearing every ring
  async function startSpecial(slot) {
    if (run.busy || (phase !== 'lobby' && phase !== 'over')) return;
    Sound.unlock();
    run.busy = true;
    let r;
    try {
      r = await bank.special.start(slot);
      Object.assign(run, { mode: 'special', slot: r.slot, recipe: r.recipe, g: r.grade, n: r.rings, x: r.x, prize: r.prize, di: SP.GRADES[r.grade][0], bet: r.fee, level: 1, total: 1, streak: 0, best: 0, hoops: 0, swishes: 0, rims: 0, seedHash: r.seedHash, clientSeed: r.clientSeed, nonce: r.nonce, serverSeed: '', levelSeed: r.seed }, RUN_FRESH);
      run.log = []; run.told = {}; run.share = '';
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
  // a duel: the entry up front, one course that gets harder ring by ring, and the rival's flight on it as a ghost
  async function startDuel() {
    if (run.busy || (phase !== 'lobby' && phase !== 'over')) return;
    Sound.unlock();
    run.busy = true;
    let r;
    try {
      r = await bank.duel.start();
      Object.assign(run, { mode: 'duel', recipe: null, rival: r.rival, prize: r.prize, di: 0, bet: r.fee, level: 1, total: 1, streak: 0, best: 0, hoops: 0, swishes: 0, rims: 0, seedHash: r.seedHash, clientSeed: r.clientSeed, nonce: r.nonce, serverSeed: '', levelSeed: r.seed }, RUN_FRESH);
      run.log = []; run.told = {}; run.share = '';
      if (r.duel) duelState = r.duel;
    } catch (e) {
      run.busy = false;
      const el = nav.page === 'duel' ? $('duErr') : null;
      if (el && phase === 'lobby') el.textContent = e.message; else toast(e.message);
      if (phase === 'over') { backToLobby(); setTab('challenges'); }
      return;
    }
    run.busy = false;
    stats.runs++; stats.wagered = round9(stats.wagered + run.bet); saveAll();
    enterRun(r.missions);
  }
  // a free practice run on the picked mode: the bet is only there to show what a real run would have paid
  async function startPractice() {
    if (run.busy || (phase !== 'lobby' && phase !== 'over')) return;
    Sound.unlock();
    const r = await PracticeBank.start(prefs.di);
    Object.assign(run, { mode: 'practice', recipe: null, prize: 0, di: prefs.di, bet: prefs.bet, level: 1, total: 1, streak: 0, best: 0, hoops: 0, swishes: 0, rims: 0, seedHash: r.seedHash, clientSeed: r.clientSeed, nonce: r.nonce, serverSeed: '', levelSeed: r.levelSeed }, RUN_FRESH);
    run.log = []; run.told = {}; run.share = '';
    $('lobbyErr').textContent = '';
    enterRun(null);
  }
  function enterRun(missions) {
    closePage(true); endTry(); show(ui.res, false); show(ui.cp, false);
    // on a desktop a run from the Play tab plays in its window, with the sidebar and the bet left in place (quiet);
    // specials and duels, and a window too small for the cards, take the screen
    let win = false;
    if (desk && (run.mode === 'run' || run.mode === 'practice')) {
      if (nav.tab !== 'play') { nav.tab = 'play'; document.body.dataset.tab = 'play'; document.querySelectorAll('#tabbar [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === 'play'))); }
      show(ui.lobby, true); sheetTopC = -1;
      win = inWin || enterWin();
    }
    if (!win) { leaveWin(); show(ui.lobby, false); }
    show(vL, false); show(vP, false); show(vC, false); show(vM, false); nav.cover = false;
    ball.lastVis = 0; // a new run lets the old flame die down quietly
    setHudMode(true); setBalance();
    clearCallouts(); clearNotices(); potShown = run.bet; setStreakHud();
    beginLevel(true);
    readyNote(missions);
  }
  // mission SOL that a bet has just released: it waits on the Missions tab (and the result card) for a claim
  function readyNote(m) {
    const sum = m && m.ready ? m.ready.reduce((a, p) => a + p.amount, 0) : 0;
    if (sum > 0) { notice('n-pot', ICON.gift, 'Mission SOL ready', fmtBet(sum) + ' SOL to claim after this run', true); syncBadges(); }
  }

  function beginLevel(first) {
    const sp = course(), du = run.mode === 'duel', pt = run.mode === 'pot';
    const def = pt ? POTS.course(run.potSeed, run.theme) : du ? DU.generate(run.levelSeed) : sp ? SP.generate(run.levelSeed, run.recipe, run.g, run.n) : E.generateLevel(run.levelSeed, run.di, run.level);
    const prev = view.st;
    view.prevHoops = keepBehind(prev);
    view.offset = first && prev ? ball.x + 140 : ball.x + 24;
    run.st = E.createState(def); view.st = run.st; run.taps = []; run.lvlStart = run.total;
    warmRings(def);
    ghost = du && run.rival ? newGhost(def, run.rival.taps, 'Rival') : pt && run.ghostOf ? newGhost(def, run.ghostOf.taps, run.ghostOf.name) : null;
    if (autoBot) autoBot = BOT.createBot(autoBot.p, E.makeRng('auto' + Math.random()));
    settleOffset();
    ball.glide = glideTo(view.offset, def.startY, 0.45, 0, 0);
    ball.fall = null; ball.hidden = false;
    phase = 'ready';
    run.lvlSw = 0; run.log.push([]);
    if (run.mode === 'run') profile.lv[run.di][run.level - 1][0]++;
    setPips(run.st); setPot(); setStreakHud(); setHeat(run.streak);
    if (run.level > 1) { banner('Level ' + run.level, goalLine(), 1400); liveGoals(); }
    showPrompt(KB ? (run.level === 1 ? 'Press Space to fly' : 'Press Space to go') : run.level === 1 ? 'Tap to fly' : 'Tap to go', pt ? (run.ghostOf ? (run.ghostOf.name === 'Leader' ? 'The leader’s best: ' + ringsText(run.ghostOf.rings) + '. Beat it.' : 'Your best: ' + ringsText(run.ghostOf.rings) + '. Beat it.') : 'Nobody has flown it yet. Set the mark.') : du ? (run.rival ? 'Get further than your rival to win ' + fmtAmt(run.prize) + ' SOL' : 'Fly as far as you can. The next player races your mark.') : sp ? 'Clear all ' + def.hoops.length + ' rings to win ' + fmtAmt(run.prize) + ' SOL'
      : run.level === 1 ? (practicing() ? 'Free practice: nothing is at stake' : newPlayer() ? 'Drop down through each ring' : goalLine()) : '');
  }

  function settleOffset() { ball.x += ball.ox; ball.y += ball.oy; ball.ox = 0; ball.oy = 0; }
  // A glide carries the ball to the start of a level. It leaves with the ball's own motion and arrives with the
  // motion that comes next (at rest for a run, already flying for the lobby's demo), on a cubic Hermite curve, so
  // there is no jolt at either end. Its speed along the way is the ball's speed, so the flame, lean and spin follow.
  function glideTo(tx, ty, d, v1x, v1y) {
    let vx = ball.vx || 0, vy = ball.vy || 0;
    const vmax = 2 * Math.hypot(tx - ball.x, ty - ball.y) / d + 60, v = Math.hypot(vx, vy);
    if (v > vmax) { vx *= vmax / v; vy *= vmax / v; } // a fast fall bends the path a little, never loops it
    return { fx: ball.x, fy: ball.y, tx, ty, t: 0, d, v0x: vx, v0y: vy, v1x, v1y };
  }
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
    if (ghost && !ghost.st.done && phase === 'play') stepGhost();
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
    if (ev & (EV.MISS | EV.FLOOR | EV.BLOCK)) onBust(st.result === 'floor' || st.result === 'wall' ? st.result : st.missKind, h);
  }

  function onScore(o, h, st) {
    run.hoops++;
    const was = run.streak;
    run.streak = o === 'S' ? run.streak + 1 : 0;
    if (o === 'S') { run.swishes++; run.lvlSw++; if (h.amp) run.mov++; if (h.tilt) run.tilt++; } else run.rims++;
    run.best = Math.max(run.best, run.streak);
    if (run.streak === 3) run.fires++; else if (run.streak === 5) run.novas++;
    const sp = course();
    const m = sp ? 1 : E.hoopMultiplier(PAY.PAYTABLE[run.di][run.level - 1], o, run.streak);
    const cap = E.DIFFS[run.di].maxWin;
    let capped = false;
    if (!sp) { run.total = run.total * m; if (run.total >= cap) { run.total = cap; capped = true; } }
    const pts = ringPoints(o, run.streak);
    run.log[run.log.length - 1].push(o === 'S' ? (run.streak >= 5 ? 'N' : run.streak >= 3 ? 'F' : 'S') : 'R');
    scoreFx(o, h, st, m, run.streak, pts);
    view.pulse = 1;
    setPot(true); setPips(st); setHeat(run.streak); bumpScore(o === 'S' && run.streak >= 3);
    if (o === 'S') {
      setStreakHud('pump');
      const s = run.streak;
      if (s >= 3) pulseHeat(s === 3 || s === 5 || s % 5 === 0 ? 1 : 0.35);
      if (s === 3) { callout('On fire', 'Swish streak ×3', 'fire'); flash(heatRgb(0), 0.1); buzz([10, 25, 14]); Sound.cheer(0.25); }
      else if (s === 5) { callout('Supernova', 'Max streak bonus', 'nova'); flash(heatRgb(1), 0.13); buzz([12, 25, 12, 25, 18]); Sound.cheer(0.55); }
      else if (s >= 10 && s % 5 === 0) { callout(s === 10 ? 'Unstoppable' : s + ' in a row', s + ' swishes in a row', 'nova'); flash(heatRgb(1), 0.14); Sound.cheer(0.85); }
    } else if (was > 1) setStreakHud('broke'); // a 2+ streak was burning: douse() plays the hiss
    addPoints(pts);
    if (capped) { endWin('maxwin'); return true; }
    if (duelClinched()) { duelFinish('clinch'); return true; }
    if (run.mode === 'pot') potLive();
    liveGoals();
    return false;
  }
  function addPoints(n) {
    run.score += n;
    const b = profile.best[run.di];
    if (run.mode === 'run' && !run.newBest && b > 0 && run.score > b) {
      run.newBest = true;
      callout('New best', 'Beat your best of ' + b, 'gold'); Sound.best(); Sound.cheer(0.4); buzz([8, 30, 8]);
    }
  }

  function onClear() {
    phase = 'clearing';
    run.cleared++;
    if (run.streak > 0) run.greens++; // the level's last ring, the green one, was a swish
    if (run.mode === 'special') { specialFinish(true); return; }
    if (run.mode === 'duel') { duelFinish('clear'); return; }
    if (run.mode === 'pot') { potFinish('clear'); return; }
    if (run.mode === 'run') profile.lv[run.di][run.level - 1][1]++;
    if (!REDUCED) {
      view.shake = Math.max(view.shake, 2);
      spawn({ x: ball.x, y: ball.y - 10, kind: 13, life: 0.7, max: 0.7, size: 50, grow: 230, a: 0.42, color: RING_GLOW.cp });
      spawn({ x: ball.x, y: ball.y - 10, kind: 3, life: 0.8, max: 0.8, size: 40, grow: 150, lw: 6, a: 0.42, color: '#8dffcf' });
    }
    confetti(ball.x, ball.y - 30, 56);
    Sound.checkpoint(); buzz([12, 40, 12]);
    if (run.lvlSw === NH) {
      run.perfect++;
      callout('Perfect level', `${NH} of ${NH} swishes · +${PERFECT_BONUS}`, 'gold');
      flash('20,241,149', 0.14); Sound.perfect(); Sound.applause(0.45); confetti(ball.x, ball.y - 30, 40);
      addPoints(PERFECT_BONUS); view.pulse = 1;
    }
    if (run.level < NL) liveGoals();
    ball.glide = null;
    ball.fall = { vx: Math.max(120, run.st.ball.vx), vy: -240, hover: true, t: 0 };
    if (run.level >= NL) { endWin('final'); return; }
    const L = run.level;
    runBank().level(L, run.taps.slice()).then((r) => {
      if (r.status !== 'checkpoint' || Math.abs(r.total - run.total) > 1e-9) return verifyFail();
      setTimeout(() => showCheckpoint(), REDUCED ? 100 : CALL.busy ? 900 : 450);
    }).catch(netFail);
  }

  const BUST_TITLES = { rimout: 'Rimmed out', over: 'Over the rim', under: 'Under the rim', floor: 'Hit the floor', wall: 'Hit a wall', timeout: 'Out of time' };
  function onBust(kind, h) {
    phase = 'over';
    run.lost = true; setHeat(0); // the flame goes out with the run
    clearCallouts(); clearNotices();
    if (run.log && run.log.length) run.log[run.log.length - 1].push('X');
    if (run.streak > 1) setStreakHud('broke');
    const lostPot = run.bet * run.total;
    if (h && kind !== 'wall') hoopVis(h).flash = -1;
    ball.fall = { vx: run.st.ball.vx * 0.6, vy: Math.min(run.st.ball.vy, 200), hover: false, t: 0 };
    if (!REDUCED) {
      view.shake = 7;
      const floor = kind === 'floor', ix = ball.x, iy = floor ? W.FLOOR - 2 : ball.y;
      spawn({ x: ix, y: iy, kind: 13, life: 0.45, max: 0.45, size: RV * 1.5, grow: 90, ry: floor ? 0.35 : 1, a: 0.34, color: '226,214,255' });
      spawn({ x: ix, y: iy, kind: 3, life: 0.55, max: 0.55, size: RV, grow: 70, lw: 4, a: 0.4, ry: floor ? 0.2 : RING_RY, color: '#d6c8f5' });
      for (let i = 0; i < 12; i++) { const a = floor ? rnd(-Math.PI, 0) : rnd(0, Math.PI * 2), sp = rnd(90, 260); spawn({ x: ix, y: iy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * (floor ? 0.8 : 1), g: 700, life: rnd(0.35, 0.6), max: 0.6, size: rnd(1.5, 3), color: i % 3 ? '#b9a7e6' : '#ffffff', kind: 0, drag: 1.6 }); }
      if (floor) for (let i = 0; i < 5; i++) spawn({ x: ix + rnd(-14, 14), y: iy - 2, vx: rnd(-60, 60), vy: rnd(-70, -20), life: rnd(0.5, 0.8), max: 0.8, size: RV * rnd(0.5, 0.8), kind: 7, drag: 2 });
    }
    Sound.bust(); buzz([30, 60, 50]);
    if (run.mode === 'special') { specialFinish(false, kind); return; }
    if (run.mode === 'duel') { duelFinish('bust', kind); return; }
    if (run.mode === 'pot') { potFinish('bust', kind); return; }
    const L = run.level, taps = run.taps.slice();
    runBank().level(L, taps).then((r) => {
      if (r.status !== 'bust') return verifyFail();
      if (practicing()) { run.prog = null; setTimeout(() => showResult('Practice: ' + (BUST_TITLES[kind] || 'Missed').toLowerCase(), 'Out', 'loss', `A real run would have lost its ${fmtBet(run.bet)} SOL bet on level ${L}`), REDUCED ? 200 : 650); return; }
      run.serverSeed = r.serverSeed || '';
      record(0, 'bust', r.missions);
      setTimeout(() => showResult(BUST_TITLES[kind] || 'Missed', '−' + fmtBet(run.bet), 'loss', `Your run was worth ${fmtAmt(lostPot)} SOL on level ${L}`), REDUCED ? 200 : 650);
    }).catch(netFail);
  }

  async function cashOut() {
    if (phase !== 'checkpoint' || run.busy || !armed(ui.cp)) return;
    run.busy = true;
    try {
      const r = await runBank().cashout();
      run.serverSeed = r.serverSeed || '';
      run.busy = false;
      phase = 'over';
      hideStreak(); clearNotices();
      winFx(1);
      show(ui.cp, false);
      if (practicing()) { run.prog = null; showResult('Practice: cashed out', fmtMult(run.total), 'even', `A ${fmtBet(run.bet)} SOL bet would have paid ${fmtAmt(run.bet * run.total)} SOL`); return; }
      record(r.payout, 'cashout', r.missions);
      const profit = r.payout - run.bet; // cashing out at 1.00× gives the bet back: no green +0
      if (profit < 0.00005) showResult('Cashed out', '0', 'even', `Your bet back · ${fmtMult(run.total)} after level ${run.level}`);
      else showResult('Cashed out', '+' + fmtSol(profit), 'win', `${fmtAmt(r.payout)} SOL · ${fmtMult(run.total)} after level ${run.level}`, profit);
    } catch (e) { run.busy = false; netFail(e); }
  }

  function endWin(kind) {
    phase = 'over';
    clearCallouts(); clearNotices(); hideStreak();
    const L = run.level;
    runBank().level(L, run.taps.slice()).then((r) => {
      if (r.status !== kind || Math.abs(r.total - run.total) > 1e-9) return verifyFail();
      if (practicing()) { run.prog = null; winFx(1.3); setTimeout(() => showResult(kind === 'maxwin' ? 'Practice: max win' : 'Practice: all ' + NL + ' levels', fmtMult(run.total), 'even', `A ${fmtBet(run.bet)} SOL bet would have paid ${fmtAmt(run.bet * run.total)} SOL`), 700); return; }
      run.serverSeed = r.serverSeed || '';
      winFx(kind === 'maxwin' ? 1.6 : 1.3);
      record(r.payout, kind, r.missions);
      const t = kind === 'maxwin' ? 'Max win' : 'Champion';
      const s = kind === 'maxwin' ? `${E.DIFFS[run.di].maxWin}× cap · ${fmtAmt(r.payout)} SOL` : `All ${NL} levels · ${fmtAmt(r.payout)} SOL`;
      setTimeout(() => showResult(t, '+' + fmtSol(r.payout - run.bet), 'win', s, r.payout - run.bet), 700);
    }).catch(netFail);
  }

  function verifyFail() {
    phase = 'over';
    toast('That run could not be verified. Your balance was refreshed.');
    setBalance(); backToLobby();
  }
  function netFail(e) { toast(e && e.message ? e.message : 'Connection problem. Try again.'); phase = 'over'; setBalance(); backToLobby(); }

  // ---------------------------------------------------------------- duels: the rival's flight as a ghost, and the finish
  // The rival's taps are replayed on the same course, tick for tick beside the player's own, and drawn as a pale ball
  // at the ball's own size. It only shows where the rival was: the two never touch.
  let ghost = null;
  function newGhost(def, taps, label) { const st = E.createState(def); return { st, taps, label: label || 'Rival', ti: 0, x: st.ball.x, y: st.ball.y, px: st.ball.x, py: st.ball.y, a: 1 }; }
  function stepGhost() {
    const g = ghost, s = g.st, was = s.outcomes.length;
    g.px = s.ball.x; g.py = s.ball.y;
    const tap = g.ti < g.taps.length && g.taps[g.ti] === s.tick;
    if (tap) g.ti++;
    E.step(s, tap);
    g.x = s.ball.x; g.y = s.ball.y;
    if (s.outcomes.length !== was) setPot();
    if (s.done && run.mode === 'duel') rivalOut();
  }
  function rivalOut() {
    const n = ghost.st.outcomes.length;
    if (ghost.st.result === 'clear') { notice('n-pot', ICON.versus, 'Your rival cleared the course', 'Clear it with a better score to win', true); return; }
    if (duelClinched()) { duelFinish('clinch'); return; }
    notice('n-pot', ICON.versus, 'Your rival is out', run.hoops === n ? 'Pass the next ring to win' : 'Pass ring ' + (n + 1) + ' to win', true);
  }
  // past a rival who's out: the duel is won, and there's nothing left to fly for
  const duelClinched = () => !!(run.mode === 'duel' && ghost && ghost.st.done && ghost.st.result !== 'clear' && run.hoops > ghost.st.outcomes.length);
  function drawGhost(c, alpha, dt) {
    const g = ghost;
    if (g.st.done || phase === 'over') g.a = Math.max(0, g.a - dt * 1.6); // out, or the player's own flight is over
    if (g.a <= 0.01 || g.st.tick === 0) return;
    const x = view.offset + g.px + (g.x - g.px) * alpha, y = g.py + (g.y - g.py) * alpha, R = P.R - 1;
    c.save();
    c.globalAlpha = 0.62 * g.a; c.fillStyle = 'rgba(214,200,245,0.2)'; c.strokeStyle = '#d6c8f5'; c.lineWidth = 2;
    c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.fill(); c.stroke();
    // a ball's seams, faint: one across and a curve either side
    c.lineWidth = 1.2; c.globalAlpha = 0.34 * g.a;
    c.beginPath(); c.moveTo(x - R, y); c.lineTo(x + R, y);
    c.moveTo(x - R * 0.5, y - R * 0.86); c.quadraticCurveTo(x - R * 0.05, y, x - R * 0.5, y + R * 0.86);
    c.moveTo(x + R * 0.5, y - R * 0.86); c.quadraticCurveTo(x + R * 0.05, y, x + R * 0.5, y + R * 0.86); c.stroke();
    c.globalAlpha = 0.85 * g.a;
    drawText(c, textSprite(g.label, 700, 11 * scale * dpr, FONT_DISPLAY, '#d6c8f5'), x, y - P.R - 12, scale * dpr);
    c.restore();
  }
  // the duel is over (out, the course cleared, or past a rival who's out): the bank replays the flight and settles it
  function duelFinish(how, kind) {
    phase = 'over';
    clearCallouts(); clearNotices();
    const stop = how === 'clinch' ? run.st.tick : null;
    if (how !== 'bust') {
      hideStreak();
      if (!REDUCED) view.shake = Math.max(view.shake, 2);
      Sound.checkpoint(); buzz([12, 40, 12]);
      ball.glide = null; ball.fall = { vx: Math.max(120, run.st.ball.vx), vy: -240, hover: true, t: 0 };
    }
    bank.duel.finish(run.taps.slice(), stop).then((r) => {
      if (r.duel) duelState = r.duel;
      run.serverSeed = r.serverSeed || '';
      recordDuel(r);
      const you = r.you, rv = r.rival, rings = (n) => n + (n === 1 ? ' ring' : ' rings');
      const line = rv ? `You ${rings(you.rings)} · rival ${rv.rings}` + (you.rings === rv.rings ? ` · score ${you.score} to ${rv.score}` : '') : `Your mark: ${rings(you.rings)} · score ${you.score}`;
      const wait = REDUCED ? 200 : 650, net = r.payout - run.bet;
      if (rv) ui.mult.textContent = you.rings + '–' + rv.rings; // the rival's whole flight, not only as far as the ghost had got
      if (r.status === 'won') { confetti(ball.x, ball.y - 30, 56); winFx(1.2); setTimeout(() => showResult('Duel won', '+' + fmtSol(net), 'win', line, net), 700); }
      else if (r.status === 'draw') setTimeout(() => showResult('A draw', '−' + fmtBet(-net), 'loss', line + ' · the pot is split'), wait);
      else if (r.status === 'waiting') setTimeout(() => showResult('Mark set', fmtBet(run.bet), 'loss', line + ' · the next player races it'), wait);
      else setTimeout(() => showResult(how === 'bust' ? BUST_TITLES[kind] || 'Missed' : 'Duel lost', '−' + fmtBet(run.bet), 'loss', line), wait);
    }).catch(netFail);
  }
  function recordDuel(r) {
    stats.returned = round9(stats.returned + r.payout);
    stats.hoops += run.hoops; stats.swishes += run.swishes;
    stats.history.unshift({ t: Date.now(), kind: 'duel', di: 0, bet: run.bet, payout: r.payout, level: 1, mult: r.payout / run.bet, result: r.status, rings: r.you.rings, seedHash: run.seedHash, serverSeed: run.serverSeed, clientSeed: run.clientSeed, nonce: run.nonce });
    stats.history.length = Math.min(stats.history.length, 30);
    // XP for the points, as in a special; a duel doesn't count toward missions, trophies or the pot
    const before = lvlOf(profile.xp), steps = LV.stepsOf(profile.xp), xp = LV.specialXp(run.score, r.status === 'won');
    profile.tot.swish += run.swishes; profile.xp += xp;
    if (LV.stepsOf(profile.xp) > steps) bank.rakeback.levelUp();
    run.prog = { xp, runXp: xp, before, after: lvlOf(profile.xp), newBest: false, prevBest: 0, achs: [], dailies: [], weeklies: [], careers: [], chapter: null, unlocks: grantUnlocks(), paid: [] };
    saveAll(); setBalance();
  }

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
      if (won) { winFx(1.4); setTimeout(() => showResult('Special cleared', '+' + fmtSol(r.payout - run.bet), 'win', `${R.name} · all ${n} rings · ${fmtAmt(r.payout)} SOL`, r.payout - run.bet), 700); }
      else setTimeout(() => showResult(BUST_TITLES[kind] || 'Missed', '−' + fmtBet(run.bet), 'loss', `${R.name} · out at ring ${at} of ${n}`), REDUCED ? 200 : 650);
    }).catch(netFail);
  }
  function recordSpecial(payout, won) {
    stats.returned = round9(stats.returned + payout);
    stats.hoops += run.hoops; stats.swishes += run.swishes;
    stats.history.unshift({ t: Date.now(), kind: 'special', slot: run.slot, recipe: run.recipe, g: run.g, n: run.n, di: run.di, bet: run.bet, payout, level: 1, mult: won ? run.prize / run.bet : 0, result: won ? 'won' : 'lost', seedHash: run.seedHash, serverSeed: run.serverSeed, clientSeed: run.clientSeed, nonce: run.nonce });
    stats.history.length = Math.min(stats.history.length, 30);
    // XP for the points; the special doesn't count toward missions, trophies or the pot
    const before = lvlOf(profile.xp), steps = LV.stepsOf(profile.xp), xp = LV.specialXp(run.score, won);
    profile.tot.swish += run.swishes; profile.xp += xp;
    if (LV.stepsOf(profile.xp) > steps) bank.rakeback.levelUp();
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
      clears: run.cleared, level: run.level, mov: run.mov, tilt: run.tilt, fires: run.fires, novas: run.novas, greens: run.greens, runs: 1, paid: payout > 0, total: run.total };
  }
  function progress(payout, mres) {
    const r = runFacts(payout), di = run.di, before = lvlOf(profile.xp), steps = LV.stepsOf(profile.xp);
    const prevBest = profile.best[di], newBest = run.score > prevBest;
    if (newBest) profile.best[di] = run.score;
    profile.deep[di] = Math.max(profile.deep[di], run.level);
    profile.tot.swish += run.swishes; profile.tot.perfect += run.perfect;
    const runXp = LV.runXp(r);
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
    if (LV.stepsOf(profile.xp) > steps) bank.rakeback.levelUp(); // a level up releases the rakeback built up since the last one
    const unlocks = grantUnlocks();
    return { xp, runXp, before, after: lvlOf(profile.xp), newBest, prevBest, achs, dailies, weeklies, careers, chapter, unlocks, ready: (mres && mres.ready) || [], opened: (mres && mres.opened) || [] };
  }

  function showCheckpoint() {
    phase = 'checkpoint';
    const L = run.level, pot = run.bet * run.total, pr = practicing();
    ui.cp.classList.toggle('practice', pr);
    $('cpKicker').textContent = (pr ? 'Practice · checkpoint ' : 'Checkpoint ') + L + ' of ' + (NL - 1);
    $('cpTitle').innerHTML = 'Level ' + L + ' cleared' + (run.lvlSw === NH ? '<span class="cp-badge">Perfect</span>' : '');
    const profit = pot - run.bet;
    if (pr) { // practice: the multiplier, and what a real run at your bet would have now
      countUp($('cpPot'), run.lvlStart || 1, run.total, fmtMult, 750);
      $('cpMult').textContent = 'A ' + fmtBet(run.bet) + ' SOL bet would be ' + fmtAmt(pot) + ' SOL now';
      $('cpMult').classList.add('flat');
    } else {
      countUp($('cpPot'), run.bet * (run.lvlStart || 1), pot, fmtAmt, 750);
      $('cpMult').textContent = fmtMult(run.total) + (profit >= 0.00005 ? ' · +' + (profit >= 0.0001 ? fmtAmt(profit) : fmtDelta(profit)) + ' SOL profit' : ' · your bet back');
      $('cpMult').classList.toggle('flat', profit < 0.00005);
    }
    // what the next level can pay (every ring swished, streak carried) and whether the streak carries over
    const nx = L + 1, di = run.di, pt = PAY.PAYTABLE[di][nx - 1];
    let up = run.total, s = run.streak;
    for (let i = 0; i < NH; i++) { s++; up *= E.hoopMultiplier(pt, 'S', s); }
    up = Math.min(up, E.DIFFS[di].maxWin);
    $('cpNextL').textContent = 'After level ' + nx + ', up to';
    $('cpUpTo').textContent = fmtMult(up);
    $('cpUpTo').setAttribute('title', 'If you swish all ' + NH + ' rings: ' + fmtSol(run.bet * up) + ' SOL');
    const sk = $('cpStreak');
    sk.className = 'nx-s' + (run.streak >= 5 ? ' nova' : '');
    sk.innerHTML = run.streak > 1 ? ICON.flame + `Your ${run.streak}-swish streak carries over` : '';
    const gm = pr ? null : nearestMission(runFacts(0)); // counted when the run ends, cash out or not
    $('cpGoal').innerHTML = gm ? ICON.target + `<span>${gm.text}</span><b>${gm.p}/${gm.n}</b>` : '';
    $('cashAmt').textContent = pr ? 'Ends practice' : fmtAmt(pot) + ' SOL';
    $('goSub').textContent = 'Level ' + nx;
    show(ui.cp, true); armCard(ui.cp, 600); STK.el.classList.add('tuck');
    // focus the card, not a button: a Space meant as a flap must never press "Keep going"
    setTimeout(() => ui.cp.focus({ preventScroll: true }), 60);
  }

  async function keepGoing() {
    if (phase !== 'checkpoint' || run.busy || !armed(ui.cp)) return;
    run.busy = true;
    try {
      const r = await runBank().next();
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
    if (rollTo != null) countUp($('resNum'), 0, rollTo, (x) => '+' + fmtAmt(x), 800); else { $('resNum')._cu = ($('resNum')._cu || 0) + 1; $('resNum').textContent = amount; }
    $('resAmount').className = 'big ' + cls;
    $('resAmount').querySelector('.unit').textContent = run.mode === 'pot' ? (amount === '1' ? 'ring' : 'rings') : 'SOL'; // a pot attempt's number is its rings: the money comes at midnight
    $('resSub').textContent = sub;
    const sp = run.mode === 'special', du = run.mode === 'duel', pt = run.mode === 'pot', prac = practicing();
    ui.res.classList.toggle('practice', prac);
    run.share = prac ? '' : shareText(pt ? ringsText(+amount) + (sub ? ' · ' + sub : '') : du ? title + (sub ? ' · ' + sub : '') : sp ? (cls === 'win' ? 'Cleared it' : title + ' at ring ' + Math.min(run.st ? run.st.hoops.length : 0, run.hoops + 1)) : cls !== 'loss' ? title + ' at ' + fmtMult(run.total) : title + ' on level ' + run.level);
    $('resStats').innerHTML = [[run.score, nb ? 'New best' : 'Score', nb], [run.hoops, 'Rings'], [run.best, 'Best streak']]
      .map(([v, k, hi]) => `<div${hi ? ' class="hi"' : ''}><b>${v}</b><span>${k}</span></div>`).join('');
    const spNow = sp && specState && specState.specials ? specState.specials[run.slot] : null;
    $('againT').textContent = prac ? 'Practice again' : pt ? 'Fly again' : du ? 'Duel again' : sp ? (cls === 'win' ? 'Play next' : 'Try again') : 'Play again';
    $('againBtn').hidden = !!(spNow && spNow.done) || !!(pt && potState && potState.closesAt - Date.now() < (potState.cutoffMs || POTS.CUTOFF_MS)); // every special at that prize is cleared, or the pot's about to close
    $('againAmt').textContent = prac ? '' : fmtBet(sp || du || pt ? run.bet : prefs.bet) + ' SOL';
    $('lobbyBtn').textContent = sp || du || pt || prac ? 'Back' : 'Change bet';
    showProgress(pr);
    show(ui.res, true); armCard(ui.res, 600); if (!pt) refreshPot(); if (sp) refreshSpecial(); if (du) refreshDuel();
    if (cls === 'win') setTimeout(() => celebrate(run.total >= 5 || sp ? 150 : 100, ui.res), 140);
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
        profile.fresh = profile.fresh.filter((k) => k !== t + ':' + id); syncBadges();
        document.querySelectorAll(`#resGains .gain.unlock[data-t="${t}"]`).forEach((x) => { const on = x.dataset.id === id; x.classList.toggle('on', on); x.querySelector('em').textContent = on ? 'In use' : 'Use'; });
      });
    });
  }
  // Rakeback: released by a level up, claimed with one tap (on the result card or on Profile).
  const rakeChip = (x) => `<button class="gain claim" id="rbChip" style="animation-delay:0.3s" aria-label="Claim ${fmtBet(x)} SOL of rakeback">${ICON.gift}<span>Level-up rakeback</span><em>Claim ${fmtBet(x)} SOL</em></button>`;
  let rbBusy = false;
  async function claimRakeback(el) {
    if (rbBusy) return;
    rbBusy = true;
    const before = bank.balance();
    let x = 0;
    try { x = await bank.rakeback.claim(); } catch (e) { rbBusy = false; toast(e.message || 'Couldn\'t claim that. Try again.'); return; }
    rbBusy = false;
    if (!(x > 0)) return;
    const fx = claimFx(el, x, before); syncBadges();
    if (el && el.id === 'rbChip') { el.classList.add('on'); el.disabled = true; el.querySelector('span').textContent = 'Rakeback claimed'; el.querySelector('em').textContent = '+' + fmtBet(x) + ' SOL'; }
    else {
      if (!fx) toast('+' + fmtBet(x) + ' SOL rakeback claimed');
      if (el) { el.disabled = true; el.classList.add('got'); el.textContent = '+' + fmtBet(x); }
      setTimeout(() => { if (nav.tab === 'profile' && !nav.page) renderProfileView(); }, fx ? 900 : 0);
    }
  }
  // Mission SOL: released when a round's need is played, claimed with a tap (a mission's Claim key on the Missions tab,
  // or the result card's ticket, which claims everything ready)
  const missionChip = (x) => `<button class="gain claim" id="msChip" style="animation-delay:0.35s" aria-label="Claim ${fmtBet(x)} SOL of mission rewards">${ICON.gift}<span>Mission SOL ready</span><em>Claim ${fmtBet(x)} SOL</em></button>`;
  let msBusy = false;
  async function claimMission(win, i, el) {
    if (msBusy) return;
    msBusy = true;
    const before = bank.balance();
    let x = 0;
    try { x = await bank.missions.claim(win, i); }
    catch (e) { msBusy = false; toast(e.message || 'Couldn’t claim that. Try again.'); if (nav.tab === 'missions' && !nav.page) renderMissions(true); return; }
    msBusy = false;
    syncBadges();
    if (!(x > 0)) { if (nav.tab === 'missions' && !nav.page) renderMissions(true); return; }
    const fx = claimFx(el, x, before);
    if (el && el.id === 'msChip') { el.classList.add('on'); el.disabled = true; el.querySelector('span').textContent = 'Mission SOL claimed'; el.querySelector('em').textContent = '+' + fmtBet(x) + ' SOL'; return; }
    if (!fx) toast('+' + fmtBet(x) + ' SOL claimed');
    if (el) { el.disabled = true; el.classList.add('got'); el.innerHTML = ICON.check + '<span>+' + fmtBet(x) + '</span>'; }
    setTimeout(() => { if (nav.tab === 'missions' && !nav.page) renderMissions(true); }, fx ? 950 : 0);
  }
  let xpTimers = [];
  function showProgress(pr) {
    const box = $('resXp'), fill = $('xpFill');
    xpTimers.forEach(clearTimeout); xpTimers = [];
    if (!pr) { box.style.display = 'none'; $('resGains').innerHTML = ''; $('resNext').innerHTML = ''; return; }
    box.style.display = '';
    const b = pr.before, a = pr.after, up = a.l > b.l;
    $('xpGain').textContent = '+' + pr.xp + ' XP';
    $('xpLvl').textContent = 'Level ' + b.l;
    box.classList.remove('up');
    if (fill._anims && fill._anims.fill) fill._anims.fill.cancel();
    fill.style.transition = 'none'; fill.style.width = (b.into / b.need * 100).toFixed(1) + '%'; // applied at the next frame, before the timer below
    xpTimers.push(setTimeout(() => {
      fill.style.transition = 'width 0.8s cubic-bezier(.2,.9,.2,1)';
      fill.style.width = (up ? 100 : a.into / a.need * 100).toFixed(1) + '%';
    }, 250));
    if (up) xpTimers.push(setTimeout(() => {
      box.classList.add('up'); $('xpLvl').textContent = 'Level up! You\'re level ' + a.l;
      const w = (a.into / a.need * 100).toFixed(1) + '%';
      fill.style.transition = 'none'; fill.style.width = w;
      hudAnim(fill, 'fill', [{ width: '0%' }, { width: w }], { duration: REDUCED ? 1 : 600, easing: EASE_OUT });
      Sound.levelUp(); buzz([10, 40, 10]); celebrate(60, ui.res); // from the card's top corners, clear of its text
    }, 1100));
    const g = [], rbReady = bank.rakeback.view().ready, msReady = mview().readyAll, tix = (rbReady > 0 ? 1 : 0) + (msReady > 0 ? 1 : 0);
    const released = (pr.ready || []).length;
    // mission SOL earned but waiting for the window's play: say how much more unlocks it
    if (run.mode !== 'special' && (pr.dailies.length || pr.weeklies.length)) {
      const mv = mview();
      for (const [win, when] of [['day', 'today'], ['week', 'this week']]) {
        const wait = mv.waiting[win], more = (mv.due[win] || 0) - mv.played[win];
        if (wait > 0 && more > 0) g.push(['', ICON.gift, `${fmtBet(wait)} SOL waiting · bet ${fmtBet(Math.ceil(more * 100) / 100)} SOL more ${when}`]);
      }
      // a round finished: the next one is open, or the window's missions are all done
      for (const o of pr.opened || []) g.push(['pot', ICON.spark, `${o.win === 'day' ? 'Daily' : 'Weekly'} round ${o.round + 1} open · ${fmtBet(roundSol(mv, o.win))} SOL more`]);
      if (pr.dailies.length && mv.daily.every((c) => c.done)) g.push(['daily', ICON.check, 'All of today\'s missions done']);
      if (pr.weeklies.length && mv.weekly.every((c) => c.done)) g.push(['daily', ICON.check, 'All of this week\'s missions done']);
    }
    pr.unlocks.forEach((u) => g.push(['unlock', '', 'New ' + itemName(u), u]));
    pr.achs.forEach((x) => g.push(['ach', troIcon(x.id), x.name + ' · +' + x.xp + ' XP · ' + fmtBet(x.sol) + ' SOL to claim']));
    if (pr.chapter != null) g.push(['ach', ICON.flag, 'Chapter ' + (pr.chapter + 1) + ' done · ' + CAREER[pr.chapter].name]);
    pr.dailies.forEach((c) => g.push(['daily', ICON.check, dailyText(c) + ' · +' + c.xp + ' XP']));
    pr.weeklies.forEach((c) => g.push(['daily', ICON.check, weeklyText(c) + ' · +' + c.xp + ' XP']));
    pr.careers.forEach((m) => g.push(['daily', ICON.flag, careerText(m) + ' · +' + m[2] + ' XP']));
    const sNow = run.mode === 'special' && specState && specState.specials ? specState.specials[run.slot] : null;
    // after a special: what's next at that prize (clearing one brings up a new one), or how many are cleared today
    if (sNow && !run.lost) g.unshift(['', ICON.trophy, sNow.done ? `All ${sNow.of} of today’s ${sNow.x}× specials cleared` : `Next up: ${sNow.recipe.name} · ${sNow.at + 1} of ${sNow.of} today`]);
    else if (!g.length && sNow) g.push(['', ICON.trophy, `${sNow.at} of ${sNow.of} cleared today at ${sNow.x}×`]);
    // the mission to go for next, with where it stands and what it pays: there's always a goal for the next run
    const nm = run.mode === 'run' && !(vh < 720 && tix > 0) ? nearestMission(runFacts0()) : null, nx = $('resNext'); // a short screen shows the claim instead
    nx.innerHTML = nm ? `<div class="rn-h">${ICON.target}<span>${nm.text}</span><b>${nm.p}/${nm.n}${nm.sol ? ' · ' + fmtBet(nm.sol) + ' SOL' : ' · ' + nm.xp + ' XP'}</b></div><div class="rn-bar"><i style="width:${(nm.p / nm.n * 100).toFixed(1)}%"></i></div>` : '';
    const room = Math.max(1, (vh < 720 ? 3 : 4) - (pr.unlocks.length ? 1 : 0) - (nm && vh < 720 ? 1 : 0) - tix), more = g.length > room ? g.length - (room - 1) : 0;
    $('resGains').innerHTML = (rbReady > 0 ? rakeChip(rbReady) : '') + (msReady > 0 ? missionChip(msReady) : '') + g.slice(0, more ? room - 1 : room).map((x, i) => (x[3] ? unlockChip(x[3], i) : gainChip(x[0], x[1], x[2], i))).join('') +
      (more ? gainChip('', ICON.spark, '+' + more + ' more', room - 1) : '');
    wireUnlockChips();
    const rc = $('rbChip');
    if (rc) rc.addEventListener('click', () => { if (armed(ui.res)) claimRakeback(rc); });
    const mc = $('msChip');
    if (mc) mc.addEventListener('click', () => { if (armed(ui.res)) claimMission(null, null, mc); });
    if (pr.achs.length || pr.unlocks.length || pr.dailies.length || pr.weeklies.length || pr.careers.length || released > 0) xpTimers.push(setTimeout(() => Sound.unlockItem(), up ? 1500 : 500));
  }
  function backToLobby() {
    show(ui.res, false); show(ui.cp, false); hidePrompt(); clearNotices();
    setHudMode(false);
    phase = 'lobby';
    leaveWin();
    run.st = null; run.streak = 0; view.st = null; view.prevHoops = []; ball.lastVis = 0; ghost = null;
    attract.wait = 0.3; attract.st = null;
    setTab('play', true); refreshLobby(); refreshPot();
    if (bank.betLimits) bank.betLimits().then(() => { if (phase === 'lobby') refreshLobby(true); }).catch(() => null);
  }
  if (window.ResizeObserver) { try { const ro = new ResizeObserver(() => { sheetTopC = -1; if (inWin) { measureHero(); layoutStage(true); } }); ro.observe(ui.lobby); ro.observe($('vLocker')); } catch (e) { /* optional */ } }

  // ---------------------------------------------------------------- guidance for new players
  const newPlayer = () => stats.runs <= 2;
  // a dotted path from the ball to the first ring, shown before the first few runs start
  // Walls (special courses): a slab standing on the court, drawn at exactly its collision size. A dark purple body
  // with its near side catching the light, a bright cap, and a soft light over its top so it reads against the dark
  // hall; the one the ball hit flashes white.
  function drawWalls(c, st, left, width) {
    for (const w of st.walls) {
      const x = view.offset + w.x0, wd = w.x1 - w.x0, hgt = W.FLOOR - w.y0;
      if (x + wd < left - 60 || x > left + width + 60) continue;
      c.globalCompositeOperation = 'lighter';
      softGlow(c, x + wd / 2, w.y0, 44, 30, w.hit ? '255,255,255' : RING_GLOW.ring, w.hit ? 0.5 : 0.15, 0.3);
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = '#31245a'; c.fillRect(x, w.y0, wd, hgt);
      c.fillStyle = '#5a45a0'; c.fillRect(x, w.y0, 3, hgt);
      c.fillStyle = 'rgba(0,0,0,0.32)'; c.fillRect(x + wd - 4, w.y0, 4, hgt);
      c.fillStyle = w.hit ? '#ffffff' : '#9945ff'; c.fillRect(x, w.y0, wd, 5);
      c.fillStyle = 'rgba(255,255,255,0.4)'; c.fillRect(x, w.y0, wd, 1.2);
    }
  }
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
    ball.flareT = Math.max(ball.flareT || 0, 1); // a flap fans the flame (it throws off a few more wisps)...
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
    const t = st.tick * DT, hy = E.hoopY(h, t), half = E.hoopW(h, t) / 2;
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
    v.flash = 1; v.pop = o === 'S' ? 1 : 0.45;
    if (ball.fire > 0.3) v.heat = 1;
    const hx = view.offset + h.x, hy = E.hoopY(h, st.tick * DT);
    if (o === 'S') {
      const nova = streak >= 5, hot = streak >= 3, pal = hot ? flameHex(nova) : null;
      for (let i = 0; i < 16; i++) { const a = rnd(0, Math.PI * 2), s = rnd(60, 230); spawn({ x: hx, y: hy + 6, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.55 - 30, life: 0.55, max: 0.55, size: rnd(1.4, 2.8), color: pal ? pal[i % 4] : '#ffffff', kind: 0, drag: 2.2 }); }
      const rc = nova ? heatHex(1, 'inner') : hot ? heatHex(0, 'inner') : '#ffffff', lc = h.cp ? RING_GLOW.cp : nova ? heatRgb(1) : hot ? heatRgb(0) : '214,196,255';
      const hw = E.hoopW(h, st.tick * DT), rot = h.v ? -Math.PI / 2 : 0; // an upright ring's ripple stands up with it
      spawn({ x: hx, y: hy, kind: 3, life: 0.5, max: 0.5, size: hw / 2 + P.RP, color: rc, rot });
      if (!REDUCED) {
        // a wider, softer ripple after the first, and a shaft of light dropping through the ring (or, through an
        // upright one, a burst of light out the far side)
        spawn({ x: hx, y: hy, kind: 3, life: 0.75, max: 0.75, size: hw / 2 + P.RP, grow: 64 + 8 * Math.min(streak, 5), lw: 5, a: 0.3, color: rc, rot });
        if (h.v) spawn({ x: hx + 30, y: hy, kind: 13, life: 0.5, max: 0.5, size: 26, grow: 46 + 6 * Math.min(streak, 5), ry: 0.45, a: 0.24 + 0.035 * Math.min(streak, 5), color: lc });
        else spawn({ x: hx, y: hy, kind: 12, life: 0.5, max: 0.5, size: 46 + 6 * Math.min(streak, 5), w: hw * 0.36, a: 0.2 + 0.035 * Math.min(streak, 5), color: lc });
      }
      if (streak === 3 || streak === 5) { ignite(nova ? 1 : 0); if (!REDUCED) spawn({ x: ball.x, y: ball.y, kind: 13, life: 0.55, max: 0.55, size: RV * 2, grow: 150, a: 0.5, color: heatRgb(nova ? 1 : 0) }); }
      if (!REDUCED && streak >= 2) ball.flareT = Math.max(ball.flareT || 0, streak === 3 || streak === 5 ? 1.6 : 0.9); // each swish feeds the fire
      Sound.swish(streak); buzz(10);
    } else {
      Sound.score();
      for (let i = 0; i < 6; i++) { const a = rnd(0, Math.PI * 2), sp = rnd(40, 130); spawn({ x: hx, y: hy + 4, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 20, life: 0.4, max: 0.4, size: rnd(1.2, 2.2), color: '#cdbcf2', kind: 0, drag: 2.4 }); }
    }
    if (m != null) {
      // a ring that sets off a callout (3, 5, every 5th from 10) shows only its points: the callout says the rest
      const called = o === 'S' && (streak === 3 || streak === 5 || (streak >= 10 && streak % 5 === 0));
      const label = called ? '+' + pts : (o === 'S' ? streakName(streak) : 'Rim') + (pts ? ' +' + pts : '');
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
      spawn({ x: ball.x + Math.cos(a) * RV * 0.6, y: ball.y + Math.sin(a) * RV * 0.6, vx: Math.cos(a) * sp + ball.vx * 0.6, vy: Math.sin(a) * sp - 40, life: rnd(0.24, 0.4), max: 0.4, size: RV * rnd(0.35, 0.6), kind: 6, n, burst: true, drag: 4, sw: rnd(-1, 1) });
    }
    spawn({ x: ball.x, y: ball.y, kind: 3, life: 0.4, max: 0.4, size: RV * 1.1, color: heatHex(n ? 1 : 0, 'inner') });
  }
  // the streak broke: the flame goes out in a puff of smoke
  function douse(x, y) {
    for (let i = 0; i < (REDUCED ? 3 : 9); i++) spawn({ x: x + rnd(-8, 8), y: y + rnd(-8, 4), vx: rnd(-40, 20) + ball.vx * 0.2, vy: rnd(-150, -70), life: rnd(0.7, 1.1), max: 1.1, size: RV * rnd(0.6, 1.05), kind: 7, drag: 1.2 });
    Sound.douse();
  }
  function confetti(x, y, n) {
    const cols = ['#9945ff', '#14f195', '#ffffff', '#c39bff', '#8dffcf'];
    for (let i = 0; i < n; i++) spawn({ x: x + rnd(-30, 30), y: y + rnd(-10, 10), vx: rnd(-260, 260), vy: rnd(-520, -160), g: 900, drag: 1.2, life: rnd(1.1, 1.8), max: 1.8, size: rnd(4, 7), color: cols[i % cols.length], kind: 1, rot: rnd(0, 6), vr: rnd(-12, 12) });
  }
  // celebrations: a burst of flat confetti over the cards (wins, level-ups, special clears, pot wins)
  const FX_COLS = ['#9945ff', '#14f195', '#ffffff', '#c39bff', '#8dffcf', '#9945ff', '#14f195']; // Solana purple and green, and white
  let fxParts = [], fxRaf = 0, fxLast = 0, fxW = 0, fxH = 0;
  function fxPrep() {
    const el = $('fxLayer');
    if (REDUCED || !el) return null;
    const W = (fxW = innerWidth), H = (fxH = innerHeight), k = Math.min(window.devicePixelRatio || 1, 2);
    if (el.width !== Math.round(W * k) || el.height !== Math.round(H * k)) { el.width = Math.round(W * k); el.height = Math.round(H * k); }
    return el;
  }
  function fxStart() { if (!fxRaf) { fxLast = performance.now(); fxRaf = requestAnimationFrame(fxTick); } }
  const fxPiece = (x, y, vx, vy, i, max) => ({ x, y, vx, vy, w: 5 + Math.random() * 5, h: 8 + Math.random() * 6, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 14,
    flip: Math.random() * 6.28, vf: 6 + Math.random() * 8, c: FX_COLS[i % FX_COLS.length], life: 0, max, dot: Math.random() < 0.22 });
  // a small burst from a point (a Claim key), up and out
  function burstFx(x, y, n) {
    if (!fxPrep()) return;
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6, sp = 260 + Math.random() * 380; fxParts.push(fxPiece(x, y, Math.cos(a) * sp, Math.sin(a) * sp, i, 0.8 + Math.random() * 0.6)); }
    fxStart();
  }
  // a SOL coin: green, turning as it flies, on an arc from (x0, y0) to (x1, y1) after a delay; land() when it gets
  // there. fade: it fades out on the way instead (nowhere to land)
  function coinFx(x0, y0, x1, y1, delay, land, fade) {
    if (!fxPrep()) return;
    fxParts.push({ coin: true, x0, y0, x1, y1, cx: (x0 + x1) / 2 + (Math.random() - 0.5) * 90, cy: Math.min(y0, y1) - 60 - Math.random() * 70, life: -delay, dur: 0.5 + Math.random() * 0.16,
      r: 6 + Math.random() * 2, spin: Math.random() * 6.28, land, fade, x: x0, y: y0 });
    fxStart();
  }
  function celebrate(n, from) {
    const el = fxPrep();
    if (!el) return;
    const W = fxW, H = fxH;
    const r = from && from.getBoundingClientRect ? from.getBoundingClientRect() : { left: W / 2 - 120, right: W / 2 + 120, top: H * 0.38 };
    for (let i = 0; i < (n || 90); i++) {
      const side = i % 2 ? 1 : -1, ang = -Math.PI / 2 - side * (0.12 + Math.random() * 0.6), sp = 520 + Math.random() * 520; // two cannons at the card's top corners, aimed up and in
      fxParts.push(fxPiece(side < 0 ? r.left + 28 : r.right - 28, r.top + 24, Math.cos(ang) * sp, Math.sin(ang) * sp, i, 1.7 + Math.random() * 0.9));
    }
    fxStart();
  }
  function fxTick(t) {
    const el = $('fxLayer'), dt = Math.min(0.05, Math.max(0, (t - fxLast) / 1000)), k = el.width / Math.max(1, fxW), g = el.getContext('2d');
    fxLast = t;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, el.width, el.height); g.setTransform(k, 0, 0, k, 0, 0);
    fxParts = fxParts.filter((p) => {
      p.life += dt;
      if (!p.coin) return p.life < p.max && p.y < fxH + 40;
      if (p.life < p.dur) return true;
      if (p.land) p.land();
      return false;
    });
    for (const p of fxParts) {
      if (p.coin) { if (p.life >= 0) drawCoin(g, p); continue; }
      p.vy += 1300 * dt; p.vx *= Math.exp(-2.4 * dt); p.vy *= Math.exp((p.vy > 0 ? -3.4 : -2.2) * dt); // pieces flutter down slowly
      p.x += p.vx * dt + Math.sin(p.flip) * 14 * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.flip += p.vf * dt;
      g.globalAlpha = Math.min(1, (p.max - p.life) / 0.45); g.fillStyle = p.c;
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(1, Math.cos(p.flip));
      if (p.dot) { g.beginPath(); g.arc(0, 0, p.w * 0.55, 0, 6.2832); g.fill(); } else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      g.restore();
    }
    g.globalAlpha = 1;
    if (fxParts.length) fxRaf = requestAnimationFrame(fxTick);
    else { fxRaf = 0; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, el.width, el.height); }
  }
  function drawCoin(g, p) {
    const k = p.life / p.dur, e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2, u = 1 - e;
    const x = u * u * p.x0 + 2 * u * e * p.cx + e * e * p.x1, y = u * u * p.y0 + 2 * u * e * p.cy + e * e * p.y1;
    const r = p.r * (1 + 0.3 * Math.sin(Math.PI * k)) * (1 - 0.3 * k), turn = Math.max(0.3, Math.abs(Math.cos(p.spin + p.life * 11)));
    g.globalAlpha = Math.min(1, p.life / 0.08) * (p.fade ? Math.min(1, (1 - k) / 0.35) : 1);
    g.save(); g.translate(x, y); g.scale(turn, 1);
    g.shadowColor = 'rgba(20, 241, 149, 0.65)'; g.shadowBlur = 10;
    g.fillStyle = '#0a9e62'; g.beginPath(); g.arc(0, 0, r, 0, 6.2832); g.fill(); // the coin's edge
    g.shadowBlur = 0;
    g.fillStyle = '#14f195'; g.beginPath(); g.arc(0, -0.7, r * 0.8, 0, 6.2832); g.fill(); // its face
    g.fillStyle = 'rgba(255, 255, 255, 0.7)'; g.beginPath(); g.ellipse(-r * 0.25, -r * 0.38, r * 0.32, r * 0.15, -0.5, 0, 6.2832); g.fill(); // a glint
    g.restore();
  }
  // The moment SOL is claimed (a mission, a trophy, rakeback): the key pops, a burst of confetti leaves it, and SOL
  // coins arc from it into the balance one after another, each pinging a step higher, while the balance counts up and
  // a green "+0.002 SOL" rises under it. Where the balance isn't on screen (a page, the result card's run) the coins
  // fountain up from the key and fade. On a card the confetti comes from the card's corners, behind it, as for any
  // win. before: the balance before the claim. Returns whether it played (not with reduced motion).
  let gainEl = null;
  function claimFx(el, amount, before) {
    Sound.claim(); buzz([12, 40, 12, 40, 18]);
    const after = bank.balance();
    if (REDUCED || !el || !el.isConnected) { setBalance(); return false; }
    hudAnim(el, 'claim', [{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.3 }, { transform: 'scale(0.95)', offset: 0.65 }, { transform: 'scale(1)' }], { duration: 560, easing: EASE_OUT });
    const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, card = el.closest('.card');
    const n = clamp(Math.round(5 + 1.4 * Math.log10(Math.max(1, amount * 1000))), 5, 9);
    if (card) { // the coins would fly behind the card: confetti from its corners, and the coins' pings
      celebrate(46, card); setBalance();
      for (let i = 0; i < n; i++) setTimeout(() => Sound.coin(i), 520 + i * 65);
      return true;
    }
    burstFx(cx, cy, 28);
    const bal = $('balBtn'), b = bal && phase === 'lobby' && !nav.page && bal.offsetParent !== null ? bal.getBoundingClientRect() : null, to = b && b.width ? b : null;
    // the balance counts up with enough decimals to see the claim land (10.000 to 10.001), then settles back
    const dp = Math.max(after >= 1 ? 2 : 4, [2, 3, 4].find((d) => Math.abs(amount * 10 ** d - Math.round(amount * 10 ** d)) < 1e-6) || 4), fmtC = (v) => v.toFixed(dp);
    let landed = 0;
    for (let i = 0; i < n; i++) {
      const tx = to ? to.left + to.width * 0.3 : cx + (Math.random() - 0.5) * 140, ty = to ? to.top + to.height / 2 : cy - 130 - Math.random() * 50;
      coinFx(cx + (Math.random() - 0.5) * 16, cy + (Math.random() - 0.5) * 8, tx, ty, i * 0.065, () => {
        Sound.coin(landed);
        if (to) {
          if (!landed) { ui.bal.textContent = fmtC(before); countUp(ui.bal, before, after, fmtC, 120 + n * 65); }
          hudAnim(bal, 'bump', [{ transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { duration: 260, easing: EASE_OUT });
        }
        if (++landed === n) { if (to) gainUnder(to, amount); setTimeout(() => { if (ui.bal.textContent === fmtC(after)) setBalance(); }, to ? 1900 : 0); }
      }, !to);
    }
    if (!to) setBalance();
    return true;
  }
  // a green "+0.002 SOL" that rises under the balance and fades
  function gainUnder(r, amount) {
    if (!gainEl) { gainEl = document.createElement('div'); gainEl.className = 'claim-gain'; gainEl.setAttribute('aria-hidden', 'true'); document.body.appendChild(gainEl); }
    gainEl.textContent = '+' + fmtBet(amount) + ' SOL';
    gainEl.style.left = (r.left + r.width / 2) + 'px'; gainEl.style.top = (r.bottom + 6) + 'px';
    hudAnim(gainEl, 'up', [{ opacity: 0, transform: 'translate(-50%, -6px) scale(0.9)' }, { opacity: 1, transform: 'translate(-50%, 0) scale(1.05)', offset: 0.18 },
      { opacity: 1, transform: 'translate(-50%, 2px) scale(1)', offset: 0.7 }, { opacity: 0, transform: 'translate(-50%, 10px) scale(1)' }], { duration: 1500, easing: 'ease-out' });
  }
  function winFx(k) {
    Sound.cash(); buzz([10, 30, 10, 30, 60]);
    const big = clamp(Math.log(Math.max(1, run.total)) / Math.log(20), 0, 1); // 1× murmur, 20×+ a roar
    Sound.applause(Math.max(0.25, big, (k || 1) - 1)); if (big > 0.3 || k > 1) Sound.cheer(Math.max(big, 0.5));
    const n = Math.round(26 * (k || 1));
    for (let i = 0; i < n; i++) spawn({ x: ball.x + rnd(-20, 20), y: ball.y + rnd(-20, 10), vx: rnd(-220, 220), vy: rnd(-560, -220), g: 1000, life: rnd(1.2, 1.9), max: 1.9, size: rnd(7, 10), color: i % 2 ? '#14f195' : '#b98cff', kind: 4, rot: rnd(0, 6), vr: rnd(-8, 8) });
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
      ball.glide = glideTo(view.offset, def.startY, 0.5, def.speed, 0); // arrives already flying at the level's speed
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
        if (o === 'S') spawn({ x: view.offset + st.hoops[hi].x, y: E.hoopY(st.hoops[hi], st.tick * DT), kind: 3, life: 0.5, max: 0.5, size: st.hoops[hi].w / 2 + P.RP, color: '#ffffff', rot: st.hoops[hi].v ? -Math.PI / 2 : 0 });
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
  // The page's layout is read only here, at the start of a frame, before anything in the frame writes to the page:
  // the browser has just laid it out to paint the last frame, so the read costs nothing. Reading it after a write
  // (a ring scored, the pot ticking up) would make the browser lay the page out again in the middle of the frame.
  const HUD_Q = ['#hud .hud-left .lvl', '#streak.on', '#hud .hud-mid'];
  function measureHero() { // the page's window onto the arena, in screen px: measured after the page changes (a tab, a resize)
    const lk = nav.tab === 'locker', sheet = lk ? vL : ui.lobby;
    if (sheet.classList.contains('hide')) return;
    const h = lk ? $('lkHero') : $('hero');
    heroT = sheet.offsetTop + h.offsetTop; heroB = heroT + h.offsetHeight; sheetTopC = heroT;
    heroL = sheet.offsetLeft + h.offsetLeft; heroR = heroL + h.offsetWidth;
  }
  function readLayout() {
    if (phase === 'lobby') { view.hudBot = 0; STK.rect = null; if (sheetTopC < 0) measureHero(); return; }
    // the streak meter, so it can fade while the ball flies behind it: measured after it changes (its name grows
    // from "Double" to "Unstoppable"), and once a second in case the page moved
    if (STK.el.classList.contains('on') && (!STK.rect || STK.dirty || HUD_DIRTY.on || ++STK.k % 60 === 0)) { STK.rect = STK.el.getBoundingClientRect(); STK.dirty = false; }
    if (HUD_DIRTY.on || !(view.time - view.hudAt < 2)) { // where the HUD ends, so ring labels float below it (small phones)
      view.hudAt = view.time; HUD_DIRTY.on = false;
      let b = 0;
      for (const q of HUD_Q) { const e = document.querySelector(q), r = e && e.getBoundingClientRect(); if (r && r.height && r.right > runL && r.left < runR) b = Math.max(b, r.bottom); }
      view.hudBot = b;
    }
  }
  let last = performance.now();
  function frame(tNow) {
    let dt = (tNow - last) / 1000; last = tNow;
    if (dbg.hold) { // frozen for tests; step(n) plays n more frames of 1/60 s
      if (!(dbg.steps > 0)) { tickCounts(tNow); requestAnimationFrame(frame); return; }
      dbg.steps--; dt = dbg.stepDt || 1 / 60;
    }
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    if (nav.cover && phase === 'lobby') { tickCounts(tNow); requestAnimationFrame(frame); return; } // a full page covers the arena
    readLayout();
    view.time += dt;
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
      const g = ball.glide; g.t = Math.min(1, g.t + dt / g.d);
      const u = g.t, u2 = u * u, u3 = u2 * u, D = g.d;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = 3 * u2 - 2 * u3, h11 = u3 - u2;
      const d00 = 6 * u2 - 6 * u, d10 = 3 * u2 - 4 * u + 1, d01 = 6 * u - 6 * u2, d11 = 3 * u2 - 2 * u;
      ball.px = ball.x; ball.py = ball.y;
      ball.x = h00 * g.fx + h10 * D * g.v0x + h01 * g.tx + h11 * D * g.v1x;
      ball.y = h00 * g.fy + h10 * D * g.v0y + h01 * g.ty + h11 * D * g.v1y;
      ball.vx = (d00 * g.fx + d01 * g.tx) / D + d10 * g.v0x + d11 * g.v1x;
      ball.vy = (d00 * g.fy + d01 * g.ty) / D + d10 * g.v0y + d11 * g.v1y;
      if (g.t >= 1) { ball.glide = null; ball.fall = null; ball.readyT = 0; }
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
      // waiting for the tap: a gentle bob that eases in from rest where the glide left the ball, no jump
      const T = (ball.readyT = (ball.readyT || 0) + dt), e = clamp(T / 0.6, 0, 1), k = e * e * (3 - 2 * e);
      ball.px = ball.x; ball.py = ball.y;
      ball.x = view.offset + run.st.ball.x; ball.y = run.st.ball.y + Math.sin(T * 4) * 5 * k;
      if (Math.floor(T * 2.2) !== Math.floor((T - dt) * 2.2)) ball.flapV = -16;
      ball.vy = Math.cos(T * 4) * 20 * k; ball.vx = 0;
    }
    // Physics runs at 120 Hz; the ball is drawn between its last two physics positions, by how far the clock has
    // got toward the next tick, so it moves evenly whatever the screen's refresh rate. The lobby's demo run does
    // the same (it used to draw the latest tick, so it judders whenever a frame got one tick more or fewer).
    const demo = phase === 'lobby' && attract.st && !ball.glide;
    const alpha = phase === 'play' ? clamp(acc / DT, 0, 1) : demo ? clamp(attract.acc / DT, 0, 1) : 1;
    view.alpha = alpha; view.interp = phase === 'play' || demo;
    const ix = lerp(ball.px, ball.x, alpha), iy = lerp(ball.py, ball.y, alpha);
    updateFx(dt, ix, iy);
    render(alpha, ix + ball.ox, iy + ball.oy, dt);
    streakDodge();
    tickCounts(tNow); // writes to the page last
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
    // fire: the ball smoulders on a double swish, burns purple from three in a row and green from five
    const vis = dbg.fx != null ? dbg.fx : phase === 'lobby' ? (nav.fx != null ? nav.fx : Math.min(attract.streak, 4)) : run.lost ? 0 : run.streak;
    const fireT = vis >= 5 ? 1 : vis === 4 ? 0.82 : vis === 3 ? 0.64 : vis === 2 ? 0.3 : 0;
    ball.fire = lerp(ball.fire, fireT, 1 - Math.exp(-dt * (fireT > ball.fire ? 5 : 3.5)));
    if (ball.fire < 0.004) ball.fire = 0;
    if (fireT > 0) ball.nova = lerp(ball.nova, vis >= 5 ? 1 : 0, 1 - Math.exp(-dt * 3));
    if (vis === 0 && ball.lastVis >= 2 && ball.fire > 0.12 && !ball.hidden) douse(dxw, dyw);
    ball.lastVis = vis;
    // the flame: burning gas shed by the ball (see updateFlame)
    // the flare rises to a tap or a swish over a few hundredths of a second (a step from one frame to the next
    // made the whole flame jump) and dies back over a quarter of a second
    ball.flareT = (ball.flareT || 0) * Math.exp(-dt * 6);
    ball.flare += (ball.flareT - ball.flare) * (1 - Math.exp(-dt * 30));
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
        spawn({ x: dxw + p.x, y: dyw + p.y, vx: p.vx * 0.5, vy: p.vy * 0.5 - 40, g: -300, life: rnd(0.18, 0.3), max: 0.3, size: RV * rnd(0.16, 0.28) * (0.6 + 0.6 * f), kind: 6, n, drag: 2.4, sw: rnd(-1, 1) });
      }
      ball.emberAcc += dt * (REDUCED ? 3 : 16) * f;
      while (ball.emberAcc >= 1) {
        ball.emberAcc -= 1;
        const pal = flameHex(n > 0.5);
        spawn({ x: dxw + rnd(-0.6, 0.6) * RV, y: dyw + rnd(-0.6, 0.6) * RV, vx: ball.vx * 0.3 + dx * rnd(40, 120) + rnd(-30, 30), vy: ball.vy * 0.3 + dy * rnd(40, 120) - 50, life: rnd(0.45, 0.85), max: 0.85, size: rnd(1, 2.2), color: pal[(Math.random() * 3) | 0], kind: 5, drag: 1.4 });
      }
    }
    let live = 0;
    for (let i = 0; i < parts.length; i++) { // the spent ones are dropped in one pass, keeping the drawing order
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.g * dt;
      if (p.drag) { const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy *= k; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      parts[live++] = p;
    }
    parts.length = live;
    for (let i = texts.length - 1; i >= 0; i--) { const t = texts[i]; t.life -= dt; t.y -= 30 * dt; if (t.life <= 0) texts.splice(i, 1); }
    const springs = (h) => {
      const v = h.vis; if (!v) return;
      if (v.flash > 0) v.flash = Math.max(0, v.flash - dt * 2.2);
      if (v.heat > 0) v.heat = Math.max(0, v.heat - dt * 2.4);
      if (v.pop > 0) v.pop = v.pop < 0.004 ? 0 : v.pop * Math.exp(-dt * 6.5);
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
      if (sheetTopC < 0) measureHero(); // normally done at the frame's start (readLayout), unless the page changed since
      const near = lk, top = 130, bot = near ? 560 : 676;
      zoomT = clamp((heroB - heroT - 8) / ((bot - top) * scale), 0.45, 1);
      centreY = (heroT + heroB) / 2; centreW = (top + bot) / 2;
    } else if (phase !== 'lobby' && run.st) {
      zoomT = levelZoom(run.level);
      centreY = stT + stH / 2; centreW = (VIEW_TOP + VIEW_BOT) / 2; // the stage's middle (the screen's, or the Play tab's window's)
    }
    view.zoom = lerp(view.zoom, zoomT, 1 - Math.exp(-dt * 4));
    const S = scale * view.zoom;
    // camera: follows the drawn ball with velocity feed-forward, so the ball holds the same
    // spot on screen at every speed, and bounces still read as motion. In a run the ball keeps its
    // level-1 spot on screen whatever the zoom, so all of the extra view lies ahead of it, on every
    // screen size alike (wide screens fade their sides to the same window).
    const ballSX = runBX, ox0 = (vw - VIEW_W * S) / 2;
    // between runs on a desktop the window sits beside the controls: the demo ball flies 30% into it
    const deskLobby = desk && phase === 'lobby' && centreY != null;
    view.bgX = lerp(view.bgX || 0, deskLobby || inWin ? (heroL + heroR - vw) / 2 : 0, 1 - Math.exp(-dt * 7)); // the spotlight stands over the window
    const target = deskLobby ? dxw - (heroL + (heroR - heroL) * 0.3 - ox0) / S : phase === 'lobby' ? dxw - BALL_SX / view.zoom : dxw - (ballSX - ox0) / S;
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

  // the gradients at the play column's sides on a wide screen: made when the window changes, not every frame
  const SIDE_G = { key: '' }, SIDE_DIM = 0.42, SIDE_RAMP = 220;
  function sideGrads(c, L, r0) {
    const key = L + '|' + r0 + '|' + vw;
    if (SIDE_G.key === key) return SIDE_G;
    const R = r0 + 40, lin = (x0, x1, stops) => { const g = c.createLinearGradient(x0, 0, x1, 0); stops.forEach(([t, a]) => g.addColorStop(t, 'rgba(6,4,11,' + a + ')')); return g; };
    SIDE_G.key = key;
    SIDE_G.l = lin(L, L + 46, [[0, 1], [1, 0]]); SIDE_G.r = lin(r0 - 6, R, [[0, 0], [1, 1]]);
    const ramp = [[0, 1], [0.12, 0.8], [0.4, 0.6], [1, SIDE_DIM]]; // dark right beside the column, then the hall comes up
    SIDE_G.dl = lin(L, L - SIDE_RAMP, ramp); SIDE_G.dr = lin(R, R + SIDE_RAMP, ramp);
    return SIDE_G;
  }

  // how far the view pulls back on a level: rings spread out 4% a level, the view widens 3.5%
  const levelZoom = (L) => 1 / (1 + 0.035 * (L - 1));

  // ---------------------------------------------------------------- rendering
  function render(alpha, bx, by, dt) {
    const c = cx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalCompositeOperation = 'source-over';
    // backdrop (cached): the night arena, the same on every level
    const bgX = Math.abs(view.bgX || 0) < 0.5 ? 0 : view.bgX;
    if (bgX) { c.fillStyle = EDGE; c.fillRect(0, 0, vw, vh); }
    c.drawImage(backdrop(), bgX, 0, vw, vh);

    // the score, huge and quiet, behind everything (Flappy Dunk style); the pot sits in the HUD
    const bannerOn = performance.now() < bannerUntil;
    view.scoreA = lerp(view.scoreA == null ? 1 : view.scoreA, bannerOn ? 0 : CALL.busy ? 0.2 : 1, 1 - Math.exp(-dt * (bannerOn ? 21 : 7.7)));
    if (phase !== 'lobby' && run.st && run.score > 0) {
      const p = view.pulse, best = profile.best[run.di], cy = offY + 205 * scale, cxm = (runL + runR) / 2, fa = view.scoreA;
      const col = run.newBest ? '245,197,66' : run.streak >= 5 ? heatText(1) : run.streak >= 3 ? heatText(0) : '255,255,255';
      const m = multSprite(String(run.score), col), k = (84 + p * 9) / 91;
      c.globalAlpha = Math.min(1, 0.09 + p * 0.26) * fa;
      c.drawImage(m.el, cxm - m.w * k / 2, cy - m.h * k / 2, m.w * k, m.h * k);
      if (best > 0) {
        c.globalAlpha = (run.newBest ? 0.55 : 0.26) * fa;
        drawText(c, textSprite(run.newBest ? 'New best' : 'Best ' + best, 600, 15 * scale * dpr, FONT_DISPLAY, run.newBest ? '#14f195' : '#ffffff'), cxm, cy + 48 * scale, dpr);
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
    view.wl = view.camX + (runL - ox) / S; view.wr = view.camX + (runR - ox) / S; // the window onto the court (as far ahead as everyone sees)
    if (desk && phase === 'lobby') { view.wl = view.camX + (heroL - ox) / S; view.wr = view.camX + (heroR - ox) / S; } // between runs, the page's window
    view.wt = view.hudBot ? view.camY + (view.hudBot - oy) / S : null;
    const st = view.st;
    const tNow = st ? (view.interp ? (st.tick - 1 + alpha) * DT : st.tick * DT) : 0; // moving rings, between ticks too
    const hoops = [];
    for (const p of view.prevHoops) hoops.push({ h: p.h, off: p.off, t: p.t });
    if (st) for (const h of st.hoops) hoops.push({ h, off: view.offset, t: Math.max(0, tNow) });
    const vis = hoops.filter((o) => { const x = o.off + o.h.x; return x > worldLeft - 80 && x < worldLeft + worldW + 80; });
    drawFar(c, worldLeft, worldW);
    drawCourt(c, worldLeft, worldW, S, bx, by, vis);
    if (st && st.walls && st.walls.length) drawWalls(c, st, worldLeft, worldW);
    if (ball.fire > 0.05 && !ball.hidden && !REDUCED) fireLight(c, bx, by);
    if (ball.fire > 0.25 && !REDUCED && phase !== 'lobby') drawStreaks(c, worldLeft, worldW);
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
    if (ghost && phase !== 'lobby') drawGhost(c, alpha, dt);
    if (!ball.hidden) drawBall(c, bx, by);
    for (const o of vis) drawRing(c, o, false);
    drawParts(c, false);
    drawTexts(c, dt);
    if (view.flash > 0.004) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = 'rgba(' + view.flashCol + ',' + view.flash.toFixed(3) + ')'; c.fillRect(0, 0, vw, vh);
      c.globalCompositeOperation = 'source-over';
    }

    // Wide screens: everyone sees the same distance ahead. Past the play column the course fades out; where there's
    // room, the hall itself (sky, crowd, board and floor, with no rings, walls or labels in it) carries on to the
    // stage's edges (the screen's, or the Play tab's window's), dim, so a run fills it without showing any more of
    // what's coming.
    const sa = stL, sb = stL + stW;
    if ((runL - sa > 2 || sb - runR > 2) && (phase !== 'lobby' || (view.zoom > 0.98 && !desk))) {
      // the edges sit on whole device pixels, and the fills overlap by one: two fills that only meet on a part-covered
      // pixel leave a bright hairline down the screen (they did, at both edges of the column)
      const L = Math.floor((runL - 40) * dpr) / dpr, r0 = Math.ceil(runR * dpr) / dpr, R = r0 + 40, G = sideGrads(c, L, r0), px = 1 / dpr;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (L - sa > 60) {
        c.save();
        c.beginPath(); c.rect(sa, 0, L - sa, vh); c.rect(R, 0, sb - R, vh); c.clip();
        c.fillStyle = EDGE; c.fillRect(0, 0, vw, vh);
        c.drawImage(backdrop(), bgX, 0, vw, vh);
        c.setTransform(k, 0, 0, k, (ox + sx) * dpr - view.camX * k, (oy + sy) * dpr - view.camY * k);
        drawFar(c, worldLeft, worldW);
        drawCourt(c, worldLeft, worldW, S, bx, by, null);
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.fillStyle = G.dl; c.fillRect(sa, 0, L - sa, vh); // darkest beside the play column, so the lit lane stands out
        c.fillStyle = G.dr; c.fillRect(R, 0, sb - R, vh);
        c.restore();
      } else {
        c.fillStyle = EDGE; c.fillRect(sa, 0, Math.max(0, L - sa), vh);
        c.fillRect(R, 0, Math.max(0, sb - R), vh);
      }
      c.fillStyle = G.l; c.fillRect(L - px, 0, 46 + px, vh);
      c.fillStyle = G.r; c.fillRect(r0 - 6, 0, 46 + px, vh);
    }
  }

  // ---------------------------------------------------------------- court
  // A polished floor that catches the level's light, boards receding toward you, the ball's shadow
  // and, when it burns, the glow of its flame on the boards.
  // On fire, the air streaks past: thin lines of the flame's light run back across the hall, more of them and
  // faster at full heat, so a streak feels fast without the ball going any faster.
  const STREAKS = Array.from({ length: 11 }, (_, i) => { const r = E.makeRng('streak' + i); return { y: 70 + r() * 520, len: 50 + r() * 90, sp: 0.75 + r() * 0.7, ph: r() }; });
  function drawStreaks(c, left, width) {
    const k = clamp((ball.fire - 0.25) / 0.6, 0, 1), col = flamePal(ball.nova).mid, n = ball.nova > 0.5 ? STREAKS.length : 7;
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const s = STREAKS[i], span = width + s.len * 2;
      const u = ((s.ph * span - view.time * 520 * s.sp - view.camX * 0.5) % span + span) % span;
      softGlow(c, left - s.len + u, s.y, s.len * 0.42, 0.9, col, (0.12 + 0.07 * (i % 3)) * k, 0);
    }
    c.globalCompositeOperation = 'source-over';
  }
  function fireLight(c, x, y) {
    const R = RV * (6 + 3 * ball.fire);
    c.globalCompositeOperation = 'lighter';
    softGlow(c, x, y, R, R, flamePal(ball.nova).mid, 0.12 * ball.fire * ball.flick, 0.13);
    c.globalCompositeOperation = 'source-over';
  }
  // The far side of the arena, behind the court: the courtside crowd in silhouette against the haze, and an
  // LED board along the baseline. The crowd is further away, so it drifts slower than the court; the board
  // moves with it. The crowd is painted once into a tile that repeats.
  const STANDS_W = 420, STANDS_H = 40, BOARD_H = 12, HAZE_H = 150;
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
      g.fillStyle = 'rgba(8,5,18,' + alpha + ')';
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
    row(STANDS_H - 14, 2.6, 3.4, 8, 0.5);
    row(STANDS_H - 2, 3.4, 4.4, 11, 0.94);
    standsK = k;
    return (standsEl = el);
  }
  const ARENA_G = { glow: null, bd: null };
  function drawArena(c, left, width) {
    const F = W.FLOOR, top = F - BOARD_H, x0 = left - 20, w = width + 40;
    if (!ARENA_G.glow) { // world-space gradients: made once, reused every frame
      const L = COURT_ART.arena.light;
      ARENA_G.glow = c.createLinearGradient(0, top - HAZE_H, 0, top); // the haze the board and the court light up, behind the crowd
      ARENA_G.glow.addColorStop(0, 'rgba(' + L + ',0)'); ARENA_G.glow.addColorStop(0.55, 'rgba(' + L + ',0.07)');
      ARENA_G.glow.addColorStop(0.86, 'rgba(' + L + ',0.2)'); ARENA_G.glow.addColorStop(1, 'rgba(' + L + ',0.34)');
      ARENA_G.bd = c.createLinearGradient(0, top, 0, F);
      ARENA_G.bd.addColorStop(0, '#150b2b'); ARENA_G.bd.addColorStop(1, '#070413');
    }
    c.fillStyle = ARENA_G.glow; c.fillRect(x0, top - HAZE_H, w, HAZE_H);
    const tile = standsTile(), shift = view.camX * 0.65; // the stands move at 35% of the court's speed
    for (let u = Math.floor((left - shift) / STANDS_W) * STANDS_W; u < left - shift + width; u += STANDS_W) {
      c.drawImage(tile, u + shift, top - STANDS_H, STANDS_W, STANDS_H);
    }
    c.fillStyle = ARENA_G.bd; c.fillRect(x0, top, w, BOARD_H);
    c.fillStyle = 'rgba(20,241,149,0.62)'; c.fillRect(x0, top, w, 0.8);
    const sp = textSprite('SOL DUNK', 700, 7 * scale * dpr, FONT_DISPLAY, 'rgba(20,241,149,0.6)'); // the LED board, in Solana green
    for (let x = Math.floor((left - 60) / 160) * 160; x < left + width + 60; x += 160) drawText(c, sp, x, top + BOARD_H / 2 + 0.5, scale * dpr);
  }
  function drawCourt(c, left, width, S, bx, by, rings) {
    const A = courtArt(), x0 = left - 20, w = width + 40, F = W.FLOOR;
    A.floor(c, x0, w, F, S, left + width / 2, width);
    // each ring casts a soft shadow on the boards below it, so the rings sit in the space
    if (rings) for (const o of rings) {
      const h = o.h, x = o.off + h.x, d = clamp((F - E.hoopY(h, o.t)) / 700, 0, 1);
      const rx = ((h.v ? h.w / 2 * RING_RY : E.hoopW(h, o.t) / 2) + P.RP) * (1 + 0.5 * d), a = (0.42 - 0.3 * d) * (h.st === 1 ? 0.4 : 1);
      softGlow(c, x, F + 3, rx, rx * 0.13, '0,0,0', a, 0);
    }
    c.globalAlpha = 1;
    if (!ball.hidden) {
      const hgt = clamp((F - by) / 560, 0, 1), sw = RV * (1.7 - 0.8 * hgt);
      c.fillStyle = 'rgba(0,0,0,' + (0.55 * (1 - hgt) + 0.1).toFixed(3) + ')';
      c.beginPath(); c.ellipse(bx, F + 3, sw, sw * 0.17, 0, 0, Math.PI * 2); c.fill();
      if (ball.fire > 0.03) {
        const rr = 130 * (1 - 0.45 * hgt);
        c.globalCompositeOperation = 'lighter';
        softGlow(c, bx, F + 1, rr, rr * 0.2, flamePal(ball.nova).mid, 0.4 * ball.fire * ball.flick * (1 - 0.6 * hgt), 0);
        c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
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
  const RING_PAL = { // the checkpoint ring is Solana green; a missed ring goes grey (ordinary rings: RIMS.sol)
    cp: { edge: '#022a1a', body: '#0b9462', mid: '#14f195', hi: '#aaffdc', spec: '242,255,249', back: '#076b45', bounce: '153,69,255' },
    grey: { edge: '#0f0c17', body: '#28233a', mid: '#38314f', hi: '#5a5277', spec: '214,206,240', back: '#1f1b2c', bounce: '120,100,200' }
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
    if (ringCache.size > 320) ringCache.clear(); // (breathing rings use one sprite per unit of width)
    ringCache.set(key, sp);
    return sp;
  }
  const RING_GLOW = { ring: '153,69,255', cp: '20,241,149' };
  // a breathing ring's sprites, one per unit of width, made when its level begins rather than in a frame
  function warmRings(def) {
    for (const h of def.hoops) if (h.pw) for (let w = Math.round(h.w - h.pw) - 1; w <= Math.round(h.w + h.pw) + 1; w++) ringSprites(w, h.cp ? 'cp' : eqRim());
  }
  function drawRing(c, o, back) {
    const h = o.h, v = hoopVis(h);
    const x = o.off + h.x, y = E.hoopY(h, o.t);
    const wn = h.pw ? Math.round(E.hoopW(h, o.t)) : h.w; // a breathing ring is drawn at its width now (to the unit; sprites made when the level begins)
    const sp = ringSprites(wn, h.st === 2 ? 'grey' : h.cp ? 'cp' : eqRim());
    const next = h === view.nextRing && h.st === 0;
    c.save();
    c.translate(x, y);
    const lf = !back && next && h.cp ? clamp((x - (view.drawX || 0) - 70) / 80, 0, 1) : 0;
    if (lf > 0) { // the checkpoint ring ahead says what it is, and gets out of the way as the ball arrives
      c.globalAlpha = (0.62 + 0.18 * Math.sin(view.time * 5)) * lf;
      drawText(c, textSprite('Checkpoint', 700, 12 * scale * dpr, FONT_DISPLAY, 'rgba(255,255,255,0.92)'), 0, -(wn / 2) * (h.v ? 1 : RING_RY) - P.RP - 13, scale * dpr);
      c.globalAlpha = 1;
    }
    c.rotate(h.tilt);
    const rx = wn / 2, ry = rx * RING_RY, pop = v.pop || 0;
    if (back && h.st !== 2) {
      // each ring glows with its own light, so it sits in the dark hall: the one you're heading for breathes
      // brighter, the ones after it sit back, and a ring just passed flares as the ball goes through
      // (a third softer than the first pass: the owner found the rims' glow a little too high)
      const base = h.st === 1 ? 0.05 : next ? 0.2 + (REDUCED ? 0 : 0.05 * Math.sin(view.time * 3.4)) : 0.135 * (o.later || 1);
      c.globalCompositeOperation = 'lighter';
      softGlow(c, 0, 0, rx * 1.75, rx * 0.95, h.cp ? RING_GLOW.cp : RING_GLOW.ring, base + 0.4 * pop, 0.3);
      c.globalCompositeOperation = 'source-over';
    }
    if (back && h.pw && h.st === 0) {
      // a breathing ring shows how wide it gets: a faint dashed outline at its widest
      const wx = (h.w + h.pw) / 2;
      c.strokeStyle = 'rgba(185,140,255,' + (0.22 * (o.later || 1)).toFixed(3) + ')'; c.lineWidth = 1.5; c.setLineDash([3, 6]);
      c.beginPath(); c.ellipse(0, 0, wx + P.RP, wx * RING_RY + P.RP, 0, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    }
    if (pop > 0.01 && h.st === 1) c.scale(1 + 0.1 * pop, 1 + 0.1 * pop); // a passed ring only: rings in play stay at their collision size
    c.globalAlpha = h.st === 1 ? 0.32 + 0.5 * pop : o.later || 1;
    c.drawImage(back ? sp.back : sp.front, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
    c.globalAlpha = 1;
    if (v.heat > 0) {
      // a rim the burning ball just swished through glows hot for a moment
      c.globalCompositeOperation = 'lighter';
      c.strokeStyle = rgba(flamePal(ball.nova).mid, 0.42 * v.heat); c.lineWidth = P.RP * (0.7 + 0.5 * v.heat); c.lineCap = 'round';
      c.beginPath(); c.ellipse(0, 0, rx, ry, 0, back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI); c.stroke();
      c.globalCompositeOperation = 'source-over';
    }
    if (!back && h.cp && h.st === 0 && !REDUCED) {
      // a slow glint travels along the green checkpoint ring
      const ph = (view.time * 0.5) % 1, ang = (0.88 - 0.76 * ph) * Math.PI;
      c.globalCompositeOperation = 'lighter';
      c.strokeStyle = 'rgba(226,255,242,' + (0.7 * Math.sin(ph * Math.PI)).toFixed(3) + ')';
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
      c.strokeStyle = v.flash < 0 ? 'rgba(206,190,240,0.85)' : 'rgba(255,255,255,' + (0.5 * a).toFixed(3) + ')';
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
  // A skin's shading never changes, so on the game's own canvas its gradients are made once and reused (a
  // gradient is drawn in whatever space is current when it's used, so the ball's moves and squash still apply).
  function skinGrads(c, r, sk) {
    if (c === cx && r === RV && sk._g) return sk._g;
    const G = sk.grad, o = {};
    o.body = c.createRadialGradient(-r * 0.38, -r * 0.42, r * 0.05, 0, 0, r * 1.02);
    o.body.addColorStop(0, G[0]); o.body.addColorStop(0.45, G[1]); o.body.addColorStop(0.85, G[2]); o.body.addColorStop(1, G[3]);
    if (sk.chrome) {
      o.sky = c.createLinearGradient(0, -r, 0, r * 0.12);
      o.sky.addColorStop(0, 'rgba(255,255,255,0.95)'); o.sky.addColorStop(1, 'rgba(150,162,186,0.9)');
      o.ground = c.createLinearGradient(0, r * 0.12, 0, r);
      o.ground.addColorStop(0, 'rgba(58,64,78,0.95)'); o.ground.addColorStop(1, 'rgba(10,12,18,0.95)');
    }
    if (sk.land) {
      o.air = c.createRadialGradient(0, 0, r * 0.78, 0, 0, r);
      o.air.addColorStop(0, 'rgba(150,210,255,0)'); o.air.addColorStop(1, 'rgba(170,225,255,0.55)');
    }
    o.hl = c.createRadialGradient(-r * 0.4, -r * 0.5, 0, -r * 0.4, -r * 0.5, r * (sk.shine ? 0.62 : 0.5));
    o.hl.addColorStop(0, 'rgba(255,255,255,' + (sk.shine ? 0.75 : 0.45) + ')'); o.hl.addColorStop(1, 'rgba(255,255,255,0)');
    if (c === cx && r === RV) sk._g = o;
    return o;
  }
  function drawBallBody(c, r, rot, sk) {
    sk = sk || eqBall();
    if (sk.pixel) { drawPixelBall(c, r, rot, sk); return; }
    const GR = skinGrads(c, r, sk);
    c.fillStyle = GR.body; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.save(); c.beginPath(); c.arc(0, 0, r - 0.3, 0, Math.PI * 2); c.clip();
    if (sk.chrome) { // a mirror: sky above the horizon, ground below; reflections don't turn with the ball
      c.fillStyle = GR.sky; c.fillRect(-r, -r, r * 2, r * 1.12);
      c.fillStyle = GR.ground; c.fillRect(-r, r * 0.12, r * 2, r);
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
      const t8 = textSprite('8', 800, 48, FONT_ROUND, '#0d0f14');
      drawText(c, t8, r * 0.16, -r * 0.07, 48 / (r * 0.56));
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
      c.fillStyle = GR.air; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    }
    if (sk.rim) { c.strokeStyle = sk.rim; c.lineWidth = r * 0.07; c.beginPath(); c.arc(0, 0, r - r * 0.04, Math.PI * 0.62, Math.PI * 1.08); c.stroke(); }
    c.fillStyle = GR.hl; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
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
    const key = far ? '_gf' : '_gn', mine = c === cx && r === RV;
    let g = mine && wg[key];
    if (!g) {
      g = c.createLinearGradient(-0.2 * s, -0.95 * s, -0.55 * s, 0.05 * s);
      if (far) { g.addColorStop(0, wg.far[0]); g.addColorStop(1, wg.far[1]); }
      else { g.addColorStop(0, wg.near[0]); g.addColorStop(0.55, wg.near[1]); g.addColorStop(1, wg.near[2]); }
      if (mine) wg[key] = g;
    }
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
    const sk = eqBall();
    if (!sk._halo) {
      sk._halo = c.createRadialGradient(0, 0, r * 0.8, 0, 0, r * 1.9);
      sk._halo.addColorStop(0, 'rgba(' + sk.halo + ',0.13)'); sk._halo.addColorStop(1, 'rgba(' + sk.halo + ',0)');
    }
    c.fillStyle = sk._halo; c.beginPath(); c.arc(0, 0, r * 1.9, 0, Math.PI * 2); c.fill();
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
  const PARCELS = []; // spent parcels of gas, reused so the flame makes no garbage
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
      if (ball.hidden) { for (const p of T.pts) PARCELS.push(p); T.pts.length = 0; }
      for (let i = T.pts.length - 1; i >= 0; i--) {
        const p = T.pts[i], rel = Math.hypot(p.vx - evx, p.vy - evy);
        p.age += dt * (1 + Math.max(0, rel - 260) / 260);             // gas torn away fast burns out sooner
        if (p.age >= p.life || p.x * p.x + p.y * p.y > Lmax2) { PARCELS.push(p); T.pts.splice(i, 1); continue; }
        p.vx *= drag; p.vy = p.vy * drag - lift;                       // slows to the air and rises
        const stir = stir0 * p.age / p.life;                           // older gas is stirred more
        p.x += (p.vx - evx + stir * noise1(p.y * 0.05 + t * 2.3 + T.seed)) * dt;
        p.y += (p.vy - evy + stir * 0.7 * noise1(p.x * 0.05 - t * 2.1 + T.seed * 1.7)) * dt;
      }
      if (!live) { T.acc = 0; continue; }
      T.acc += dt;
      const E2 = emitter(T), push = 110 + 60 * ball.flare, fan = 1 + 0.22 * ball.flare;
      while (T.acc >= F_STEP) {
        T.acc -= F_STEP;
        const a = T.acc, vx0 = evx * 0.5 + E2.nx * push, vy0 = evy * 0.5 + E2.ny * push; // left `a` seconds ago
        const p = PARCELS.pop() || {};
        p.x = E2.x + (vx0 - evx) * a; p.y = E2.y + (vy0 - evy) * a; p.vx = vx0; p.vy = vy0; p.age = a;
        // each parcel's life varies smoothly from one to the next (a random life per parcel made the tip jitter
        // back and forth every frame), and it keeps the fanning it left with, so a flap's fanning flows out
        // along the flame instead of the whole flame widening at once
        p.life = life * (1 + 0.1 * noise1((t - a) * 6 + T.seed * 11)); p.w = breath(T, t - a); p.s = fan;
        T.pts.push(p);
      }
      if (T.pts.length > 48) { for (let i = 0; i < T.pts.length - 48; i++) PARCELS.push(T.pts[i]); T.pts.splice(0, T.pts.length - 48); }
    }
  }
  const FLAME_LAYERS = [ // [ribbon width, ribbon length, colour, alpha, cap front radius, cap half-width]; caps in ball radii
    [1, 1, 'outer', 0.97, 1.12, 1.3],
    [0.74, 0.8, 'mid', 0.97, 1.02, 1.1],
    [0.5, 0.6, 'inner', 0.97, 0.9, 0.92],
    [0.28, 0.4, 'core', 0.92, 0.78, 0.72]
  ];
  // scratch space for the ribbons, allocated once
  const RBX = new Float32Array(66), RBY = new Float32Array(66), RBH = new Float32Array(66), RBW = new Float32Array(66);
  const QX = new Float32Array(68), QY = new Float32Array(68), QH = new Float32Array(68);
  const OLX = new Float32Array(68), OLY = new Float32Array(68), ORX = new Float32Array(68), ORY = new Float32Array(68);
  const prof = (u) => Math.pow(1 - u, 0.62) * (1 + 0.4 * Math.sin(Math.PI * u)); // width along a tongue, root to tip
  // One tongue in one layer: a ribbon through its parcels (relative to the ball), newest first. Where the tongue
  // pinched off (its gas thinned below `cut`), the ribbon breaks, and each part burns as its own lick with a point at
  // both ends instead of hanging on by a thread. `cut` is the same width in every layer, so the hotter, narrower
  // layers break sooner and always sit inside the outer ones.
  function ribbon(c, T, W, ws, ls, rootW, cut) {
    const E2 = emitter(T), pts = T.pts;
    let m = 1, lastU = 0, tipped = false;
    RBX[0] = E2.x; RBY[0] = E2.y; RBW[0] = rootW; RBH[0] = rootW - cut;
    for (let i = pts.length - 1; i >= 0 && m < 64; i--) {
      const p = pts[i], u = p.age / (p.life * ls);
      if (u >= 1) { // the tip burns out between this parcel and the last one
        const k = (1 - lastU) / Math.max(1e-6, u - lastU);
        RBX[m] = RBX[m - 1] + (p.x - RBX[m - 1]) * k; RBY[m] = RBY[m - 1] + (p.y - RBY[m - 1]) * k; RBW[m] = 0; RBH[m] = -cut; m++;
        tipped = true; break;
      }
      const w = W * ws * p.w * p.s * prof(u);
      RBX[m] = p.x; RBY[m] = p.y; RBW[m] = w; RBH[m] = w - cut; m++; lastU = u;
    }
    if (!tipped) { RBW[m - 1] = 0; RBH[m - 1] = -cut; } // the oldest gas is the tip
    // each run of points wider than the cut is one lick; its ends sit where the width crosses the cut
    let i = 0;
    while (i < m) {
      while (i < m && RBH[i] <= 0) i++;
      if (i >= m) break;
      let j = i;
      while (j + 1 < m && RBH[j + 1] > 0) j++;
      let n = 0;
      if (i > 0) { const k = RBH[i - 1] / (RBH[i - 1] - RBH[i]); QX[n] = RBX[i - 1] + (RBX[i] - RBX[i - 1]) * k; QY[n] = RBY[i - 1] + (RBY[i] - RBY[i - 1]) * k; QH[n] = 0; n++; }
      // full width wherever the gas is twice the cut or more, easing to nothing at the break
      let top = 0;
      for (let q = i; q <= j; q++) { const e = Math.min(1, RBH[q] / cut); QX[n] = RBX[q]; QY[n] = RBY[q]; QH[n] = RBW[q] * e * e * (3 - 2 * e); top = Math.max(top, QH[n]); n++; }
      if (j < m - 1) { const k = RBH[j] / (RBH[j] - RBH[j + 1]); QX[n] = RBX[j] + (RBX[j + 1] - RBX[j]) * k; QY[n] = RBY[j] + (RBY[j + 1] - RBY[j]) * k; QH[n] = 0; n++; }
      if (n >= 3 && top > cut * 1.5) lick(c, n); // a needle of gas this thin has burnt out
      i = j + 1;
    }
  }
  // fill the outline of one lick through QX/QY with half-widths QH (a blunt root if QH[0] > 0, else a point)
  function lick(c, n) {
    for (let k = 0; k < n; k++) {
      const a = k > 0 ? k - 1 : 0, b = k < n - 1 ? k + 1 : n - 1;
      let tx = QX[b] - QX[a], ty = QY[b] - QY[a];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      OLX[k] = QX[k] - ty * QH[k]; OLY[k] = QY[k] + tx * QH[k]; ORX[k] = QX[k] + ty * QH[k]; ORY[k] = QY[k] - tx * QH[k];
    }
    c.beginPath();
    c.moveTo(ORX[0], ORY[0]); c.lineTo(OLX[0], OLY[0]);
    for (let k = 1; k < n - 1; k++) c.quadraticCurveTo(OLX[k], OLY[k], (OLX[k] + OLX[k + 1]) / 2, (OLY[k] + OLY[k + 1]) / 2);
    c.lineTo(QX[n - 1], QY[n - 1]);
    c.lineTo((ORX[n - 2] + QX[n - 1]) / 2, (ORY[n - 2] + QY[n - 1]) / 2);
    for (let k = n - 2; k > 0; k--) c.quadraticCurveTo(ORX[k], ORY[k], (ORX[k] + ORX[k - 1]) / 2, (ORY[k] + ORY[k - 1]) / 2);
    c.closePath(); c.fill();
  }
  function drawFlame(c, r, f, n, t) {
    const P = flamePal(n), dx = ball.fdx, dy = ball.fdy;
    // a soft glow first, flickering with the fire
    c.globalCompositeOperation = 'lighter';
    const gr = r * (2.2 + 1.8 * f);
    softGlow(c, dx * r * 0.75, dy * r * 0.75, gr, gr, P.outer, 0.4 * f * ball.flick, 0.08);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    const g = 0.5 + 0.5 * Math.min(1, f * 1.6), a = Math.min(1, f * 3), ang = Math.atan2(dy, dx), fan = 1 + 0.1 * ball.flare;
    const W = r * (0.5 + 0.32 * f), cut = W * 0.065, rootFan = 1 + 0.22 * ball.flare;
    for (const Ly of FLAME_LAYERS) {
      c.fillStyle = rgba(P[Ly[2]], Ly[3] * a);
      const rf = r * (1 + (Ly[4] - 1) * g), w = (r * Ly[5] * g + r * 0.55 * (1 - g)) * fan;
      c.beginPath(); c.ellipse(0, 0, rf, w, ang, 0, Math.PI * 2); c.fill(); // wraps the front of the ball
      for (const T of flame.T) ribbon(c, T, W * T.size, Ly[0], Ly[1], W * T.size * Ly[0] * breath(T, t) * rootFan, cut);
    }
  }

  const BEHIND = [false, false, false, false, false, true, true, true, true, true, true, true, true, true]; // embers, flame licks, smoke, air puffs and trail bits sit behind the ball
  function drawParts(c, behind) {
    for (const p of parts) {
      if (BEHIND[p.kind] !== behind) continue;
      const t = p.life / p.max;
      const add = p.kind === 0 || p.kind === 3 || p.kind === 5 || p.kind === 12 || p.kind === 13 || (p.kind === 6 && p.burst);
      c.globalCompositeOperation = add ? 'lighter' : 'source-over';
      if (p.kind === 0) { c.globalAlpha = t; c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size * (0.5 + t * 0.5), 0, Math.PI * 2); c.fill(); }
      else if (p.kind === 1) { c.globalAlpha = Math.min(1, t * 2); c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillStyle = p.color; c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); c.restore(); }
      else if (p.kind === 3) { // a ripple: it eases out as it spreads (grow) and thins as it fades (lw)
        const e = 1 - t * t, rr = p.size + e * (p.grow || 28);
        c.globalAlpha = t * (p.a || 0.6); c.strokeStyle = p.color; c.lineWidth = (p.lw || 2) * t + 0.5; c.beginPath(); c.ellipse(p.x, p.y, rr, rr * (p.ry || RING_RY), p.rot || 0, 0, Math.PI * 2); c.stroke();
      } else if (p.kind === 12) { // a shaft of light dropping through a ring the ball swished: quick in, slow out
        const e = Math.min(1, (1 - t) * 9) * t;
        softGlow(c, p.x, p.y + p.size * (1.1 + 0.5 * (1 - t)), p.w, p.size * (1.2 + 0.5 * (1 - t)), p.color, (p.a || 0.3) * e, 0.05);
      } else if (p.kind === 13) { // a bloom: a soft flash of light that swells and fades
        const e = 1 - t * t;
        softGlow(c, p.x, p.y, p.size + e * (p.grow || 60), (p.size + e * (p.grow || 60)) * (p.ry || 1), p.color, (p.a || 0.4) * t * t, 0.1);
      }
      else if (p.kind === 4) {
        c.globalAlpha = Math.min(1, t * 2); c.save(); c.translate(p.x, p.y); c.scale(Math.cos(p.rot), 1);
        c.fillStyle = p.color; c.beginPath(); c.arc(0, 0, p.size, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(-p.size * 0.25, -p.size * 0.3, p.size * 0.35, 0, Math.PI * 2); c.fill();
        c.restore();
      } else if (p.kind === 5) { c.globalAlpha = Math.min(1, t * 1.6, (1 - t) * 12) * 0.9; c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size * (0.4 + t * 0.6), 0, Math.PI * 2); c.fill(); }
      else if (p.kind === 6) {
        // a lick of flame breaking away: it swells in, curls as it rises, cools from the flame's hot colours
        // to its edge colour and burns down to nothing. Two layers, like the flame: its edge, then a hotter middle.
        const e = Math.min(1, (1 - t) / 0.2), grow = e * e * (3 - 2 * e);
        const sz = p.size * (0.45 + 0.55 * grow) * (0.4 + 0.6 * t), a = grow * Math.min(1, t * 3);
        if (a < 0.01) continue;
        const L = sz * 2.4, Wd = sz * 0.62, bend = Math.sin(p.life * 18 + (p.sw || 0) * 6) * sz * 0.45;
        c.save(); c.translate(p.x, p.y); c.rotate(Math.atan2(p.vy, p.vx));
        for (let k = 0; k < 2; k++) {
          const q = k ? 0.55 : 1;
          c.globalAlpha = 1; c.fillStyle = lickRgba(p.n, k ? Math.min(1, t + 0.45) : t, a * (k ? 0.9 : 0.85));
          c.beginPath(); c.moveTo(-L * 0.3 * q, 0);
          c.quadraticCurveTo(-L * 0.1 * q, -Wd * q, L * 0.25 * q, -Wd * 0.5 * q + bend * 0.5);
          c.quadraticCurveTo(L * 0.5 * q, -Wd * 0.12 * q + bend, L * 0.72 * q, bend);
          c.quadraticCurveTo(L * 0.45 * q, Wd * 0.3 * q + bend * 0.7, L * 0.15 * q, Wd * 0.62 * q);
          c.quadraticCurveTo(-L * 0.14 * q, Wd * 0.7 * q, -L * 0.3 * q, 0);
          c.fill();
        }
        c.restore();
      } else if (p.kind === 7) {
        const sz = p.size * (1.7 - 0.7 * t), e = Math.min(1, (1 - t) / 0.15);
        c.globalAlpha = 0.55 * t * e * e * (3 - 2 * e); c.drawImage(smokeSprite(), p.x - sz, p.y - sz, sz * 2, sz * 2);
      } else if (p.kind === 8) { // an air puff from a flap
        const rr = p.size * (1.8 - 0.8 * t);
        c.globalAlpha = 0.28 * t * Math.min(1, (1 - t) * 6); c.strokeStyle = "#ffffff"; c.lineWidth = 0.6 + 1.8 * t; c.lineCap = 'round';
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
  function drawTexts(c, dt) {
    const wl = view.wl != null ? view.wl : view.camX, wr = view.wr != null ? view.wr : view.camX + VIEW_W;
    const K = scale * dpr; // device pixels per world unit at full zoom: the sprites are drawn at that size
    for (const t of texts) {
      const k = t.life / t.max;
      // in: fade and settle from a touch larger, eased; out: fade over the last 40%
      const kin = clamp((1 - k) / 0.2, 0, 1), a = Math.min(kin * kin * (3 - 2 * kin), Math.min(1, k * 2.5));
      const s = 1 + 0.24 * Math.pow(1 - clamp((1 - k) / 0.15, 0, 1), 2);
      const sp = t.sp || (t.sp = textSprite(t.text, 700, t.size * 1.25 * K, FONT_DISPLAY, t.color)); // 1.25: room for the pop
      const half = sp.tw * s / (1.25 * K) / 2 + 8; // includes the pop, as when the label was measured in its font
      if (t.cx == null) t.x = clamp(t.x, wl + half, wr - half);
      else t.x += (view.camX - t.cx) * 0.75;
      t.cx = view.camX;
      t.x = clamp(t.x, wl + half, wr - half);
      if (view.wt != null) t.y = Math.max(t.y, view.wt + t.size * 0.9 + 4); // never behind the HUD
      const bx = view.drawX, by = view.drawY, r = RV + 4;
      const onBall = bx != null && !ball.hidden && Math.abs(bx - t.x) < half + r && by > t.y - t.size - r && by < t.y + 18 + r;
      t.dim = lerp(t.dim == null ? 1 : t.dim, onBall ? 0.28 : 1, 1 - Math.exp(-dt * 16));
      c.globalAlpha = clamp(a, 0, 1) * t.dim;
      drawText(c, sp, t.x, t.y - t.size * 0.36, 1.25 * K, s); // the sprite is centred on the text's middle, not its baseline
      if (t.sub) {
        const ss = t.ss || (t.ss = textSprite(t.sub, 700, 12 * K, FONT_DISPLAY, 'rgba(47,211,107,0.95)'));
        drawText(c, ss, t.x, t.y + 15 - 4.3, K);
      }
    }
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- input
  function flapInput() {
    Sound.unlock();
    const still = KB && performance.now() - mouseAt > 1500; // flown by keyboard: the pointer steps aside
    if (phase === 'ready') { beginPlay(); if (still) hideCursor(); return; }
    if (phase === 'play') { pendingTap = true; if (still) hideCursor(); return; }
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
    if (e.code === 'ArrowUp' && phase === 'lobby' && nav.tab === 'play' && !nav.page && tag !== 'INPUT' && !tourOpen() && ui.panel.classList.contains('hide')) {
      e.preventDefault(); $('betUp').click(); // between runs the up arrow raises the bet (in a run it flaps)
    } else if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
      const onPlayTab = document.activeElement && document.activeElement.id === 'tabPlay' && nav.tab === 'play'; // Space on the open Play tab plays, like the button says
      if (tag === 'INPUT' || (tag === 'BUTTON' && !onPlayTab && phase !== 'play' && phase !== 'ready' && phase !== 'paused')) return;
      if (nav.page) return; // a page is open: Space scrolls it, and nothing starts or resumes behind it
      if (tourOpen()) { e.preventDefault(); return; } // the tour is up: nothing starts behind it
      const panelOpen = !ui.panel.classList.contains('hide');
      if (e.code === 'Space' && !panelOpen && !e.repeat) {
        if (phase === 'lobby') { e.preventDefault(); if (nav.tab === 'play') startRun(); return; }
        if (phase === 'over' && armed(ui.res)) { e.preventDefault(); again(); return; }
      }
      e.preventDefault();
      if (!e.repeat) flapInput();
    } else if (phase === 'checkpoint' && tag !== 'BUTTON' && armed(ui.cp) && (e.code === 'KeyC' || e.code === 'Enter')) {
      e.preventDefault();
      if (e.code === 'KeyC') cashOut(); else keepGoing();
    } else if (e.code === 'KeyM' && tag !== 'INPUT' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      toggleSetting('sound');
    } else if (e.code === 'KeyF' && tag !== 'INPUT' && !e.metaKey && !e.ctrlKey && !e.altKey && FS_OK && !e.repeat) {
      toggleFullscreen();
    } else if (lobbyKeys(e, tag)) {
      e.preventDefault();
    } else if (e.code === 'KeyP' && tag !== 'INPUT' && !e.metaKey && !e.ctrlKey && !e.altKey && (phase === 'play' || phase === 'paused') && !nav.page) {
      if (phase === 'play') pause(); else resume();
    } else if (e.code === 'Escape') {
      if (tourOpen()) closeTour();
      else if (!ui.panel.classList.contains('hide')) closePanel();
      else if (nav.page) closePage();
      else if (phase === 'play') pause();
      else if (phase === 'paused') resume();
      else if (phase === 'lobby' && nav.tab === 'locker') setTab('profile');
      else if (phase === 'lobby' && nav.tab !== 'play') setTab('play');
    }
  });
  // Between runs, a keyboard does what the pointer does: 1 to 4 open the tabs in the sidebar's order; on Play, left and right pick
  // the mode and up and down step the bet. (In a run the up arrow flaps, so these only work in the lobby.)
  function lobbyKeys(e, tag) {
    if (phase !== 'lobby' || tag === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey || tourOpen() || !ui.panel.classList.contains('hide')) return false;
    const tab = TABS[{ Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 }[e.code]];
    if (tab) { if (!e.repeat && (nav.page || nav.tab !== tab)) { setTab(tab); Sound.click(); } return true; }
    if (nav.tab !== 'play' || nav.page) return false;
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const el = $('diff' + clamp(prefs.di + (e.code === 'ArrowRight' ? 1 : -1), 0, E.DIFFS.length - 1));
      if (el && !e.repeat && el.getAttribute('aria-checked') !== 'true') el.click();
      return true;
    }
    if (e.code === 'ArrowDown') { $('betDown').click(); return true; }
    return false;
  }
  // Full screen (F), where the page is allowed to ask for it (an embedded page often isn't: then the key isn't shown)
  const FS_OK = !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);
  document.body.classList.toggle('fs-ok', FS_OK);
  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else { const p = document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); }
    } catch (e) { /* not allowed here */ }
  }
  // With a mouse, the pointer gets out of the way of a run: it hides after a moment's stillness while the ball is
  // flying, and comes back the moment the mouse moves (the cards need it).
  let mouseAt = 0, cursorTimer = 0;
  const hideCursor = () => { if (KB && phase === 'play') document.body.classList.add('nocursor'); };
  if (KB) window.addEventListener('mousemove', () => {
    mouseAt = performance.now();
    if (document.body.classList.contains('nocursor')) document.body.classList.remove('nocursor');
    clearTimeout(cursorTimer); cursorTimer = setTimeout(hideCursor, 1800);
  }, { passive: true });
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
  const again = () => { show(ui.res, false); if (run.mode === 'special') startSpecial(run.slot); else if (run.mode === 'duel') startDuel(); else if (run.mode === 'pot') startPot(); else if (practicing()) startPractice(); else startRun(); };
  $('againBtn').addEventListener('click', () => { if (armed(ui.res)) again(); });
  $('lobbyBtn').addEventListener('click', () => { Sound.click(); const sp = course(); backToLobby(); if (sp) setTab('challenges'); });
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
  ui.scrim.addEventListener('click', () => { if (tourOpen()) closeTour(); else closePanel(); });
  // any [data-page] button opens its page, including ones drawn later (Profile rows, the Odds link, the pause card)
  document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-page]'); if (b && !b.disabled) openPage(b.dataset.page, b.dataset.slot); });
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
    medal: '<circle cx="12" cy="15" r="5.6"/><path d="M8.4 3.2 12 9.4l3.6-6.2"/><path d="M12 13v4M10.4 14.2 12 13" opacity=".7"/>',
    tap: '<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="7" opacity=".55"/><circle cx="12" cy="12" r="10.3" opacity=".22"/>',
    rim: '<ellipse cx="11" cy="15.5" rx="8.5" ry="3"/><circle cx="18" cy="9" r="3.4" fill="currentColor" stroke="none"/>',
    swish: '<ellipse cx="12" cy="16" rx="8.5" ry="3"/><path d="M12 3v11M8.6 10.6 12 14l3.4-3.4"/>',
    fire: '<path d="M12 21.2c-3.7 0-6.2-2.5-6.2-5.8 0-3.5 2.7-5.4 3.7-8.7.9 1.7 2 2.6 2.7 2.6.4-2.3-.2-4.6-1.2-6.7 3.9 1.6 7.2 5.8 7.2 10.5 0 4.3-2.6 8.1-6.2 8.1z"/>',
    flag: '<ellipse cx="12" cy="16.5" rx="8.5" ry="3"/><path d="M12 13.5V3.2l5.4 2.1L12 7.4"/>',
    star: '<path d="m12 3.3 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9-4.3-4.1 5.9-.8z"/>',
    mission: '<rect x="4" y="4" width="16" height="16" rx="4.5"/><path d="m8.4 12.2 2.5 2.5 4.8-5"/>',
    trophy: '<path d="M7.6 3.8h8.8v5.4a4.4 4.4 0 0 1-8.8 0z"/><path d="M7.6 5.6H4.8v1.2a3.3 3.3 0 0 0 3.1 3.3M16.4 5.6h2.8v1.2a3.3 3.3 0 0 1-3.1 3.3M12 13.6v3.6M8.4 20.2h7.2"/>',
    practice: '<circle cx="12" cy="12" r="9"/><path d="M10 8.4v7.2l5.6-3.6z" fill="currentColor"/>',
    back: '<circle cx="12" cy="12" r="8.6"/><path d="M15.8 12H8.4M11.4 8.9 8.3 12l3.1 3.1"/>'
  };
  function howHtml() {
    const row = (icon, tone, title, text) => `<div class="hrow"><span class="hic ${tone}"><svg viewBox="0 0 24 24" aria-hidden="true">${HOW_ICON[icon]}</svg></span><div><h3>${title}</h3><p>${text}</p></div></div>`;
    // one short idea a row; the details live on the pages they belong to
    return (phase === 'lobby' ? `<button class="btn btn-plain how-tour" id="howTour">Take the quick tour</button>` : '') + `<div class="how">` +
      row('tap', 'blue', KB ? 'Press Space to flap' : 'Tap to flap', `Each ${KB ? 'press (or click)' : 'tap'} flaps the ball up. Let it drop down through every ring. Miss a ring or hit the floor and the run is over.`) +
      row('rim', 'red', 'Rims', `Touching the rim is fine: if the ball comes down over the opening, it drops in. Land on the outer half of a rim and it falls off.`) +
      row('swish', 'green', 'Swish', `Go through without touching the rim. A swish pays more than a rim hit, and each swish in a row pays more, up to 5 in a row.`) +
      row('fire', 'heat', 'Fire', `Swish 3 in a row and the ball catches fire. At 5 it burns green. A rim hit puts it out.`) +
      row('flag', 'gold', 'Checkpoints', `Every ${NH} rings, the green ring ends the level. Cash out, or keep going for more.`) +
      row('practice', 'blue', 'Practice', `${KB ? 'Click' : 'Tap'} <b>Practice for free</b> under Play for a run with nothing at stake.`) +
      row('star', 'gold', 'Score and XP', `Rings score points, more for swishes and streaks. Points, missions and trophies earn XP, which unlocks balls, wings and trails. Neither changes what a run pays.`) +
      row('mission', 'purple', 'Missions', `Three at a time, new every day and every week. They count in every run, whatever you bet, and pay SOL once you've bet ${fmtBet(mview().base.day)} SOL that day or ${fmtBet(mview().base.week)} SOL that week: tap Claim to collect it. Finish all three to open the next round, which pays more.`) +
      row('medal', 'gold', 'Trophies', `Fifteen one-time goals. Each adds XP and pays a little SOL: claim it on the Trophies page once your bets cover it.`) +
      row('back', 'green', 'Rakeback', `Every bet sets a little SOL aside for you: ${Math.round(LV.RATE * 100)}% of the house's cut. Level up to claim it.`) +
      row('trophy', 'gold', 'Challenges', `<b>Special levels</b>: pay the entry and clear one course to win 2×, 3× or 5× it. Clear one and a new one takes its place; some have walls to fly over, rings on their side to fly straight through, or rings that breathe. They open after ${fmtBet(specState && specState.unlock ? specState.unlock.need : SP.UNLOCK * SP.ENTRY)} SOL of regular runs. <b>Duel</b>: race a rival over the same rings; whoever gets further takes the pot. <b>Daily pot</b>: one course for everyone each day. Fly it as often as you like; your best counts, and the best three split the pot.`) +
      `</div>`;
  }
  // ---------------------------------------------------------------- the quick tour
  // Three steps for a first-time player (and from How to play): how to fly, why swishes matter, and the checkpoint
  // where you cash out. It ends with a free practice run.
  const TOUR = [
    KB ? { ic: 'tap', t: 'Press Space to fly', x: 'Each press flaps the ball up. A click works too. Let it fall down through every ring.' }
      : { ic: 'tap', t: 'Tap to fly', x: 'Each tap flaps the ball up. Let it fall down through every ring.' },
    { ic: 'swish', t: 'Swish to win more', x: 'Go through clean, without touching the rim. Swishes in a row win more each time.' },
    { ic: 'flag', t: 'Cash out at the green ring', x: 'Every ' + NH + ' rings, take your winnings or keep going for more. Miss a ring and you lose the bet.' }
  ];
  let tourAt = -1;
  const tourOpen = () => tourAt >= 0;
  function showTour(i) {
    const T = TOUR[i], last = i === TOUR.length - 1, nb = $('tourNext');
    tourAt = i;
    $('tourIc').innerHTML = `<svg viewBox="0 0 24 24">${HOW_ICON[T.ic]}</svg>`;
    $('tourTitle').textContent = T.t; $('tourText').textContent = T.x;
    document.querySelectorAll('#tour .tour-dots i').forEach((d, k) => d.classList.toggle('on', k <= i));
    nb.textContent = last ? 'Practice for free' : 'Next'; nb.className = 'btn ' + (last ? 'btn-primary' : 'btn-plain');
    $('tourSkip').textContent = last ? 'Not now' : 'Skip';
    ui.scrim.classList.add('show', 'tour'); show($('tour'), true);
    setTimeout(() => $('tour').focus({ preventScroll: true }), 30);
  }
  function closeTour() {
    if (!tourOpen()) return;
    tourAt = -1; prefs.tourSeen = 1; saveAll();
    show($('tour'), false); ui.scrim.classList.remove('show', 'tour');
  }
  $('tourNext').addEventListener('click', () => { Sound.click(); if (tourAt < TOUR.length - 1) showTour(tourAt + 1); else { closeTour(); startPractice(); } });
  $('tourSkip').addEventListener('click', () => { Sound.click(); closeTour(); });
  // locker thumbnails, drawn with the same code as the game
  function drawThumb(el, t, id) {
    const g = el.getContext('2d'), s = el.width;
    g.clearRect(0, 0, s, s); g.save();
    g.translate(s / 2, s / 2);
    if (t === 'ball') { drawBallBody(g, s * 0.32, 0.45, BALLS[id]); }
    else if (t === 'wing') { const r = s * 0.42; g.translate(r * 0.95, r * 0.92); drawWing(g, r, -0.1, false, WINGS[id]); }
    else if (t === 'trail') thumbTrail(g, s, id);
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
  // Odds & fairness: what each ring pays on a tier, the total a run has after each level, and how a run can be
  // checked. Opened from the Play sheet it shows the tier you have picked.
  let oddsTier = null;
  // a total's range: "1.02–1.09×", or one value when both ends round the same; a whole cap reads "250×", not "250.0×"
  const fmtTot = (m) => (Number.isInteger(m) && m >= 10 ? m + '×' : fmtMult(m));
  const multRange = (lo, hi) => { const a = fmtTot(lo), b = fmtTot(hi); return a === b ? a : a.slice(0, -1) + '–' + b; };
  function oddsHtml() {
    const di = oddsTier == null ? prefs.di : oddsTier;
    const D = E.DIFFS[di], rows = [];
    let lo = 1, hi = 1, s = 0; // the total after each level: every ring a rim hit, or every ring a swish (the streak carries over)
    for (let L = 1; L <= NL; L++) {
      const pt = PAY.PAYTABLE[di][L - 1];
      for (let i = 0; i < NH; i++) { lo *= E.hoopMultiplier(pt, 'R', 0); s++; hi *= E.hoopMultiplier(pt, 'S', s); }
      lo = Math.min(lo, D.maxWin); hi = Math.min(hi, D.maxWin);
      rows.push(`<tr><td>${L}</td><td class="r">${pt.rim.toFixed(3)}</td><td class="r">${pt.swish[0].toFixed(3)}</td><td class="r">${pt.swish[pt.swish.length - 1].toFixed(3)}</td><td class="r tot">${multRange(lo, Math.min(hi, TOP[di]))}</td></tr>`);
    }
    return `<p class="vsub">Every ring you pass multiplies your bet. A swish multiplies it more than a rim hit, and a swish streak more still.</p>
      <div class="seg odds-seg" id="oddsSeg" role="group" aria-label="Tier">${E.DIFFS.map((d, i) => `<button data-t="${i}" aria-pressed="${i === di}">${d.name}</button>`).join('')}</div>
      <div class="tbl"><table><thead><tr><th>Level</th><th class="r">Rim</th><th class="r">Swish</th><th class="r">5+ streak</th><th class="r">Total</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      <div class="prose"><p><b>Rim</b>, <b>Swish</b> and <b>5+ streak</b> are what one ring multiplies your bet by on that level. <b>Total</b> is what your bet is multiplied by once you clear the level: the low end if every ring was a rim hit, the high end if every one was a swish.</p>
      <p>${D.name} pays up to <b>${TOP[di]}×</b> your bet. An average player who cashes out at the first checkpoint gets back about ${Math.round(PAY.AVG_RTP[di][0] * 100)}% of their bet over time, and less the deeper they go. Skilled players do better.</p></div>
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
      const net = stats.returned - stats.wagered, flat = Math.abs(net) < 0.00005;
      return `<div class="sp-prize wl-bal"><span class="k">Demo balance</span><div class="big"><span class="num">${fmtBal(wallet.balance)}</span><span class="unit">SOL</span></div></div>
        <div class="tiles"><div><b>${stats.runs}</b><span>Runs</span></div><div><b>${stats.best ? fmtMult(stats.best) : '–'}</b><span>Best</span></div><div><b class="${flat ? '' : net > 0 ? 'pos' : 'neg'}">${flat ? '0' : (net > 0 ? '+' : '−') + fmtSol(Math.abs(net))}</b><span>Net SOL</span></div></div>
        <div class="prose"><p>You're playing with demo SOL. Real SOL play runs through the SOL DUNK server with Phantom or Solflare.</p></div>
        <button class="btn btn-plain" id="resetBal">Reset to ${CFG.demoStart} demo SOL</button>`;
    }
    if (!bank.real || !ServerBank.token) {
      return `<div class="prose"><p>Connect a Solana wallet to play with real SOL on <b>${CFG.network}</b>.</p></div><button class="btn btn-primary" id="wConnect">Connect wallet</button>
        <p class="err" id="wErr"></p><div class="prose"><p>On a phone, open this page in the Phantom or Solflare browser.</p></div>`;
    }
    return `<div class="sp-prize wl-bal"><span class="k">Balance</span><div class="big"><span class="num">${fmtBal(ServerBank.bal)}</span><span class="unit">SOL</span></div></div>
      <div class="tiles two"><div><b>${ServerBank.address.slice(0, 4)}…${ServerBank.address.slice(-4)}</b><span>Wallet</span></div><div><b>${CFG.network}</b><span>Network</span></div></div>
      <div class="group"><div class="row"><label class="k" for="wAmt">Amount</label><label class="bet-field"><input id="wAmt" class="bet-input" inputmode="decimal" value="0.1"><span class="unit">SOL</span></label></div></div>
      <div class="actions"><button class="btn btn-plain" id="wWithdraw">Withdraw</button><button class="btn btn-green" id="wDeposit">Deposit</button></div>
      <p class="err" id="wErr"></p>`;
  }
  // trophies: the whole case, earned ones lit
  function trophiesHtml() {
    const got = ACH.filter((a) => profile.ach[a.id]).length, tv = tview(), T = Object.fromEntries(tv.list.map((x) => [x.id, x]));
    const total = ACH.reduce((n, a) => n + a.sol, 0), open = tv.list.filter((x) => x.can).reduce((n, x) => n + x.reward, 0);
    const waits = tv.list.filter((x) => x.earned && !x.claimed && !x.can).map((x) => x.more), next = waits.length ? Math.min(...waits) : 0;
    const more = (m) => fmtBet(Math.ceil(m * 100 - 1e-6) / 100);
    // under each trophy: what it pays, a Claim key once its SOL can be claimed, how much more to bet until then, or what was claimed
    const foot = (a) => {
      const x = T[a.id] || { reward: a.sol };
      if (x.claimed) return `<em class="tx paid">${ICON.check}${fmtBet(x.claimed)} SOL</em>`;
      if (x.can) return `<button class="tro-claim" data-claim="${a.id}" aria-label="Claim ${fmtBet(x.reward)} SOL for ${a.name}">Claim ${fmtBet(x.reward)}</button>`;
      if (!x.earned && profile.ach[a.id]) return `<em class="tx">${ICON.check}Earned</em>`; // earned on this device before the server kept trophies: no SOL
      if (x.earned) return `<em class="tx wait"><b>${fmtBet(x.reward)} SOL</b>Bet ${more(x.more)} more</em>`;
      return `<em class="tx two"><b>+${a.xp} XP</b>${fmtBet(x.reward)} SOL</em>`;
    };
    return `<p class="vsub">${got ? got + ' of ' + ACH.length + ' earned.' : 'None yet.'} Each one adds XP and pays a little SOL. Every 1 SOL you bet lets you claim ${fmtBet(tv.rate)} SOL of it.</p>
      <div class="tro-sum" aria-hidden="true"><b class="num">${got}<small> / ${ACH.length}</small></b><span class="tro-seg">${ACH.map((a) => `<i${profile.ach[a.id] ? ' class="on"' : ''}></i>`).join('')}</span></div>
      <p class="tro-sol"><span>${fmtBet(tv.claimed)} of ${fmtBet(total)} SOL claimed</span>${open > 0 ? `<b>${fmtBet(open)} SOL to claim</b>` : next > 0 ? `<span>Next: bet ${more(next)} SOL more</span>` : ''}</p>
      <div class="trophies">${ACH.map((a) => { const on = profile.ach[a.id] || (T[a.id] && T[a.id].earned); return `<div class="tro${on ? ' got' : ''}"><span class="ti">${troIcon(a.id)}</span><b>${a.name}</b><span>${a.desc}</span>${foot(a)}</div>`; }).join('')}</div>`;
  }
  // claim one trophy's SOL (the bank checks it: earned, not claimed, and covered by what's been bet)
  let claimingTrophy = false;
  async function claimTrophy(id, el) {
    if (claimingTrophy) return;
    claimingTrophy = true;
    const before = bank.balance();
    let fx = false;
    try {
      const r = await bank.trophies.claim(id);
      fx = claimFx(el, r.amount, before);
      if (fx && el) { el.disabled = true; el.classList.add('got'); el.textContent = '+' + fmtBet(r.amount); }
      else toast('Claimed ' + fmtBet(r.amount) + ' SOL · ' + ACH_BY[id].name);
    } catch (e) { toast(e.message || 'That can’t be claimed yet.'); }
    claimingTrophy = false;
    setTimeout(() => { if (nav.page === 'trophies') renderPage(true); if (nav.tab === 'profile') renderProfileView(); }, fx ? 900 : 0);
    syncBadges();
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
    return `<div class="tiles"><div><b>${stats.runs}</b><span>Runs</span></div><div><b>${rtp}</b><span>Return</span></div><div><b class="${Math.abs(net) < 0.00005 ? '' : net > 0 ? 'pos' : 'neg'}">${Math.abs(net) < 0.00005 ? '0' : (net > 0 ? '+' : '−') + fmtSol(Math.abs(net))}</b><span>Net SOL</span></div></div>
      ${formHtml()}
      <div class="sec-h"><h3>Best scores</h3></div>
      <div class="bests">${E.DIFFS.map((D, i) => `<div><b>${profile.best[i] || '–'}</b><span>${D.name}</span><span class="deep" aria-hidden="true">${Array.from({ length: NL }, (_, k) => `<i${k < (profile.deep[i] || 0) ? ' class="on"' : ''}></i>`).join('')}</span><em>${profile.deep[i] ? 'Reached level ' + profile.deep[i] : 'Not played yet'}</em></div>`).join('')}</div>
      <div class="sec-h"><h3>Recent runs</h3>${stats.history.length ? '<span>Newest first</span>' : ''}</div>
      ${runsHtml()}`;
  }
  // the last runs at a glance: one segment each, oldest first, lit green for a run that came out ahead
  function formHtml() {
    const hs = stats.history;
    if (!hs.length) return '';
    const up = hs.filter((h) => h.payout - h.bet > 1e-9).length, slots = Math.max(hs.length, 30);
    const segs = Array.from({ length: slots }, (_, k) => { const h = hs[hs.length - 1 - k]; return `<i${h ? (h.payout - h.bet > 1e-9 ? ' class="on"' : ' class="loss"') : ''}></i>`; }).join('');
    return `<div class="form"><div class="form-h"><span>${hs.length === 1 ? 'Your last run' : 'Your last ' + hs.length + ' runs'}</span><b>${up} came out ahead</b></div><span class="form-seg" aria-hidden="true">${segs}</span></div>`;
  }
  function settingsHtml() {
    const sw = (k, ic, name) => `<div class="mrow-sw"><span class="mi mi-${k}">${ic}</span><span class="mn" id="sw-${k}">${name}</span><button class="switch" role="switch" data-set="${k}" aria-checked="${!!settings[k]}" aria-labelledby="sw-${k}"></button></div>`;
    return `<div class="menu-list">${sw('sound', ICON.sound, 'Sound')}${sw('haptics', ICON.buzz, 'Vibration')}</div>`;
  }
  const RUN_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>';
  const RUN_EVEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M6.5 12h11"/></svg>';
  function runsHtml() {
    if (!stats.history.length) return `<div class="empty rich"><i>${ICON.chart}</i><span><b>No runs yet</b>Each run shows up here with how it ended and what it made.</span></div>`;
    const spName = (h) => (SP.BY[h.recipe] ? SP.BY[h.recipe].name : 'Special level');
    const duel = { won: 'Won a duel', lost: 'Lost a duel', draw: 'Drew a duel', waiting: 'Set a duel mark' };
    const what = (h) => (h.kind === 'pot' ? (h.result === 'best' ? 'New best on the pot · ' : 'Pot attempt · ') + ringsText(h.rings || 0) + (h.place ? ' · ' + ordinal(h.place) : '') : h.kind === 'duel' ? (duel[h.result] || 'Duel') + ' · ' + h.rings + (h.rings === 1 ? ' ring' : ' rings') : h.kind === 'special' ? (h.result === 'won' ? 'Cleared ' + spName(h) + ' · ' + fmtMult(h.mult) : 'Missed ' + spName(h))
      : h.result === 'bust' ? 'Out on level ' + h.level : h.result === 'maxwin' ? 'Max win · ' + fmtMult(h.mult) : h.result === 'final' ? 'All ' + NL + ' levels · ' + fmtMult(h.mult) : 'Cashed out at ' + fmtMult(h.mult));
    return `<div class="runs">${stats.history.map((h) => {
        const p = h.payout - h.bet;
        return `<div class="rr"><i class="rr-i${p > 1e-9 ? ' win' : ''}" aria-hidden="true">${p > 1e-9 ? ICON.check : p < -1e-9 ? RUN_X : RUN_EVEN}</i><span class="rr-t"><b>${what(h)}</b><span>${h.kind === 'pot' ? 'Daily pot' : h.kind === 'duel' ? 'Duel' : h.kind === 'special' ? 'Special level' : E.DIFFS[h.di].name} · ${fmtBet(h.bet)} SOL · ${agoText(h.t)}</span></span><span class="rr-v num ${p > 1e-9 ? 'pos' : p < -1e-9 ? 'neg' : ''}">${p > 1e-9 ? '+' : p < -1e-9 ? '−' : ''}${fmtSol(Math.abs(p))}<span class="unit">SOL</span></span></div>`;
      }).join('')}</div>`;
  }
  function wirePanel(kind) {
    if (kind === 'card') wireCard();
  }
  function wirePage(kind) {
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    if (kind === 'special') on('spPlay', () => startSpecial(nav.sp));
    if (kind === 'duel') on('duPlay', () => startDuel());
    if (kind === 'pot') {
      on('potPlay', () => startPot());
      on('potClose', async () => { if (!bank.pot.closeNow) return; const last = potState && potState.last; potState = await bank.pot.closeNow(); setBalance(); renderPotRow(); refreshPot(); });
    }
    if (kind === 'trophies') document.querySelectorAll('#pgBody [data-claim]').forEach((b) => b.addEventListener('click', () => claimTrophy(b.dataset.claim, b)));
    if (kind === 'how') on('howTour', () => { closePage(); setTimeout(() => showTour(0), 280); });
    if (kind === 'odds') document.querySelectorAll('#oddsSeg button').forEach((b) => b.addEventListener('click', () => { oddsTier = +b.dataset.t; Sound.click(); renderPage(true); }));
    on('fairVerify', () => {
      const h = stats.history[0];
      if (!h || !h.serverSeed) return;
      const ok = hex(sha256(utf8(h.serverSeed))) === h.seedHash;
      const out = $('fairOut');
      if (!ok) { out.className = 'verify-out bad'; out.textContent = 'The revealed seed does not match the hash shown before the run.'; return; }
      const rows = [];
      if (h.kind === 'special') {
        rows.push(`<li><span>Special</span><span class="mono-s">${deriveLevelSeed(h.serverSeed, h.clientSeed, h.nonce, 'special').slice(0, 16)}…</span></li>`);
        if (h.g != null && SP.GRADES[h.g]) rows.push(`<li><span>Course</span><span>${h.n} rings, ${SP.gradeText(h.g)}</span></li>`);
      }
      else if (h.kind === 'duel') rows.push(`<li><span>Duel course</span><span class="mono-s">${deriveLevelSeed(h.serverSeed, h.clientSeed, h.nonce, 'duel').slice(0, 16)}…</span></li>`, `<li><span>Course</span><span>${DU.RINGS} rings, the same for both players</span></li>`);
      else for (let L = 1; L <= h.level; L++) rows.push(`<li><span>Level ${L}</span><span class="mono-s">${deriveLevelSeed(h.serverSeed, h.clientSeed, h.nonce, L).slice(0, 16)}…</span></li>`);
      out.className = 'verify-out good';
      out.innerHTML = `<p><b>Verified.</b> The revealed seed hashes to the value you saw before the run, so the rings were fixed before your first tap.</p><ul class="list group">${rows.join('')}</ul>`;
    });
    on('resetBal', () => {
      if (phase !== 'lobby' && phase !== 'over') { toast('Finish this run first.'); return; }
      wallet.balance = CFG.demoStart; saveAll(); refreshLobby(); renderPage(true); Sound.click(); toast('Demo balance reset to ' + CFG.demoStart + ' SOL');
    });
    on('wConnect', async () => { try { await ServerBank.connect(); bank = ServerBank; await bank.missions.state().catch(() => null); await bank.trophies.state().catch(() => null); await bank.betLimits().catch(() => null); setBalance(); refreshLobby(); refreshPot(); refreshSpecial(); renderPage(true); } catch (e) { $('wErr').textContent = e.message; } });
    // the server says what happened: credited, or waiting for the network; sent, queued or waiting for review
    on('wDeposit', async () => { try { const j = await ServerBank.deposit(parseFloat($('wAmt').value)); setBalance(); renderPage(true); toast(j.message || 'Deposit credited'); } catch (e) { $('wErr').textContent = e.message; } });
    on('wWithdraw', async () => { try { const j = await ServerBank.withdraw(parseFloat($('wAmt').value)); setBalance(); renderPage(true); toast(j.message || 'Withdrawal sent'); } catch (e) { $('wErr').textContent = e.message; } });
  }

  // ---------------------------------------------------------------- pages
  const PAGES = {
    special: [() => { const c = specState && specState.specials && specState.specials[nav.sp]; return c ? c.recipe.name : 'Special level'; }, specialHtml],
    pot: ['Daily pot', potHtml],
    duel: ['Duel', duelHtml],
    trophies: ['Trophies', trophiesHtml],
    stats: ['Stats', statsHtml],
    wallet: ['Wallet', walletHtml],
    settings: ['Settings', settingsHtml],
    how: ['How to play', howHtml],
    odds: ['Odds & fairness', oddsHtml]
  };
  const TAB_NAME = { play: 'Play', challenges: 'Challenges', missions: 'Missions', profile: 'Profile', locker: 'Locker' };
  const vPg = $('vPage');
  function openPage(kind, slot) {
    if (!PAGES[kind]) return;
    if (kind === 'special' && slot != null) nav.sp = +slot || 0; // which of the day's specials
    if (!ui.panel.classList.contains('hide')) closePanel();
    Sound.click();
    if (kind === 'odds' && !nav.page) oddsTier = null; // from the Play sheet or Profile: the tier you have picked
    const fresh = !nav.page;
    nav.page = kind;
    $('pgBackT').textContent = phase === 'lobby' ? TAB_NAME[nav.tab] : 'Back';
    renderPage();
    if (kind === 'trophies' && bank.real) bank.trophies.state().then(() => { if (nav.page === 'trophies') renderPage(true); }).catch(() => {}); // the server's word on what can be claimed
    $('pgBody').scrollTop = 0;
    show(vPg, true); document.body.classList.add('page-open');
    if (fresh) nav.cover = true;
    setTimeout(() => $('pgBack').focus({ preventScroll: true }), 30);
  }
  function renderPage(keepScroll) {
    const body = $('pgBody'), y = body.scrollTop, [t0, fn] = PAGES[nav.page], t = typeof t0 === 'function' ? t0() : t0;
    body.innerHTML = `<div class="vcol"><h2 class="vtitle" id="pgTitle">${t.replace('&', '&amp;')}</h2>${fn()}</div>`;
    body.dataset.kind = nav.page;
    wirePage(nav.page);
    body.querySelectorAll('canvas[data-t]').forEach((c) => drawThumb(c, c.dataset.t, c.dataset.id));
    const sc = nav.page === 'special' && specState && specState.specials && specState.specials[nav.sp];
    if (sc) {
      const day = specState.day, slot = sc.slot;
      requestAnimationFrame(() => { const c = $('spCourse'); if (c && SP.BY[sc.recipe.id]) drawCourse(c, SP.generate('preview|' + day + '|' + slot, sc.recipe.id, sc.course.grade, sc.course.rings)); });
    }
    const ps = nav.page === 'pot' && potState && potState.seed && potState.theme ? potState : null;
    if (ps) requestAnimationFrame(() => { const c = $('potCourse'); if (!c) return; const d = POTS.course(ps.seed, ps.theme.id); drawCourse(c, Object.assign({}, d, { hoops: d.hoops.slice(0, 16) })); });
    if (keepScroll) body.scrollTop = y;
  }
  function closePage(quiet) {
    if (!nav.page) return;
    nav.page = null;
    show(vPg, false); document.body.classList.remove('page-open');
    nav.cover = nav.tab === 'profile' || nav.tab === 'challenges' || nav.tab === 'missions';
    if (phase === 'lobby') { // what the page changed (the wallet, an entry) shows on the tab underneath
      if (nav.tab === 'profile') renderProfileView();
      if (nav.tab === 'challenges') renderChallenges(true);
      if (nav.tab === 'missions') renderMissions(true);
    }
    sheetTopC = -1;
    if (!quiet) Sound.click();
    if (phase === 'paused') setTimeout(() => $('resumeBtn').focus({ preventScroll: true }), 30);
  }
  $('pgBack').addEventListener('click', () => closePage());

  // ---------------------------------------------------------------- navigation: Play, Challenges, Missions, Profile
  // Four tabs along the bottom, in the lobby only (the owner asked for a tab just for the missions and the career,
  // leaving Challenges to the specials and the pot). Play is the bet under the live arena; Challenges, Missions and
  // Profile are full pages, and the arena stops drawing behind them. The Locker opens from Profile (it stays under
  // the Profile tab, with a back button) and keeps the arena on show above the collection, so whatever you pick
  // flies there.
  const TABS = ['play', 'challenges', 'missions', 'profile', 'locker'];
  const vP = $('vProfile'), vL = $('vLocker'), vC = $('vChallenges'), vM = $('vMissions');
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
      if (on && tabOf(was) !== tabOf(t) && !quiet && !REDUCED) hudAnim(b.querySelector('svg') || b, 'pop', [{ transform: 'scale(0.86)' }, { transform: 'scale(1.06)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 350, easing: EASE_OUT });
    });
    const inLobby = phase === 'lobby';
    show(ui.lobby, inLobby && t === 'play');
    show(vL, inLobby && t === 'locker');
    show(vP, t === 'profile'); show(vC, t === 'challenges'); show(vM, t === 'missions');
    nav.cover = t === 'profile' || t === 'challenges' || t === 'missions';
    sheetTopC = -1;
    if (t === 'challenges') { renderChallenges(); $('cBody').scrollTop = 0; if (was !== t) riseIn(vC, true); refreshSpecial(); refreshDuel(); refreshPot(); }
    if (t === 'missions') { if (profile.mNew) { profile.mNew = 0; saveAll(); } renderMissions(); $('mBody').scrollTop = 0; if (was !== t) riseIn(vM, true); }
    if (t === 'locker') renderLocker();
    if (t === 'profile') { renderProfileView(); if (was !== 'locker') $('pBody').scrollTop = 0; if (was !== t && was !== 'locker') riseIn(vP, true); }
    lockerFx();
    syncBadges();
    if (!quiet && was !== t) { Sound.click(); buzz(6); }
  }
  // dots: Challenges for a special you haven't seen, Missions for missions finished since you last looked, Profile
  // for new items and SOL to claim
  function syncBadges() {
    const newSpecial = !!specState && prefs.specSeen !== specState.day;
    $('badgeC').classList.toggle('on', newSpecial && nav.tab !== 'challenges');
    $('badgeM').classList.toggle('on', (profile.mNew > 0 && nav.tab !== 'missions') || mview().readyAll > 0); // finished missions, or mission SOL to claim
    $('badgeP').classList.toggle('on', (profile.fresh.length > 0 && nav.tab !== 'locker') || (bank.rakeback.view().ready > 0 && nav.tab !== 'profile') || tview().open > 0); // new items, rakeback or trophy SOL to claim
  }
  $('lkBack').addEventListener('click', () => setTab('profile'));
  document.querySelectorAll('#tabbar [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  // full pages: the top bar turns to material once the page scrolls under it, as on iOS
  document.querySelectorAll('.view > .vscroll').forEach((el) => el.addEventListener('scroll', () => el.parentElement.classList.toggle('scrolled', el.scrollTop > 6), { passive: true }));

  // ---------------------------------------------------------------- Missions tab
  const ring = (p) => `<span class="mring${p > 0 ? '' : ' zero'}"><svg viewBox="0 0 36 36"><circle class="trk" cx="18" cy="18" r="15"/><circle class="val" cx="18" cy="18" r="15" pathLength="100" stroke-dasharray="${(Math.max(0.0001, p) * 100).toFixed(1)} 100"/></svg><span class="ck">${ICON.check}</span></span>`;
  // A mission's row: its ring, what it asks and where it stands, then what it pays. Open: its XP and SOL. Done: a green
  // Claim key once its SOL is ready, else what was claimed or the SOL waiting for the round's play. m: the mission from
  // the view (ready, claimed, i), win: its window, for the claim; a career mission has neither.
  function mRow(text, p, n, xp, done, sol, m, win) {
    const ready = !!(m && m.ready), claimed = !!(m && m.claimed);
    const right = ready ? `<button class="m-claim" data-mclaim="${win}:${m.i}" aria-label="Claim ${fmtBet(sol)} SOL for ${text}">Claim ${fmtBet(sol)}</button>`
      : done ? '<b>Done</b>' + (sol ? `<small class="${claimed ? 'paid' : ''}">${fmtBet(sol)} SOL ${claimed ? 'claimed' : 'waiting'}</small>` : '')
      : `<b>+${xp} XP</b>` + (sol ? `<small>+${fmtBet(sol)} SOL</small>` : '');
    return `<div class="mrow${done ? ' done' : ''}${ready ? ' ready' : ''}">${ring(done ? 1 : p / n)}<span class="mt"><b>${text}</b><span>${done ? (ready ? '+' + xp + ' XP · SOL ready' : 'Done') : p + ' / ' + n}</span></span><span class="mxp">${right}</span></div>`;
  }
  // what one round of a window pays in all
  const roundSol = (mv, win, r) => mv.base[win] * MS.SHARES[win] * (MS.STEPS[r == null ? mv.round[win] : r] - ((r == null ? mv.round[win] : r) ? MS.STEPS[(r == null ? mv.round[win] : r) - 1] : 0));
  // The rounds of a window, side by side: done (its SOL claimed, ready to claim, or waiting for play), open, or locked.
  function roundsRow(mv, win) {
    const all = mv.all[win], cur = mv.round[win];
    return `<div class="rounds">${MS.STEPS.map((x, r) => {
      const mine = all.slice(r * 3, r * 3 + 3), done = mine.length === 3 && mine.every((c) => c.done);
      const st = done ? (mine.some((c) => !c.paid) ? 'wait' : mine.some((c) => c.ready) ? 'ready' : 'paid') : r === cur ? 'now' : 'lock';
      return `<div class="rd ${st}"><span>${st === 'lock' ? ICON.lock : done ? ICON.check : ''}Round ${r + 1}</span><b>${fmtBet(roundSol(mv, win, r))} SOL</b></div>`;
    }).join('')}</div>`;
  }
  // A round's SOL pays once this much has been bet in the window (run bets and special level entries). If SOL from an
  // earlier round is still waiting, the bar shows what releases that first.
  function needRow(mv, win) {
    const got = mv.played[win], when = win === 'day' ? 'today' : 'this week';
    const owed = mv.due[win] != null && got < mv.due[win] - 1e-9;
    const need = owed ? mv.due[win] : mv.need[win], met = got >= need - 1e-9;
    const shown = Math.min(need, Math.floor(got * 100 + 1e-6) / 100);
    const text = met ? (mv.ready[win] > 0 ? fmtBet(mv.ready[win]) + ' SOL ready to claim' : 'SOL rewards unlocked ' + when) : owed ? `Bet ${fmtBet(need)} SOL ${when} to collect ${fmtBet(mv.waiting[win])} SOL` : `Bet ${fmtBet(need)} SOL ${when} to unlock SOL rewards`;
    return `<div class="mneed${met ? ' met' : ''}"><div class="mn-h"><span>${text}</span><b>${fmtBet(shown)} / ${fmtBet(need)} SOL</b></div>
      <div class="bar"><i style="width:${(Math.min(1, got / need) * 100).toFixed(1)}%"></i></div></div>`;
  }
  // under a round's three missions: what finishing them opens
  function roundFoot(mv, win) {
    const nx = mv.next[win], list = win === 'day' ? mv.daily : mv.weekly, left = list.filter((c) => !c.done).length;
    if (!left && nx) return `<div class="mfoot">${ICON.check}<span>Round ${nx.round + 1} opens with your next run</span><b>+${fmtBet(nx.reward)} SOL</b></div>`;
    if (!left) return `<div class="mfoot done">${ICON.check}<span>All done. ${fmtBet(mv.paid[win] + mv.waiting[win])} SOL earned ${win === 'day' ? 'today' : 'this week'}.</span></div>`;
    if (!nx) return `<div class="mfoot"><span>Last round ${win === 'day' ? 'today' : 'this week'}.</span></div>`;
    return `<div class="mfoot">${ICON.lock}<span>Finish all three to open round ${nx.round + 1}</span><b>+${fmtBet(nx.reward)} SOL</b></div>`;
  }
  const rewardOf = (C) => { const [t, id] = C.reward.split(':'); return { t, id, u: UNLOCK_BY[C.reward] }; };
  // The Missions tab: today's missions, this week's and the career, each a card under a band. On a phone a segmented
  // control picks one (nav.seg); on a desktop all three stand side by side and the control is hidden.
  const SEGS = [['day', 'Today'], ['week', 'This week'], ['career', 'Career']];
  function dayHtml() {
    const mv = mview(), d = mv.daily;
    return `<div class="cc ms-cc"><div class="cc-h"><span class="cc-k">${ICON.target}Daily missions</span><span class="cc-t">New in ${untilMidnight()}</span></div>
      ${roundsRow(mv, 'day')}${needRow(mv, 'day')}${d.map((c) => mRow(dailyText(c), c.p, c.n, c.xp, c.done, c.reward, c, 'day')).join('')}${roundFoot(mv, 'day')}</div>`;
  }
  function weekHtml() {
    const mv = mview(), w = mv.weekly;
    return `<div class="cc ms-cc ms-wk"><div class="cc-h"><span class="cc-k">${ICON.spark}Weekly missions</span><span class="cc-t">New in ${untilMonday()}</span></div>
      ${roundsRow(mv, 'week')}${needRow(mv, 'week')}${w.map((c) => mRow(weeklyText(c), c.p, c.n, c.xp, c.done, c.reward, c, 'week')).join('')}${roundFoot(mv, 'week')}</div>`;
  }
  // how far along each is, for its segment: missions done in the open round, chapters finished
  function segCount(k) {
    const mv = mview();
    if (k === 'career') { const cs = careerState(); return Math.min(cs.ch, CAREER.length) + '/' + CAREER.length; }
    const list = k === 'day' ? mv.daily : mv.weekly;
    return list.filter((c) => c.done).length + '/' + list.length;
  }
  function renderMissions(keep) {
    const body = $('mBody'), y = body.scrollTop;
    if (!SEGS.some((x) => x[0] === nav.seg)) nav.seg = 'day';
    body.classList.toggle('quiet', !!keep); // a redraw (after a claim, the clock) doesn't pop the Claim keys in again
    const mv = mview(), has = { day: mv.ready.day > 0, week: mv.ready.week > 0, career: false };
    // SOL left from a day or week that has ended isn't on any row: a ticket claims it, with whatever else is ready
    const earlier = mv.earlier > 0 ? `<button class="gain claim ms-earlier" id="msEarlier" aria-label="Claim ${fmtBet(mv.readyAll)} SOL of mission rewards">${ICON.gift}<span>Unclaimed mission SOL</span><em>Claim ${fmtBet(mv.readyAll)} SOL</em></button>` : '';
    body.innerHTML = `<div class="vcol"><h2 class="vtitle">Missions</h2>
      <div class="seg ms-seg" role="group" aria-label="Which missions">${SEGS.map(([k, name]) => `<button data-seg="${k}" aria-pressed="${k === nav.seg}">${name}<i>${segCount(k)}</i>${has[k] ? '<s class="sd" aria-label="SOL to claim"></s>' : ''}</button>`).join('')}</div>${earlier}
      <div class="ms-panels" data-seg="${nav.seg}"><section class="msp" data-seg="day" aria-label="Today">${dayHtml()}</section><section class="msp" data-seg="week" aria-label="This week">${weekHtml()}</section><section class="msp" data-seg="career" aria-label="Career">${careerHtml()}</section></div></div>`;
    body.querySelectorAll('canvas[data-t]').forEach((c) => drawThumb(c, c.dataset.t, c.dataset.id));
    body.querySelectorAll('.ms-seg button').forEach((b) => b.addEventListener('click', () => {
      if (nav.seg === b.dataset.seg) return;
      nav.seg = b.dataset.seg; Sound.click(); buzz(6);
      body.querySelectorAll('.ms-seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      const pn = body.querySelector('.ms-panels'); pn.dataset.seg = nav.seg; body.scrollTop = 0;
      const on = pn.querySelector('.msp[data-seg="' + nav.seg + '"]');
      if (on && !REDUCED && !desk) hudAnim(on, 'seg', [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE_OUT });
    }));
    body.querySelectorAll('[data-mclaim]').forEach((b) => b.addEventListener('click', () => { const [w, i] = b.dataset.mclaim.split(':'); claimMission(w, +i, b); }));
    if ($('msEarlier')) $('msEarlier').addEventListener('click', () => claimMission(null, null, $('msEarlier')));
    if (keep) { body.scrollTop = y; riseIn(vM, false); }
  }
  function careerHtml() {
    const cs = careerState(), C = CAREER[cs.ch];
    let career;
    if (C) {
      const r = rewardOf(C), n = cs.done.filter(Boolean).length;
      career = `<div class="chap">
        <div class="chap-top"><span class="rew"><canvas width="132" height="132" data-t="${r.t}" data-id="${r.id}"></canvas></span>
          <div><div class="chap-k">${n} of 4 done</div><div class="chap-n">${C.name}</div>
          <div class="chap-r">Finish all four to unlock <b>${COS[r.t][r.id].name} ${TNAME[r.t].toLowerCase()}</b>${C.title ? ' and the <b>' + TITLE_BY[C.title].name + '</b> title' : ''}.</div></div></div>
        <div class="chap-bar"><i style="width:${(n / 4 * 100).toFixed(0)}%"></i></div>
        ${C.m.map((m, i) => mRow(careerText(m), cs.p[i], m[1], m[2], cs.done[i], 0)).join('')}
      </div>`;
    } else career = `<div class="empty">You've finished every chapter. All the career rewards are in your locker.</div>`;
    const chapters = CAREER.map((K, i) => {
      const r = rewardOf(K), st = i < cs.ch ? 'done' : i === cs.ch ? 'now' : 'locked';
      return `<div class="chli ${st}"><span class="cs">${st === 'done' ? ICON.check : st === 'now' ? ICON.target : ICON.lock}</span><b>${i + 1}. ${K.name}</b><span class="cr">${COS[r.t][r.id].name}<canvas width="52" height="52" data-t="${r.t}" data-id="${r.id}"></canvas></span></div>`;
    }).join('');
    return `<div class="cc ms-cc ms-car"><div class="cc-h"><span class="cc-k">${ICON.flag}Career</span><span class="cc-t">${C ? 'Chapter ' + (cs.ch + 1) + ' of ' + CAREER.length : 'All done'}</span></div>${career}</div>
      <p class="ms-note">Chapters at your own pace, for XP and items you can only get here.</p><div class="chlist">${chapters}</div>`;
  }

  // ---------------------------------------------------------------- Locker tab
  // Tap anything to see it on the arena above; tap something you own to wear it. Locked items show how to get them.
  function lockerFx() { // what the arena shows while you browse: a flame burning for flames, none for trails
    nav.fx = nav.tab !== 'locker' ? null : nav.cat === 'trail' ? 0 : null; // browsing trails keeps the ball cool so the trail shows
  }
  function endTry() {
    if (!nav.try) return;
    nav.try = null;
  }
  function tryItem(t, id) {
    endTry();
    if (profile.eq[t] !== id) nav.try = { t, id };
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
      return `<button class="item${has ? '' : ' locked'}${eq ? ' eq' : ''}${sel ? ' sel' : ''}" data-id="${u.id}" aria-pressed="${eq}" aria-label="${nm}, ${RARITY[u.r]}${has ? (eq ? ', equipped' : '') : ', locked: ' + unlockReq(u)}">` +
        `<canvas width="112" height="112"></canvas><span class="nm">${has ? nm : unlockReq(u)}</span>` +
        (has ? (fresh ? '<span class="new"></span>' : '') : `<span class="lock">${ICON.lock}</span>`) + '</button>';
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
      if (changed) { Sound.click(); buzz(10); }
    } else { tryItem(t, id); Sound.click(); }
    renderLocker(); refreshProfileHud();
  }

  // ---------------------------------------------------------------- Profile tab
  const inkFor = (hex) => { const n = parseInt(hex.slice(1), 16), l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); return l > 170 ? '#0b0f1a' : '#ffffff'; };
  const avStyle = () => { const c = CARD_COLORS[0]; return `--av:${c};--av-ink:${inkFor(c)}`; };
  const playerName = () => profile.card.name || 'Player';
  // Profile, top to bottom: who you are (card, level), how you play (stats, with trophies and recent runs a tap
  // away), settings (wallet, sound, vibration) and help (how to play, odds & fairness).
  function renderProfileView() {
    const v = lvlOf(profile.xp), T = TITLE_BY[profile.card.title] || TITLES[0];
    const got = ACH.filter((a) => profile.ach[a.id]).length, fresh = profile.fresh.length > 0;
    const row = (page, ic, name, val) => `<button data-page="${page}"><span class="mi mi-${page}">${ic}</span><span class="mn">${name}</span><span class="mv num">${val || ''}</span><span class="chev">${ICON.chev}</span></button>`;
    $('pBody').innerHTML = `<div class="vcol"><h2 class="vtitle">Profile</h2><div class="dk-cols"><div class="dk-col">
      <button class="pcard" id="pfCard" aria-label="Edit your player card" style="${avStyle(profile.card.color)}"><span class="pav" style="${avStyle(profile.card.color)}">${emblemSvg(profile.card.emblem)}</span>
        <span class="pid"><span class="pname">${esc(playerName())}</span><span class="ptitle">${ICON.medal}${T.name}</span>
          <span class="plv"><span>Level ${v.l}</span><span class="num">${v.into} / ${v.need} XP</span></span><span class="pxp"><i style="width:${(v.into / v.need * 100).toFixed(1)}%"></i></span></span>
        <span class="chev">${ICON.chev}</span></button>${rakeHtml(v)}
      <div class="menu-list"><button id="pfLocker"><span class="mi mi-locker">${ICON.shirt}</span><span class="mn">Locker</span><span class="mv">${fresh ? '<i class="dot" aria-label="New items"></i>' : ''}</span><span class="chev">${ICON.chev}</span></button>${row('trophies', ICON.medal, 'Trophies', (tview().open > 0 ? '<i class="dot gap" aria-label="SOL to claim"></i>' : '') + got + ' of ' + ACH.length)}${row('stats', ICON.chart, 'Stats', stats.runs === 1 ? '1 run' : stats.runs + ' runs')}</div>
      </div><div class="dk-col"><div class="menu-list">${row('wallet', ICON.wallet, 'Wallet', fmtBal(bank.balance()) + ' SOL')}${row('settings', ICON.gear, 'Settings')}</div>
      <div class="menu-list">${row('how', ICON.book, 'How to play')}${row('odds', ICON.shield, 'Odds &amp; fairness')}</div></div></div></div>`;
    $('pfCard').addEventListener('click', () => openPanel('card'));
    $('pfLocker').addEventListener('click', () => setTab('locker'));
    if ($('rbBtn')) $('rbBtn').addEventListener('click', () => claimRakeback($('rbBtn')));
  }
  // what has built up toward the next level, or what a level up has released to claim
  function rakeHtml(v) {
    const rb = bank.rakeback.view(), ready = rb.ready > 0;
    const sub = ready ? (rb.acc > 0 ? `${fmtBet(rb.acc)} SOL more at level ${v.l + 1}` : 'Yours from levelling up') : rb.acc > 0 ? `Claim it at level ${v.l + 1}` : 'Every bet adds to it. Level up to claim it.';
    return `<div class="rake${ready ? ' ready' : ''}"><span class="rk-i">${ICON.gift}</span><span class="rk-t"><b>Rakeback<span class="num">${fmtBet(ready ? rb.ready : rb.acc)} SOL</span></b><small>${sub}</small></span>${ready ? `<button class="btn btn-green rk-b" id="rbBtn">Claim</button>` : ''}</div>`;
  }
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // the player card editor: name, emblem, colour and title
  function cardHtml() {
    const c = profile.card;
    return `<div class="pe-prev"><span class="pav" id="peAv" style="${avStyle(c.color)}">${emblemSvg(c.emblem)}</span><span class="pid"><span class="pname" id="peName">${esc(playerName())}</span><span class="ptitle" id="peTitle">${ICON.medal}${(TITLE_BY[c.title] || TITLES[0]).name}</span></span></div>
      <h3>Name</h3><label class="pe-name"><input id="peIn" maxlength="16" autocomplete="off" spellcheck="false" placeholder="Player" value="${esc(c.name)}"><span>16 max</span></label>
      <h3>Emblem</h3><div class="pe-ems" style="${avStyle(c.color)}">${Object.keys(EMBLEMS).map((k) => `<button data-em="${k}" aria-pressed="${k === c.emblem}" aria-label="${k}">${emblemSvg(k)}</button>`).join('')}</div>
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
    document.querySelectorAll('#panelBody [data-ti]').forEach((b) => b.addEventListener('click', () => { c.title = b.dataset.ti; saveAll(); Sound.click(); redraw(); }));
  }

  // ---------------------------------------------------------------- pause card
  function showPause(on) {
    const el = $('pauseCard');
    if (on) {
      $('pauseSub').textContent = run.mode === 'pot' ? 'Daily pot · ring ' + (run.hoops + 1) + ' · ' + ordinal(run.place || potPlace()) + ' place'
        : run.mode === 'duel' ? 'Duel · ring ' + (run.hoops + 1) + ' · ' + fmtAmt(run.prize) + ' SOL to win'
        : run.mode === 'special' ? SP.BY[run.recipe].name + ' · ring ' + Math.min(run.st.hoops.length, run.hoops + 1) + ' of ' + run.st.hoops.length + ' · ' + fmtAmt(run.prize) + ' SOL to win'
        : practicing() ? 'Level ' + run.level + ' · practice' : 'Level ' + run.level + ' · ' + fmtSol(run.bet * run.total) + ' SOL pot';
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
    grantUnlocks(); syncSettings(); applyFlameTheme(); buildLobby(); setTab('play', true); refreshLobby(); setHudMode(false); refreshPot(); refreshSpecial(); refreshDuel();
    setInterval(() => { if (phase === 'lobby' && !document.hidden) { refreshPot(); if (nav.tab === 'challenges') { refreshSpecial(); refreshDuel(); } if (nav.tab === 'missions' && !nav.page) renderMissions(true); } }, 30000); // entrants, pot and time left move on
    attract.wait = 0;
    if (!prefs.tourSeen && stats.runs === 0 && !/notour/.test(location.search)) setTimeout(() => { if (phase === 'lobby' && !nav.page) showTour(0); }, 700);
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
    run, stats, wallet, view, E, PAY, ball, profile, nav, settings, prefs, geom: () => ({ scale, offX, offY, runL, runR, runBX, ahead: (VIEW_W - BALL_SX) * scale, inWin, stL, stT, stW, stH }),
    phase: () => phase,
    dbg,
    unfreeze: () => { dbg.frozen = false; goPlay(); },
    tap: () => flapInput(),
    tour: () => showTour(0), // the quick tour, as How to play opens it
    autoplay: (skill) => { autoBot = skill ? BOT.createBot(skill, E.makeRng('auto' + Math.random())) : null; },
    fx: (streak) => { dbg.fx = streak; }, // show the flame for a streak without touching the run
    hold: (on) => { dbg.hold = !!on; },   // stop the clock with the last frame on screen
    step: (n, dt) => { dbg.steps = n | 0; dbg.stepDt = dt > 0 ? dt : 1 / 60; },  // while held: play n frames of 1/60 s (or dt)
    stepsLeft: () => dbg.steps | 0,
    pot: () => potState, // the daily pot as the client sees it
    potField: () => (DemoPot.fld ? DemoPot.fld.list.map((f) => ({ who: f.who, at: f.at.map((a) => [Math.round(a.t / 1000), a.rings, a.score]) })) : null), // the demo's simulated field
    special: () => specState, // today's special level as the client sees it
    duel: () => duelState, // the duel as the client sees it
    ghost: () => (ghost ? { rings: ghost.st.outcomes.length, done: ghost.st.done, tick: ghost.st.tick, a: ghost.a } : null), // the rival's flight in a duel
    missions: () => mview(), // daily and weekly missions, with SOL and the play that unlocks it
    rakeback: () => bank.rakeback.view(), // { acc: building up, ready: released by a level up, paid: claimed }
    level: () => lvlOf(profile.xp),
    trophies: () => tview(), // trophy SOL: what each pays, what can be claimed and what's been claimed
    mode: () => run.mode, // 'run', 'special' or 'practice'
    bal: () => bank.balance(),
    sfx: (name, args, secs) => Sound.render(name, args, secs), // a sound's samples, rendered offline
    ballScreen: () => ({ x: view.bsx, y: view.bsy }),
    equip: (t, id) => { if (COS[t] && COS[t][id]) profile.eq[t] = id; }, // test hook: try a ball, wings or trail without unlocking it
    thumb: (el, t, id) => drawThumb(el, t, id) // test hook: draw a locker picture into a canvas
  };
})();
