const QRCode = require('qrcode');
const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db     = require('../db/knex');

const signToken = (userId) => {
  const jti = uuidv4();
  const token = jwt.sign(
    { sub: userId, jti },
    process.env.JWT_SECRET,
    { expiresIn: '30m' }
  );
  return { token, jti };
};

// POST /auth/register
exports.register = async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required', code: 'VALIDATION_ERROR' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address', code: 'VALIDATION_ERROR' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters', code: 'VALIDATION_ERROR' });
  }

  try {
    const existing = await db('users').where({ email: email.toLowerCase() }).first();
    if (existing) {
      return res.status(409).json({ error: 'Email already registered', code: 'EMAIL_EXISTS' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const [user] = await db('users')
      .insert({ name, email: email.toLowerCase(), password_hash })
      .returning(['id', 'email', 'name']);

    const { token } = signToken(user.id);
    return res.status(201).json({ userId: user.id, email: user.email, name: user.name, token });
  } catch (err) {
    console.error('Register error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};

// POST /auth/login
exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required', code: 'VALIDATION_ERROR' });
  }

  try {
    const user = await db('users').where({ email: email.toLowerCase() }).first();
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    const { token } = signToken(user.id);
    return res.status(200).json({
      token,
      userId:        user.id,
      name:          user.name,
      email:         user.email,
      walletAddress: user.wallet_address || null,
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};

// POST /auth/logout
exports.logout = async (req, res) => {
  try {
    const { jti, sub, exp } = req.user;
    await db('sessions').insert({
      jti,
      user_id:    sub,
      expires_at: new Date(exp * 1000),
    });
    return res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};

// GET /auth/me
exports.me = async (req, res) => {
  try {
    const user = await db('users')
      .where({ id: req.user.sub })
      .select('id', 'name', 'email', 'wallet_address', 'created_at')
      .first();

    if (!user) {
      return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
    }

    return res.status(200).json({
      userId:        user.id,
      name:          user.name,
      email:         user.email,
      walletAddress: user.wallet_address || null,
      createdAt:     user.created_at,
    });
  } catch (err) {
    console.error('Me error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};

// GET /auth/me/qrcode
exports.qrCode = async (req, res) => {
  try {
    const user = await db('users')
      .where({ id: req.user.sub })
      .select('wallet_address')
      .first();

    if (!user || !user.wallet_address) {
      return res.status(404).json({ error: 'Wallet address not found', code: 'NOT_FOUND' });
    }

    // Generate QR code as a PNG image
    res.setHeader('Content-Type', 'image/png');
    QRCode.toFileStream(res, user.wallet_address, { type: 'png' });
  } catch (err) {
    console.error('QR code error:', err.message);
    return res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
  }
};