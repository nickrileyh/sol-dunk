/* SOL DUNK daily pot: shared by the browser, the server and the tests.
 *
 * The pot is a game of its own (the owner asked for it to stop riding on regular runs): one course a UTC day, the
 * same for everyone, built from a seed fixed when the pot opens and shown to everyone. Each attempt costs the entry,
 * and every entry goes into the pot; a player's best attempt is what counts. When the day ends the best three split
 * the pot, PLACES of it in turn (half, three tenths and a fifth). The house keeps RAKE of every entry whoever wins,
 * and never takes a side, so the pot earns the same from every player however skilled.
 *
 * The course is about 40 rings that start wide and still and get harder ring by ring (the duel's course, src/duel.cjs,
 * so the time between rims never shrinks), with the day's theme on top. The themes are the pot's own: the owner asked
 * for the pot not to use the challenges' levels (it can use the same kinds of ring, set out its own way): runs of
 * wide rings to build a streak on, a tour that changes every eight rings, every ring moving, doors that breathe, and
 * walls to fly over. Attempts rank by score (the owner asked for score, not rings: the game's own, a rim hit 1 and a
 * swish 2, plus 1 for each swish in a row before it, up to 6), then by rings; players level on both share their
 * places. So a long streak of swishes beats a longer flight of rim hits. With fewer than three players the places
 * they fill share the whole pot in the same proportions. Nobody in it: the pot rolls into the next day's.
 *
 * Attempts are judged only from the replay of the player's taps on the day's course (the server's own), never from
 * the client's word.
 */
(function (root, factory) {
  const P = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = P;
  else root.DunkPots = P;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // the course builder lives with the duels; looked up when it's needed (in the page it loads after this file)
  const D = () => root.DunkDuel || (typeof require === 'function' ? require('./duel.cjs') : null);

  const RAKE = 0.1;               // the house's share of every entry
  const ENTRY = 0.05;             // what an attempt costs, in SOL (the server can set its own)
  const DAY_MS = 86400000;
  const PLACES = [0.5, 0.3, 0.2]; // what the best three take of the pot
  const RINGS = 40;               // the course's length
  const CUTOFF_MS = 4 * 60000;    // no new attempt this close to the end of the day, so every flight is in before it closes

  // The themes take turns, one a day: what the day's course has on top of its rings (src/duel.cjs, generate's feat).
  // None is a special level's twist. Ring 0 is always plain.
  const stage = (i) => Math.min(4, Math.floor(i / 8)); // the grand tour's stages, eight rings each
  const THEMES = [
    { id: 'streak', name: 'Streak alley', blurb: 'Four wide rings to build a streak on, then a tight one that moves',
      wide: (i) => (i % 5 === 4 ? -10 : 6), still: (i) => i % 5 !== 4 && i < 20, move: (i) => i % 5 === 4 }, // (still only for the first half: still all the way, pros flew all of it 43% of the time)
    { id: 'tour', name: 'Grand tour', blurb: 'Something new every eight rings: doors, breathing rings, moving doors, then all of them',
      up: (i) => (stage(i) === 1 && i % 2 === 1) || (stage(i) === 3 && i % 2 === 0) || (stage(i) === 4 && i % 3 === 0),
      pulse: (i) => stage(i) === 2 || (stage(i) === 4 && i % 3 === 1), move: (i) => stage(i) >= 3 },
    { id: 'storm', name: 'The storm', blurb: 'Every ring moves, and every fourth stands on its side', up: (i) => i % 4 === 3, moveAll: true },
    { id: 'lungs', name: 'Breathing doors', blurb: 'Every other ring a door that breathes wider and tighter', up: (i) => i % 2 === 1, pulse: (i) => i % 2 === 1 },
    { id: 'steeple', name: 'Steeplechase', blurb: 'A wall to fly over before every third ring', wall: (i) => i % 3 === 2 }
  ];
  // themes from before, kept so a pot that opened with one still builds its course (they're no longer dealt)
  const RETIRED = [
    { id: 'doors', name: 'Side doors', blurb: 'Every third ring stands on its side', up: (i) => i % 3 === 2 },
    { id: 'switch', name: 'Switchback', blurb: 'A flat ring, then one on its side, all the way', up: (i) => i % 2 === 1 },
    { id: 'heart', name: 'Heartbeat', blurb: 'The rings breathe wider and tighter', pulse: (i) => i >= 2 },
    { id: 'mix', name: 'Everything', blurb: 'Sideways rings, breathing rings, moving and leaning ones', up: (i) => i % 4 === 2, pulse: (i) => i % 4 === 0 && i > 0 }
  ];
  const THEME_BY = Object.fromEntries(THEMES.concat(RETIRED).map((t) => [t.id, t]));

  // a small seeded generator (mulberry32), for the demo's simulated field
  function rng(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    let a = h >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // windows: one pot per UTC day ("2026-11-24"); the demo can add rounds to a day ("2026-11-24#2")
  const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
  const dayStart = (day) => Date.parse(String(day).slice(0, 10) + 'T00:00:00Z');
  const closesAt = (key) => dayStart(key) + DAY_MS;
  const EPOCH = Date.UTC(2026, 0, 5);
  // the day's theme (a demo round moves one step along)
  function themeFor(key) {
    const n = Math.floor((dayStart(key) - EPOCH) / DAY_MS) + (+String(key).split('#')[1] || 0);
    return THEMES[((n % THEMES.length) + THEMES.length) % THEMES.length];
  }
  // the day's course: the same for everyone who plays it
  function course(seed, theme, n) {
    const T = typeof theme === 'string' ? THEME_BY[theme] : theme;
    return D().generate('pot|' + seed, n || RINGS, { prefix: 'pot', up: T.up, pulse: T.pulse, moveAll: T.moveAll, move: T.move, wide: T.wide, still: T.still, wall: T.wall });
  }

  // attempts rank by score, then rings; level on both is a tie
  const cmp = (a, b) => (a.score !== b.score ? b.score - a.score : b.rings - a.rings);
  const same = (a, b) => a.score === b.score && a.rings === b.rings;
  const better = (a, b) => !b || cmp(a, b) < 0;
  // The standings: entries [{ id, rings, score, ... }] best first, each with its place (1 for the best; ties share
  // the place of the first of them).
  function standings(entries) {
    const list = entries.slice().sort(cmp);
    list.forEach((e, i) => { e.place = i && same(e, list[i - 1]) ? list[i - 1].place : i + 1; });
    return list;
  }
  // what a player would be placed with this attempt, among the others' bests (1 = first)
  const placeOf = (mine, others) => 1 + others.filter((o) => cmp(o, mine) < 0).length;

  // Close a pot. paidIn: every entry paid in; carryIn: rolled in from earlier pots; list: its standings (best first).
  // Returns what each placed player gets (by id), the house's rake (its share of the entries, plus the odd units left
  // over by a split) and what rolls over (everything, if nobody played). integer = true works in whole lamports.
  function settle(paidIn, carryIn, list, integer) {
    const rake0 = integer ? Math.ceil(paidIn * RAKE) : paidIn * RAKE, pool = carryIn + paidIn - rake0;
    if (!list.length) return { pays: {}, rake: rake0, carry: pool, pool };
    const k = Math.min(PLACES.length, list.length), tot = PLACES.slice(0, k).reduce((a, b) => a + b, 0);
    const frac = PLACES.slice(0, k).map((p) => p / tot); // fewer than three: the places they fill share it all
    const pays = {};
    let paid = 0;
    for (let i = 0; i < k;) {
      let j = i;
      while (j + 1 < list.length && same(list[j + 1], list[i])) j++;
      let f = 0;
      for (let m = i; m <= Math.min(j, k - 1); m++) f += frac[m];
      const each = integer ? Math.floor((pool * f) / (j - i + 1)) : (pool * f) / (j - i + 1);
      for (let m = i; m <= j; m++) { pays[list[m].id] = each; paid += each; }
      i = j + 1;
    }
    return { pays, rake: rake0 + (pool - paid), carry: 0, pool };
  }
  // the pot as it stands: what's in it for the best three
  const poolOf = (paidIn, carryIn) => carryIn + paidIn * (1 - RAKE);
  // what each place would take of it now
  const placePays = (pool) => PLACES.map((p) => pool * p);

  return { RAKE, ENTRY, DAY_MS, PLACES, RINGS, CUTOFF_MS, THEMES, RETIRED, THEME_BY, rng, dayKey, dayStart, closesAt, themeFor, course, cmp, same, better, standings, placeOf, settle, poolOf, placePays };
});
