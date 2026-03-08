const { runCommand, getDomain } = require('../utils/exec');
const { getExpiryDate, adjustExpiry } = require('../utils/helpers');
const { paginatedKeyboard, getPageFromCallback } = require('../utils/pagination');
const { formatBytes, parseLimitToBytes, setDataLimit, getDataLimit, removeDataLimit, setConnLimit, getConnLimit } = require('../utils/traffic');
const { autoDeleteSend, scheduleDelete } = require('../utils/autodelete');

const USERS_DB = '/etc/zivpn/users';
const ZIVPN_CONFIG = '/etc/zivpn/config.json';
const PROTO = 'zivpn';

function showMenu(bot, chatId, msgId) {
  const opts = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ Créer', callback_data: 'zivpn_create' }, { text: '✏️ Modifier', callback_data: 'zivpn_modify' }],
        [{ text: '🔄 Renouveler', callback_data: 'zivpn_renew' }, { text: '🗑 Supprimer', callback_data: 'zivpn_delete' }],
        [{ text: '📋 Liste', callback_data: 'zivpn_list' }, { text: '🔍 Détails', callback_data: 'zivpn_detail' }],
        [{ text: '📊 Status Service', callback_data: 'zivpn_status' }],
        [{ text: '🔄 Restart Service', callback_data: 'zivpn_restart' }],
        [{ text: '⚙️ Config', callback_data: 'zivpn_config' }],
        [{ text: '📊 Trafic', callback_data: 'zivpn_traffic' }, { text: '📦 Quota Data', callback_data: 'zivpn_quota' }],
        [{ text: '🔢 Limite Connexion', callback_data: 'zivpn_connlimit' }],
        [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }],
      ],
    },
  };
  const text = `━━━━━━━━━━━━━━━━━━━━━\n📱 *ZIVPN MENU*\n━━━━━━━━━━━━━━━━━━━━━`;
  if (msgId) {
    bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...opts }).catch(() => bot.sendMessage(chatId, text, opts));
  } else {
    bot.sendMessage(chatId, text, opts);
  }
}

async function getUsers() {
  try {
    const result = await runCommand(`ls ${USERS_DB}/ 2>/dev/null | sed 's/.json//'`);
    return result ? result.split('\n').filter(Boolean) : [];
  } catch { return []; }
}

/** Add password to ZiVPN config.json auth.config array */
async function addToZivpnConfig(password) {
  try {
    await runCommand(`jq '.auth.config += ["${password}"]' ${ZIVPN_CONFIG} > /tmp/zivpn_tmp.json && mv /tmp/zivpn_tmp.json ${ZIVPN_CONFIG}`);
    await runCommand('systemctl restart zivpn 2>/dev/null || true');
  } catch {}
}

/** Remove password from ZiVPN config.json auth.config array */
async function removeFromZivpnConfig(password) {
  try {
    await runCommand(`jq '.auth.config -= ["${password}"]' ${ZIVPN_CONFIG} > /tmp/zivpn_tmp.json && mv /tmp/zivpn_tmp.json ${ZIVPN_CONFIG}`);
    await runCommand('systemctl restart zivpn 2>/dev/null || true');
  } catch {}
}

/** Update password in ZiVPN config.json auth.config array */
async function updateZivpnConfigPassword(oldPass, newPass) {
  try {
    await runCommand(`jq '(.auth.config[] | select(. == "${oldPass}")) = "${newPass}"' ${ZIVPN_CONFIG} > /tmp/zivpn_tmp.json && mv /tmp/zivpn_tmp.json ${ZIVPN_CONFIG}`);
    await runCommand('systemctl restart zivpn 2>/dev/null || true');
  } catch {}
}

async function handleCallback(bot, chatId, data, query, pendingActions) {
  const msgId = query?.message?.message_id;
  const P = 'zivpn';

  if (data.startsWith(`${P}_pgl_`)) return showPaginatedList(bot, chatId, msgId, `${P}_del_`, `${P}_pgl_`, getPageFromCallback(data, `${P}_pgl_`));
  if (data.startsWith(`${P}_pgr_`)) return showPaginatedList(bot, chatId, msgId, `${P}_ren_`, `${P}_pgr_`, getPageFromCallback(data, `${P}_pgr_`));
  if (data.startsWith(`${P}_pgd_`)) return showPaginatedList(bot, chatId, msgId, `${P}_det_`, `${P}_pgd_`, getPageFromCallback(data, `${P}_pgd_`));
  if (data.startsWith(`${P}_pgm_`)) return showPaginatedList(bot, chatId, msgId, `${P}_mod_`, `${P}_pgm_`, getPageFromCallback(data, `${P}_pgm_`));
  if (data.startsWith(`${P}_pgt_`)) return showPaginatedList(bot, chatId, msgId, `${P}_trf_`, `${P}_pgt_`, getPageFromCallback(data, `${P}_pgt_`));
  if (data.startsWith(`${P}_pgq_`)) return showPaginatedList(bot, chatId, msgId, `${P}_qta_`, `${P}_pgq_`, getPageFromCallback(data, `${P}_pgq_`));
  if (data.startsWith(`${P}_pgc_`)) return showPaginatedList(bot, chatId, msgId, `${P}_cl_`, `${P}_pgc_`, getPageFromCallback(data, `${P}_pgc_`));

  switch (data) {
    case `${P}_create`:
      editOrSend(bot, chatId, msgId, '📝 Nom d\'utilisateur ZIVPN:');
      pendingActions[chatId] = { action: `${P}_create`, step: 'username', handler: handleCreateFlow, fromId: query.from.id, fromName: query.from.first_name || query.from.username || String(query.from.id) };
      break;
    case `${P}_modify`: await showPaginatedList(bot, chatId, msgId, `${P}_mod_`, `${P}_pgm_`, 0); break;
    case `${P}_delete`: await showPaginatedList(bot, chatId, msgId, `${P}_del_`, `${P}_pgl_`, 0); break;
    case `${P}_renew`: await showPaginatedList(bot, chatId, msgId, `${P}_ren_`, `${P}_pgr_`, 0); break;
    case `${P}_list`: await listUsers(bot, chatId, msgId); break;
    case `${P}_detail`: await showPaginatedList(bot, chatId, msgId, `${P}_det_`, `${P}_pgd_`, 0); break;
    case `${P}_traffic`: await showPaginatedList(bot, chatId, msgId, `${P}_trf_`, `${P}_pgt_`, 0); break;
    case `${P}_quota`: await showPaginatedList(bot, chatId, msgId, `${P}_qta_`, `${P}_pgq_`, 0); break;
    case `${P}_connlimit`: await showPaginatedList(bot, chatId, msgId, `${P}_cl_`, `${P}_pgc_`, 0); break;
    case `${P}_status`:
      try {
        const status = await runCommand('systemctl is-active zivpn 2>/dev/null || echo inactive');
        editOrSend(bot, chatId, msgId, `📱 ZIVPN: ${status === 'active' ? '✅ Active' : '❌ Inactive'}\nPort: 5667 UDP`, {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: `menu_${P}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] }
        });
      } catch (err) { editOrSend(bot, chatId, msgId, `❌ ${err.message}`); }
      break;
    case `${P}_restart`:
      try {
        await runCommand('systemctl restart zivpn');
        editOrSend(bot, chatId, msgId, '✅ ZIVPN redémarré.', {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: `menu_${P}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] }
        });
      } catch (err) { editOrSend(bot, chatId, msgId, `❌ ${err.message}`); }
      break;
    case `${P}_config`:
      try {
        const config = await runCommand(`cat ${ZIVPN_CONFIG} 2>/dev/null || echo "Config non trouvée"`);
        editOrSend(bot, chatId, msgId, `⚙️ *ZIVPN Config:*\n\`\`\`json\n${config}\n\`\`\``, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: `menu_${P}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] }
        });
      } catch (err) { editOrSend(bot, chatId, msgId, `❌ ${err.message}`); }
      break;
    default:
      if (data.startsWith(`${P}_del_`)) {
        const user = data.replace(`${P}_del_`, '');
        editOrSend(bot, chatId, msgId, `⚠️ Supprimer *${user}* ?`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🗑 Supprimer', callback_data: `${P}_dely_${user}` }, { text: '❌ Annuler', callback_data: `${P}_deln_${user}` }]] } });
      }
      else if (data.startsWith(`${P}_dely_`)) await deleteUser(bot, chatId, msgId, data.replace(`${P}_dely_`, ''));
      else if (data.startsWith(`${P}_deln_`)) editOrSend(bot, chatId, msgId, '❌ Suppression annulée.', { reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: `menu_${P}` }]] } });
      else if (data.startsWith(`${P}_mod_`)) {
        const user = data.replace(`${P}_mod_`, '');
        editOrSend(bot, chatId, msgId, `✏️ Modifier *${user}*:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '👤 Username', callback_data: `${P}_mu_${user}` }, { text: '🔑 Password', callback_data: `${P}_mp_${user}` }], [{ text: '🔙 Retour', callback_data: `${P}_modify` }]] } });
      }
      else if (data.startsWith(`${P}_mu_`)) {
        const user = data.replace(`${P}_mu_`, '');
        editOrSend(bot, chatId, msgId, `📝 Nouveau nom pour *${user}*:`, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: `${P}_modify_user`, user, handler: handleModifyUsername };
      }
      else if (data.startsWith(`${P}_mp_`)) {
        const user = data.replace(`${P}_mp_`, '');
        editOrSend(bot, chatId, msgId, `🔑 Nouveau mot de passe pour *${user}*:`, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: `${P}_modify_pass`, user, handler: handleModifyPassword };
      }
      else if (data.startsWith(`${P}_ren_`)) {
        const user = data.replace(`${P}_ren_`, '');
        editOrSend(bot, chatId, msgId, `🔄 *${user}* — Action:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '➕ Ajouter', callback_data: `${P}_ra_${user}` }, { text: '➖ Retirer', callback_data: `${P}_rs_${user}` }], [{ text: '🔙 Retour', callback_data: `${P}_renew` }]] } });
      }
      else if (data.startsWith(`${P}_ra_`) || data.startsWith(`${P}_rs_`)) {
        const add = data.startsWith(`${P}_ra_`);
        const user = data.replace(add ? `${P}_ra_` : `${P}_rs_`, '');
        editOrSend(bot, chatId, msgId, `⏱ Unité:`, { reply_markup: { inline_keyboard: [[{ text: '📅 Jours', callback_data: `${P}_ru_${add ? 'a' : 's'}_d_${user}` }], [{ text: '🕐 Heures', callback_data: `${P}_ru_${add ? 'a' : 's'}_h_${user}` }], [{ text: '⏱ Minutes', callback_data: `${P}_ru_${add ? 'a' : 's'}_m_${user}` }]] } });
      }
      else if (data.startsWith(`${P}_ru_`)) {
        const parts = data.replace(`${P}_ru_`, '').split('_');
        const sign = parts[0]; const unit = parts[1]; const user = parts.slice(2).join('_');
        const unitMap = { d: 'jours', h: 'heures', m: 'minutes' };
        editOrSend(bot, chatId, msgId, `🔢 Nombre de ${unitMap[unit]} à ${sign === 'a' ? 'ajouter' : 'retirer'}:`);
        pendingActions[chatId] = { action: `${P}_renew_exec`, user, sign, unit, handler: handleRenewFlow };
      }
      else if (data.startsWith(`${P}_det_`)) await showDetail(bot, chatId, msgId, data.replace(`${P}_det_`, ''));
      else if (data.startsWith(`${P}_trf_`) || data.startsWith(`${P}_trr_`)) {
        const prefix = data.startsWith(`${P}_trf_`) ? `${P}_trf_` : `${P}_trr_`;
        await showTraffic(bot, chatId, msgId, data.replace(prefix, ''));
      }
      else if (data.startsWith(`${P}_qta_`)) {
        const user = data.replace(`${P}_qta_`, '');
        editOrSend(bot, chatId, msgId, `📦 Limite données pour *${user}* (ex: \`5GB\`, \`0\` = illimité):`, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: `${P}_quota_set`, user, handler: handleQuotaFlow };
      }
      else if (data.startsWith(`${P}_cl_`)) {
        const user = data.replace(`${P}_cl_`, '');
        editOrSend(bot, chatId, msgId, `🔢 Max connexions pour *${user}*:`, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: `${P}_connlimit_set`, user, handler: handleConnLimitFlow };
      }
  }
}

function editOrSend(bot, chatId, msgId, text, opts = {}) {
  if (msgId) {
    bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...opts }).catch(() => bot.sendMessage(chatId, text, opts));
  } else {
    bot.sendMessage(chatId, text, opts);
  }
}

async function showPaginatedList(bot, chatId, msgId, prefix, pagePrefix, page) {
  const users = await getUsers();
  if (!users.length) { editOrSend(bot, chatId, msgId, '📋 Aucun utilisateur.'); return; }
  const kb = paginatedKeyboard(users, prefix, pagePrefix, page, `menu_${PROTO}`);
  editOrSend(bot, chatId, msgId, '👤 Sélectionnez:', kb);
}

async function handleCreateFlow(bot, chatId, text, pending, pendingActions) {
  if (pending.step === 'username') { pending.username = text.trim(); pending.step = 'password'; autoDeleteSend(bot, chatId, '🔑 Mot de passe:'); }
  else if (pending.step === 'password') { pending.password = text.trim(); pending.step = 'days'; autoDeleteSend(bot, chatId, '📅 Durée (jours):'); }
  else if (pending.step === 'days') {
    const days = parseInt(text);
    if (isNaN(days) || days < 1) { autoDeleteSend(bot, chatId, '❌ Invalide.'); delete pendingActions[chatId]; return; }
    pending.days = days; pending.step = 'connlimit';
    autoDeleteSend(bot, chatId, '🔢 Limite connexions (0 = illimité):');
  }
  else if (pending.step === 'connlimit') {
    const limit = parseInt(text);
    if (isNaN(limit) || limit < 0) { autoDeleteSend(bot, chatId, '❌ Invalide.'); delete pendingActions[chatId]; return; }
    pending.connLimit = limit; pending.step = 'datalimit';
    autoDeleteSend(bot, chatId, '📦 Limite données (ex: `5GB`, `0` = illimité):', { parse_mode: 'Markdown' });
  }
  else if (pending.step === 'datalimit') {
    delete pendingActions[chatId];
    let dataLimitBytes = 0;
    if (text.trim() !== '0') { dataLimitBytes = parseLimitToBytes(text.trim()); if (dataLimitBytes === null) { autoDeleteSend(bot, chatId, '❌ Format invalide.'); return; } }
    await createUser(bot, chatId, pending.username, pending.password, pending.days, pending.connLimit, dataLimitBytes, pending.fromId, pending.fromName);
  }
}

async function createUser(bot, chatId, username, password, days, connLimit, dataLimitBytes, createdById, createdByName) {
  try {
    const expiry = getExpiryDate(days);
    const domain = await getDomain();
    await runCommand(`mkdir -p ${USERS_DB}`);
    // Save user info JSON
    const userInfo = { username, password, expiry, locked: false, connLimit, dataLimit: dataLimitBytes, createdBy: createdByName || String(createdById || 'unknown'), createdById: createdById || null };
    await runCommand(`echo '${JSON.stringify(userInfo)}' > ${USERS_DB}/${username}.json`);
    // Add password to ZiVPN config.json auth.config array
    await addToZivpnConfig(password);
    if (connLimit > 0) await setConnLimit(PROTO, username, connLimit);
    if (dataLimitBytes > 0) await setDataLimit(PROTO, username, dataLimitBytes);

    bot.sendMessage(chatId,
      `━━━━━━━━━━━━━━━━━━━━━\n✅ *ZIVPN Account Created*\n━━━━━━━━━━━━━━━━━━━━━\n👤 User: \`${username}\`\n🔑 Pass: \`${password}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${expiry}\`\n🔢 Max Conn: ${connLimit || '♾'}\n📦 Quota: ${dataLimitBytes ? formatBytes(dataLimitBytes) : '♾'}\n👷 Créé par: ${createdByName || createdById}\n━━━━━━━━━━━━━━━━━━━━━\n📡 Port: 5667 UDP\n━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function handleModifyUsername(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${pending.user}.json`));
    const newUser = text.trim();
    info.username = newUser;
    await runCommand(`echo '${JSON.stringify(info)}' > ${USERS_DB}/${newUser}.json && rm -f ${USERS_DB}/${pending.user}.json`);
    autoDeleteSend(bot, chatId, `✅ *${pending.user}* → *${newUser}*`, { parse_mode: 'Markdown' });
  } catch (err) { autoDeleteSend(bot, chatId, `❌ Erreur: ${err.message}`); }
}

async function handleModifyPassword(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${pending.user}.json`));
    const oldPass = info.password;
    const newPass = text.trim();
    // Update in ZiVPN config
    await updateZivpnConfigPassword(oldPass, newPass);
    await runCommand(`jq '.password = "${newPass}"' ${USERS_DB}/${pending.user}.json > /tmp/tmp.json && mv /tmp/tmp.json ${USERS_DB}/${pending.user}.json`);
    autoDeleteSend(bot, chatId, `✅ Password de *${pending.user}* mis à jour.`, { parse_mode: 'Markdown' });
  } catch (err) { autoDeleteSend(bot, chatId, `❌ Erreur: ${err.message}`); }
}

async function handleRenewFlow(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  const amount = parseInt(text);
  if (isNaN(amount) || amount < 1) { autoDeleteSend(bot, chatId, '❌ Invalide.'); return; }
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${pending.user}.json`));
    const unitMap = { d: 'days', h: 'hours', m: 'minutes' };
    const finalAmount = pending.sign === 's' ? -amount : amount;
    const newExpiry = adjustExpiry(info.expiry, finalAmount, unitMap[pending.unit]);
    await runCommand(`jq '.expiry = "${newExpiry}"' ${USERS_DB}/${pending.user}.json > /tmp/tmp.json && mv /tmp/tmp.json ${USERS_DB}/${pending.user}.json`);
    const unitLabels = { d: 'jour(s)', h: 'heure(s)', m: 'minute(s)' };
    autoDeleteSend(bot, chatId, `✅ ZIVPN *${pending.user}* ${pending.sign === 'a' ? '+' : '-'}${amount} ${unitLabels[pending.unit]} → *${newExpiry}*`, { parse_mode: 'Markdown' });
  } catch (err) { autoDeleteSend(bot, chatId, `❌ Erreur: ${err.message}`); }
}

async function deleteUser(bot, chatId, msgId, username) {
  try {
    // Remove password from ZiVPN config
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`));
    await removeFromZivpnConfig(info.password);
    await runCommand(`rm -f ${USERS_DB}/${username}.json`);
    await removeDataLimit(PROTO, username);
    editOrSend(bot, chatId, msgId, `✅ ZIVPN *${username}* supprimé.`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: `menu_${PROTO}` }]] } });
  } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`); }
}

async function listUsers(bot, chatId, msgId) {
  const users = await getUsers();
  if (!users.length) { editOrSend(bot, chatId, msgId, '📋 Aucun utilisateur ZIVPN.'); return; }
  let text = '━━━━━━━━━━━━━━━━━━━━━\n📋 *ZIVPN Users*\n━━━━━━━━━━━━━━━━━━━━━\n';
  for (const u of users) {
    try { const d = JSON.parse(await runCommand(`cat ${USERS_DB}/${u}.json`)); text += `👤 ${u} | 📅 ${d.expiry}\n`; }
    catch { text += `👤 ${u}\n`; }
  }
  editOrSend(bot, chatId, msgId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: `menu_${PROTO}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
}

async function showDetail(bot, chatId, msgId, username) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`));
    const domain = await getDomain();
    const limit = await getDataLimit(PROTO, username);
    const conn = await getConnLimit(PROTO, username);
    const createdBy = info.createdBy || 'N/A';
    editOrSend(bot, chatId, msgId,
      `━━━━━━━━━━━━━━━━━━━━━\n🔍 *ZIVPN: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n🔑 Pass: \`${info.password}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${info.expiry}\`\n🔢 Max Conn: ${conn ? conn.maxConn : '♾'}\n📦 Quota: ${limit ? formatBytes(limit.limitBytes) : '♾'}\n👷 Créé par: ${createdBy}\n━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: `menu_${PROTO}` }]] } }
    );
  } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`); }
}

async function showTraffic(bot, chatId, msgId, username) {
  try {
    const limit = await getDataLimit(PROTO, username);
    let text = `━━━━━━━━━━━━━━━━━━━━━\n📊 *Trafic ZIVPN: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n📊 Surveillance active`;
    if (limit) text += `\n📦 Quota: ${formatBytes(limit.limitBytes)}`;
    text += '\n━━━━━━━━━━━━━━━━━━━━━';
    editOrSend(bot, chatId, msgId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔄 Actualiser', callback_data: `zivpn_trr_${username}` }], [{ text: '🔙 Retour', callback_data: `menu_${PROTO}` }]] } });
  } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`); }
}

async function handleQuotaFlow(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  if (text.trim() === '0') { await removeDataLimit(PROTO, pending.user); autoDeleteSend(bot, chatId, `✅ Quota supprimé pour *${pending.user}*`, { parse_mode: 'Markdown' }); return; }
  const bytes = parseLimitToBytes(text.trim());
  if (!bytes) { autoDeleteSend(bot, chatId, '❌ Format invalide.'); return; }
  await setDataLimit(PROTO, pending.user, bytes);
  autoDeleteSend(bot, chatId, `✅ Quota *${pending.user}*: ${formatBytes(bytes)}`, { parse_mode: 'Markdown' });
}

async function handleConnLimitFlow(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  const max = parseInt(text);
  if (isNaN(max) || max < 0) { autoDeleteSend(bot, chatId, '❌ Invalide.'); return; }
  await setConnLimit(PROTO, pending.user, max);
  autoDeleteSend(bot, chatId, `✅ Limite connexions *${pending.user}*: ${max || '♾'}`, { parse_mode: 'Markdown' });
}

module.exports = { showMenu, handleCallback };
