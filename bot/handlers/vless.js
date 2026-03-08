const { runCommand, getDomain } = require('../utils/exec');
const { generateUUID, getExpiryDate, adjustExpiry } = require('../utils/helpers');
const { paginatedKeyboard, getPageFromCallback } = require('../utils/pagination');
const { getXrayTraffic, formatBytes, parseLimitToBytes, setDataLimit, getDataLimit, removeDataLimit, setConnLimit, getConnLimit } = require('../utils/traffic');

const USERS_DB = '/etc/xray/users';
const PROTO = 'vless';
const INBOUND_INDEX = 0;

function showMenu(bot, chatId) {
  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━\n🔰 *VLESS MENU*\n━━━━━━━━━━━━━━━━━━━━━`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Créer', callback_data: 'vless_create' }, { text: '✏️ Modifier', callback_data: 'vless_modify' }],
          [{ text: '🔄 Renouveler', callback_data: 'vless_renew' }, { text: '🗑 Supprimer', callback_data: 'vless_delete' }],
          [{ text: '📋 Liste', callback_data: 'vless_list' }, { text: '🔍 Détails', callback_data: 'vless_detail' }],
          [{ text: '🔒 Lock/Unlock', callback_data: 'vless_lock' }],
          [{ text: '📊 Trafic', callback_data: 'vless_traffic' }, { text: '📦 Quota Data', callback_data: 'vless_quota' }],
          [{ text: '🔢 Limite Connexion', callback_data: 'vless_connlimit' }],
          [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }],
        ],
      },
    }
  );
}

async function getUsers() {
  try {
    const result = await runCommand(`ls ${USERS_DB}/ 2>/dev/null | sed 's/.json//'`);
    return result ? result.split('\n').filter(Boolean) : [];
  } catch { return []; }
}

async function handleCallback(bot, chatId, data, query) {
  const { pendingActions } = require('../index');

  // Pagination handlers
  if (data.startsWith('vless_pgl_')) { return showPaginatedList(bot, chatId, 'vless_del_', 'vless_pgl_', getPageFromCallback(data, 'vless_pgl_')); }
  if (data.startsWith('vless_pgr_')) { return showPaginatedList(bot, chatId, 'vless_ren_', 'vless_pgr_', getPageFromCallback(data, 'vless_pgr_')); }
  if (data.startsWith('vless_pgd_')) { return showPaginatedList(bot, chatId, 'vless_det_', 'vless_pgd_', getPageFromCallback(data, 'vless_pgd_')); }
  if (data.startsWith('vless_pglk_')) { return showPaginatedList(bot, chatId, 'vless_lck_', 'vless_pglk_', getPageFromCallback(data, 'vless_pglk_')); }
  if (data.startsWith('vless_pgm_')) { return showPaginatedList(bot, chatId, 'vless_mod_', 'vless_pgm_', getPageFromCallback(data, 'vless_pgm_')); }
  if (data.startsWith('vless_pgt_')) { return showPaginatedList(bot, chatId, 'vless_trf_', 'vless_pgt_', getPageFromCallback(data, 'vless_pgt_')); }
  if (data.startsWith('vless_pgq_')) { return showPaginatedList(bot, chatId, 'vless_qta_', 'vless_pgq_', getPageFromCallback(data, 'vless_pgq_')); }
  if (data.startsWith('vless_pgc_')) { return showPaginatedList(bot, chatId, 'vless_cl_', 'vless_pgc_', getPageFromCallback(data, 'vless_pgc_')); }

  switch (data) {
    case 'vless_create':
      bot.sendMessage(chatId, '📝 Nom d\'utilisateur VLESS:');
      pendingActions[chatId] = { action: 'vless_create', step: 'username', handler: handleCreateFlow };
      break;
    case 'vless_modify':
      await showPaginatedList(bot, chatId, 'vless_mod_', 'vless_pgm_', 0);
      break;
    case 'vless_delete':
      await showPaginatedList(bot, chatId, 'vless_del_', 'vless_pgl_', 0);
      break;
    case 'vless_renew':
      await showPaginatedList(bot, chatId, 'vless_ren_', 'vless_pgr_', 0);
      break;
    case 'vless_list':
      await listUsers(bot, chatId);
      break;
    case 'vless_detail':
      await showPaginatedList(bot, chatId, 'vless_det_', 'vless_pgd_', 0);
      break;
    case 'vless_lock':
      await showPaginatedList(bot, chatId, 'vless_lck_', 'vless_pglk_', 0);
      break;
    case 'vless_traffic':
      await showPaginatedList(bot, chatId, 'vless_trf_', 'vless_pgt_', 0);
      break;
    case 'vless_quota':
      await showPaginatedList(bot, chatId, 'vless_qta_', 'vless_pgq_', 0);
      break;
    case 'vless_connlimit':
      await showPaginatedList(bot, chatId, 'vless_cl_', 'vless_pgc_', 0);
      break;
    default:
      // Delete confirmation
      if (data.startsWith('vless_del_')) {
        const user = data.replace('vless_del_', '');
        bot.sendMessage(chatId, `⚠️ Supprimer *${user}* ?`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [
            [{ text: '🗑 Supprimer', callback_data: `vless_dely_${user}` }, { text: '❌ Annuler', callback_data: `vless_deln_${user}` }]
          ]}
        });
      }
      else if (data.startsWith('vless_dely_')) await deleteUser(bot, chatId, data.replace('vless_dely_', ''));
      else if (data.startsWith('vless_deln_')) bot.sendMessage(chatId, '❌ Suppression annulée.');
      // Modify
      else if (data.startsWith('vless_mod_')) {
        const user = data.replace('vless_mod_', '');
        bot.sendMessage(chatId, `✏️ Que modifier pour *${user}* ?`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [
            [{ text: '👤 Username', callback_data: `vless_mu_${user}` }, { text: '🔑 UUID', callback_data: `vless_mp_${user}` }],
            [{ text: '🔙 Retour', callback_data: 'vless_modify' }]
          ]}
        });
      }
      else if (data.startsWith('vless_mu_')) {
        const user = data.replace('vless_mu_', '');
        bot.sendMessage(chatId, `📝 Nouveau nom pour *${user}*:`, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: 'vless_modify_user', user, handler: handleModifyUsername };
      }
      else if (data.startsWith('vless_mp_')) {
        const user = data.replace('vless_mp_', '');
        await regenerateUUID(bot, chatId, user);
      }
      // Renew
      else if (data.startsWith('vless_ren_')) {
        const user = data.replace('vless_ren_', '');
        bot.sendMessage(chatId, `🔄 *${user}* — Choisir l'action:`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [
            [{ text: '➕ Ajouter', callback_data: `vless_ra_${user}` }, { text: '➖ Retirer', callback_data: `vless_rs_${user}` }],
            [{ text: '🔙 Retour', callback_data: 'vless_renew' }]
          ]}
        });
      }
      else if (data.startsWith('vless_ra_') || data.startsWith('vless_rs_')) {
        const add = data.startsWith('vless_ra_');
        const user = data.replace(add ? 'vless_ra_' : 'vless_rs_', '');
        bot.sendMessage(chatId, `⏱ Unité:`, {
          reply_markup: { inline_keyboard: [
            [{ text: '📅 Jours', callback_data: `vless_ru_${add ? 'a' : 's'}_d_${user}` }],
            [{ text: '🕐 Heures', callback_data: `vless_ru_${add ? 'a' : 's'}_h_${user}` }],
            [{ text: '⏱ Minutes', callback_data: `vless_ru_${add ? 'a' : 's'}_m_${user}` }],
          ]}
        });
      }
      else if (data.startsWith('vless_ru_')) {
        const parts = data.replace('vless_ru_', '').split('_');
        const sign = parts[0]; // a or s
        const unit = parts[1]; // d, h, m
        const user = parts.slice(2).join('_');
        const unitMap = { d: 'jours', h: 'heures', m: 'minutes' };
        bot.sendMessage(chatId, `🔢 Nombre de ${unitMap[unit]} à ${sign === 'a' ? 'ajouter' : 'retirer'}:`);
        pendingActions[chatId] = { action: 'vless_renew_exec', user, sign, unit, handler: handleRenewFlow };
      }
      // Detail
      else if (data.startsWith('vless_det_')) await showDetail(bot, chatId, data.replace('vless_det_', ''));
      // Lock
      else if (data.startsWith('vless_lck_')) await toggleLock(bot, chatId, data.replace('vless_lck_', ''));
      // Traffic
      else if (data.startsWith('vless_trf_')) await showTraffic(bot, chatId, data.replace('vless_trf_', ''));
      else if (data.startsWith('vless_trr_')) await showTraffic(bot, chatId, data.replace('vless_trr_', ''));
      // Quota
      else if (data.startsWith('vless_qta_')) {
        const user = data.replace('vless_qta_', '');
        bot.sendMessage(chatId, `📦 Limite de données pour *${user}*\nEx: \`5GB\`, \`500MB\`, \`1TB\``, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: 'vless_quota_set', user, handler: handleQuotaFlow };
      }
      // Connection limit
      else if (data.startsWith('vless_cl_')) {
        const user = data.replace('vless_cl_', '');
        bot.sendMessage(chatId, `🔢 Nombre max de connexions pour *${user}*:`, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: 'vless_connlimit_set', user, handler: handleConnLimitFlow };
      }
      // Quota exceeded actions
      else if (data.startsWith('vless_qe_')) {
        const parts = data.replace('vless_qe_', '').split('_');
        const action = parts[0]; // ext or del
        const user = parts.slice(1).join('_');
        if (action === 'ext') {
          bot.sendMessage(chatId, `📦 Nouveau quota pour *${user}* (ex: 5GB):`, { parse_mode: 'Markdown' });
          pendingActions[chatId] = { action: 'vless_quota_set', user, handler: handleQuotaFlow };
        } else if (action === 'del') {
          await deleteUser(bot, chatId, user);
        }
      }
  }
}

async function showPaginatedList(bot, chatId, prefix, pagePrefix, page) {
  const users = await getUsers();
  if (!users.length) { bot.sendMessage(chatId, '📋 Aucun utilisateur.'); return; }
  const kb = paginatedKeyboard(users, prefix, pagePrefix, page, `menu_${PROTO}`);
  bot.sendMessage(chatId, '👤 Sélectionnez:', kb);
}

async function handleCreateFlow(bot, chatId, text, pending, pendingActions) {
  if (pending.step === 'username') {
    pending.username = text.trim();
    pending.step = 'days';
    bot.sendMessage(chatId, '📅 Durée (en jours):');
  } else if (pending.step === 'days') {
    const days = parseInt(text);
    if (isNaN(days) || days < 1) { bot.sendMessage(chatId, '❌ Invalide.'); delete pendingActions[chatId]; return; }
    pending.step = 'connlimit';
    pending.days = days;
    bot.sendMessage(chatId, '🔢 Limite de connexions simultanées (0 = illimité):');
  } else if (pending.step === 'connlimit') {
    const limit = parseInt(text);
    if (isNaN(limit) || limit < 0) { bot.sendMessage(chatId, '❌ Invalide.'); delete pendingActions[chatId]; return; }
    pending.connLimit = limit;
    pending.step = 'datalimit';
    bot.sendMessage(chatId, '📦 Limite de données (ex: `5GB`, `500MB`, `0` = illimité):', { parse_mode: 'Markdown' });
  } else if (pending.step === 'datalimit') {
    delete pendingActions[chatId];
    const dataLimitStr = text.trim();
    let dataLimitBytes = 0;
    if (dataLimitStr !== '0') {
      dataLimitBytes = parseLimitToBytes(dataLimitStr);
      if (dataLimitBytes === null) { bot.sendMessage(chatId, '❌ Format invalide. Ex: 5GB, 500MB'); return; }
    }
    await createUser(bot, chatId, pending.username, pending.days, pending.connLimit, dataLimitBytes);
  }
}

async function createUser(bot, chatId, username, days, connLimit, dataLimitBytes) {
  try {
    const uuid = generateUUID();
    const expiry = getExpiryDate(days);
    const domain = await getDomain();
    await runCommand(`mkdir -p ${USERS_DB}`);
    await runCommand(`cd /etc/xray && jq '.inbounds[${INBOUND_INDEX}].settings.clients += [{"id":"${uuid}","email":"${username}"}]' config.json > tmp.json && mv tmp.json config.json`);
    await runCommand(`echo '${JSON.stringify({ username, uuid, expiry, protocol: PROTO, locked: false, connLimit, dataLimit: dataLimitBytes })}' > ${USERS_DB}/${username}.json`);
    await runCommand('systemctl restart xray');

    if (connLimit > 0) await setConnLimit(PROTO, username, connLimit);
    if (dataLimitBytes > 0) await setDataLimit(PROTO, username, dataLimitBytes);

    const wsLink = `vless://${uuid}@${domain}:443?type=ws&security=tls&path=/vless&host=${domain}&sni=${domain}#${username}_WS-TLS`;
    const wsNtls = `vless://${uuid}@${domain}:80?type=ws&path=/vless&host=${domain}#${username}_WS-NTLS`;
    const grpcLink = `vless://${uuid}@${domain}:443?type=grpc&security=tls&serviceName=vless-grpc&sni=${domain}#${username}_gRPC`;

    bot.sendMessage(chatId,
      `━━━━━━━━━━━━━━━━━━━━━\n✅ *VLESS Account Created*\n━━━━━━━━━━━━━━━━━━━━━\n👤 User: \`${username}\`\n🔑 UUID: \`${uuid}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${expiry}\`\n🔢 Max Conn: ${connLimit || '♾ Illimité'}\n📦 Quota: ${dataLimitBytes ? formatBytes(dataLimitBytes) : '♾ Illimité'}\n━━━━━━━━━━━━━━━━━━━━━\n🔗 *WS TLS:*\n\`${wsLink}\`\n\n🔗 *WS Non-TLS:*\n\`${wsNtls}\`\n\n🔗 *gRPC:*\n\`${grpcLink}\`\n━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function handleModifyUsername(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  const oldUser = pending.user;
  const newUser = text.trim();
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${oldUser}.json`));
    // Update xray config
    await runCommand(`cd /etc/xray && jq '(.inbounds[${INBOUND_INDEX}].settings.clients[] | select(.email=="${oldUser}")).email = "${newUser}"' config.json > tmp.json && mv tmp.json config.json`);
    info.username = newUser;
    await runCommand(`echo '${JSON.stringify(info)}' > ${USERS_DB}/${newUser}.json`);
    await runCommand(`rm -f ${USERS_DB}/${oldUser}.json`);
    await runCommand('systemctl restart xray');
    bot.sendMessage(chatId, `✅ *${oldUser}* → *${newUser}*`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function regenerateUUID(bot, chatId, username) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`));
    const newUUID = generateUUID();
    await runCommand(`cd /etc/xray && jq '(.inbounds[${INBOUND_INDEX}].settings.clients[] | select(.email=="${username}")).id = "${newUUID}"' config.json > tmp.json && mv tmp.json config.json`);
    info.uuid = newUUID;
    await runCommand(`echo '${JSON.stringify(info)}' > ${USERS_DB}/${username}.json`);
    await runCommand('systemctl restart xray');
    bot.sendMessage(chatId, `✅ UUID régénéré pour *${username}*:\n\`${newUUID}\``, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function handleRenewFlow(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  const amount = parseInt(text);
  if (isNaN(amount) || amount < 1) { bot.sendMessage(chatId, '❌ Invalide.'); return; }
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${pending.user}.json`));
    const unitMap = { d: 'days', h: 'hours', m: 'minutes' };
    const finalAmount = pending.sign === 's' ? -amount : amount;
    const newExpiry = adjustExpiry(info.expiry, finalAmount, unitMap[pending.unit]);
    await runCommand(`jq '.expiry = "${newExpiry}"' ${USERS_DB}/${pending.user}.json > /tmp/tmp.json && mv /tmp/tmp.json ${USERS_DB}/${pending.user}.json`);
    const unitLabels = { d: 'jour(s)', h: 'heure(s)', m: 'minute(s)' };
    bot.sendMessage(chatId, `✅ VLESS *${pending.user}* ${pending.sign === 'a' ? '+' : '-'}${amount} ${unitLabels[pending.unit]} → *${newExpiry}*`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function deleteUser(bot, chatId, username) {
  try {
    await runCommand(`cd /etc/xray && jq 'del(.inbounds[${INBOUND_INDEX}].settings.clients[] | select(.email=="${username}"))' config.json > tmp.json && mv tmp.json config.json`);
    await runCommand(`rm -f ${USERS_DB}/${username}.json`);
    await removeDataLimit(PROTO, username);
    await runCommand('systemctl restart xray');
    bot.sendMessage(chatId, `✅ VLESS *${username}* supprimé.`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function listUsers(bot, chatId) {
  const users = await getUsers();
  if (!users.length) { bot.sendMessage(chatId, '📋 Aucun utilisateur VLESS.'); return; }
  let text = '━━━━━━━━━━━━━━━━━━━━━\n📋 *VLESS Users*\n━━━━━━━━━━━━━━━━━━━━━\n';
  for (const u of users) {
    try {
      const d = JSON.parse(await runCommand(`cat ${USERS_DB}/${u}.json`));
      text += `👤 ${u} | 📅 ${d.expiry} | ${d.locked ? '🔒' : '🔓'}\n`;
    } catch { text += `👤 ${u}\n`; }
  }
  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

async function showDetail(bot, chatId, username) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`));
    const domain = await getDomain();
    const limit = await getDataLimit(PROTO, username);
    const conn = await getConnLimit(PROTO, username);
    const traffic = await getXrayTraffic(username);
    bot.sendMessage(chatId,
      `━━━━━━━━━━━━━━━━━━━━━\n🔍 *VLESS: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n🔑 UUID: \`${info.uuid}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${info.expiry}\`\n🔒 Locked: ${info.locked ? 'Oui' : 'Non'}\n🔢 Max Conn: ${conn ? conn.maxConn : '♾'}\n📦 Quota: ${limit ? formatBytes(limit.limitBytes) : '♾'}\n📊 Trafic: ↑${formatBytes(traffic.uplink)} ↓${formatBytes(traffic.downlink)}\n━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function toggleLock(bot, chatId, username) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`));
    const newLocked = !info.locked;
    await runCommand(`jq '.locked = ${newLocked}' ${USERS_DB}/${username}.json > /tmp/tmp.json && mv /tmp/tmp.json ${USERS_DB}/${username}.json`);
    if (newLocked) await runCommand(`cd /etc/xray && jq 'del(.inbounds[${INBOUND_INDEX}].settings.clients[] | select(.email=="${username}"))' config.json > tmp.json && mv tmp.json config.json`);
    else await runCommand(`cd /etc/xray && jq '.inbounds[${INBOUND_INDEX}].settings.clients += [{"id":"${info.uuid}","email":"${username}"}]' config.json > tmp.json && mv tmp.json config.json`);
    await runCommand('systemctl restart xray');
    bot.sendMessage(chatId, `✅ VLESS *${username}* ${newLocked ? '🔒' : '🔓'}`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function showTraffic(bot, chatId, username) {
  try {
    const traffic = await getXrayTraffic(username);
    const limit = await getDataLimit(PROTO, username);
    let text = `━━━━━━━━━━━━━━━━━━━━━\n📊 *Trafic VLESS: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n⬆️ Upload: ${formatBytes(traffic.uplink)}\n⬇️ Download: ${formatBytes(traffic.downlink)}\n📊 Total: ${formatBytes(traffic.total)}`;
    if (limit) {
      const pct = ((traffic.total / limit.limitBytes) * 100).toFixed(1);
      text += `\n📦 Quota: ${formatBytes(limit.limitBytes)}\n📈 Utilisé: ${pct}%`;
      if (traffic.total >= limit.limitBytes) {
        text += `\n\n⚠️ *QUOTA DÉPASSÉ!*`;
      }
    }
    text += '\n━━━━━━━━━━━━━━━━━━━━━';
    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [
        [{ text: '🔄 Actualiser', callback_data: `vless_trr_${username}` }],
        [{ text: '🔙 Retour', callback_data: `menu_${PROTO}` }]
      ]}
    });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function handleQuotaFlow(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  const limitStr = text.trim();
  if (limitStr === '0') {
    await removeDataLimit(PROTO, pending.user);
    bot.sendMessage(chatId, `✅ Quota supprimé pour *${pending.user}*`, { parse_mode: 'Markdown' });
    return;
  }
  const bytes = parseLimitToBytes(limitStr);
  if (!bytes) { bot.sendMessage(chatId, '❌ Format invalide. Ex: 5GB, 500MB'); return; }
  await setDataLimit(PROTO, pending.user, bytes);
  bot.sendMessage(chatId, `✅ Quota *${pending.user}*: ${formatBytes(bytes)}`, { parse_mode: 'Markdown' });
}

async function handleConnLimitFlow(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  const limit = parseInt(text);
  if (isNaN(limit) || limit < 0) { bot.sendMessage(chatId, '❌ Invalide.'); return; }
  await setConnLimit(PROTO, pending.user, limit);
  // Also update user JSON
  try {
    await runCommand(`jq '.connLimit = ${limit}' ${USERS_DB}/${pending.user}.json > /tmp/tmp.json && mv /tmp/tmp.json ${USERS_DB}/${pending.user}.json`);
  } catch {}
  bot.sendMessage(chatId, `✅ Limite connexion *${pending.user}*: ${limit || '♾ Illimité'}`, { parse_mode: 'Markdown' });
}

module.exports = { showMenu, handleCallback };
