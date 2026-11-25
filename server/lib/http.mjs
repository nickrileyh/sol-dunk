// HTTP hardening: security headers and a content security policy for the game page, rate limits, country blocking,
// the origin secret (only your proxy may reach the server) and request logs.
import crypto from 'node:crypto';

export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// the page's inline scripts, by hash, so nothing else can run (an injected script would steal the sign-in token)
export function pagePolicy(html) {
  const hashes = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] && /\bsrc\s*=/.test(m[1])) continue;
    hashes.push(`'sha256-${crypto.createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
  }
  return [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline'", // the page sets inline style attributes; scripts are what matter
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ');
}

export function securityHeaders(CFG) {
  const https = /^https:/.test(CFG.publicUrl);
  return (req, res, next) => {
    res.set({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()'
    });
    if (https) res.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

// fixed-window counters in memory. One server: enough. Several behind a balancer: each counts its own share, which
// still caps abuse; the per-player database rules (one open run, row locks) hold regardless.
export function createLimiter(CFG) {
  const buckets = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60_000).unref();
  return (name, max, windowMs, keyOf = (req) => req.ip) => (req, res, next) => {
    if (!CFG.rateLimit) return next();
    const key = name + ':' + keyOf(req), now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
    if (++b.n > max) {
      res.set('retry-after', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Wait a moment and try again.' });
    }
    next();
  };
}

export function countryOf(CFG, req) { return String(req.get(CFG.geoHeader) || '').trim().toUpperCase(); }
// refuse play from blocked countries (and, with GEO_REQUIRED, from unknown ones). Signing in, the balance and
// withdrawals stay open everywhere, so nobody is cut off from their own money.
export function geoGate(CFG) {
  const blocked = new Set(CFG.blockedCountries);
  return (req, res, next) => {
    if (!blocked.size && !CFG.geoRequired) return next();
    const c = countryOf(CFG, req);
    if ((c && blocked.has(c)) || (!c && CFG.geoRequired) || c === 'XX' || c === 'T1') {
      return res.status(451).json({ error: 'SOL DUNK isn’t available where you are.', country: c || null });
    }
    next();
  };
}

// with ORIGIN_SECRET set, every request must carry it (your CDN or proxy adds the header), so nobody can skip the
// proxy and fake the country header. /healthz stays open for the container's own health check.
export function originGuard(CFG) {
  return (req, res, next) => {
    if (!CFG.originSecret || req.path === '/healthz') return next();
    if (safeEqual(req.get('x-origin-secret') || '', CFG.originSecret)) return next();
    res.status(403).json({ error: 'Forbidden' });
  };
}

export function requestLog(log) {
  return (req, res, next) => {
    const t0 = process.hrtime.bigint(), id = crypto.randomBytes(6).toString('hex');
    res.set('x-request-id', id);
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6, s = res.statusCode;
      const lvl = s >= 500 ? 'warn' : s >= 400 && s !== 401 ? 'info' : 'debug';
      log[lvl]('http', { id, m: req.method, p: req.path, s, ms: Math.round(ms), ip: req.ip, who: res.locals.who });
    });
    next();
  };
}
