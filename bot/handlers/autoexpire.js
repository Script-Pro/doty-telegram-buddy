const { runCommand } = require('../utils/exec');
const config = require('../config');
const { readJSON, writeJSON } = require('../utils/helpers');
const path = require('path');

const AUTOEXPIRE_CONFIG = path.join(__dirname, '..', 'data', 'autoexpire.json');

function getConfig() {
  return readJSON(AUTOEXPIRE_CONFIG) || { enabled: false, intervalMinutes: 60, notifyBefore: 24, lastRun: null };
}

function saveConfig(cfg) {
  writeJSON(AUTOEXPIRE_CONFIG, cfg);
}

let autoExpireInterval = null;

function showMenu(bot, chatId) {
  const cfg = getConfig();
  const statusText = cfg.enabled ? '🟢 Activé' : '🔴 Désactivé';

  const buttons = [
    [{ text: cfg.enabled ? '🔴 Désactiver' : '🟢 Activer', callback_data: 'autoexp_toggle' }],
    [{ text: '🔍 Vérifier maintenant', callback_data: 'autoexp_check_now' }],
    [{ text: '⏰ Changer intervalle', callback_data: 'autoexp_interval' }],
    [{ text: '📋 Voir comptes expirés', callback_data: 'autoexp_list_expired' }],
    [{ text: '🧹 Purger les expirés', callback_data: 'autoexp_purge' }],
    [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
  ];

  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━
⏰ *AUTO-EXPIRATION*
━━━━━━━━━━━━━━━━━━━━━
Status: ${statusText}
Intervalle: ${cfg.intervalMinutes} min
Notification: ${cfg.notifyBefore}h avant
Dernier scan: ${cfg.lastRun || 'Jamais'}
━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
  );
}

async function checkExpiredAccounts(bot) {
  const protocols = ['vless', 'vmess', 'trojan', 'socks'];
  const expired = [];
  const expiringSoon = [];
  const now = new Date();

  for (const proto of protocols) {
    try {
      const users = await runCommand(`grep "^###" /etc/xray/${proto}.json 2>/dev/null | sed 's/^### //'`);
      const list = users.trim().split('\n').filter(u => u);

      for (const user of list) {
        const parts = user.split(' ');
        const username = parts[0];
        const expDate = parts[1];
        if (!expDate) continue;

        const [day, month, year] = expDate.split('-').map(Number);
        const exp = new Date(year, month - 1, day);
        const diffHours = (exp - now) / (1000 * 60 * 60);

        if (diffHours < 0) {
          expired.push({ proto, username, expDate });
        } else if (diffHours <= 24) {
          expiringSoon.push({ proto, username, expDate, hoursLeft: Math.round(diffHours) });
        }
      }
    } catch {}
  }

  // Also check SSH
  try {
    const sshUsers = await runCommand(`ls /etc/ssh-users/ 2>/dev/null`);
    const sshList = sshUsers.trim().split('\n').filter(u => u);
    for (const username of sshList) {
      try {
        const expInfo = await runCommand(`chage -l ${username} 2>/dev/null | grep "Account expires" | cut -d: -f2`);
        const expStr = expInfo.trim();
        if (expStr && expStr !== 'never') {
          const exp = new Date(expStr);
          const diffHours = (exp - now) / (1000 * 60 * 60);
          if (diffHours < 0) {
            expired.push({ proto: 'ssh', username, expDate: expStr });
          } else if (diffHours <= 24) {
            expiringSoon.push({ proto: 'ssh', username, expDate: expStr, hoursLeft: Math.round(diffHours) });
          }
        }
      } catch {}
    }
  } catch {}

  return { expired, expiringSoon };
}

async function purgeExpiredAccounts(bot, chatId) {
  const { expired } = await checkExpiredAccounts(bot);
  let purged = 0;

  for (const acc of expired) {
    try {
      if (acc.proto === 'ssh') {
        await runCommand(`userdel -f ${acc.username} 2>/dev/null; rm -f /etc/ssh-users/${acc.username}`);
      } else {
        await runCommand(`sed -i '/^### ${acc.username}/,/^},{/d' /etc/xray/${acc.proto}.json 2>/dev/null`);
      }
      purged++;
    } catch {}
  }

  return purged;
}

async function handleCallback(bot, chatId, data, query, pendingActions) {
  if (data === 'autoexp_toggle') {
    const cfg = getConfig();
    cfg.enabled = !cfg.enabled;
    saveConfig(cfg);

    if (cfg.enabled) {
      startAutoExpire(bot);
      bot.sendMessage(chatId, '✅ Auto-expiration activée!');
    } else {
      stopAutoExpire();
      bot.sendMessage(chatId, '🔴 Auto-expiration désactivée.');
    }
    showMenu(bot, chatId);
  }

  if (data === 'autoexp_check_now') {
    bot.sendMessage(chatId, '🔍 Vérification en cours...');
    const { expired, expiringSoon } = await checkExpiredAccounts(bot);

    let text = `━━━━━━━━━━━━━━━━━━━━━\n🔍 *RÉSULTAT DU SCAN*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    text += `❌ Comptes expirés: ${expired.length}\n`;
    text += `⚠️ Expirent dans <24h: ${expiringSoon.length}\n\n`;

    if (expired.length > 0) {
      text += '*Expirés:*\n';
      expired.forEach(a => { text += `  └ ${a.proto.toUpperCase()} - ${a.username} (${a.expDate})\n`; });
      text += '\n';
    }

    if (expiringSoon.length > 0) {
      text += '*Expirent bientôt:*\n';
      expiringSoon.forEach(a => { text += `  └ ${a.proto.toUpperCase()} - ${a.username} (~${a.hoursLeft}h)\n`; });
    }

    text += '\n━━━━━━━━━━━━━━━━━━━━━';

    const cfg = getConfig();
    cfg.lastRun = new Date().toISOString().split('T')[0];
    saveConfig(cfg);

    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          expired.length > 0 ? [{ text: '🧹 Purger les expirés', callback_data: 'autoexp_purge' }] : [],
          [{ text: '🔙 Retour', callback_data: 'menu_autoexpire' }],
        ].filter(r => r.length > 0),
      },
    });
  }

  if (data === 'autoexp_interval') {
    pendingActions[chatId] = {
      action: 'autoexp_set_interval',
      handler: (bot, cid, text, pending, pa) => {
        delete pa[cid];
        const mins = parseInt(text);
        if (isNaN(mins) || mins < 5) {
          return bot.sendMessage(cid, '❌ Intervalle invalide (minimum 5 minutes).');
        }
        const cfg = getConfig();
        cfg.intervalMinutes = mins;
        saveConfig(cfg);
        if (cfg.enabled) {
          stopAutoExpire();
          startAutoExpire(bot);
        }
        bot.sendMessage(cid, `✅ Intervalle mis à ${mins} minutes.`);
        showMenu(bot, cid);
      },
    };
    bot.sendMessage(chatId, '⏰ Entrez l\'intervalle en minutes (minimum 5):');
  }

  if (data === 'autoexp_list_expired') {
    bot.sendMessage(chatId, '🔍 Recherche des comptes expirés...');
    const { expired } = await checkExpiredAccounts(bot);

    if (expired.length === 0) {
      return bot.sendMessage(chatId, '✅ Aucun compte expiré trouvé.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_autoexpire' }]] },
      });
    }

    let text = `❌ *${expired.length} COMPTES EXPIRÉS:*\n\n`;
    expired.forEach(a => { text += `• ${a.proto.toUpperCase()} - ${a.username} (${a.expDate})\n`; });

    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🧹 Purger tout', callback_data: 'autoexp_purge' }],
          [{ text: '🔙 Retour', callback_data: 'menu_autoexpire' }],
        ],
      },
    });
  }

  if (data === 'autoexp_purge') {
    bot.sendMessage(chatId, '🧹 Suppression des comptes expirés en cours...');
    const purged = await purgeExpiredAccounts(bot, chatId);
    bot.sendMessage(chatId, `✅ ${purged} comptes expirés supprimés.`, {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_autoexpire' }]] },
    });

    // Restart xray if accounts were purged
    if (purged > 0) {
      try { await runCommand('systemctl restart xray 2>/dev/null'); } catch {}
    }
  }
}

function startAutoExpire(bot) {
  const cfg = getConfig();
  if (autoExpireInterval) clearInterval(autoExpireInterval);

  autoExpireInterval = setInterval(async () => {
    const { expired, expiringSoon } = await checkExpiredAccounts(bot);

    if (expired.length > 0 || expiringSoon.length > 0) {
      let text = `🔔 *RAPPORT AUTO-EXPIRATION*\n\n`;
      if (expired.length > 0) {
        text += `❌ ${expired.length} comptes expirés\n`;
      }
      if (expiringSoon.length > 0) {
        text += `⚠️ ${expiringSoon.length} expirent dans <24h\n`;
      }

      bot.sendMessage(config.ADMIN_ID, text, { parse_mode: 'Markdown' });
    }

    const c = getConfig();
    c.lastRun = new Date().toISOString();
    saveConfig(c);
  }, cfg.intervalMinutes * 60 * 1000);
}

function stopAutoExpire() {
  if (autoExpireInterval) {
    clearInterval(autoExpireInterval);
    autoExpireInterval = null;
  }
}

// Auto-start if enabled
function init(bot) {
  const cfg = getConfig();
  if (cfg.enabled) startAutoExpire(bot);
}

module.exports = { showMenu, handleCallback, init };
