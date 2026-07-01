// src/routes/tournaments.js
const router = require('express').Router();
const { requireAdmin } = require('../middleware/auth');
const ts = require('../services/tournamentService');

// GET /api/tournaments
router.get('/', async (req, res) => {
  try {
    const tournaments = await ts.getTournaments();
    res.json({ tournaments, total: tournaments.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/tournaments (admin: create)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const trn = await ts.createTournament(req.body);
    res.json({ success: true, tournament: trn });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/tournaments/register
router.post('/register', async (req, res) => {
  try {
    const { wallet, tournamentId, stake, txHash, blockNumber } = req.body;
    if (!wallet || !tournamentId || !stake) return res.status(400).json({ error: 'wallet, tournamentId, stake required' });
    const result = await ts.registerPlayer({ tournamentId, wallet, stake: parseFloat(stake), txHash, blockNumber });
    res.json(result);
  } catch (e) {
    const code = e.message.includes('not found') ? 404 : e.message.includes('Already') ? 409 : 400;
    res.status(code).json({ error: e.message });
  }
});

// GET /api/tournaments/stakes (admin)
router.get('/stakes', requireAdmin, async (req, res) => {
  try {
    const stakes = await ts.getAllStakes();
    res.json({ stakes, total: stakes.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/tournaments/:id
router.get('/:id', async (req, res) => {
  try {
    const trn = await ts.getTournament(req.params.id);
    if (!trn) return res.status(404).json({ error: 'Not found' });
    const stakes = await ts.getTournamentStakes(req.params.id);
    res.json({ ...trn, stakes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/tournaments/:id/result (admin)
router.post('/:id/result', requireAdmin, async (req, res) => {
  try {
    const { results, distributionTxHash } = req.body;
    if (!results) return res.status(400).json({ error: 'results required' });
    const data = await ts.finalizeResult({ tournamentId: req.params.id, results, distributionTxHash });
    res.json({ success: true, ...data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/tournaments/:id/queue (matchmaking)
router.get('/:id/queue', async (req, res) => {
  try {
    const queue = await ts.getMatchmakingQueue(req.params.id);
    res.json({ tournamentId: req.params.id, queue, count: queue.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
