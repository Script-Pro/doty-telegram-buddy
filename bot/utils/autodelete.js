const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'autodelete_config.json');

function getConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { enabled: true, delay: 45, unit: 's' };
  }
}

function saveConfig(cfg) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function getDelayMs() {
  const cfg = getConfig();
  if (!cfg.enabled) return 0;
  const val = cfg.delay || 45;
  switch (cfg.unit) {
    case 'm': return val * 60 * 1000;
    case 's': default: return val * 1000;
  }
}

/**
 * Send a message that auto-deletes after configured delay.
 * Also deletes the user's message (userMsgId) if provided.
 */
function autoDeleteSend(bot, chatId, text, opts = {}, userMsgId = null) {
  const delayMs = getDelayMs();
  // Delete user's message too
  if (userMsgId && delayMs > 0) {
    setTimeout(() => {
      bot.deleteMessage(chatId, userMsgId).catch(() => {});
    }, delayMs);
  }
  return bot.sendMessage(chatId, text, opts).then(sent => {
    if (delayMs > 0) {
      setTimeout(() => {
        bot.deleteMessage(chatId, sent.message_id).catch(() => {});
      }, delayMs);
    }
    return sent;
  });
}

/**
 * Schedule deletion of a message after configured delay
 */
function scheduleDelete(bot, chatId, messageId) {
  const delayMs = getDelayMs();
  if (delayMs > 0) {
    setTimeout(() => {
      bot.deleteMessage(chatId, messageId).catch(() => {});
    }, delayMs);
  }
}

module.exports = { getConfig, saveConfig, autoDeleteSend, scheduleDelete, getDelayMs };
