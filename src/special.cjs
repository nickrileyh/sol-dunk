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
    { id: 'slowmo', name: 'Slow motion', blurb: 'A slower ball through tight rings', t: { fast: 0.78, narrow: 9, moveScale: 0.5 } },
    // Three with something the regular game doesn't have (the owner asked for extra features like a wall, but not too
    // much): walls to fly over between the rings. Touching one ends the attempt, like the floor. ob picks the
    // layout from WALLS; see walls() below for where they stand.
    { id: 'walls', name: 'The wall', blurb: 'Fly over a wall between rings', t: { moveScale: 0.5 }, ob: 'wall' },
    { id: 'hurdles', name: 'Hurdles', blurb: 'A quicker ball and low walls', t: { fast: 1.2, moveScale: 0.5 }, ob: 'low' },
    { id: 'fortress', name: 'The fortress', blurb: 'Walls, and every ring moves', t: { moveP: 1, moveAmpMin: 30 }, ob: 'wall' },
    // Three with rings the regular game doesn't have (engine v17; the owner asked for more special features, like
    // vertical rings, and much more interesting levels): rings that stand on their side, to be flown straight through
    // like a gate, and rings that breathe wider and tighter. fx marks them: like the walls, they take turns opening one
    // prize a day, so the day's rotation of the twelve ring twists is unchanged.
    { id: 'side', name: 'Side doors', blurb: 'Every ring stands on its side: fly straight through', t: {}, upright: 'all', fx: true },
    { id: 'switch', name: 'Switchback', blurb: 'A flat ring, then one on its side', t: { moveScale: 0.5 }, upright: 'alt', fx: true },
    { id: 'pulse', name: 'Heartbeat', blurb: 'Every ring breathes wider and tighter', t: { moveScale: 0.5 }, pulse: true, fx: true },
    // Five new ways to set out the rings (the owner asked for more specials, more unique than these: "all sideways
    // rings super close together ... just be creative"). They use rings the game already has, so the engine plays
    // them as it is; lay picks the layout (LAYS below). Like the walls and the new rings, they take turns opening a
    // prize each day.
    { id: 'rush', name: 'Gate rush', blurb: 'Doors packed close together: thread every one', t: { moveScale: 0.4 }, lay: 'rush' },
    { id: 'hop', name: 'Bunny hop', blurb: 'Rings close together: hop, drop, hop, drop', t: { moveScale: 0.4 }, lay: 'hop' },
    { id: 'falls', name: 'Waterfall', blurb: 'Three rings down one falling line: drop through all three', t: { moveP: 0 }, lay: 'fall' },
    { id: 'high', name: 'High wire', blurb: 'Every ring up high, tall walls between: don\'t dip', t: { moveScale: 0.4 }, lay: 'high' },
    { id: 'mix', name: 'Obstacle course', blurb: 'Something different at every ring', t: { moveScale: 0.5 }, lay: 'mix' }
  ];
  // an upright ring is this much wider than a flat one of its grade (a gate has to be met at the right height while
  // the ball rises and falls, where a flat ring is met as it comes down); a breathing ring breathes PULSE.w either
  // side of its width, over PULSE.p seconds, never tighter than W_MIN
  const GATE_W = 18, GATE_TAPER = 1.2, PULSE = { w: [9, 14], p: [1.6, 2.4] };
  const PER_DAY = 3;
  const PER_SLOT = 5;        // a prize has this many specials a day: clear one and the next takes its place
  const BY = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
  const PLAIN = RECIPES.filter((r) => !r.ob && !r.fx && !r.lay), OBST = RECIPES.filter((r) => r.ob), FX = RECIPES.filter((r) => r.fx), LAY = RECIPES.filter((r) => r.lay);
  // Walls: how thick; and for each layout, where in the gap between two rings each wall stands (a range, as a share
  // of the gap) and how far above the line from one ring to the next its top is (a range; below the line if negative)
  const WALL_W = 18, WALL_PAD = 8, WALL_TOP = 120, WALL_REACT = 0.2, WALL_DIVE = 90;
  const WALLS = { wall: { at: [[0.52, 0.6]], up: [6, 38] }, low: { at: [[0.5, 0.58]], up: [-6, 24] }, some: { at: [[0.5, 0.58]], up: [0, 28], only: true }, tall: { at: [[0.32, 0.42]], up: [20, 45] } };
  // The new layouts (lay in a recipe):
  //   rush  every ring a door, at half the usual gap, each a little higher or lower than the last; the doors start
  //         wider than other doors and narrow faster grade by grade (doors this close are easy to string together at
  //         one height: with the usual taper, the hardest course paid a player a little past a pro 163% at 5×)
  //   hop   flat rings packed close at about the same height: a hop for each one
  //   fall  rings in threes down one falling line, so a drop through the first carries on through the other two
  //   high  every ring in the top band, with a tall wall early in every gap: no dipping between them (a wall any
  //         later leaves too little room to come down into the next ring at the slower grades)
  //   mix   something different at every ring (never the same twice running): a plain ring, a door, a ring that
  //         breathes, one on a lift, a tight one, or one with a wall in front of it
  // gap: the gap between rings as a share of the grade's; drift: how far a ring's height may step from the last;
  // wide0 and taper: a door this much wider at the first grade, and narrowing this much more a grade than others;
  // group: rings in groups this big, where every ring after the first hangs off the one before it (dx forward and dy
  // down from it, still, level and wide more units wider; dx is at Easy level 1's speed, and grows with the grade's).
  // A ball falls 80 to 100 units in about the time it moves 30 forward, so a fall's rings sit almost one under the
  // other. band: ring heights drawn in this band (from the top) instead of stepping from the last. (Tried and
  // dropped: a door with a hoop just past it and below it, a trapdoor. The hoop is only reachable from a door passed
  // at the top of a hop, which even the simulator's best player managed less than half the time.)
  const LAYS = {
    rush: { gap: 0.5, drift: 38, wide0: 6, taper: 1.6 },
    hop: { gap: 0.55, drift: 26 },
    fall: { group: 3, dx: [28, 40], dy: [80, 100], wide: 16 },
    high: { band: 60 },
    mix: { kinds: 6 }
  };
  const MIX = { PLAIN: 0, DOOR: 1, BREATHE: 2, LIFT: 3, TIGHT: 4, WALL: 5 };

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
  // Stakes (the owner asked for the challenges to be multipliers of a stake the player picks): the prize is the stake
  // times the special's multiple. Each stake keeps its own level at each prize, so every amount is the fixed-entry
  // staircase above and the same 90% holds at each; what happens at one stake never moves another's level, so losing
  // on purpose at a small stake can't make a big stake's course easier, and waiting for a stake's level to be low
  // doesn't help (it only moves when that stake is played). A stake's level starts where the player's levels already
  // are: the highest at that prize at any stake, or at another prize less SLOT_MARGIN, never lower than START. A stake
  // opens once the player's regular-run bets reach UNLOCK of it (UNLOCK entries for the smaller ones), as the specials
  // open at UNLOCK entries. (Tried first and dropped: one level per prize, moved by stake ÷ the biggest stake played,
  // with stakes rising a quarter at a time. A player who staked big only while their level sat low got back up to
  // 140%: sim/stakes.cjs.)
  // MAX_STAKE: the most a player can stake by default (the server's SPECIAL_MAX_STAKE_LAMPORTS). A strong player who
  // hides their skill in regular runs starts a new stake at START and wins more than 90% while that stake's level climbs
  // to them (sim/stakes.cjs), so that head start grows with the stake; raise it once accounts are verified.
  const STAKES = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1], MAX_STAKE = 0.2;

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
      ],
      walls: [
        [[0.0717, -0.16316, 0.000253], [0.0561, -0.08711, -0.000173], [0.0373, -0.05082, -0.000146], [0.0254, -0.02697, 0.000101], [0.0151, -0.0119, 0.000116]],
        [[0.0713, -0.19841, 0.000494], [0.0563, -0.11629, -0.000051], [0.0422, -0.06788, 0.000171], [0.0276, -0.03487, 0.000187], [0.0104, -0.01089, -0.000063]],
        [[0.0563, -0.26177, -0.000156], [0.0357, -0.15949, -0.000576], [0.0452, -0.10164, -0.000078], [0.0201, -0.04379, 0.000028], [0.0129, -0.01877, 0.000125]],
        [[0.0464, -0.302, 0.002105], [0.0323, -0.18395, 0.000657], [0.0141, -0.1087, -0.000072], [0.0016, -0.04903, 0.000188], [0.0011, -0.01513, 0.000032]],
        [[0.0281, -0.32809, -0.000016], [0.029, -0.20477, -0.000124], [-0.0073, -0.13074, -0.000395], [0.0043, -0.06531, 0.000161], [-0.0011, -0.02079, -0.000009]],
        [[0.0162, -0.36452, -0.003331], [0.0157, -0.26046, -0.00018], [-0.0109, -0.17113, 0.000229], [-0.0055, -0.07725, -0.000148], [-0.0073, -0.02846, -0.000074]],
        [[0.0171, -0.4261, -0.002548], [0.0252, -0.31967, 0.000021], [0.0078, -0.2162, 0.000381], [0.0045, -0.11615, 0.000111], [-0.0219, -0.0483, 0.000088]],
        [[-0.0431, -0.55835, -0.007409], [0.0087, -0.4275, -0.002755], [-0.0322, -0.2932, -0.003134], [-0.0179, -0.19107, 0.000038], [-0.0266, -0.10292, 0.000421]],
        [[0.0181, -0.6994, -0.003618], [0.0464, -0.58033, -0.00199], [-0.0332, -0.40301, -0.00126], [0.0156, -0.29966, 0.000748], [-0.0368, -0.1595, 0.000143]],
        [[0.0451, -0.90642, 0.015525], [0.0345, -0.70913, -0.006993], [0.022, -0.5692, -0.000322], [0.0043, -0.41651, 0.003382], [-0.0449, -0.24495, -0.000681]]
      ],
      hurdles: [
        [[0.0431, -0.19686, -0.000236], [0.0511, -0.12161, -0.000071], [0.0387, -0.07326, 0.00001], [0.0255, -0.03072, -0.00007], [0.0118, -0.01277, 0.000064]],
        [[0.0342, -0.25339, 0.001038], [0.0502, -0.15684, 0.000298], [0.03, -0.0931, 0.000036], [0.0243, -0.04316, 0.000184], [0.0077, -0.01356, -0.000022]],
        [[-0.0243, -0.31034, -0.001848], [0.0195, -0.22652, 0.000685], [0.0239, -0.14848, 0.000433], [0.0199, -0.06831, -0.000028], [0.007, -0.02429, 0.000012]],
        [[0.0144, -0.32788, -0.005324], [0.029, -0.24187, -0.000028], [0.0177, -0.16028, 0.000062], [-0.0049, -0.07158, -0.000073], [0.0009, -0.02553, -0.000014]],
        [[0.039, -0.41408, 0.000002], [0.0421, -0.29366, -0.000256], [0.0162, -0.19778, 0.000471], [0.0123, -0.1029, 0.000054], [-0.0175, -0.04083, 0.000034]],
        [[0.0062, -0.44416, -0.009178], [0.0195, -0.34082, 0.000227], [0.0006, -0.23621, -0.000887], [-0.0208, -0.12326, -0.000382], [-0.0268, -0.05216, -0.000324]],
        [[-0.0114, -0.52819, 0.000267], [-0.022, -0.38557, -0.004521], [0.0258, -0.32184, 0.000501], [-0.0379, -0.15988, -0.000645], [-0.028, -0.08342, -0.00021]],
        [[0.0662, -0.73944, 0.002499], [0.0139, -0.5129, -0.011668], [-0.0028, -0.40602, -0.000454], [-0.0072, -0.27567, -0.000232], [-0.031, -0.16258, 0.000269]],
        [[0.1384, -0.9396, 0.015988], [0.047, -0.63795, -0.013096], [0.0139, -0.54792, -0.000513], [0.0206, -0.39648, 0.001427], [-0.0704, -0.21395, -0.001827]],
        [[0.097, -1.03665, 0], [0.0661, -0.85754, -0.003427], [-0.0509, -0.62062, -0.016666], [-0.0316, -0.5155, -0.000011], [-0.1075, -0.32396, -0.006322]]
      ],
      fortress: [
        [[0.0564, -0.20218, 0.000102], [0.0656, -0.12611, 0.000152], [0.049, -0.07555, 0.000102], [0.0205, -0.03393, 0.000036], [0.0066, -0.01342, -0.000042]],
        [[0.0521, -0.24104, -0.000624], [0.0674, -0.15652, 0.000474], [0.0332, -0.08811, -0.000108], [0.0217, -0.04098, -0.000049], [0.0054, -0.01804, 0.000051]],
        [[0.0264, -0.33932, -0.000132], [0.0614, -0.22467, -0.000192], [0.0189, -0.14241, -0.000539], [0.0207, -0.06633, -0.000113], [0.0083, -0.02538, -0.000001]],
        [[0.0138, -0.38416, 0.000286], [0.0224, -0.24159, -0.000157], [-0.0011, -0.16086, -0.000092], [-0.0065, -0.07455, -0.000053], [-0.0094, -0.02509, -0.000058]],
        [[0.005, -0.42708, -0.003085], [-0.0054, -0.29167, -0.000082], [-0.0116, -0.19608, 0.000026], [-0.0201, -0.09261, -0.000088], [-0.0135, -0.03499, -0.000199]],
        [[-0.0203, -0.47055, -0.00558], [0.0303, -0.36674, -0.000681], [-0.0238, -0.23429, -0.00091], [-0.0243, -0.12743, -0.000049], [-0.0244, -0.05484, -0.000213]],
        [[0.0006, -0.5765, 0.000535], [-0.0282, -0.39057, -0.003633], [0.0203, -0.33299, 0.003537], [-0.0199, -0.17302, 0.000158], [-0.0328, -0.07428, -0.00022]],
        [[-0.03, -0.72197, -0.004865], [0.0371, -0.66971, 0.01075], [-0.0243, -0.46063, 0.000596], [-0.0319, -0.28034, 0.001102], [-0.0556, -0.15658, 0.000014]],
        [[0.0016, -0.94403, 0.008109], [-0.0471, -0.71323, -0.003463], [-0.0486, -0.5504, -0.007142], [-0.0353, -0.41656, 0.001549], [-0.0589, -0.24002, -0.001218]],
        [[-0.0324, -1.05132, -0.001951], [0.0974, -1.01266, 0.016769], [-0.0973, -0.6979, -0.006772], [-0.1028, -0.46205, -0.01016], [-0.0539, -0.38518, 0.00033]]
      ],
      side: [
        [[-0.0652, -0.26825, -0.000346], [-0.0271, -0.1464, 0.00041], [-0.0311, -0.06826, 0.000095], [-0.0127, -0.01913, -0.000028], [-0.0001, -0.00277, -0.000025]],
        [[-0.0909, -0.32383, 0.002207], [-0.0698, -0.15412, -0.000589], [-0.0351, -0.08331, -0.000097], [-0.0079, -0.02598, -0.000067], [0.0006, -0.00557, 0.000047]],
        [[-0.0821, -0.3975, 0.002736], [-0.046, -0.21425, -0.000403], [-0.0393, -0.1092, -0.000029], [-0.0134, -0.03585, -0.00016], [-0.0042, -0.00875, 0.000049]],
        [[0.1249, -0.48095, 0.004793], [0.055, -0.26348, -0.000352], [0.0479, -0.15005, 0.000288], [0.001, -0.05283, 0.000005], [-0.0074, -0.01559, 0.000103]],
        [[0.095, -0.509, 0.001963], [0.0414, -0.28088, -0.001538], [0.0286, -0.17684, 0.000499], [0.0067, -0.06906, 0.00022], [-0.014, -0.02057, 0.000083]],
        [[0.0555, -0.56409, -0.000499], [0.0485, -0.34851, -0.000149], [0.0265, -0.2031, -0.000124], [-0.0032, -0.09147, 0.000451], [-0.0177, -0.02279, -0.000171]],
        [[0.0599, -0.65024, 0.002542], [0.0797, -0.40255, 0.001053], [0.0537, -0.27803, 0.002835], [-0.0071, -0.10605, -0.000208], [-0.0168, -0.03771, -0.000001]],
        [[0.018, -0.76318, 0.000895], [0.1049, -0.57189, 0.00394], [0.0236, -0.3471, 0.001177], [0.0092, -0.17735, 0.00044], [-0.008, -0.0693, 0.000125]],
        [[-0.0526, -0.88572, -0.018894], [0.1019, -0.74404, 0.009687], [0.0019, -0.46521, -0.003343], [-0.0154, -0.25313, -0.000049], [-0.0376, -0.11688, 0.000111]],
        [[-0.0145, -1.15616, 0], [0.1065, -0.93357, 0.006259], [0.0329, -0.70843, 0.000946], [-0.0405, -0.40757, 0.001925], [-0.0781, -0.19173, -0.00066]]
      ],
      switch: [
        [[0.0675, -0.17054, -0.000163], [0.0581, -0.09529, 0.000191], [0.0275, -0.04262, 0.000042], [0.0133, -0.01447, 0.000076], [0.0018, -0.0028, 0.000044]],
        [[0.0642, -0.22316, 0.00087], [0.0495, -0.11022, -0.00004], [0.0231, -0.05934, 0.000197], [0.0046, -0.01824, -0.000024], [0.0023, -0.00337, -0.000008]],
        [[0.0252, -0.26185, -0.000816], [0.0272, -0.1577, 0.000191], [0.0057, -0.0807, 0.000046], [0.0068, -0.0295, 0.000005], [-0.0004, -0.00585, -0.000024]],
        [[0.0937, -0.36399, 0.0041], [0.0286, -0.19585, 0.000332], [-0.0017, -0.10425, -0.000081], [0.0003, -0.04211, 0.00016], [-0.0063, -0.00964, -0.000042]],
        [[0.1033, -0.41685, 0.004114], [0.0198, -0.23434, 0.001026], [-0.0024, -0.12683, -0.000081], [-0.0086, -0.05299, -0.000017], [-0.0107, -0.01398, -0.000085]],
        [[0.1033, -0.46522, 0.004362], [0.0351, -0.26315, 0.001019], [-0.0207, -0.15856, -0.000178], [-0.0094, -0.07194, 0.000031], [-0.0109, -0.02108, -0.000102]],
        [[0.1332, -0.55308, 0.008601], [0.0394, -0.3181, -0.000541], [-0.0014, -0.20499, 0.00069], [-0.0203, -0.09078, -0.000058], [-0.0147, -0.03645, 0.000058]],
        [[0.0883, -0.64719, 0.002304], [-0.0065, -0.41233, -0.001306], [-0.0327, -0.28325, -0.000107], [-0.0536, -0.15925, 0.000422], [-0.0465, -0.06944, -0.000044]],
        [[0.1153, -0.83062, 0.016528], [-0.0325, -0.48501, -0.009981], [-0.013, -0.39867, 0.000273], [-0.0532, -0.23699, 0.001068], [-0.0716, -0.11276, -0.000146]],
        [[0.0707, -0.9322, 0], [0.0388, -0.71389, 0.002819], [-0.0663, -0.48156, -0.00517], [-0.0463, -0.33175, -0.000962], [-0.074, -0.19191, 0.000099]]
      ],
      pulse: [
        [[-0.0148, -0.08631, 0.000228], [0.0172, -0.0431, -0.000083], [0.0064, -0.02126, 0.000023], [0.0035, -0.00545, -0.000002], [0.0003, -0.0009, 0]],
        [[-0.0263, -0.1142, -0.000227], [0.0098, -0.06777, -0.000053], [0.0039, -0.03349, -0.000067], [0.0077, -0.01422, 0.000093], [0.0034, -0.00439, 0.000024]],
        [[-0.0207, -0.20191, 0.000495], [0.0055, -0.12125, -0.000127], [-0.0017, -0.0686, 0.000015], [0.0101, -0.02879, 0.00005], [0.0009, -0.00844, -0.000024]],
        [[-0.0081, -0.23406, 0.000101], [-0.0067, -0.15502, 0.000237], [-0.008, -0.09693, 0.000384], [-0.0144, -0.03487, 0.000033], [-0.0055, -0.01192, 0.000014]],
        [[-0.0056, -0.29129, 0.00178], [-0.017, -0.17369, -0.001153], [0.004, -0.12556, 0.000299], [-0.0149, -0.05291, 0.000111], [-0.0125, -0.01551, -0.000089]],
        [[-0.0375, -0.30735, -0.00319], [0.0194, -0.24433, 0.000663], [-0.0153, -0.14881, -0.000327], [-0.0096, -0.07552, 0.000019], [-0.0105, -0.03271, 0.000109]],
        [[-0.0688, -0.35912, -0.005071], [0.0094, -0.28908, 0.000718], [0.0105, -0.20798, 0.001025], [-0.0233, -0.10192, -0.000166], [-0.0237, -0.04464, -0.000101]],
        [[-0.0203, -0.55175, 0.005513], [-0.021, -0.39812, -0.002143], [-0.0104, -0.31712, -0.000515], [-0.0242, -0.18364, 0.000185], [-0.0337, -0.10448, 0.000228]],
        [[0.0298, -0.74787, 0.010994], [-0.0351, -0.51936, -0.002467], [-0.001, -0.4221, 0.000321], [-0.024, -0.27458, -0.000736], [-0.044, -0.15358, -0.000701]],
        [[-0.0823, -0.73457, -0.019403], [-0.0535, -0.65228, 0], [0.0045, -0.58649, 0.005767], [-0.0089, -0.42144, 0.005565], [-0.0367, -0.24567, -0.000615]]
      ],
      rush: [
        [[-0.0913, -0.18769, -0.000765], [-0.0723, -0.08857, -0.00023], [-0.0452, -0.04042, -0.000134], [-0.0141, -0.0116, 0.000014], [-0.0016, -0.00126, -0.000018]],
        [[-0.0901, -0.24696, -0.000973], [-0.0588, -0.13232, 0.000182], [-0.0445, -0.05836, 0.000097], [-0.0189, -0.01898, 0.000019], [-0.0047, -0.0028, -0.000008]],
        [[-0.1285, -0.30476, -0.000083], [-0.0616, -0.15813, -0.000391], [-0.0569, -0.08734, 0.000097], [-0.0112, -0.02969, 0.000101], [-0.0061, -0.00499, 0.000017]],
        [[0.0582, -0.37119, 0.003229], [0.0265, -0.19803, -0.00036], [0.0347, -0.11915, 0.000596], [0.0009, -0.03876, 0.000068], [-0.0075, -0.00874, -0.000022]],
        [[0.0214, -0.38761, -0.005345], [0.0643, -0.27701, 0.001813], [0.0179, -0.13645, 0.00036], [-0.0023, -0.05461, 0.000103], [-0.0226, -0.01361, -0.000038]],
        [[0.0356, -0.47426, 0.000367], [0.0529, -0.3138, 0.000826], [0.0036, -0.17913, 0.000146], [-0.0008, -0.07134, 0.000017], [-0.0187, -0.0215, 0.000042]],
        [[0.0021, -0.54502, -0.001091], [0.0655, -0.36419, 0.000088], [0.0148, -0.21665, -0.000209], [-0.0128, -0.09862, 0.000167], [-0.0223, -0.0359, 0.000177]],
        [[-0.0442, -0.60182, -0.024124], [0.0354, -0.47837, -0.001074], [0.004, -0.30235, -0.000576], [-0.0086, -0.15253, -0.000037], [-0.0254, -0.05859, -0.00009]],
        [[0.0947, -1.04797, 0.019618], [0.0787, -0.72229, 0.000907], [-0.0321, -0.42724, -0.012013], [-0.002, -0.27554, 0.001069], [-0.0369, -0.12746, 0.000277]],
        [[-0.0536, -1.24431, 0], [0.1071, -1.08485, 0.021799], [-0.0353, -0.70081, -0.005697], [-0.1008, -0.42264, -0.00724], [-0.0776, -0.25908, -0.00003]]
      ],
      hop: [
        [[-0.0141, -0.08291, -0.000128], [0.007, -0.04082, -0.000065], [0.0022, -0.0184, -0.000009], [0.0042, -0.00523, 0.000044], [-0.0013, -0.00012, -0.000014]],
        [[-0.0195, -0.11405, -0.000294], [0.0065, -0.06641, -0.000003], [0.006, -0.03356, -0.000098], [0.006, -0.01222, 0.000045], [0.0009, -0.00285, -0.000006]],
        [[-0.0184, -0.1886, -0.000458], [-0.0146, -0.11561, -0.000414], [0.0166, -0.07853, 0.000183], [0.0096, -0.02865, -0.000118], [0.0008, -0.00869, 0.000002]],
        [[0.0409, -0.27663, 0.000445], [0.0462, -0.19654, -0.000436], [0.0457, -0.14484, 0.000324], [0.0467, -0.07786, -0.000079], [0.0208, -0.02833, -0.000063]],
        [[0.0349, -0.33641, 0.001207], [0.0558, -0.23502, -0.000582], [0.0689, -0.19081, 0.000189], [0.0674, -0.12032, 0.000344], [0.0299, -0.05259, 0.000161]],
        [[0.0505, -0.37629, -0.000977], [0.0821, -0.29981, -0.000362], [0.0515, -0.21151, -0.000503], [0.0618, -0.14289, -0.000425], [0.0376, -0.0676, -0.000442]],
        [[0.0755, -0.47528, 0.003746], [0.0866, -0.35973, 0.000447], [0.0986, -0.29656, 0.000852], [0.0845, -0.18043, -0.000666], [0.064, -0.1138, -0.000108]],
        [[0.0284, -0.55799, 0.000056], [0.1192, -0.49875, 0.000067], [0.1258, -0.40503, -0.000277], [0.1099, -0.29062, -0.00234], [0.1055, -0.20435, -0.000519]],
        [[0.0074, -0.70357, 0.000256], [0.0954, -0.58142, -0.005732], [0.1128, -0.50048, -0.00257], [0.1826, -0.4357, 0.001267], [0.1512, -0.32715, -0.000436]],
        [[0.0442, -0.82827, 0], [0.1107, -0.77841, 0.007162], [0.1808, -0.71468, 0.009259], [0.192, -0.58357, -0.004775], [0.2236, -0.48497, 0.001111]]
      ],
      falls: [
        [[0.0242, -0.11271, 0.000261], [0.05, -0.08124, 0.000342], [0.0398, -0.05295, 0.00025], [0.023, -0.02493, 0.000058], [0.0064, -0.0079, 0.000012]],
        [[0.023, -0.14002, 0.000915], [0.0534, -0.096, 0.000652], [0.0354, -0.059, 0.000313], [0.0254, -0.02821, 0.000178], [0.0099, -0.01034, 0.000082]],
        [[-0.0134, -0.16026, 0.000916], [0.0169, -0.10468, 0.00032], [0.0179, -0.06945, 0.000223], [0.0278, -0.03723, 0.000169], [0.0108, -0.01324, -0.000023]],
        [[-0.0424, -0.17712, 0.000711], [-0.0167, -0.12929, 0.000109], [-0.0016, -0.09498, 0.000373], [0.0285, -0.06767, 0.000763], [0.0326, -0.04292, 0.000781]],
        [[-0.0537, -0.19794, 0.000403], [-0.034, -0.13817, -0.000041], [0.0027, -0.11135, 0.000673], [0.0163, -0.0711, 0.000783], [0.0278, -0.04837, 0.000874]],
        [[-0.063, -0.22166, -0.000199], [-0.0518, -0.15212, -0.00016], [-0.0136, -0.12898, 0.000743], [-0.009, -0.07581, 0.000533], [0.0073, -0.04987, 0.000721]],
        [[-0.0831, -0.23339, 0.000201], [-0.0659, -0.17265, 0.000525], [-0.041, -0.13726, 0.000388], [-0.0198, -0.09161, 0.000914], [0.0093, -0.06466, 0.000998]],
        [[-0.1866, -0.26014, -0.001121], [-0.0804, -0.22354, 0.00118], [-0.0936, -0.16567, 0.000422], [-0.0528, -0.11728, 0.000864], [0.0018, -0.09222, 0.001217]],
        [[-0.2926, -0.28023, -0.007093], [-0.1087, -0.30764, 0.002121], [-0.1488, -0.24509, 0.000175], [-0.0985, -0.19423, 0.00093], [-0.0429, -0.16053, 0.001558]],
        [[-0.2921, -0.39133, -0.006475], [-0.1615, -0.39508, 0.002972], [-0.1606, -0.34181, -0.003298], [-0.1096, -0.27756, -0.000731], [-0.0796, -0.24973, 0.000411]]
      ],
      high: [
        [[0.0487, -0.13591, -0.000602], [0.0456, -0.08363, -0.000112], [0.0323, -0.05042, -0.000071], [0.0219, -0.02543, -0.000021], [0.0085, -0.01011, 0.000021]],
        [[0.0621, -0.17638, -0.000288], [0.0452, -0.1007, -0.000293], [0.0407, -0.06741, 0.000115], [0.0231, -0.0293, -0.0001], [0.0109, -0.01211, 0.000008]],
        [[0.0581, -0.24271, -0.000663], [0.0578, -0.15568, -0.00049], [0.0491, -0.1026, 0.000091], [0.0281, -0.04718, -0.00002], [0.0129, -0.01809, 0.000055]],
        [[0.0166, -0.25085, -0.000846], [0.037, -0.16923, -0.000052], [0.0195, -0.10717, 0.000046], [0.006, -0.04754, 0.000047], [0.0043, -0.01314, -0.000016]],
        [[0.017, -0.30782, 0.000903], [0.0347, -0.20159, -0.001008], [0.0239, -0.13408, 0.000229], [0.0031, -0.05834, -0.000023], [0.0049, -0.02119, -0.000028]],
        [[0.0579, -0.39209, 0.002091], [0.0465, -0.26604, 0.000885], [0.0092, -0.16482, -0.000021], [-0.0019, -0.08181, -0.000172], [0.0024, -0.03412, -0.00002]],
        [[0.0441, -0.45205, 0.005123], [0.0311, -0.30233, 0.00005], [0.005, -0.20737, -0.000121], [0.0091, -0.10461, -0.00051], [0.0025, -0.05106, 0.000075]],
        [[-0.0082, -0.55093, -0.000532], [0.0028, -0.40376, -0.002923], [0.031, -0.34566, 0.002815], [0.0241, -0.19598, 0.000477], [-0.0024, -0.09715, -0.00014]],
        [[-0.0195, -0.65454, -0.000847], [0.0737, -0.60083, 0.009966], [0.0156, -0.44138, 0.003835], [-0.0349, -0.26392, -0.001445], [-0.0447, -0.14868, -0.000481]],
        [[0.0481, -0.86156, 0.010272], [-0.0098, -0.63647, -0.002019], [0.0314, -0.59695, 0.007328], [0.021, -0.40402, 0.002168], [-0.0721, -0.20579, -0.001343]]
      ],
      mix: [
        [[0.0407, -0.14097, 0.000062], [0.0414, -0.07546, 0.000053], [0.0293, -0.04146, 0.000113], [0.0139, -0.01534, 0.000044], [0.0044, -0.00423, -0.000004]],
        [[0.0261, -0.16579, -0.000662], [0.0431, -0.09977, -0.000302], [0.0218, -0.04899, -0.00016], [0.0121, -0.01985, -0.000048], [0.0067, -0.0079, 0.000033]],
        [[0.0057, -0.23238, -0.000772], [0.0215, -0.14289, -0.000649], [0.008, -0.08643, 0.000098], [0.0151, -0.03723, 0.000065], [0.0072, -0.01018, -0.00005]],
        [[0.0251, -0.28241, 0.000165], [0.0342, -0.18339, 0.000098], [-0.0003, -0.1027, -0.000139], [0.0077, -0.04637, 0.000152], [0.006, -0.01548, 0.000112]],
        [[0.0493, -0.35148, 0.001744], [0.0237, -0.2128, 0.000316], [-0.0066, -0.13537, 0.000041], [-0.0025, -0.06547, 0.000313], [-0.0019, -0.02023, -0.000011]],
        [[0.0459, -0.40595, 0.003382], [0.0264, -0.25729, -0.001418], [0.0067, -0.16971, -0.000033], [0.002, -0.08137, -0.000036], [-0.0077, -0.03519, 0.000066]],
        [[0.0671, -0.48186, 0.004121], [0.0402, -0.33101, 0.001664], [0.0102, -0.21707, 0.000228], [-0.0143, -0.11252, 0.000026], [-0.0132, -0.05059, 0.000034]],
        [[0.0006, -0.58167, 0.002366], [0.0578, -0.47742, 0.00335], [0.0347, -0.35473, 0.001995], [-0.0437, -0.16759, -0.001711], [-0.0225, -0.0975, -0.000026]],
        [[0.0318, -0.73085, -0.004007], [0.082, -0.60034, 0.003892], [0.0291, -0.42407, -0.001456], [-0.0291, -0.28287, 0.000934], [-0.0342, -0.15026, -0.000752]],
        [[0.097, -0.9278, 0.012031], [0.0769, -0.80321, 0.007164], [-0.0211, -0.56593, 0], [0.0058, -0.3862, -0.003305], [-0.059, -0.26105, 0.000308]]
      ]
    }
  }; // engine v17, 2000 attempts per cell, 2026-11-27
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
    if (R.lay) return generateLay(seed, R, g, n);
    const C = config(R, g), rng = E.makeRng('special|' + seed + '|' + R.id + '|' + g);
    const hoops = [], mid = (E.Y_MIN + E.Y_MAX) / 2, half = (E.Y_MAX - E.Y_MIN) / 2;
    let x = C.firstX, prevY = START_Y;
    const wPhase = rng(), wLen = 5 + Math.floor(rng() * 3); // the wave's starting point and length (rings)
    const pr = R.pulse ? E.makeRng('specialpulse|' + seed + '|' + R.id + '|' + g) : null;
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
      const up = R.upright === 'all' || (R.upright === 'alt' && i % 2 === 1);
      let tilt = 0;
      if (r6 < C.tiltP && !up) tilt = (R.lean === 'alt' ? (i % 2 ? 1 : -1) : r7 < 0.5 ? -1 : 1) * C.tiltMax * (0.6 + 0.4 * r8) * DEG;
      let w = C.hoopW + (up ? GATE_W - GATE_TAPER * g : 0); // gates come closer to a flat ring's width on the harder grades
      if (R.width === 'squeeze') w = Math.round((C.hoopW + Math.max(-14, 12 - 2.2 * i)) * 10) / 10; // wide at first, then tighter than Needle
      else if (R.width === 'alt') w = Math.round((C.hoopW + (i % 2 ? -13 : 16)) * 10) / 10;
      if (w < W_MIN) w = W_MIN;
      const hp = { i, x, y0: y, w, amp, period, phase, tilt, c: E.dcos(tilt), s: E.dsin(tilt), cp: i === n - 1 };
      if (up) { hp.v = true; hp.tilt = -90 * DEG; hp.c = 0; hp.s = -1; } // stands on its side: a gate (engine v17)
      if (pr) { // breathes: its own stream of numbers (three a ring), so the rings are the ones it would have without
        const a = pr(), b = pr(), c = pr();
        hp.pw = Math.min(PULSE.w[0] + (PULSE.w[1] - PULSE.w[0]) * a, w - W_MIN); hp.pp = PULSE.p[0] + (PULSE.p[1] - PULSE.p[0]) * b; hp.pph = c;
      }
      hoops.push(hp);
      prevY = y;
    }
    const ws = R.ob ? walls(R, C, hoops, E.makeRng('specialwalls|' + seed + '|' + R.id + '|' + g)) : null;
    // the time limit grows with the course: a slow player needs up to about 2.4 s a ring (rim knocks hold the ball back)
    const def = { seed: String(seed), di: GRADES[g][0], L: 0, special: R.id, grade: g, speed: C.speed, startY: START_Y, hoops, endX: x + C.spacing, maxTicks: E.TICK_HZ * Math.max(45, 20 + 3 * n) };
    if (ws) def.walls = ws;
    return def;
  }

  // A course in one of the new layouts (LAYS). Its own function, so the twists before it build exactly the rings
  // they always have. The same nine draws a ring as generate; a mix draws one more a ring from its own stream for
  // what each ring is, and three for how it breathes, so ring i still never depends on n.
  function generateLay(seed, R, g, n) {
    const C = config(R, g), Ly = LAYS[R.lay], rng = E.makeRng('special|' + seed + '|' + R.id + '|' + g);
    const mix = R.lay === 'mix', mk = mix ? E.makeRng('specialmix|' + seed + '|' + R.id + '|' + g) : null;
    const pr = mix ? E.makeRng('specialpulse|' + seed + '|' + R.id + '|' + g) : null;
    const hoops = [], gw = GATE_W + (Ly.wide0 || 0) - (GATE_TAPER + (Ly.taper || 0)) * g;
    let x = C.firstX, prevY = START_Y, kind = MIX.PLAIN;
    for (let i = 0; i < n; i++) {
      const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng(), r5 = rng(), r6 = rng(), r7 = rng(), r8 = rng(), r9 = rng();
      const k = Ly.group ? i % Ly.group : 0, linked = k > 0;
      if (mk) { const m = mk(); kind = i === 0 ? MIX.PLAIN : (kind + 1 + Math.floor(m * (Ly.kinds - 1))) % Ly.kinds; }
      let gap = C.firstX, y, amp = 0, period = 1, phase = 0, tilt = 0;
      if (linked) { // hangs off the ring before it: forward a little and down
        gap = (Ly.dx[0] + (Ly.dx[1] - Ly.dx[0]) * r9) * C.speed / 178; x += gap;
        y = Math.min(E.Y_MAX, prevY + Ly.dy[0] + (Ly.dy[1] - Ly.dy[0]) * r1);
      } else {
        if (i > 0) { gap = C.spacing * (Ly.gap || 1) * (0.92 + 0.16 * r9); x += gap; }
        if (kind === MIX.LIFT) { amp = Math.max(C.moveAmp, 44) * (0.75 + 0.25 * r3); period = C.periodBase * 1.3 * (0.85 + 0.3 * r4); phase = r5; }
        else if (r2 < C.moveP) { amp = C.moveAmp * (0.75 + 0.25 * r3); period = C.periodBase * (0.85 + 0.3 * r4); phase = r5; }
        if (Ly.band) y = E.Y_MIN + Ly.band * r1;
        else y = i === 0 ? 320 + (r1 * 2 - 1) * 45 : Ly.group ? E.Y_MIN + 10 + (E.Y_MAX - (Ly.group - 1) * Ly.dy[1] - E.Y_MIN - 10) * r1 : prevY + (r1 * 2 - 1) * (Ly.drift || C.dy);
        if (y < E.Y_MIN) y = E.Y_MIN + (E.Y_MIN - y) * 0.5;
        if (y > E.Y_MAX) y = E.Y_MAX - (y - E.Y_MAX) * 0.5;
        if (Ly.group) { const room = (Ly.group - 1) * Ly.dy[1]; if (y + amp > E.Y_MAX - room) y = E.Y_MAX - room - amp; } // room under it for its group
        let maxUp = CLIMB_RATE * (gap / C.speed - DROP_TIME) - CLIMB_MARGIN;
        if (maxUp < 30) maxUp = 30;
        if (prevY - (y - amp) > maxUp) y = prevY - maxUp + amp;
        if (y - amp < E.Y_MIN) y = E.Y_MIN + amp;
        if (y + amp > E.Y_MAX) y = E.Y_MAX - amp;
      }
      const up = R.lay === 'rush' || kind === MIX.DOOR;
      if (!linked && !up && r6 < C.tiltP) tilt = (r7 < 0.5 ? -1 : 1) * C.tiltMax * (0.6 + 0.4 * r8) * DEG;
      let w = C.hoopW + (up ? gw : 0) + (linked ? Ly.wide || 0 : 0) - (kind === MIX.TIGHT ? 8 : 0);
      if (w < W_MIN) w = W_MIN;
      w = Math.round(w * 10) / 10;
      const hp = { i, x, y0: y, w, amp, period, phase, tilt, c: E.dcos(tilt), s: E.dsin(tilt), cp: i === n - 1 };
      if (up) { hp.v = true; hp.tilt = -90 * DEG; hp.c = 0; hp.s = -1; }
      if (pr) { const a = pr(), b = pr(), c = pr(); if (kind === MIX.BREATHE) { hp.pw = Math.min(PULSE.w[0] + (PULSE.w[1] - PULSE.w[0]) * a, w - W_MIN); hp.pp = PULSE.p[0] + (PULSE.p[1] - PULSE.p[0]) * b; hp.pph = c; } }
      if (kind === MIX.WALL && i > 0) hp.wb = true; // a wall stands in front of it
      hoops.push(hp);
      prevY = y;
    }
    const def = { seed: String(seed), di: GRADES[g][0], L: 0, special: R.id, grade: g, speed: C.speed, startY: START_Y, hoops, endX: x + C.spacing, maxTicks: E.TICK_HZ * Math.max(45, 20 + 3 * n) };
    if (mix || R.lay === 'high') def.walls = walls({ ob: mix ? 'some' : 'tall' }, C, hoops, E.makeRng('specialwalls|' + seed + '|' + R.id + '|' + g));
    return def;
  }

  // The walls of a course, in order: the same ones between every two rings (so the first n rings of a longer course
  // have the same walls before and between them). Each is a slab for the engine, { x0, x1, y0, y1 }: it stands on
  // the floor and its top is y0. A wall's top is UP above the line from one ring to the next, so the ball has to
  // come up sooner than the next ring alone would ask. It's never higher than a ball can climb to after dropping
  // through the ring before (at its lowest point if it bobs), nor so high that the next ring can't be dropped
  // into from over it. Walls have their own stream of random numbers (two draws each), so the rings are the ones
  // the course would have without them.
  function walls(R, C, hoops, rng) {
    const out = [], L = WALLS[R.ob], clear = E.PHYS.R + WALL_PAD;
    for (let i = 0; i + 1 < hoops.length; i++) {
      const a = hoops[i], b = hoops[i + 1], gap = b.x - a.x;
      for (const at of L.at) {
        const r1 = rng(), r2 = rng(), f = at[0] + (at[1] - at[0]) * r1;
        if (L.only && !b.wb) continue; // (an obstacle course has one only in front of some rings)
        const xm = Math.round(a.x + gap * f), x0 = xm - WALL_W / 2, x1 = xm + WALL_W / 2;
        const t1 = (x0 - E.PHYS.R - a.x) / C.speed, t2 = (b.x - x1 - E.PHYS.R) / C.speed; // the time before it and after it
        let y = a.y0 + (b.y0 - a.y0) * f - (L.up[0] + (L.up[1] - L.up[0]) * r2);
        // before it: the ball drops WALL_DIVE below the ring while the player reacts, then climbs; after it: a free fall
        const climb = CLIMB_RATE * Math.max(0, t1 - WALL_REACT) - WALL_DIVE, fall = Math.min(260, 0.8 * 0.5 * E.PHYS.G * t2 * t2);
        y = Math.max(y, (a.y0 + a.amp) - climb + clear, (b.y0 + b.amp) - fall + clear, WALL_TOP);
        out.push({ x0, x1, y0: Math.round(y), y1: E.WORLD.FLOOR + 400 });
      }
    }
    return out;
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
  const CYCLE = Math.floor(PLAIN.length / PER_DAY); // days
  function shuffled(cycle) {
    const a = PLAIN.slice(), r = E.makeRng('specialcycle|' + cycle);
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
  // Each prize's specials for a day, in order: PER_SLOT of them, the same for everyone. A player sees the first;
  // clearing it brings up the next (the owner asked for a cleared special to lock or make way for a new one), and
  // after the last that prize is done until tomorrow. One prize a day (they take turns) opens with a course with
  // walls, also in turn, the next one along with one of the new rings, and the last with one of the new layouts;
  // each has the day's ring twist from the cycle above next in line. The rest are every other twist, shuffled for
  // the day and dealt round, so fifteen come up each day and no two prizes ever show the same one.
  function queuesFor(day) {
    const k = Math.floor((dayStart(day) - EPOCH) / DAY_MS), pos = ((k % CYCLE) + CYCLE) % CYCLE;
    const a = order(Math.floor(k / CYCLE)), mod = (v, m) => ((v % m) + m) % m;
    const q = SLOTS.map((x, slot) => [a[pos * PER_DAY + slot]]);
    if (OBST.length) { const s = mod(k + Math.floor(k / OBST.length), SLOTS.length); q[s].unshift(OBST[mod(k, OBST.length)]); }
    // and the next prize along opens with one of the new-ring courses (engine v17), also in turn
    if (FX.length) { const s = mod(k + Math.floor(k / OBST.length) + 1, SLOTS.length); q[s].unshift(FX[mod(k, FX.length)]); }
    // and the last one with one of the new layouts (LAY), also in turn
    if (LAY.length) { const s = mod(k + Math.floor(k / OBST.length) + 2, SLOTS.length); q[s].unshift(LAY[mod(k, LAY.length)]); }
    const used = new Set([].concat(...q)), rest = RECIPES.filter((r) => !used.has(r)), r = E.makeRng('specialnext|' + k);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = rest[i]; rest[i] = rest[j]; rest[j] = t; }
    let s = 0;
    for (const R of rest) {
      for (let n = 0; n < SLOTS.length && q[s].length >= PER_SLOT; n++) s = (s + 1) % SLOTS.length;
      if (q[s].length >= PER_SLOT) break;
      q[s].push(R); s = (s + 1) % SLOTS.length;
    }
    return q;
  }
  // The day's three as a player sees them. wins: how many of each prize's specials they've cleared today (by slot;
  // none for someone new). at: which of the day's it is (from 0), of: how many there are, done: all cleared, in
  // which case the recipe is the last one.
  function specialsFor(day, wins) {
    return queuesFor(day).map((q, slot) => {
      const w = Math.max(0, Math.floor((wins && wins[slot]) || 0)), at = Math.min(w, q.length - 1);
      return { slot, x: SLOTS[slot], recipe: q[at], at, of: q.length, done: w >= q.length, next: q[at + 1] || null };
    });
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
  // d is the level at the ENTRY stake (the only one before stakes), k the others: k[slot]['0.1'] for 0.1 SOL.
  const blank = () => ({ r: {}, d: SLOTS.map(() => null), k: SLOTS.map(() => ({})), rings: 0, tries: 0 });
  const norm = (Rt) => {
    if (!Rt || !Rt.r) return blank();
    if (!Array.isArray(Rt.d)) Rt.d = SLOTS.map(() => null);
    if (!Array.isArray(Rt.k)) Rt.k = SLOTS.map(() => ({}));
    return Rt;
  };
  // a stake's key in k (null for ENTRY, whose level is d), and the regular-run bets (SOL) that open it
  const skey = (stake) => (stake == null || Math.abs(stake - ENTRY) < 1e-9 ? null : String(Math.round(stake * 1e6) / 1e6));
  const unlockFor = (stake) => Math.round(UNLOCK * Math.max(ENTRY, stake == null ? ENTRY : stake) * 1e9) / 1e9;
  // the player's level at a prize and stake, or null if they haven't played it
  function levelAt(Rt, slot, stake) {
    const key = skey(stake);
    if (key == null) return Rt && Array.isArray(Rt.d) && Rt.d[slot] != null ? Rt.d[slot] : null;
    const m = Rt && Array.isArray(Rt.k) && Rt.k[slot];
    return m && m[key] != null ? m[key] : null;
  }
  // every level the player has: [slot, level]
  function eachLevel(Rt, f) {
    if (!Rt) return;
    if (Array.isArray(Rt.d)) Rt.d.forEach((v, k) => { if (v != null) f(k, v); });
    if (Array.isArray(Rt.k)) Rt.k.forEach((m, k) => { if (m) for (const key in m) if (m[key] != null) f(k, m[key]); });
  }
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
  // where a special's level starts (at a stake the player hasn't played there): START, or more if regular runs (the
  // middle of their rating) show more, or their level at another stake of this special, or in another special (less
  // SLOT_MARGIN). It leans high: starting a player too high costs them a few misses while their level comes down;
  // starting a strong one too low hands them wins while it climbs.
  function startFor(Rt, slot) {
    let d = START;
    if (Rt && Rt.r) d = Math.max(d, regular(Rt).m);
    eachLevel(Rt, (k, v) => { d = Math.max(d, k === slot ? v : v - SLOT_MARGIN); });
    return clamp(d);
  }
  // the player's level in a special now, at a stake (ENTRY if none)
  const levelOf = (Rt, slot, stake) => { const v = levelAt(Rt, slot, stake); return v != null ? v : startFor(Rt, slot); };
  // an attempt at a special is over: that stake's level goes up after a clear, down after a miss
  function addSpecial(Rt, slot, won, rings, stake) {
    const d = levelOf(Rt, slot, stake), key = skey(stake);
    Rt = norm(Rt);
    const v = Math.round(clamp(d + (won ? up(SLOTS[slot]) : -DOWN)) * 1e4) / 1e4;
    if (key == null) Rt.d[slot] = v; else Rt.k[slot][key] = v;
    Rt.tries++; Rt.rings += rings | 0;
    return Rt;
  }
  // for show: the player's level from regular runs, and in each special
  function rating(Rt) {
    const g = regular(Rt);
    return { s: Math.round(g.m * 100) / 100, sd: Math.round(g.sd * 100) / 100, name: levelName(g.m), rings: Rt && Rt.rings ? Rt.rings : 0, tries: Rt && Rt.tries ? Rt.tries : 0,
      levels: SLOTS.map((x, k) => Math.round(levelOf(Rt, k) * 100) / 100),
      stakes: SLOTS.map((x, k) => STAKES.map((st) => Math.round(levelOf(Rt, k, st) * 100) / 100)) };
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
  function todayFor(Rt, day, wins, stake, stakes) {
    return specialsFor(day, wins).map(({ slot, x, recipe, at, of, done, next }) => {
      const d = levelOf(Rt, slot, stake), c = courseFor(d, recipe.id, x);
      return { slot, x, recipe: recipe.id, g: c.g, n: c.n, chance: c.chance, rtp: c.rtp, level: Math.round(d * 100) / 100, levelName: levelName(d), at, of, done, next: next ? next.id : null,
        tiers: tiersFor(Rt, slot, recipe.id, x, stakes) };
    });
  }
  // the course at each stake for a special (stakes in SOL; STAKES by default)
  function tiersFor(Rt, slot, recipe, x, stakes) {
    return (stakes || STAKES).map((st) => {
      const d = levelOf(Rt, slot, st), c = courseFor(d, recipe, x);
      return { stake: st, g: c.g, n: c.n, chance: c.chance, level: Math.round(d * 100) / 100, levelName: levelName(d) };
    });
  }

  return {
    ENTRY, DAY_MS, START_Y, SLOTS, TARGET, N_MIN, N_MAX, N_IDEAL, GRADES, RECIPES, BY, ANCHORS, LEVEL_NAMES, GRID,
    D_MIN, D_MAX, PRIOR_MU, PRIOR_SD, START, DOWN, SLOT_MARGIN, UNLOCK, TABLES, STAKES, MAX_STAKE, skey, unlockFor, levelAt, tiersFor,
    config, generate, gradeText, dayKey, dayStart, closesAt, specialsFor, queuesFor, CYCLE, PER_DAY, PER_SLOT, W_MIN, PLAIN, OBST, FX, LAY, LAYS, WALLS, WALL_W, GATE_W, PULSE, walls,
    blank, addLevel, regular, startFor, levelOf, addSpecial, up, levelName, rating, courseFor, todayFor, missReg, clearP
  };
});
