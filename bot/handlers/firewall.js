const { runCommand } = require('../utils/exec');

function showMenu(bot, chatId) {
  const buttons = [
    [{ text: '📋 Règles actives', callback_data: 'fw_list' }],
    [{ text: '🚫 Bloquer une IP', callback_data: 'fw_block' }],
    [{ text: '✅ Débloquer une IP', callback_data: 'fw_unblock' }],
    [{ text: '⏰ Bannir temporaire', callback_data: 'fw_tempban' }],
    [{ text: '📋 IPs bannies', callback_data: 'fw_banned' }],
    [{ text: '🛡️ Rate limiting', callback_data: 'fw_ratelimit' }],
    [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
  ];

  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━
🔐 *FIREWALL*
━━━━━━━━━━━━━━━━━━━━━
Gérez le pare-feu du serveur:
━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
  );
}

async function handleCallback(bot, chatId, data, query, pendingActions) {
  if (data === 'fw_list') {
    try {
      let rules;
      try {
        rules = await runCommand('iptables -L INPUT -n --line-numbers 2>/dev/null | head -30');
      } catch {
        rules = await runCommand('ufw status numbered 2>/dev/null || echo "iptables/ufw non disponible"');
      }

      bot.sendMessage(chatId,
        `━━━━━━━━━━━━━━━━━━━━━
📋 *RÈGLES FIREWALL*
━━━━━━━━━━━━━━━━━━━━━
\`\`\`
${rules.substring(0, 3000)}
\`\`\`
━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_firewall' }]] } }
      );
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
    }
  }

  if (data === 'fw_block') {
    pendingActions[chatId] = {
      action: 'fw_block_ip',
      handler: async (bot, cid, text, pending, pa) => {
        delete pa[cid];
        const ip = text.trim();
        if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\/\d{1,2})?$/.test(ip)) {
          return bot.sendMessage(cid, '❌ IP invalide. Format: x.x.x.x ou x.x.x.x/xx');
        }
        try {
          await runCommand(`iptables -I INPUT -s ${ip} -j DROP`);
          await runCommand(`iptables-save > /etc/iptables.rules 2>/dev/null`);
          const audit = require('../utils/audit');
          audit.log(query.from.id, 'firewall', `Blocked IP: ${ip}`);
          bot.sendMessage(cid, `✅ IP \`${ip}\` bloquée avec succès.`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_firewall' }]] },
          });
        } catch (err) {
          bot.sendMessage(cid, `❌ Erreur: ${err.message}`);
        }
      },
    };
    bot.sendMessage(chatId, '🚫 Entrez l\'IP à bloquer (ex: 192.168.1.100 ou 10.0.0.0/8):');
  }

  if (data === 'fw_unblock') {
    pendingActions[chatId] = {
      action: 'fw_unblock_ip',
      handler: async (bot, cid, text, pending, pa) => {
        delete pa[cid];
        const ip = text.trim();
        try {
          await runCommand(`iptables -D INPUT -s ${ip} -j DROP 2>/dev/null`);
          await runCommand(`iptables-save > /etc/iptables.rules 2>/dev/null`);
          const audit = require('../utils/audit');
          audit.log(query.from.id, 'firewall', `Unblocked IP: ${ip}`);
          bot.sendMessage(cid, `✅ IP \`${ip}\` débloquée.`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_firewall' }]] },
          });
        } catch (err) {
          bot.sendMessage(cid, `❌ Erreur: ${err.message}`);
        }
      },
    };
    bot.sendMessage(chatId, '✅ Entrez l\'IP à débloquer:');
  }

  if (data === 'fw_tempban') {
    pendingActions[chatId] = {
      action: 'fw_tempban_ip',
      handler: async (bot, cid, text, pending, pa) => {
        delete pa[cid];
        const parts = text.trim().split(' ');
        if (parts.length < 2) {
          return bot.sendMessage(cid, '❌ Format: IP DURÉE_EN_HEURES\nEx: 192.168.1.100 24');
        }
        const ip = parts[0];
        const hours = parseInt(parts[1]);
        if (isNaN(hours) || hours < 1) {
          return bot.sendMessage(cid, '❌ Durée invalide.');
        }

        try {
          await runCommand(`iptables -I INPUT -s ${ip} -j DROP`);
          // Schedule unban
          const mins = hours * 60;
          await runCommand(`(sleep ${mins * 60} && iptables -D INPUT -s ${ip} -j DROP 2>/dev/null) &`);
          
          const audit = require('../utils/audit');
          audit.log(query.from.id, 'firewall', `Temp-banned IP: ${ip} for ${hours}h`);
          bot.sendMessage(cid, `✅ IP \`${ip}\` bannie pour ${hours}h.`, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_firewall' }]] },
          });
        } catch (err) {
          bot.sendMessage(cid, `❌ Erreur: ${err.message}`);
        }
      },
    };
    bot.sendMessage(chatId, '⏰ Entrez: IP HEURES\nEx: `192.168.1.100 24`', { parse_mode: 'Markdown' });
  }

  if (data === 'fw_banned') {
    try {
      const result = await runCommand(`iptables -L INPUT -n | grep DROP | awk '{print $4}' | sort -u`);
      const ips = result.trim().split('\n').filter(ip => ip && ip !== '0.0.0.0/0');

      if (ips.length === 0) {
        return bot.sendMessage(chatId, '✅ Aucune IP bannie.', {
          reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_firewall' }]] },
        });
      }

      let text = `━━━━━━━━━━━━━━━━━━━━━\n🚫 *IPs BANNIES (${ips.length})*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
      ips.forEach(ip => { text += `• \`${ip}\`\n`; });
      text += '\n━━━━━━━━━━━━━━━━━━━━━';

      bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_firewall' }]] },
      });
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
    }
  }

  if (data === 'fw_ratelimit') {
    const buttons = [
      [{ text: '🟢 Activer rate limiting', callback_data: 'fw_rl_on' }],
      [{ text: '🔴 Désactiver rate limiting', callback_data: 'fw_rl_off' }],
      [{ text: '🔙 Retour', callback_data: 'menu_firewall' }],
    ];
    bot.sendMessage(chatId,
      `🛡️ *Rate Limiting*\nLimite les connexions à 20/min par IP pour éviter les abus.`,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
    );
  }

  if (data === 'fw_rl_on') {
    try {
      await runCommand(`iptables -A INPUT -p tcp --syn -m connlimit --connlimit-above 20 -j DROP 2>/dev/null`);
      await runCommand(`iptables-save > /etc/iptables.rules 2>/dev/null`);
      bot.sendMessage(chatId, '✅ Rate limiting activé (max 20 conn/IP).', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_firewall' }]] },
      });
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
    }
  }

  if (data === 'fw_rl_off') {
    try {
      await runCommand(`iptables -D INPUT -p tcp --syn -m connlimit --connlimit-above 20 -j DROP 2>/dev/null`);
      await runCommand(`iptables-save > /etc/iptables.rules 2>/dev/null`);
      bot.sendMessage(chatId, '🔴 Rate limiting désactivé.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_firewall' }]] },
      });
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
    }
  }
}

module.exports = { showMenu, handleCallback };
