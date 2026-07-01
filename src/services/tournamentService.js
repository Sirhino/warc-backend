// src/services/tournamentService.js
const { query, transaction } = require('../db');
const { cacheSet, cacheParsed, invalidate, lbUpdate, lbTop, queueAdd, queueGet, TTL } = require('../cache');
const { recordBlockchainTx } = require('./vehicleService');
const notificationService = require('./notificationService');

// Get all tournaments (Redis cache → DB fallback)
async function getTournaments() {
  const cached = await cacheParsed('trn:all');
  if (cached) return cached;

  const result = await query(
    `SELECT t.*,
       COUNT(DISTINCT r.wallet) as player_count
     FROM tournaments t
     LEFT JOIN tournament_registrations r ON r.tournament_id = t.id
     GROUP BY t.id
     ORDER BY t.start_time ASC`
  );
  const tournaments = result.rows;
  await cacheSet('trn:all', tournaments, TTL.TOURNAMENT);
  return tournaments;
}

// Get single tournament
async function getTournament(id) {
  const result = await query(
    `SELECT t.*, COUNT(DISTINCT r.wallet) as player_count
     FROM tournaments t
     LEFT JOIN tournament_registrations r ON r.tournament_id = t.id
     WHERE t.id = $1
     GROUP BY t.id`,
    [id]
  );
  return result.rows[0] || null;
}

// Register a player + stake USDC
async function registerPlayer({ tournamentId, wallet, stake, txHash, blockNumber }) {
  const w = wallet.toLowerCase();
  const trn = await getTournament(tournamentId);
  if (!trn) throw new Error('Tournament not found');
  if (trn.status !== 'open') throw new Error('Tournament is not open for registration');
  if (parseFloat(stake) < parseFloat(trn.min_stake)) {
    throw new Error(`Minimum stake is ${trn.min_stake} USDC`);
  }

  await transaction(async (client) => {
    // Insert registration (UNIQUE constraint prevents double-entry)
    await client.query(
      `INSERT INTO tournament_registrations (tournament_id, wallet, stake_amount, tx_hash, status)
       VALUES ($1,$2,$3,$4,'locked')`,
      [tournamentId, w, stake, txHash]
    );

    // Check if tournament is now full → mark live
    const countResult = await client.query(
      'SELECT COUNT(*) as cnt FROM tournament_registrations WHERE tournament_id = $1',
      [tournamentId]
    );
    const count = parseInt(countResult.rows[0].cnt);
    if (count >= trn.max_players) {
      await client.query(
        `UPDATE tournaments SET status='live', updated_at=NOW() WHERE id=$1`,
        [tournamentId]
      );
      // Notify all participants
      notificationService.notifyTournamentStart(tournamentId, trn.name).catch(() => {});
    }
  });

  // Record on-chain tx
  await recordBlockchainTx({ txHash, wallet: w, txType: 'stake', amountUsdc: stake });

  // Add to matchmaking queue in Redis
  await queueAdd(tournamentId, w);

  // Invalidate cache
  await invalidate.tournament(tournamentId);

  return { success: true, tournament: trn.name, stake };
}

// Admin: create tournament
async function createTournament({ id, name, maxPlayers, startTime, prizePool, minStake, vehicleType, status }) {
  const tid = id || 'trn_' + Date.now();
  const result = await query(
    `INSERT INTO tournaments (id, name, max_players, start_time, prize_pool, min_stake, vehicle_type, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET
       name=$2, max_players=$3, start_time=$4, prize_pool=$5, min_stake=$6, vehicle_type=$7, status=$8, updated_at=NOW()
     RETURNING *`,
    [tid, name, maxPlayers || 8, startTime, prizePool || 0, minStake || 5, vehicleType || 'all', status || 'open']
  );
  await invalidate.tournament(tid);
  return result.rows[0];
}

// Admin: finalize tournament result + distribute prizes (60/30/10)
async function finalizeResult({ tournamentId, results, distributionTxHash }) {
  const trn = await getTournament(tournamentId);
  if (!trn) throw new Error('Tournament not found');

  const stakesResult = await query(
    `SELECT COALESCE(SUM(stake_amount), 0) as total FROM tournament_registrations WHERE tournament_id=$1`,
    [tournamentId]
  );
  const totalStaked = parseFloat(stakesResult.rows[0].total) || 0;
  const p1Prize = +(totalStaked * 0.60).toFixed(6);
  const p2Prize = +(totalStaked * 0.30).toFixed(6);
  const p3Prize = +(totalStaked * 0.10).toFixed(6);

  await transaction(async (client) => {
    // Close tournament
    await client.query(
      `UPDATE tournaments SET status='closed', updated_at=NOW() WHERE id=$1`,
      [tournamentId]
    );
    // Release all stakes
    await client.query(
      `UPDATE tournament_registrations SET status='released', released_at=NOW() WHERE tournament_id=$1`,
      [tournamentId]
    );
    // Insert result record
    await client.query(
      `INSERT INTO tournament_results
         (tournament_id, p1_wallet, p2_wallet, p3_wallet, total_staked, p1_prize, p2_prize, p3_prize, distribution_tx)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tournamentId, results.p1 || null, results.p2 || null, results.p3 || null,
       totalStaked, p1Prize, p2Prize, p3Prize, distributionTxHash || null]
    );
    // Update winner stats
    if (results.p1) {
      await client.query(
        `UPDATE users SET wins=wins+1, reputation=reputation+50, updated_at=NOW() WHERE wallet=$1`,
        [results.p1.toLowerCase()]
      );
    }
  });

  await invalidate.tournament(tournamentId);
  await invalidate.leaderboard();

  // Send result notifications
  notificationService.notifyTournamentResult(tournamentId, trn.name, results, { p1Prize, p2Prize, p3Prize }).catch(() => {});

  return { totalStaked, distribution: { p1: p1Prize, p2: p2Prize, p3: p3Prize }, results };
}

// Get registrations / stakes for a tournament
async function getTournamentStakes(tournamentId) {
  const result = await query(
    `SELECT r.*, u.x_handle
     FROM tournament_registrations r
     LEFT JOIN users u ON u.wallet = r.wallet
     WHERE r.tournament_id = $1
     ORDER BY r.registered_at ASC`,
    [tournamentId]
  );
  return result.rows;
}

// Get all stakes (admin)
async function getAllStakes() {
  const result = await query(
    `SELECT r.*, t.name as tournament_name
     FROM tournament_registrations r
     LEFT JOIN tournaments t ON t.id = r.tournament_id
     ORDER BY r.registered_at DESC LIMIT 200`
  );
  return result.rows;
}

// Get tournament results
async function getTournamentResults(tournamentId) {
  const result = await query(
    'SELECT * FROM tournament_results WHERE tournament_id = $1',
    [tournamentId]
  );
  return result.rows[0] || null;
}

// Get matchmaking queue from Redis
async function getMatchmakingQueue(tournamentId) {
  return queueGet(tournamentId);
}

module.exports = {
  getTournaments, getTournament, registerPlayer,
  createTournament, finalizeResult,
  getTournamentStakes, getAllStakes, getTournamentResults,
  getMatchmakingQueue
};
