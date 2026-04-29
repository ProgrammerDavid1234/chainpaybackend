const knex = require('knex');
const dns  = require('dns');
dns.setDefaultResultOrder('ipv4first');

const db = knex({
  client: 'pg',
  connection: {
    host:     process.env.DB_HOST,
    port:     Number(process.env.DB_PORT) || 6543,
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl:      { rejectUnauthorized: false },
  },
});

module.exports = db;