require('dotenv').config(); 
const express = require('express'); 
const cors = require('cors'); 
const { ethers } = require('ethers'); 

const app = express(); 
app.use(cors()); 
app.use(express.json());

// ── Arc Testnet connection ───────────────────────── 
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

const ABI = [
  "function totalSupply() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function publicPrice() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function salePhase() view returns (uint8)",
  "function getMintStatus() view returns (uint256, uint256, uint8, uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
];

const contract = new ethers.Contract(
  process.env.CONTRACT_ADDRESS,
  ABI,
  provider
);

// ── In-memory cache ───────────────────────────────
let mintCache = [];
let statsCache = {};
let lastSync = null;

// ── Sync mint events from blockchain ──────────────
async function syncMints() {
  try {
    const filter = contract.filters.Transfer(
      "0x0000000000000000000000000000000000000000",
      null,
      null
    );

    const events = await contract.queryFilter(filter, -2000);

    mintCache = events.reverse().map(e => ({
      wallet: e.args.to,
      tokenId: e.args.tokenId.toString(),
      txHash: e.transactionHash,
      block: e.blockNumber,
      timestamp: new Date().toISOString()
    }));

    const total = await contract.totalSupply();
const maxSupply = await contract.MAX_SUPPLY();
const phase = await contract.salePhase();
const price = await contract.publicPrice();

    statsCache = {
  totalMinted: Number(total),
  maxSupply: Number(maxSupply),
  remaining: Number(maxSupply) - Number(total),
  phase: Number(phase),
  priceUsdc: ethers.formatEther(price),
  contractAddress: process.env.CONTRACT_ADDRESS,
  lastUpdated: new Date().toISOString()
};

    lastSync = new Date().toISOString();
    console.log(`[${lastSync}] Synced: ${mintCache.length} mints`);

  } catch (err) {
    console.error('Sync error:', err.message);
  }
}

// ── API ROUTES ─────────────────────────────────────
app.get('/api/mints', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({
    mints: mintCache.slice(0, limit),
    total: mintCache.length
  });
});

app.get('/api/mints/stats', (req, res) => {
  res.json(statsCache);
});

app.get('/api/holders', (req, res) => {
  const holderMap = {};
  mintCache.forEach(m => {
    const addr = m.wallet.toLowerCase();
    holderMap[addr] = (holderMap[addr] || 0) + 1;
  });

  const holders = Object.entries(holderMap)
    .sort((a,b) => b[1]-a[1])
    .map(([address, count]) => ({ address, count }));

  res.json({ holders, total: holders.length });
});

app.get('/api/wallet/:address', async (req, res) => {
  try {
    const balance = await contract.balanceOf(req.params.address);

    const tokens = mintCache
      .filter(m => m.wallet.toLowerCase() === req.params.address.toLowerCase())
      .map(m => m.tokenId);

    res.json({
      address: req.params.address,
      balance: Number(balance),
      tokens
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', lastSync, mintsLoaded: mintCache.length });
});

// ── START SERVER ───────────────────────────────────
const PORT = process.env.PORT || 3001;

app.listen(PORT, async () => {
  console.log(`Warc Garage backend running on port ${PORT}`);
  await syncMints();
  setInterval(syncMints, 30 * 1000);
});
