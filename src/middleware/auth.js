const jwt = require('jsonwebtoken');
const db  = require('../db/knex');

module.exports = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided', code: 'TOKEN_MISSING' });
  }

  const token = header.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Check blocklist
    const blocked = await db('sessions').where({ jti: payload.jti }).first();
    if (blocked) {
      return res.status(401).json({ error: 'Token invalidated', code: 'TOKEN_INVALID' });
    }

    req.user = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
  }
};