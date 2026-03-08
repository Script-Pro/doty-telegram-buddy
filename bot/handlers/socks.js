const { runCommand, getDomain } = require('../utils/exec');
const { generateUUID, getExpiryDate } = require('../utils/helpers');

const USERS_DB = '/etc/xray/users-socks';

function showMenu(bot, chatId) {
  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━\n🔰 *SOCKS MENU*\n━━━━━━━━━━━━━━━━━━━━━`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Créer', callback_data: 'socks_create' }, { text: '🗑 Supprimer', callback_data: 'socks_delete' }],
          [{ text: '🔄 Renouveler', callback_data: 'socks_renew' }, { text: '📋 Liste', callback_data: 'socks_list' }],
          [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
        ],
      },
    }
  );
}

async function handleCallback(bot, chatId, data, query) {
  const { pendingActions } = require('../index');
  switch (data) {
    case 'socks_create':
      bot.sendMessage(chatId, '📝 Nom d\'utilisateur SOCKS:');
      pendingActions[chatId] = { action: 'socks_create', step: 'username', handler: handleCreateFlow };
      break;
    case 'socks_delete': await showUserList(bot, chatId, 'socks_del_'); break;
    case 'socks_renew': await showUserList(bot, chatId, 'socks_ren_'); break;
    case 'socks_list': await listUsers(bot, chatId); break;
    default:
      if (data.startsWith('socks_del_')) await deleteUser(bot, chatId, data.replace('socks_del_', ''));
      else if (data.startsWith('socks_ren_')) {
        bot.sendMessage(chatId, `🔄 Jours:`, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: 'socks_renew', user: data.replace('socks_ren_', ''), handler: handleRenewFlow };
      }
  }
}

async function handleCreateFlow(bot, chatId, text, pending, pendingActions) {
  if (pending.step === 'username') { pending.username = text.trim(); pending.step = 'password'; bot.sendMessage(chatId, '🔑 Mot de passe:'); }
  else if (pending.step === 'password') { pending.password = text.trim(); pending.step = 'days'; bot.sendMessage(chatId, '📅 Durée (jours):'); }
  else if (pending.step === 'days') {
    const days = parseInt(text);
    if (isNaN(days) || days < 1) { bot.sendMessage(chatId, '❌ Invalide.'); delete pendingActions[chatId]; return; }
    delete pendingActions[chatId];
    try {
      const expiry = getExpiryDate(days);
      const domain = await getDomain();
      await runCommand(`mkdir -p ${USERS_DB}`);
      // Add to socks inbound in xray (usually index 3)
      await runCommand(`cd /etc/xray && jq '.inbounds[3].settings.accounts += [{"user":"${pending.username}","pass":"${pending.password}"}]' config.json > tmp.json && mv tmp.json config.json`);
      await runCommand(`echo '{"username":"${pending.username}","password":"${pending.password}","expiry":"${expiry}"}' > ${USERS_DB}/${pending.username}.json`);
      await runCommand('systemctl restart xray');

      bot.sendMessage(chatId,
        `━━━━━━━━━━━━━━━━━━━━━\n✅ *SOCKS Created*\n━━━━━━━━━━━━━━━━━━━━━\n👤 User: \`${pending.username}\`\n🔑 Pass: \`${pending.password}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${expiry}\`\n━━━━━━━━━━━━━━━━━━━━━\n🔗 *WS TLS:* Port 443 Path: /ssws\n🔗 *gRPC:* Port 443 Service: socks-grpc\n━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
  }
}

async function handleRenewFlow(bot, chatId, text, pending, pendingActions) {
  const days = parseInt(text);
  if (isNaN(days) || days < 1) { bot.sendMessage(chatId, '❌ Invalide.'); delete pendingActions[chatId]; return; }
  delete pendingActions[chatId];
  try {
    const newExpiry = getExpiryDate(days);
    await runCommand(`jq '.expiry = "${newExpiry}"' ${USERS_DB}/${pending.user}.json > /tmp/tmp.json && mv /tmp/tmp.json ${USERS_DB}/${pending.user}.json`);
    bot.sendMessage(chatId, `✅ SOCKS *${pending.user}* → *${newExpiry}*`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function deleteUser(bot, chatId, username) {
  try {
    await runCommand(`cd /etc/xray && jq 'del(.inbounds[3].settings.accounts[] | select(.user=="${username}"))' config.json > tmp.json && mv tmp.json config.json`);
    await runCommand(`rm -f ${USERS_DB}/${username}.json`);
    await runCommand('systemctl restart xray');
    bot.sendMessage(chatId, `✅ SOCKS *${username}* supprimé.`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function listUsers(bot, chatId) {
  try {
    const result = await runCommand(`ls ${USERS_DB}/ 2>/dev/null | sed 's/.json//'`);
    if (!result) { bot.sendMessage(chatId, '📋 Aucun utilisateur SOCKS.'); return; }
    let text = '📋 *SOCKS Users*\n';
    for (const u of result.split('\n')) {
      try { const d = JSON.parse(await runCommand(`cat ${USERS_DB}/${u}.json`)); text += `👤 ${u} | 📅 ${d.expiry}\n`; }
      catch { text += `👤 ${u}\n`; }
    }
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch { bot.sendMessage(chatId, '📋 Aucun utilisateur SOCKS.'); }
}

async function showUserList(bot, chatId, prefix) {
  try {
    const result = await runCommand(`ls ${USERS_DB}/ 2>/dev/null | sed 's/.json//'`);
    if (!result) { bot.sendMessage(chatId, '📋 Aucun utilisateur.'); return; }
    const kb = result.split('\n').map(u => [{ text: u, callback_data: `${prefix}${u}` }]);
    kb.push([{ text: '🔙 Retour', callback_data: 'menu_socks' }]);
    bot.sendMessage(chatId, '👤 Sélectionnez:', { reply_markup: { inline_keyboard: kb } });
  } catch { bot.sendMessage(chatId, '📋 Aucun utilisateur.'); }
}

module.exports = { showMenu, handleCallback };
