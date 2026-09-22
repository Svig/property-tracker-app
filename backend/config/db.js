// Database connection layer.
// Supports MariaDB/MySQL (mysql2) or PostgreSQL (pg). Both expose the same
// three helpers so the rest of the app never needs to know which engine is
// underneath: query(), getOne(), transaction().

require('dotenv').config();

// ------------------------------------------------------------------
// Connection config: accepts either discrete DB_HOST/DB_PORT/DB_USER/
// DB_PASSWORD/DB_NAME/DB_CLIENT vars, OR a single connection URL in
// DATABASE_URL or DB_URL — e.g. the "Service URI" Aiven, Supabase, Neon
// and most hosts show you directly:
//   mysql://user:pass@host:28679/defaultdb?ssl-mode=REQUIRED
//   postgres://user:pass@host:5432/defaultdb?sslmode=require
//
// Safety net: pasting that whole URI into DB_HOST by mistake (instead of
// DATABASE_URL, or instead of splitting it into the separate fields) is an
// easy mistake — providers prominently display it as a single string. If
// DB_HOST looks like a URL rather than a hostname, it's parsed the same
// way, with a warning, rather than failing with a confusing DNS error.
// ------------------------------------------------------------------

function parseConnectionUrl(raw) {
  try {
    const u = new URL(raw);
    const protocol = u.protocol.replace(':', '').toLowerCase();
    const client = protocol === 'mysql' ? 'mariadb'
      : protocol.startsWith('postgres') ? 'postgres'
      : protocol;
    const sslRequested = ['ssl-mode', 'sslmode'].some(key => {
      const v = u.searchParams.get(key);
      return v && /require/i.test(v);
    });
    return {
      client,
      host: u.hostname,
      port: u.port || undefined,
      user: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined,
      database: u.pathname.replace(/^\//, '') || undefined,
      sslRequested,
    };
  } catch (e) {
    return null;
  }
}

function looksLikeUrl(v) {
  return typeof v === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(v);
}

let resolved = null;
const urlEnv = process.env.DATABASE_URL || process.env.DB_URL;
if (urlEnv) {
  resolved = parseConnectionUrl(urlEnv);
  if (!resolved) console.warn('[db] DATABASE_URL/DB_URL is set but could not be parsed as a URL — falling back to DB_HOST etc.');
} else if (looksLikeUrl(process.env.DB_HOST)) {
  console.warn('[db] DB_HOST looks like a full connection string, not a hostname. Parsing it anyway so the app still works, but move this value to DATABASE_URL (and set DB_HOST to just the hostname, or remove it) — see .env.example.');
  resolved = parseConnectionUrl(process.env.DB_HOST);
}

const DB_CLIENT = (resolved?.client || process.env.DB_CLIENT || 'mariadb').toLowerCase();

// Hosted databases (Aiven, Supabase, Neon, etc.) require SSL — a local
// MariaDB/Postgres install usually doesn't. Set DB_SSL=true, or it's
// turned on automatically when a connection URL includes
// ssl-mode=REQUIRED / sslmode=require. DB_SSL_CA can hold the provider's
// CA certificate (paste its full contents, BEGIN/END lines included) for
// a properly verified connection; without it, the connection is still
// encrypted but the server's certificate isn't verified against a known
// CA — acceptable for a small internal tool, but use the CA when your
// provider makes one available.
const useSsl = String(process.env.DB_SSL).toLowerCase() === 'true' || !!resolved?.sslRequested;
function sslConfig() {
  if (!useSsl) return undefined;
  return process.env.DB_SSL_CA
    ? { ca: process.env.DB_SSL_CA }
    : { rejectUnauthorized: false };
}

const connectionDefaults = DB_CLIENT === 'postgres' || DB_CLIENT === 'postgresql'
  ? { host: 'localhost', port: 5432, user: 'postgres', database: 'viewing_register' }
  : { host: 'localhost', port: 3306, user: 'root', database: 'viewing_register' };

const connConfig = {
  host: resolved?.host || process.env.DB_HOST || connectionDefaults.host,
  port: Number(resolved?.port || process.env.DB_PORT || connectionDefaults.port),
  user: resolved?.user || process.env.DB_USER || connectionDefaults.user,
  password: resolved?.password || process.env.DB_PASSWORD || '',
  database: resolved?.database || process.env.DB_NAME || connectionDefaults.database,
};

let pool;
let placeholder; // how each engine wants bound parameters written

if (DB_CLIENT === 'postgres' || DB_CLIENT === 'postgresql') {
  const { Pool } = require('pg');
  pool = new Pool({ ...connConfig, max: 10, ssl: sslConfig() });
  placeholder = 'postgres'; // $1, $2, ...
} else {
  const mysql = require('mysql2/promise');
  pool = mysql.createPool({ ...connConfig, waitForConnections: true, connectionLimit: 10, ssl: sslConfig() });
  placeholder = 'mysql'; // ?, ?, ...
}

// Converts a query written with `?` placeholders into the right dialect.
// Every route file writes queries using `?` regardless of engine.
function toDialect(sql) {
  if (placeholder !== 'postgres') return sql;
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function query(sql, params = []) {
  const finalSql = toDialect(sql);
  if (placeholder === 'postgres') {
    const res = await pool.query(finalSql, params);
    return res.rows;
  } else {
    const [rows] = await pool.query(finalSql, params);
    return rows;
  }
}

async function getOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// Runs an INSERT and returns the new row's id, regardless of engine.
// Write INSERT statements with `?` placeholders and no RETURNING/id
// handling of your own — this takes care of the dialect difference:
// mysql2 gives back an insertId on the result header, Postgres needs an
// explicit RETURNING id clause to get anything back at all.
async function insert(sql, params = []) {
  if (placeholder === 'postgres') {
    const withReturning = /returning/i.test(sql) ? sql : `${sql} RETURNING id`;
    const res = await pool.query(toDialect(withReturning), params);
    return res.rows[0]?.id;
  } else {
    const [result] = await pool.query(sql, params);
    return result.insertId;
  }
}

// Runs `fn` inside a transaction. `fn` receives a client-like object with
// the same query()/getOne() signature bound to that transaction.
async function transaction(fn) {
  if (placeholder === 'postgres') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const txQuery = async (sql, params = []) => (await client.query(toDialect(sql), params)).rows;
      const txGetOne = async (sql, params = []) => (await txQuery(sql, params))[0] || null;
      const result = await fn({ query: txQuery, getOne: txGetOne });
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } else {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const txQuery = async (sql, params = []) => (await conn.query(sql, params))[0];
      const txGetOne = async (sql, params = []) => (await txQuery(sql, params))[0] || null;
      const result = await fn({ query: txQuery, getOne: txGetOne });
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
}

module.exports = { query, getOne, insert, transaction, DB_CLIENT };
