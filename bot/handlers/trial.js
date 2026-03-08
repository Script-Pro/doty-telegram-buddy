const { runCommand, getServerIP, getDomain } = require('../utils/exec');
const { generateUUID, getExpiryDate, readJSON, writeJSON } = require('../utils/helpers');
const { autoDeleteSend } = require('../utils/autodelete');
const config = require('../config');
const path = require('path');

const TRIAL_CONFIG = path.join(__dirname, '..', 'data', 'trial_config.json');
const TRIAL_LOG = path.join(__dirname, '..', 'data', 'trial_log.json');

function getTrialConfig() {
  return readJSON(TRIAL_CONFIG) || { maxPerDay: 5, defaultDuration: 1, defaultDurationUnit: 'h', todayCount: 0, lastDate: null };
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

function getDurationLabel(cfg) {
  const u = cfg.defaultDurationUnit || 'h';
  const v = cfg.defaultDuration || 1;
  const labels = { h: 'heure(s)', jr: 'jour(s)' };
  return `${v} ${labels[u] || u}`;
}

function getDurationDays(cfg) {
  const u = cfg.defaultDurationUnit || 'h';
  const v = cfg.defaultDuration || 1;
  if (u === 'jr') return v;
  // For hours, we use 1 day minimum for system user expiry
  return Math.max(1, Math.ceil(v / 24));
}

function editOrSend(bot, chatId, msgId, text, opts = {}) {
  if (msgId) {
    return bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...opts }).catch(() => bot.sendMessage(chatId, text, opts));
  }
  return bot.sendMessage(chatId, text, opts);
}

function showMenu(bot, chatId, msgId) {
  const cfg = resetDailyCountIfNeeded();

  const buttons = [
    [{ text: '🔰 Trial VLESS', callback_data: 'trial_vless' }, { text: '🔰 Trial VMESS', callback_data: 'trial_vmess' }],
    [{ text: '🔑 Trial SSH', callback_data: 'trial_ssh' }, { text: '🔰 Trial TROJAN', callback_data: 'trial_trojan' }],
    [{ text: '🔌 Trial UDP', callback_data: 'trial_udp' }, { text: '📱 Trial ZIVPN', callback_data: 'trial_zivpn' }],
    [{ text: '📡 Trial SlowDNS', callback_data: 'trial_dns' }],
    [{ text: '⚙️ Configuration trial', callback_data: 'trial_config' }],
    [{ text: '📋 Historique trials', callback_data: 'trial_history' }],
    [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }],
  ];

  const text = `━━━━━━━━━━━━━━━━━━━━━\n🕐 *COMPTES TRIAL*\n━━━━━━━━━━━━━━━━━━━━━\nCréés aujourd'hui: ${cfg.todayCount}/${cfg.maxPerDay}\nDurée par défaut: ${getDurationLabel(cfg)}\n━━━━━━━━━━━━━━━━━━━━━`;
  editOrSend(bot, chatId, msgId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
}

async function handleCallback(bot, chatId, data, query, pendingActions) {
  const msgId = query?.message?.message_id;

  // Xray-based trials (VLESS, VMESS, TROJAN)
  if (data === 'trial_vless' || data === 'trial_vmess' || data === 'trial_trojan') {
    const cfg = resetDailyCountIfNeeded();
    if (cfg.todayCount >= cfg.maxPerDay) {
      return editOrSend(bot, chatId, msgId, `❌ Limite de trials atteinte (${cfg.maxPerDay}/jour).`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] },
      });
    }

    const proto = data.replace('trial_', '');
    const username = `trial_${Date.now().toString(36)}`;
    const uuid = generateUUID();
    const domain = await getDomain();

    try {
      await runCommand(`/usr/local/sbin/add-${proto} ${username} ${uuid} ${getDurationDays(cfg)}`);

      cfg.todayCount++;
      saveTrialConfig(cfg);

      addTrialLog({ proto, username, uuid, createdBy: query.from.id, createdAt: new Date().toISOString(), duration: getDurationLabel(cfg) });

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

      editOrSend(bot, chatId, msgId,
        `━━━━━━━━━━━━━━━━━━━━━\n🕐 *TRIAL ${proto.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━\n👤 User: \`${username}\`\n🔑 UUID: \`${uuid}\`\n🌐 Domain: ${domain}\n📅 Durée: ${getDurationLabel(cfg)}\n━━━━━━━━━━━━━━━━━━━━━\n🔗 Lien:\n\`${link}\`\n━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] } }
      );
    } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`); }
  }

  // SSH trial
  if (data === 'trial_ssh') {
    const cfg = resetDailyCountIfNeeded();
    if (cfg.todayCount >= cfg.maxPerDay) {
      return editOrSend(bot, chatId, msgId, `❌ Limite de trials atteinte.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] } });
    }

    const username = `trial_${Date.now().toString(36)}`;
    const password = Math.random().toString(36).substring(2, 10);
    const domain = await getDomain();
    const days = getDurationDays(cfg);

    try {
      await runCommand(`useradd -M -s /bin/false -e $(date -d "+${days} days" +%Y-%m-%d) ${username}`);
      await runCommand(`echo "${username}:${password}" | chpasswd`);
      await runCommand(`mkdir -p /etc/ssh-users && echo '${JSON.stringify({ username, password, expiry: getExpiryDate(days) })}' > /etc/ssh-users/${username}.json`);

      cfg.todayCount++;
      saveTrialConfig(cfg);

      addTrialLog({ proto: 'ssh', username, password, createdBy: query.from.id, createdAt: new Date().toISOString(), duration: getDurationLabel(cfg) });

      const audit = require('../utils/audit');
      audit.log(query.from.id, 'trial', `Created SSH trial: ${username}`);

      editOrSend(bot, chatId, msgId,
        `━━━━━━━━━━━━━━━━━━━━━\n🕐 *TRIAL SSH*\n━━━━━━━━━━━━━━━━━━━━━\n👤 User: \`${username}\`\n🔑 Pass: \`${password}\`\n🌐 Host: ${domain}\n📅 Durée: ${getDurationLabel(cfg)}\n━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] } }
      );
    } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`); }
  }

  // UDP Custom trial
  if (data === 'trial_udp') {
    const cfg = resetDailyCountIfNeeded();
    if (cfg.todayCount >= cfg.maxPerDay) {
      return editOrSend(bot, chatId, msgId, `❌ Limite de trials atteinte.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] } });
    }

    const username = `trial_${Date.now().toString(36)}`;
    const password = Math.random().toString(36).substring(2, 10);
    const domain = await getDomain();
    const days = getDurationDays(cfg);

    try {
      await runCommand('mkdir -p /etc/udp/users');
      const userInfo = { username, password, expiry: getExpiryDate(days), locked: false, connLimit: 1, dataLimit: 0, createdBy: 'trial' };
      await runCommand(`echo '${JSON.stringify(userInfo)}' > /etc/udp/users/${username}.json`);
      // Add to UDP config
      await runCommand(`jq '.auth.config += ["${username}:${password}"]' /etc/udp/config.json > /tmp/udp_tmp.json && mv /tmp/udp_tmp.json /etc/udp/config.json 2>/dev/null || true`);
      await runCommand('systemctl restart udp-custom 2>/dev/null || true');

      cfg.todayCount++;
      saveTrialConfig(cfg);

      addTrialLog({ proto: 'udp', username, password, createdBy: query.from.id, createdAt: new Date().toISOString(), duration: getDurationLabel(cfg) });

      const audit = require('../utils/audit');
      audit.log(query.from.id, 'trial', `Created UDP trial: ${username}`);

      editOrSend(bot, chatId, msgId,
        `━━━━━━━━━━━━━━━━━━━━━\n🕐 *TRIAL UDP CUSTOM*\n━━━━━━━━━━━━━━━━━━━━━\n👤 User: \`${username}\`\n🔑 Pass: \`${password}\`\n🌐 Host: ${domain}\n📅 Durée: ${getDurationLabel(cfg)}\n━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] } }
      );
    } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`); }
  }

  // ZiVPN trial
  if (data === 'trial_zivpn') {
    const cfg = resetDailyCountIfNeeded();
    if (cfg.todayCount >= cfg.maxPerDay) {
      return editOrSend(bot, chatId, msgId, `❌ Limite de trials atteinte.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] } });
    }

    const username = `trial_${Date.now().toString(36)}`;
    const password = Math.random().toString(36).substring(2, 10);
    const domain = await getDomain();
    const days = getDurationDays(cfg);

    try {
      await runCommand('mkdir -p /etc/zivpn/users');
      const userInfo = { username, password, expiry: getExpiryDate(days), locked: false, connLimit: 1, dataLimit: 0, createdBy: 'trial' };
      await runCommand(`echo '${JSON.stringify(userInfo)}' > /etc/zivpn/users/${username}.json`);
      // Add password to ZiVPN config
      await runCommand(`jq '.auth.config += ["${password}"]' /etc/zivpn/config.json > /tmp/zivpn_tmp.json && mv /tmp/zivpn_tmp.json /etc/zivpn/config.json 2>/dev/null || true`);
      await runCommand('systemctl restart zivpn 2>/dev/null || true');

      cfg.todayCount++;
      saveTrialConfig(cfg);

      addTrialLog({ proto: 'zivpn', username, password, createdBy: query.from.id, createdAt: new Date().toISOString(), duration: getDurationLabel(cfg) });

      const audit = require('../utils/audit');
      audit.log(query.from.id, 'trial', `Created ZiVPN trial: ${username}`);

      editOrSend(bot, chatId, msgId,
        `━━━━━━━━━━━━━━━━━━━━━\n🕐 *TRIAL ZIVPN*\n━━━━━━━━━━━━━━━━━━━━━\n👤 User: \`${username}\`\n🔑 Pass: \`${password}\`\n🌐 Host: ${domain}\n📡 Port: 5667 UDP\n📅 Durée: ${getDurationLabel(cfg)}\n━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] } }
      );
    } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`); }
  }

  // SlowDNS trial
  if (data === 'trial_dns') {
    const cfg = resetDailyCountIfNeeded();
    if (cfg.todayCount >= cfg.maxPerDay) {
      return editOrSend(bot, chatId, msgId, `❌ Limite de trials atteinte.`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] } });
    }

    const username = `trial_${Date.now().toString(36)}`;
    const password = Math.random().toString(36).substring(2, 10);
    const domain = await getDomain();
    const days = getDurationDays(cfg);

    try {
      await runCommand('mkdir -p /etc/slowdns/users');
      await runCommand(`useradd -M -s /bin/false -e $(date -d "+${days} days" +%Y-%m-%d) ${username} 2>/dev/null || true`);
      await runCommand(`echo "${username}:${password}" | chpasswd`);
      const userInfo = { username, password, expiry: getExpiryDate(days), locked: false, connLimit: 1, dataLimit: 0, createdBy: 'trial' };
      await runCommand(`echo '${JSON.stringify(userInfo)}' > /etc/slowdns/users/${username}.json`);

      const nsKey = await runCommand('cat /etc/slowdns/server.pub 2>/dev/null || echo "N/A"');
      const ns = await runCommand('cat /etc/slowdns/ns 2>/dev/null || echo "N/A"');

      cfg.todayCount++;
      saveTrialConfig(cfg);

      addTrialLog({ proto: 'dns', username, password, createdBy: query.from.id, createdAt: new Date().toISOString(), duration: getDurationLabel(cfg) });

      const audit = require('../utils/audit');
      audit.log(query.from.id, 'trial', `Created SlowDNS trial: ${username}`);

      editOrSend(bot, chatId, msgId,
        `━━━━━━━━━━━━━━━━━━━━━\n🕐 *TRIAL SLOWDNS*\n━━━━━━━━━━━━━━━━━━━━━\n👤 User: \`${username}\`\n🔑 Pass: \`${password}\`\n🌐 Host: ${domain}\n📅 Durée: ${getDurationLabel(cfg)}\n🔑 NS Key: \`${nsKey}\`\n📡 NS: \`${ns}\`\n━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] } }
      );
    } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`); }
  }

  // Trial config
  if (data === 'trial_config') {
    const cfg = getTrialConfig();
    const buttons = [
      [{ text: `📊 Max/jour: ${cfg.maxPerDay}`, callback_data: 'trial_set_max' }],
      [{ text: `📅 Durée: ${getDurationLabel(cfg)}`, callback_data: 'trial_set_duration' }],
      [{ text: '🔙 Retour', callback_data: 'menu_trial' }],
    ];
    editOrSend(bot, chatId, msgId, '⚙️ *Configuration Trial:*', {
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
        if (isNaN(max) || max < 1) return autoDeleteSend(bot, cid, '❌ Nombre invalide.');
        const cfg = getTrialConfig();
        cfg.maxPerDay = max;
        saveTrialConfig(cfg);
        autoDeleteSend(bot, cid, `✅ Max trials/jour: ${max}`);
      },
    };
    editOrSend(bot, chatId, msgId, '📊 Entrez le nombre max de trials par jour:');
  }

  if (data === 'trial_set_duration') {
    editOrSend(bot, chatId, msgId, '⏱ Unité de durée trial:', {
      reply_markup: { inline_keyboard: [
        [{ text: '🕐 Heures (h)', callback_data: 'trial_dur_h' }],
        [{ text: '📅 Jours (jr)', callback_data: 'trial_dur_jr' }],
        [{ text: '🔙 Retour', callback_data: 'trial_config' }],
      ] }
    });
  }

  if (data === 'trial_dur_h' || data === 'trial_dur_jr') {
    const unit = data === 'trial_dur_h' ? 'h' : 'jr';
    const label = unit === 'h' ? 'heures' : 'jours';
    pendingActions[chatId] = {
      action: 'trial_set_duration',
      handler: (bot, cid, text, pending, pa) => {
        delete pa[cid];
        const val = parseInt(text);
        if (isNaN(val) || val < 1) return autoDeleteSend(bot, cid, '❌ Nombre invalide.');
        const cfg = getTrialConfig();
        cfg.defaultDuration = val;
        cfg.defaultDurationUnit = unit;
        saveTrialConfig(cfg);
        autoDeleteSend(bot, cid, `✅ Durée trial: ${val} ${label}`);
      },
    };
    editOrSend(bot, chatId, msgId, `🔢 Nombre de ${label}:`);
  }

  if (data === 'trial_history') {
    const logs = getTrialLog();
    if (logs.length === 0) {
      return editOrSend(bot, chatId, msgId, '📋 Aucun trial créé.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] },
      });
    }

    let text = `━━━━━━━━━━━━━━━━━━━━━\n📋 *HISTORIQUE TRIALS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    logs.slice(-15).reverse().forEach(l => {
      const date = l.createdAt.split('T')[0];
      text += `• ${l.proto.toUpperCase()} - ${l.username} (${date})\n`;
    });
    text += '\n━━━━━━━━━━━━━━━━━━━━━';

    editOrSend(bot, chatId, msgId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_trial' }]] },
    });
  }
}

module.exports = { showMenu, handleCallback };
