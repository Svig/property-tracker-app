// Database connection layer.
// Supports MariaDB/MySQL (mysql2) or PostgreSQL (pg), chosen via DB_CLIENT in .env.
// Both expose the same three helpers so the rest of the app never needs to
// know which database engine is underneath: query(), getOne(), transaction().

require('dotenv').config();

const DB_CLIENT = (process.env.DB_CLIENT || 'mariadb').toLowerCase();

let pool;
let placeholder; // how each engine wants bound parameters written

if (DB_CLIENT === 'postgres' || DB_CLIENT === 'postgresql') {
  const { Pool } = require('pg');
  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'viewing_register',
    max: 10,
  });
  placeholder = 'postgres'; // $1, $2, ...
} else {
  const mysql = require('mysql2/promise');
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'viewing_register',
    waitForConnections: true,
    connectionLimit: 10,
  });
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
