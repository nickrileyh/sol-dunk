/* SOL DUNK special levels: shared by the browser, the server and the simulator.
 *
 * Three a day (UTC), the same three twists for everyone that day (every ring moving, every rim leaning, ...), with
 * prizes of 2x, 3x and 5x the entry. Each attempt is a fresh course from its own provably fair seed; the player pays
 * the entry and wins the prize for clearing every ring.
 *
 * Every course is set for the player (the owner asked for this): the house expects a 10% edge on everyone, from
 * beginners to pros, instead of a fixed course that a pro clears most of the time and a beginner hardly ever. A course
 * is built on a grade (the ring settings of a regular level, from Easy level 1 up to Hard level 8) and is 6 to 24
 * rings long; the course set for a level d is the one a player of skill d (on the simulator's scale below) clears with
 * a chance of TARGET / prize, as close as whole rings allow, with the length near 12.
 *
 * Levels move like a weighted staircase, one per special for each player: clear a course and that special's level
 * goes up by UP, miss and it comes down by DOWN, with UP / DOWN = (1 - p) / p for p = TARGET / prize. A level only
 * stops moving where the player clears p of their attempts, so over time every player gets back TARGET (90%) of their
 * entries, however good they are and however they play: missing on purpose lowers the level only by DOWN per entry
 * lost, and clears push it back up by UP. The simulator's scale (skill 0 novice, 1 casual, 2 average, 3 good, 4 pro,
 * and a step past both ends) only has to put courses in order of difficulty; the staircase does the rest.
 *
 * Where a level starts: START for someone new, or higher if they've already shown more, from the rings they've played
 * in regular runs (a rating over the scale, from the simulator's per-ring miss rates) or from their levels in the
 * other specials. A strong player who hasn't shown it yet wins more than 90% while their level climbs, a weak one less
 * while it comes down; after that it's 90% for both. The simulator's best bot ("perfect") is past the top of the
 * scale and keeps winning, so accounts the server flags for beating the house can't enter.
 */
(function (root, factory) {
  const S = factory(root.DunkEngine || (typeof require === 'function' ? require('./engine.cjs') : null));
  if (typeof module === 'object' && module.exports) module.exports = S;
  else root.DunkSpecial = S;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (E) {
  'use strict';

  const ENTRY = 0.05;        // entry in SOL (the server can set its own)
  const DAY_MS = 86400000;
  const DEG = 3.141592653589793 / 180;
  // the same as in the engine's generateLevel: where the ball starts, and how much climbing a gap can ask for
  const START_Y = 300, CLIMB_RATE = 350, DROP_TIME = 0.45, CLIMB_MARGIN = 40;

  const SLOTS = [2, 3, 5];   // the day's three specials: prize as a multiple of the entry
  const TARGET = 0.9;        // a player's expected return on any course: the house expects 10%
  const N_MIN = 6, N_MAX = 24, N_IDEAL = 12;
  // grades: the ring settings a course is built on, as [tier, level] of the regular game, easiest first
  const GRADES = [[0, 1], [0, 3], [0, 5], [1, 3], [1, 4], [1, 5], [1, 6], [1, 8]];

  // The twists, applied to the grade's settings (engine levelConfig). shape: how ring heights are chosen ('walk' like a
  // normal level, 'zigzag' high-low, 'wave' a rolling line); lean 'alt': tilts alternate left and right.
  const RECIPES = [
    { id: 'gauntlet', name: 'The gauntlet', blurb: 'Every ring moves', t: { moveP: 1, moveAmpMin: 34 } },
    { id: 'tilt', name: 'Tilt alley', blurb: 'Every rim leans, left then right', t: { tiltP: 1, tiltMaxMin: 11, moveScale: 0.5 }, lean: 'alt' },
    { id: 'zigzag', name: 'Zigzag', blurb: 'High ring, low ring, all the way', t: { moveScale: 0.5 }, shape: 'zigzag' },
    { id: 'needle', name: 'Needle', blurb: 'Tight rims, nothing moves', t: { moveP: 0, tiltP: 0, narrow: 10 } },
    { id: 'wave', name: 'The wave', blurb: 'Rings ride a rolling line', t: { movePMin: 0.6, moveAmpMin: 32 }, shape: 'wave' },
    { id: 'express', name: 'Express', blurb: 'A quicker ball, rings spread to match', t: { fast: 1.25 } }
  ];
  const BY = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

  // the skill scale, the regular-run rating and the staircase
  const ANCHORS = ['novice', 'casual', 'average', 'good', 'pro'];
  const LEVEL_NAMES = ['Novice', 'Casual', 'Average', 'Good', 'Pro', 'Elite'];  // what a level reads as (Elite: past pro)
  const D_MIN = -1, D_MAX = 5;                                                // the scale runs a step past the bots
  const GRID = Array.from({ length: 61 }, (_, i) => Math.round(i - 10) / 10);  // -1, -0.9, ... 5, for the rating
  const PRIOR_MU = 1.8, PRIOR_SD = 0.9;   // someone new: most likely between casual and average
  const START = 1.8;                      // where a level starts for someone who hasn't shown more
  const DOWN = 0.3;                       // a miss lowers that special's level by this much; a clear raises it by up(x)
  const SLOT_MARGIN = 0.5;                // a new special starts at most this far below the player's level in another

  // @@TABLES@@ written by node sim/special.cjs --write, for each bot on the ANCHORS. Don't edit by hand.
  // reg[tier][level - 1] = ln(per-ring miss rate) per anchor; sp[recipe][grade] = [a, b, c] per anchor, with
  // ln(chance of clearing a course of n rings) = a + b * n + c * n * n, fitted from N_MIN to N_MAX rings.
  const TABLES = {
    reg: [
      [[-2.553, -3.2121, -4.0529, -5.511, -7.3992], [-2.293, -2.8733, -3.5982, -4.6669, -5.8904], [-2.0847, -2.5893, -3.241, -4.2689, -5.2856], [-1.825, -2.3047, -2.8104, -3.7038, -4.8094], [-1.5738, -1.959, -2.4324, -3.2966, -4.3155], [-1.3319, -1.6953, -2.0947, -2.8034, -3.7502], [-1.1502, -1.4359, -1.7747, -2.4278, -3.2826], [-0.9567, -1.1893, -1.5031, -2.0386, -2.8643]],
      [[-2.0678, -2.546, -3.138, -4.1925, -5.4499], [-1.694, -2.103, -2.5937, -3.4651, -4.6242], [-1.4874, -1.8007, -2.2597, -3.0776, -4.1855], [-1.2816, -1.5802, -1.9619, -2.6561, -3.6119], [-1.1104, -1.3366, -1.6583, -2.2435, -3.0696], [-0.9149, -1.1226, -1.4066, -1.9199, -2.6181], [-0.7776, -0.9616, -1.1936, -1.6112, -2.271], [-0.6812, -0.8393, -1.039, -1.4395, -1.9957]]
    ],
    sp: {
      gauntlet: [
        [[-0.0057, -0.13207, -0.000334], [0.0096, -0.08712, 0.000249], [0.0056, -0.04254, -0.000045], [0.0102, -0.02194, 0.000062], [0.0069, -0.01098, 0.000047]],
        [[-0.0154, -0.16398, -0.000445], [0.0133, -0.10368, -0.000094], [0.0065, -0.0591, 0.000026], [0.0128, -0.02656, -0.000017], [0.0036, -0.01113, 0.000007]],
        [[-0.0126, -0.27581, 0.000646], [-0.0136, -0.17121, -0.000631], [0.0068, -0.11482, 0.000025], [0.0166, -0.05125, -0.000043], [0.0054, -0.02135, 0.000002]],
        [[-0.0503, -0.29456, -0.001791], [-0.0202, -0.20715, -0.000036], [-0.0271, -0.13695, 0.000111], [-0.0168, -0.06339, 0.000103], [-0.0146, -0.02134, -0.00009]],
        [[-0.0771, -0.35124, -0.004532], [-0.002, -0.27437, -0.000248], [-0.0372, -0.17088, -0.000567], [-0.0252, -0.08218, -0.000309], [-0.0097, -0.03397, -0.000029]],
        [[-0.0397, -0.45961, -0.001302], [0.006, -0.34578, 0.002742], [-0.0085, -0.23494, -0.000156], [-0.0136, -0.12054, -0.000246], [0.002, -0.05474, 0.000047]],
        [[-0.0466, -0.54247, 0.000029], [0.0044, -0.42505, 0.002354], [-0.0285, -0.29022, 0.001525], [-0.0203, -0.16717, 0.000613], [-0.0328, -0.07317, 0.000061]],
        [[-0.0361, -0.67588, -0.005973], [0.0294, -0.5985, 0.007482], [-0.0227, -0.41364, -0.000368], [-0.0324, -0.25985, 0.000773], [-0.0463, -0.14107, 0.000083]]
      ],
      tilt: [
        [[-0.0205, -0.15884, 0.001118], [-0.0205, -0.0757, -0.000522], [-0.0025, -0.0394, -0.000122], [0.0051, -0.01512, 0.000114], [0.0002, -0.00251, 0.000021]],
        [[-0.0127, -0.20272, 0.000777], [-0.0122, -0.11624, -0.000105], [-0.003, -0.06485, -0.000089], [0.0004, -0.0228, -0.000055], [-0.0001, -0.00635, 0.000024]],
        [[-0.0254, -0.27109, 0.001828], [-0.015, -0.15953, -0.000716], [-0.0083, -0.10064, -0.000144], [0.0006, -0.04644, 0.000161], [-0.0051, -0.01293, 0.00002]],
        [[-0.0263, -0.30894, 0.001403], [-0.0291, -0.19747, 0.000594], [-0.0276, -0.1166, -0.000097], [-0.0249, -0.04465, -0.000181], [-0.0056, -0.01424, -0.000036]],
        [[-0.0205, -0.33293, -0.001353], [-0.0212, -0.2146, -0.001285], [-0.0053, -0.15053, 0.000194], [-0.0227, -0.06292, -0.000142], [-0.0132, -0.02361, 0.000058]],
        [[-0.0483, -0.35661, -0.003861], [0.0179, -0.30272, 0.001958], [-0.036, -0.17945, 0.000191], [-0.0082, -0.09135, -0.000065], [-0.0074, -0.03325, -0.000032]],
        [[0.0169, -0.49629, 0.003416], [-0.0011, -0.34688, 0.001567], [-0.0299, -0.20579, -0.002546], [-0.003, -0.12559, 0.000151], [-0.0173, -0.04812, -0.000079]],
        [[0.0528, -0.62618, 0.009313], [-0.032, -0.40401, -0.001663], [-0.0164, -0.30427, -0.001311], [-0.0067, -0.18325, 0.000386], [-0.0348, -0.08871, -0.000104]]
      ],
      zigzag: [
        [[-0.0257, -0.07378, 0.000008], [-0.0142, -0.03387, 0.000026], [-0.0091, -0.01582, 0.000025], [0.0026, -0.00484, 0.000005], [-0.0002, -0.0004, -0.000019]],
        [[-0.0414, -0.09133, -0.000533], [-0.0188, -0.05771, -0.000054], [-0.0116, -0.02677, -0.000085], [-0.0019, -0.0125, 0.000046], [-0.0046, -0.00388, -0.000047]],
        [[-0.0424, -0.17088, 0.000047], [-0.0209, -0.10595, -0.000008], [-0.0363, -0.05958, -0.000002], [-0.0024, -0.02694, -0.000056], [-0.0041, -0.00953, -0.000028]],
        [[0.078, -0.22931, 0.000048], [0.047, -0.13356, -0.00024], [0.0308, -0.08442, -0.000131], [0.0161, -0.03845, 0.000122], [0.0122, -0.01471, 0.000065]],
        [[0.0597, -0.26616, -0.000606], [0.0537, -0.18379, 0.00037], [0.0497, -0.1217, 0.000389], [0.0101, -0.05034, -0.000078], [0.0073, -0.01919, -0.000041]],
        [[-0.0058, -0.28735, -0.00632], [0.0387, -0.2304, 0.000903], [0.0229, -0.14456, -0.000571], [0.0209, -0.07298, -0.000052], [0.0201, -0.03375, 0.00015]],
        [[0.0287, -0.40046, 0.001421], [0.0068, -0.26047, -0.000713], [0.0302, -0.2021, 0.000376], [0.0208, -0.09969, 0.000239], [0.0168, -0.04312, 0.000057]],
        [[-0.0071, -0.53477, 0.007528], [0.0198, -0.40624, -0.000984], [0.0075, -0.29514, -0.000502], [0.0298, -0.18161, 0.000378], [0.0104, -0.08736, 0.000223]]
      ],
      needle: [
        [[-0.0361, -0.10126, -0.000472], [0.0147, -0.06277, -0.000044], [0.0008, -0.03378, 0.000038], [0.0029, -0.01114, -0.000019], [0.0024, -0.00296, 0.00002]],
        [[-0.0335, -0.13477, -0.00005], [-0.003, -0.07742, -0.00003], [-0.0007, -0.0439, -0.000028], [0.0095, -0.01767, 0.000133], [0.0012, -0.00399, 0.000018]],
        [[-0.0428, -0.17366, 0.000661], [-0.0167, -0.1036, -0.000181], [-0.0064, -0.05455, -0.000133], [0.0038, -0.02263, 0.000018], [-0.0005, -0.0056, 0.000008]],
        [[-0.004, -0.2088, -0.000038], [-0.0032, -0.13369, 0.000225], [-0.0189, -0.06733, -0.000394], [0.0059, -0.03262, 0.000068], [-0.0004, -0.00811, -0.000022]],
        [[-0.0198, -0.2092, -0.001496], [0.0222, -0.14732, 0.00007], [0.0029, -0.08925, -0.000042], [-0.0001, -0.03839, -0.000013], [-0.0013, -0.0104, -0.000016]],
        [[-0.0067, -0.23066, -0.001897], [0.0199, -0.16609, 0.000244], [-0.0037, -0.09639, -0.000382], [0.0037, -0.04322, -0.000144], [-0.0008, -0.01442, 0.000048]],
        [[-0.0014, -0.26275, -0.000511], [0.0128, -0.17352, -0.000466], [-0.0015, -0.11398, -0.000014], [0.0018, -0.05852, 0.000159], [-0.0005, -0.01716, -0.000028]],
        [[0.0441, -0.33426, 0.000689], [0.0406, -0.22279, -0.00025], [0.0245, -0.15473, -0.000067], [0.0035, -0.07711, -0.000121], [-0.004, -0.02935, -0.000057]]
      ],
      wave: [
        [[-0.0098, -0.11661, -0.000098], [0.0063, -0.06442, 0.000067], [-0.0016, -0.03401, 0.000083], [0.0075, -0.01717, 0.0001], [0.0007, -0.00549, -0.000016]],
        [[-0.0365, -0.13219, 0.000061], [-0.0051, -0.07721, -0.000249], [0.0072, -0.04807, 0.000051], [0.0016, -0.01752, -0.000023], [0.0003, -0.00629, -0.000005]],
        [[-0.0085, -0.23834, 0.0005], [0.0034, -0.14694, -0.000143], [-0.0002, -0.08904, -0.00014], [0.0021, -0.03867, 0.000051], [0.003, -0.01581, 0.00006]],
        [[0.0051, -0.24357, -0.001111], [0.0211, -0.16168, -0.000422], [0.0138, -0.1054, 0.000083], [0.0052, -0.04402, -0.000016], [-0.0019, -0.01316, -0.000028]],
        [[0.023, -0.33305, 0.001407], [0.0072, -0.19847, -0.002154], [0.0127, -0.13757, -0.000517], [0.0142, -0.06604, -0.000102], [0.0033, -0.02377, -0.000054]],
        [[0.0021, -0.36822, -0.004796], [0.0105, -0.27554, -0.002064], [0.0314, -0.20584, 0.00011], [-0.0015, -0.09781, -0.000124], [0.0053, -0.04259, 0.000024]],
        [[0.0469, -0.53749, 0.004503], [0.0221, -0.35474, -0.000248], [0.0258, -0.25977, -0.000773], [0.0183, -0.14418, -0.000307], [0.0147, -0.06918, 0.000255]],
        [[-0.0502, -0.64871, -0.001159], [-0.0023, -0.5062, -0.010477], [0.0445, -0.43389, 0.000928], [0.0224, -0.25952, 0.000346], [0.0045, -0.13553, -0.000189]]
      ],
      express: [
        [[-0.0306, -0.12711, -0.000529], [0.0005, -0.07358, -0.000119], [0.005, -0.03756, -0.000034], [0.008, -0.01296, 0.000069], [0.0008, -0.00241, 0.000017]],
        [[-0.0697, -0.18379, -0.002121], [-0.0038, -0.13418, 0.000221], [-0.0137, -0.07724, 0.000233], [0.0008, -0.03113, 0.000086], [0.0032, -0.01085, 0.00009]],
        [[-0.0674, -0.34468, 0.001093], [0, -0.24411, 0.000966], [-0.0179, -0.15819, 0.000782], [-0.0166, -0.06503, -0.000259], [0.0004, -0.02843, -0.000021]],
        [[0.0194, -0.37711, -0.000613], [0.0003, -0.26082, -0.000167], [0.0037, -0.17841, 0.000612], [0.0029, -0.08838, -0.000033], [-0.0119, -0.03754, 0.000144]],
        [[-0.0769, -0.37871, -0.009008], [-0.0099, -0.30738, -0.000444], [-0.025, -0.21887, -0.000188], [-0.0138, -0.13015, -0.000129], [-0.0209, -0.05334, -0.000119]],
        [[-0.033, -0.50779, -0.00717], [-0.0054, -0.41398, 0.003668], [0.0204, -0.31756, 0.00231], [-0.033, -0.16703, 0.00003], [-0.0315, -0.08406, 0.000114]],
        [[-0.0922, -0.57507, -0.001702], [-0.0056, -0.49802, 0.003546], [-0.0325, -0.34764, -0.000531], [-0.0095, -0.2218, -0.000004], [-0.0394, -0.1115, 0.000063]],
        [[0.0233, -0.87646, 0], [0.0496, -0.71457, 0.005092], [-0.0456, -0.50055, -0.003986], [-0.0368, -0.33029, -0.002178], [-0.0541, -0.20305, 0.000037]]
      ]
    }
  }; // engine v14, 2000 attempts per cell, 2026-11-24
  // @@END@@

  // ---------------------------------------------------------------- courses
  function config(R, g) {
    const [di, L] = GRADES[g], C = E.levelConfig(di, L), T = R.t || {};
    if (T.moveScale != null) C.moveP *= T.moveScale;
    if (T.movePMin != null) C.moveP = Math.max(C.moveP, T.movePMin);
    if (T.moveP != null) C.moveP = T.moveP;
    if (T.moveAmpMin != null) C.moveAmp = Math.max(C.moveAmp, T.moveAmpMin);
    if (T.tiltP != null) C.tiltP = T.tiltP;
    if (T.tiltMaxMin != null) C.tiltMax = Math.max(C.tiltMax, T.tiltMaxMin);
    if (T.fast) { C.speed *= T.fast; C.spacing *= T.fast; C.firstX *= T.fast; } // faster, and the rings spread with it
    if (T.narrow) C.hoopW -= T.narrow;
    return C;
  }

  // One course from a seed: the same shape of object as engine.generateLevel. Ring i doesn't depend on n, so a
  // course of n rings is the first n rings of a longer one (the simulator prices every length from one long run).
  function generate(seed, recipe, g, n) {
    const R = typeof recipe === 'string' ? BY[recipe] : recipe;
    const C = config(R, g), rng = E.makeRng('special|' + seed + '|' + R.id + '|' + g);
    const hoops = [], mid = (E.Y_MIN + E.Y_MAX) / 2, half = (E.Y_MAX - E.Y_MIN) / 2;
    let x = C.firstX, prevY = START_Y;
    const wPhase = rng(), wLen = 5 + Math.floor(rng() * 3); // the wave's starting point and length (rings)
    for (let i = 0; i < n; i++) {
      // a fixed number of draws per ring, as in the engine
      const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng(), r5 = rng(), r6 = rng(), r7 = rng(), r8 = rng(), r9 = rng();
      let gap = C.firstX;
      if (i > 0) { gap = C.spacing * (0.92 + 0.16 * r9); x += gap; }
      let amp = 0, period = 1, phase = 0;
      if (r2 < C.moveP) { amp = C.moveAmp * (0.75 + 0.25 * r3); period = C.periodBase * (0.85 + 0.3 * r4); phase = r5; }
      let y;
      if (R.shape === 'zigzag') y = i % 2 ? E.Y_MIN + 10 + r1 * 40 : E.Y_MAX - 10 - r1 * 40;
      else if (R.shape === 'wave') y = mid + half * 0.8 * E.wave(wPhase + i / wLen) + (r1 * 2 - 1) * 14;
      else {
        y = i === 0 ? 320 + (r1 * 2 - 1) * 45 : prevY + (r1 * 2 - 1) * C.dy;
        if (y < E.Y_MIN) y = E.Y_MIN + (E.Y_MIN - y) * 0.5;
        if (y > E.Y_MAX) y = E.Y_MAX - (y - E.Y_MAX) * 0.5;
      }
      // never ask for more climbing than perfect play can deliver in the time available
      const T = gap / C.speed;
      let maxUp = CLIMB_RATE * (T - DROP_TIME) - CLIMB_MARGIN;
      if (maxUp < 30) maxUp = 30;
      if (prevY - (y - amp) > maxUp) y = prevY - maxUp + amp;
      if (y - amp < E.Y_MIN) y = E.Y_MIN + amp;
      if (y + amp > E.Y_MAX) y = E.Y_MAX - amp;
      let tilt = 0;
      if (r6 < C.tiltP) tilt = (R.lean === 'alt' ? (i % 2 ? 1 : -1) : r7 < 0.5 ? -1 : 1) * C.tiltMax * (0.6 + 0.4 * r8) * DEG;
      hoops.push({ i, x, y0: y, w: C.hoopW, amp, period, phase, tilt, c: E.dcos(tilt), s: E.dsin(tilt), cp: i === n - 1 });
      prevY = y;
    }
    // the time limit grows with the course: a slow player needs up to about 2.4 s a ring (rim knocks hold the ball back)
    return { seed: String(seed), di: GRADES[g][0], L: 0, special: R.id, grade: g, speed: C.speed, startY: START_Y, hoops, endX: x + C.spacing, maxTicks: E.TICK_HZ * Math.max(45, 20 + 3 * n) };
  }

  // ---------------------------------------------------------------- the day's three
  // Each twist comes up once every two days, in a shuffled order; the slots (2x, 3x, 5x) take them in turn.
  const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
  const dayStart = (day) => Date.parse(String(day).slice(0, 10) + 'T00:00:00Z');
  const closesAt = (day) => dayStart(day) + DAY_MS;
  const EPOCH = Date.UTC(2026, 0, 5);
  function order(cycle) {
    const a = RECIPES.slice(), r = E.makeRng('specialcycle|' + cycle);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function specialsFor(day) {
    const k = Math.floor((dayStart(day) - EPOCH) / DAY_MS), half = Math.floor(RECIPES.length / 2);
    const a = order(Math.floor(k / 2)), from = ((k % 2) + 2) % 2 ? half : 0;
    return SLOTS.map((x, slot) => ({ slot, x, recipe: a[from + slot] }));
  }

  // ---------------------------------------------------------------- skill
  // between the anchors, and past them by extending the nearest pair
  const lerp = (v, s) => { const k = Math.max(0, Math.min(ANCHORS.length - 2, Math.floor(s))), t = s - k; return v[k] * (1 - t) + v[k + 1] * t; };
  // per-ring miss rate on a regular level for skill s
  function missReg(di, L, s) { const v = TABLES.reg[di] && TABLES.reg[di][L - 1]; return v ? Math.min(0.95, Math.max(1e-4, Math.exp(lerp(v, s)))) : 0.1; }
  // the chance that a player of skill s passes the first n rings of a twist at a grade (n of n clears it)
  function clearP(recipe, g, n, s) {
    if (n <= 0) return 1;
    const v = TABLES.sp[recipe] && TABLES.sp[recipe][g];
    if (!v) return Math.exp(-0.1 * n);
    return Math.min(1, Math.exp(lerp(v.map((x) => x[0] + x[1] * n + x[2] * n * n), s)));
  }
  const clamp = (d) => Math.max(D_MIN, Math.min(D_MAX, d));
  const levelName = (d) => LEVEL_NAMES[Math.max(0, Math.min(LEVEL_NAMES.length - 1, Math.round(d)))];
  // a clear raises a special's level by this much: UP / DOWN = (1 - p) / p, so the level settles where p = TARGET / x
  const up = (x) => { const p = TARGET / x; return DOWN * (1 - p) / p; };

  // A player's record: rings passed and missed on each regular level (r, 'tier|level': [passed, missed]), their level
  // in each special (d, by slot; null until they first play it), and for show how many rings and attempts.
  const blank = () => ({ r: {}, d: SLOTS.map(() => null), rings: 0, tries: 0 });
  const norm = (Rt) => {
    if (!Rt || !Rt.r) return blank();
    if (!Array.isArray(Rt.d)) Rt.d = SLOTS.map(() => null);
    return Rt;
  };
  // a regular level the bank verified (with any bet: it can only raise where a special's level starts)
  function addLevel(Rt, di, L, passes, missed) {
    Rt = norm(Rt);
    const k = di + '|' + L, c = Rt.r[k] || (Rt.r[k] = [0, 0]);
    c[0] += passes; c[1] += missed ? 1 : 0; Rt.rings += passes + (missed ? 1 : 0);
    return Rt;
  }
  // the rating from regular runs: a probability over GRID, the prior times every ring passed and missed
  function regular(Rt) {
    const lp = GRID.map((s) => -0.5 * ((s - PRIOR_MU) / PRIOR_SD) ** 2);
    if (Rt && Rt.r) for (const key in Rt.r) {
      const [di, L] = key.split('|'), [pass, miss] = Rt.r[key];
      GRID.forEach((s, i) => { const h = missReg(+di, +L, s); lp[i] += pass * Math.log(1 - h) + miss * Math.log(h); });
    }
    const top = Math.max(...lp), w = lp.map((v) => Math.exp(v - top)), sum = w.reduce((a, b) => a + b, 0);
    const m = w.reduce((a, v, i) => a + v * GRID[i], 0) / sum, sd = Math.sqrt(w.reduce((a, v, i) => a + v * (GRID[i] - m) ** 2, 0) / sum);
    return { m, sd };
  }
  // where a special's level starts: START, or more if regular runs (their rating less one spread) or the player's
  // level in another special (less SLOT_MARGIN) show more
  function startFor(Rt, slot) {
    let d = START;
    if (Rt && Rt.r) { const g = regular(Rt); d = Math.max(d, g.m - g.sd); }
    if (Rt && Array.isArray(Rt.d)) Rt.d.forEach((v, k) => { if (k !== slot && v != null) d = Math.max(d, v - SLOT_MARGIN); });
    return clamp(d);
  }
  // the player's level in a special now
  const levelOf = (Rt, slot) => (Rt && Array.isArray(Rt.d) && Rt.d[slot] != null ? Rt.d[slot] : startFor(Rt, slot));
  // an attempt at a special is over: up after a clear, down after a miss
  function addSpecial(Rt, slot, won, rings) {
    const d = levelOf(Rt, slot);
    Rt = norm(Rt);
    Rt.d[slot] = Math.round(clamp(d + (won ? up(SLOTS[slot]) : -DOWN)) * 1e4) / 1e4;
    Rt.tries++; Rt.rings += rings | 0;
    return Rt;
  }
  // for show: the player's level from regular runs, and in each special
  function rating(Rt) {
    const g = regular(Rt);
    return { s: Math.round(g.m * 100) / 100, sd: Math.round(g.sd * 100) / 100, name: levelName(g.m), rings: Rt && Rt.rings ? Rt.rings : 0, tries: Rt && Rt.tries ? Rt.tries : 0,
      levels: SLOTS.map((x, k) => Math.round(levelOf(Rt, k) * 100) / 100) };
  }

  // ---------------------------------------------------------------- the course for a level
  // For each grade, the shortest course a player of skill d clears with a chance of at most TARGET / x; then the grade
  // whose course is nearest N_IDEAL rings and closest to that chance. A level past the hardest full-length course gets
  // that one; one below the easiest, shortest course gets that one.
  function courseFor(d, recipe, x) {
    const goal = TARGET / x;
    let best = null;
    for (let g = 0; g < GRADES.length; g++) {
      let n = N_MIN;
      while (n <= N_MAX && clearP(recipe, g, n, d) > goal) n++;
      if (n > N_MAX) continue;
      const c = clearP(recipe, g, n, d), score = Math.abs(n - N_IDEAL) + 40 * (goal - c) / goal;
      if (!best || score < best.score) best = { g, n, c, score };
    }
    if (!best) { const g = GRADES.length - 1; best = { g, n: N_MAX, c: clearP(recipe, g, N_MAX, d) }; }
    return { g: best.g, n: best.n, chance: Math.round(best.c * 1e4) / 1e4, rtp: Math.round(best.c * x * 1e4) / 1e4 };
  }
  // the day's three for a player (or for someone new): each course set for the player's level in that special; chance
  // is how often a player at that level clears it
  function todayFor(Rt, day) {
    return specialsFor(day).map(({ slot, x, recipe }) => {
      const d = levelOf(Rt, slot), c = courseFor(d, recipe.id, x);
      return { slot, x, recipe: recipe.id, g: c.g, n: c.n, chance: c.chance, rtp: c.rtp, level: Math.round(d * 100) / 100, levelName: levelName(d) };
    });
  }

  return {
    ENTRY, DAY_MS, START_Y, SLOTS, TARGET, N_MIN, N_MAX, N_IDEAL, GRADES, RECIPES, BY, ANCHORS, LEVEL_NAMES, GRID,
    D_MIN, D_MAX, PRIOR_MU, PRIOR_SD, START, DOWN, SLOT_MARGIN, TABLES,
    config, generate, dayKey, dayStart, closesAt, specialsFor,
    blank, addLevel, regular, startFor, levelOf, addSpecial, up, levelName, rating, courseFor, todayFor, missReg, clearP
  };
});
