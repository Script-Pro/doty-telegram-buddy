const { runCommand, getDomain } = require('../utils/exec');
const { generateUUID, getExpiryDate } = require('../utils/helpers');

const USERS_DB = '/etc/xray/users-vmess';

function showMenu(bot, chatId) {
  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━\n🔰 *VMESS MENU*\n━━━━━━━━━━━━━━━━━━━━━\nSélectionnez une action:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Créer', callback_data: 'vmess_create' }, { text: '🗑 Supprimer', callback_data: 'vmess_delete' }],
          [{ text: '🔄 Renouveler', callback_data: 'vmess_renew' }, { text: '📋 Liste', callback_data: 'vmess_list' }],
          [{ text: '🔍 Détails', callback_data: 'vmess_detail' }, { text: '🔒 Lock/Unlock', callback_data: 'vmess_lock' }],
          [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
        ],
      },
    }
  );
}

async function handleCallback(bot, chatId, data, query) {
  const { pendingActions } = require('../index');

  switch (data) {
    case 'vmess_create':
      bot.sendMessage(chatId, '📝 Entrez le nom d\'utilisateur pour VMESS:');
      pendingActions[chatId] = { action: 'vmess_create', step: 'username', handler: handleCreateFlow };
      break;
    case 'vmess_delete':
      await showUserList(bot, chatId, 'vmess_del_');
      break;
    case 'vmess_renew':
      await showUserList(bot, chatId, 'vmess_ren_');
      break;
    case 'vmess_list':
      await listUsers(bot, chatId);
      break;
    case 'vmess_detail':
      await showUserList(bot, chatId, 'vmess_det_');
      break;
    case 'vmess_lock':
      await showUserList(bot, chatId, 'vmess_lck_');
      break;
    default:
      if (data.startsWith('vmess_del_')) await deleteUser(bot, chatId, data.replace('vmess_del_', ''));
      else if (data.startsWith('vmess_ren_')) {
        const user = data.replace('vmess_ren_', '');
        bot.sendMessage(chatId, `🔄 Nombre de jours pour renouveler *${user}*:`, { parse_mode: 'Markdown' });
        pendingActions[chatId] = { action: 'vmess_renew', user, handler: handleRenewFlow };
      }
      else if (data.startsWith('vmess_det_')) await showDetail(bot, chatId, data.replace('vmess_det_', ''));
      else if (data.startsWith('vmess_lck_')) await toggleLock(bot, chatId, data.replace('vmess_lck_', ''));
  }
}

async function handleCreateFlow(bot, chatId, text, pending, pendingActions) {
  if (pending.step === 'username') {
    pending.username = text.trim();
    pending.step = 'days';
    bot.sendMessage(chatId, '📅 Durée (en jours):');
  } else if (pending.step === 'days') {
    const days = parseInt(text);
    if (isNaN(days) || days < 1) { bot.sendMessage(chatId, '❌ Invalide.'); delete pendingActions[chatId]; return; }
    delete pendingActions[chatId];
    await createUser(bot, chatId, pending.username, days);
  }
}

async function handleRenewFlow(bot, chatId, text, pending, pendingActions) {
  const days = parseInt(text);
  if (isNaN(days) || days < 1) { bot.sendMessage(chatId, '❌ Invalide.'); delete pendingActions[chatId]; return; }
  delete pendingActions[chatId];
  try {
    const newExpiry = getExpiryDate(days);
    await runCommand(`jq '.expiry = "${newExpiry}"' ${USERS_DB}/${pending.user}.json > /tmp/tmp.json && mv /tmp/tmp.json ${USERS_DB}/${pending.user}.json`);
    bot.sendMessage(chatId, `✅ VMESS *${pending.user}* renouvelé → *${newExpiry}*`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function createUser(bot, chatId, username, days) {
  try {
    const uuid = generateUUID();
    const expiry = getExpiryDate(days);
    const domain = await getDomain();
    await runCommand(`mkdir -p ${USERS_DB}`);

    // Add to Xray config (vmess inbound - usually index 1)
    await runCommand(`cd /etc/xray && jq '.inbounds[1].settings.clients += [{"id":"${uuid}","alterId":0,"email":"${username}"}]' config.json > tmp.json && mv tmp.json config.json`);
    await runCommand(`echo '{"username":"${username}","uuid":"${uuid}","expiry":"${expiry}","protocol":"vmess","locked":false}' > ${USERS_DB}/${username}.json`);
    await runCommand('systemctl restart xray');

    const vmessConfig = Buffer.from(JSON.stringify({
      v: "2", ps: `${username}_WS-TLS`, add: domain, port: "443", id: uuid, aid: "0",
      scy: "auto", net: "ws", type: "none", host: domain, path: "/vmess",
      tls: "tls", sni: domain, alpn: ""
    })).toString('base64');

    const vmessNtls = Buffer.from(JSON.stringify({
      v: "2", ps: `${username}_WS-NTLS`, add: domain, port: "80", id: uuid, aid: "0",
      scy: "auto", net: "ws", type: "none", host: domain, path: "/vmess",
      tls: "", sni: "", alpn: ""
    })).toString('base64');

    const grpcConfig = Buffer.from(JSON.stringify({
      v: "2", ps: `${username}_gRPC`, add: domain, port: "443", id: uuid, aid: "0",
      scy: "auto", net: "grpc", type: "gun", host: "", path: "vmess-grpc",
      tls: "tls", sni: domain, alpn: ""
    })).toString('base64');

    bot.sendMessage(chatId,
      `━━━━━━━━━━━━━━━━━━━━━\n✅ *VMESS Account Created*\n━━━━━━━━━━━━━━━━━━━━━\n👤 User: \`${username}\`\n🔑 UUID: \`${uuid}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${expiry}\`\n━━━━━━━━━━━━━━━━━━━━━\n🔗 *WS TLS:*\n\`vmess://${vmessConfig}\`\n\n🔗 *WS Non-TLS:*\n\`vmess://${vmessNtls}\`\n\n🔗 *gRPC:*\n\`vmess://${grpcConfig}\`\n━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function deleteUser(bot, chatId, username) {
  try {
    await runCommand(`cd /etc/xray && jq 'del(.inbounds[1].settings.clients[] | select(.email=="${username}"))' config.json > tmp.json && mv tmp.json config.json`);
    await runCommand(`rm -f ${USERS_DB}/${username}.json`);
    await runCommand('systemctl restart xray');
    bot.sendMessage(chatId, `✅ VMESS *${username}* supprimé.`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function listUsers(bot, chatId) {
  try {
    const result = await runCommand(`ls ${USERS_DB}/ 2>/dev/null | sed 's/.json//'`);
    if (!result) { bot.sendMessage(chatId, '📋 Aucun utilisateur VMESS.'); return; }
    let text = '━━━━━━━━━━━━━━━━━━━━━\n📋 *VMESS Users*\n━━━━━━━━━━━━━━━━━━━━━\n';
    for (const u of result.split('\n')) {
      try { const d = JSON.parse(await runCommand(`cat ${USERS_DB}/${u}.json`)); text += `👤 ${u} | 📅 ${d.expiry} | ${d.locked ? '🔒' : '🔓'}\n`; }
      catch { text += `👤 ${u}\n`; }
    }
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch { bot.sendMessage(chatId, '📋 Aucun utilisateur VMESS.'); }
}

async function showUserList(bot, chatId, prefix) {
  try {
    const result = await runCommand(`ls ${USERS_DB}/ 2>/dev/null | sed 's/.json//'`);
    if (!result) { bot.sendMessage(chatId, '📋 Aucun utilisateur.'); return; }
    const kb = result.split('\n').map(u => [{ text: u, callback_data: `${prefix}${u}` }]);
    kb.push([{ text: '🔙 Retour', callback_data: 'menu_vmess' }]);
    bot.sendMessage(chatId, '👤 Sélectionnez:', { reply_markup: { inline_keyboard: kb } });
  } catch { bot.sendMessage(chatId, '📋 Aucun utilisateur.'); }
}

async function showDetail(bot, chatId, username) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`));
    const domain = await getDomain();
    bot.sendMessage(chatId, `━━━━━━━━━━━━━━━━━━━━━\n🔍 *VMESS: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n🔑 UUID: \`${info.uuid}\`\n🌐 Domain: \`${domain}\`\n📅 Expiry: \`${info.expiry}\`\n🔒 Locked: ${info.locked ? 'Oui' : 'Non'}\n━━━━━━━━━━━━━━━━━━━━━`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

async function toggleLock(bot, chatId, username) {
  try {
    const info = JSON.parse(await runCommand(`cat ${USERS_DB}/${username}.json`));
    const newLocked = !info.locked;
    await runCommand(`jq '.locked = ${newLocked}' ${USERS_DB}/${username}.json > /tmp/tmp.json && mv /tmp/tmp.json ${USERS_DB}/${username}.json`);
    if (newLocked) await runCommand(`cd /etc/xray && jq 'del(.inbounds[1].settings.clients[] | select(.email=="${username}"))' config.json > tmp.json && mv tmp.json config.json`);
    else await runCommand(`cd /etc/xray && jq '.inbounds[1].settings.clients += [{"id":"${info.uuid}","alterId":0,"email":"${username}"}]' config.json > tmp.json && mv tmp.json config.json`);
    await runCommand('systemctl restart xray');
    bot.sendMessage(chatId, `✅ VMESS *${username}* ${newLocked ? '🔒' : '🔓'}`, { parse_mode: 'Markdown' });
  } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
}

module.exports = { showMenu, handleCallback };
