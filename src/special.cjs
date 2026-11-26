/* SOL DUNK special levels: shared by the browser, the server and the simulator.
 *
 * Three a day (UTC), the same three twists for everyone that day (every ring moving, every rim leaning, a staircase,
 * rings that tighten one by one, ...; twelve take turns, each once every four days), with prizes of 2x, 3x and 5x
 * the entry. Each attempt is a fresh course from its own provably fair seed; the player pays
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
 * while it comes down; after that it's 90% for both. So the specials open only once a player has bet UNLOCK entries'
 * worth in regular runs (the owner asked for it): by then a strong player's runs have raised their starting levels. The simulator's best bot ("perfect") is past the top of the
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
  // grades: the ring settings a course is built on, as [tier, level] of the regular game, easiest first. The last two
  // are past the regular game: Hard level 8 with one and two OVER steps (tighter rings, a quicker ball with the rings
  // spread to match, bigger bobs, leans and height changes). Without them the easier twists (Needle, Elevators, Slow
  // motion) had no course hard enough for a pro at 3x and 5x: a pro cleared the hardest Needle course 45% of the
  // time, which paid 238% at 5x.
  const GRADES = [[0, 1], [0, 3], [0, 5], [1, 3], [1, 4], [1, 5], [1, 6], [1, 8], [1, 8, 1], [1, 8, 2]];
  const OVER = { w: 5, speed: 0.06, amp: 5, tilt: 2, tiltP: 0.1, dy: 8 }; // one step past Hard level 8
  const W_MIN = 60;          // no ring is tighter than this, whatever the twist (the ball then has 7 units to spare)

  // The twists, applied to the grade's settings (engine levelConfig). shape: how ring heights are chosen ('walk' like a
  // normal level, 'zigzag' high-low, 'wave' a rolling line, 'stairs' three steps up and a drop); lean 'alt': tilts
  // alternate left and right; width: how wide each ring is ('squeeze' a little tighter each ring, 'alt' wide then
  // tight); sync: every ring bobs in the same rhythm, each this far (in turns) behind the last, so a wave runs along
  // the course. A twist may only depend on a ring's place in the course, never on the course's length.
  const RECIPES = [
    { id: 'gauntlet', name: 'The gauntlet', blurb: 'Every ring moves', t: { moveP: 1, moveAmpMin: 34 } },
    { id: 'tilt', name: 'Tilt alley', blurb: 'Every rim leans, left then right', t: { tiltP: 1, tiltMaxMin: 11, moveScale: 0.5 }, lean: 'alt' },
    { id: 'zigzag', name: 'Zigzag', blurb: 'High ring, low ring, all the way', t: { moveScale: 0.5 }, shape: 'zigzag' },
    { id: 'needle', name: 'Needle', blurb: 'Tight rims, nothing moves', t: { moveP: 0, tiltP: 0, narrow: 10 } },
    { id: 'wave', name: 'The wave', blurb: 'Rings ride a rolling line', t: { movePMin: 0.6, moveAmpMin: 32 }, shape: 'wave' },
    { id: 'express', name: 'Express', blurb: 'A quicker ball, rings spread to match', t: { fast: 1.25 } },
    // six more (the owner asked for more fun and unique challenges)
    { id: 'stairs', name: 'Stairway', blurb: 'Three steps up, then the drop', t: { moveScale: 0.4 }, shape: 'stairs' },
    { id: 'ripple', name: 'The ripple', blurb: 'Rings bob one after another', t: { moveP: 1, moveAmpMin: 38 }, sync: 0.16 },
    { id: 'squeeze', name: 'The squeeze', blurb: 'Each ring tighter than the last', t: { moveScale: 0.5 }, width: 'squeeze' },
    { id: 'biglittle', name: 'Big and little', blurb: 'A wide ring, then a tight one', t: {}, width: 'alt' },
    { id: 'lifts', name: 'Elevators', blurb: 'Every ring rides a long, slow lift', t: { moveP: 1, moveAmpMin: 62, moveAmpAdd: 8, slow: 1.7 } },
    { id: 'slowmo', name: 'Slow motion', blurb: 'A slower ball through tight rings', t: { fast: 0.78, narrow: 9, moveScale: 0.5 } }
  ];
  const PER_DAY = 3;
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
  const UNLOCK = 10;                      // the specials open once a player has bet this many entries in regular runs

  // @@TABLES@@ written by node sim/special.cjs --write, for each bot on the ANCHORS. Don't edit by hand.
  // reg[tier][level - 1] = ln(per-ring miss rate) per anchor; sp[recipe][grade] = [a, b, c] per anchor, with
  // ln(chance of clearing a course of n rings) = a + b * n + c * n * n, fitted from N_MIN to N_MAX rings.
  const TABLES = {
    reg: [
      [[-2.5313, -3.2338, -4.0455, -5.518, -7.3992], [-2.2815, -2.8587, -3.5799, -4.6072, -5.9109], [-2.0505, -2.5889, -3.209, -4.2582, -5.2856], [-1.81, -2.2709, -2.782, -3.6788, -4.7784], [-1.5613, -1.9544, -2.4249, -3.289, -4.2871], [-1.3349, -1.6838, -2.0867, -2.7883, -3.7649], [-1.14, -1.4407, -1.7873, -2.4397, -3.2558], [-0.9661, -1.1933, -1.5128, -2.0614, -2.8193]],
      [[-2.0514, -2.5427, -3.1113, -4.1457, -5.4047], [-1.6911, -2.1, -2.584, -3.4163, -4.5976], [-1.4835, -1.7935, -2.2416, -3.0038, -4.1198], [-1.2689, -1.5875, -1.946, -2.6331, -3.5157], [-1.1118, -1.3307, -1.6563, -2.2508, -3.0343], [-0.911, -1.1225, -1.4068, -1.897, -2.5743], [-0.7704, -0.9412, -1.1686, -1.5778, -2.1524], [-0.6564, -0.8207, -0.9998, -1.3733, -1.8169]]
    ],
    sp: {
      gauntlet: [
        [[0.0074, -0.14288, 0.000185], [0.007, -0.08952, 0.000401], [0.0008, -0.04036, -0.000233], [0.011, -0.0231, 0.00009], [0.0066, -0.01089, 0.000039]],
        [[-0.012, -0.16905, -0.000013], [0.0143, -0.10701, 0.00002], [0.0036, -0.05872, -0.000055], [0.0116, -0.02644, -0.000023], [0.0053, -0.01205, 0.000024]],
        [[-0.0324, -0.25963, -0.001269], [-0.0063, -0.17505, -0.000947], [0.0039, -0.11382, -0.000161], [0.0095, -0.04933, -0.000187], [0.0046, -0.0209, -0.000045]],
        [[-0.0306, -0.31949, 0.000206], [-0.012, -0.21735, 0.000736], [-0.0364, -0.13184, -0.000603], [-0.0242, -0.06237, 0.00014], [-0.0127, -0.02365, -0.000005]],
        [[-0.027, -0.39062, -0.00073], [0.0141, -0.28311, 0.00105], [-0.0346, -0.17431, -0.000131], [-0.0293, -0.0836, -0.000077], [-0.0108, -0.03719, 0.000018]],
        [[-0.054, -0.45814, 0.000082], [-0.0182, -0.32267, 0.000146], [-0.0315, -0.22099, -0.001489], [-0.0134, -0.12293, 0.000205], [-0.0144, -0.05212, -0.000064]],
        [[-0.001, -0.59325, 0.008953], [0.0347, -0.45143, 0.004271], [-0.0734, -0.25795, -0.002254], [-0.0427, -0.16296, 0.000378], [-0.0303, -0.08618, 0.000345]],
        [[-0.0657, -0.67644, -0.002473], [-0.0011, -0.56994, -0.002959], [-0.0023, -0.45817, 0.00074], [-0.0482, -0.27688, 0.001496], [-0.025, -0.17731, 0.000601]],
        [[-0.1101, -0.85225, 0.003761], [-0.0651, -0.71375, 0.002281], [-0.0408, -0.59835, 0.000569], [-0.0547, -0.38262, -0.002962], [-0.0845, -0.24974, -0.000309]],
        [[0.0202, -1.12622, 0.010265], [0.0601, -0.92727, 0], [0.0027, -0.74648, -0.001893], [0.0554, -0.6105, 0.005636], [-0.0644, -0.37196, -0.000358]]
      ],
      tilt: [
        [[-0.0309, -0.14486, -0.000333], [-0.0128, -0.07883, -0.000063], [0.0007, -0.04001, -0.000052], [0.0059, -0.01466, 0.000127], [0.0004, -0.00269, 0.000032]],
        [[-0.012, -0.20379, -0.000275], [-0.0027, -0.1205, -0.000146], [0.008, -0.06746, 0.000128], [0.0033, -0.02299, -0.000022], [0.0014, -0.00631, 0.000034]],
        [[-0.0014, -0.27485, 0.00171], [0.0079, -0.17534, 0.00017], [0.0011, -0.10279, -0.000006], [0.002, -0.04431, 0.000152], [-0.0019, -0.01336, 0.000058]],
        [[-0.0432, -0.28677, -0.002492], [-0.0231, -0.19512, -0.000001], [-0.0324, -0.1094, -0.000533], [-0.014, -0.04797, -0.000048], [-0.0021, -0.01511, -0.000003]],
        [[-0.0224, -0.32592, -0.001633], [-0.0186, -0.21405, -0.000988], [-0.0132, -0.1453, -0.000267], [-0.0058, -0.0708, 0.000107], [-0.0107, -0.0244, 0.000071]],
        [[-0.0246, -0.37521, -0.00192], [0.0043, -0.29174, 0.001396], [-0.027, -0.18576, -0.000091], [-0.0067, -0.09033, -0.000052], [-0.0081, -0.0352, -0.000014]],
        [[0.0023, -0.46541, -0.000055], [0.0152, -0.35898, 0.003696], [0.0183, -0.24662, 0.000785], [-0.0057, -0.12397, -0.000185], [-0.0197, -0.04707, -0.00035]],
        [[0.1358, -0.70607, 0.013073], [-0.0113, -0.41376, -0.002041], [0.034, -0.33685, 0.000754], [0.0064, -0.19141, -0.000258], [-0.0287, -0.09773, -0.000277]],
        [[0.0732, -0.7009, 0], [0.1144, -0.59134, 0.005269], [0.0566, -0.45473, 0.00385], [0.0201, -0.27551, -0.000008], [-0.0092, -0.16219, -0.00011]],
        [[-0.006, -0.69795, -0.02466], [0.2123, -0.79872, 0.015571], [0.0755, -0.59219, 0.008232], [0.0288, -0.38173, 0.000534], [0.007, -0.25205, 0.000355]]
      ],
      zigzag: [
        [[-0.0353, -0.06731, -0.000365], [-0.0129, -0.03455, 0.000042], [-0.0088, -0.01661, 0.000029], [0.003, -0.00577, 0.000039], [0.0001, -0.00092, -0.000027]],
        [[-0.0344, -0.09828, -0.000144], [-0.0143, -0.06066, 0.000083], [-0.0114, -0.02806, -0.000043], [-0.0017, -0.01319, 0.000038], [-0.0049, -0.00399, -0.000062]],
        [[-0.0598, -0.163, -0.0004], [-0.0262, -0.10399, -0.000262], [-0.0265, -0.06642, 0.000403], [-0.0036, -0.02685, -0.00001], [-0.0045, -0.00998, -0.000041]],
        [[0.0807, -0.23141, 0.000476], [0.0641, -0.1441, -0.000491], [0.0354, -0.08931, -0.000071], [0.0168, -0.03891, -0.000038], [0.0124, -0.01515, 0.000031]],
        [[0.079, -0.27947, 0.001054], [0.0557, -0.185, 0.000381], [0.0462, -0.11934, 0.000249], [0.0177, -0.0553, 0.000191], [0.0075, -0.02066, -0.000027]],
        [[0.0209, -0.31455, 0.000419], [0.0311, -0.22288, -0.000256], [0.0183, -0.14381, -0.000639], [0.0224, -0.0744, -0.000047], [0.0182, -0.03326, 0.000064]],
        [[0.026, -0.39706, 0.0004], [-0.0015, -0.24788, -0.002669], [0.0222, -0.19703, 0.000204], [0.0197, -0.09837, -0.000031], [0.0176, -0.04501, 0.000054]],
        [[-0.0331, -0.50691, 0.000109], [0.0106, -0.40481, -0.001651], [-0.0004, -0.29084, -0.002067], [0.0416, -0.1925, 0.000497], [0.0258, -0.10297, 0.000179]],
        [[-0.0111, -0.6603, -0.001201], [0.02, -0.52117, -0.004341], [-0.0027, -0.39346, -0.001836], [0.0325, -0.28085, 0.000525], [0.0356, -0.17405, 0.000429]],
        [[0.0137, -0.86341, 0.017928], [0.0975, -0.70091, 0], [0.0401, -0.55691, 0.002608], [0.0027, -0.36497, -0.003985], [-0.0006, -0.24098, 0.000005]]
      ],
      needle: [
        [[-0.0369, -0.10753, -0.000001], [0.0133, -0.06482, 0.000033], [0.0018, -0.03441, -0.000005], [0.0044, -0.01237, -0.000005], [0.0023, -0.00285, 0.000011]],
        [[-0.0287, -0.14003, 0.000187], [-0.0026, -0.08228, -0.000043], [0.0016, -0.04745, 0.000025], [0.0077, -0.01784, 0.000076], [0.0013, -0.004, 0.000004]],
        [[-0.0437, -0.17612, 0.000275], [-0.0268, -0.10354, -0.000048], [-0.0078, -0.05805, -0.000043], [0.0025, -0.02537, 0.000066], [-0.0019, -0.00608, -0.000004]],
        [[-0.0099, -0.21066, 0.000081], [0.0055, -0.13866, 0.000312], [-0.0151, -0.07485, -0.000224], [-0.005, -0.03167, -0.000036], [-0.0001, -0.00933, -0.000023]],
        [[-0.0222, -0.21858, -0.000728], [0.0037, -0.14329, -0.000311], [-0.0102, -0.08792, -0.000158], [0.0051, -0.04629, 0.000101], [-0.0009, -0.01381, 0.000041]],
        [[-0.0049, -0.24146, -0.000806], [0.0118, -0.15914, -0.000608], [0.0004, -0.10574, 0.000037], [0.0078, -0.04834, -0.000032], [-0.0049, -0.01594, -0.000006]],
        [[0.0098, -0.28457, 0.000347], [-0.0001, -0.1679, -0.001214], [-0.0034, -0.12095, 0.000003], [-0.0058, -0.06264, 0.000242], [0.0015, -0.02095, -0.000065]],
        [[-0.0254, -0.2774, -0.007852], [0.0363, -0.22774, 0.000079], [0.0022, -0.15568, -0.000256], [-0.0015, -0.0901, 0.000035], [-0.0127, -0.03531, -0.00008]],
        [[0.0163, -0.41944, 0.002105], [0.0452, -0.31464, 0.000458], [-0.0077, -0.23399, 0.000369], [-0.0186, -0.13639, 0.000176], [-0.0392, -0.06404, 0.000039]],
        [[0.0383, -0.50847, 0.004559], [0.0493, -0.38791, 0.001716], [-0.0275, -0.25976, -0.002329], [-0.015, -0.19452, 0.001006], [-0.0693, -0.10392, 0.000126]]
      ],
      wave: [
        [[-0.0134, -0.11636, -0.000048], [0.007, -0.06479, -0.000003], [-0.0047, -0.0325, -0.000015], [0.0084, -0.01769, 0.000099], [0.0011, -0.00567, -0.000005]],
        [[-0.0257, -0.14183, 0.000176], [-0.0013, -0.08048, -0.000152], [0.0084, -0.04889, 0.000089], [0.0009, -0.01751, -0.000037], [-0.0001, -0.00604, -0.000016]],
        [[-0.0341, -0.21822, -0.000789], [0.0025, -0.14595, -0.000378], [-0.0002, -0.09358, 0.000121], [-0.0005, -0.04019, 0.000093], [0.0038, -0.01585, 0.000038]],
        [[0.0067, -0.24625, -0.000858], [0.0129, -0.15666, -0.000565], [0.0122, -0.10596, 0.000079], [0.0079, -0.04572, 0.00014], [-0.0031, -0.01428, -0.000057]],
        [[0.0576, -0.36122, 0.003037], [0.0382, -0.22414, 0.000341], [0.0099, -0.13275, -0.000695], [0.0104, -0.06352, -0.000138], [0.0032, -0.02364, -0.000115]],
        [[0.0447, -0.40801, 0.001137], [0.0348, -0.29562, 0.00076], [0.0311, -0.20197, -0.00048], [0.0058, -0.10541, 0.000215], [0.0021, -0.0453, 0.000102]],
        [[0.0349, -0.51135, -0.001348], [0.0306, -0.36986, -0.000077], [0.0336, -0.27192, 0.000543], [0.0111, -0.14323, -0.000242], [0.0061, -0.06937, -0.000216]],
        [[-0.0603, -0.65055, -0.006499], [0.0819, -0.61976, 0.009934], [0.0673, -0.47643, 0.002233], [0.0323, -0.2927, 0.001459], [-0.0012, -0.153, -0.00013]],
        [[-0.0245, -0.79217, -0.020849], [-0.0358, -0.67426, -0.005938], [0.0548, -0.61222, 0.003942], [-0.0203, -0.36014, -0.008296], [-0.0387, -0.23353, -0.001942]],
        [[-0.0199, -1.01351, -0.01218], [-0.017, -0.84421, -0.020792], [-0.0155, -0.74644, 0], [0.0015, -0.52468, -0.002297], [0.0109, -0.3681, -0.000753]]
      ],
      express: [
        [[-0.0223, -0.14018, 0.000179], [-0.004, -0.07699, -0.000086], [0.0002, -0.0376, -0.000115], [0.0075, -0.01466, 0.000122], [0.0007, -0.00268, 0.000014]],
        [[-0.027, -0.21631, 0.000597], [-0.0103, -0.13463, -0.000091], [-0.0206, -0.07775, 0.000226], [-0.0026, -0.03086, 0.000002], [0.0014, -0.01096, 0.000033]],
        [[-0.0748, -0.34091, 0.000868], [-0.0231, -0.2288, -0.001158], [-0.0191, -0.15941, 0.000114], [-0.0016, -0.07302, -0.000044], [0.0033, -0.03017, 0.000001]],
        [[0.001, -0.37715, -0.000529], [0.0152, -0.27374, -0.000428], [0.0123, -0.1863, 0.000433], [-0.0083, -0.09001, -0.00027], [-0.0149, -0.04064, 0.000093]],
        [[-0.0152, -0.45168, 0.000357], [-0.0365, -0.28973, -0.002802], [-0.0337, -0.22279, -0.000372], [-0.0262, -0.13703, 0.000117], [-0.0396, -0.05462, -0.000102]],
        [[-0.005, -0.54766, 0.003071], [-0.0314, -0.40949, 0.000746], [-0.0091, -0.30925, -0.000805], [-0.0556, -0.16891, -0.000647], [-0.0394, -0.09549, 0.000047]],
        [[-0.0846, -0.59733, -0.005578], [-0.0182, -0.51197, 0.003931], [-0.0235, -0.39644, 0.001934], [-0.0527, -0.23902, -0.000062], [-0.0553, -0.14275, 0.000377]],
        [[0.0328, -0.90747, -0.003422], [0.0787, -0.78988, 0.007132], [-0.0175, -0.5669, -0.000713], [-0.0063, -0.41534, -0.00104], [-0.066, -0.25034, -0.000627]],
        [[-0.0424, -1.01666, 0], [0.0376, -0.96043, 0.016784], [0.0118, -0.81472, 0.010985], [-0.0709, -0.52515, -0.001972], [-0.0527, -0.38703, 0.001566]],
        [[-0.0263, -1.25393, 0], [0.0485, -1.11714, 0], [-0.0515, -0.93111, 0], [-0.0615, -0.69266, -0.006308], [-0.0384, -0.55461, 0.003976]]
      ],
      stairs: [
        [[-0.0221, -0.07902, 0.000235], [-0.0083, -0.03763, -0.000058], [-0.0083, -0.01488, -0.000009], [0.0006, -0.00405, -0.000014], [-0.0005, -0.00067, 0]],
        [[-0.0202, -0.10757, 0.000174], [-0.0193, -0.05562, -0.00007], [-0.0154, -0.02889, 0.00001], [0.0039, -0.01129, 0.000027], [0.0012, -0.00247, -0.000008]],
        [[-0.037, -0.17502, 0.000691], [-0.0221, -0.10285, -0.000105], [-0.0254, -0.05378, -0.000209], [-0.0031, -0.02486, 0.000074], [-0.0076, -0.00566, -0.00001]],
        [[0.0541, -0.21711, 0.000209], [0.0486, -0.14424, -0.000023], [0.034, -0.08339, -0.000129], [0.0093, -0.03278, -0.000012], [0.0045, -0.00897, -0.000019]],
        [[0.0216, -0.25935, -0.001003], [0.0497, -0.18863, 0.000792], [0.025, -0.1119, -0.000031], [0.0181, -0.05051, 0.000129], [0.0074, -0.01498, 0.000032]],
        [[0.0107, -0.31925, 0.000434], [0.003, -0.19534, -0.001655], [0.0037, -0.13194, -0.000466], [0.0094, -0.06875, -0.000023], [0.0122, -0.02663, 0.00015]],
        [[0.0346, -0.40112, 0.002845], [0.029, -0.26712, -0.001806], [0.0141, -0.18687, 0.000449], [0.0223, -0.09182, 0.000063], [0.0083, -0.03481, -0.000092]],
        [[-0.0159, -0.51518, 0.005522], [0.0066, -0.37795, -0.001368], [0.015, -0.29273, 0.001218], [0.0041, -0.15668, -0.000219], [0.0179, -0.08401, 0.000203]],
        [[-0.0459, -0.5997, -0.010194], [-0.0433, -0.45083, -0.00801], [-0.0309, -0.33772, -0.005036], [-0.0252, -0.22872, -0.001461], [0.0041, -0.13958, 0.000058]],
        [[-0.068, -0.75834, -0.004034], [0.0493, -0.68851, 0.006402], [-0.0321, -0.47506, -0.005388], [0.0067, -0.35736, 0.001401], [0.0209, -0.22832, 0.000753]]
      ],
      ripple: [
        [[-0.0062, -0.15874, 0.000111], [0.0063, -0.09218, 0.000122], [0.015, -0.05245, 0.000052], [0.0076, -0.02271, 0.000008], [0.004, -0.01186, 0.000011]],
        [[-0.0084, -0.18015, -0.000322], [0.0062, -0.11738, -0.000211], [-0.0008, -0.06051, -0.000304], [0.0034, -0.02983, 0.000046], [0.0073, -0.01329, 0.000034]],
        [[-0.0426, -0.28168, -0.001108], [0.0064, -0.18597, -0.000191], [-0.019, -0.11912, 0.000037], [0.0051, -0.05494, 0.000039], [0.0114, -0.02192, 0.000015]],
        [[-0.0379, -0.31045, -0.001997], [-0.0296, -0.20613, -0.000354], [-0.0172, -0.14037, 0.000056], [-0.0181, -0.06566, 0.000056], [0.0001, -0.02526, 0.000029]],
        [[0.0096, -0.42628, 0.005969], [-0.0219, -0.2604, -0.000484], [-0.0489, -0.16937, -0.000807], [-0.019, -0.09004, 0.000127], [-0.0133, -0.0372, -0.000089]],
        [[-0.0364, -0.47044, 0.003294], [0.0248, -0.35839, 0.002266], [-0.0266, -0.2329, -0.000378], [-0.0143, -0.13048, 0.000232], [-0.0217, -0.05499, 0.000055]],
        [[-0.0351, -0.55461, 0.001461], [-0.0394, -0.41404, 0.001598], [-0.0395, -0.3023, 0.000671], [-0.0259, -0.18168, 0.001007], [-0.0551, -0.07772, -0.000104]],
        [[0.0283, -0.78314, 0.010105], [0.0218, -0.65367, 0.012324], [-0.0123, -0.45085, -0.000634], [0.0044, -0.31908, 0.001056], [-0.0663, -0.1664, 0.00037]],
        [[0.0243, -1.01077, 0.01823], [0.0295, -0.80026, 0], [-0.0461, -0.6341, 0.000546], [-0.0677, -0.38049, -0.001826], [-0.0377, -0.29295, 0.00119]],
        [[-0.2252, -0.78323, -0.061196], [-0.013, -0.91709, 0], [-0.1185, -0.61723, -0.033334], [-0.0012, -0.57649, 0.000443], [-0.0076, -0.41111, 0.002478]]
      ],
      squeeze: [
        [[-0.005, -0.05588, -0.002282], [0.0047, -0.02293, -0.001722], [0.0004, -0.00724, -0.001118], [0.0002, -0.00094, -0.000475], [0.0193, -0.00284, 0]],
        [[-0.0214, -0.07794, -0.003437], [0.0083, -0.04412, -0.002215], [0.0077, -0.02106, -0.00138], [-0.0007, -0.00476, -0.000629], [-0.0006, -0.00257, -0.000156]],
        [[-0.0165, -0.13643, -0.004291], [0.0124, -0.08744, -0.002739], [0.0085, -0.04494, -0.002014], [0.0041, -0.01556, -0.0011], [0.002, -0.00532, -0.000388]],
        [[-0.0379, -0.16619, -0.004202], [-0.0001, -0.10615, -0.00325], [-0.0112, -0.0523, -0.00318], [0.0021, -0.02247, -0.001385], [-0.0104, -0.00262, -0.000674]],
        [[-0.045, -0.18067, -0.007237], [-0.0227, -0.13232, -0.003922], [-0.0112, -0.07787, -0.003144], [-0.0101, -0.03035, -0.001869], [-0.0051, -0.00944, -0.000846]],
        [[-0.0363, -0.25551, -0.007852], [-0.0171, -0.16744, -0.005067], [-0.0202, -0.10349, -0.003417], [-0.0083, -0.04675, -0.002391], [-0.0062, -0.01527, -0.001259]],
        [[-0.0846, -0.27449, -0.015175], [-0.0298, -0.20153, -0.007737], [-0.0134, -0.14039, -0.004845], [-0.0191, -0.05923, -0.003499], [-0.0131, -0.02463, -0.001836]],
        [[-0.0391, -0.44507, -0.010077], [-0.0405, -0.31248, -0.008091], [-0.0308, -0.22993, -0.006307], [-0.0349, -0.11602, -0.007091], [-0.0151, -0.06576, -0.003025]],
        [[-0.0114, -0.60162, -0.004293], [0.0016, -0.44865, -0.006138], [0.0196, -0.34001, -0.008478], [-0.018, -0.19356, -0.006683], [-0.0311, -0.08914, -0.006712]],
        [[0.0104, -0.73149, -0.003872], [-0.0017, -0.58158, -0.001831], [0.008, -0.46162, -0.002216], [-0.0295, -0.27757, -0.009552], [-0.0531, -0.14682, -0.008036]]
      ],
      biglittle: [
        [[0.0269, -0.09006, 0.000088], [0.0271, -0.04756, -0.000051], [0.0113, -0.02114, -0.000117], [0.0061, -0.00925, 0.000049], [0.0048, -0.0026, 0.000007]],
        [[0.043, -0.14865, 0.000549], [0.0431, -0.08027, -0.000426], [0.0338, -0.05086, 0.000128], [0.0158, -0.02139, 0.000028], [0.0026, -0.00637, -0.000031]],
        [[0.0618, -0.24695, 0.000698], [0.073, -0.16376, 0.000186], [0.0332, -0.10227, 0.000158], [0.0257, -0.04723, 0.000125], [0.0074, -0.01945, 0.00005]],
        [[0.0267, -0.26246, -0.000927], [0.0369, -0.17938, 0.000133], [0.032, -0.11895, 0.000121], [0.0172, -0.05611, 0.000074], [0.0058, -0.02192, 0.000062]],
        [[0.0415, -0.32593, -0.000076], [0.0673, -0.2549, 0.001509], [0.0366, -0.16239, 0.000353], [0.0209, -0.08529, 0.000451], [0.0121, -0.0349, 0.000027]],
        [[0.0465, -0.4187, 0.000651], [0.0665, -0.31841, 0.000913], [0.0416, -0.22283, 0.001313], [0.0165, -0.11055, -0.00005], [0.011, -0.05191, -0.000065]],
        [[0.0812, -0.55219, 0.006386], [0.0986, -0.41859, 0.003445], [0.0261, -0.2793, -0.000286], [0.0148, -0.16239, -0.000161], [0.0044, -0.07557, -0.000227]],
        [[0.125, -0.78639, 0.004517], [0.1425, -0.63688, 0.005152], [0.0717, -0.45766, 0.002603], [0.0479, -0.30147, -0.000205], [0.0466, -0.18574, 0.000351]],
        [[0.1275, -0.90632, 0], [0.1717, -0.8229, 0.005316], [0.1232, -0.6222, 0], [0.1014, -0.44404, 0.002446], [0.0987, -0.31083, 0.002008]],
        [[0.1324, -1.06789, 0], [0.1358, -0.91863, 0], [0.156, -0.80853, 0.005266], [0.1719, -0.62101, 0.008002], [0.0824, -0.42668, 0.004947]]
      ],
      lifts: [
        [[0.0006, -0.14707, -0.000349], [0.0125, -0.08596, -0.000323], [0.0088, -0.04761, -0.000114], [0.0058, -0.02063, -0.00004], [0.0049, -0.01037, -0.000029]],
        [[-0.0068, -0.17598, -0.000587], [-0.0021, -0.10568, -0.000116], [-0.0019, -0.05624, -0.000453], [0.0099, -0.03023, 0.000061], [0.0012, -0.01277, -0.000014]],
        [[-0.0292, -0.23584, -0.000723], [0.0114, -0.15529, -0.000154], [0.0029, -0.1041, 0.00008], [-0.0038, -0.03857, -0.000073], [-0.0002, -0.01458, -0.000069]],
        [[0.0008, -0.30221, 0.001441], [0.0083, -0.20724, 0.001057], [0.006, -0.12686, 0.000033], [-0.0171, -0.05421, 0.000043], [0.0019, -0.01898, 0.000025]],
        [[-0.0187, -0.32625, -0.001639], [-0.0344, -0.21545, -0.001258], [-0.0145, -0.14252, -0.000289], [-0.0114, -0.06443, -0.000001], [0.0006, -0.02709, 0.000108]],
        [[0.0164, -0.41127, 0.004388], [-0.007, -0.27106, -0.000346], [-0.0069, -0.17528, 0.000209], [-0.0012, -0.08623, -0.000053], [-0.0043, -0.03379, 0.0002]],
        [[-0.0438, -0.42719, 0.001228], [0.0065, -0.30638, 0.000594], [0.0145, -0.22377, 0.000605], [-0.024, -0.10918, -0.000192], [-0.0035, -0.04037, -0.000195]],
        [[-0.0319, -0.5675, 0.000826], [-0.0136, -0.41347, -0.002804], [0.0026, -0.33421, -0.00026], [-0.0028, -0.18379, -0.000657], [-0.0358, -0.08472, -0.000308]],
        [[-0.0418, -0.67115, -0.001924], [0.0157, -0.5701, -0.000835], [0.0305, -0.47571, 0.001855], [-0.0157, -0.28152, -0.001335], [-0.0308, -0.16408, -0.00034]],
        [[-0.0675, -0.79268, -0.024256], [0.0063, -0.69483, -0.00297], [0.0272, -0.56144, -0.002188], [0.0035, -0.39275, -0.003782], [0.0199, -0.29488, -0.000226]]
      ],
      slowmo: [
        [[-0.0018, -0.0625, -0.000047], [0.0047, -0.0287, -0.000101], [0.0005, -0.01402, 0.000039], [0.0034, -0.0045, 0.000048], [-0.0004, -0.00018, -0.000008]],
        [[-0.0201, -0.09264, -0.000229], [0.0048, -0.05258, -0.000061], [0.0059, -0.02802, -0.000006], [0.0048, -0.0093, -0.000005], [0.0008, -0.00344, 0.000002]],
        [[-0.0392, -0.13858, -0.000941], [0.0126, -0.09425, -0.000027], [0.0003, -0.05575, 0.000024], [0.0089, -0.02313, -0.000001], [-0.0002, -0.0082, 0.000026]],
        [[-0.0365, -0.18264, 0.000058], [-0.0168, -0.11897, -0.000249], [-0.0169, -0.0685, -0.000113], [-0.0018, -0.03483, 0.000135], [0.0002, -0.01043, -0.00003]],
        [[-0.0006, -0.24307, 0.000788], [-0.0211, -0.1536, 0.000234], [-0.0231, -0.09368, 0.000034], [-0.0011, -0.04373, 0.000094], [-0.003, -0.01473, -0.000078]],
        [[-0.0464, -0.26888, -0.001134], [-0.0596, -0.17155, -0.000974], [-0.0063, -0.1336, 0.000266], [-0.0167, -0.05521, -0.00027], [-0.0042, -0.02594, 0.000065]],
        [[-0.0212, -0.33946, 0.001183], [-0.034, -0.23361, -0.001148], [-0.0276, -0.16265, 0.000165], [-0.0196, -0.07622, -0.000075], [-0.0031, -0.03463, -0.000067]],
        [[-0.0463, -0.42065, -0.004446], [0.0232, -0.37677, 0.003135], [-0.0254, -0.24464, 0.000359], [-0.027, -0.14143, 0.000195], [-0.0273, -0.07149, 0.0001]],
        [[-0.074, -0.51712, -0.011098], [0.0151, -0.464, -0.000012], [-0.0467, -0.32819, -0.003855], [-0.002, -0.23723, 0.000769], [-0.0278, -0.11841, -0.000659]],
        [[-0.0298, -0.70153, -0.000464], [0.0324, -0.66213, 0.008932], [-0.023, -0.4837, -0.00362], [0.0513, -0.39333, 0.005265], [-0.0267, -0.21988, 0.000521]]
      ]
    }
  }; // engine v15, 2000 attempts per cell, 2026-11-26
  // @@END@@

  // ---------------------------------------------------------------- courses
  function config(R, g) {
    const [di, L, over] = GRADES[g], C = E.levelConfig(di, L), T = R.t || {};
    if (over) {
      const f = 1 + OVER.speed * over;
      C.hoopW -= OVER.w * over; C.speed *= f; C.spacing *= f; C.firstX *= f; // quicker, and the rings spread with it
      C.moveAmp += OVER.amp * over; C.tiltMax += OVER.tilt * over; C.tiltP = Math.min(1, C.tiltP + OVER.tiltP * over); C.dy += OVER.dy * over;
    }
    if (T.moveScale != null) C.moveP *= T.moveScale;
    if (T.movePMin != null) C.moveP = Math.max(C.moveP, T.movePMin);
    if (T.moveP != null) C.moveP = T.moveP;
    if (T.moveAmpAdd) C.moveAmp += T.moveAmpAdd;
    if (T.moveAmpMin != null) C.moveAmp = Math.max(C.moveAmp, T.moveAmpMin);
    if (T.slow) C.periodBase *= T.slow;            // rings take longer over each bob
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
      if (R.sync) { amp = C.moveAmp * 0.9; period = C.periodBase; phase = (wPhase + i * R.sync) % 1; } // one rhythm, each ring a beat behind
      else if (r2 < C.moveP) { amp = C.moveAmp * (0.75 + 0.25 * r3); period = C.periodBase * (0.85 + 0.3 * r4); phase = r5; }
      let y;
      if (R.shape === 'zigzag') y = i % 2 ? E.Y_MIN + 10 + r1 * 40 : E.Y_MAX - 10 - r1 * 40;
      else if (R.shape === 'wave') y = mid + half * 0.8 * E.wave(wPhase + i / wLen) + (r1 * 2 - 1) * 14;
      else if (R.shape === 'stairs') y = E.Y_MAX - 18 - (i % 4) * 82 - r1 * 14; // low, then three steps up, then back down
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
      let w = C.hoopW;
      if (R.width === 'squeeze') w = Math.round((C.hoopW + Math.max(-14, 12 - 2.2 * i)) * 10) / 10; // wide at first, then tighter than Needle
      else if (R.width === 'alt') w = Math.round((C.hoopW + (i % 2 ? -13 : 16)) * 10) / 10;
      if (w < W_MIN) w = W_MIN;
      hoops.push({ i, x, y0: y, w, amp, period, phase, tilt, c: E.dcos(tilt), s: E.dsin(tilt), cp: i === n - 1 });
      prevY = y;
    }
    // the time limit grows with the course: a slow player needs up to about 2.4 s a ring (rim knocks hold the ball back)
    return { seed: String(seed), di: GRADES[g][0], L: 0, special: R.id, grade: g, speed: C.speed, startY: START_Y, hoops, endX: x + C.spacing, maxTicks: E.TICK_HZ * Math.max(45, 20 + 3 * n) };
  }

  // what a grade's rings are, in words ("Hard level 4 rings", "Hard level 8 rings, tighter and quicker")
  function gradeText(g) {
    const G = GRADES[g];
    return G ? `${E.DIFFS[G[0]].name} level ${G[1]} rings` + (G[2] ? ', tighter and quicker' + (G[2] > 1 ? ' still' : '') : '') : '';
  }

  // ---------------------------------------------------------------- the day's three
  // Every twist comes up once in a cycle of RECIPES.length / 3 days (four, with twelve twists), in an order shuffled
  // for each cycle; the slots (2x, 3x, 5x) take them in turn. No twist comes up two days running: where a cycle's
  // first day would repeat one from the day before (the last day of the cycle before, which is never changed, so
  // this needs no look further back), that twist swaps with one from the cycle's middle days.
  const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
  const dayStart = (day) => Date.parse(String(day).slice(0, 10) + 'T00:00:00Z');
  const closesAt = (day) => dayStart(day) + DAY_MS;
  const EPOCH = Date.UTC(2026, 0, 5);
  const CYCLE = Math.floor(RECIPES.length / PER_DAY); // days
  function shuffled(cycle) {
    const a = RECIPES.slice(), r = E.makeRng('specialcycle|' + cycle);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function order(cycle) {
    const a = shuffled(cycle), before = shuffled(cycle - 1).slice((CYCLE - 1) * PER_DAY, CYCLE * PER_DAY);
    for (let i = 0; i < PER_DAY; i++) {
      if (!before.includes(a[i])) continue;
      for (let j = PER_DAY; j < (CYCLE - 1) * PER_DAY; j++) if (!before.includes(a[j])) { const t = a[i]; a[i] = a[j]; a[j] = t; break; }
    }
    return a;
  }
  function specialsFor(day) {
    const k = Math.floor((dayStart(day) - EPOCH) / DAY_MS), pos = ((k % CYCLE) + CYCLE) % CYCLE;
    const a = order(Math.floor(k / CYCLE));
    return SLOTS.map((x, slot) => ({ slot, x, recipe: a[pos * PER_DAY + slot] }));
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
  // where a special's level starts: START, or more if regular runs (the middle of their rating) or the player's level
  // in another special (less SLOT_MARGIN) show more. It leans high: starting a player too high costs them a few misses
  // while their level comes down; starting a strong one too low hands them wins while it climbs.
  function startFor(Rt, slot) {
    let d = START;
    if (Rt && Rt.r) d = Math.max(d, regular(Rt).m);
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
    D_MIN, D_MAX, PRIOR_MU, PRIOR_SD, START, DOWN, SLOT_MARGIN, UNLOCK, TABLES,
    config, generate, gradeText, dayKey, dayStart, closesAt, specialsFor, CYCLE, PER_DAY, W_MIN,
    blank, addLevel, regular, startFor, levelOf, addSpecial, up, levelName, rating, courseFor, todayFor, missReg, clearP
  };
});
