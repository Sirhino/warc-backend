// src/services/vehicleService.js
const { query, transaction } = require('../db');
const { cacheSet, cacheParsed, cacheDel, invalidate, TTL } = require('../cache');

// Upsert vehicle record from on-chain mint event
async function upsertVehicle({ tokenId, ownerWallet, vehicleType = 'car', name, color, txHash, blockNumber }) {
  const result = await query(
    `INSERT INTO vehicles (token_id, owner_wallet, vehicle_type, name, color, tx_hash, block_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (token_id) DO UPDATE SET
       owner_wallet = $2, updated_at = NOW()
     RETURNING *`,
    [String(tokenId), ownerWallet.toLowerCase(), vehicleType, name, color, txHash, blockNumber]
  );
  await cacheDel(`vehicle:${tokenId}`);
  return result.rows[0];
}

// Get all vehicles for a wallet
async function getWalletVehicles(wallet) {
  const w = wallet.toLowerCase();
  const cached = await cacheParsed(`vehicles:${w}`);
  if (cached) return cached;

  const result = await query(
    `SELECT v.*, 
       COALESCE(json_agg(u.*) FILTER (WHERE u.id IS NOT NULL), '[]') as upgrades
     FROM vehicles v
     LEFT JOIN upgrades u ON u.wallet = v.owner_wallet AND u.token_id = v.token_id
     WHERE v.owner_wallet = $1
     GROUP BY v.id
     ORDER BY v.minted_at DESC`,
    [w]
  );
  await cacheSet(`vehicles:${w}`, result.rows, TTL.VEHICLE);
  return result.rows;
}

// Get a single vehicle by token ID
async function getVehicle(tokenId) {
  const cached = await cacheParsed(`vehicle:${tokenId}`);
  if (cached) return cached;

  const result = await query(
    `SELECT v.*,
       COALESCE(json_agg(u.*) FILTER (WHERE u.id IS NOT NULL), '[]') as upgrades
     FROM vehicles v
     LEFT JOIN upgrades u ON u.wallet = v.owner_wallet AND u.token_id = v.token_id
     WHERE v.token_id = $1
     GROUP BY v.id`,
    [String(tokenId)]
  );
  if (result.rows.length === 0) return null;
  await cacheSet(`vehicle:${tokenId}`, result.rows[0], TTL.VEHICLE);
  return result.rows[0];
}

// Record a race result
async function recordRace({ wallet, tokenId, track, position, won, bestLapMs, topSpeed, repGained }) {
  const w = wallet.toLowerCase();
  await query(
    `INSERT INTO races (wallet, token_id, track, position, won, best_lap_ms, top_speed, rep_gained)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [w, String(tokenId || ''), track || '', position || 0, !!won, bestLapMs || null, topSpeed || 0, repGained || 10]
  );
  // Update vehicle stats
  if (tokenId) {
    await query(
      `UPDATE vehicles SET
         total_races = total_races + 1,
         wins = wins + $1,
         losses = losses + $2,
         level = GREATEST(1, FLOOR(wins / 5) + 1),
         updated_at = NOW()
       WHERE token_id = $3`,
      [won ? 1 : 0, won ? 0 : 1, String(tokenId)]
    );
    await cacheDel(`vehicle:${tokenId}`, `vehicles:${w}`);
  }
}

// Get race history for a wallet
async function getRaceHistory(wallet, limit = 20) {
  const result = await query(
    `SELECT * FROM races WHERE wallet = $1 ORDER BY raced_at DESC LIMIT $2`,
    [wallet.toLowerCase(), limit]
  );
  return result.rows;
}

// Purchase an upgrade (with duplicate check)
async function purchaseUpgrade({ wallet, upgradeId, name, category, priceUsdc, txHash, blockNumber, tokenId }) {
  const w = wallet.toLowerCase();
  try {
    const result = await query(
      `INSERT INTO upgrades (wallet, token_id, upgrade_id, name, category, price_usdc, tx_hash, block_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (wallet, upgrade_id) DO NOTHING
       RETURNING *`,
      [w, tokenId ? String(tokenId) : null, upgradeId, name, category, priceUsdc, txHash, blockNumber]
    );
    if (result.rows.length === 0) throw new Error('Upgrade already purchased');

    // Update vehicle stats based on upgrade category
    if (tokenId) {
      const statMap = { Engine: 'top_speed', Tires: 'handling', Turbo: 'acceleration' };
      const col = statMap[category];
      if (col) {
        await query(`UPDATE vehicles SET ${col} = LEAST(200, ${col} + 8), updated_at = NOW() WHERE token_id = $1`, [String(tokenId)]);
      }
    }

    // Update user reputation
    await query(
      `UPDATE users SET reputation = reputation + $1, updated_at = NOW() WHERE wallet = $2`,
      [Math.floor((priceUsdc || 5) * 2), w]
    );

    // Record blockchain tx
    await recordBlockchainTx({ txHash, wallet: w, txType: 'upgrade', amountUsdc: priceUsdc, tokenId });

    await cacheDel(`vehicles:${w}`, `vehicle:${tokenId}`);
    await invalidate.user(w);
    return result.rows[0];
  } catch (e) {
    if (e.message === 'Upgrade already purchased') throw e;
    throw new Error(`Failed to record upgrade: ${e.message}`);
  }
}

// Get upgrades for a wallet
async function getWalletUpgrades(wallet) {
  const result = await query(
    `SELECT * FROM upgrades WHERE wallet = $1 ORDER BY purchased_at DESC`,
    [wallet.toLowerCase()]
  );
  return result.rows;
}

// Record a blockchain transaction in the ledger
async function recordBlockchainTx({ txHash, wallet, txType, amountUsdc, tokenId, blockNumber }) {
  if (!txHash || txHash === 'testnet_sim') return;
  await query(
    `INSERT INTO blockchain_txs (tx_hash, wallet, tx_type, amount_usdc, token_id, block_number)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (tx_hash) DO NOTHING`,
    [txHash, wallet?.toLowerCase(), txType, amountUsdc, tokenId ? String(tokenId) : null, blockNumber || null]
  );
}

// Get leaderboard from DB (used as cache fallback)
async function getLeaderboard(limit = 20) {
  const result = await query(
    `SELECT u.wallet, u.wins, u.races_played, u.reputation, u.level,
       v.token_id, u.x_handle
     FROM users u
     LEFT JOIN vehicles v ON v.owner_wallet = u.wallet
     WHERE u.races_played > 0 OR u.wins > 0
     ORDER BY u.wins DESC, u.reputation DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// Pair real-world car with NFT (VIN Bridge)
async function pairCarRecord({ wallet, nftId, make, model, year, vin, color, mileage, recordId }) {
  const existing = await query(
    'SELECT id FROM car_records WHERE nft_id = $1 AND wallet = $2',
    [nftId, wallet.toLowerCase()]
  );
  if (existing.rows.length > 0) throw new Error('NFT already paired with a car');
  const rid = recordId || 'REC-' + Date.now();
  const result = await query(
    `INSERT INTO car_records (record_id, wallet, nft_id, make, model, year, vin, color, mileage)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [rid, wallet.toLowerCase(), nftId, make, model, year, vin, color, mileage]
  );
  return result.rows[0];
}

async function getCarRecords(wallet) {
  const result = await query(
    'SELECT * FROM car_records WHERE wallet = $1 ORDER BY paired_at DESC',
    [wallet.toLowerCase()]
  );
  return result.rows;
}

async function getCarByNft(nftId) {
  const result = await query('SELECT * FROM car_records WHERE nft_id = $1', [nftId]);
  return result.rows[0] || null;
}

async function deleteCarRecord(recordId) {
  await query('DELETE FROM car_records WHERE record_id = $1', [recordId]);
}

module.exports = {
  upsertVehicle, getWalletVehicles, getVehicle,
  recordRace, getRaceHistory,
  purchaseUpgrade, getWalletUpgrades,
  recordBlockchainTx, getLeaderboard,
  pairCarRecord, getCarRecords, getCarByNft, deleteCarRecord
};
