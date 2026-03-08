const auditUtil = require('../utils/audit');
const adminHandler = require('./admin');
const fs = require('fs');
const path = require('path');

function showMenu(bot, chatId) {
  const buttons = [
    [{ text: '📋 Dernières actions', callback_data: 'audit_recent' }],
    [{ text: '👤 Filtrer par admin', callback_data: 'audit_by_admin' }],
    [{ text: '📂 Filtrer par catégorie', callback_data: 'audit_by_category' }],
    [{ text: '📅 Filtrer par date', callback_data: 'audit_by_date' }],
    [{ text: '📥 Exporter le log', callback_data: 'audit_export' }],
    [{ text: '🗑️ Purger les logs', callback_data: 'audit_purge' }],
    [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
  ];

  const totalLogs = auditUtil.getLog().length;

  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━
📋 *JOURNAL D'AUDIT*
━━━━━━━━━━━━━━━━━━━━━
Total entrées: ${totalLogs}
━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
  );
}

async function handleCallback(bot, chatId, data, query, pendingActions) {
  if (data === 'audit_recent') {
    const logs = auditUtil.getFiltered({ limit: 20 });
    if (logs.length === 0) {
      return bot.sendMessage(chatId, '📋 Aucune entrée dans le journal.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_audit' }]] },
      });
    }

    let text = `━━━━━━━━━━━━━━━━━━━━━\n📋 *20 DERNIÈRES ACTIONS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    logs.forEach(l => {
      const date = l.timestamp.split('T')[0];
      const time = l.timestamp.split('T')[1]?.substring(0, 5) || '';
      text += `\`${date} ${time}\` | 👤${l.userId}\n`;
      text += `└ [${l.category}] ${l.action}\n\n`;
    });
    text += '━━━━━━━━━━━━━━━━━━━━━';

    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_audit' }]] },
    });
  }

  if (data === 'audit_by_admin') {
    const adminsData = adminHandler.getAdmins();
    const buttons = adminsData.admins.map(a => {
      const label = a.username ? `@${a.username}` : `ID: ${a.id}`;
      return [{ text: label, callback_data: `audit_admin_${a.id}` }];
    });
    buttons.push([{ text: '🔙 Retour', callback_data: 'menu_audit' }]);

    bot.sendMessage(chatId, '👤 *Sélectionnez un admin:*', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  if (data.startsWith('audit_admin_')) {
    const adminId = parseInt(data.replace('audit_admin_', ''));
    const logs = auditUtil.getFiltered({ userId: adminId, limit: 20 });

    if (logs.length === 0) {
      return bot.sendMessage(chatId, `📋 Aucune action pour cet admin.`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_audit' }]] },
      });
    }

    let text = `━━━━━━━━━━━━━━━━━━━━━\n👤 *ACTIONS DE ${adminId}*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    logs.forEach(l => {
      const date = l.timestamp.split('T')[0];
      text += `\`${date}\` [${l.category}] ${l.action}\n`;
    });
    text += '\n━━━━━━━━━━━━━━━━━━━━━';

    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_audit' }]] },
    });
  }

  if (data === 'audit_by_category') {
    const categories = ['vless', 'vmess', 'trojan', 'ssh', 'socks', 'admin', 'firewall', 'trial', 'domain', 'backup'];
    const buttons = categories.map(c => [{ text: `📂 ${c.toUpperCase()}`, callback_data: `audit_cat_${c}` }]);
    buttons.push([{ text: '🔙 Retour', callback_data: 'menu_audit' }]);

    bot.sendMessage(chatId, '📂 *Sélectionnez une catégorie:*', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  if (data.startsWith('audit_cat_')) {
    const category = data.replace('audit_cat_', '');
    const logs = auditUtil.getFiltered({ category, limit: 20 });

    if (logs.length === 0) {
      return bot.sendMessage(chatId, `📋 Aucune action dans la catégorie ${category}.`, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_audit' }]] },
      });
    }

    let text = `━━━━━━━━━━━━━━━━━━━━━\n📂 *CATÉGORIE: ${category.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    logs.forEach(l => {
      const date = l.timestamp.split('T')[0];
      text += `\`${date}\` 👤${l.userId} | ${l.action}\n`;
    });
    text += '\n━━━━━━━━━━━━━━━━━━━━━';

    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_audit' }]] },
    });
  }

  if (data === 'audit_by_date') {
    pendingActions[chatId] = {
      action: 'audit_filter_date',
      handler: (bot, cid, text, pending, pa) => {
        delete pa[cid];
        const date = text.trim();
        // Accept YYYY-MM-DD format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return bot.sendMessage(cid, '❌ Format invalide. Utilisez YYYY-MM-DD (ex: 2025-01-15)');
        }

        const logs = auditUtil.getFiltered({ fromDate: `${date}T00:00:00`, toDate: `${date}T23:59:59`, limit: 50 });

        if (logs.length === 0) {
          return bot.sendMessage(cid, `📋 Aucune action le ${date}.`, {
            reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_audit' }]] },
          });
        }

        let msg = `━━━━━━━━━━━━━━━━━━━━━\n📅 *ACTIONS DU ${date}*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
        logs.forEach(l => {
          const time = l.timestamp.split('T')[1]?.substring(0, 5) || '';
          msg += `\`${time}\` 👤${l.userId} [${l.category}] ${l.action}\n`;
        });
        msg += '\n━━━━━━━━━━━━━━━━━━━━━';

        bot.sendMessage(cid, msg, {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_audit' }]] },
        });
      },
    };
    bot.sendMessage(chatId, '📅 Entrez la date (format YYYY-MM-DD):\nEx: `2025-01-15`', { parse_mode: 'Markdown' });
  }

  if (data === 'audit_export') {
    try {
      const text = auditUtil.exportAsText();
      const filePath = path.join(__dirname, '..', 'data', 'audit_export.txt');
      fs.writeFileSync(filePath, text, 'utf8');
      await bot.sendDocument(chatId, filePath, { caption: '📥 Export du journal d\'audit' });
      try { fs.unlinkSync(filePath); } catch {}
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
    }
  }

  if (data === 'audit_purge') {
    const { isSuperAdmin } = adminHandler;
    if (!isSuperAdmin(query.from.id)) {
      return bot.sendMessage(chatId, '⛔ Seul le Super Admin peut purger les logs.');
    }

    bot.sendMessage(chatId, '⚠️ *Êtes-vous sûr de vouloir purger tous les logs?*', {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Confirmer', callback_data: 'audit_purge_confirm' },
            { text: '❌ Annuler', callback_data: 'menu_audit' },
          ],
        ],
      },
    });
  }

  if (data === 'audit_purge_confirm') {
    const { writeJSON } = require('../utils/helpers');
    writeJSON(path.join(__dirname, '..', 'data', 'audit_log.json'), []);
    bot.sendMessage(chatId, '✅ Journal d\'audit purgé.', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_audit' }]] },
    });
  }
}

module.exports = { showMenu, handleCallback };
