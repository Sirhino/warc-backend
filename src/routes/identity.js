// src/routes/identity.js
const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const id = require('../services/identityService');

// GET /api/identity/all
router.get('/all', async (req, res) => {
  try {
    const holders = await id.getAllVerified();
    res.json({ holders, total: holders.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/identity/stats
router.get('/stats', async (req, res) => {
  try { res.json(await id.getStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/identity/x/:handle
router.get('/x/:handle', async (req, res) => {
  try {
    const user = await id.getByHandle(req.params.handle);
    if (!user) return res.json({ verified: false, handle: req.params.handle });
    res.json({ verified: true, wallet: user.wallet, fullWallet: user.wallet, ...user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/identity/:wallet
router.get('/:wallet', async (req, res) => {
  try {
    const user = await id.getUser(req.params.wallet);
    if (!user || !user.verified) return res.json({ verified: false, wallet: req.params.wallet });
    res.json({ verified: true, ...user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/identity/nonce
router.post('/nonce', async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: 'Wallet required' });
    res.json(await id.generateNonce(wallet));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/identity/verify
router.post('/verify', async (req, res) => {
  try {
    const { wallet, xHandle } = req.body;
    if (!wallet || !xHandle) return res.status(400).json({ error: 'Wallet and X handle required' });
    await id.getOrCreateUser(wallet);
    const user = await id.verifyIdentity(req.body);
    res.json({ success: true, message: 'Identity verified!', wallet, xHandle: user.x_handle });
  } catch (e) {
    if (e.message.includes('already linked')) return res.status(409).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/identity/:wallet
router.delete('/:wallet', requireAdmin, async (req, res) => {
  try {
    await id.unlinkIdentity(req.params.wallet);
    res.json({ success: true, message: 'Identity unlinked' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
