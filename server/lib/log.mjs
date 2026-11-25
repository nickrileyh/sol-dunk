// Structured logs (one JSON object per line), operator alerts (a Slack- or Discord-style webhook) and optional Sentry.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLog(CFG) {
  const min = LEVELS[CFG.logLevel] || 20;
  let sentry = null;
  const line = (level, msg, extra) => {
    if (LEVELS[level] < min) return;
    const o = { t: new Date().toISOString(), level, msg, ...(extra || {}) };
    if (o.err instanceof Error) o.err = { message: o.err.message, stack: o.err.stack, code: o.err.code };
    const s = JSON.stringify(o);
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(s + '\n');
  };
  const log = {
    debug: (m, x) => line('debug', m, x),
    info: (m, x) => line('info', m, x),
    warn: (m, x) => line('warn', m, x),
    error: (m, x) => {
      line('error', m, x);
      if (sentry && x && x.err instanceof Error) sentry.captureException(x.err, { extra: { msg: m } });
    }
  };

  // alerts: deduplicated per key, so a stuck condition pings at most once per `everyMs`
  const last = new Map();
  log.alert = (key, text, { everyMs = 30 * 60 * 1000, level = 'warn', extra } = {}) => {
    line(level, 'ALERT ' + text, { alert: key, ...(extra || {}) });
    const now = Date.now();
    if (now - (last.get(key) || 0) < everyMs) return;
    last.set(key, now);
    if (!CFG.alertWebhook) return;
    const body = JSON.stringify({ text: `SOL DUNK (${CFG.network}): ${text}`, content: `SOL DUNK (${CFG.network}): ${text}` });
    fetch(CFG.alertWebhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(5000) })
      .catch((e) => line('warn', 'alert webhook failed', { err: e }));
  };

  // Sentry is optional: install @sentry/node and set SENTRY_DSN
  log.initSentry = async () => {
    if (!CFG.sentryDsn) return;
    try {
      const S = await import('@sentry/node');
      S.init({ dsn: CFG.sentryDsn, environment: CFG.network });
      sentry = S;
      line('info', 'sentry on');
    } catch (e) { line('warn', 'SENTRY_DSN is set but @sentry/node is not installed', { err: e }); }
  };
  return log;
}
