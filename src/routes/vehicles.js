// src/routes/vehicles.js
const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const vs = require('../services/vehicleService');
const id = require('../services/identityService');
const arc = require('../services/arcService');

// GET /garage/:wallet
router.get('/garage/:wallet', async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();
    const [user, vehicles, history] = await Promise.all([
      id.getOrCreateUser(wallet),
      vs.getWalletVehicles(wallet),
      vs.getRaceHistory(wallet, 20)
    ]);
    res.json({ ...user, ownedTokens: vehicles, raceHistory: history, lastUpdated: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /race/start
router.post('/race/start', async (req, res) => {
  try {
    const { wallet, tokenId, won, repGained, track, position, bestLapMs, topSpeed } = req.body;
    if (!wallet) return res.status(400).json({ error: 'wallet required' });
    await Promise.all([
      vs.recordRace({ wallet, tokenId, track, position, won: !!won, bestLapMs, topSpeed, repGained }),
      id.updatePlayerStats(wallet, { won: !!won, repGained, tokenId })
    ]);
    const user = await id.getUser(wallet);
    res.json({ success: true, player: user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const lb = await vs.getLeaderboard(20);
    const ranked = lb.map((p, i) => ({
      rank: i + 1,
      wallet: p.wallet.slice(0, 6) + '...' + p.wallet.slice(-4),
      tokenId: p.token_id,
      wins: p.wins,
      races: p.races_played,
      rep: p.reputation,
      level: p.level,
      xHandle: p.x_handle
    }));
    res.json({ leaderboard: ranked, total: ranked.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /asset/:trackingId
router.get('/asset/:trackingId', async (req, res) => {
  try {
    const { trackingId } = req.params;
    const tokenId = trackingId.replace('WG-CAR-', '');
    const vehicle = await vs.getVehicle(tokenId);
    if (vehicle) return res.json({ trackingId, ...vehicle, status: 'Active' });
    // Fallback for unknown tokens
    const carNames = ['Phantom GT','Neon Racer','Steel Viper','Arc Blaze','Thunder X','Shadow RS','Ghost Turbo','Nitro King','Volt Storm','Apex One'];
    const n = parseInt(tokenId) || 1;
    res.json({ trackingId, tokenId: n, productName: carNames[n % carNames.length], status: 'Active', level: 1 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── UPGRADES ──────────────────────────────────────────────────

// GET /api/upgrades/:wallet
router.get('/upgrades/:wallet', async (req, res) => {
  try {
    const upgrades = await vs.getWalletUpgrades(req.params.wallet);
    res.json({ wallet: req.params.wallet, upgrades, count: upgrades.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/upgrades
router.post('/upgrades', async (req, res) => {
  try {
    const { wallet, upgradeId, name, category, price, txHash, blockNumber, tokenId } = req.body;
    if (!wallet || !upgradeId) return res.status(400).json({ error: 'wallet and upgradeId required' });
    const record = await vs.purchaseUpgrade({
      wallet, upgradeId, name, category,
      priceUsdc: price, txHash, blockNumber, tokenId
    });
    res.json({ success: true, record });
  } catch (e) {
    if (e.message === 'Upgrade already purchased') return res.status(409).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// GET /api/upgrades (admin: all)
router.get('/upgrades', requireAdmin, async (req, res) => {
  try {
    const result = await require('../db').query('SELECT * FROM upgrades ORDER BY purchased_at DESC LIMIT 500');
    res.json({ upgrades: result.rows, total: result.rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CAR RECORDS (VIN Bridge) ──────────────────────────────────

// GET /api/cars
router.get('/cars', async (req, res) => {
  try {
    const { wallet } = req.query;
    if (wallet) {
      const records = await vs.getCarRecords(wallet);
      return res.json({ records, total: records.length });
    }
    const result = await require('../db').query('SELECT * FROM car_records ORDER BY paired_at DESC LIMIT 200');
    res.json({ records: result.rows, total: result.rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/cars
router.post('/cars', async (req, res) => {
  try {
    const { wallet, make, nftId } = req.body;
    if (!wallet || !make || !nftId) return res.status(400).json({ error: 'wallet, make and nftId required' });
    const record = await vs.pairCarRecord(req.body);
    res.json({ success: true, record });
  } catch (e) {
    if (e.message.includes('already paired')) return res.status(409).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// GET /api/cars/nft/:nftId
router.get('/cars/nft/:nftId', async (req, res) => {
  try {
    const record = await vs.getCarByNft(req.params.nftId);
    if (!record) return res.json({ found: false, nftId: req.params.nftId });
    res.json({ found: true, record });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/cars/:recordId
router.delete('/cars/:recordId', requireAdmin, async (req, res) => {
  try {
    await vs.deleteCarRecord(req.params.recordId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /verify-holder
router.post('/verify-holder', async (req, res) => {
  try {
    const { wallet } = req.body;
    if (!wallet) return res.status(400).json({ error: 'wallet required' });
    res.json(await arc.verifyHolder(wallet));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
