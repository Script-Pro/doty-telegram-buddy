const { runCommand, getDomain } = require('../utils/exec');
const { getExpiryDate } = require('../utils/helpers');

const USERS_DB = '/etc/ssh-users';

function showMenu(bot, chatId) {
  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━\n🔑 *SSH MENU*\n━━━━━━━━━━━━━━━━━━━━━`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Créer', callback_data: 'ssh_create' }, { text: '🗑 Supprimer', callback_data: 'ssh_delete' }],
          [{ text: '🔄 Renouveler', callback_data: 'ssh_renew' }, { text: '📋 Liste', callback_data: 'ssh_list' }],
          [{ text: '🔍 Détails', callback_data: 'ssh_detail' }, { text: '🔒 Lock/Unlock', callback_data: 'ssh_lockuser' }],
          [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
        ],
      },
    }
  );
}

async function handleCallback(bot, chatId, data, query) {
  const { pendingActions } = require('../index');
  switch (data) {
    case 'ssh_create':
      bot.sendMessage(chatId, '📝 Nom d\'utilisateur SSH:');
      pendingActions[chatId] = { action: 'ssh_create', step: 'username', handler: handleCreateFlow };
      break;
    case 'ssh_delete': await showUserList(bot, chatId, 'ssh_del_'); break;
    case 'ssh_renew': await showUserList(bot, chatId, 'ssh_ren_'); break;
    case 'ssh_list': await listUsers(bot, chatId); break;
    case 'ssh_detail': await showUserList(bot, chatId, 'ssh_det_'); break;
    case 'ssh_lockuser': await showUserList(bot, chatId, 'ssh_lck_'); break;
    default:
      if (data.startsWith('ssh_del_')) await deleteUser(bot, chatId, data.replace('ssh_del_', ''));
      else if (data.startsWith('ssh_ren_')) {
        const user = data.replace('ssh_ren_', '');
        bot.sendMessage(chatId, `🔄 Jours pour *${user}*:`, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: 'ssh_renew', user, handler: handleRenewFlow };
      }
      else if (data.startsWith('ssh_det_')) await showDetail(bot, chatId, data.replace('ssh_det_', ''));
      else if (data.startsWith('ssh_lck_')) await toggleLock(bot, chatId, data.replace('ssh_lck_', ''));
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
      
      // Create system user
      await runCommand(`useradd -e $(date -d "+${days} days" +%Y-%m-%d) -s /bin/false -M ${pending.username} 2>/dev/null || true`);
      await runCommand(`echo "${pending.username}:${pending.password}" | chpasswd`);
      
      // Save user data
      await runCommand(`mkdir -p ${USERS_DB}`);
      await runCommand(`echo '{"username":"${pending.username}","password":"${pending.password}","expiry":"${expiry}","locked":false}' > ${USERS_DB}/${pending.username}.json`);

      bot.sendMessage(chatId,
        `━━━━━━━━━━━━━━━━━━━━━\n✅ *SSH Account Created*\n━━━━━━━━━━━━━━━━━━━━━
👤 User: \`${pending.username}\`
🔑 Pass: \`${pending.password}\`
🌐 Domain: \`${domain}\`
📅 Expiry: \`${expiry}\`
━━━━━━━━━━━━━━━━━━━━━
🔗 *WebSocket TLS:* \`wss://${domain}:443\`
📂 Path: \`/ssh-ws\`
🔗 *WebSocket NTLS:* \`ws://${domain}:80\`
📂 Path: \`/ssh-ws\`
━━━━━━━━━━━━━━━━━━━━━`, { parse_mode: 'Markdown' });
    } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
  }
}

async function handleRenewFlow(bot, chatId, text, pending, pendingActions) {
  const days = parseInt(text);
  if (isNaN(days) || days < 1) { bot.sendMessage(chatId, '❌ Invalide.'); delete pendingActions[chatId]; return; }
  delete pendingActions[chatId];
  try {
    const newExpiry = getExpiryDate(days);
    await runCommand(`chage -E $(date -d "+${days} days" +%Y-%m-%d) ${pending.user}`);
    await runCommand(`jq '.expiry = "${newExpiry}"' ${USERS_DB}/${pending.user}.json > /tmp/tmp.json && mv /tmp/tmp.json ${USERS_DB}/${pending.user}.json`);
    bot.sendMessage(chatId, `✅ SSH *${pending.user}* → *${newExpiry}*`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function deleteUser(bot, chatId, username) {
  try {
    await runCommand(`userdel -f ${username} 2>/dev/null || true`);
    await runCommand(`rm -f ${USERS_DB}/${username}.json`);
    bot.sendMessage(chatId, `✅ SSH *${username}* supprimé.`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function listUsers(bot, chatId) {
  try {
    const result = await runCommand(`ls ${USERS_DB}/ 2>/dev/null | sed 's/.json//'`);
    if (!result) { bot.sendMessage(chatId, '📋 Aucun utilisateur SSH.'); return; }
    let text = '━━━━━━━━━━━━━━━━━━━━━\n📋 *SSH Users*\n━━━━━━━━━━━━━━━━━━━━━\n';
    for (const u of result.split('\n')) {
      try { const d = JSON.parse(await runCommand(`cat ${USERS_DB}/${u}.json`)); text += `👤 ${u} | 📅 ${d.expiry}\n`; }
      catch { text += `👤 ${u}\n`; }
    }
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch { bot.sendMessage(chatId, '📋 Aucun utilisateur SSH.'); }
}

async function showUserList(bot, chatId, prefix) {
  try {
    const result = await runCommand(`ls ${USERS_DB}/ 2>/dev/null | sed 's/.json//'`);
    if (!result) { bot.sendMessage(chatId, '📋 Aucun utilisateur.'); return; }
    const kb = result.split('\n').map(u => [{ text: u, callback_data: `${prefix}${u}` }]);
    kb.push([{ text: '🔙 Retour', callback_data: 'menu_ssh' }]);
    bot.sendMessage(chatId, '👤 Sélectionnez:', { reply_markup: { inline_keyboard: kb } });
  } catch { bot.sendMessage(chatId, '📋 Aucun utilisateur.'); }
}

async function showDetail(bot, chatId, username) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`));
    const domain = await getDomain();
    bot.sendMessage(chatId, `━━━━━━━━━━━━━━━━━━━━━\n🔍 *SSH: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n🔑 Pass: \`${info.password}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${info.expiry}\`\n🔒 Locked: ${info.locked ? 'Oui' : 'Non'}\n━━━━━━━━━━━━━━━━━━━━━`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function toggleLock(bot, chatId, username) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`));
    const newLocked = !info.locked;
    await runCommand(`jq '.locked = ${newLocked}' ${USERS_DB}/${username}.json > /tmp/tmp.json && mv /tmp/tmp.json ${USERS_DB}/${username}.json`);
    if (newLocked) await runCommand(`passwd -l ${username}`);
    else await runCommand(`passwd -u ${username}`);
    bot.sendMessage(chatId, `✅ SSH *${username}* ${newLocked ? '🔒' : '🔓'}`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

module.exports = { showMenu, handleCallback };
