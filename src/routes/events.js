const router = require('express').Router();
const auth   = require('../middleware/auth');

// Store connected clients: userId -> res
const clients = new Map();

// Send event to a specific user
const sendToUser = (userId, event, data) => {
  const client = clients.get(userId);
  if (client) {
    client.write(`event: ${event}\n`);
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
};

// GET /events/stream
router.get('/stream', auth, (req, res) => {
  const userId = req.user.sub;

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Register client
  clients.set(userId, res);
  console.log(`SSE client connected: ${userId}`);

  // Send heartbeat every 25 seconds
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 25000);

  // Send welcome event
  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ message: 'SSE connected', timestamp: new Date() })}\n\n`);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(userId);
    console.log(`SSE client disconnected: ${userId}`);
  });
});

module.exports = { router, sendToUser };