// Runs the schema/seed SQL against whatever database this app is
// currently pointed at, on every startup. Safe to run repeatedly: every
// CREATE TABLE, INSERT, and index in the schema files is already written
// to be idempotent (IF NOT EXISTS / INSERT IGNORE / ON CONFLICT DO
// NOTHING); the couple of statements that aren't (Postgres's CREATE TYPE)
// are handled below by catching and ignoring "already exists" errors.
//
// Why this exists: on a hosted database (Aiven, Supabase, etc.), you may
// not always have a client on your own machine that can reach it directly
// (corporate firewalls blocking non-standard ports are common) — but the
// app server itself always can, since that's the connection it needs to
// work at all. Letting the app initialize its own schema on boot removes
// the "how do I even run the SQL file" problem entirely.
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

function isPostgres() {
  return db.DB_CLIENT === 'postgres' || db.DB_CLIENT === 'postgresql';
}

// Splits a SQL file into individual statements on top-level semicolons —
// i.e. ignoring any ';' that appears inside a '--' line comment, a
// '/* */' block comment, or a quoted string literal. A naive .split(';')
// breaks the moment any comment in the file happens to contain a
// semicolon (which several of the comments in this schema do).
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const chunk = end === -1 ? sql.slice(i) : sql.slice(i, end + 1);
      current += chunk;
      i += chunk.length;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const chunk = end === -1 ? sql.slice(i) : sql.slice(i, end + 2);
      current += chunk;
      i += chunk.length;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\') { j += 2; continue; } // escaped char, skip both
        if (sql[j] === quote) { j++; break; }
        j++;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }
    if (ch === ';') {
      statements.push(current);
      current = '';
      i++;
      continue;
    }
    current += ch;
    i++;
  }
  if (current.trim()) statements.push(current);
  return statements;
}

async function bootstrapDatabase() {
  const file = path.join(
    __dirname, '..', '..', 'database',
    isPostgres() ? 'init.postgres.sql' : 'init.mariadb.sql'
  );

  if (!fs.existsSync(file)) {
    console.warn(`[bootstrap] schema file not found at ${file} — skipping auto-init.`);
    return;
  }

  let raw = fs.readFileSync(file, 'utf8');

  // Strip lines this app shouldn't execute itself: the database it's
  // connecting to already exists (created by the hosting provider), so
  // CREATE DATABASE is redundant/fails, and \c is a psql client command,
  // not real SQL — sent to a driver it would just error.
  raw = raw.split('\n').filter(line => !/^\s*\\c\s/.test(line)).join('\n');

  const statements = splitStatements(raw)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .filter(s => {
      const withoutComments = s.replace(/--.*$/gm, '').trim();
      return withoutComments.length > 0 && !/^CREATE\s+DATABASE/i.test(withoutComments);
    });

  console.log(`[bootstrap] checking database schema (${statements.length} statements)...`);
  let applied = 0;
  let alreadyThere = 0;

  for (const statement of statements) {
    try {
      await db.query(statement);
      applied++;
    } catch (err) {
      const msg = (err.message || '').toLowerCase();
      const benign = msg.includes('already exists') || msg.includes('duplicate');
      if (benign) {
        alreadyThere++;
      } else {
        console.error('[bootstrap] a schema statement failed — this is the real error to look at:');
        console.error(statement.slice(0, 300));
        console.error(err.message);
        throw err;
      }
    }
  }

  console.log(`[bootstrap] done — ${applied} applied, ${alreadyThere} already existed. Database is ready.`);
}

module.exports = { bootstrapDatabase };
