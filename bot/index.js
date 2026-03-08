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
const { isAdminUser } = adminHandler;

// Create bot
const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });

console.log('🐱 DOTYCAT TUNNEL Bot started!');

// Auth middleware - uses multi-admin system
function authMiddleware(msg) {
  if (!isAdminUser(msg.from.id)) {
    bot.sendMessage(msg.chat.id, '⛔ Accès refusé. Vous n\'êtes pas autorisé.');
    return false;
  }
  return true;
}

// /start command
bot.onText(/\/start/, (msg) => {
  if (!authMiddleware(msg)) return;

  const keyboard = {
    reply_markup: {
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
          { text: '👥 ADMINS', callback_data: 'menu_admin' },
          { text: '📑 SERVER INFO', callback_data: 'server_info' },
        ],
      ],
    },
  };

  bot.sendMessage(
    msg.chat.id,
    `━━━━━━━━━━━━━━━━━━━━━
🐱 *DOTYCAT TUNNEL BOT* 🐱
━━━━━━━━━━━━━━━━━━━━━
Bienvenue dans le panneau de gestion.
Sélectionnez une option ci-dessous:
━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown', ...keyboard }
  );
});

// /menu command (alias for /start)
bot.onText(/\/menu/, (msg) => {
  bot.emit('text', '/start', msg);
});

// Handle callback queries (button presses)
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (!isAdminUser(query.from.id)) {
    bot.answerCallbackQuery(query.id, { text: '⛔ Accès refusé.' });
    return;
  }

  bot.answerCallbackQuery(query.id);

  try {
    // Main menus
    if (data === 'menu_vless') return vlessHandler.showMenu(bot, chatId);
    if (data === 'menu_vmess') return vmessHandler.showMenu(bot, chatId);
    if (data === 'menu_trojan') return trojanHandler.showMenu(bot, chatId);
    if (data === 'menu_socks') return socksHandler.showMenu(bot, chatId);
    if (data === 'menu_ssh') return sshHandler.showMenu(bot, chatId);
    if (data === 'menu_openvpn') return openvpnHandler.showMenu(bot, chatId);
    if (data === 'menu_domain') return domainHandler.showMenu(bot, chatId);
    if (data === 'menu_dns') return dnsHandler.showMenu(bot, chatId);
    if (data === 'menu_port') return portHandler.showMenu(bot, chatId);
    if (data === 'menu_status') return statusHandler.showMenu(bot, chatId);
    if (data === 'menu_log') return logHandler.showMenu(bot, chatId);
    if (data === 'menu_backup') return backupHandler.showMenu(bot, chatId);
    if (data === 'menu_netguard') return netguardHandler.showMenu(bot, chatId);
    if (data === 'menu_zivpn') return zivpnHandler.showMenu(bot, chatId);
    if (data === 'menu_udp') return udpHandler.showMenu(bot, chatId);

    // VLESS sub-actions
    if (data.startsWith('vless_')) return vlessHandler.handleCallback(bot, chatId, data, query);
    // VMESS sub-actions
    if (data.startsWith('vmess_')) return vmessHandler.handleCallback(bot, chatId, data, query);
    // TROJAN sub-actions
    if (data.startsWith('trojan_')) return trojanHandler.handleCallback(bot, chatId, data, query);
    // SOCKS sub-actions
    if (data.startsWith('socks_')) return socksHandler.handleCallback(bot, chatId, data, query);
    // SSH sub-actions
    if (data.startsWith('ssh_')) return sshHandler.handleCallback(bot, chatId, data, query);
    // OpenVPN sub-actions
    if (data.startsWith('ovpn_')) return openvpnHandler.handleCallback(bot, chatId, data, query);
    // Domain sub-actions
    if (data.startsWith('domain_')) return domainHandler.handleCallback(bot, chatId, data, query);
    // DNS sub-actions
    if (data.startsWith('dns_')) return dnsHandler.handleCallback(bot, chatId, data, query);
    // Port sub-actions
    if (data.startsWith('port_')) return portHandler.handleCallback(bot, chatId, data, query);
    // Status sub-actions
    if (data.startsWith('status_')) return statusHandler.handleCallback(bot, chatId, data, query);
    // Log sub-actions
    if (data.startsWith('log_')) return logHandler.handleCallback(bot, chatId, data, query);
    // Backup sub-actions
    if (data.startsWith('backup_')) return backupHandler.handleCallback(bot, chatId, data, query);
    // NetGuard sub-actions
    if (data.startsWith('netguard_')) return netguardHandler.handleCallback(bot, chatId, data, query);
    // ZIVPN sub-actions
    if (data.startsWith('zivpn_')) return zivpnHandler.handleCallback(bot, chatId, data, query);
    // UDP sub-actions
    if (data.startsWith('udp_')) return udpHandler.handleCallback(bot, chatId, data, query);

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

      bot.sendMessage(chatId,
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
        { parse_mode: 'Markdown' }
      );
    }

    // Update script
    if (data === 'update_script') {
      const { runCommand } = require('./utils/exec');
      bot.sendMessage(chatId, '🔄 Mise à jour du script en cours...');
      try {
        await runCommand('wget -O /root/doty.sh https://raw.githubusercontent.com/dotywrt/doty/main/doty.sh && chmod +x /root/doty.sh');
        bot.sendMessage(chatId, '✅ Script mis à jour avec succès!');
      } catch (err) {
        bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
      }
    }

    // Back to main menu
    if (data === 'back_main') {
      bot.emit('text', '/start', query.message);
    }
  } catch (err) {
    bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
  }
});

// Handle text messages for interactive flows (create account, etc.)
const pendingActions = {};

bot.on('message', (msg) => {
  if (msg.text && msg.text.startsWith('/')) return; // Skip commands
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
