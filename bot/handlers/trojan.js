const { runCommand, getDomain } = require('../utils/exec');
const { generateUUID, getExpiryDate } = require('../utils/helpers');

const USERS_DB = '/etc/xray/users-trojan';

function showMenu(bot, chatId) {
  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━\n🔰 *TROJAN MENU*\n━━━━━━━━━━━━━━━━━━━━━\nSélectionnez une action:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Créer', callback_data: 'trojan_create' }, { text: '🗑 Supprimer', callback_data: 'trojan_delete' }],
          [{ text: '🔄 Renouveler', callback_data: 'trojan_renew' }, { text: '📋 Liste', callback_data: 'trojan_list' }],
          [{ text: '🔍 Détails', callback_data: 'trojan_detail' }, { text: '🔒 Lock/Unlock', callback_data: 'trojan_lock' }],
          [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
        ],
      },
    }
  );
}

async function handleCallback(bot, chatId, data, query) {
  const { pendingActions } = require('../index');
  switch (data) {
    case 'trojan_create':
      bot.sendMessage(chatId, '📝 Nom d\'utilisateur TROJAN:');
      pendingActions[chatId] = { action: 'trojan_create', step: 'username', handler: handleCreateFlow };
      break;
    case 'trojan_delete': await showUserList(bot, chatId, 'trojan_del_'); break;
    case 'trojan_renew': await showUserList(bot, chatId, 'trojan_ren_'); break;
    case 'trojan_list': await listUsers(bot, chatId); break;
    case 'trojan_detail': await showUserList(bot, chatId, 'trojan_det_'); break;
    case 'trojan_lock': await showUserList(bot, chatId, 'trojan_lck_'); break;
    default:
      if (data.startsWith('trojan_del_')) await deleteUser(bot, chatId, data.replace('trojan_del_', ''));
      else if (data.startsWith('trojan_ren_')) {
        const user = data.replace('trojan_ren_', '');
        bot.sendMessage(chatId, `🔄 Jours pour *${user}*:`, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: 'trojan_renew', user, handler: handleRenewFlow };
      }
      else if (data.startsWith('trojan_det_')) await showDetail(bot, chatId, data.replace('trojan_det_', ''));
      else if (data.startsWith('trojan_lck_')) await toggleLock(bot, chatId, data.replace('trojan_lck_', ''));
  }
}

async function handleCreateFlow(bot, chatId, text, pending, pendingActions) {
  if (pending.step === 'username') { pending.username = text.trim(); pending.step = 'days'; bot.sendMessage(chatId, '📅 Durée (jours):'); }
  else if (pending.step === 'days') {
    const days = parseInt(text);
    if (isNaN(days) || days < 1) { bot.sendMessage(chatId, '❌ Invalide.'); delete pendingActions[chatId]; return; }
    delete pendingActions[chatId];
    try {
      const password = generateUUID().split('-')[0];
      const expiry = getExpiryDate(days);
      const domain = await getDomain();
      await runCommand(`mkdir -p ${USERS_DB}`);
      await runCommand(`cd /etc/xray && jq '.inbounds[2].settings.clients += [{"password":"${password}","email":"${pending.username}"}]' config.json > tmp.json && mv tmp.json config.json`);
      await runCommand(`echo '{"username":"${pending.username}","password":"${password}","expiry":"${expiry}","locked":false}' > ${USERS_DB}/${pending.username}.json`);
      await runCommand('systemctl restart xray');

      const wsLink = `trojan://${password}@${domain}:443?type=ws&security=tls&path=/trws&host=${domain}&sni=${domain}#${pending.username}_WS-TLS`;
      const grpcLink = `trojan://${password}@${domain}:443?type=grpc&security=tls&serviceName=trojan-grpc&sni=${domain}#${pending.username}_gRPC`;

      bot.sendMessage(chatId, `━━━━━━━━━━━━━━━━━━━━━\n✅ *TROJAN Created*\n━━━━━━━━━━━━━━━━━━━━━\n👤 User: \`${pending.username}\`\n🔑 Password: \`${password}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${expiry}\`\n━━━━━━━━━━━━━━━━━━━━━\n🔗 *WS TLS:*\n\`${wsLink}\`\n\n🔗 *gRPC:*\n\`${grpcLink}\`\n━━━━━━━━━━━━━━━━━━━━━`, { parse_mode: 'Markdown' });
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
    bot.sendMessage(chatId, `✅ TROJAN *${pending.user}* → *${newExpiry}*`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function deleteUser(bot, chatId, username) {
  try {
    await runCommand(`cd /etc/xray && jq 'del(.inbounds[2].settings.clients[] | select(.email=="${username}"))' config.json > tmp.json && mv tmp.json config.json`);
    await runCommand(`rm -f ${USERS_DB}/${username}.json`);
    await runCommand('systemctl restart xray');
    bot.sendMessage(chatId, `✅ TROJAN *${username}* supprimé.`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function listUsers(bot, chatId) {
  try {
    const result = await runCommand(`ls ${USERS_DB}/ 2>/dev/null | sed 's/.json//'`);
    if (!result) { bot.sendMessage(chatId, '📋 Aucun utilisateur TROJAN.'); return; }
    let text = '━━━━━━━━━━━━━━━━━━━━━\n📋 *TROJAN Users*\n━━━━━━━━━━━━━━━━━━━━━\n';
    for (const u of result.split('\n')) {
      try { const d = JSON.parse(await runCommand(`cat ${USERS_DB}/${u}.json`)); text += `👤 ${u} | 📅 ${d.expiry}\n`; }
      catch { text += `👤 ${u}\n`; }
    }
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch { bot.sendMessage(chatId, '📋 Aucun utilisateur TROJAN.'); }
}

async function showUserList(bot, chatId, prefix) {
  try {
    const result = await runCommand(`ls ${USERS_DB}/ 2>/dev/null | sed 's/.json//'`);
    if (!result) { bot.sendMessage(chatId, '📋 Aucun utilisateur.'); return; }
    const kb = result.split('\n').map(u => [{ text: u, callback_data: `${prefix}${u}` }]);
    kb.push([{ text: '🔙 Retour', callback_data: 'menu_trojan' }]);
    bot.sendMessage(chatId, '👤 Sélectionnez:', { reply_markup: { inline_keyboard: kb } });
  } catch { bot.sendMessage(chatId, '📋 Aucun utilisateur.'); }
}

async function showDetail(bot, chatId, username) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`));
    const domain = await getDomain();
    bot.sendMessage(chatId, `━━━━━━━━━━━━━━━━━━━━━\n🔍 *TROJAN: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n🔑 Pass: \`${info.password}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${info.expiry}\`\n━━━━━━━━━━━━━━━━━━━━━`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function toggleLock(bot, chatId, username) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`));
    const newLocked = !info.locked;
    await runCommand(`jq '.locked = ${newLocked}' ${USERS_DB}/${username}.json > /tmp/tmp.json && mv /tmp/tmp.json ${USERS_DB}/${username}.json`);
    if (newLocked) await runCommand(`cd /etc/xray && jq 'del(.inbounds[2].settings.clients[] | select(.email=="${username}"))' config.json > tmp.json && mv tmp.json config.json`);
    else await runCommand(`cd /etc/xray && jq '.inbounds[2].settings.clients += [{"password":"${info.password}","email":"${username}"}]' config.json > tmp.json && mv tmp.json config.json`);
    await runCommand('systemctl restart xray');
    bot.sendMessage(chatId, `✅ TROJAN *${username}* ${newLocked ? '🔒' : '🔓'}`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

module.exports = { showMenu, handleCallback };
