require('dotenv').config();
const express = require('express');
require('express-async-errors'); // lets `async` route handlers that throw reach the error handler below instead of crashing the process
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/users.routes');
const clientRoutes = require('./routes/clients.routes');
const viewingRoutes = require('./routes/viewing.routes');
const propertiesRoutes = require('./routes/properties.routes');
const superadminRoutes = require('./routes/superadmin.routes');
const { bootstrapDatabase } = require('./scripts/bootstrap-db');
const { createMonitor, apiGate, isConnectionError } = require('./config/db-monitor');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Tracks whether the database is reachable. While it isn't (e.g. Aiven has
// powered the service off), /api answers with a friendly 503 and the monitor
// retries — and asks Aiven to power the service on — on a 20-minute schedule.
// See backend/config/db-monitor.js.
const dbMonitor = createMonitor({ connect: bootstrapDatabase });
app.use('/api', apiGate(dbMonitor));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/viewing', viewingRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/superadmin', superadminRoutes);

// `ok` = the web server is up (keeps the host's health check green while the database wakes); `db` = database state.
app.get('/api/health', (req, res) => res.json({ ok: true, db: dbMonitor.state }));

// Serve the frontend. The super admin console is a separate page from the
// tenant app (separate auth realm, separate concerns) — served explicitly
// here, before the SPA catch-all below would otherwise swallow the request
// and serve the tenant app's index.html instead.
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/superadmin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'superadmin.html'));
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Basic error handler so a thrown error returns JSON instead of crashing silently
app.use((err, req, res, next) => {
  // The database dropped out mid-request: answer 503 and start the wake/retry cycle.
  if (isConnectionError(err)) {
    dbMonitor.reportFailure(err);
    res.set('Retry-After', '30');
    return res.status(503).json({
      error: 'The database is waking up \u2014 this can take a few minutes. Please try again shortly.',
      code: 'DB_STARTING',
      state: dbMonitor.state,
    });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// Safety net: a database error escaping outside a request (e.g. a stray promise)
// must not kill the server. Anything else keeps Node's default behaviour (crash).
process.on('unhandledRejection', (reason) => {
  if (isConnectionError(reason)) {
    console.error('[db] connection error outside a request:', reason.code || reason.message);
    dbMonitor.reportFailure(reason);
    return;
  }
  throw reason;
});

function start() {
  // Listen straight away — don't wait for the database. If the port isn't open
  // while we wait (up to 20 minutes for a powered-off Aiven service), the host's
  // deploy health check can fail and kill the deploy; this way the page loads and
  // can show "waking up" while the database comes back.
  app.listen(PORT, () => {
    console.log(`Viewing Register running at http://localhost:${PORT} (database: ${dbMonitor.state})`);
  });

  dbMonitor.ensureRunning().catch(err => {
    if (err.retriesExhausted) return; // already logged; the next request starts another round
    // Not a "can't reach it" problem — bad credentials, a broken schema statement, etc.
    // Fail loudly rather than serving an app that looks up but can never log anyone in.
    console.error('[bootstrap] FAILED — this is not a connection-timing problem, so retrying would not help:');
    console.error(err.message);
    console.error('Check DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME/DB_SSL and redeploy.');
    process.exit(1);
  });
}

start();
