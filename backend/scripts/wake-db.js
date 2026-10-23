#!/usr/bin/env node
// Checks the Aiven wake-up settings and, if the service is powered off, powers it on.
// Run it from the backend folder (it reads backend/.env, or your shell environment):
//
//   node scripts/wake-db.js --status    only shows the service's state; changes nothing (safe test)
//   node scripts/wake-db.js             shows the state and powers the service on if it is off
//
// It talks to Aiven's web API (the same site as the Console), NOT to the database
// port — so it works from a laptop even when a firewall blocks the database port.
require('dotenv').config();
const aiven = require('../config/aiven');

async function main() {
  const statusOnly = process.argv.includes('--status');

  if (!aiven.isConfigured()) {
    const missing = ['AIVEN_API_TOKEN', 'AIVEN_PROJECT', 'AIVEN_SERVICE'].filter(k => !process.env[k]);
    console.error(`Not configured — missing: ${missing.join(', ')}\nSee backend/.env.example.`);
    process.exit(1);
  }

  const before = await aiven.getServiceState();
  console.log(`Service "${process.env.AIVEN_SERVICE}" in project "${process.env.AIVEN_PROJECT}": ${before}`);

  if (statusOnly) return;
  if (before === 'POWEROFF') {
    await aiven.powerOn();
    console.log('Power-on requested. It usually takes a few minutes; run with --status to follow it (POWEROFF -> REBUILDING -> RUNNING).');
  } else {
    console.log(before === 'RUNNING' ? 'Already running — nothing to do.' : 'Not powered off — nothing to do.');
  }
}

main().catch(err => {
  console.error(`Failed: ${err.message}`);
  if (err.status === 401 || err.status === 403) console.error('The token was rejected — check AIVEN_API_TOKEN (it may have expired or lack access to this project).');
  if (err.status === 404) console.error('Project or service not found — check AIVEN_PROJECT and AIVEN_SERVICE (exact names as shown in the Aiven Console).');
  process.exit(1);
});
