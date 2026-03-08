const path = require('path');
const { readJSON, writeJSON } = require('../utils/helpers');
const config = require('../config');

const ADMINS_FILE = path.join(__dirname, '..', 'data', 'admins.json');
const PENDING_FILE = path.join(__dirname, '..', 'data', 'pending_admin_actions.json');

/**
 * Get all admins list
 */
function getAdmins() {
  const data = readJSON(ADMINS_FILE);
  if (!data) {
    // Initialize with super admin
    const initial = {
      superAdmin: config.ADMIN_ID,
      admins: [
        {
          id: config.ADMIN_ID,
          username: null,
          addedBy: null,
          addedAt: new Date().toISOString(),
          isSuperAdmin: true,
        },
      ],
    };
    writeJSON(ADMINS_FILE, initial);
    return initial;
  }
  return data;
}

/**
 * Check if user is any admin (super or sub)
 */
function isAdminUser(userId) {
  const data = getAdmins();
  return data.admins.some((a) => a.id === userId);
}

/**
 * Check if user is super admin
 */
function isSuperAdmin(userId) {
  return userId === config.ADMIN_ID;
}

/**
 * Get pending actions
 */
function getPendingActions() {
  return readJSON(PENDING_FILE) || [];
}

function savePendingActions(actions) {
  writeJSON(PENDING_FILE, actions);
}

/**
 * Show admin management menu
 */
function showMenu(bot, chatId, userId) {
  const data = getAdmins();
  const isSuper = isSuperAdmin(userId);

  const buttons = [
    [{ text: '📋 Liste des admins', callback_data: 'admin_list' }],
    [{ text: '➕ Ajouter un admin', callback_data: 'admin_add' }],
  ];

  if (isSuper) {
    buttons.push([{ text: '❌ Supprimer un admin', callback_data: 'admin_remove' }]);
  } else {
    buttons.push([{ text: '❌ Demander suppression admin', callback_data: 'admin_remove' }]);
  }

  buttons.push([{ text: '🔙 Menu Principal', callback_data: 'back_main' }]);

  bot.sendMessage(
    chatId,
    `━━━━━━━━━━━━━━━━━━━━━
👥 *GESTION DES ADMINS*
━━━━━━━━━━━━━━━━━━━━━
Total admins: ${data.admins.length}
Votre rôle: ${isSuper ? '👑 Super Admin' : '🛡️ Admin'}
━━━━━━━━━━━━━━━━━━━━━`,
    {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    }
  );
}

/**
 * Handle callback actions
 */
async function handleCallback(bot, chatId, data, query, pendingActions) {
  const userId = query.from.id;

  if (data === 'admin_list') {
    const adminsData = getAdmins();
    let text = `━━━━━━━━━━━━━━━━━━━━━\n👥 *LISTE DES ADMINS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const admin of adminsData.admins) {
      const role = admin.isSuperAdmin ? '👑 Super Admin' : '🛡️ Admin';
      const username = admin.username ? `@${admin.username}` : 'N/A';
      text += `${role}\n`;
      text += `├ ID: \`${admin.id}\`\n`;
      text += `├ Username: ${username}\n`;
      text += `└ Ajouté le: ${admin.addedAt ? admin.addedAt.split('T')[0] : 'N/A'}\n\n`;
    }

    text += `━━━━━━━━━━━━━━━━━━━━━`;

    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_admin' }]],
      },
    });
  }

  if (data === 'admin_add') {
    pendingActions[chatId] = {
      action: 'admin_add',
      requesterId: userId,
      requesterUsername: query.from.username || null,
      handler: handleAdminAddInput,
    };

    bot.sendMessage(
      chatId,
      `━━━━━━━━━━━━━━━━━━━━━
➕ *AJOUTER UN ADMIN*
━━━━━━━━━━━━━━━━━━━━━
Envoyez l'ID Telegram ou @username de la personne à ajouter:

Exemple: \`123456789\` ou \`@username\`
━━━━━━━━━━━━━━━━━━━━━`,
      { parse_mode: 'Markdown' }
    );
  }

  if (data === 'admin_remove') {
    const adminsData = getAdmins();
    const removable = adminsData.admins.filter((a) => !a.isSuperAdmin);

    if (removable.length === 0) {
      return bot.sendMessage(chatId, '❌ Aucun admin à supprimer (vous êtes le seul).', {
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_admin' }]],
        },
      });
    }

    const buttons = removable.map((a) => {
      const label = a.username ? `@${a.username} (${a.id})` : `ID: ${a.id}`;
      return [{ text: `❌ ${label}`, callback_data: `admin_del_${a.id}` }];
    });
    buttons.push([{ text: '🔙 Retour', callback_data: 'menu_admin' }]);

    bot.sendMessage(chatId, '❌ *Sélectionnez l\'admin à supprimer:*', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  // Handle delete confirmation/request
  if (data.startsWith('admin_del_')) {
    const targetId = parseInt(data.replace('admin_del_', ''));

    if (isSuperAdmin(userId)) {
      // Super admin can delete directly
      removeAdmin(targetId);
      bot.sendMessage(chatId, `✅ Admin \`${targetId}\` supprimé avec succès.`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_admin' }]],
        },
      });

      // Notify the removed admin
      try {
        bot.sendMessage(targetId, '⚠️ Vous avez été retiré de la liste des administrateurs par le Super Admin.');
      } catch (e) {}
    } else {
      // Sub-admin: send approval request to super admin
      const pendingId = `del_${Date.now()}`;
      const pending = getPendingActions();
      pending.push({
        id: pendingId,
        type: 'remove',
        targetId: targetId,
        requesterId: userId,
        requesterUsername: query.from.username || null,
        createdAt: new Date().toISOString(),
      });
      savePendingActions(pending);

      bot.sendMessage(chatId, '📨 Demande de suppression envoyée au Super Admin. En attente d\'approbation...');

      // Notify super admin
      const adminsData = getAdmins();
      const targetAdmin = adminsData.admins.find((a) => a.id === targetId);
      const targetLabel = targetAdmin?.username ? `@${targetAdmin.username} (${targetId})` : `ID: ${targetId}`;
      const requesterLabel = query.from.username ? `@${query.from.username} (${userId})` : `ID: ${userId}`;

      bot.sendMessage(
        config.ADMIN_ID,
        `━━━━━━━━━━━━━━━━━━━━━
🔔 *DEMANDE DE SUPPRESSION*
━━━━━━━━━━━━━━━━━━━━━
👤 Demandeur: ${requesterLabel}
🎯 Admin à supprimer: ${targetLabel}
━━━━━━━━━━━━━━━━━━━━━
Voulez-vous approuver?`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approuver', callback_data: `admin_approve_del_${pendingId}` },
                { text: '❌ Refuser', callback_data: `admin_reject_del_${pendingId}` },
              ],
            ],
          },
        }
      );
    }
  }

  // Super admin approves adding
  if (data.startsWith('admin_approve_add_')) {
    if (!isSuperAdmin(userId)) return;
    const pendingId = data.replace('admin_approve_add_', '');
    const pending = getPendingActions();
    const action = pending.find((p) => p.id === pendingId);

    if (!action) {
      return bot.sendMessage(chatId, '❌ Cette demande n\'existe plus.');
    }

    // Add the admin
    addAdmin(action.targetId, action.targetUsername, action.requesterId);

    // Remove from pending
    const updated = pending.filter((p) => p.id !== pendingId);
    savePendingActions(updated);

    const targetLabel = action.targetUsername ? `@${action.targetUsername} (${action.targetId})` : `ID: ${action.targetId}`;
    bot.sendMessage(chatId, `✅ Admin ${targetLabel} ajouté avec succès!`, { parse_mode: 'Markdown' });

    // Notify requester
    try {
      bot.sendMessage(
        action.requesterId,
        `✅ Votre demande d'ajout de ${targetLabel} comme admin a été *approuvée* par le Super Admin.`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {}

    // Notify new admin
    try {
      bot.sendMessage(
        action.targetId,
        `🎉 Vous avez été ajouté comme administrateur du bot DOTYCAT TUNNEL!\nTapez /start pour commencer.`
      );
    } catch (e) {}
  }

  // Super admin rejects adding
  if (data.startsWith('admin_reject_add_')) {
    if (!isSuperAdmin(userId)) return;
    const pendingId = data.replace('admin_reject_add_', '');
    const pending = getPendingActions();
    const action = pending.find((p) => p.id === pendingId);

    if (!action) {
      return bot.sendMessage(chatId, '❌ Cette demande n\'existe plus.');
    }

    const updated = pending.filter((p) => p.id !== pendingId);
    savePendingActions(updated);

    const targetLabel = action.targetUsername ? `@${action.targetUsername} (${action.targetId})` : `ID: ${action.targetId}`;
    bot.sendMessage(chatId, `❌ Demande d'ajout de ${targetLabel} refusée.`);

    // Notify requester
    try {
      bot.sendMessage(
        action.requesterId,
        `❌ Votre demande d'ajout de ${targetLabel} comme admin a été *refusée* par le Super Admin.`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {}
  }

  // Super admin approves deletion
  if (data.startsWith('admin_approve_del_')) {
    if (!isSuperAdmin(userId)) return;
    const pendingId = data.replace('admin_approve_del_', '');
    const pending = getPendingActions();
    const action = pending.find((p) => p.id === pendingId);

    if (!action) {
      return bot.sendMessage(chatId, '❌ Cette demande n\'existe plus.');
    }

    removeAdmin(action.targetId);
    const updated = pending.filter((p) => p.id !== pendingId);
    savePendingActions(updated);

    bot.sendMessage(chatId, `✅ Admin \`${action.targetId}\` supprimé avec succès.`, { parse_mode: 'Markdown' });

    // Notify requester
    try {
      bot.sendMessage(action.requesterId, `✅ Votre demande de suppression de l'admin \`${action.targetId}\` a été *approuvée*.`, { parse_mode: 'Markdown' });
    } catch (e) {}

    // Notify removed admin
    try {
      bot.sendMessage(action.targetId, '⚠️ Vous avez été retiré de la liste des administrateurs.');
    } catch (e) {}
  }

  // Super admin rejects deletion
  if (data.startsWith('admin_reject_del_')) {
    if (!isSuperAdmin(userId)) return;
    const pendingId = data.replace('admin_reject_del_', '');
    const pending = getPendingActions();
    const action = pending.find((p) => p.id === pendingId);

    if (!action) {
      return bot.sendMessage(chatId, '❌ Cette demande n\'existe plus.');
    }

    const updated = pending.filter((p) => p.id !== pendingId);
    savePendingActions(updated);

    bot.sendMessage(chatId, `❌ Demande de suppression refusée.`);

    try {
      bot.sendMessage(action.requesterId, `❌ Votre demande de suppression de l'admin \`${action.targetId}\` a été *refusée*.`, { parse_mode: 'Markdown' });
    } catch (e) {}
  }
}

/**
 * Handle text input for adding admin
 */
function handleAdminAddInput(bot, chatId, text, pending, pendingActions) {
  let targetId = null;
  let targetUsername = null;

  if (text.startsWith('@')) {
    targetUsername = text.replace('@', '');
    // We can't resolve username to ID directly, so ask for ID
    bot.sendMessage(
      chatId,
      `⚠️ Pour ajouter @${targetUsername}, veuillez aussi fournir son ID Telegram numérique.\n(L'utilisateur peut obtenir son ID en utilisant @userinfobot)\n\nEnvoyez l'ID numérique:`
    );
    pendingActions[chatId] = {
      ...pending,
      action: 'admin_add_id',
      targetUsername: targetUsername,
      handler: handleAdminAddIdInput,
    };
    return;
  }

  targetId = parseInt(text);
  if (isNaN(targetId)) {
    delete pendingActions[chatId];
    return bot.sendMessage(chatId, '❌ ID invalide. Opération annulée.');
  }

  processAdminAdd(bot, chatId, targetId, null, pending.requesterId, pending.requesterUsername, pendingActions);
}

function handleAdminAddIdInput(bot, chatId, text, pending, pendingActions) {
  const targetId = parseInt(text);
  if (isNaN(targetId)) {
    delete pendingActions[chatId];
    return bot.sendMessage(chatId, '❌ ID invalide. Opération annulée.');
  }

  processAdminAdd(bot, chatId, targetId, pending.targetUsername, pending.requesterId, pending.requesterUsername, pendingActions);
}

function processAdminAdd(bot, chatId, targetId, targetUsername, requesterId, requesterUsername, pendingActions) {
  delete pendingActions[chatId];

  // Check if already admin
  const adminsData = getAdmins();
  if (adminsData.admins.some((a) => a.id === targetId)) {
    return bot.sendMessage(chatId, '❌ Cette personne est déjà admin.');
  }

  if (isSuperAdmin(requesterId)) {
    // Super admin adds directly
    addAdmin(targetId, targetUsername, requesterId);
    const label = targetUsername ? `@${targetUsername} (${targetId})` : `ID: ${targetId}`;
    bot.sendMessage(chatId, `✅ Admin ${label} ajouté avec succès!`);

    // Notify new admin
    try {
      bot.sendMessage(targetId, `🎉 Vous avez été ajouté comme administrateur du bot DOTYCAT TUNNEL!\nTapez /start pour commencer.`);
    } catch (e) {}
  } else {
    // Sub-admin: send approval to super admin
    const pendingId = `add_${Date.now()}`;
    const pending = getPendingActions();
    pending.push({
      id: pendingId,
      type: 'add',
      targetId: targetId,
      targetUsername: targetUsername,
      requesterId: requesterId,
      requesterUsername: requesterUsername,
      createdAt: new Date().toISOString(),
    });
    savePendingActions(pending);

    bot.sendMessage(chatId, '📨 Demande d\'ajout envoyée au Super Admin. En attente d\'approbation...');

    const targetLabel = targetUsername ? `@${targetUsername} (${targetId})` : `ID: ${targetId}`;
    const requesterLabel = requesterUsername ? `@${requesterUsername} (${requesterId})` : `ID: ${requesterId}`;

    bot.sendMessage(
      config.ADMIN_ID,
      `━━━━━━━━━━━━━━━━━━━━━
🔔 *DEMANDE D'AJOUT ADMIN*
━━━━━━━━━━━━━━━━━━━━━
👤 Demandeur: ${requesterLabel}
🎯 Nouvel admin: ${targetLabel}
━━━━━━━━━━━━━━━━━━━━━
Voulez-vous approuver?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approuver', callback_data: `admin_approve_add_${pendingId}` },
              { text: '❌ Refuser', callback_data: `admin_reject_add_${pendingId}` },
            ],
          ],
        },
      }
    );
  }
}

/**
 * Add admin to file
 */
function addAdmin(id, username, addedBy) {
  const data = getAdmins();
  data.admins.push({
    id: id,
    username: username || null,
    addedBy: addedBy,
    addedAt: new Date().toISOString(),
    isSuperAdmin: false,
  });
  writeJSON(ADMINS_FILE, data);
}

/**
 * Remove admin from file
 */
function removeAdmin(id) {
  const data = getAdmins();
  data.admins = data.admins.filter((a) => a.id !== id);
  writeJSON(ADMINS_FILE, data);
}

module.exports = { showMenu, handleCallback, isAdminUser, isSuperAdmin, getAdmins };
