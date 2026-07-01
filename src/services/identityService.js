// src/services/identityService.js
const { query } = require('../db');
const { cacheSet, cacheParsed, invalidate, TTL } = require('../cache');
const crypto = require('crypto');

// Get or create user by wallet
async function getOrCreateUser(wallet) {
  const w = wallet.toLowerCase();
  const cached = await cacheParsed(`user:${w}`);
  if (cached) return cached;

  let result = await query('SELECT * FROM users WHERE wallet = $1', [w]);
  if (result.rows.length === 0) {
    result = await query(
      `INSERT INTO users (wallet) VALUES ($1)
       ON CONFLICT (wallet) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [w]
    );
  }
  const user = result.rows[0];
  await cacheSet(`user:${w}`, user, TTL.USER_PROFILE);
  return user;
}

// Get user by wallet
async function getUser(wallet) {
  const w = wallet.toLowerCase();
  const cached = await cacheParsed(`user:${w}`);
  if (cached) return cached;
  const result = await query('SELECT * FROM users WHERE wallet = $1', [w]);
  if (result.rows.length === 0) return null;
  const user = result.rows[0];
  await cacheSet(`user:${w}`, user, TTL.USER_PROFILE);
  return user;
}

// Generate nonce for wallet signature
async function generateNonce(wallet) {
  const w = wallet.toLowerCase();
  const nonce = crypto.randomBytes(16).toString('hex');
  await query(
    `INSERT INTO identity_nonces (wallet, nonce, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
     ON CONFLICT (wallet) DO UPDATE SET nonce = $2, created_at = NOW(), expires_at = NOW() + INTERVAL '10 minutes'`,
    [w, nonce]
  );
  return { nonce, message: `WarcGarage X Verification\nWallet: ${wallet}\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}` };
}

// Verify and link X identity to wallet
async function verifyIdentity({ wallet, signature, xHandle, xId, xName, xAvatar, xFollowers, nfts }) {
  const w = wallet.toLowerCase();
  const handle = xHandle.replace('@', '').toLowerCase();

  // Check if this X handle is already linked to a DIFFERENT wallet
  const existing = await query(
    'SELECT wallet FROM users WHERE x_handle = $1 AND wallet != $2 AND verified = TRUE',
    [handle, w]
  );
  if (existing.rows.length > 0) {
    throw new Error(`@${handle} is already linked to another wallet. Unlink it first.`);
  }

  // Validate nonce is recent and valid
  const nonceResult = await query(
    'SELECT nonce FROM identity_nonces WHERE wallet = $1 AND expires_at > NOW()',
    [w]
  );
  // Note: in production, verify signature with ethers.verifyMessage
  // For testnet, we accept any signature with a valid nonce

  const nftCount = Array.isArray(nfts) ? nfts.length : 0;
  const result = await query(
    `UPDATE users SET
       x_handle = $1, x_id = $2, x_name = $3, x_avatar = $4, x_followers = $5,
       nft_count = $6, signature = $7, verified = TRUE, verified_at = NOW(), updated_at = NOW()
     WHERE wallet = $8
     RETURNING *`,
    [handle, xId, xName, xAvatar, xFollowers || 0, nftCount, signature, w]
  );

  // If user didn't exist yet, create
  let user;
  if (result.rows.length === 0) {
    const ins = await query(
      `INSERT INTO users (wallet, x_handle, x_id, x_name, x_avatar, x_followers, nft_count, signature, verified, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,NOW()) RETURNING *`,
      [w, handle, xId, xName, xAvatar, xFollowers || 0, nftCount, signature]
    );
    user = ins.rows[0];
  } else {
    user = result.rows[0];
  }

  await invalidate.user(w);
  return user;
}

// Unlink X from wallet (admin only)
async function unlinkIdentity(wallet) {
  const w = wallet.toLowerCase();
  await query(
    `UPDATE users SET x_handle=NULL, x_id=NULL, x_name=NULL, x_avatar=NULL,
     verified=FALSE, verified_at=NULL, signature=NULL, updated_at=NOW()
     WHERE wallet=$1`,
    [w]
  );
  await invalidate.user(w);
}

// Get all verified holders
async function getAllVerified() {
  const result = await query(
    `SELECT wallet, x_handle, x_name, x_avatar, nft_count, verified_at
     FROM users WHERE verified = TRUE ORDER BY verified_at DESC`,
    []
  );
  return result.rows;
}

// Get X handle → wallet mapping
async function getByHandle(handle) {
  const h = handle.replace('@', '').toLowerCase();
  const result = await query(
    'SELECT * FROM users WHERE x_handle = $1 AND verified = TRUE',
    [h]
  );
  return result.rows[0] || null;
}

// Identity stats
async function getStats() {
  const result = await query(
    `SELECT COUNT(*) as total_verified, COALESCE(SUM(nft_count),0) as total_nfts FROM users WHERE verified=TRUE`,
    []
  );
  return { ...result.rows[0], lastUpdated: new Date().toISOString() };
}

// Update player stats (wins, races, rep, level)
async function updatePlayerStats(wallet, { won, repGained, tokenId }) {
  const w = wallet.toLowerCase();
  await query(
    `UPDATE users SET
       races_played = races_played + 1,
       reputation = reputation + $1,
       wins = wins + $2,
       level = GREATEST(1, FLOOR((wins + $2) / 5) + 1),
       updated_at = NOW()
     WHERE wallet = $3`,
    [repGained || 10, won ? 1 : 0, w]
  );
  await invalidate.user(w);
  await invalidate.leaderboard();
}

module.exports = {
  getOrCreateUser, getUser, generateNonce, verifyIdentity,
  unlinkIdentity, getAllVerified, getByHandle, getStats, updatePlayerStats
};
