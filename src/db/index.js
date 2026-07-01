// src/db/index.js
// Neon PostgreSQL connection with connection pooling
const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // required for Neon
      max: 20,          // max connections in pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err.message);
    });

    console.log('[DB] Neon PostgreSQL pool initialized');
  }
  return pool;
}

// Helper: run a query with automatic retry on transient errors
async function query(text, params, retries = 2) {
  const db = getPool();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await db.query(text, params);
      return result;
    } catch (err) {
      const isTransient = err.code === 'ECONNRESET' || err.code === '57P01' || err.message.includes('timeout');
      if (isTransient && attempt < retries) {
        console.warn(`[DB] Transient error (attempt ${attempt + 1}), retrying...`);
        await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

// Helper: run multiple queries in a transaction
async function transaction(fn) {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, transaction, getPool };
