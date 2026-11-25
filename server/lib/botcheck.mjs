// Tap-precision check for bots.
//
// The server replays every level from its taps, so it knows exactly where the ball crossed each rim. People drop the
// ball along the rim with a spread; a bot that solves the physics drops it in nearly the same spot every time. With the
// game's own human-like bot (src/bot.cjs) the spread of the drop point, as a share of the rim's half-width, is:
//   average 0.23-0.25, good 0.22-0.24, pro 0.21-0.22, perfect (no human error) 0.11-0.12
// (300 levels per skill on Easy and Hard: `node scripts/botcheck-calibrate.mjs`). The score maps a spread of 0.18 or
// more to 0 and 0.12 or less to 1, over a decaying window of about the last 140 rings, once it holds 80 rings.
// A high score doesn't limit the player: it holds their withdrawals for a person to look at. Recalibrate the bounds
// from real players' numbers after launch (GET /api/admin/users/:address shows them).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../src/engine.cjs');

export const BOT = { DECAY: 0.995, MIN_RINGS: 80, HUMAN_SD: 0.18, BOT_SD: 0.12 };

// where the ball crossed each rim it scored through: -1 and 1 are the rim's ends, 0 its middle
export function levelSignals(def, taps) {
  const st = E.createState(def);
  let ti = 0;
  const offs = [], outs = [];
  while (!st.done) {
    let tap = false;
    if (ti < taps.length && taps[ti] === st.tick) { tap = true; ti++; }
    const before = st.outcomes.length;
    E.step(st, tap);
    if (st.outcomes.length > before) {
      const h = st.hoops[st.next - 1];
      const dx = st.ball.x - h.x, dy = st.ball.y - E.hoopY(h, st.tick * E.DT);
      offs.push((dx * h.c + dy * h.s) / (h.w * 0.5));
      outs.push(st.outcomes[st.outcomes.length - 1]);
    }
  }
  return { offs, outs };
}

// decaying sums over the player's rings
export function addSignals(stats, sig) {
  const s = stats ? { ...stats } : { n: 0, s1: 0, s2: 0, sw: 0, rings: 0 };
  for (let i = 0; i < sig.offs.length; i++) {
    const x = Math.max(-1.5, Math.min(1.5, sig.offs[i]));
    s.n = s.n * BOT.DECAY + 1; s.s1 = s.s1 * BOT.DECAY + x; s.s2 = s.s2 * BOT.DECAY + x * x;
    s.sw = s.sw * BOT.DECAY + (sig.outs[i] === 'S' ? 1 : 0);
  }
  s.rings += sig.offs.length;
  return s;
}

export function botScore(s) {
  if (!s || s.n < BOT.MIN_RINGS) return { score: null, n: s ? Math.round(s.n) : 0 };
  const mean = s.s1 / s.n, sd = Math.sqrt(Math.max(0, s.s2 / s.n - mean * mean));
  const score = Math.max(0, Math.min(1, (BOT.HUMAN_SD - sd) / (BOT.HUMAN_SD - BOT.BOT_SD)));
  return { score: Math.round(score * 1000) / 1000, sd: Math.round(sd * 1000) / 1000, n: Math.round(s.n), swishRate: Math.round((s.sw / s.n) * 1000) / 1000 };
}
