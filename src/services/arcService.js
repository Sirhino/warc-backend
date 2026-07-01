// src/services/arcService.js
// Arc blockchain — source of truth for NFT ownership, USDC, staking
const { ethers } = require('ethers');
const { query } = require('../db');
const { cacheSet, cacheParsed, cacheDel, TTL } = require('../cache');
const { upsertVehicle } = require('./vehicleService');

let provider;
let contract;

const ABI = [
  'function totalSupply() view returns (uint256)',
  'function MAX_SUPPLY() view returns (uint256)',
  'function publicPrice() view returns (uint256)',
  'function whitelistPrice() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function salePhase() view returns (uint8)',
  'function getMintStatus() view returns (uint256, uint256, uint256, uint256, uint256, bool)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
];

function init() {
  try {
    provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.ARC_RPC_URL);
    contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, ABI, provider);
    console.log('[ARC] Connected to Arc Testnet');
  } catch (e) {
    console.error('[ARC] Connection error:', e.message);
  }
}

// Verify wallet holds an NFT (with Redis cache)
async function verifyHolder(wallet) {
  const w = wallet.toLowerCase();
  const cacheKey = `nft:verify:${w}`;
  const cached = await cacheParsed(cacheKey);
  if (cached !== null) return cached;

  if (!contract) return { wallet: w, isHolder: false, balance: 0 };

  try {
    const balance = await contract.balanceOf(wallet);
    const result = { wallet: w, isHolder: Number(balance) > 0, balance: Number(balance) };
    await cacheSet(cacheKey, result, TTL.NFT_VERIFY);
    return result;
  } catch (e) {
    console.error('[ARC] verifyHolder error:', e.message);
    return { wallet: w, isHolder: false, balance: 0, error: e.message };
  }
}

// Sync all mint events from Arc → PostgreSQL
const CHUNK = 9999; // Arc RPC limit
async function syncMints() {
  if (!contract || !provider) return { synced: 0, error: 'Not connected' };
  try {
    const filter = contract.filters.Transfer('0x0000000000000000000000000000000000000000', null, null);
    const latestBlock = await provider.getBlockNumber();
    let fromBlock = 0;
    let allEvents = [];

    while (fromBlock <= latestBlock) {
      const toBlock = Math.min(fromBlock + CHUNK, latestBlock);
      try {
        const chunk = await contract.queryFilter(filter, fromBlock, toBlock);
        allEvents = allEvents.concat(chunk);
      } catch (e) {
        console.warn(`[ARC] Chunk ${fromBlock}-${toBlock} failed:`, e.message);
      }
      fromBlock = toBlock + 1;
    }

    // Upsert all minted vehicles into PostgreSQL
    for (const e of allEvents) {
      await upsertVehicle({
        tokenId: e.args.tokenId.toString(),
        ownerWallet: e.args.to,
        txHash: e.transactionHash,
        blockNumber: e.blockNumber
      }).catch(() => {}); // ignore individual failures
    }

    // Get contract stats
    const [totalMinted, remaining, phase, pubPrice, wlPrice, isRevealed] = await contract.getMintStatus();
    const maxSupply = await contract.MAX_SUPPLY();
    const stats = {
      totalMinted: Number(totalMinted),
      maxSupply: Number(maxSupply),
      remaining: Number(remaining),
      phase: Number(phase),
      publicPrice: ethers.formatUnits(pubPrice, 6),
      whitelistPrice: ethers.formatUnits(wlPrice, 6),
      isRevealed,
      contractAddress: process.env.CONTRACT_ADDRESS,
      lastSynced: new Date().toISOString()
    };

    await cacheSet('mint:stats', stats, TTL.MINT_STATS);
    await cacheSet('mint:count', allEvents.length, TTL.MINT_STATS);

    console.log(`[ARC] Synced ${allEvents.length} mint events`);
    return { synced: allEvents.length, stats };
  } catch (e) {
    console.error('[ARC] syncMints error:', e.message);
    return { synced: 0, error: e.message };
  }
}

// Get mint stats (Redis cache → on-chain)
async function getMintStats() {
  const cached = await cacheParsed('mint:stats');
  if (cached) return cached;
  await syncMints();
  return cacheParsed('mint:stats');
}

// Get recent mints from PostgreSQL (not re-querying chain)
async function getRecentMints(limit = 50) {
  const result = await query(
    `SELECT token_id, owner_wallet, tx_hash, block_number, minted_at
     FROM vehicles ORDER BY minted_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// Get holder stats from PostgreSQL
async function getHolders() {
  const result = await query(
    `SELECT owner_wallet as address, COUNT(*) as count
     FROM vehicles
     GROUP BY owner_wallet
     ORDER BY count DESC`,
    []
  );
  return result.rows;
}

// Get tokens for a wallet
async function getWalletTokens(wallet) {
  const result = await query(
    'SELECT token_id, tx_hash, block_number, minted_at FROM vehicles WHERE owner_wallet = $1',
    [wallet.toLowerCase()]
  );
  return result.rows;
}

module.exports = { init, verifyHolder, syncMints, getMintStats, getRecentMints, getHolders, getWalletTokens };
