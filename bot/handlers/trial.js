const { runCommand, getServerIP, getDomain } = require('../utils/exec');
const { generateUUID, readJSON, writeJSON } = require('../utils/helpers');
const config = require('../config');
const path = require('path');

const TRIAL_CONFIG = path.join(__dirname, '..', 'data', 'trial_config.json');
const TRIAL_LOG = path.join(__dirname, '..', 'data', 'trial_log.json');

function getTrialConfig() {
  return readJSON(TRIAL_CONFIG) || { maxPerDay: 5, defaultDuration: 1, todayCount: 0, lastDate: null };
}

function saveTrialConfig(cfg) {
  writeJSON(TRIAL_CONFIG, cfg);
}

function getTrialLog() {
  return readJSON(TRIAL_LOG) || [];
}

function addTrialLog(entry) {
  const logs = getTrialLog();
  logs.push(entry);
  if (logs.length > 200) logs.splice(0, logs.length - 200);
  writeJSON(TRIAL_LOG, logs);
}

function resetDailyCountIfNeeded() {
  const cfg = getTrialConfig();
  const today = new Date().toISOString().split('T')[0];
  if (cfg.lastDate !== today) {
    cfg.todayCount = 0;
    cfg.lastDate = today;
    saveTrialConfig(cfg);
  }
  return cfg;
}

function showMenu(bot, chatId) {
  const cfg = resetDailyCountIfNeeded();

  const buttons = [
    [{ text: '🔰 Trial VLESS (1 jour)', callback_data: 'trial_vless' }],
    [{ text: '🔰 Trial VMESS (1 jour)', callback_data: 'trial_vmess' }],
    [{ text: '🔑 Trial SSH (1 jour)', callback_data: 'trial_ssh' }],
    [{ text: '🔰 Trial TROJAN (1 jour)', callback_data: 'trial_trojan' }],
    [{ text: '⚙️ Configuration trial', callback_data: 'trial_config' }],
    [{ text: '📋 Historique trials', callback_data: 'trial_history' }],
    [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
  ];

  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━
🕐 *COMPTES TRIAL*
━━━━━━━━━━━━━━━━━━━━━
Créés aujourd'hui: ${cfg.todayCount}/${cfg.maxPerDay}
Durée par défaut: ${cfg.defaultDuration} jour(s)
━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
  );
}

async function handleCallback(bot, chatId, data, query, pendingActions) {
  if (data === 'trial_vless' || data === 'trial_vmess' || data === 'trial_trojan') {
    const cfg = resetDailyCountIfNeeded();
    if (cfg.todayCount >= cfg.maxPerDay) {
      return bot.sendMessage(chatId, `❌ Limite de trials atteinte (${cfg.maxPerDay}/jour).`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] },
      });
    }

    const proto = data.replace('trial_', '');
    const username = `trial_${Date.now().toString(36)}`;
    const uuid = generateUUID();
    const domain = await getDomain();
    const ip = await getServerIP();

    try {
      await runCommand(`/usr/local/sbin/add-${proto} ${username} ${uuid} ${cfg.defaultDuration}`);

      cfg.todayCount++;
      saveTrialConfig(cfg);

      addTrialLog({
        proto, username, uuid,
        createdBy: query.from.id,
        createdAt: new Date().toISOString(),
        duration: cfg.defaultDuration,
      });

      const audit = require('../utils/audit');
      audit.log(query.from.id, 'trial', `Created ${proto} trial: ${username}`);

      let link = '';
      if (proto === 'vless') {
        link = `vless://${uuid}@${domain}:443?type=ws&security=tls&path=/vless&sni=${domain}#${username}`;
      } else if (proto === 'vmess') {
        const vmessConfig = Buffer.from(JSON.stringify({
          v: '2', ps: username, add: domain, port: '443',
          id: uuid, aid: '0', net: 'ws', type: 'none',
          host: domain, path: '/vmess', tls: 'tls', sni: domain,
        })).toString('base64');
        link = `vmess://${vmessConfig}`;
      } else if (proto === 'trojan') {
        link = `trojan://${uuid}@${domain}:443?type=ws&security=tls&path=/trojan&sni=${domain}#${username}`;
      }

      bot.sendMessage(chatId,
        `━━━━━━━━━━━━━━━━━━━━━
🕐 *COMPTE TRIAL ${proto.toUpperCase()}*
━━━━━━━━━━━━━━━━━━━━━
👤 User: \`${username}\`
🔑 UUID: \`${uuid}\`
🌐 Domain: ${domain}
📅 Expire: ${cfg.defaultDuration} jour(s)
━━━━━━━━━━━━━━━━━━━━━
🔗 Lien:
\`${link}\`
━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] } }
      );
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
    }
  }

  if (data === 'trial_ssh') {
    const cfg = resetDailyCountIfNeeded();
    if (cfg.todayCount >= cfg.maxPerDay) {
      return bot.sendMessage(chatId, `❌ Limite de trials atteinte.`);
    }

    const username = `trial_${Date.now().toString(36)}`;
    const password = Math.random().toString(36).substring(2, 10);
    const domain = await getDomain();

    try {
      await runCommand(`useradd -M -s /bin/false -e $(date -d "+${cfg.defaultDuration} days" +%Y-%m-%d) ${username}`);
      await runCommand(`echo "${username}:${password}" | chpasswd`);
      await runCommand(`mkdir -p /etc/ssh-users && echo "${username}" > /etc/ssh-users/${username}`);

      cfg.todayCount++;
      saveTrialConfig(cfg);

      addTrialLog({
        proto: 'ssh', username, password,
        createdBy: query.from.id,
        createdAt: new Date().toISOString(),
        duration: cfg.defaultDuration,
      });

      const audit = require('../utils/audit');
      audit.log(query.from.id, 'trial', `Created SSH trial: ${username}`);

      bot.sendMessage(chatId,
        `━━━━━━━━━━━━━━━━━━━━━
🕐 *COMPTE TRIAL SSH*
━━━━━━━━━━━━━━━━━━━━━
👤 User: \`${username}\`
🔑 Pass: \`${password}\`
🌐 Host: ${domain}
📅 Expire: ${cfg.defaultDuration} jour(s)
━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] } }
      );
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
    }
  }

  if (data === 'trial_config') {
    const cfg = getTrialConfig();
    const buttons = [
      [{ text: `📊 Max/jour: ${cfg.maxPerDay}`, callback_data: 'trial_set_max' }],
      [{ text: `📅 Durée: ${cfg.defaultDuration}j`, callback_data: 'trial_set_duration' }],
      [{ text: '🔙 Retour', callback_data: 'menu_trial' }],
    ];
    bot.sendMessage(chatId, '⚙️ *Configuration Trial:*', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  if (data === 'trial_set_max') {
    pendingActions[chatId] = {
      action: 'trial_set_max',
      handler: (bot, cid, text, pending, pa) => {
        delete pa[cid];
        const max = parseInt(text);
        if (isNaN(max) || max < 1) return bot.sendMessage(cid, '❌ Nombre invalide.');
        const cfg = getTrialConfig();
        cfg.maxPerDay = max;
        saveTrialConfig(cfg);
        bot.sendMessage(cid, `✅ Max trials/jour: ${max}`);
        showMenu(bot, cid);
      },
    };
    bot.sendMessage(chatId, '📊 Entrez le nombre max de trials par jour:');
  }

  if (data === 'trial_set_duration') {
    pendingActions[chatId] = {
      action: 'trial_set_duration',
      handler: (bot, cid, text, pending, pa) => {
        delete pa[cid];
        const days = parseInt(text);
        if (isNaN(days) || days < 1 || days > 7) return bot.sendMessage(cid, '❌ Durée invalide (1-7 jours).');
        const cfg = getTrialConfig();
        cfg.defaultDuration = days;
        saveTrialConfig(cfg);
        bot.sendMessage(cid, `✅ Durée trial: ${days} jour(s)`);
        showMenu(bot, cid);
      },
    };
    bot.sendMessage(chatId, '📅 Entrez la durée des trials en jours (1-7):');
  }

  if (data === 'trial_history') {
    const logs = getTrialLog();
    if (logs.length === 0) {
      return bot.sendMessage(chatId, '📋 Aucun trial créé.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] },
      });
    }

    let text = `━━━━━━━━━━━━━━━━━━━━━\n📋 *HISTORIQUE TRIALS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    logs.slice(-15).reverse().forEach(l => {
      const date = l.createdAt.split('T')[0];
      text += `• ${l.proto.toUpperCase()} - ${l.username} (${date})\n`;
    });
    text += '\n━━━━━━━━━━━━━━━━━━━━━';

    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] },
    });
  }
}

module.exports = { showMenu, handleCallback };
