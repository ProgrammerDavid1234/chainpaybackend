const NodeCache = require('node-cache');

const CACHE_TTL = {
  BALANCE:      30,
  GAS_ESTIMATE: 15,
  TRANSACTIONS: 20,
};

const cache = new NodeCache({ checkperiod: 10, useClones: false });

const keys = {
  balance:      (userId)               => `balance:${userId}`,
  gasEstimate:  (to, amountEth)        => `gas:${to}:${amountEth}`,
  transactions: (userId, filter, page) => `txlist:${userId}:${filter}:${page}`,
};

const get            = (key)             => cache.get(key);
const set            = (key, value, ttl) => cache.set(key, value, ttl);
const del            = (key)             => cache.del(key);
const invalidateUser = (userId) => {
  const userKeys = cache.keys().filter((k) => k.includes(`:${userId}`));
  if (userKeys.length) cache.del(userKeys);
};

module.exports = { get, set, del, invalidateUser, keys, CACHE_TTL };
