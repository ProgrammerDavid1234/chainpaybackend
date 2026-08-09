const knex = require('knex');
const dns  = require('dns');
const path = require('path');
const fs   = require('fs');
dns.setDefaultResultOrder('ipv4first');

const SQLITE_FILE = path.resolve(__dirname, '../../data/chainpay-baseline.sqlite3');

function createSqlite() {
  const dir = path.dirname(SQLITE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  try {
    return knex({
      client: 'sqlite3',
      connection: { filename: SQLITE_FILE },
      useNullAsDefault: true,
      pool: { min: 0, max: 1 },
    });
  } catch (err) {
    console.warn('SQLite client unavailable, falling back to PostgreSQL-only:', err.message.slice(0, 80));
    return null;
  }
}

const pgKnex = knex({
  client: 'pg',
  connection: {
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl:      { rejectUnauthorized: false },
  },
  pool: { min: 2, max: 10 },
});

let db = null;
let connectPromise = null;

async function tryPostgres() {
  try {
    await pgKnex.raw('SELECT 1');
    db = pgKnex;
    console.log('DB: PostgreSQL (Supabase) connected');
  } catch (err) {
    console.warn('DB: PostgreSQL unreachable, using SQLite fallback:', err.message.slice(0, 80));
    db = createSqlite();
    if (!db) {
      console.error('DB: Both PostgreSQL and SQLite unavailable — database features disabled');
    }
  }
}

connectPromise = tryPostgres();

const baselineDb = null;

module.exports = new Proxy(() => { throw new Error('Database connection not yet established — call connect() first'); }, {
  get(_, prop) {
    if (prop === 'baselineDb') return db || createSqlite();
    if (prop === 'SQLITE_FILE') return SQLITE_FILE;
    if (prop === 'pgKnex') return pgKnex;
    if (prop === 'tryPostgres') return tryPostgres;
    if (prop === 'createSqlite') return createSqlite;
    if (prop === 'connect') return connectPromise;
    if (!db) {
      throw new Error('Database connection not yet established — call connect() first');
    }
    return db[prop];
  },
  apply(_, thisArg, args) {
    if (!db) {
      throw new Error('Database connection not yet established — call connect() first');
    }
    return db(...args);
  },
});
