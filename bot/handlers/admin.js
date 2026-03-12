const path = require('path');
const fs = require('fs');
const { readJSON, writeJSON } = require('../utils/helpers');
const { runCommand } = require('../utils/exec');
const { removeClient } = require('../utils/xray');
const config = require('../config');
const audit = require('../utils/audit');

const ADMINS_FILE = path.join(__dirname, '..', 'data', 'admins.json');
const PENDING_FILE = path.join(__dirname, '..', 'data', 'pending_admin_actions.json');

function getAdmins() {
  const data = readJSON(ADMINS_FILE);
  if (!data) {
    const initial = { superAdmin: config.ADMIN_ID, admins: [{ id: config.ADMIN_ID, username: null, addedBy: null, addedAt: new Date().toISOString(), isSuperAdmin: true }] };
    writeJSON(ADMINS_FILE, initial);
    return initial;
  }
  return data;
}

function isAdminUser(userId) { const data = getAdmins(); return data.admins.some((a) => a.id === userId); }
function isSuperAdmin(userId) { return userId === config.ADMIN_ID; }
function getPendingActions() { return readJSON(PENDING_FILE) || []; }
function savePendingActions(actions) { writeJSON(PENDING_FILE, actions); }

function editOrSend(bot, chatId, msgId, text, opts = {}) {
  if (msgId) return bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...opts }).catch(() => bot.sendMessage(chatId, text, opts));
  return bot.sendMessage(chatId, text, opts);
}

function showMenu(bot, chatId, userId, msgId) {
  const data = getAdmins();
  const isSuper = isSuperAdmin(userId);
  const buttons = [
    [{ text: '📋 Liste des admins', callback_data: 'admin_list' }],
    [{ text: '➕ Ajouter un admin', callback_data: 'admin_add' }],
    [{ text: isSuper ? '❌ Supprimer un admin' : '❌ Demander suppression', callback_data: 'admin_remove' }],
    [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
  ];
  editOrSend(bot, chatId, msgId, `━━━━━━━━━━━━━━━━━━━━━\n👥 *GESTION DES ADMINS*\n━━━━━━━━━━━━━━━━━━━━━\nTotal admins: ${data.admins.length}\nVotre rôle: ${isSuper ? '👑 Super Admin' : '🛡️ Admin'}\n━━━━━━━━━━━━━━━━━━━━━`, {
    parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons }
  });
}

async function handleCallback(bot, chatId, data, query, pendingActions) {
  const userId = query.from.id;
  const msgId = query?.message?.message_id;

  if (data === 'admin_list') {
    const adminsData = getAdmins();
    let text = `━━━━━━━━━━━━━━━━━━━━━\n👥 *LISTE DES ADMINS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    for (const admin of adminsData.admins) {
      const role = admin.isSuperAdmin ? '👑 Super Admin' : '🛡️ Admin';
      const username = admin.username ? `@${admin.username}` : 'N/A';
      text += `${role}\n├ ID: \`${admin.id}\`\n├ Username: ${username}\n└ Ajouté le: ${admin.addedAt ? admin.addedAt.split('T')[0] : 'N/A'}\n\n`;
    }
    text += '━━━━━━━━━━━━━━━━━━━━━';
    editOrSend(bot, chatId, msgId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_admin' }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
  }

  if (data === 'admin_add') {
    pendingActions[chatId] = { action: 'admin_add', requesterId: userId, requesterUsername: query.from.username || null, handler: handleAdminAddInput };
    editOrSend(bot, chatId, msgId, `━━━━━━━━━━━━━━━━━━━━━\n➕ *AJOUTER UN ADMIN*\n━━━━━━━━━━━━━━━━━━━━━\nEnvoyez l'ID Telegram ou @username:\n\nExemple: \`123456789\` ou \`@username\`\n━━━━━━━━━━━━━━━━━━━━━`, { parse_mode: 'Markdown' });
  }

  if (data === 'admin_remove') {
    const adminsData = getAdmins();
    const removable = adminsData.admins.filter((a) => !a.isSuperAdmin);
    if (removable.length === 0) return editOrSend(bot, chatId, msgId, '❌ Aucun admin à supprimer.', { reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_admin' }]] } });
    const buttons = removable.map((a) => {
      const label = a.username ? `@${a.username} (${a.id})` : `ID: ${a.id}`;
      return [{ text: `❌ ${label}`, callback_data: `admin_del_${a.id}` }];
    });
    buttons.push([{ text: '🔙 Retour', callback_data: 'menu_admin' }]);
    editOrSend(bot, chatId, msgId, '❌ *Sélectionnez l\'admin à supprimer:*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
  }

  // Super admin direct delete — with 2 options
  if (data.startsWith('admin_del_')) {
    const targetId = parseInt(data.replace('admin_del_', ''));
    if (isSuperAdmin(userId)) {
      editOrSend(bot, chatId, msgId, `⚠️ *Supprimer admin \`${targetId}\`*\n\nChoisissez:`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '🗑 Supprimer l\'admin seulement', callback_data: `admin_delonly_${targetId}` }],
          [{ text: '🗑💥 Supprimer admin + ses actions', callback_data: `admin_delall_${targetId}` }],
          [{ text: '❌ Annuler', callback_data: 'admin_remove' }],
          [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }],
        ] }
      });
    } else {
      const pendingId = `del_${Date.now()}`;
      const pending = getPendingActions();
      pending.push({ id: pendingId, type: 'remove', targetId, requesterId: userId, requesterUsername: query.from.username || null, createdAt: new Date().toISOString() });
      savePendingActions(pending);
      editOrSend(bot, chatId, msgId, '📨 Demande envoyée au Super Admin.');
      const adminsData = getAdmins();
      const targetAdmin = adminsData.admins.find((a) => a.id === targetId);
      const targetLabel = targetAdmin?.username ? `@${targetAdmin.username} (${targetId})` : `ID: ${targetId}`;
      const requesterLabel = query.from.username ? `@${query.from.username} (${userId})` : `ID: ${userId}`;
      bot.sendMessage(config.ADMIN_ID, `━━━━━━━━━━━━━━━━━━━━━\n🔔 *DEMANDE DE SUPPRESSION*\n━━━━━━━━━━━━━━━━━━━━━\n👤 Demandeur: ${requesterLabel}\n🎯 Admin: ${targetLabel}\n━━━━━━━━━━━━━━━━━━━━━`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [
          [{ text: '✅ Approuver', callback_data: `admin_approve_del_${pendingId}` }, { text: '❌ Refuser', callback_data: `admin_reject_del_${pendingId}` }],
        ] }
      });
    }
  }

  // Delete admin only
  if (data.startsWith('admin_delonly_')) {
    if (!isSuperAdmin(userId)) return;
    const targetId = parseInt(data.replace('admin_delonly_', ''));
    removeAdmin(targetId);
    audit.log(userId, 'admin', `Supprimé admin ${targetId}`);
    editOrSend(bot, chatId, msgId, `✅ Admin \`${targetId}\` supprimé.`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_admin' }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
    try { bot.sendMessage(targetId, '⚠️ Vous avez été retiré des administrateurs.'); } catch {}
  }

  // Delete admin + all their created accounts (using xray.js, no jq)
  if (data.startsWith('admin_delall_')) {
    if (!isSuperAdmin(userId)) return;
    const targetId = parseInt(data.replace('admin_delall_', ''));
    editOrSend(bot, chatId, msgId, `🔄 Suppression de l'admin \`${targetId}\` et de toutes ses actions...`, { parse_mode: 'Markdown' });
    
    let deletedCount = 0;
    const protocols = [
      { dir: '/etc/xray/users', proto: 'vless', xray: 'vless' },
      { dir: '/etc/xray/users-vmess', proto: 'vmess', xray: 'vmess' },
      { dir: '/etc/xray/users-trojan', proto: 'trojan', xray: 'trojan' },
      { dir: '/etc/xray/users-socks', proto: 'socks', xray: 'socks' },
      { dir: '/etc/ssh-users', proto: 'ssh' },
      { dir: '/etc/UDPCustom/users', proto: 'udp' },
      { dir: '/etc/zivpn/users', proto: 'zivpn' },
      { dir: '/etc/slowdns/users', proto: 'dns' },
    ];

    for (const p of protocols) {
      try {
        const files = await runCommand(`ls ${p.dir}/ 2>/dev/null`).catch(() => '');
        if (!files) continue;
        for (const file of files.split('\n').filter(Boolean)) {
          try {
            const info = JSON.parse(await runCommand(`cat ${p.dir}/${file}`));
            if (info.createdById === targetId || String(info.createdById) === String(targetId)) {
              const username = file.replace('.json', '');
              // Remove from xray config using xray.js (no jq!)
              if (p.xray) {
                try { await removeClient(p.xray, username); } catch {}
              }
              // Remove from UDP config
              if (p.proto === 'udp' && info.password) {
                try {
                  const udpConfig = JSON.parse(fs.readFileSync('/etc/UDPCustom/config.json', 'utf8'));
                  udpConfig.auth.config = udpConfig.auth.config.filter(pw => pw !== info.password);
                  fs.writeFileSync('/etc/UDPCustom/config.json', JSON.stringify(udpConfig, null, 2), 'utf8');
                } catch {}
              }
              if (p.proto === 'zivpn' && info.password) {
                try {
                  const zivConfig = JSON.parse(fs.readFileSync('/etc/zivpn/config.json', 'utf8'));
                  zivConfig.auth.config = zivConfig.auth.config.filter(pw => pw !== info.password);
                  fs.writeFileSync('/etc/zivpn/config.json', JSON.stringify(zivConfig, null, 2), 'utf8');
                } catch {}
              }
              if (p.proto === 'ssh') {
                await runCommand(`userdel -r ${username} 2>/dev/null || true`);
                await runCommand(`sed -i '/${username}/d' /etc/security/limits.conf 2>/dev/null || true`);
              }
              // Remove user file and limits
              await runCommand(`rm -f ${p.dir}/${file}`);
              await runCommand(`rm -f /etc/xray/limits/${p.proto}_${username}.json /etc/xray/limits/${p.proto}_${username}_conn.json 2>/dev/null || true`);
              deletedCount++;
            }
          } catch {}
        }
      } catch {}
    }

    // Restart services
    await runCommand('systemctl restart xray 2>/dev/null || true');
    await runCommand('systemctl restart udp-custom 2>/dev/null || true');
    await runCommand('systemctl restart zivpn 2>/dev/null || true');

    removeAdmin(targetId);
    audit.log(userId, 'admin', `Supprimé admin ${targetId} + ${deletedCount} comptes créés`);

    editOrSend(bot, chatId, msgId, `✅ Admin \`${targetId}\` supprimé.\n🗑 ${deletedCount} compte(s) créé(s) par cet admin supprimé(s).`, {
      parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_admin' }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] }
    });
    try { bot.sendMessage(targetId, '⚠️ Vous avez été retiré des administrateurs et tous vos comptes créés ont été supprimés.'); } catch {}
  }

  // Approve add
  if (data.startsWith('admin_approve_add_')) {
    if (!isSuperAdmin(userId)) return;
    const pendingId = data.replace('admin_approve_add_', '');
    const pending = getPendingActions();
    const action = pending.find((p) => p.id === pendingId);
    if (!action) return editOrSend(bot, chatId, msgId, '❌ Demande expirée.');
    addAdmin(action.targetId, action.targetUsername, action.requesterId);
    savePendingActions(pending.filter((p) => p.id !== pendingId));
    const label = action.targetUsername ? `@${action.targetUsername} (${action.targetId})` : `ID: ${action.targetId}`;
    editOrSend(bot, chatId, msgId, `✅ Admin ${label} ajouté!`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
    try { bot.sendMessage(action.requesterId, `✅ Demande d'ajout de ${label} *approuvée*.`, { parse_mode: 'Markdown' }); } catch {}
    try { bot.sendMessage(action.targetId, '🎉 Vous êtes maintenant admin du bot DOTYCAT TUNNEL!\nTapez /start'); } catch {}
  }

  // Reject add
  if (data.startsWith('admin_reject_add_')) {
    if (!isSuperAdmin(userId)) return;
    const pendingId = data.replace('admin_reject_add_', '');
    const pending = getPendingActions();
    const action = pending.find((p) => p.id === pendingId);
    if (!action) return editOrSend(bot, chatId, msgId, '❌ Demande expirée.');
    savePendingActions(pending.filter((p) => p.id !== pendingId));
    const label = action.targetUsername ? `@${action.targetUsername}` : `ID: ${action.targetId}`;
    editOrSend(bot, chatId, msgId, `❌ Demande d'ajout de ${label} refusée.`, { reply_markup: { inline_keyboard: [[{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
    try { bot.sendMessage(action.requesterId, `❌ Demande d'ajout de ${label} *refusée*.`, { parse_mode: 'Markdown' }); } catch {}
  }

  // Approve delete — with 2 options
  if (data.startsWith('admin_approve_del_')) {
    if (!isSuperAdmin(userId)) return;
    const pendingId = data.replace('admin_approve_del_', '');
    const pending = getPendingActions();
    const action = pending.find((p) => p.id === pendingId);
    if (!action) return editOrSend(bot, chatId, msgId, '❌ Demande expirée.');
    editOrSend(bot, chatId, msgId, `⚠️ *Approuver suppression de \`${action.targetId}\`*\n\nChoisissez:`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [
        [{ text: '🗑 Supprimer admin seulement', callback_data: `admin_delonly_${action.targetId}` }],
        [{ text: '🗑💥 Supprimer admin + actions', callback_data: `admin_delall_${action.targetId}` }],
        [{ text: '❌ Refuser', callback_data: `admin_reject_del_${pendingId}` }],
      ] }
    });
    savePendingActions(pending.filter((p) => p.id !== pendingId));
    try { bot.sendMessage(action.requesterId, `✅ Demande de suppression de l'admin \`${action.targetId}\` *approuvée*.`, { parse_mode: 'Markdown' }); } catch {}
  }

  // Reject delete
  if (data.startsWith('admin_reject_del_')) {
    if (!isSuperAdmin(userId)) return;
    const pendingId = data.replace('admin_reject_del_', '');
    const pending = getPendingActions();
    const action = pending.find((p) => p.id === pendingId);
    if (!action) return editOrSend(bot, chatId, msgId, '❌ Demande expirée.');
    savePendingActions(pending.filter((p) => p.id !== pendingId));
    editOrSend(bot, chatId, msgId, '❌ Suppression refusée.', { reply_markup: { inline_keyboard: [[{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
    try { bot.sendMessage(action.requesterId, `❌ Demande de suppression *refusée*.`, { parse_mode: 'Markdown' }); } catch {}
  }
}

function handleAdminAddInput(bot, chatId, text, pending, pendingActions) {
  if (text.startsWith('@')) {
    const targetUsername = text.replace('@', '');
    bot.sendMessage(chatId, `⚠️ Pour ajouter @${targetUsername}, envoyez son ID Telegram numérique:`);
    pendingActions[chatId] = { ...pending, action: 'admin_add_id', targetUsername, handler: handleAdminAddIdInput };
    return;
  }
  const targetId = parseInt(text);
  if (isNaN(targetId)) { delete pendingActions[chatId]; return bot.sendMessage(chatId, '❌ ID invalide.', { reply_markup: { inline_keyboard: [[{ text: '🔄 Réessayer', callback_data: 'admin_add' }, { text: '❌ Annuler', callback_data: 'menu_admin' }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } }); }
  processAdminAdd(bot, chatId, targetId, null, pending.requesterId, pending.requesterUsername, pendingActions);
}

function handleAdminAddIdInput(bot, chatId, text, pending, pendingActions) {
  const targetId = parseInt(text);
  if (isNaN(targetId)) { delete pendingActions[chatId]; return bot.sendMessage(chatId, '❌ ID invalide.', { reply_markup: { inline_keyboard: [[{ text: '🔄 Réessayer', callback_data: 'admin_add' }, { text: '❌ Annuler', callback_data: 'menu_admin' }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } }); }
  processAdminAdd(bot, chatId, targetId, pending.targetUsername, pending.requesterId, pending.requesterUsername, pendingActions);
}

function processAdminAdd(bot, chatId, targetId, targetUsername, requesterId, requesterUsername, pendingActions) {
  delete pendingActions[chatId];
  const adminsData = getAdmins();
  if (adminsData.admins.some((a) => a.id === targetId)) return bot.sendMessage(chatId, '❌ Déjà admin.', { reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_admin' }]] } });

  if (isSuperAdmin(requesterId)) {
    addAdmin(targetId, targetUsername, requesterId);
    const label = targetUsername ? `@${targetUsername} (${targetId})` : `ID: ${targetId}`;
    audit.log(requesterId, 'admin', `Ajouté admin ${label}`);
    bot.sendMessage(chatId, `✅ Admin ${label} ajouté!`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_admin' }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] } });
    try { bot.sendMessage(targetId, '🎉 Vous êtes admin du bot DOTYCAT TUNNEL!\nTapez /start'); } catch {}
  } else {
    const pendingId = `add_${Date.now()}`;
    const pending = getPendingActions();
    pending.push({ id: pendingId, type: 'add', targetId, targetUsername, requesterId, requesterUsername, createdAt: new Date().toISOString() });
    savePendingActions(pending);
    bot.sendMessage(chatId, '📨 Demande envoyée au Super Admin.');
    const targetLabel = targetUsername ? `@${targetUsername} (${targetId})` : `ID: ${targetId}`;
    const requesterLabel = requesterUsername ? `@${requesterUsername} (${requesterId})` : `ID: ${requesterId}`;
    bot.sendMessage(config.ADMIN_ID, `━━━━━━━━━━━━━━━━━━━━━\n🔔 *DEMANDE D'AJOUT ADMIN*\n━━━━━━━━━━━━━━━━━━━━━\n👤 Demandeur: ${requesterLabel}\n🎯 Nouvel admin: ${targetLabel}\n━━━━━━━━━━━━━━━━━━━━━`, {
      parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✅ Approuver', callback_data: `admin_approve_add_${pendingId}` }, { text: '❌ Refuser', callback_data: `admin_reject_add_${pendingId}` }]] }
    });
  }
}

function addAdmin(id, username, addedBy) {
  const data = getAdmins();
  data.admins.push({ id, username: username || null, addedBy, addedAt: new Date().toISOString(), isSuperAdmin: false });
  writeJSON(ADMINS_FILE, data);
}

function removeAdmin(id) {
  const data = getAdmins();
  data.admins = data.admins.filter((a) => a.id !== id);
  writeJSON(ADMINS_FILE, data);
}

module.exports = { showMenu, handleCallback, isAdminUser, isSuperAdmin, getAdmins };
