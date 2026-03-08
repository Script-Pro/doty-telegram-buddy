const { runCommand } = require('../utils/exec');
const { readJSON, writeJSON } = require('../utils/helpers');
const config = require('../config');
const path = require('path');

const MONITOR_CONFIG = path.join(__dirname, '..', 'data', 'monitor.json');

function getMonitorConfig() {
  return readJSON(MONITOR_CONFIG) || {
    enabled: false,
    intervalMinutes: 5,
    thresholds: { ram: 90, cpu: 95, disk: 90 },
    watchServices: ['xray', 'nginx', 'ssh'],
    alertsSent: {},
  };
}

function saveMonitorConfig(cfg) {
  writeJSON(MONITOR_CONFIG, cfg);
}

let monitorInterval = null;

function showMenu(bot, chatId) {
  const cfg = getMonitorConfig();
  const statusText = cfg.enabled ? '🟢 Activé' : '🔴 Désactivé';

  const buttons = [
    [{ text: cfg.enabled ? '🔴 Désactiver' : '🟢 Activer', callback_data: 'mon_toggle' }],
    [{ text: '🔍 Vérifier maintenant', callback_data: 'mon_check' }],
    [{ text: '⚙️ Seuils d\'alerte', callback_data: 'mon_thresholds' }],
    [{ text: '📋 Services surveillés', callback_data: 'mon_services' }],
    [{ text: '🔒 Vérifier SSL', callback_data: 'mon_ssl' }],
    [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
  ];

  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━
🛡️ *MONITORING*
━━━━━━━━━━━━━━━━━━━━━
Status: ${statusText}
Intervalle: ${cfg.intervalMinutes} min
Seuils: RAM ${cfg.thresholds.ram}% | CPU ${cfg.thresholds.cpu}% | Disque ${cfg.thresholds.disk}%
Services: ${cfg.watchServices.join(', ')}
━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
  );
}

async function runCheck(bot, silent = false) {
  const cfg = getMonitorConfig();
  const alerts = [];

  // Check RAM
  try {
    const ramPct = await runCommand("free | awk 'NR==2{printf \"%.0f\", $3*100/$2}'");
    const ramVal = parseInt(ramPct);
    if (ramVal >= cfg.thresholds.ram) {
      alerts.push(`🧠 RAM critique: ${ramVal}% (seuil: ${cfg.thresholds.ram}%)`);
    }
  } catch {}

  // Check CPU
  try {
    const cpuPct = await runCommand("top -bn1 | grep 'Cpu' | awk '{printf \"%.0f\", $2}'");
    const cpuVal = parseInt(cpuPct);
    if (cpuVal >= cfg.thresholds.cpu) {
      alerts.push(`⚙️ CPU critique: ${cpuVal}% (seuil: ${cfg.thresholds.cpu}%)`);
    }
  } catch {}

  // Check Disk
  try {
    const diskPct = await runCommand("df / | awk 'NR==2{print $5}' | tr -d '%'");
    const diskVal = parseInt(diskPct);
    if (diskVal >= cfg.thresholds.disk) {
      alerts.push(`💽 Disque critique: ${diskVal}% (seuil: ${cfg.thresholds.disk}%)`);
    }
  } catch {}

  // Check services
  for (const service of cfg.watchServices) {
    try {
      const status = await runCommand(`systemctl is-active ${service} 2>/dev/null`);
      if (status.trim() !== 'active') {
        alerts.push(`❌ Service ${service}: ${status.trim()}`);

        // Try to restart
        try {
          await runCommand(`systemctl restart ${service} 2>/dev/null`);
          alerts.push(`🔄 Tentative de redémarrage de ${service}`);
        } catch {}
      }
    } catch {}
  }

  // Check SSL
  try {
    const domain = await runCommand("cat /etc/xray/domain 2>/dev/null || hostname");
    const sslDays = await runCommand(`echo | openssl s_client -servername ${domain.trim()} -connect ${domain.trim()}:443 2>/dev/null | openssl x509 -noout -dates 2>/dev/null | grep notAfter | cut -d= -f2`);
    if (sslDays.trim()) {
      const expDate = new Date(sslDays.trim());
      const daysLeft = Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24));
      if (daysLeft <= 7) {
        alerts.push(`🔒 SSL expire dans ${daysLeft} jours!`);
      }
    }
  } catch {}

  return alerts;
}

async function handleCallback(bot, chatId, data, query, pendingActions) {
  if (data === 'mon_toggle') {
    const cfg = getMonitorConfig();
    cfg.enabled = !cfg.enabled;
    saveMonitorConfig(cfg);

    if (cfg.enabled) {
      startMonitor(bot);
      bot.sendMessage(chatId, '✅ Monitoring activé!');
    } else {
      stopMonitor();
      bot.sendMessage(chatId, '🔴 Monitoring désactivé.');
    }
    showMenu(bot, chatId);
  }

  if (data === 'mon_check') {
    bot.sendMessage(chatId, '🔍 Vérification en cours...');
    const alerts = await runCheck(bot);

    if (alerts.length === 0) {
      bot.sendMessage(chatId, '✅ Tout est OK! Aucune alerte.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_monitor' }]] },
      });
    } else {
      let text = `━━━━━━━━━━━━━━━━━━━━━\n⚠️ *ALERTES DÉTECTÉES (${alerts.length})*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
      alerts.forEach(a => { text += `${a}\n`; });
      text += '\n━━━━━━━━━━━━━━━━━━━━━';
      bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_monitor' }]] },
      });
    }
  }

  if (data === 'mon_thresholds') {
    pendingActions[chatId] = {
      action: 'mon_set_thresholds',
      handler: (bot, cid, text, pending, pa) => {
        delete pa[cid];
        const parts = text.trim().split(' ');
        if (parts.length !== 3) {
          return bot.sendMessage(cid, '❌ Format: RAM CPU DISQUE (ex: 90 95 85)');
        }
        const [ram, cpu, disk] = parts.map(Number);
        if ([ram, cpu, disk].some(v => isNaN(v) || v < 50 || v > 99)) {
          return bot.sendMessage(cid, '❌ Valeurs invalides (50-99).');
        }
        const cfg = getMonitorConfig();
        cfg.thresholds = { ram, cpu, disk };
        saveMonitorConfig(cfg);
        bot.sendMessage(cid, `✅ Seuils mis à jour: RAM ${ram}% | CPU ${cpu}% | Disque ${disk}%`);
        showMenu(bot, cid);
      },
    };
    bot.sendMessage(chatId, '⚙️ Entrez les seuils: RAM CPU DISQUE\nEx: `90 95 85`', { parse_mode: 'Markdown' });
  }

  if (data === 'mon_services') {
    pendingActions[chatId] = {
      action: 'mon_set_services',
      handler: (bot, cid, text, pending, pa) => {
        delete pa[cid];
        const services = text.trim().split(/[\s,]+/).filter(s => s);
        if (services.length === 0) {
          return bot.sendMessage(cid, '❌ Liste vide.');
        }
        const cfg = getMonitorConfig();
        cfg.watchServices = services;
        saveMonitorConfig(cfg);
        bot.sendMessage(cid, `✅ Services surveillés: ${services.join(', ')}`);
        showMenu(bot, cid);
      },
    };
    const cfg = getMonitorConfig();
    bot.sendMessage(chatId,
      `📋 Services actuels: ${cfg.watchServices.join(', ')}\n\nEntrez la nouvelle liste (séparés par espace ou virgule):\nEx: \`xray nginx ssh dropbear\``,
      { parse_mode: 'Markdown' }
    );
  }

  if (data === 'mon_ssl') {
    bot.sendMessage(chatId, '🔒 Vérification SSL...');
    try {
      const domain = await runCommand("cat /etc/xray/domain 2>/dev/null || hostname");
      const sslInfo = await runCommand(`echo | openssl s_client -servername ${domain.trim()} -connect ${domain.trim()}:443 2>/dev/null | openssl x509 -noout -dates -subject 2>/dev/null`);

      const lines = sslInfo.trim().split('\n');
      let notAfter = 'N/A', subject = 'N/A';
      lines.forEach(l => {
        if (l.includes('notAfter')) notAfter = l.split('=')[1]?.trim();
        if (l.includes('subject')) subject = l.split('=').slice(1).join('=').trim();
      });

      let daysLeft = 'N/A';
      if (notAfter !== 'N/A') {
        daysLeft = Math.ceil((new Date(notAfter) - new Date()) / (1000 * 60 * 60 * 24));
      }

      const statusIcon = daysLeft > 30 ? '🟢' : daysLeft > 7 ? '🟡' : '🔴';

      bot.sendMessage(chatId,
        `━━━━━━━━━━━━━━━━━━━━━
🔒 *CERTIFICAT SSL*
━━━━━━━━━━━━━━━━━━━━━
🌐 Domain: \`${domain.trim()}\`
📜 Subject: ${subject}
📅 Expire: ${notAfter}
${statusIcon} Jours restants: ${daysLeft}
━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_monitor' }]] } }
      );
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur SSL: ${err.message}`);
    }
  }
}

function startMonitor(bot) {
  const cfg = getMonitorConfig();
  if (monitorInterval) clearInterval(monitorInterval);

  monitorInterval = setInterval(async () => {
    const alerts = await runCheck(bot);
    if (alerts.length > 0) {
      // Avoid spamming same alerts
      const alertKey = alerts.join('|');
      const cfg2 = getMonitorConfig();
      const now = Date.now();
      const lastAlert = cfg2.alertsSent?.[alertKey] || 0;

      if (now - lastAlert > 30 * 60 * 1000) { // 30 min cooldown
        let text = `🔔 *ALERTE MONITORING*\n\n`;
        alerts.forEach(a => { text += `${a}\n`; });

        bot.sendMessage(config.ADMIN_ID, text, { parse_mode: 'Markdown' });

        if (!cfg2.alertsSent) cfg2.alertsSent = {};
        cfg2.alertsSent[alertKey] = now;
        saveMonitorConfig(cfg2);
      }
    }
  }, cfg.intervalMinutes * 60 * 1000);
}

function stopMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

function init(bot) {
  const cfg = getMonitorConfig();
  if (cfg.enabled) startMonitor(bot);
}

module.exports = { showMenu, handleCallback, init };
