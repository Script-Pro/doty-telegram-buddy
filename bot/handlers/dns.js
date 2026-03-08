const { runCommand, getDomain } = require('../utils/exec');
const { getExpiryDate, adjustExpiry } = require('../utils/helpers');
const { paginatedKeyboard, getPageFromCallback } = require('../utils/pagination');
const { formatBytes, parseLimitToBytes, setDataLimit, getDataLimit, removeDataLimit, setConnLimit, getConnLimit } = require('../utils/traffic');

const USERS_DB = '/etc/slowdns/users';
const PROTO = 'dns';

function showMenu(bot, chatId, msgId) {
  const opts = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '➕ Créer', callback_data: 'dns_create' }, { text: '✏️ Modifier', callback_data: 'dns_modify' }],
        [{ text: '🔄 Renouveler', callback_data: 'dns_renew' }, { text: '🗑 Supprimer', callback_data: 'dns_delete' }],
        [{ text: '📋 Liste', callback_data: 'dns_list' }, { text: '🔍 Détails', callback_data: 'dns_detail' }],
        [{ text: '📊 Status', callback_data: 'dns_status' }],
        [{ text: '🔄 Restart', callback_data: 'dns_restart' }],
        [{ text: '🔑 NS Key', callback_data: 'dns_key' }],
        [{ text: '⚙️ Config DNS', callback_data: 'dns_config' }],
        [{ text: '📊 Trafic', callback_data: 'dns_traffic' }, { text: '📦 Quota Data', callback_data: 'dns_quota' }],
        [{ text: '🔢 Limite Connexion', callback_data: 'dns_connlimit' }],
        [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }],
      ],
    },
  };
  const text = `━━━━━━━━━━━━━━━━━━━━━\n📡 *DNS / SLOWDNS MENU*\n━━━━━━━━━━━━━━━━━━━━━`;
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

async function handleCallback(bot, chatId, data, query, pendingActions) {
  const msgId = query?.message?.message_id;
  const P = 'dns';

  if (data.startsWith(`${P}_pgl_`)) return showPaginatedList(bot, chatId, msgId, `${P}_del_`, `${P}_pgl_`, getPageFromCallback(data, `${P}_pgl_`));
  if (data.startsWith(`${P}_pgr_`)) return showPaginatedList(bot, chatId, msgId, `${P}_ren_`, `${P}_pgr_`, getPageFromCallback(data, `${P}_pgr_`));
  if (data.startsWith(`${P}_pgd_`)) return showPaginatedList(bot, chatId, msgId, `${P}_det_`, `${P}_pgd_`, getPageFromCallback(data, `${P}_pgd_`));
  if (data.startsWith(`${P}_pgm_`)) return showPaginatedList(bot, chatId, msgId, `${P}_mod_`, `${P}_pgm_`, getPageFromCallback(data, `${P}_pgm_`));
  if (data.startsWith(`${P}_pgt_`)) return showPaginatedList(bot, chatId, msgId, `${P}_trf_`, `${P}_pgt_`, getPageFromCallback(data, `${P}_pgt_`));
  if (data.startsWith(`${P}_pgq_`)) return showPaginatedList(bot, chatId, msgId, `${P}_qta_`, `${P}_pgq_`, getPageFromCallback(data, `${P}_pgq_`));
  if (data.startsWith(`${P}_pgc_`)) return showPaginatedList(bot, chatId, msgId, `${P}_cl_`, `${P}_pgc_`, getPageFromCallback(data, `${P}_pgc_`));

  switch (data) {
    case `${P}_create`:
      editOrSend(bot, chatId, msgId, '📝 Nom d\'utilisateur SlowDNS:');
      pendingActions[chatId] = { action: `${P}_create`, step: 'username', handler: handleCreateFlow };
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
        const sldns = await runCommand('systemctl is-active sldns-server 2>/dev/null || echo inactive');
        editOrSend(bot, chatId, msgId, `📡 SlowDNS: ${sldns === 'active' ? '✅ Active' : '❌ Inactive'}`, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: `menu_${P}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] }
        });
      } catch (err) { editOrSend(bot, chatId, msgId, `❌ ${err.message}`); }
      break;
    case `${P}_restart`:
      try {
        await runCommand('systemctl restart sldns-server');
        editOrSend(bot, chatId, msgId, '✅ SlowDNS redémarré.', {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: `menu_${P}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] }
        });
      } catch (err) { editOrSend(bot, chatId, msgId, `❌ ${err.message}`); }
      break;
    case `${P}_key`:
      try {
        const key = await runCommand('cat /etc/slowdns/server.pub 2>/dev/null || echo "Clé non trouvée"');
        editOrSend(bot, chatId, msgId, `🔑 *NS Public Key:*\n\`${key}\``, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: `menu_${P}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] }
        });
      } catch (err) { editOrSend(bot, chatId, msgId, `❌ ${err.message}`); }
      break;
    case `${P}_config`:
      try {
        const ns = await runCommand('cat /etc/slowdns/ns 2>/dev/null || echo "N/A"');
        const domain = await runCommand('cat /etc/xray/domain 2>/dev/null || echo "N/A"');
        editOrSend(bot, chatId, msgId, `⚙️ *DNS Config*\n\nNS: \`${ns}\`\nDomain: \`${domain}\``, {
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
  if (pending.step === 'username') { pending.username = text.trim(); pending.step = 'password'; bot.sendMessage(chatId, '🔑 Mot de passe:'); }
  else if (pending.step === 'password') { pending.password = text.trim(); pending.step = 'days'; bot.sendMessage(chatId, '📅 Durée (jours):'); }
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
    await createUser(bot, chatId, pending.username, pending.password, pending.days, pending.connLimit, dataLimitBytes);
  }
}

async function createUser(bot, chatId, username, password, days, connLimit, dataLimitBytes) {
  try {
    const expiry = getExpiryDate(days);
    const domain = await getDomain();
    await runCommand(`mkdir -p ${USERS_DB}`);
    // Create SSH user for SlowDNS tunneling
    await runCommand(`useradd -e $(date -d "+${days} days" +%Y-%m-%d) -s /bin/false -M ${username} 2>/dev/null || true`);
    await runCommand(`echo "${username}:${password}" | chpasswd`);
    await runCommand(`echo '${JSON.stringify({ username, password, expiry, locked: false, connLimit, dataLimit: dataLimitBytes })}' > ${USERS_DB}/${username}.json`);
    if (connLimit > 0) await setConnLimit(PROTO, username, connLimit);
    if (dataLimitBytes > 0) await setDataLimit(PROTO, username, dataLimitBytes);

    const nsKey = await runCommand('cat /etc/slowdns/server.pub 2>/dev/null || echo "N/A"');
    const ns = await runCommand('cat /etc/slowdns/ns 2>/dev/null || echo "N/A"');

    bot.sendMessage(chatId,
      `━━━━━━━━━━━━━━━━━━━━━\n✅ *SlowDNS Account Created*\n━━━━━━━━━━━━━━━━━━━━━\n👤 User: \`${username}\`\n🔑 Pass: \`${password}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${expiry}\`\n🔢 Max Conn: ${connLimit || '♾'}\n📦 Quota: ${dataLimitBytes ? formatBytes(dataLimitBytes) : '♾'}\n━━━━━━━━━━━━━━━━━━━━━\n🔑 NS Key: \`${nsKey}\`\n📡 NS: \`${ns}\`\n━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function handleModifyUsername(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${pending.user}.json`));
    const newUser = text.trim();
    await runCommand(`usermod -l ${newUser} ${pending.user} 2>/dev/null || true`);
    info.username = newUser;
    await runCommand(`echo '${JSON.stringify(info)}' > ${USERS_DB}/${newUser}.json && rm -f ${USERS_DB}/${pending.user}.json`);
    bot.sendMessage(chatId, `✅ *${pending.user}* → *${newUser}*`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function handleModifyPassword(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  try {
    const newPass = text.trim();
    await runCommand(`echo "${pending.user}:${newPass}" | chpasswd`);
    await runCommand(`jq '.password = "${newPass}"' ${USERS_DB}/${pending.user}.json > /tmp/tmp.json && mv /tmp/tmp.json ${USERS_DB}/${pending.user}.json`);
    bot.sendMessage(chatId, `✅ Password de *${pending.user}* mis à jour.`, { parse_mode: 'Markdown' });
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
    if (pending.unit === 'd' && pending.sign === 'a') {
      await runCommand(`chage -E $(date -d "+${amount} days" +%Y-%m-%d) ${pending.user} 2>/dev/null || true`);
    }
    const unitLabels = { d: 'jour(s)', h: 'heure(s)', m: 'minute(s)' };
    bot.sendMessage(chatId, `✅ SlowDNS *${pending.user}* ${pending.sign === 'a' ? '+' : '-'}${amount} ${unitLabels[pending.unit]} → *${newExpiry}*`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function deleteUser(bot, chatId, msgId, username) {
  try {
    await runCommand(`userdel -f ${username} 2>/dev/null || true`);
    await runCommand(`rm -f ${USERS_DB}/${username}.json`);
    await removeDataLimit(PROTO, username);
    editOrSend(bot, chatId, msgId, `✅ SlowDNS *${username}* supprimé.`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: `menu_${PROTO}` }]] } });
  } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`); }
}

async function listUsers(bot, chatId, msgId) {
  const users = await getUsers();
  if (!users.length) { editOrSend(bot, chatId, msgId, '📋 Aucun utilisateur SlowDNS.'); return; }
  let text = '━━━━━━━━━━━━━━━━━━━━━\n📋 *SlowDNS Users*\n━━━━━━━━━━━━━━━━━━━━━\n';
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
    editOrSend(bot, chatId, msgId,
      `━━━━━━━━━━━━━━━━━━━━━\n🔍 *SlowDNS: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n🔑 Pass: \`${info.password}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${info.expiry}\`\n🔢 Max Conn: ${conn ? conn.maxConn : '♾'}\n📦 Quota: ${limit ? formatBytes(limit.limitBytes) : '♾'}\n━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: `menu_${PROTO}` }]] } }
    );
  } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`); }
}

async function showTraffic(bot, chatId, msgId, username) {
  try {
    const limit = await getDataLimit(PROTO, username);
    let text = `━━━━━━━━━━━━━━━━━━━━━\n📊 *Trafic SlowDNS: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n📊 Surveillance active`;
    if (limit) text += `\n📦 Quota: ${formatBytes(limit.limitBytes)}`;
    text += '\n━━━━━━━━━━━━━━━━━━━━━';
    editOrSend(bot, chatId, msgId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔄 Actualiser', callback_data: `dns_trr_${username}` }], [{ text: '🔙 Retour', callback_data: `menu_${PROTO}` }]] } });
  } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`); }
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
  const max = parseInt(text);
  if (isNaN(max) || max < 0) { bot.sendMessage(chatId, '❌ Invalide.'); return; }
  await setConnLimit(PROTO, pending.user, max);
  bot.sendMessage(chatId, `✅ Limite connexions *${pending.user}*: ${max || '♾'}`, { parse_mode: 'Markdown' });
}

module.exports = { showMenu, handleCallback };
