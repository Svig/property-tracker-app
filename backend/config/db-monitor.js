// Keeps track of whether the database is reachable, and when it isn't,
// retries on a fixed schedule — asking Aiven to power the service on — until
// it comes back or the 20 minutes run out.
//
// Retry schedule (waits between attempts), as measured from the first attempt:
//     now -> 3 min -> 2 min -> 2 min -> 1 min -> then every 30 s
//   i.e. attempts at 0:00, 3:00, 5:00, 7:00, 8:00, 8:30, 9:00 ... 20:00
//   = 29 attempts, 20 minutes in total. Times are wall-clock, so a slow
//   attempt doesn't push the later ones (or the 20-minute limit) back.
//
// States:
//   starting  a retry cycle is running (first boot, or the DB dropped out)
//   ready     the database answered and the schema/migrations check passed
//   failed    the 20 minutes ran out; the next request starts a fresh cycle
const aiven = require('./aiven');

const RETRY_DELAYS_SEC = [180, 120, 120, 60, ...Array(24).fill(30)]; // 8 min + 24 x 30 s = 20 min

// Testing aid only: DB_RETRY_TIME_SCALE=0.01 runs the whole schedule 100x faster.
const TIME_SCALE = Number(process.env.DB_RETRY_TIME_SCALE) > 0 ? Number(process.env.DB_RETRY_TIME_SCALE) : 1;

function buildOffsetsMs(delaysSec, scale = 1) {
  let t = 0;
  return [0, ...delaysSec.map(d => (t += d * 1000 * scale))];
}

// ------------------------------------------------------------------
// Is this error "the database can't be reached right now" (worth
// retrying) as opposed to a real problem like bad credentials or a SQL
// syntax error (retrying for 20 minutes would just hide it)?
// ------------------------------------------------------------------
const CONNECTION_CODES = new Set([
  // network level (both drivers)
  'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EPIPE',
  'EHOSTUNREACH', 'ENETUNREACH', 'ECONNABORTED',
  // mysql2
  'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_SEQUENCE_TIMEOUT', 'CONNECTION_CLOSED',
  'ER_SERVER_SHUTDOWN', 'ER_NET_READ_ERROR', 'ER_NET_ERROR_ON_WRITE', 'ER_CON_COUNT_ERROR',
  // postgres: admin shutdown / crash shutdown / cannot connect now / connection exceptions
  '57P01', '57P02', '57P03', '08000', '08001', '08003', '08004', '08006',
]);
const CONNECTION_MESSAGE = /connection terminated|timeout exceeded when trying to connect|can't add new command when connection is in closed state|connection lost|server closed the connection|connect etimedout|connect econnrefused/i;

function isConnectionError(err, depth = 0) {
  if (!err || depth > 3) return false;
  if (err.code && CONNECTION_CODES.has(err.code)) return true;
  if (typeof err.message === 'string' && CONNECTION_MESSAGE.test(err.message)) return true;
  if (Array.isArray(err.errors) && err.errors.some(e => isConnectionError(e, depth + 1))) return true; // AggregateError (IPv4 + IPv6 attempts)
  return false;
}

// ------------------------------------------------------------------
// The monitor. Everything environmental is injectable so tests can run
// the full 20-minute schedule on a fake clock.
// ------------------------------------------------------------------
function createMonitor(opts = {}) {
  const {
    connect,                                   // async () => resolves when the DB is usable (bootstrap), throws otherwise
    aivenApi = aiven,
    offsetsMs = buildOffsetsMs(RETRY_DELAYS_SEC, TIME_SCALE),
    sleep = ms => new Promise(r => setTimeout(r, ms)),
    now = () => Date.now(),
    log = m => console.log(`[db-monitor] ${m}`),
    warn = m => console.warn(`[db-monitor] ${m}`),
    cooldownMs = 30000 * TIME_SCALE,           // after a failed cycle, don't restart one on every single request
  } = opts;
  if (typeof connect !== 'function') throw new Error('createMonitor needs a connect() function');

  let state = 'starting';
  let cycle = null;
  let failedAt = 0;
  let lastFailure = null;
  let lastError = null;

  // Asks Aiven (if configured) what state the service is in, and powers it on if it's off.
  // Best effort: a problem here is logged but never stops the retries.
  async function tryWake(seen) {
    const once = (msg, fn = log) => { if (!seen.has(msg)) { seen.add(msg); fn(msg); } };
    if (!aivenApi.isConfigured()) {
      once('Aiven wake-up is not configured (set AIVEN_API_TOKEN, AIVEN_PROJECT and AIVEN_SERVICE) — only retrying the connection. If the service is powered off it will not start by itself.', warn);
      return;
    }
    try {
      const svc = await aivenApi.getServiceState();
      once(`Aiven service state: ${svc}`);
      if (svc === 'POWEROFF') {
        await aivenApi.powerOn();
        log('Aiven service was powered off — power-on requested. It usually takes a few minutes to come up.');
      } else if (svc === 'RUNNING') {
        once('Aiven reports the service RUNNING but the connection still fails. If this persists, check DB_HOST / DB_PORT / credentials, and that this server is allowed in the service\'s network (IP allow-list) settings.', warn);
      }
    } catch (err) {
      once(`Could not check or start the Aiven service: ${err.message}`, warn);
    }
  }

  async function attemptLoop() {
    const t0 = now();
    const seen = new Set();
    for (let i = 0; i < offsetsMs.length; i++) {
      const wait = t0 + offsetsMs[i] - now();
      if (wait > 0) await sleep(wait);
      try {
        await connect();
        if (i > 0) log(`database is reachable again after ${Math.round((now() - t0) / 1000)}s`);
        return;
      } catch (err) {
        if (!isConnectionError(err)) throw err;     // a real problem (credentials, SQL, ...): don't hide it behind retries
        lastError = err;
        const last = i === offsetsMs.length - 1;
        log(`attempt ${i + 1}/${offsetsMs.length} — database not reachable (${err.code || err.message})` +
            (last ? '' : `; next try in ${Math.max(0, Math.round((t0 + offsetsMs[i + 1] - now()) / 1000))}s`));
        if (!last) await tryWake(seen);
      }
    }
    const e = new Error(`The database did not become reachable within ${Math.round(offsetsMs[offsetsMs.length - 1] / 60000)} minutes (last error: ${lastError?.code || lastError?.message}).`);
    e.retriesExhausted = true;
    throw e;
  }

  // Starts a retry cycle unless one is already running (all callers share it).
  function ensureRunning() {
    if (state === 'ready') return Promise.resolve();
    if (cycle) return cycle;
    if (state === 'failed' && now() - failedAt < cooldownMs) return Promise.reject(lastFailure);
    state = 'starting';
    cycle = attemptLoop().then(
      () => { state = 'ready'; lastFailure = null; cycle = null; },
      err => {
        state = 'failed'; failedAt = now(); lastFailure = err; cycle = null;
        (err.retriesExhausted ? warn : log)(err.retriesExhausted
          ? `${err.message} Giving up for now — the next request will start another round.`
          : `stopped: ${err.message}`);
        throw err;
      }
    );
    return cycle;
  }

  // Call when a live query fails. If it's a connectivity error, drop back to
  // "starting" and begin a new cycle. Returns true if it was one.
  function reportFailure(err) {
    if (!isConnectionError(err)) return false;
    if (state === 'ready') {
      log(`lost the database connection (${err.code || err.message}) — retrying.`);
      state = 'starting';
      ensureRunning().catch(() => {});
    }
    return true;
  }

  return {
    ensureRunning,
    reportFailure,
    isReady: () => state === 'ready',
    get state() { return state; },
  };
}

// Express middleware for /api: while the DB isn't ready, answer straight away
// with a friendly 503 (and make sure a retry cycle is running) instead of
// letting the request hit a dead connection.
function apiGate(monitor) {
  return (req, res, next) => {
    if (monitor.isReady() || req.path === '/health') return next();
    monitor.ensureRunning().catch(() => {});
    res.set('Retry-After', '30');
    res.status(503).json({
      error: 'The database is waking up — this can take a few minutes. Please try again shortly.',
      code: 'DB_STARTING',
      state: monitor.state,
    });
  };
}

module.exports = { createMonitor, apiGate, isConnectionError, buildOffsetsMs, RETRY_DELAYS_SEC };
