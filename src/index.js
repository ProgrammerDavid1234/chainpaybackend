require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express  = require('express');
const helmet   = require('helmet');
const cors     = require('cors');
const { router: eventsRouter, sendToUser } = require('./routes/events');
const blockchainListener = require('./services/blockchainListener');
const app = express();

// Allow send and connect pages to load external scripts
app.use(['/connect', '/send'], (req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;"
  );
  next();
});

// Serve connect and send pages BEFORE helmet
app.use('/connect', express.static(require('path').join(__dirname, 'public'), { etag: false, maxAge: 0 }));
app.use('/send', (req, res) => res.sendFile(require('path').join(__dirname, 'public', 'send.html')));

// Helmet for all other routes
app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10kb' }));

// Routes
app.use('/api/v1/auth',         require('./routes/auth'));
app.use('/api/v1/wallet',       require('./routes/wallet'));
app.use('/api/v1/transactions', require('./routes/transactions'));
app.use('/api/v1/nfc',          require('./routes/nfc'));
app.use('/api/v1/events',       eventsRouter);

app.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  timestamp: new Date(),
  blockchain: !!process.env.ETHEREUM_NODE_URL ? 'configured' : 'not configured',
}));

app.use((req, res) => res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' }));
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  // Auto-run pending migrations on every startup
  try {
    const knex = require('./db/knex');
    await knex.migrate.latest();
    console.log('Migrations up to date');
  } catch (err) {
    console.error('Migration failed:', err.message);
  }
  console.log('ChainPay backend running on port ' + PORT);
  blockchainListener.setSendToUser(sendToUser);
  await blockchainListener.start();
});
