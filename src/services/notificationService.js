// src/services/notificationService.js
const { query } = require('../db');
const { notifQueue, notifDequeue } = require('../cache');

// Subscribe an email address
async function subscribe({ email, wallet, type = 'tournament' }) {
  await query(
    `INSERT INTO email_subscriptions (email, wallet, sub_type)
     VALUES ($1,$2,$3)
     ON CONFLICT (email, sub_type) DO UPDATE SET active=TRUE`,
    [email, wallet ? wallet.toLowerCase() : null, type]
  );
  // Send welcome email
  await queueAndSend(email, 'WarcGarage Notifications Enabled',
    `You're subscribed to WarcGarage ${type} notifications!\n\nRace hard. Win USDC. 🏎⚡\n— WarcGarage Team`
  );
}

// Get all subscriptions
async function getSubscriptions() {
  const result = await query(
    'SELECT * FROM email_subscriptions WHERE active=TRUE ORDER BY subscribed_at DESC'
  );
  return result.rows;
}

// Get subscriptions by type
async function getSubscriptionsByType(type) {
  const result = await query(
    'SELECT * FROM email_subscriptions WHERE active=TRUE AND sub_type=$1',
    [type]
  );
  return result.rows;
}

// Unsubscribe
async function unsubscribe({ email, type = 'tournament' }) {
  await query(
    'UPDATE email_subscriptions SET active=FALSE WHERE email=$1 AND sub_type=$2',
    [email, type]
  );
}

// Send to all subscribers of a type
async function broadcastToSubscribers({ type = 'tournament', subject, message }) {
  const subs = await getSubscriptionsByType(type);
  let sent = 0;
  for (const sub of subs) {
    await queueAndSend(sub.email, subject, message);
    sent++;
  }
  return sent;
}

// Tournament-specific notifications
async function notifyTournamentStart(tournamentId, tournamentName) {
  const subs = await getSubscriptionsByType('tournament');
  for (const sub of subs) {
    await queueAndSend(
      sub.email,
      `🏁 ${tournamentName} is LIVE!`,
      `The tournament "${tournamentName}" has just started!\n\nHead to warcgarage.xyz/race to compete.\n\n— WarcGarage Team`
    );
  }
}

async function notifyTournamentResult(tournamentId, tournamentName, results, prizes) {
  const subs = await getSubscriptionsByType('tournament');
  for (const sub of subs) {
    await queueAndSend(
      sub.email,
      `🏆 ${tournamentName} Results`,
      `Tournament "${tournamentName}" has concluded!\n\n` +
      `🥇 1st: ${results.p1 || 'TBD'} — ${prizes.p1} USDC\n` +
      `🥈 2nd: ${results.p2 || 'TBD'} — ${prizes.p2} USDC\n` +
      `🥉 3rd: ${results.p3 || 'TBD'} — ${prizes.p3} USDC\n\n` +
      `See full results at warcgarage.xyz\n— WarcGarage Team`
    );
  }
}

// Core: queue and send via Resend
async function queueAndSend(to, subject, body) {
  // Queue in Redis for async processing
  await notifQueue(to, subject, body);
  // Also send immediately
  await sendViaResend(to, subject, body);
}

async function sendViaResend(to, subject, body) {
  const RESEND_KEY = process.env.RESEND_API_KEY;

  // Log to DB
  const logEntry = await query(
    `INSERT INTO email_log (to_email, subject, status) VALUES ($1,$2,'queued') RETURNING id`,
    [to, subject]
  ).catch(() => ({ rows: [{ id: null }] }));
  const logId = logEntry.rows[0]?.id;

  if (!RESEND_KEY) {
    console.log(`[EMAIL] No API key — would send to ${to}: ${subject}`);
    if (logId) await query('UPDATE email_log SET status=$1 WHERE id=$2', ['skipped_no_key', logId]);
    return;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'noreply@warcgarage.xyz',
        to: [to],
        subject,
        text: body
      })
    });
    const data = await response.json();
    const status = data.id ? 'sent' : 'failed';
    if (logId) {
      await query('UPDATE email_log SET status=$1, resend_id=$2 WHERE id=$3', [status, data.id || null, logId]);
    }
    console.log(`[EMAIL] ${status} → ${to}`);
  } catch (e) {
    if (logId) await query('UPDATE email_log SET status=$1 WHERE id=$2', ['error', logId]);
    console.error(`[EMAIL] Error sending to ${to}:`, e.message);
  }
}

// Get email log (admin)
async function getEmailLog(limit = 50) {
  const result = await query(
    'SELECT * FROM email_log ORDER BY sent_at DESC LIMIT $1',
    [limit]
  );
  return result.rows;
}

module.exports = {
  subscribe, getSubscriptions, getSubscriptionsByType, unsubscribe,
  broadcastToSubscribers, notifyTournamentStart, notifyTournamentResult,
  queueAndSend, sendViaResend, getEmailLog
};
