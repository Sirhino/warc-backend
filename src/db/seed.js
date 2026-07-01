// src/db/seed.js
// Run after migrate: node src/db/seed.js
require('dotenv').config();
const { query } = require('./index');

async function seed() {
  console.log('[SEED] Seeding WarcGarage default data...');

  // Default prediction events
  const events = [
    { id: 'f1-monaco-2025', series: 'f1', name: 'MONACO GRAND PRIX', event_date: '2025-05-25', event_time: '15:00 CEST', circuit: 'Circuit de Monaco, Monte Carlo', status: 'upcoming', participants: ['Verstappen','Hamilton','Leclerc','Norris','Sainz','Russell','Alonso','Piastri','Pérez','Albon'], cutoff: '2025-05-25T14:00:00Z' },
    { id: 'motogp-mugello-2025', series: 'motogp', name: "GRAN PREMIO D'ITALIA", event_date: '2025-06-01', event_time: '14:00 CEST', circuit: 'Mugello Circuit, Tuscany', status: 'upcoming', participants: ['Bagnaia','M.Márquez','Martín','Bastianini','Binder','Miller','Acosta','Viñales'], cutoff: '2025-06-01T13:00:00Z' },
    { id: 'nascar-daytona-2025', series: 'nascar', name: 'DAYTONA 500', event_date: '2025-02-16', event_time: '15:30 ET', circuit: 'Daytona International Speedway, FL', status: 'closed', participants: ['Elliott','Blaney','Byron','Larson','Busch','Hamlin','Wallace'], cutoff: '2025-02-16T14:30:00Z', result: { p1: 'Blaney', p2: 'Larson', p3: 'Byron' } },
    { id: 'warc-arcrace-1', series: 'warc', name: 'ARC CITY CHAMPIONSHIP', event_date: 'Ongoing', event_time: 'In-Game', circuit: 'Arc City Track — WarcGarage', status: 'live', participants: ['PHANTOM GT','NEON RACER','ARC BLAZE','THUNDER X','GHOST TURBO','QUAD BLAZE','ARC QUAD'], cutoff: '2099-01-01T00:00:00Z' },
  ];

  for (const ev of events) {
    await query(`
      INSERT INTO prediction_events (id, series, name, event_date, event_time, circuit, status, participants, cutoff, result)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO NOTHING
    `, [ev.id, ev.series, ev.name, ev.event_date, ev.event_time, ev.circuit, ev.status, JSON.stringify(ev.participants), ev.cutoff, ev.result ? JSON.stringify(ev.result) : null]);
  }
  console.log('[SEED] ✅ prediction_events');

  // Default tournaments
  const tournaments = [
    { id: 'trn_001', name: 'ARC CITY SPRINT', status: 'open', max_players: 8, start_time: new Date(Date.now() + 3600000).toISOString(), prize_pool: 200, min_stake: 5, vehicle_type: 'all' },
    { id: 'trn_002', name: 'MOTO MAYHEM CUP', status: 'open', max_players: 4, start_time: new Date(Date.now() + 7200000).toISOString(), prize_pool: 100, min_stake: 10, vehicle_type: 'bike' },
    { id: 'trn_003', name: 'NIGHT KING SERIES', status: 'live', max_players: 4, start_time: new Date(Date.now() - 900000).toISOString(), prize_pool: 500, min_stake: 25, vehicle_type: 'car', bracket: ['ARC-01 vs GHOST-X', 'VOLT-7 vs NEON-5'] },
    { id: 'trn_004', name: 'WEEKLY CHAMPIONSHIP', status: 'upcoming', max_players: 16, start_time: new Date(Date.now() + 86400000).toISOString(), prize_pool: 1000, min_stake: 50, vehicle_type: 'all' },
  ];

  for (const t of tournaments) {
    await query(`
      INSERT INTO tournaments (id, name, status, max_players, start_time, prize_pool, min_stake, vehicle_type, bracket)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO NOTHING
    `, [t.id, t.name, t.status, t.max_players, t.start_time, t.prize_pool, t.min_stake, t.vehicle_type, JSON.stringify(t.bracket || [])]);
  }
  console.log('[SEED] ✅ tournaments');

  console.log('[SEED] 🎉 Seed complete!');
  process.exit(0);
}

seed().catch(err => {
  console.error('[SEED] ❌ Failed:', err.message);
  process.exit(1);
});
