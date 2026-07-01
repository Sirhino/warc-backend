// src/services/analyticsService.js
const { query } = require('../db');
const { cacheSet, cacheParsed, TTL } = require('../cache');

async function getPlatformStats() {
  const cached = await cacheParsed('analytics:platform');
  if (cached) return cached;

  const [users, races, upgrades, tournaments, predictions] = await Promise.all([
    query(`SELECT
             COUNT(*) as total_users,
             COUNT(*) FILTER (WHERE verified=TRUE) as verified_users,
             COALESCE(SUM(nft_count),0) as total_nft_holders,
             COALESCE(SUM(reputation),0) as total_reputation
           FROM users`),
    query(`SELECT
             COUNT(*) as total_races,
             COUNT(*) FILTER (WHERE won=TRUE) as total_wins,
             COALESCE(SUM(rep_gained),0) as total_rep_gained
           FROM races`),
    query(`SELECT
             COUNT(*) as total_upgrades,
             COALESCE(SUM(price_usdc),0) as total_usdc_spent
           FROM upgrades`),
    query(`SELECT
             COUNT(*) as total_tournaments,
             COUNT(*) FILTER (WHERE status='live') as live_tournaments,
             COUNT(*) FILTER (WHERE status='closed') as completed_tournaments
           FROM tournaments`),
    query(`SELECT
             COUNT(*) as total_predictions,
             COALESCE(SUM(amount),0) as total_usdc_staked,
             COUNT(DISTINCT wallet) as unique_predictors
           FROM prediction_stakes`)
  ]);

  const stats = {
    users: users.rows[0],
    races: races.rows[0],
    upgrades: upgrades.rows[0],
    tournaments: tournaments.rows[0],
    predictions: predictions.rows[0],
    generatedAt: new Date().toISOString()
  };

  await cacheSet('analytics:platform', stats, 120); // 2 min cache
  return stats;
}

async function getActiveUsers(hours = 24) {
  const result = await query(
    `SELECT COUNT(DISTINCT wallet) as active_users
     FROM races WHERE raced_at > NOW() - INTERVAL '${hours} hours'`
  );
  return result.rows[0];
}

module.exports = { getPlatformStats, getActiveUsers };
