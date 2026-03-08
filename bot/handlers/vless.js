const { runCommand, getDomain } = require('../utils/exec');
const { generateUUID, getExpiryDate, readJSON, writeJSON } = require('../utils/helpers');

const XRAY_CONFIG = '/etc/xray/config.json';
const USERS_DB = '/etc/xray/users';

function showMenu(bot, chatId) {
  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━
🔰 *VLESS MENU*
━━━━━━━━━━━━━━━━━━━━━
Sélectionnez une action:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '➕ Créer', callback_data: 'vless_create' },
            { text: '🗑 Supprimer', callback_data: 'vless_delete' },
          ],
          [
            { text: '🔄 Renouveler', callback_data: 'vless_renew' },
            { text: '📋 Liste', callback_data: 'vless_list' },
          ],
          [
            { text: '🔍 Détails', callback_data: 'vless_detail' },
            { text: '🔒 Lock/Unlock', callback_data: 'vless_lock' },
          ],
          [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
        ],
      },
    }
  );
}

async function handleCallback(bot, chatId, data, query) {
  const { pendingActions } = require('../index');

  switch (data) {
    case 'vless_create':
      bot.sendMessage(chatId, '📝 Entrez le nom d\'utilisateur pour VLESS:');
      pendingActions[chatId] = {
        action: 'vless_create',
        step: 'username',
        handler: handleCreateFlow,
      };
      break;

    case 'vless_delete':
      await showUserList(bot, chatId, 'vless_del_');
      break;

    case 'vless_renew':
      await showUserList(bot, chatId, 'vless_ren_');
      break;

    case 'vless_list':
      await listUsers(bot, chatId);
      break;

    case 'vless_detail':
      await showUserList(bot, chatId, 'vless_det_');
      break;

    case 'vless_lock':
      await showUserList(bot, chatId, 'vless_lck_');
      break;

    default:
      if (data.startsWith('vless_del_')) {
        const user = data.replace('vless_del_', '');
        await deleteUser(bot, chatId, user);
      } else if (data.startsWith('vless_ren_')) {
        const user = data.replace('vless_ren_', '');
        bot.sendMessage(chatId, `🔄 Entrez le nombre de jours pour renouveler *${user}*:`, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: 'vless_renew', user, handler: handleRenewFlow };
      } else if (data.startsWith('vless_det_')) {
        const user = data.replace('vless_det_', '');
        await showDetail(bot, chatId, user);
      } else if (data.startsWith('vless_lck_')) {
        const user = data.replace('vless_lck_', '');
        await toggleLock(bot, chatId, user);
      }
  }
}

async function handleCreateFlow(bot, chatId, text, pending, pendingActions) {
  if (pending.step === 'username') {
    pending.username = text.trim();
    pending.step = 'days';
    bot.sendMessage(chatId, '📅 Entrez la durée (en jours):');
  } else if (pending.step === 'days') {
    const days = parseInt(text);
    if (isNaN(days) || days < 1) {
      bot.sendMessage(chatId, '❌ Nombre de jours invalide.');
      delete pendingActions[chatId];
      return;
    }
    delete pendingActions[chatId];
    await createUser(bot, chatId, pending.username, days);
  }
}

async function handleRenewFlow(bot, chatId, text, pending, pendingActions) {
  const days = parseInt(text);
  if (isNaN(days) || days < 1) {
    bot.sendMessage(chatId, '❌ Nombre de jours invalide.');
    delete pendingActions[chatId];
    return;
  }
  delete pendingActions[chatId];
  await renewUser(bot, chatId, pending.user, days);
}

async function createUser(bot, chatId, username, days) {
  try {
    const uuid = generateUUID();
    const expiry = getExpiryDate(days);
    const domain = await getDomain();

    // Add to Xray config
    await runCommand(`
      cd /etc/xray && 
      jq '.inbounds[0].settings.clients += [{"id":"${uuid}","email":"${username}"}]' config.json > tmp.json && 
      mv tmp.json config.json
    `);

    // Save user data
    await runCommand(`mkdir -p ${USERS_DB}`);
    await runCommand(`echo '{"username":"${username}","uuid":"${uuid}","expiry":"${expiry}","protocol":"vless","locked":false}' > ${USERS_DB}/${username}.json`);

    // Restart Xray
    await runCommand('systemctl restart xray');

    const wsPath = '/vless';
    const grpcService = 'vless-grpc';

    const wsLink = `vless://${uuid}@${domain}:443?type=ws&security=tls&path=${wsPath}&host=${domain}&sni=${domain}#${username}_WS-TLS`;
    const wsNtlsLink = `vless://${uuid}@${domain}:80?type=ws&path=${wsPath}&host=${domain}#${username}_WS-NTLS`;
    const grpcLink = `vless://${uuid}@${domain}:443?type=grpc&security=tls&serviceName=${grpcService}&sni=${domain}#${username}_gRPC`;

    bot.sendMessage(chatId,
      `━━━━━━━━━━━━━━━━━━━━━
✅ *VLESS Account Created*
━━━━━━━━━━━━━━━━━━━━━
👤 User: \`${username}\`
🔑 UUID: \`${uuid}\`
🌐 Domain: \`${domain}\`
📅 Expiry: \`${expiry}\`
━━━━━━━━━━━━━━━━━━━━━
🔗 *WS TLS:*
\`${wsLink}\`

🔗 *WS Non-TLS:*
\`${wsNtlsLink}\`

🔗 *gRPC:*
\`${grpcLink}\`
━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
  }
}

async function deleteUser(bot, chatId, username) {
  try {
    await runCommand(`
      cd /etc/xray &&
      jq 'del(.inbounds[0].settings.clients[] | select(.email=="${username}"))' config.json > tmp.json &&
      mv tmp.json config.json
    `);
    await runCommand(`rm -f ${USERS_DB}/${username}.json`);
    await runCommand('systemctl restart xray');
    bot.sendMessage(chatId, `✅ Utilisateur VLESS *${username}* supprimé.`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
  }
}

async function renewUser(bot, chatId, username, days) {
  try {
    const userFile = `${USERS_DB}/${username}.json`;
    const newExpiry = getExpiryDate(days);
    await runCommand(`jq '.expiry = "${newExpiry}"' ${userFile} > /tmp/tmp_user.json && mv /tmp/tmp_user.json ${userFile}`);
    bot.sendMessage(chatId, `✅ VLESS *${username}* renouvelé jusqu'au *${newExpiry}*`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
  }
}

async function listUsers(bot, chatId) {
  try {
    const result = await runCommand(`ls ${USERS_DB}/ 2>/dev/null | sed 's/.json//'`);
    if (!result) {
      bot.sendMessage(chatId, '📋 Aucun utilisateur VLESS trouvé.');
      return;
    }
    const users = result.split('\n');
    let text = '━━━━━━━━━━━━━━━━━━━━━\n📋 *VLESS Users*\n━━━━━━━━━━━━━━━━━━━━━\n';
    for (const u of users) {
      try {
        const data = await runCommand(`cat ${USERS_DB}/${u}.json`);
        const info = JSON.parse(data);
        text += `👤 ${u} | 📅 ${info.expiry} | ${info.locked ? '🔒' : '🔓'}\n`;
      } catch {
        text += `👤 ${u}\n`;
      }
    }
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch {
    bot.sendMessage(chatId, '📋 Aucun utilisateur VLESS trouvé.');
  }
}

async function showUserList(bot, chatId, prefix) {
  try {
    const result = await runCommand(`ls ${USERS_DB}/ 2>/dev/null | sed 's/.json//'`);
    if (!result) {
      bot.sendMessage(chatId, '📋 Aucun utilisateur trouvé.');
      return;
    }
    const users = result.split('\n');
    const keyboard = users.map(u => [{ text: u, callback_data: `${prefix}${u}` }]);
    keyboard.push([{ text: '🔙 Retour', callback_data: 'menu_vless' }]);
    bot.sendMessage(chatId, '👤 Sélectionnez un utilisateur:', {
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch {
    bot.sendMessage(chatId, '📋 Aucun utilisateur trouvé.');
  }
}

async function showDetail(bot, chatId, username) {
  try {
    const data = await runCommand(`cat ${USERS_DB}/${username}.json`);
    const info = JSON.parse(data);
    const domain = await getDomain();
    bot.sendMessage(chatId,
      `━━━━━━━━━━━━━━━━━━━━━
🔍 *VLESS Detail: ${username}*
━━━━━━━━━━━━━━━━━━━━━
👤 User: \`${username}\`
🔑 UUID: \`${info.uuid}\`
🌐 Domain: \`${domain}\`
📅 Expiry: \`${info.expiry}\`
🔒 Locked: ${info.locked ? 'Oui' : 'Non'}
━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
  }
}

async function toggleLock(bot, chatId, username) {
  try {
    const userFile = `${USERS_DB}/${username}.json`;
    const data = await runCommand(`cat ${userFile}`);
    const info = JSON.parse(data);
    const newLocked = !info.locked;
    await runCommand(`jq '.locked = ${newLocked}' ${userFile} > /tmp/tmp_user.json && mv /tmp/tmp_user.json ${userFile}`);

    if (newLocked) {
      await runCommand(`cd /etc/xray && jq 'del(.inbounds[0].settings.clients[] | select(.email=="${username}"))' config.json > tmp.json && mv tmp.json config.json`);
    } else {
      await runCommand(`cd /etc/xray && jq '.inbounds[0].settings.clients += [{"id":"${info.uuid}","email":"${username}"}]' config.json > tmp.json && mv tmp.json config.json`);
    }
    await runCommand('systemctl restart xray');

    bot.sendMessage(chatId, `✅ VLESS *${username}* ${newLocked ? '🔒 verrouillé' : '🔓 déverrouillé'}`, { parse_mode: 'Markdown' });
  } catch (err) {
    bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
  }
}

module.exports = { showMenu, handleCallback };
