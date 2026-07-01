// src/cache/index.js
// Upstash Redis — real-time cache, leaderboards, sessions, queues
// Never used as permanent storage. All data must exist in PostgreSQL first.

const { Redis } = require('@upstash/redis');

let redis;

function getRedis() {
  if (!redis) {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      console.warn('[CACHE] Upstash Redis not configured — caching disabled, using pass-through');
      return null;
    }
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    console.log('[CACHE] Upstash Redis connected');
  }
  return redis;
}

// TTL constants (seconds)
const TTL = {
  LEADERBOARD:   60,       // 1 minute
  USER_PROFILE:  300,      // 5 minutes
  VEHICLE:       300,      // 5 minutes
  TOURNAMENT:    30,       // 30 seconds (live data)
  PRED_EVENT:    120,      // 2 minutes
  NFT_VERIFY:    600,      // 10 minutes
  MINT_STATS:    30,       // 30 seconds
  SESSION:       3600,     // 1 hour
  MATCH_STATE:   60,       // 1 minute
};

// ── Generic helpers ─────────────────────────────────────────────

async function cacheGet(key) {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.get(key);
  } catch (e) {
    console.warn('[CACHE] Get error:', e.message);
    return null;
  }
}

async function cacheSet(key, value, ttl) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(key, typeof value === 'string' ? value : JSON.stringify(value), { ex: ttl });
  } catch (e) {
    console.warn('[CACHE] Set error:', e.message);
  }
}

async function cacheDel(...keys) {
  const r = getRedis();
  if (!r) return;
  try {
    for (const key of keys) await r.del(key);
  } catch (e) {
    console.warn('[CACHE] Del error:', e.message);
  }
}

async function cacheParsed(key) {
  const raw = await cacheGet(key);
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

// ── Leaderboard (Redis Sorted Set) ────────────────────────────

async function lbUpdate(board, member, score) {
  const r = getRedis();
  if (!r) return;
  try { await r.zadd(`lb:${board}`, { score, member }); } catch (e) { console.warn('[CACHE] LB update error:', e.message); }
}

async function lbTop(board, count = 20) {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.zrange(`lb:${board}`, 0, count - 1, { rev: true, withScores: true });
  } catch (e) {
    console.warn('[CACHE] LB top error:', e.message);
    return null;
  }
}

// ── Matchmaking queue ─────────────────────────────────────────

async function queueAdd(tournamentId, wallet) {
  const r = getRedis();
  if (!r) return;
  try { await r.sadd(`queue:${tournamentId}`, wallet); } catch (e) { console.warn('[CACHE] Queue error:', e.message); }
}

async function queueGet(tournamentId) {
  const r = getRedis();
  if (!r) return [];
  try { return await r.smembers(`queue:${tournamentId}`) || []; } catch (e) { return []; }
}

// ── Session management ────────────────────────────────────────

async function sessionSet(wallet, data) {
  await cacheSet(`session:${wallet.toLowerCase()}`, data, TTL.SESSION);
}

async function sessionGet(wallet) {
  return cacheParsed(`session:${wallet.toLowerCase()}`);
}

async function sessionDel(wallet) {
  await cacheDel(`session:${wallet.toLowerCase()}`);
}

// ── Tournament live state ─────────────────────────────────────

async function setTournamentState(id, state) {
  await cacheSet(`trn:live:${id}`, state, TTL.TOURNAMENT);
}

async function getTournamentState(id) {
  return cacheParsed(`trn:live:${id}`);
}

// ── Notification queue ────────────────────────────────────────

async function notifQueue(email, subject, body) {
  const r = getRedis();
  if (!r) return;
  try {
    await r.lpush('notif:queue', JSON.stringify({ email, subject, body, queuedAt: new Date().toISOString() }));
    await r.expire('notif:queue', 86400); // 24h max
  } catch (e) { console.warn('[CACHE] Notif queue error:', e.message); }
}

async function notifDequeue() {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.rpop('notif:queue');
    return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
  } catch (e) { return null; }
}

// Cache invalidation helpers
const invalidate = {
  user:       (wallet) => cacheDel(`user:${wallet}`, `session:${wallet}`),
  leaderboard: ()      => cacheDel('lb:wins', 'lb:reputation', 'lb:races'),
  tournament:  (id)    => cacheDel(`trn:${id}`, `trn:live:${id}`, 'trn:all'),
  predictions: ()      => cacheDel('pred:events', 'pred:stats'),
  mintStats:   ()      => cacheDel('mint:stats', 'mint:cache'),
};

module.exports = {
  getRedis, cacheGet, cacheSet, cacheDel, cacheParsed,
  lbUpdate, lbTop,
  queueAdd, queueGet,
  sessionSet, sessionGet, sessionDel,
  setTournamentState, getTournamentState,
  notifQueue, notifDequeue,
  invalidate, TTL
};
