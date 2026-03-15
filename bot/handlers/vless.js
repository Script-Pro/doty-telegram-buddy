const { runCommand, getDomain } = require('../utils/exec');
const { generateUUID, getExpiryDate, adjustExpiry } = require('../utils/helpers');
const { paginatedKeyboard, getPageFromCallback } = require('../utils/pagination');
const { getXrayTraffic, formatBytes, parseLimitToBytes, setDataLimit, getDataLimit, removeDataLimit, setConnLimit, getConnLimit } = require('../utils/traffic');
const { autoDeleteSend, scheduleDelete } = require('../utils/autodelete');
const { addClient, removeClient, updateClientField, renameClient, countUserConnections } = require('../utils/xray');
const audit = require('../utils/audit');

const USERS_DB = '/etc/xray/users';
const PROTO = 'vless';
const XRAY_PROTO = 'vless';

function editOrSend(bot, chatId, msgId, text, opts = {}) {
  if (msgId) return bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...opts }).catch(() => bot.sendMessage(chatId, text, opts));
  return bot.sendMessage(chatId, text, opts);
}
function backBtns(extra = []) { return { inline_keyboard: [...extra, [{ text: '🔙 Retour', callback_data: `menu_${PROTO}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] }; }

// ... (Garder showMenu, handleCallback, handleCreateFlow intactes) ...

function showMenu(bot, chatId, msgId) {
  editOrSend(bot, chatId, msgId, `━━━━━━━━━━━━━━━━━━━━━\n🔰 *VLESS MENU*\n━━━━━━━━━━━━━━━━━━━━━`, {
    parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
      [{ text: '➕ Créer', callback_data: 'vless_create' }, { text: '✏️ Modifier', callback_data: 'vless_modify' }],
      [{ text: '🔄 Renouveler', callback_data: 'vless_renew' }, { text: '🗑 Supprimer', callback_data: 'vless_delete' }],
      [{ text: '📋 Liste', callback_data: 'vless_list' }, { text: '🔍 Détails', callback_data: 'vless_detail' }],
      [{ text: '🔒 Lock/Unlock', callback_data: 'vless_lock' }],
      [{ text: '📊 Trafic', callback_data: 'vless_traffic' }, { text: '📦 Quota Data', callback_data: 'vless_quota' }],
      [{ text: '🔢 Limite Connexion', callback_data: 'vless_connlimit' }, { text: '👥 En ligne', callback_data: 'vless_online' }],
      [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }],
    ]}
  });
}

async function getUsers() {
  try { const r = await runCommand(`ls ${USERS_DB}/ 2>/dev/null | sed 's/.json//'`); return r ? r.split('\n').filter(Boolean) : []; }
  catch { return []; }
}

async function handleCallback(bot, chatId, data, query, pendingActions) {
    // ... Gardez le même routeur handleCallback de votre fichier d'origine ...
}

async function handleCreateFlow(bot, chatId, text, pending, pendingActions, userMsgId) {
    // ... Gardez le même flux de création username -> jours -> connlimit -> datalimit ...
}

async function createUser(bot, chatId, username, days, connLimit, dataLimitBytes, createdById, createdByName) {
  try {
    const uuid = generateUUID(); const expiry = getExpiryDate(days); const domain = await getDomain();
    await runCommand(`mkdir -p ${USERS_DB}`);

    // Utilisation des fonctions Xray directes
    await addClient(XRAY_PROTO, { id: uuid, email: username, level: 0 });

    const userInfo = { username, uuid, expiry, protocol: PROTO, locked: false, connLimit, dataLimit: dataLimitBytes, createdBy: createdByName || String(createdById || 'unknown'), createdById: createdById || null, createdAt: new Date().toISOString() };
    await runCommand(`echo '${JSON.stringify(userInfo)}' > ${USERS_DB}/${username}.json`);
    if (connLimit > 0) await setConnLimit(PROTO, username, connLimit);
    if (dataLimitBytes > 0) await setDataLimit(PROTO, username, dataLimitBytes);
    audit.log(createdById, PROTO, `Créé ${username} (${days}j, conn:${connLimit || '♾'}, data:${dataLimitBytes ? formatBytes(dataLimitBytes) : '♾'})`);

    // Construction des liens
    const wsTls = `vless://${uuid}@${domain}:443?path=/vless&security=tls&encryption=none&type=ws#${username}`;
    const wsNtls = `vless://${uuid}@${domain}:80?path=/vless&encryption=none&type=ws#${username}`;
    const grpc = `vless://${uuid}@${domain}:443?mode=gun&security=tls&encryption=none&type=grpc&serviceName=vless-grpc#${username}`;

    // --- CONSTRUCTION DU MESSAGE FORMAT DOTYWRT (CODE BLOCK POUR ALIGNEMENT) ---
    const msg = `\`\`\`text
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃               VLESS ACCOUNT DETAILS              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Username    : ${username}
┃ Expiry Date : ${expiry}
┃ UUID        : ${uuid}
●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●
┃ Domain      : ${domain}
┃ Port TLS    : 443
┃ Port NonTLS : 80
┃ Port gRPC   : 443
┃ Security    : auto
┃ Network     : ws
┃ Path        : /vless
●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●
┃ Custom Path Info
┃
┃ TLS         : 2087
┃ NTLS        : 2086
┃ PATH        : / OR /<anytext>
●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●
┃ TLS  :
┃ ${wsTls}
┃
┃ NTLS :
┃ ${wsNtls}
┃
┃ GRPC :
┃ ${grpc}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
\`\`\``;

    bot.sendMessage(chatId, msg, { parse_mode: 'MarkdownV2', reply_markup: backBtns() });

  } catch (err) {
    bot.sendMessage(chatId, `❌ Erreur: ${err.message}`, { reply_markup: backBtns() });
  }
}

// ... (Garder le reste des fonctions handleModifyUsername, handleRenewFlow, deleteUser, etc. telles qu'elles sont dans votre bot)

module.exports = { showMenu, handleCallback, createUser };

                                                                          
