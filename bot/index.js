const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');

// Import handlers
const vlessHandler = require('./handlers/vless');
const vmessHandler = require('./handlers/vmess');
const trojanHandler = require('./handlers/trojan');
const sshHandler = require('./handlers/ssh');
const socksHandler = require('./handlers/socks');
const openvpnHandler = require('./handlers/openvpn');
const domainHandler = require('./handlers/domain');
const dnsHandler = require('./handlers/dns');
const portHandler = require('./handlers/port');
const statusHandler = require('./handlers/status');
const logHandler = require('./handlers/log');
const backupHandler = require('./handlers/backup');
const zivpnHandler = require('./handlers/zivpn');
const udpHandler = require('./handlers/udp');
const netguardHandler = require('./handlers/netguard');
const adminHandler = require('./handlers/admin');
const statsHandler = require('./handlers/stats');
const autoexpireHandler = require('./handlers/autoexpire');
const broadcastHandler = require('./handlers/broadcast');
const speedtestHandler = require('./handlers/speedtest');
const firewallHandler = require('./handlers/firewall');
const multiserverHandler = require('./handlers/multiserver');
const trialHandler = require('./handlers/trial');
const qrcodeHandler = require('./handlers/qrcode');
const monitorHandler = require('./handlers/monitor');
const auditHandler = require('./handlers/audit');
const helpHandler = require('./handlers/help');
const { initTrafficMonitor } = require('./utils/trafficMonitor');

const { isAdminUser } = adminHandler;

// Create bot
const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

console.log('🐱 DOTYCAT TUNNEL Bot started!');

// Initialize auto-start modules
autoexpireHandler.init(bot);
monitorHandler.init(bot);
initTrafficMonitor(bot);

// Auth middleware
function authMiddleware(msg) {
  if (!isAdminUser(msg.from.id)) {
    bot.sendMessage(msg.chat.id, '⛔ Accès refusé. Vous n\'êtes pas autorisé.');
    return false;
  }
  return true;
}

// Helper: edit message or send new
function editOrSend(bot, chatId, msgId, text, opts = {}) {
  if (msgId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...opts }).catch(() => bot.sendMessage(chatId, text, opts));
  }
  return bot.sendMessage(chatId, text, opts);
}

function getMainMenuText() {
  return `━━━━━━━━━━━━━━━━━━━━━
🐱 *DOTYCAT TUNNEL BOT* 🐱
━━━━━━━━━━━━━━━━━━━━━
Bienvenue dans le panneau de gestion.
Sélectionnez une option ci-dessous:
━━━━━━━━━━━━━━━━━━━━━`;
}

function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔰 VLESS', callback_data: 'menu_vless' },
        { text: '🔰 VMESS', callback_data: 'menu_vmess' },
      ],
      [
        { text: '🔰 TROJAN', callback_data: 'menu_trojan' },
        { text: '🔰 SOCKS', callback_data: 'menu_socks' },
      ],
      [
        { text: '🔑 SSH', callback_data: 'menu_ssh' },
        { text: '🌐 OPENVPN', callback_data: 'menu_openvpn' },
      ],
      [
        { text: '🌍 DOMAIN', callback_data: 'menu_domain' },
        { text: '📡 DNS/SLDNS', callback_data: 'menu_dns' },
      ],
      [
        { text: '🔧 PORTS', callback_data: 'menu_port' },
        { text: '📊 STATUS', callback_data: 'menu_status' },
      ],
      [
        { text: '📋 LOGS', callback_data: 'menu_log' },
        { text: '💾 BACKUP', callback_data: 'menu_backup' },
      ],
      [
        { text: '🛡️ NETGUARD', callback_data: 'menu_netguard' },
        { text: '📱 ZIVPN', callback_data: 'menu_zivpn' },
      ],
      [
        { text: '🔌 UDP CUSTOM', callback_data: 'menu_udp' },
        { text: '🔄 UPDATE', callback_data: 'update_script' },
      ],
      [
        { text: '📊 STATS', callback_data: 'menu_stats' },
        { text: '⏰ AUTO-EXPIRE', callback_data: 'menu_autoexpire' },
      ],
      [
        { text: '📢 BROADCAST', callback_data: 'menu_broadcast' },
        { text: '🧪 SPEEDTEST', callback_data: 'menu_speedtest' },
      ],
      [
        { text: '🔐 FIREWALL', callback_data: 'menu_firewall' },
        { text: '📦 MULTI-SERVER', callback_data: 'menu_multiserver' },
      ],
      [
        { text: '🕐 TRIAL', callback_data: 'menu_trial' },
        { text: '📱 QR CODE', callback_data: 'menu_qrcode' },
      ],
      [
        { text: '🛡️ MONITOR', callback_data: 'menu_monitor' },
        { text: '📋 AUDIT', callback_data: 'menu_audit' },
      ],
      [
        { text: '👥 ADMINS', callback_data: 'menu_admin' },
        { text: '📑 SERVER INFO', callback_data: 'server_info' },
      ],
      [
        { text: '📖 AIDE', callback_data: 'menu_help' },
      ],
    ],
  };
}

// /start command
bot.onText(/\/start/, (msg) => {
  if (!authMiddleware(msg)) return;
  bot.sendMessage(msg.chat.id, getMainMenuText(), {
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard(),
  });
});

// /menu command (alias for /start)
bot.onText(/\/menu/, (msg) => {
  if (!authMiddleware(msg)) return;
  bot.sendMessage(msg.chat.id, getMainMenuText(), {
    parse_mode: 'Markdown',
    reply_markup: getMainMenuKeyboard(),
  });
});

// /help command
bot.onText(/\/help/, (msg) => {
  if (!authMiddleware(msg)) return;
  helpHandler.showHelp(bot, msg.chat.id);
});

// Handle text messages for interactive flows
const pendingActions = {};

// Handle callback queries (button presses)
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;
  const data = query.data;

  if (!isAdminUser(query.from.id)) {
    bot.answerCallbackQuery(query.id, { text: '⛔ Accès refusé.' });
    return;
  }

  bot.answerCallbackQuery(query.id);

  // Ignore noop
  if (data === 'noop') return;

  try {
    // Main menus — use editMessageText to update instead of new message
    const menus = {
      menu_vless: () => vlessHandler.showMenu(bot, chatId, msgId),
      menu_vmess: () => vmessHandler.showMenu(bot, chatId, msgId),
      menu_trojan: () => trojanHandler.showMenu(bot, chatId, msgId),
      menu_socks: () => socksHandler.showMenu(bot, chatId, msgId),
      menu_ssh: () => sshHandler.showMenu(bot, chatId, msgId),
      menu_openvpn: () => openvpnHandler.showMenu(bot, chatId, msgId),
      menu_domain: () => domainHandler.showMenu(bot, chatId, msgId),
      menu_dns: () => dnsHandler.showMenu(bot, chatId, msgId),
      menu_port: () => portHandler.showMenu(bot, chatId, msgId),
      menu_status: () => statusHandler.showMenu(bot, chatId, msgId),
      menu_log: () => logHandler.showMenu(bot, chatId, msgId),
      menu_backup: () => backupHandler.showMenu(bot, chatId, msgId),
      menu_netguard: () => netguardHandler.showMenu(bot, chatId, msgId),
      menu_zivpn: () => zivpnHandler.showMenu(bot, chatId, msgId),
      menu_udp: () => udpHandler.showMenu(bot, chatId, msgId),
      menu_admin: () => adminHandler.showMenu(bot, chatId, query.from.id, msgId),
      menu_stats: () => statsHandler.showMenu(bot, chatId, msgId),
      menu_autoexpire: () => autoexpireHandler.showMenu(bot, chatId, msgId),
      menu_broadcast: () => broadcastHandler.showMenu(bot, chatId, msgId),
      menu_speedtest: () => speedtestHandler.showMenu(bot, chatId, msgId),
      menu_firewall: () => firewallHandler.showMenu(bot, chatId, msgId),
      menu_multiserver: () => multiserverHandler.showMenu(bot, chatId, msgId),
      menu_trial: () => trialHandler.showMenu(bot, chatId, msgId),
      menu_qrcode: () => qrcodeHandler.showMenu(bot, chatId, msgId),
      menu_monitor: () => monitorHandler.showMenu(bot, chatId, msgId),
      menu_audit: () => auditHandler.showMenu(bot, chatId, msgId),
      menu_help: () => helpHandler.showHelp(bot, chatId, 0),
    };

    if (menus[data]) return menus[data]();

    // Help pages
    if (data.startsWith('help_page_')) {
      return helpHandler.handleCallback(bot, chatId, data, query);
    }

    // Sub-action routing by prefix
    const prefixHandlers = [
      ['admin_', adminHandler],
      ['vless_', vlessHandler],
      ['vmess_', vmessHandler],
      ['trojan_', trojanHandler],
      ['socks_', socksHandler],
      ['ssh_', sshHandler],
      ['ovpn_', openvpnHandler],
      ['domain_', domainHandler],
      ['dns_', dnsHandler],
      ['port_', portHandler],
      ['status_', statusHandler],
      ['log_', logHandler],
      ['backup_', backupHandler],
      ['netguard_', netguardHandler],
      ['zivpn_', zivpnHandler],
      ['udp_', udpHandler],
      ['stats_', statsHandler],
      ['autoexp_', autoexpireHandler],
      ['broadcast_', broadcastHandler],
      ['speed_', speedtestHandler],
      ['fw_', firewallHandler],
      ['ms_', multiserverHandler],
      ['trial_', trialHandler],
      ['qr_', qrcodeHandler],
      ['mon_', monitorHandler],
      ['audit_', auditHandler],
    ];

    for (const [prefix, handler] of prefixHandlers) {
      if (data.startsWith(prefix)) {
        return handler.handleCallback(bot, chatId, data, query, pendingActions);
      }
    }

    // Server info
    if (data === 'server_info') {
      const { runCommand, getServerIP, getDomain } = require('./utils/exec');
      const ip = await getServerIP();
      const domain = await getDomain();
      let uptime = 'N/A', os = 'N/A', ram = 'N/A', cpu = 'N/A';
      try { uptime = await runCommand('uptime -p'); } catch {}
      try { os = await runCommand('cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\''); } catch {}
      try { ram = await runCommand('free -m | awk \'NR==2{printf "%sMB / %sMB (%.1f%%)", $3, $2, $3*100/$2}\''); } catch {}
      try { cpu = await runCommand('nproc'); } catch {}

      editOrSend(bot, chatId, msgId,
        `━━━━━━━━━━━━━━━━━━━━━
📑 *SERVER INFO*
━━━━━━━━━━━━━━━━━━━━━
🌐 IP: \`${ip}\`
🔗 Domain: \`${domain}\`
💻 OS: ${os}
⏱ Uptime: ${uptime}
🧠 RAM: ${ram}
⚙️ CPU: ${cpu} cores
━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } }
      );
    }

    // Update script
    if (data === 'update_script') {
      const { runCommand } = require('./utils/exec');
      editOrSend(bot, chatId, msgId, '🔄 Mise à jour du script en cours...');
      try {
        await runCommand('wget -O /root/doty.sh https://raw.githubusercontent.com/dotywrt/doty/main/doty.sh && chmod +x /root/doty.sh');
        bot.sendMessage(chatId, '✅ Script mis à jour avec succès!', {
          reply_markup: { inline_keyboard: [[{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] }
        });
      } catch (err) {
        bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
      }
    }

    // Back to main menu — edit message instead of new
    if (data === 'back_main') {
      editOrSend(bot, chatId, msgId, getMainMenuText(), {
        parse_mode: 'Markdown',
        reply_markup: getMainMenuKeyboard(),
      });
    }
  } catch (err) {
    bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
  }
});

bot.on('message', (msg) => {
  if (msg.text && msg.text.startsWith('/')) return;
  if (!isAdminUser(msg.from.id)) return;

  const chatId = msg.chat.id;
  const pending = pendingActions[chatId];

  if (pending) {
    pending.handler(bot, chatId, msg.text, pending, pendingActions);
  }
});

// Export pendingActions for handlers
module.exports = { bot, pendingActions };

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
