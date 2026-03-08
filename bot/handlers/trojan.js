const { runCommand, getDomain } = require('../utils/exec');
const { generateUUID, getExpiryDate, adjustExpiry } = require('../utils/helpers');
const { paginatedKeyboard, getPageFromCallback } = require('../utils/pagination');
const { getXrayTraffic, formatBytes, parseLimitToBytes, setDataLimit, getDataLimit, removeDataLimit, setConnLimit, getConnLimit } = require('../utils/traffic');

const USERS_DB = '/etc/xray/users-trojan';
const PROTO = 'trojan';
const INBOUND_INDEX = 2;

function showMenu(bot, chatId) {
  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━\n🔰 *TROJAN MENU*\n━━━━━━━━━━━━━━━━━━━━━`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Créer', callback_data: 'trojan_create' }, { text: '✏️ Modifier', callback_data: 'trojan_modify' }],
          [{ text: '🔄 Renouveler', callback_data: 'trojan_renew' }, { text: '🗑 Supprimer', callback_data: 'trojan_delete' }],
          [{ text: '📋 Liste', callback_data: 'trojan_list' }, { text: '🔍 Détails', callback_data: 'trojan_detail' }],
          [{ text: '🔒 Lock/Unlock', callback_data: 'trojan_lock' }],
          [{ text: '📊 Trafic', callback_data: 'trojan_traffic' }, { text: '📦 Quota Data', callback_data: 'trojan_quota' }],
          [{ text: '🔢 Limite Connexion', callback_data: 'trojan_connlimit' }],
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
  const P = 'trojan';

  if (data.startsWith(`${P}_pgl_`)) return showPaginatedList(bot, chatId, `${P}_del_`, `${P}_pgl_`, getPageFromCallback(data, `${P}_pgl_`));
  if (data.startsWith(`${P}_pgr_`)) return showPaginatedList(bot, chatId, `${P}_ren_`, `${P}_pgr_`, getPageFromCallback(data, `${P}_pgr_`));
  if (data.startsWith(`${P}_pgd_`)) return showPaginatedList(bot, chatId, `${P}_det_`, `${P}_pgd_`, getPageFromCallback(data, `${P}_pgd_`));
  if (data.startsWith(`${P}_pglk_`)) return showPaginatedList(bot, chatId, `${P}_lck_`, `${P}_pglk_`, getPageFromCallback(data, `${P}_pglk_`));
  if (data.startsWith(`${P}_pgm_`)) return showPaginatedList(bot, chatId, `${P}_mod_`, `${P}_pgm_`, getPageFromCallback(data, `${P}_pgm_`));
  if (data.startsWith(`${P}_pgt_`)) return showPaginatedList(bot, chatId, `${P}_trf_`, `${P}_pgt_`, getPageFromCallback(data, `${P}_pgt_`));
  if (data.startsWith(`${P}_pgq_`)) return showPaginatedList(bot, chatId, `${P}_qta_`, `${P}_pgq_`, getPageFromCallback(data, `${P}_pgq_`));
  if (data.startsWith(`${P}_pgc_`)) return showPaginatedList(bot, chatId, `${P}_cl_`, `${P}_pgc_`, getPageFromCallback(data, `${P}_pgc_`));

  switch (data) {
    case `${P}_create`:
      bot.sendMessage(chatId, '📝 Nom d\'utilisateur TROJAN:');
      pendingActions[chatId] = { action: `${P}_create`, step: 'username', handler: handleCreateFlow };
      break;
    case `${P}_modify`: await showPaginatedList(bot, chatId, `${P}_mod_`, `${P}_pgm_`, 0); break;
    case `${P}_delete`: await showPaginatedList(bot, chatId, `${P}_del_`, `${P}_pgl_`, 0); break;
    case `${P}_renew`: await showPaginatedList(bot, chatId, `${P}_ren_`, `${P}_pgr_`, 0); break;
    case `${P}_list`: await listUsers(bot, chatId); break;
    case `${P}_detail`: await showPaginatedList(bot, chatId, `${P}_det_`, `${P}_pgd_`, 0); break;
    case `${P}_lock`: await showPaginatedList(bot, chatId, `${P}_lck_`, `${P}_pglk_`, 0); break;
    case `${P}_traffic`: await showPaginatedList(bot, chatId, `${P}_trf_`, `${P}_pgt_`, 0); break;
    case `${P}_quota`: await showPaginatedList(bot, chatId, `${P}_qta_`, `${P}_pgq_`, 0); break;
    case `${P}_connlimit`: await showPaginatedList(bot, chatId, `${P}_cl_`, `${P}_pgc_`, 0); break;
    default:
      if (data.startsWith(`${P}_del_`)) {
        const user = data.replace(`${P}_del_`, '');
        bot.sendMessage(chatId, `⚠️ Supprimer *${user}* ?`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🗑 Supprimer', callback_data: `${P}_dely_${user}` }, { text: '❌ Annuler', callback_data: `${P}_deln_${user}` }]] } });
      }
      else if (data.startsWith(`${P}_dely_`)) await deleteUser(bot, chatId, data.replace(`${P}_dely_`, ''));
      else if (data.startsWith(`${P}_deln_`)) bot.sendMessage(chatId, '❌ Suppression annulée.');
      else if (data.startsWith(`${P}_mod_`)) {
        const user = data.replace(`${P}_mod_`, '');
        bot.sendMessage(chatId, `✏️ Modifier *${user}*:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '👤 Username', callback_data: `${P}_mu_${user}` }, { text: '🔑 Password', callback_data: `${P}_mp_${user}` }], [{ text: '🔙 Retour', callback_data: `${P}_modify` }]] } });
      }
      else if (data.startsWith(`${P}_mu_`)) {
        const user = data.replace(`${P}_mu_`, '');
        bot.sendMessage(chatId, `📝 Nouveau nom pour *${user}*:`, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: `${P}_modify_user`, user, handler: handleModifyUsername };
      }
      else if (data.startsWith(`${P}_mp_`)) await regeneratePassword(bot, chatId, data.replace(`${P}_mp_`, ''));
      else if (data.startsWith(`${P}_ren_`)) {
        const user = data.replace(`${P}_ren_`, '');
        bot.sendMessage(chatId, `🔄 *${user}* — Action:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '➕ Ajouter', callback_data: `${P}_ra_${user}` }, { text: '➖ Retirer', callback_data: `${P}_rs_${user}` }], [{ text: '🔙 Retour', callback_data: `${P}_renew` }]] } });
      }
      else if (data.startsWith(`${P}_ra_`) || data.startsWith(`${P}_rs_`)) {
        const add = data.startsWith(`${P}_ra_`);
        const user = data.replace(add ? `${P}_ra_` : `${P}_rs_`, '');
        bot.sendMessage(chatId, `⏱ Unité:`, { reply_markup: { inline_keyboard: [[{ text: '📅 Jours', callback_data: `${P}_ru_${add ? 'a' : 's'}_d_${user}` }], [{ text: '🕐 Heures', callback_data: `${P}_ru_${add ? 'a' : 's'}_h_${user}` }], [{ text: '⏱ Minutes', callback_data: `${P}_ru_${add ? 'a' : 's'}_m_${user}` }]] } });
      }
      else if (data.startsWith(`${P}_ru_`)) {
        const parts = data.replace(`${P}_ru_`, '').split('_');
        const sign = parts[0]; const unit = parts[1]; const user = parts.slice(2).join('_');
        const unitMap = { d: 'jours', h: 'heures', m: 'minutes' };
        bot.sendMessage(chatId, `🔢 Nombre de ${unitMap[unit]} à ${sign === 'a' ? 'ajouter' : 'retirer'}:`);
        pendingActions[chatId] = { action: `${P}_renew_exec`, user, sign, unit, handler: handleRenewFlow };
      }
      else if (data.startsWith(`${P}_det_`)) await showDetail(bot, chatId, data.replace(`${P}_det_`, ''));
      else if (data.startsWith(`${P}_lck_`)) await toggleLock(bot, chatId, data.replace(`${P}_lck_`, ''));
      else if (data.startsWith(`${P}_trf_`) || data.startsWith(`${P}_trr_`)) {
        const prefix = data.startsWith(`${P}_trf_`) ? `${P}_trf_` : `${P}_trr_`;
        await showTraffic(bot, chatId, data.replace(prefix, ''));
      }
      else if (data.startsWith(`${P}_qta_`)) {
        const user = data.replace(`${P}_qta_`, '');
        bot.sendMessage(chatId, `📦 Limite données pour *${user}* (ex: \`5GB\`, \`0\` = illimité):`, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: `${P}_quota_set`, user, handler: handleQuotaFlow };
      }
      else if (data.startsWith(`${P}_cl_`)) {
        const user = data.replace(`${P}_cl_`, '');
        bot.sendMessage(chatId, `🔢 Max connexions pour *${user}*:`, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: `${P}_connlimit_set`, user, handler: handleConnLimitFlow };
      }
  }
}

async function showPaginatedList(bot, chatId, prefix, pagePrefix, page) {
  const users = await getUsers();
  if (!users.length) { bot.sendMessage(chatId, '📋 Aucun utilisateur.'); return; }
  bot.sendMessage(chatId, '👤 Sélectionnez:', paginatedKeyboard(users, prefix, pagePrefix, page, `menu_${PROTO}`));
}

async function handleCreateFlow(bot, chatId, text, pending, pendingActions) {
  if (pending.step === 'username') { pending.username = text.trim(); pending.step = 'days'; bot.sendMessage(chatId, '📅 Durée (jours):'); }
  else if (pending.step === 'days') {
    const days = parseInt(text);
    if (isNaN(days) || days < 1) { bot.sendMessage(chatId, '❌ Invalide.'); delete pendingActions[chatId]; return; }
    pending.days = days; pending.step = 'connlimit';
    bot.sendMessage(chatId, '🔢 Limite connexions (0 = illimité):');
  }
  else if (pending.step === 'connlimit') {
    const limit = parseInt(text);
    if (isNaN(limit) || limit < 0) { bot.sendMessage(chatId, '❌ Invalide.'); delete pendingActions[chatId]; return; }
    pending.connLimit = limit; pending.step = 'datalimit';
    bot.sendMessage(chatId, '📦 Limite données (ex: `5GB`, `0` = illimité):', { parse_mode: 'Markdown' });
  }
  else if (pending.step === 'datalimit') {
    delete pendingActions[chatId];
    let dataLimitBytes = 0;
    if (text.trim() !== '0') { dataLimitBytes = parseLimitToBytes(text.trim()); if (dataLimitBytes === null) { bot.sendMessage(chatId, '❌ Format invalide.'); return; } }
    await createUser(bot, chatId, pending.username, pending.days, pending.connLimit, dataLimitBytes);
  }
}

async function createUser(bot, chatId, username, days, connLimit, dataLimitBytes) {
  try {
    const password = generateUUID().split('-')[0];
    const expiry = getExpiryDate(days);
    const domain = await getDomain();
    await runCommand(`mkdir -p ${USERS_DB}`);
    await runCommand(`cd /etc/xray && jq '.inbounds[${INBOUND_INDEX}].settings.clients += [{"password":"${password}","email":"${username}"}]' config.json > tmp.json && mv tmp.json config.json`);
    await runCommand(`echo '${JSON.stringify({ username, password, expiry, protocol: PROTO, locked: false, connLimit, dataLimit: dataLimitBytes })}' > ${USERS_DB}/${username}.json`);
    await runCommand('systemctl restart xray');
    if (connLimit > 0) await setConnLimit(PROTO, username, connLimit);
    if (dataLimitBytes > 0) await setDataLimit(PROTO, username, dataLimitBytes);

    const wsLink = `trojan://${password}@${domain}:443?type=ws&security=tls&path=/trws&host=${domain}&sni=${domain}#${username}_WS-TLS`;
    const grpcLink = `trojan://${password}@${domain}:443?type=grpc&security=tls&serviceName=trojan-grpc&sni=${domain}#${username}_gRPC`;

    bot.sendMessage(chatId,
      `━━━━━━━━━━━━━━━━━━━━━\n✅ *TROJAN Created*\n━━━━━━━━━━━━━━━━━━━━━\n👤 User: \`${username}\`\n🔑 Password: \`${password}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${expiry}\`\n🔢 Max Conn: ${connLimit || '♾'}\n📦 Quota: ${dataLimitBytes ? formatBytes(dataLimitBytes) : '♾'}\n━━━━━━━━━━━━━━━━━━━━━\n🔗 *WS TLS:*\n\`${wsLink}\`\n\n🔗 *gRPC:*\n\`${grpcLink}\`\n━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function handleModifyUsername(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${pending.user}.json`));
    const newUser = text.trim();
    await runCommand(`cd /etc/xray && jq '(.inbounds[${INBOUND_INDEX}].settings.clients[] | select(.email=="${pending.user}")).email = "${newUser}"' config.json > tmp.json && mv tmp.json config.json`);
    info.username = newUser;
    await runCommand(`echo '${JSON.stringify(info)}' > ${USERS_DB}/${newUser}.json && rm -f ${USERS_DB}/${pending.user}.json`);
    await runCommand('systemctl restart xray');
    bot.sendMessage(chatId, `✅ *${pending.user}* → *${newUser}*`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function regeneratePassword(bot, chatId, username) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`));
    const newPass = generateUUID().split('-')[0];
    await runCommand(`cd /etc/xray && jq '(.inbounds[${INBOUND_INDEX}].settings.clients[] | select(.email=="${username}")).password = "${newPass}"' config.json > tmp.json && mv tmp.json config.json`);
    info.password = newPass;
    await runCommand(`echo '${JSON.stringify(info)}' > ${USERS_DB}/${username}.json`);
    await runCommand('systemctl restart xray');
    bot.sendMessage(chatId, `✅ Nouveau password pour *${username}*:\n\`${newPass}\``, { parse_mode: 'Markdown' });
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
    bot.sendMessage(chatId, `✅ TROJAN *${pending.user}* ${pending.sign === 'a' ? '+' : '-'}${amount} ${unitLabels[pending.unit]} → *${newExpiry}*`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function deleteUser(bot, chatId, username) {
  try {
    await runCommand(`cd /etc/xray && jq 'del(.inbounds[${INBOUND_INDEX}].settings.clients[] | select(.email=="${username}"))' config.json > tmp.json && mv tmp.json config.json`);
    await runCommand(`rm -f ${USERS_DB}/${username}.json`);
    await removeDataLimit(PROTO, username);
    await runCommand('systemctl restart xray');
    bot.sendMessage(chatId, `✅ TROJAN *${username}* supprimé.`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function listUsers(bot, chatId) {
  const users = await getUsers();
  if (!users.length) { bot.sendMessage(chatId, '📋 Aucun utilisateur TROJAN.'); return; }
  let text = '━━━━━━━━━━━━━━━━━━━━━\n📋 *TROJAN Users*\n━━━━━━━━━━━━━━━━━━━━━\n';
  for (const u of users) {
    try { const d = JSON.parse(await runCommand(`cat ${USERS_DB}/${u}.json`)); text += `👤 ${u} | 📅 ${d.expiry} | ${d.locked ? '🔒' : '🔓'}\n`; }
    catch { text += `👤 ${u}\n`; }
  }
  bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
}

async function showDetail(bot, chatId, username) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`));
    const domain = await getDomain();
    const traffic = await getXrayTraffic(username);
    const limit = await getDataLimit(PROTO, username);
    const conn = await getConnLimit(PROTO, username);
    bot.sendMessage(chatId,
      `━━━━━━━━━━━━━━━━━━━━━\n🔍 *TROJAN: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n🔑 Pass: \`${info.password}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${info.expiry}\`\n🔒 Locked: ${info.locked ? 'Oui' : 'Non'}\n🔢 Max Conn: ${conn ? conn.maxConn : '♾'}\n📦 Quota: ${limit ? formatBytes(limit.limitBytes) : '♾'}\n📊 Trafic: ↑${formatBytes(traffic.uplink)} ↓${formatBytes(traffic.downlink)}\n━━━━━━━━━━━━━━━━━━━━━`,
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
    else await runCommand(`cd /etc/xray && jq '.inbounds[${INBOUND_INDEX}].settings.clients += [{"password":"${info.password}","email":"${username}"}]' config.json > tmp.json && mv tmp.json config.json`);
    await runCommand('systemctl restart xray');
    bot.sendMessage(chatId, `✅ TROJAN *${username}* ${newLocked ? '🔒' : '🔓'}`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function showTraffic(bot, chatId, username) {
  try {
    const traffic = await getXrayTraffic(username);
    const limit = await getDataLimit(PROTO, username);
    let text = `━━━━━━━━━━━━━━━━━━━━━\n📊 *Trafic TROJAN: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n⬆️ Upload: ${formatBytes(traffic.uplink)}\n⬇️ Download: ${formatBytes(traffic.downlink)}\n📊 Total: ${formatBytes(traffic.total)}`;
    if (limit) { const pct = ((traffic.total / limit.limitBytes) * 100).toFixed(1); text += `\n📦 Quota: ${formatBytes(limit.limitBytes)}\n📈 Utilisé: ${pct}%`; }
    text += '\n━━━━━━━━━━━━━━━━━━━━━';
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔄 Actualiser', callback_data: `trojan_trr_${username}` }], [{ text: '🔙 Retour', callback_data: `menu_${PROTO}` }]] } });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function handleQuotaFlow(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  if (text.trim() === '0') { await removeDataLimit(PROTO, pending.user); bot.sendMessage(chatId, `✅ Quota supprimé pour *${pending.user}*`, { parse_mode: 'Markdown' }); return; }
  const bytes = parseLimitToBytes(text.trim());
  if (!bytes) { bot.sendMessage(chatId, '❌ Format invalide.'); return; }
  await setDataLimit(PROTO, pending.user, bytes);
  bot.sendMessage(chatId, `✅ Quota *${pending.user}*: ${formatBytes(bytes)}`, { parse_mode: 'Markdown' });
}

async function handleConnLimitFlow(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  const limit = parseInt(text);
  if (isNaN(limit) || limit < 0) { bot.sendMessage(chatId, '❌ Invalide.'); return; }
  await setConnLimit(PROTO, pending.user, limit);
  try { await runCommand(`jq '.connLimit = ${limit}' ${USERS_DB}/${pending.user}.json > /tmp/tmp.json && mv /tmp/tmp.json ${USERS_DB}/${pending.user}.json`); } catch {}
  bot.sendMessage(chatId, `✅ Limite connexion *${pending.user}*: ${limit || '♾'}`, { parse_mode: 'Markdown' });
}

module.exports = { showMenu, handleCallback };
