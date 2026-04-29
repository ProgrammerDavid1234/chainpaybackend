require('dotenv').config();
const { Client } = require('pg');

// Force IPv4 globally
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

module.exports = {
  development: {
    client: 'pg',
    connection: {
      host:     process.env.DB_HOST,
      port:     Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl:      { rejectUnauthorized: false },
    },
    migrations: { directory: './migrations' },
    seeds:      { directory: './seeds' },
  },
  production: {
    client: 'pg',
    connection: {
      host:     process.env.DB_HOST,
      port:     Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl:      { rejectUnauthorized: false },
    },
    migrations: { directory: './migrations' },
  },
};