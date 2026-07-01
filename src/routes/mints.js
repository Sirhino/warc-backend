// src/routes/mints.js
const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const arc = require('../services/arcService');
const analytics = require('../services/analyticsService');

// GET /api/mints
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const mints = await arc.getRecentMints(limit);
    res.json({ mints, total: mints.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/mints/stats
router.get('/stats', async (req, res) => {
  try { res.json(await arc.getMintStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/mints/holders (also reachable via /api/holders redirect)
router.get('/holders', async (req, res) => {
  try {
    const holders = await arc.getHolders();
    res.json({ holders, total: holders.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/mints/wallet/:address
router.get('/wallet/:address', async (req, res) => {
  try {
    const [verification, tokens] = await Promise.all([
      arc.verifyHolder(req.params.address),
      arc.getWalletTokens(req.params.address)
    ]);
    res.json({ address: req.params.address, balance: verification.balance, tokens: tokens.map(t => t.token_id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/mints/health
router.get('/health', async (req, res) => {
  try {
    const [mintStats, platformStats] = await Promise.all([
      arc.getMintStats().catch(() => null),
      analytics.getPlatformStats().catch(() => null)
    ]);
    res.json({
      status: 'ok',
      database: 'neon_postgresql',
      cache: 'upstash_redis',
      blockchain: 'arc_testnet',
      mintStats,
      platform: platformStats,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    });
  } catch (e) { res.status(500).json({ status: 'error', error: e.message }); }
});

// POST /api/mints/sync (admin: force sync from chain)
router.post('/sync', requireAdmin, async (req, res) => {
  try {
    const result = await arc.syncMints();
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/analytics (admin)
router.get('/analytics', requireAdmin, async (req, res) => {
  try { res.json(await analytics.getPlatformStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
