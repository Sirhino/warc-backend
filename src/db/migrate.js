// src/db/migrate.js
// Run once: node src/db/migrate.js
require('dotenv').config();
const { query } = require('./index');

async function migrate() {
  console.log('[MIGRATE] Starting WarcGarage schema migration...');

  // ── USERS ─────────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      wallet        VARCHAR(42) NOT NULL UNIQUE,
      x_handle      VARCHAR(100),
      x_id          VARCHAR(100),
      x_name        VARCHAR(200),
      x_avatar      TEXT,
      x_followers   INTEGER DEFAULT 0,
      verified      BOOLEAN DEFAULT FALSE,
      verified_at   TIMESTAMPTZ,
      signature     TEXT,
      nft_count     INTEGER DEFAULT 0,
      level         INTEGER DEFAULT 1,
      reputation    INTEGER DEFAULT 100,
      wins          INTEGER DEFAULT 0,
      races_played  INTEGER DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[MIGRATE] ✅ users');

  // ── NFT VEHICLES ──────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id            SERIAL PRIMARY KEY,
      token_id      VARCHAR(50) NOT NULL,
      owner_wallet  VARCHAR(42) NOT NULL,
      vehicle_type  VARCHAR(20) DEFAULT 'car',  -- car | bike | atv
      name          VARCHAR(100),
      color         VARCHAR(20),
      level         INTEGER DEFAULT 1,
      reputation    INTEGER DEFAULT 0,
      total_races   INTEGER DEFAULT 0,
      wins          INTEGER DEFAULT 0,
      losses        INTEGER DEFAULT 0,
      top_speed     INTEGER DEFAULT 150,
      acceleration  INTEGER DEFAULT 60,
      handling      INTEGER DEFAULT 60,
      tx_hash       VARCHAR(100),
      block_number  BIGINT,
      minted_at     TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(token_id)
    );
  `);
  console.log('[MIGRATE] ✅ vehicles');

  // ── VEHICLE UPGRADES ──────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS upgrades (
      id            SERIAL PRIMARY KEY,
      wallet        VARCHAR(42) NOT NULL,
      token_id      VARCHAR(50),
      upgrade_id    VARCHAR(50) NOT NULL,
      name          VARCHAR(100),
      category      VARCHAR(50),
      price_usdc    NUMERIC(12,6),
      tx_hash       VARCHAR(100),
      block_number  BIGINT,
      purchased_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(wallet, upgrade_id)
    );
  `);
  console.log('[MIGRATE] ✅ upgrades');

  // ── RACE HISTORY ─────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS races (
      id            SERIAL PRIMARY KEY,
      wallet        VARCHAR(42) NOT NULL,
      token_id      VARCHAR(50),
      track         VARCHAR(100),
      position      INTEGER,
      won           BOOLEAN,
      best_lap_ms   BIGINT,
      top_speed     NUMERIC(8,2),
      rep_gained    INTEGER DEFAULT 0,
      raced_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[MIGRATE] ✅ races');

  // ── WEB2 CAR RECORDS (VIN Bridge) ────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS car_records (
      id            SERIAL PRIMARY KEY,
      record_id     VARCHAR(50) UNIQUE,
      wallet        VARCHAR(42) NOT NULL,
      nft_id        VARCHAR(50),
      make          VARCHAR(100),
      model         VARCHAR(100),
      year          INTEGER,
      vin           VARCHAR(50),
      color         VARCHAR(50),
      mileage       BIGINT,
      paired_at     TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[MIGRATE] ✅ car_records');

  // ── X IDENTITY NONCES ────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS identity_nonces (
      wallet        VARCHAR(42) PRIMARY KEY,
      nonce         VARCHAR(100) NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      expires_at    TIMESTAMPTZ DEFAULT NOW() + INTERVAL '10 minutes'
    );
  `);
  console.log('[MIGRATE] ✅ identity_nonces');

  // ── TOURNAMENTS ──────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id            VARCHAR(50) PRIMARY KEY,
      name          VARCHAR(200) NOT NULL,
      status        VARCHAR(20) DEFAULT 'open',
      max_players   INTEGER DEFAULT 8,
      start_time    TIMESTAMPTZ,
      prize_pool    NUMERIC(12,6) DEFAULT 0,
      min_stake     NUMERIC(12,6) DEFAULT 5,
      vehicle_type  VARCHAR(20) DEFAULT 'all',
      bracket       JSONB DEFAULT '[]',
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[MIGRATE] ✅ tournaments');

  // ── TOURNAMENT REGISTRATIONS ─────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS tournament_registrations (
      id            SERIAL PRIMARY KEY,
      tournament_id VARCHAR(50) NOT NULL REFERENCES tournaments(id),
      wallet        VARCHAR(42) NOT NULL,
      stake_amount  NUMERIC(12,6),
      tx_hash       VARCHAR(100),
      status        VARCHAR(20) DEFAULT 'locked',  -- locked | released | refunded
      registered_at TIMESTAMPTZ DEFAULT NOW(),
      released_at   TIMESTAMPTZ,
      UNIQUE(tournament_id, wallet)
    );
  `);
  console.log('[MIGRATE] ✅ tournament_registrations');

  // ── TOURNAMENT RESULTS ───────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS tournament_results (
      id              SERIAL PRIMARY KEY,
      tournament_id   VARCHAR(50) NOT NULL REFERENCES tournaments(id),
      p1_wallet       VARCHAR(42),
      p2_wallet       VARCHAR(42),
      p3_wallet       VARCHAR(42),
      total_staked    NUMERIC(12,6),
      p1_prize        NUMERIC(12,6),
      p2_prize        NUMERIC(12,6),
      p3_prize        NUMERIC(12,6),
      distribution_tx VARCHAR(100),
      finalized_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[MIGRATE] ✅ tournament_results');

  // ── PREDICTION EVENTS ────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS prediction_events (
      id            VARCHAR(100) PRIMARY KEY,
      series        VARCHAR(20),
      name          VARCHAR(200),
      event_date    VARCHAR(50),
      event_time    VARCHAR(50),
      circuit       VARCHAR(200),
      status        VARCHAR(20) DEFAULT 'upcoming',
      participants  JSONB DEFAULT '[]',
      cutoff        TIMESTAMPTZ,
      result        JSONB,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[MIGRATE] ✅ prediction_events');

  // ── PREDICTION STAKES ────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS prediction_stakes (
      id            SERIAL PRIMARY KEY,
      stake_ref     VARCHAR(50) UNIQUE,
      wallet        VARCHAR(42) NOT NULL,
      event_id      VARCHAR(100) NOT NULL REFERENCES prediction_events(id),
      prediction_p1 VARCHAR(100),
      prediction_p2 VARCHAR(100),
      prediction_p3 VARCHAR(100),
      amount        NUMERIC(12,6),
      currency      VARCHAR(10) DEFAULT 'USDC',
      tx_hash       VARCHAR(100),
      status        VARCHAR(20) DEFAULT 'locked',  -- locked | won | lost | refunded
      payout_amount NUMERIC(12,6),
      staked_at     TIMESTAMPTZ DEFAULT NOW(),
      resolved_at   TIMESTAMPTZ
    );
  `);
  console.log('[MIGRATE] ✅ prediction_stakes');

  // ── EMAIL SUBSCRIPTIONS ──────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS email_subscriptions (
      id            SERIAL PRIMARY KEY,
      email         VARCHAR(255) NOT NULL,
      wallet        VARCHAR(42),
      sub_type      VARCHAR(50) DEFAULT 'tournament',
      active        BOOLEAN DEFAULT TRUE,
      subscribed_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(email, sub_type)
    );
  `);
  console.log('[MIGRATE] ✅ email_subscriptions');

  // ── EMAIL LOG ────────────────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS email_log (
      id            SERIAL PRIMARY KEY,
      to_email      VARCHAR(255),
      subject       VARCHAR(500),
      status        VARCHAR(20) DEFAULT 'queued',
      resend_id     VARCHAR(100),
      sent_at       TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[MIGRATE] ✅ email_log');

  // ── BLOCKCHAIN TX LEDGER ─────────────────────────────────────
  await query(`
    CREATE TABLE IF NOT EXISTS blockchain_txs (
      id            SERIAL PRIMARY KEY,
      tx_hash       VARCHAR(100) UNIQUE,
      wallet        VARCHAR(42),
      tx_type       VARCHAR(50),  -- mint | upgrade | stake | prediction | release
      amount_usdc   NUMERIC(12,6),
      token_id      VARCHAR(50),
      block_number  BIGINT,
      status        VARCHAR(20) DEFAULT 'confirmed',
      recorded_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('[MIGRATE] ✅ blockchain_txs');

  // ── INDEXES ──────────────────────────────────────────────────
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet)',
    'CREATE INDEX IF NOT EXISTS idx_users_x_handle ON users(x_handle)',
    'CREATE INDEX IF NOT EXISTS idx_vehicles_owner ON vehicles(owner_wallet)',
    'CREATE INDEX IF NOT EXISTS idx_vehicles_token ON vehicles(token_id)',
    'CREATE INDEX IF NOT EXISTS idx_upgrades_wallet ON upgrades(wallet)',
    'CREATE INDEX IF NOT EXISTS idx_races_wallet ON races(wallet)',
    'CREATE INDEX IF NOT EXISTS idx_races_raced_at ON races(raced_at DESC)',
    'CREATE INDEX IF NOT EXISTS idx_trn_reg_wallet ON tournament_registrations(wallet)',
    'CREATE INDEX IF NOT EXISTS idx_trn_reg_tournament ON tournament_registrations(tournament_id)',
    'CREATE INDEX IF NOT EXISTS idx_pred_stakes_wallet ON prediction_stakes(wallet)',
    'CREATE INDEX IF NOT EXISTS idx_pred_stakes_event ON prediction_stakes(event_id)',
    'CREATE INDEX IF NOT EXISTS idx_btx_wallet ON blockchain_txs(wallet)',
    'CREATE INDEX IF NOT EXISTS idx_btx_type ON blockchain_txs(tx_type)',
    'CREATE INDEX IF NOT EXISTS idx_email_subs_email ON email_subscriptions(email)',
  ];
  for (const idx of indexes) await query(idx);
  console.log('[MIGRATE] ✅ indexes');

  console.log('[MIGRATE] 🎉 All tables and indexes created successfully!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('[MIGRATE] ❌ Migration failed:', err.message);
  process.exit(1);
});
