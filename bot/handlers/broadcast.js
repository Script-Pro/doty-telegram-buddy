const config = require('../config');
const adminHandler = require('./admin');

function showMenu(bot, chatId) {
  const buttons = [
    [{ text: '📢 Message à tous les admins', callback_data: 'broadcast_all' }],
    [{ text: '📨 Message à un admin', callback_data: 'broadcast_one' }],
    [{ text: '📋 Historique broadcasts', callback_data: 'broadcast_history' }],
    [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
  ];

  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━
📢 *BROADCAST*
━━━━━━━━━━━━━━━━━━━━━
Envoyez des messages à vos admins:
━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
  );
}

const { readJSON, writeJSON } = require('../utils/helpers');
const path = require('path');
const BROADCAST_LOG = path.join(__dirname, '..', 'data', 'broadcasts.json');

function getBroadcasts() {
  return readJSON(BROADCAST_LOG) || [];
}

function saveBroadcast(entry) {
  const logs = getBroadcasts();
  logs.push(entry);
  if (logs.length > 50) logs.shift(); // Keep last 50
  writeJSON(BROADCAST_LOG, logs);
}

async function handleCallback(bot, chatId, data, query, pendingActions) {
  if (data === 'broadcast_all') {
    pendingActions[chatId] = {
      action: 'broadcast_all_msg',
      senderId: query.from.id,
      senderUsername: query.from.username,
      handler: async (bot, cid, text, pending, pa) => {
        delete pa[cid];

        const adminsData = adminHandler.getAdmins();
        let sent = 0;
        let failed = 0;

        for (const admin of adminsData.admins) {
          if (admin.id === pending.senderId) continue; // Don't send to self
          try {
            const senderLabel = pending.senderUsername ? `@${pending.senderUsername}` : `ID: ${pending.senderId}`;
            await bot.sendMessage(admin.id,
              `━━━━━━━━━━━━━━━━━━━━━
📢 *MESSAGE BROADCAST*
━━━━━━━━━━━━━━━━━━━━━
De: ${senderLabel}

${text}
━━━━━━━━━━━━━━━━━━━━━`,
              { parse_mode: 'Markdown' }
            );
            sent++;
          } catch {
            failed++;
          }
        }

        saveBroadcast({
          type: 'all',
          senderId: pending.senderId,
          message: text,
          sent,
          failed,
          date: new Date().toISOString(),
        });

        bot.sendMessage(cid, `✅ Broadcast envoyé!\n📨 Envoyés: ${sent}\n❌ Échoués: ${failed}`, {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_broadcast' }]] },
        });
      },
    };
    bot.sendMessage(chatId, '📢 Écrivez le message à envoyer à tous les admins:');
  }

  if (data === 'broadcast_one') {
    const adminsData = adminHandler.getAdmins();
    const buttons = adminsData.admins
      .filter(a => a.id !== query.from.id)
      .map(a => {
        const label = a.username ? `@${a.username} (${a.id})` : `ID: ${a.id}`;
        return [{ text: label, callback_data: `broadcast_to_${a.id}` }];
      });

    if (buttons.length === 0) {
      return bot.sendMessage(chatId, '❌ Aucun autre admin à contacter.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_broadcast' }]] },
      });
    }

    buttons.push([{ text: '🔙 Retour', callback_data: 'menu_broadcast' }]);
    bot.sendMessage(chatId, '📨 *Sélectionnez le destinataire:*', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  if (data.startsWith('broadcast_to_')) {
    const targetId = parseInt(data.replace('broadcast_to_', ''));
    pendingActions[chatId] = {
      action: 'broadcast_one_msg',
      targetId,
      senderId: query.from.id,
      senderUsername: query.from.username,
      handler: async (bot, cid, text, pending, pa) => {
        delete pa[cid];
        try {
          const senderLabel = pending.senderUsername ? `@${pending.senderUsername}` : `ID: ${pending.senderId}`;
          await bot.sendMessage(pending.targetId,
            `━━━━━━━━━━━━━━━━━━━━━
📨 *MESSAGE PRIVÉ*
━━━━━━━━━━━━━━━━━━━━━
De: ${senderLabel}

${text}
━━━━━━━━━━━━━━━━━━━━━`,
            { parse_mode: 'Markdown' }
          );

          saveBroadcast({
            type: 'private',
            senderId: pending.senderId,
            targetId: pending.targetId,
            message: text,
            date: new Date().toISOString(),
          });

          bot.sendMessage(cid, `✅ Message envoyé à \`${pending.targetId}\`!`, { parse_mode: 'Markdown' });
        } catch (err) {
          bot.sendMessage(cid, `❌ Erreur d'envoi: ${err.message}`);
        }
      },
    };
    bot.sendMessage(chatId, `📨 Écrivez le message à envoyer à \`${targetId}\`:`, { parse_mode: 'Markdown' });
  }

  if (data === 'broadcast_history') {
    const logs = getBroadcasts();
    if (logs.length === 0) {
      return bot.sendMessage(chatId, '📋 Aucun broadcast envoyé.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_broadcast' }]] },
      });
    }

    let text = `━━━━━━━━━━━━━━━━━━━━━\n📋 *HISTORIQUE BROADCASTS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    const recent = logs.slice(-10).reverse();
    recent.forEach(log => {
      const date = log.date.split('T')[0];
      const type = log.type === 'all' ? '📢 Tous' : `📨 → ${log.targetId}`;
      text += `${date} | ${type}\n`;
      text += `└ "${log.message.substring(0, 50)}${log.message.length > 50 ? '...' : ''}"\n\n`;
    });

    text += '━━━━━━━━━━━━━━━━━━━━━';
    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_broadcast' }]] },
    });
  }
}

module.exports = { showMenu, handleCallback };
