const knex = require('knex');
const dns  = require('dns');
const path = require('path');
const fs   = require('fs');
dns.setDefaultResultOrder('ipv4first');

const SQLITE_FILE = path.resolve(__dirname, '../../data/chainpay-baseline.sqlite3');

function createSqlite() {
  const dir = path.dirname(SQLITE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return knex({
    client: 'sqlite3',
    connection: { filename: SQLITE_FILE },
    useNullAsDefault: true,
    pool: { min: 0, max: 1 },
  });
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

async function tryPostgres() {
  try {
    await pgKnex.raw('SELECT 1');
    db = pgKnex;
    console.log('DB: PostgreSQL (Supabase) connected');
  } catch (err) {
    console.warn('DB: PostgreSQL unreachable, using SQLite fallback:', err.message.slice(0, 80));
    db = createSqlite();
  }
}

tryPostgres();

const baselineDb = null;

module.exports = new Proxy({}, {
  get(_, prop) {
    if (prop === 'baselineDb') return db || createSqlite();
    if (prop === 'SQLITE_FILE') return SQLITE_FILE;
    if (prop === 'pgKnex') return pgKnex;
    if (prop === 'tryPostgres') return tryPostgres;
    if (prop === 'createSqlite') return createSqlite;
    return (db || createSqlite())[prop];
  },
});
