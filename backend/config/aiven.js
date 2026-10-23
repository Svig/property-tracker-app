// Minimal Aiven REST API client — just enough to read a service's state and
// power it on. Aiven powers idle free-tier services off, and a powered-off
// service does NOT wake when something connects to it: it has to be powered
// on through the Console or this API (same as `avn service update --power-on`).
//
// Needs three environment variables (see .env.example):
//   AIVEN_API_TOKEN  a token from Aiven Console -> your profile -> Tokens
//   AIVEN_PROJECT    the project name the service lives in
//   AIVEN_SERVICE    the service name (e.g. "mysql-1a2b3c")
// If any is missing the wake-up is simply skipped.
//
// Uses node's built-in http/https (not fetch) so it works on any Node version
// Render picks. The token is only ever sent in the Authorization header and is
// never logged.
const http = require('http');
const https = require('https');

function baseUrl() {
  return (process.env.AIVEN_API_URL || 'https://api.aiven.io').replace(/\/+$/, '');
}

function config() {
  const token = process.env.AIVEN_API_TOKEN;
  const project = process.env.AIVEN_PROJECT;
  const service = process.env.AIVEN_SERVICE;
  return token && project && service ? { token, project, service } : null;
}

function isConfigured() {
  return !!config();
}

function request(method, body) {
  const cfg = config();
  if (!cfg) return Promise.reject(new Error('Aiven API is not configured (AIVEN_API_TOKEN / AIVEN_PROJECT / AIVEN_SERVICE).'));
  const url = new URL(`${baseUrl()}/v1/project/${encodeURIComponent(cfg.project)}/service/${encodeURIComponent(cfg.service)}`);
  const lib = url.protocol === 'http:' ? http : https;
  const payload = body ? JSON.stringify(body) : null;

  return new Promise((resolve, reject) => {
    const req = lib.request(url, {
      method,
      timeout: 15000,
      headers: {
        Authorization: `aivenv1 ${cfg.token}`,
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch (e) { /* non-JSON body */ }
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(json);
        const detail = json?.message || json?.errors?.[0]?.message || data.slice(0, 200) || 'no response body';
        const err = new Error(`Aiven API ${method} returned HTTP ${res.statusCode}: ${detail}`);
        err.status = res.statusCode;
        reject(err);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Aiven API request timed out')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Returns Aiven's service state string, e.g. RUNNING, POWEROFF, REBUILDING.
async function getServiceState() {
  const res = await request('GET');
  return res?.service?.state || 'UNKNOWN';
}

// Asks Aiven to power the service on. Returns as soon as the request is
// accepted — the service then takes a few minutes (sometimes longer) to come up.
async function powerOn() {
  await request('PUT', { powered: true });
}

module.exports = { isConfigured, getServiceState, powerOn };
