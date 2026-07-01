// src/routes/predictions.js
const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const ps = require('../services/predictionService');

// GET /api/events
router.get('/events', async (req, res) => {
  try {
    const events = await ps.getEvents();
    res.json({ events, total: events.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/events (admin)
router.post('/events', requireAdmin, async (req, res) => {
  try {
    const { events } = req.body;
    if (!events || !Array.isArray(events)) return res.status(400).json({ error: 'events array required' });
    await ps.saveEvents(events);
    res.json({ success: true, total: events.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/predictions/stake
router.post('/stake', async (req, res) => {
  try {
    const { wallet, eventId, prediction, predictionP1, amount, txHash, currency } = req.body;
    const p1 = predictionP1 || prediction;
    if (!wallet || !eventId || !p1 || !amount) {
      return res.status(400).json({ error: 'wallet, eventId, prediction, amount required' });
    }
    const stake = await ps.placeStake({ wallet, eventId, predictionP1: p1, amount, currency, txHash });
    res.json({ success: true, stake });
  } catch (e) {
    const code = e.message.includes('not found') ? 404 : e.message.includes('cutoff') ? 400 : 500;
    res.status(code).json({ error: e.message });
  }
});

// GET /api/predictions/stakes/:wallet
router.get('/stakes/:wallet', async (req, res) => {
  try {
    const stakes = await ps.getWalletStakes(req.params.wallet);
    const wins = stakes.filter(s => s.status === 'won').length;
    const losses = stakes.filter(s => s.status === 'lost').length;
    const pending = stakes.filter(s => s.status === 'locked').length;
    res.json({ wallet: req.params.wallet, stakes, total: stakes.length, wins, losses, pending });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/predictions/stakes (admin)
router.get('/stakes', requireAdmin, async (req, res) => {
  try {
    const stakes = await ps.getAllStakes();
    res.json({ stakes, total: stakes.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/predictions/resolve (admin)
router.post('/resolve', requireAdmin, async (req, res) => {
  try {
    const { eventId, winner } = req.body;
    if (!eventId || !winner) return res.status(400).json({ error: 'eventId and winner required' });
    const result = await ps.resolveEvent({ eventId, winner });
    res.json({ success: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/predictions/stats
router.get('/stats', async (req, res) => {
  try { res.json(await ps.getPredictionStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
