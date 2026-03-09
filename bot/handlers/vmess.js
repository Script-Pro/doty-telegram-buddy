const { runCommand, getDomain } = require('../utils/exec');
const { generateUUID, getExpiryDate, adjustExpiry } = require('../utils/helpers');
const { paginatedKeyboard, getPageFromCallback } = require('../utils/pagination');
const { getXrayTraffic, formatBytes, parseLimitToBytes, setDataLimit, getDataLimit, removeDataLimit, setConnLimit, getConnLimit, countXrayConnections } = require('../utils/traffic');
const { autoDeleteSend } = require('../utils/autodelete');
const audit = require('../utils/audit');

const USERS_DB = '/etc/xray/users-vmess';
const PROTO = 'vmess';
const INBOUND_INDEX = 1;

function editOrSend(bot, chatId, msgId, text, opts = {}) {
  if (msgId) return bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...opts }).catch(() => bot.sendMessage(chatId, text, opts));
  return bot.sendMessage(chatId, text, opts);
}

function backBtns(extra = []) {
  return { inline_keyboard: [...extra, [{ text: '🔙 Retour', callback_data: `menu_${PROTO}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] };
}

function progressBar(used, total) {
  if (!total || total <= 0) return '';
  const pct = Math.min((used / total) * 100, 100);
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  const fc = pct >= 80 ? '🟥' : '🟩';
  return `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${fc.repeat(filled)}${'⬜'.repeat(empty)}\n📊 ${pct.toFixed(1)}% utilisé\n━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

function detailTraffic(bytes) {
  if (bytes === 0) return '0 B';
  const u = [{ n: 'TB', v: 1024**4 }, { n: 'GB', v: 1024**3 }, { n: 'MB', v: 1024**2 }, { n: 'KB', v: 1024 }];
  let r = bytes; const p = [];
  for (const x of u) { if (r >= x.v) { p.push(`${Math.floor(r / x.v)} ${x.n}`); r %= x.v; } }
  return p.join(' + ') || `${bytes} B`;
}

function showMenu(bot, chatId, msgId) {
  editOrSend(bot, chatId, msgId, `━━━━━━━━━━━━━━━━━━━━━\n🔰 *VMESS MENU*\n━━━━━━━━━━━━━━━━━━━━━`, {
    parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
      [{ text: '➕ Créer', callback_data: 'vmess_create' }, { text: '✏️ Modifier', callback_data: 'vmess_modify' }],
      [{ text: '🔄 Renouveler', callback_data: 'vmess_renew' }, { text: '🗑 Supprimer', callback_data: 'vmess_delete' }],
      [{ text: '📋 Liste', callback_data: 'vmess_list' }, { text: '🔍 Détails', callback_data: 'vmess_detail' }],
      [{ text: '🔒 Lock/Unlock', callback_data: 'vmess_lock' }],
      [{ text: '📊 Trafic', callback_data: 'vmess_traffic' }, { text: '📦 Quota Data', callback_data: 'vmess_quota' }],
      [{ text: '🔢 Limite Connexion', callback_data: 'vmess_connlimit' }, { text: '👥 En ligne', callback_data: 'vmess_online' }],
      [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }],
    ]}
  });
}

async function getUsers() {
  try { const r = await runCommand(`ls ${USERS_DB}/ 2>/dev/null | sed 's/.json//'`); return r ? r.split('\n').filter(Boolean) : []; }
  catch { return []; }
}

async function handleCallback(bot, chatId, data, query, pendingActions) {
  const msgId = query?.message?.message_id;
  const P = 'vmess';

  if (data.startsWith(`${P}_pgl_`)) return showPaginatedList(bot, chatId, msgId, `${P}_del_`, `${P}_pgl_`, getPageFromCallback(data, `${P}_pgl_`));
  if (data.startsWith(`${P}_pgr_`)) return showPaginatedList(bot, chatId, msgId, `${P}_ren_`, `${P}_pgr_`, getPageFromCallback(data, `${P}_pgr_`));
  if (data.startsWith(`${P}_pgd_`)) return showPaginatedList(bot, chatId, msgId, `${P}_det_`, `${P}_pgd_`, getPageFromCallback(data, `${P}_pgd_`));
  if (data.startsWith(`${P}_pglk_`)) return showPaginatedList(bot, chatId, msgId, `${P}_lck_`, `${P}_pglk_`, getPageFromCallback(data, `${P}_pglk_`));
  if (data.startsWith(`${P}_pgm_`)) return showPaginatedList(bot, chatId, msgId, `${P}_mod_`, `${P}_pgm_`, getPageFromCallback(data, `${P}_pgm_`));
  if (data.startsWith(`${P}_pgt_`)) return showPaginatedList(bot, chatId, msgId, `${P}_trf_`, `${P}_pgt_`, getPageFromCallback(data, `${P}_pgt_`));
  if (data.startsWith(`${P}_pgq_`)) return showPaginatedList(bot, chatId, msgId, `${P}_qta_`, `${P}_pgq_`, getPageFromCallback(data, `${P}_pgq_`));
  if (data.startsWith(`${P}_pgc_`)) return showPaginatedList(bot, chatId, msgId, `${P}_cl_`, `${P}_pgc_`, getPageFromCallback(data, `${P}_pgc_`));
  if (data.startsWith(`${P}_pgo_`)) return showPaginatedList(bot, chatId, msgId, `${P}_onl_`, `${P}_pgo_`, getPageFromCallback(data, `${P}_pgo_`));

  switch (data) {
    case `${P}_create`:
      editOrSend(bot, chatId, msgId, '📝 Nom d\'utilisateur VMESS:');
      pendingActions[chatId] = { action: `${P}_create`, step: 'username', handler: handleCreateFlow, fromId: query.from.id, fromName: query.from.first_name || query.from.username || String(query.from.id) };
      break;
    case `${P}_modify`: await showPaginatedList(bot, chatId, msgId, `${P}_mod_`, `${P}_pgm_`, 0); break;
    case `${P}_delete`: await showPaginatedList(bot, chatId, msgId, `${P}_del_`, `${P}_pgl_`, 0); break;
    case `${P}_renew`: await showPaginatedList(bot, chatId, msgId, `${P}_ren_`, `${P}_pgr_`, 0); break;
    case `${P}_list`: await listUsers(bot, chatId, msgId); break;
    case `${P}_detail`: await showPaginatedList(bot, chatId, msgId, `${P}_det_`, `${P}_pgd_`, 0); break;
    case `${P}_lock`: await showPaginatedList(bot, chatId, msgId, `${P}_lck_`, `${P}_pglk_`, 0); break;
    case `${P}_traffic`: await showPaginatedList(bot, chatId, msgId, `${P}_trf_`, `${P}_pgt_`, 0); break;
    case `${P}_quota`: await showPaginatedList(bot, chatId, msgId, `${P}_qta_`, `${P}_pgq_`, 0); break;
    case `${P}_connlimit`: await showPaginatedList(bot, chatId, msgId, `${P}_cl_`, `${P}_pgc_`, 0); break;
    case `${P}_online`: await showPaginatedList(bot, chatId, msgId, `${P}_onl_`, `${P}_pgo_`, 0); break;
    default:
      if (data.startsWith(`${P}_del_`)) { const u = data.replace(`${P}_del_`, ''); editOrSend(bot, chatId, msgId, `⚠️ Supprimer *${u}* ?`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🗑 Supprimer', callback_data: `${P}_dely_${u}` }, { text: '❌ Annuler', callback_data: `${P}_deln_${u}` }]] } }); }
      else if (data.startsWith(`${P}_dely_`)) await deleteUser(bot, chatId, msgId, data.replace(`${P}_dely_`, ''), query.from.id);
      else if (data.startsWith(`${P}_deln_`)) editOrSend(bot, chatId, msgId, '❌ Suppression annulée.', { reply_markup: backBtns() });
      else if (data.startsWith(`${P}_mod_`)) { const u = data.replace(`${P}_mod_`, ''); editOrSend(bot, chatId, msgId, `✏️ Modifier *${u}*:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '👤 Username', callback_data: `${P}_mu_${u}` }, { text: '🔑 UUID', callback_data: `${P}_mp_${u}` }], [{ text: '🔙 Retour', callback_data: `${P}_modify` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } }); }
      else if (data.startsWith(`${P}_mu_`)) { const u = data.replace(`${P}_mu_`, ''); editOrSend(bot, chatId, msgId, `📝 Nouveau nom pour *${u}*:`, { parse_mode: 'Markdown' }); pendingActions[chatId] = { action: `${P}_modify_user`, user: u, handler: handleModifyUsername, fromId: query.from.id }; }
      else if (data.startsWith(`${P}_mp_`)) await regenerateUUID(bot, chatId, msgId, data.replace(`${P}_mp_`, ''), query.from.id);
      else if (data.startsWith(`${P}_ren_`)) { const u = data.replace(`${P}_ren_`, ''); editOrSend(bot, chatId, msgId, `🔄 *${u}* — Action:`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '➕ Ajouter', callback_data: `${P}_ra_${u}` }, { text: '➖ Retirer', callback_data: `${P}_rs_${u}` }], [{ text: '🔙 Retour', callback_data: `${P}_renew` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } }); }
      else if (data.startsWith(`${P}_ra_`) || data.startsWith(`${P}_rs_`)) {
        const add = data.startsWith(`${P}_ra_`); const u = data.replace(add ? `${P}_ra_` : `${P}_rs_`, '');
        editOrSend(bot, chatId, msgId, `⏱ Unité:`, { reply_markup: { inline_keyboard: [[{ text: '📅 Jours', callback_data: `${P}_ru_${add?'a':'s'}_d_${u}` }], [{ text: '🕐 Heures', callback_data: `${P}_ru_${add?'a':'s'}_h_${u}` }], [{ text: '⏱ Minutes', callback_data: `${P}_ru_${add?'a':'s'}_m_${u}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
      }
      else if (data.startsWith(`${P}_ru_`)) {
        const parts = data.replace(`${P}_ru_`, '').split('_'); const sign = parts[0]; const unit = parts[1]; const u = parts.slice(2).join('_');
        editOrSend(bot, chatId, msgId, `🔢 Nombre de ${{d:'jours',h:'heures',m:'minutes'}[unit]} à ${sign==='a'?'ajouter':'retirer'}:`);
        pendingActions[chatId] = { action: `${P}_renew_exec`, user: u, sign, unit, handler: handleRenewFlow, fromId: query.from.id };
      }
      else if (data.startsWith(`${P}_det_`)) await showDetail(bot, chatId, msgId, data.replace(`${P}_det_`, ''));
      else if (data.startsWith(`${P}_lck_`)) await toggleLock(bot, chatId, msgId, data.replace(`${P}_lck_`, ''), query.from.id);
      else if (data.startsWith(`${P}_trf_`) || data.startsWith(`${P}_trr_`)) { const pf = data.startsWith(`${P}_trf_`) ? `${P}_trf_` : `${P}_trr_`; await showTraffic(bot, chatId, msgId, data.replace(pf, '')); }
      else if (data.startsWith(`${P}_qta_`)) { const u = data.replace(`${P}_qta_`, ''); editOrSend(bot, chatId, msgId, `📦 Limite données pour *${u}* (ex: \`5GB\`, \`0\` = illimité):`, { parse_mode: 'Markdown' }); pendingActions[chatId] = { action: `${P}_quota_set`, user: u, handler: handleQuotaFlow, fromId: query.from.id }; }
      else if (data.startsWith(`${P}_cl_`)) { const u = data.replace(`${P}_cl_`, ''); editOrSend(bot, chatId, msgId, `🔢 Max connexions pour *${u}* (0 = illimité):`, { parse_mode: 'Markdown' }); pendingActions[chatId] = { action: `${P}_connlimit_set`, user: u, handler: handleConnLimitFlow, fromId: query.from.id }; }
      else if (data.startsWith(`${P}_onl_`)) await showOnline(bot, chatId, msgId, data.replace(`${P}_onl_`, ''));
  }
}

async function showPaginatedList(bot, chatId, msgId, prefix, pagePrefix, page) {
  const users = await getUsers();
  if (!users.length) { editOrSend(bot, chatId, msgId, '📋 Aucun utilisateur.', { reply_markup: backBtns() }); return; }
  editOrSend(bot, chatId, msgId, '👤 Sélectionnez:', paginatedKeyboard(users, prefix, pagePrefix, page, `menu_${PROTO}`));
}

async function handleCreateFlow(bot, chatId, text, pending, pendingActions, userMsgId) {
  if (pending.step === 'username') { pending.username = text.trim(); pending.step = 'days'; autoDeleteSend(bot, chatId, '📅 Durée (jours):', {}, userMsgId); }
  else if (pending.step === 'days') {
    const d = parseInt(text);
    if (isNaN(d)||d<1) { delete pendingActions[chatId]; return editOrSend(bot, chatId, null, '❌ Nombre de jours invalide.', { reply_markup: { inline_keyboard: [[{ text: '🔄 Réessayer', callback_data: `${PROTO}_create` }, { text: '❌ Annuler', callback_data: `menu_${PROTO}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } }); }
    pending.days = d; pending.step = 'connlimit'; autoDeleteSend(bot, chatId, '🔢 Limite connexions (0 = illimité):', {}, userMsgId);
  }
  else if (pending.step === 'connlimit') {
    const l = parseInt(text);
    if (isNaN(l)||l<0) { delete pendingActions[chatId]; return editOrSend(bot, chatId, null, '❌ Limite invalide.', { reply_markup: { inline_keyboard: [[{ text: '🔄 Réessayer', callback_data: `${PROTO}_create` }, { text: '❌ Annuler', callback_data: `menu_${PROTO}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } }); }
    pending.connLimit = l; pending.step = 'datalimit'; autoDeleteSend(bot, chatId, '📦 Limite données (ex: `5GB`, `0` = illimité):', { parse_mode: 'Markdown' }, userMsgId);
  }
  else if (pending.step === 'datalimit') {
    delete pendingActions[chatId]; let dl = 0;
    if (text.trim() !== '0') { dl = parseLimitToBytes(text.trim()); if (dl === null) return editOrSend(bot, chatId, null, '❌ Format invalide.', { reply_markup: { inline_keyboard: [[{ text: '🔄 Réessayer', callback_data: `${PROTO}_create` }, { text: '❌ Annuler', callback_data: `menu_${PROTO}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } }); }
    await createUser(bot, chatId, pending.username, pending.days, pending.connLimit, dl, pending.fromId, pending.fromName);
  }
}

async function createUser(bot, chatId, username, days, connLimit, dataLimitBytes, createdById, createdByName) {
  try {
    const uuid = generateUUID(); const expiry = getExpiryDate(days); const domain = await getDomain();
    await runCommand(`mkdir -p ${USERS_DB}`);
    await runCommand(`cd /etc/xray && cp config.json config.json.bak`);
    await runCommand(`cd /etc/xray && jq '.inbounds[${INBOUND_INDEX}].settings.clients += [{"id":"${uuid}","alterId":0,"email":"${username}","level":0}]' config.json > tmp.json && mv tmp.json config.json`);
    const userInfo = { username, uuid, expiry, protocol: PROTO, locked: false, connLimit, dataLimit: dataLimitBytes, createdBy: createdByName || String(createdById || 'unknown'), createdById: createdById || null, createdAt: new Date().toISOString() };
    await runCommand(`echo '${JSON.stringify(userInfo)}' > ${USERS_DB}/${username}.json`);
    await runCommand('systemctl restart xray 2>/dev/null || true');
    if (connLimit > 0) await setConnLimit(PROTO, username, connLimit);
    if (dataLimitBytes > 0) await setDataLimit(PROTO, username, dataLimitBytes);
    audit.log(createdById, PROTO, `Créé ${username}`);
    const vc = (ps, port, tls, net, path) => Buffer.from(JSON.stringify({ v:"2", ps, add:domain, port, id:uuid, aid:"0", scy:"auto", net, type:net==='grpc'?'gun':'none', host:domain, path, tls, sni:domain, alpn:"" })).toString('base64');
    bot.sendMessage(chatId, `━━━━━━━━━━━━━━━━━━━━━\n✅ *VMESS Account Created*\n━━━━━━━━━━━━━━━━━━━━━\n👤 User: \`${username}\`\n🔑 UUID: \`${uuid}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${expiry}\`\n🔢 Max Conn: ${connLimit||'♾'}\n📦 Quota: ${dataLimitBytes?formatBytes(dataLimitBytes):'♾'}\n👷 Créé par: ${createdByName || createdById}\n━━━━━━━━━━━━━━━━━━━━━\n🔗 *WS TLS:*\n\`vmess://${vc(`${username}_WS-TLS`,"443","tls","ws","/vmess")}\`\n\n🔗 *WS Non-TLS:*\n\`vmess://${vc(`${username}_WS-NTLS`,"80","","ws","/vmess")}\`\n\n🔗 *gRPC:*\n\`vmess://${vc(`${username}_gRPC`,"443","tls","grpc","vmess-grpc")}\`\n━━━━━━━━━━━━━━━━━━━━━`, { parse_mode: 'Markdown', reply_markup: backBtns() });
  } catch (err) {
    await runCommand('cd /etc/xray && [ -f config.json.bak ] && mv config.json.bak config.json || true').catch(() => {});
    bot.sendMessage(chatId, `❌ Erreur: ${err.message}`, { reply_markup: backBtns() });
  }
}

async function handleModifyUsername(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${pending.user}.json`)); const newUser = text.trim();
    await runCommand(`cd /etc/xray && jq '(.inbounds[${INBOUND_INDEX}].settings.clients[] | select(.email=="${pending.user}")).email = "${newUser}"' config.json > tmp.json && mv tmp.json config.json`);
    info.username = newUser; await runCommand(`echo '${JSON.stringify(info)}' > ${USERS_DB}/${newUser}.json && rm -f ${USERS_DB}/${pending.user}.json`);
    await runCommand('systemctl restart xray 2>/dev/null || true');
    audit.log(pending.fromId, PROTO, `Modifié username: ${pending.user} → ${newUser}`);
    bot.sendMessage(chatId, `✅ *${pending.user}* → *${newUser}*`, { parse_mode: 'Markdown', reply_markup: backBtns() });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`, { reply_markup: backBtns() }); }
}

async function regenerateUUID(bot, chatId, msgId, username, userId) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`)); const newUUID = generateUUID();
    await runCommand(`cd /etc/xray && jq '(.inbounds[${INBOUND_INDEX}].settings.clients[] | select(.email=="${username}")).id = "${newUUID}"' config.json > tmp.json && mv tmp.json config.json`);
    info.uuid = newUUID; await runCommand(`echo '${JSON.stringify(info)}' > ${USERS_DB}/${username}.json`);
    await runCommand('systemctl restart xray 2>/dev/null || true');
    audit.log(userId, PROTO, `UUID régénéré: ${username}`);
    editOrSend(bot, chatId, msgId, `✅ UUID régénéré pour *${username}*:\n\`${newUUID}\``, { parse_mode: 'Markdown', reply_markup: backBtns() });
  } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`, { reply_markup: backBtns() }); }
}

async function handleRenewFlow(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId]; const amount = parseInt(text);
  if (isNaN(amount)||amount<1) return editOrSend(bot, chatId, null, '❌ Nombre invalide.', { reply_markup: { inline_keyboard: [[{ text: '🔄 Réessayer', callback_data: `${PROTO}_ren_${pending.user}` }, { text: '❌ Annuler', callback_data: `menu_${PROTO}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${pending.user}.json`));
    const newExpiry = adjustExpiry(info.expiry, pending.sign==='s'?-amount:amount, {d:'days',h:'hours',m:'minutes'}[pending.unit]);
    info.expiry = newExpiry; await runCommand(`echo '${JSON.stringify(info)}' > ${USERS_DB}/${pending.user}.json`);
    audit.log(pending.fromId, PROTO, `Renouvelé ${pending.user}`);
    bot.sendMessage(chatId, `✅ VMESS *${pending.user}* ${pending.sign==='a'?'+':'-'}${amount} ${{d:'jour(s)',h:'heure(s)',m:'minute(s)'}[pending.unit]} → *${newExpiry}*`, { parse_mode: 'Markdown', reply_markup: backBtns() });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`, { reply_markup: backBtns() }); }
}

async function deleteUser(bot, chatId, msgId, username, userId) {
  try {
    await runCommand(`cd /etc/xray && jq 'del(.inbounds[${INBOUND_INDEX}].settings.clients[] | select(.email=="${username}"))' config.json > tmp.json && mv tmp.json config.json`);
    await runCommand(`rm -f ${USERS_DB}/${username}.json`); await removeDataLimit(PROTO, username);
    await runCommand('systemctl restart xray 2>/dev/null || true');
    audit.log(userId, PROTO, `Supprimé ${username}`);
    editOrSend(bot, chatId, msgId, `✅ VMESS *${username}* supprimé.`, { parse_mode: 'Markdown', reply_markup: backBtns() });
  } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`, { reply_markup: backBtns() }); }
}

async function listUsers(bot, chatId, msgId) {
  const users = await getUsers();
  if (!users.length) { editOrSend(bot, chatId, msgId, '📋 Aucun utilisateur VMESS.', { reply_markup: backBtns() }); return; }
  let text = '━━━━━━━━━━━━━━━━━━━━━\n📋 *VMESS Users*\n━━━━━━━━━━━━━━━━━━━━━\n';
  for (const u of users) { try { const d = JSON.parse(await runCommand(`cat ${USERS_DB}/${u}.json`)); text += `👤 ${u} | 📅 ${d.expiry} | ${d.locked?'🔒':'🔓'}\n`; } catch { text += `👤 ${u}\n`; } }
  editOrSend(bot, chatId, msgId, text, { parse_mode: 'Markdown', reply_markup: backBtns() });
}

async function showDetail(bot, chatId, msgId, username) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`)); const domain = await getDomain();
    const traffic = await getXrayTraffic(username); const limit = await getDataLimit(PROTO, username); const conn = await getConnLimit(PROTO, username);
    const online = await countXrayConnections(username);
    let text = `━━━━━━━━━━━━━━━━━━━━━\n🔍 *VMESS: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n🔑 UUID: \`${info.uuid}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${info.expiry}\`\n🔒 Locked: ${info.locked?'Oui':'Non'}\n🔢 Max Conn: ${conn?conn.maxConn:'♾'}\n👥 En ligne: ${online}\n📦 Quota: ${limit?formatBytes(limit.limitBytes):'♾'}\n📊 Trafic: ↑${formatBytes(traffic.uplink)} ↓${formatBytes(traffic.downlink)}\n📊 Total: ${detailTraffic(traffic.total)}\n👷 Créé par: ${info.createdBy || 'N/A'}`;
    if (limit) text += progressBar(traffic.total, limit.limitBytes);
    text += '\n━━━━━━━━━━━━━━━━━━━━━';
    editOrSend(bot, chatId, msgId, text, { parse_mode: 'Markdown', reply_markup: backBtns() });
  } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`, { reply_markup: backBtns() }); }
}

async function toggleLock(bot, chatId, msgId, username, userId) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`)); const nl = !info.locked;
    info.locked = nl; await runCommand(`echo '${JSON.stringify(info)}' > ${USERS_DB}/${username}.json`);
    if (nl) await runCommand(`cd /etc/xray && jq 'del(.inbounds[${INBOUND_INDEX}].settings.clients[] | select(.email=="${username}"))' config.json > tmp.json && mv tmp.json config.json`);
    else await runCommand(`cd /etc/xray && jq '.inbounds[${INBOUND_INDEX}].settings.clients += [{"id":"${info.uuid}","alterId":0,"email":"${username}","level":0}]' config.json > tmp.json && mv tmp.json config.json`);
    await runCommand('systemctl restart xray 2>/dev/null || true');
    audit.log(userId, PROTO, `${nl?'Verrouillé':'Déverrouillé'} ${username}`);
    editOrSend(bot, chatId, msgId, `✅ VMESS *${username}* ${nl?'🔒':'🔓'}`, { parse_mode: 'Markdown', reply_markup: backBtns() });
  } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`, { reply_markup: backBtns() }); }
}

async function showTraffic(bot, chatId, msgId, username) {
  try {
    const traffic = await getXrayTraffic(username); const limit = await getDataLimit(PROTO, username);
    let text = `━━━━━━━━━━━━━━━━━━━━━\n📊 *Trafic VMESS: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n⬆️ Upload: ${formatBytes(traffic.uplink)}\n⬇️ Download: ${formatBytes(traffic.downlink)}\n📊 Total: ${formatBytes(traffic.total)}\n📋 Détail: ${detailTraffic(traffic.total)}`;
    if (limit) { text += `\n📦 Quota: ${formatBytes(limit.limitBytes)}\n📈 Utilisé: ${((traffic.total/limit.limitBytes)*100).toFixed(1)}%`; text += progressBar(traffic.total, limit.limitBytes); }
    text += '\n━━━━━━━━━━━━━━━━━━━━━';
    editOrSend(bot, chatId, msgId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔄 Actualiser', callback_data: `${PROTO}_trr_${username}` }], [{ text: '🔙 Retour', callback_data: `menu_${PROTO}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
  } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`, { reply_markup: backBtns() }); }
}

async function showOnline(bot, chatId, msgId, username) {
  try {
    const online = await countXrayConnections(username);
    const conn = await getConnLimit(PROTO, username);
    editOrSend(bot, chatId, msgId, `━━━━━━━━━━━━━━━━━━━━━\n👥 *En ligne VMESS: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n👥 Connectés: ${online}\n🔢 Max: ${conn ? conn.maxConn : '♾'}\n━━━━━━━━━━━━━━━━━━━━━`, {
      parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔄 Actualiser', callback_data: `${PROTO}_onl_${username}` }], [{ text: '🔙 Retour', callback_data: `menu_${PROTO}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] }
    });
  } catch (err) { editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`, { reply_markup: backBtns() }); }
}

async function handleQuotaFlow(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId];
  if (text.trim()==='0') { await removeDataLimit(PROTO, pending.user); audit.log(pending.fromId, PROTO, `Quota supprimé: ${pending.user}`); return bot.sendMessage(chatId, `✅ Quota supprimé pour *${pending.user}*`, { parse_mode: 'Markdown', reply_markup: backBtns() }); }
  const bytes = parseLimitToBytes(text.trim());
  if (!bytes) return editOrSend(bot, chatId, null, '❌ Format invalide.', { reply_markup: { inline_keyboard: [[{ text: '🔄 Réessayer', callback_data: `${PROTO}_qta_${pending.user}` }, { text: '❌ Annuler', callback_data: `menu_${PROTO}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
  await setDataLimit(PROTO, pending.user, bytes);
  audit.log(pending.fromId, PROTO, `Quota: ${pending.user} = ${formatBytes(bytes)}`);
  bot.sendMessage(chatId, `✅ Quota *${pending.user}*: ${formatBytes(bytes)}`, { parse_mode: 'Markdown', reply_markup: backBtns() });
}

async function handleConnLimitFlow(bot, chatId, text, pending, pendingActions) {
  delete pendingActions[chatId]; const max = parseInt(text);
  if (isNaN(max)||max<0) return editOrSend(bot, chatId, null, '❌ Invalide.', { reply_markup: { inline_keyboard: [[{ text: '🔄 Réessayer', callback_data: `${PROTO}_cl_${pending.user}` }, { text: '❌ Annuler', callback_data: `menu_${PROTO}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
  await setConnLimit(PROTO, pending.user, max);
  try { const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${pending.user}.json`)); info.connLimit = max; await runCommand(`echo '${JSON.stringify(info)}' > ${USERS_DB}/${pending.user}.json`); } catch {}
  audit.log(pending.fromId, PROTO, `Limite conn: ${pending.user} = ${max||'♾'}`);
  bot.sendMessage(chatId, `✅ Limite connexions *${pending.user}*: ${max||'♾'}`, { parse_mode: 'Markdown', reply_markup: backBtns() });
}

module.exports = { showMenu, handleCallback };
