/**
 * Telegram Notifier
 *
 * Sends error reports and printer events to a Telegram chat via the Bot API.
 * Uses Node's built-in https module to avoid adding extra dependencies.
 *
 * Required env:
 *   TELEGRAM_BOT_TOKEN   - Bot token from @BotFather
 *   TELEGRAM_CHAT_ID     - Target chat/channel id (e.g. -1001234567890 or 123456789)
 *
 * Optional env:
 *   TELEGRAM_ENABLED     - "true" to enable (default: auto-enabled if both token & chat id present)
 *   TELEGRAM_THREAD_ID   - Message thread id for Telegram forum topics
 *   TELEGRAM_APP_NAME    - Label prefix shown in every message (default: "AIOM Printer")
 *
 * Usage:
 *   const telegram = require('./utils/telegramNotifier');
 *   await telegram.reportError(err, { action: 'print', productCode: 'SKU-01' });
 *   await telegram.info('Printer connected successfully');
 */

const https = require('https');
const logger = require('../../config/logger');

const DEFAULT_APP_NAME = process.env.TELEGRAM_APP_NAME || 'AIOM Printer';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const THREAD_ID = process.env.TELEGRAM_THREAD_ID || '';
const ENABLED = process.env.TELEGRAM_ENABLED
  ? process.env.TELEGRAM_ENABLED === 'true'
  : Boolean(BOT_TOKEN && CHAT_ID);

// Prevent notification spam: dedupe identical messages within this window
const DEDUPE_WINDOW_MS = 30 * 1000;
const recentMessages = new Map();

function isDuplicate(key) {
  const now = Date.now();
  const last = recentMessages.get(key);
  // Clean old entries opportunistically
  if (recentMessages.size > 50) {
    for (const [k, t] of recentMessages.entries()) {
      if (now - t > DEDUPE_WINDOW_MS) recentMessages.delete(k);
    }
  }
  if (last && now - last < DEDUPE_WINDOW_MS) return true;
  recentMessages.set(key, now);
  return false;
}

function escapeMarkdownV2(text) {
  if (text == null) return '';
  return String(text).replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`);
}

function formatContext(context) {
  if (!context || typeof context !== 'object') return '';
  const entries = Object.entries(context).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `• *${escapeMarkdownV2(k)}*: \`${escapeMarkdownV2(typeof v === 'object' ? JSON.stringify(v) : v)}\``).join('\n');
}

function sendRaw(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 5000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true });
          } else {
            logger.warn(`Telegram API returned ${res.statusCode}: ${data}`);
            resolve({ ok: false, status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('Telegram request timeout'));
    });
    req.on('error', (err) => {
      logger.warn('Telegram send failed:', err.message);
      resolve({ ok: false, error: err.message });
    });
    req.write(body);
    req.end();
  });
}

async function send(level, title, message, context) {
  if (!ENABLED) return { ok: false, skipped: 'disabled' };
  const emoji = { error: '🚨', warn: '⚠️', info: 'ℹ️', success: '✅' }[level] || 'ℹ️';
  const header = `${emoji} *${escapeMarkdownV2(DEFAULT_APP_NAME)}* \\| *${escapeMarkdownV2(title)}*`;
  const body = escapeMarkdownV2(message || '');
  const ctx = formatContext(context);
  const text = [header, body, ctx].filter(Boolean).join('\n\n');

  const dedupeKey = `${level}:${title}:${message}`.slice(0, 256);
  if (isDuplicate(dedupeKey)) {
    return { ok: false, skipped: 'duplicate' };
  }

  const payload = {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
  };
  if (THREAD_ID) payload.message_thread_id = Number(THREAD_ID);

  return sendRaw(payload);
}

module.exports = {
  isEnabled: () => ENABLED,
  async reportError(err, context = {}) {
    if (!ENABLED) return { ok: false, skipped: 'disabled' };
    const title = context.action ? `Error in ${context.action}` : 'Error';
    const errMsg = err instanceof Error ? err.message : String(err);
    // Build MarkdownV2 payload manually so the stack trace goes inside a
    // fenced code block (which must NOT be re-escaped).
    const header = `🚨 *${escapeMarkdownV2(DEFAULT_APP_NAME)}* \\| *${escapeMarkdownV2(title)}*`;
    const ctx = formatContext(context);
    const stack = err instanceof Error && err.stack
      ? `\`\`\`\n${err.stack.slice(0, 800).replace(/```/g, "'''")}\n\`\`\``
      : '';
    const text = [header, escapeMarkdownV2(errMsg), ctx, stack].filter(Boolean).join('\n\n');
    const dedupeKey = `error:${title}:${errMsg}`.slice(0, 256);
    if (isDuplicate(dedupeKey)) return { ok: false, skipped: 'duplicate' };
    const payload = {
      chat_id: CHAT_ID,
      text,
      parse_mode: 'MarkdownV2',
      disable_web_page_preview: true,
    };
    if (THREAD_ID) payload.message_thread_id = Number(THREAD_ID);
    return sendRaw(payload);
  },
  warn: (title, message, context) => send('warn', title, message, context),
  info: (title, message, context) => send('info', title, message, context),
  success: (title, message, context) => send('success', title, message, context),
};
