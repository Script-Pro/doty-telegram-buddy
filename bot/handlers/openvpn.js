const { runCommand, getDomain } = require('../utils/exec');

function showMenu(bot, chatId) {
  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━\n🌐 *OPENVPN MENU*\n━━━━━━━━━━━━━━━━━━━━━`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '➕ Créer Client', callback_data: 'ovpn_create' }, { text: '🗑 Supprimer', callback_data: 'ovpn_delete' }],
          [{ text: '📋 Liste Clients', callback_data: 'ovpn_list' }],
          [{ text: '🔄 Restart TCP', callback_data: 'ovpn_restart_tcp' }, { text: '🔄 Restart UDP', callback_data: 'ovpn_restart_udp' }],
          [{ text: '📊 Status', callback_data: 'ovpn_status' }],
          [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
        ],
      },
    }
  );
}

async function handleCallback(bot, chatId, data, query) {
  const { pendingActions } = require('../index');
  switch (data) {
    case 'ovpn_create':
      bot.sendMessage(chatId, '📝 Nom du client OpenVPN:');
      pendingActions[chatId] = { action: 'ovpn_create', step: 'name', handler: handleCreateFlow };
      break;
    case 'ovpn_delete':
      await showClientList(bot, chatId, 'ovpn_del_');
      break;
    case 'ovpn_list':
      await listClients(bot, chatId);
      break;
    case 'ovpn_restart_tcp':
      try { await runCommand('systemctl restart openvpn@server-tcp'); bot.sendMessage(chatId, '✅ OpenVPN TCP redémarré.'); }
      catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
      break;
    case 'ovpn_restart_udp':
      try { await runCommand('systemctl restart openvpn@server-udp'); bot.sendMessage(chatId, '✅ OpenVPN UDP redémarré.'); }
      catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
      break;
    case 'ovpn_status':
      try {
        const tcp = await runCommand('systemctl is-active openvpn@server-tcp 2>/dev/null || echo inactive');
        const udp = await runCommand('systemctl is-active openvpn@server-udp 2>/dev/null || echo inactive');
        bot.sendMessage(chatId, `📊 *OpenVPN Status*\n\nTCP: ${tcp === 'active' ? '✅' : '❌'} ${tcp}\nUDP: ${udp === 'active' ? '✅' : '❌'} ${udp}`, { parse_mode: 'Markdown' });
      } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
      break;
    default:
      if (data.startsWith('ovpn_del_')) {
        const client = data.replace('ovpn_del_', '');
        try {
          await runCommand(`cd /etc/openvpn && ./revoke.sh ${client} 2>/dev/null || rm -f /etc/openvpn/client/${client}.ovpn`);
          bot.sendMessage(chatId, `✅ Client *${client}* supprimé.`, { parse_mode: 'Markdown' });
        } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
      }
  }
}

async function handleCreateFlow(bot, chatId, text, pending, pendingActions) {
  if (pending.step === 'name') {
    delete pendingActions[chatId];
    const clientName = text.trim();
    try {
      bot.sendMessage(chatId, '⏳ Génération du certificat en cours...');
      await runCommand(`cd /etc/openvpn && source vars 2>/dev/null; ./build-key --batch ${clientName} 2>/dev/null || true`);
      
      // Generate .ovpn file
      const domain = await getDomain();
      const ovpnContent = await runCommand(`cat /etc/openvpn/client/${clientName}.ovpn 2>/dev/null || echo "Config not found"`);
      
      if (ovpnContent !== 'Config not found') {
        // Send as file
        bot.sendDocument(chatId, Buffer.from(ovpnContent), {
          filename: `${clientName}.ovpn`,
          caption: `✅ Client OpenVPN *${clientName}* créé.\n🌐 Server: ${domain}\n📡 TCP: 1194 | UDP: 2200`,
        }, { contentType: 'application/octet-stream' });
      } else {
        bot.sendMessage(chatId, `✅ Client *${clientName}* créé.\nFichier .ovpn à récupérer dans /etc/openvpn/client/`, { parse_mode: 'Markdown' });
      }
    } catch (err) { bot.sendMessage(chatId, `❌ Erreur: ${err.message}`); }
  }
}

async function listClients(bot, chatId) {
  try {
    const result = await runCommand(`ls /etc/openvpn/client/ 2>/dev/null | sed 's/.ovpn//'`);
    if (!result) { bot.sendMessage(chatId, '📋 Aucun client OpenVPN.'); return; }
    bot.sendMessage(chatId, `📋 *Clients OpenVPN*\n━━━━━━━━━━━━━━━\n${result.split('\n').map(c => `👤 ${c}`).join('\n')}`, { parse_mode: 'Markdown' });
  } catch { bot.sendMessage(chatId, '📋 Aucun client OpenVPN.'); }
}

async function showClientList(bot, chatId, prefix) {
  try {
    const result = await runCommand(`ls /etc/openvpn/client/ 2>/dev/null | sed 's/.ovpn//'`);
    if (!result) { bot.sendMessage(chatId, '📋 Aucun client.'); return; }
    const kb = result.split('\n').map(u => [{ text: u, callback_data: `${prefix}${u}` }]);
    kb.push([{ text: '🔙 Retour', callback_data: 'menu_openvpn' }]);
    bot.sendMessage(chatId, '👤 Sélectionnez:', { reply_markup: { inline_keyboard: kb } });
  } catch { bot.sendMessage(chatId, '📋 Aucun client.'); }
}

module.exports = { showMenu, handleCallback };
