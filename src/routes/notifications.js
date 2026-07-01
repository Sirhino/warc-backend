// src/routes/notifications.js
const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const ns = require('../services/notificationService');

// POST /api/notifications/subscribe
router.post('/subscribe', async (req, res) => {
  try {
    const { email, wallet, type } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    await ns.subscribe({ email, wallet, type });
    res.json({ success: true, message: 'Subscribed to notifications!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/notifications/unsubscribe
router.post('/unsubscribe', async (req, res) => {
  try {
    const { email, type } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    await ns.unsubscribe({ email, type });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/notifications/send (admin)
router.post('/send', requireAdmin, async (req, res) => {
  try {
    const { type, subject, message } = req.body;
    const sent = await ns.broadcastToSubscribers({ type, subject, message });
    res.json({ success: true, sent });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/notifications/subscriptions (admin)
router.get('/subscriptions', requireAdmin, async (req, res) => {
  try {
    const [subscriptions, emailLog] = await Promise.all([
      ns.getSubscriptions(),
      ns.getEmailLog(20)
    ]);
    res.json({ subscriptions, emailLog, total: subscriptions.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
