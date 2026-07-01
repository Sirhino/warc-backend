// src/services/predictionService.js
const { query, transaction } = require('../db');
const { cacheSet, cacheParsed, cacheDel, invalidate, TTL } = require('../cache');
const { recordBlockchainTx } = require('./vehicleService');

// Get all prediction events
async function getEvents() {
  const cached = await cacheParsed('pred:events');
  if (cached) return cached;

  const result = await query(
    `SELECT pe.*,
       COUNT(ps.id) as stake_count,
       COALESCE(SUM(ps.amount), 0) as total_staked
     FROM prediction_events pe
     LEFT JOIN prediction_stakes ps ON ps.event_id = pe.id
     GROUP BY pe.id
     ORDER BY pe.cutoff DESC`
  );
  const events = result.rows.map(e => ({
    ...e,
    participants: e.participants || [],
    result: e.result || null
  }));
  await cacheSet('pred:events', events, TTL.PRED_EVENT);
  return events;
}

// Admin: save/update all events
async function saveEvents(events) {
  for (const ev of events) {
    await query(
      `INSERT INTO prediction_events (id, series, name, event_date, event_time, circuit, status, participants, cutoff, result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         series=$2, name=$3, event_date=$4, event_time=$5, circuit=$6,
         status=$7, participants=$8, cutoff=$9, result=$10, updated_at=NOW()`,
      [ev.id, ev.series, ev.name, ev.date || ev.event_date, ev.time || ev.event_time,
       ev.circuit, ev.status, JSON.stringify(ev.participants || []),
       ev.cutoff || null, ev.result ? JSON.stringify(ev.result) : null]
    );
  }
  await cacheDel('pred:events');
}

// Place a prediction stake
async function placeStake({ wallet, eventId, predictionP1, predictionP2, predictionP3, amount, currency, txHash }) {
  const w = wallet.toLowerCase();

  // Verify event exists and cutoff hasn't passed
  const evResult = await query('SELECT * FROM prediction_events WHERE id = $1', [eventId]);
  if (evResult.rows.length === 0) throw new Error('Event not found');
  const event = evResult.rows[0];
  if (event.cutoff && new Date(event.cutoff) < new Date()) {
    throw new Error('Prediction cutoff has passed');
  }

  const stakeRef = 'ps_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const result = await query(
    `INSERT INTO prediction_stakes
       (stake_ref, wallet, event_id, prediction_p1, prediction_p2, prediction_p3, amount, currency, tx_hash, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'locked')
     RETURNING *`,
    [stakeRef, w, eventId, predictionP1, predictionP2 || null, predictionP3 || null,
     amount, currency || 'USDC', txHash]
  );

  // Record on-chain tx
  await recordBlockchainTx({ txHash, wallet: w, txType: 'prediction', amountUsdc: amount });

  await cacheDel('pred:events', `pred:user:${w}`);
  return result.rows[0];
}

// Get stakes for a wallet
async function getWalletStakes(wallet) {
  const w = wallet.toLowerCase();
  const cached = await cacheParsed(`pred:user:${w}`);
  if (cached) return cached;

  const result = await query(
    `SELECT ps.*, pe.name as event_name, pe.series, pe.status as event_status
     FROM prediction_stakes ps
     LEFT JOIN prediction_events pe ON pe.id = ps.event_id
     WHERE ps.wallet = $1
     ORDER BY ps.staked_at DESC`,
    [w]
  );
  await cacheSet(`pred:user:${w}`, result.rows, TTL.USER_PROFILE);
  return result.rows;
}

// Admin: get all stakes
async function getAllStakes() {
  const result = await query(
    `SELECT ps.*, pe.name as event_name
     FROM prediction_stakes ps
     LEFT JOIN prediction_events pe ON pe.id = ps.event_id
     ORDER BY ps.staked_at DESC LIMIT 500`
  );
  return result.rows;
}

// Admin: resolve prediction event and distribute winnings
async function resolveEvent({ eventId, winner }) {
  const evResult = await query('SELECT * FROM prediction_events WHERE id = $1', [eventId]);
  if (evResult.rows.length === 0) throw new Error('Event not found');

  const stakesResult = await query(
    `SELECT * FROM prediction_stakes WHERE event_id = $1 AND status = 'locked'`,
    [eventId]
  );
  const stakes = stakesResult.rows;
  const totalPool = stakes.reduce((sum, s) => sum + parseFloat(s.amount || 0), 0);
  const winners = stakes.filter(s => s.prediction_p1 === winner);
  const losers = stakes.filter(s => s.prediction_p1 !== winner);
  const payoutPerWinner = winners.length > 0 ? +(totalPool * 0.9 / winners.length).toFixed(6) : 0;

  await transaction(async (client) => {
    // Close the event
    await client.query(
      `UPDATE prediction_events SET status='closed', result=$1, updated_at=NOW() WHERE id=$2`,
      [JSON.stringify({ p1: winner }), eventId]
    );
    // Mark winners
    for (const s of winners) {
      await client.query(
        `UPDATE prediction_stakes SET status='won', payout_amount=$1, resolved_at=NOW() WHERE id=$2`,
        [payoutPerWinner, s.id]
      );
      // Boost winner reputation
      await client.query(
        `UPDATE users SET reputation=reputation+25, updated_at=NOW() WHERE wallet=$1`,
        [s.wallet]
      );
    }
    // Mark losers
    for (const s of losers) {
      await client.query(
        `UPDATE prediction_stakes SET status='lost', payout_amount=0, resolved_at=NOW() WHERE id=$2`,
        [s.id]
      );
    }
  });

  await cacheDel('pred:events');
  await invalidate.leaderboard();

  return {
    eventId, winner, totalPool,
    winners: winners.length, losers: losers.length,
    payoutPerWinner
  };
}

// Prediction stats for analytics
async function getPredictionStats() {
  const result = await query(`
    SELECT
      COUNT(*) as total_stakes,
      COALESCE(SUM(amount), 0) as total_usdc_staked,
      COUNT(*) FILTER (WHERE status='won') as total_wins,
      COUNT(*) FILTER (WHERE status='lost') as total_losses,
      COUNT(DISTINCT wallet) as unique_predictors
    FROM prediction_stakes
  `);
  return result.rows[0];
}

module.exports = {
  getEvents, saveEvents, placeStake,
  getWalletStakes, getAllStakes, resolveEvent, getPredictionStats
};
