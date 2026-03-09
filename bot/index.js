const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');

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
const { getConfig: getAutoDeleteConfig, saveConfig: saveAutoDeleteConfig, scheduleDelete } = require('./utils/autodelete');
const { isAdminUser } = adminHandler;

const bot = new TelegramBot(config.BOT_TOKEN, { polling: true });
console.log('🐱 DOTYCAT TUNNEL Bot started!');

autoexpireHandler.init(bot);
monitorHandler.init(bot);
initTrafficMonitor(bot);

function authMiddleware(msg) {
  if (!isAdminUser(msg.from.id)) {
    bot.sendMessage(msg.chat.id, '⛔ Accès refusé.');
    return false;
  }
  return true;
}

function editOrSend(bot, chatId, msgId, text, opts = {}) {
  if (msgId) return bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...opts }).catch(() => bot.sendMessage(chatId, text, opts));
  return bot.sendMessage(chatId, text, opts);
}

function getMainMenuText() {
  return `━━━━━━━━━━━━━━━━━━━━━\n🐱 *DOTYCAT TUNNEL BOT* 🐱\n━━━━━━━━━━━━━━━━━━━━━\nBienvenue dans le panneau de gestion.\nSélectionnez une option ci-dessous:\n━━━━━━━━━━━━━━━━━━━━━`;
}

function getMainMenuKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔰 VLESS', callback_data: 'menu_vless' }, { text: '🔰 VMESS', callback_data: 'menu_vmess' }],
      [{ text: '🔰 TROJAN', callback_data: 'menu_trojan' }, { text: '🔰 SOCKS', callback_data: 'menu_socks' }],
      [{ text: '🔑 SSH', callback_data: 'menu_ssh' }, { text: '🌐 OPENVPN', callback_data: 'menu_openvpn' }],
      [{ text: '🌍 DOMAIN', callback_data: 'menu_domain' }, { text: '📡 DNS/SLDNS', callback_data: 'menu_dns' }],
      [{ text: '🔧 PORTS', callback_data: 'menu_port' }, { text: '📊 STATUS', callback_data: 'menu_status' }],
      [{ text: '📋 LOGS', callback_data: 'menu_log' }, { text: '💾 BACKUP', callback_data: 'menu_backup' }],
      [{ text: '🛡️ NETGUARD', callback_data: 'menu_netguard' }, { text: '📱 ZIVPN', callback_data: 'menu_zivpn' }],
      [{ text: '🔌 UDP CUSTOM', callback_data: 'menu_udp' }, { text: '🔄 UPDATE', callback_data: 'update_script' }],
      [{ text: '📊 STATS', callback_data: 'menu_stats' }, { text: '⏰ AUTO-EXPIRE', callback_data: 'menu_autoexpire' }],
      [{ text: '📢 BROADCAST', callback_data: 'menu_broadcast' }, { text: '🧪 SPEEDTEST', callback_data: 'menu_speedtest' }],
      [{ text: '🔐 FIREWALL', callback_data: 'menu_firewall' }, { text: '📦 MULTI-SERVER', callback_data: 'menu_multiserver' }],
      [{ text: '🕐 TRIAL', callback_data: 'menu_trial' }, { text: '📱 QR CODE', callback_data: 'menu_qrcode' }],
      [{ text: '🛡️ MONITOR', callback_data: 'menu_monitor' }, { text: '📋 AUDIT', callback_data: 'menu_audit' }],
      [{ text: '👥 ADMINS', callback_data: 'menu_admin' }, { text: '📑 SERVER INFO', callback_data: 'server_info' }],
      [{ text: '📖 AIDE', callback_data: 'menu_help' }, { text: '🗑 AUTO-DELETE', callback_data: 'menu_autodel' }],
    ],
  };
}

bot.onText(/\/start/, (msg) => {
  if (!authMiddleware(msg)) return;
  scheduleDelete(bot, msg.chat.id, msg.message_id);
  bot.sendMessage(msg.chat.id, getMainMenuText(), { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() });
});

bot.onText(/\/menu/, (msg) => {
  if (!authMiddleware(msg)) return;
  scheduleDelete(bot, msg.chat.id, msg.message_id);
  bot.sendMessage(msg.chat.id, getMainMenuText(), { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() });
});

bot.onText(/\/help/, (msg) => {
  if (!authMiddleware(msg)) return;
  scheduleDelete(bot, msg.chat.id, msg.message_id);
  helpHandler.showHelp(bot, msg.chat.id);
});

const pendingActions = {};

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;
  const data = query.data;

  if (!isAdminUser(query.from.id)) {
    bot.answerCallbackQuery(query.id, { text: '⛔ Accès refusé.' });
    return;
  }
  bot.answerCallbackQuery(query.id);
  if (data === 'noop') return;

  try {
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

    if (data.startsWith('help_page_')) return helpHandler.handleCallback(bot, chatId, data, query);

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
      ['quota_', { handleCallback: async (bot, chatId, data, query, pa) => {
        // Handle quota extension from traffic monitor alerts
        const parts = data.replace('quota_', '').split('_');
        if (parts[0] === 'ext') {
          const proto = parts[1]; const user = parts.slice(2).join('_');
          editOrSend(bot, chatId, msgId, `📦 Nouveau quota pour *${user}* (ex: 5GB):`, { parse_mode: 'Markdown' });
          pendingActions[chatId] = { action: 'quota_extend', protocol: proto, user, handler: async (bot, cid, text, pending, pa, userMsgId) => {
            delete pa[cid];
            const { parseLimitToBytes, setDataLimit, formatBytes } = require('./utils/traffic');
            const bytes = parseLimitToBytes(text.trim());
            if (!bytes) return bot.sendMessage(cid, '❌ Format invalide.', { reply_markup: { inline_keyboard: [[{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
            await setDataLimit(pending.protocol, pending.user, bytes);
            // Unsuspend: re-add to config
            const { runCommand } = require('./utils/exec');
            try {
              const limitFile = `/etc/xray/limits/${pending.protocol}_${pending.user}.json`;
              const ld = JSON.parse(await runCommand(`cat ${limitFile}`));
              ld.suspended = false; ld.limitBytes = bytes;
              await runCommand(`echo '${JSON.stringify(ld)}' > ${limitFile}`);
            } catch {}
            bot.sendMessage(cid, `✅ Quota prolongé: *${pending.user}* = ${formatBytes(bytes)}`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
          }};
        } else if (parts[0] === 'del') {
          const proto = parts[1]; const user = parts.slice(2).join('_');
          editOrSend(bot, chatId, msgId, `✅ Compte *${user}* marqué pour suppression. Utilisez le menu ${proto.toUpperCase()} pour supprimer.`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
        }
      }}],
    ];

    for (const [prefix, handler] of prefixHandlers) {
      if (data.startsWith(prefix)) return handler.handleCallback(bot, chatId, data, query, pendingActions);
    }

    if (data === 'server_info') {
      const { runCommand, getServerIP, getDomain } = require('./utils/exec');
      const ip = await getServerIP(); const domain = await getDomain();
      let uptime = 'N/A', os = 'N/A', ram = 'N/A', cpu = 'N/A';
      try { uptime = await runCommand('uptime -p'); } catch {}
      try { os = await runCommand('cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d \'"\''); } catch {}
      try { ram = await runCommand('free -m | awk \'NR==2{printf "%sMB / %sMB (%.1f%%)", $3, $2, $3*100/$2}\''); } catch {}
      try { cpu = await runCommand('nproc'); } catch {}
      editOrSend(bot, chatId, msgId, `━━━━━━━━━━━━━━━━━━━━━\n📑 *SERVER INFO*\n━━━━━━━━━━━━━━━━━━━━━\n🌐 IP: \`${ip}\`\n🔗 Domain: \`${domain}\`\n💻 OS: ${os}\n⏱ Uptime: ${uptime}\n🧠 RAM: ${ram}\n⚙️ CPU: ${cpu} cores\n━━━━━━━━━━━━━━━━━━━━━`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
    }

    if (data === 'update_script') {
      const { runCommand } = require('./utils/exec');
      editOrSend(bot, chatId, msgId, '🔄 Mise à jour...');
      try {
        await runCommand('wget -O /root/doty.sh https://raw.githubusercontent.com/dotywrt/doty/main/doty.sh && chmod +x /root/doty.sh');
        bot.sendMessage(chatId, '✅ Script mis à jour!', { reply_markup: { inline_keyboard: [[{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
      } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
    }

    if (data === 'back_main') {
      editOrSend(bot, chatId, msgId, getMainMenuText(), { parse_mode: 'Markdown', reply_markup: getMainMenuKeyboard() });
    }

    // Auto-delete config
    if (data === 'menu_autodel') {
      const cfg = getAutoDeleteConfig();
      const unitLabel = cfg.unit === 'm' ? 'minute(s)' : 'seconde(s)';
      editOrSend(bot, chatId, msgId, `━━━━━━━━━━━━━━━━━━━━━\n🗑 *AUTO-DELETE MESSAGES*\n━━━━━━━━━━━━━━━━━━━━━\nStatut: ${cfg.enabled ? '✅ Activé' : '❌ Désactivé'}\nDélai: ${cfg.delay} ${unitLabel}\n\n_Supprime les messages du bot ET de l'utilisateur_\n━━━━━━━━━━━━━━━━━━━━━`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: cfg.enabled ? '❌ Désactiver' : '✅ Activer', callback_data: 'autodel_toggle' }],
          [{ text: '⏱ Changer délai', callback_data: 'autodel_delay' }],
          [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }],
        ] }
      });
    }
    if (data === 'autodel_toggle') {
      const cfg = getAutoDeleteConfig(); cfg.enabled = !cfg.enabled; saveAutoDeleteConfig(cfg);
      editOrSend(bot, chatId, msgId, `✅ Auto-delete ${cfg.enabled ? 'activé' : 'désactivé'}.`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_autodel' }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] }
      });
    }
    if (data === 'autodel_delay') {
      editOrSend(bot, chatId, msgId, '⏱ Unité:', {
        reply_markup: { inline_keyboard: [[{ text: '⏱ Secondes (s)', callback_data: 'autodel_unit_s' }], [{ text: '🕐 Minutes (m)', callback_data: 'autodel_unit_m' }], [{ text: '🔙 Retour', callback_data: 'menu_autodel' }]] }
      });
    }
    if (data === 'autodel_unit_s' || data === 'autodel_unit_m') {
      const unit = data === 'autodel_unit_s' ? 's' : 'm';
      const label = unit === 's' ? 'secondes' : 'minutes';
      editOrSend(bot, chatId, msgId, `🔢 Nombre de ${label}:`);
      pendingActions[chatId] = {
        action: 'autodel_set_delay',
        handler: (bot, cid, text, pending, pa) => {
          delete pa[cid];
          const val = parseInt(text);
          if (isNaN(val) || val < 5) return bot.sendMessage(cid, '❌ Minimum 5.', { reply_markup: { inline_keyboard: [[{ text: '🔄 Réessayer', callback_data: 'autodel_delay' }, { text: '❌ Annuler', callback_data: 'menu_autodel' }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
          const cfg = getAutoDeleteConfig(); cfg.delay = val; cfg.unit = unit; saveAutoDeleteConfig(cfg);
          bot.sendMessage(cid, `✅ Délai: ${val} ${label}`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_autodel' }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
        },
      };
    }
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
});

// Handle text messages - pass userMsgId for auto-delete
bot.on('message', (msg) => {
  if (msg.text && msg.text.startsWith('/')) return;
  if (!isAdminUser(msg.from.id)) return;

  const chatId = msg.chat.id;
  const pending = pendingActions[chatId];

  if (pending) {
    // Schedule delete of user's message
    scheduleDelete(bot, chatId, msg.message_id);
    // Pass userMsgId as 6th argument to handler
    pending.handler(bot, chatId, msg.text, pending, pendingActions, msg.message_id);
  }
});

module.exports = { bot, pendingActions };

bot.on('polling_error', (error) => { console.error('Polling error:', error.message); });
process.on('uncaughtException', (err) => { console.error('Uncaught exception:', err); });
