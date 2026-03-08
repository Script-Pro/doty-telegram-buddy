const { readJSON, writeJSON } = require('../utils/helpers');
const path = require('path');
const { exec } = require('child_process');

const SERVERS_FILE = path.join(__dirname, '..', 'data', 'servers.json');

function getServers() {
  return readJSON(SERVERS_FILE) || [];
}

function saveServers(servers) {
  writeJSON(SERVERS_FILE, servers);
}

function showMenu(bot, chatId) {
  const servers = getServers();
  const buttons = [
    [{ text: '➕ Ajouter un serveur', callback_data: 'ms_add' }],
    [{ text: '📋 Liste des serveurs', callback_data: 'ms_list' }],
    [{ text: '📊 Status tous serveurs', callback_data: 'ms_status_all' }],
    [{ text: '❌ Supprimer un serveur', callback_data: 'ms_remove' }],
    [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
  ];

  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━
📦 *MULTI-SERVEUR*
━━━━━━━━━━━━━━━━━━━━━
Serveurs configurés: ${servers.length}
━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
  );
}

function remoteCommand(server, command) {
  return new Promise((resolve, reject) => {
    const sshCmd = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 -p ${server.port || 22} ${server.user}@${server.ip} "${command}"`;
    exec(sshCmd, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve(stdout.trim());
    });
  });
}

async function handleCallback(bot, chatId, data, query, pendingActions) {
  if (data === 'ms_add') {
    pendingActions[chatId] = {
      action: 'ms_add_server',
      step: 'name',
      serverData: {},
      handler: handleAddServerInput,
    };
    bot.sendMessage(chatId, '📦 Entrez le *nom* du serveur (ex: VPS-Paris):', { parse_mode: 'Markdown' });
  }

  if (data === 'ms_list') {
    const servers = getServers();
    if (servers.length === 0) {
      return bot.sendMessage(chatId, '❌ Aucun serveur configuré.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_multiserver' }]] },
      });
    }

    let text = `━━━━━━━━━━━━━━━━━━━━━\n📋 *LISTE DES SERVEURS*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    servers.forEach((s, i) => {
      text += `${i + 1}. *${s.name}*\n`;
      text += `   🌐 IP: \`${s.ip}\`\n`;
      text += `   👤 User: ${s.user}\n`;
      text += `   🔌 Port SSH: ${s.port || 22}\n`;
      text += `   📅 Ajouté: ${s.addedAt?.split('T')[0] || 'N/A'}\n\n`;
    });
    text += '━━━━━━━━━━━━━━━━━━━━━';

    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_multiserver' }]] },
    });
  }

  if (data === 'ms_status_all') {
    const servers = getServers();
    if (servers.length === 0) {
      return bot.sendMessage(chatId, '❌ Aucun serveur configuré.');
    }

    bot.sendMessage(chatId, `🔍 Vérification de ${servers.length} serveurs...`);

    let text = `━━━━━━━━━━━━━━━━━━━━━\n📊 *STATUS MULTI-SERVEUR*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const server of servers) {
      try {
        const uptime = await remoteCommand(server, 'uptime -p');
        const ram = await remoteCommand(server, "free -m | awk 'NR==2{printf \"%sMB/%sMB (%.0f%%)\", $3,$2,$3*100/$2}'");
        const cpu = await remoteCommand(server, "top -bn1 | grep 'Cpu' | awk '{printf \"%.1f%%\", $2}'");
        text += `🟢 *${server.name}* (${server.ip})\n`;
        text += `  ⏱ ${uptime}\n`;
        text += `  🧠 RAM: ${ram}\n`;
        text += `  ⚙️ CPU: ${cpu}\n\n`;
      } catch {
        text += `🔴 *${server.name}* (${server.ip})\n`;
        text += `  ❌ Hors ligne ou inaccessible\n\n`;
      }
    }

    text += '━━━━━━━━━━━━━━━━━━━━━';
    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_multiserver' }]] },
    });
  }

  if (data === 'ms_remove') {
    const servers = getServers();
    if (servers.length === 0) {
      return bot.sendMessage(chatId, '❌ Aucun serveur à supprimer.');
    }

    const buttons = servers.map((s, i) => [{ text: `❌ ${s.name} (${s.ip})`, callback_data: `ms_del_${i}` }]);
    buttons.push([{ text: '🔙 Retour', callback_data: 'menu_multiserver' }]);

    bot.sendMessage(chatId, '❌ *Sélectionnez le serveur à supprimer:*', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: buttons },
    });
  }

  if (data.startsWith('ms_del_')) {
    const idx = parseInt(data.replace('ms_del_', ''));
    const servers = getServers();
    if (idx >= 0 && idx < servers.length) {
      const removed = servers.splice(idx, 1)[0];
      saveServers(servers);
      bot.sendMessage(chatId, `✅ Serveur *${removed.name}* supprimé.`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_multiserver' }]] },
      });
    }
  }

  // Per-server status
  if (data.startsWith('ms_info_')) {
    const idx = parseInt(data.replace('ms_info_', ''));
    const servers = getServers();
    const server = servers[idx];
    if (!server) return bot.sendMessage(chatId, '❌ Serveur introuvable.');

    try {
      const uptime = await remoteCommand(server, 'uptime -p');
      const ram = await remoteCommand(server, "free -h | awk 'NR==2{print $3\"/\"$2}'");
      const disk = await remoteCommand(server, "df -h / | awk 'NR==2{print $3\"/\"$2\" (\"$5\")\"}'");
      const os = await remoteCommand(server, "cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'");

      bot.sendMessage(chatId,
        `━━━━━━━━━━━━━━━━━━━━━
📦 *${server.name}*
━━━━━━━━━━━━━━━━━━━━━
🌐 IP: \`${server.ip}\`
💻 OS: ${os}
⏱ Uptime: ${uptime}
🧠 RAM: ${ram}
💽 Disque: ${disk}
━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_multiserver' }]] } }
      );
    } catch (err) {
      bot.sendMessage(chatId, `❌ Impossible de se connecter: ${err.message}`);
    }
  }
}

function handleAddServerInput(bot, chatId, text, pending, pendingActions) {
  if (pending.step === 'name') {
    pending.serverData.name = text.trim();
    pending.step = 'ip';
    bot.sendMessage(chatId, '🌐 Entrez l\'IP du serveur:');
  } else if (pending.step === 'ip') {
    pending.serverData.ip = text.trim();
    pending.step = 'user';
    bot.sendMessage(chatId, '👤 Entrez le nom d\'utilisateur SSH (ex: root):');
  } else if (pending.step === 'user') {
    pending.serverData.user = text.trim();
    pending.step = 'port';
    bot.sendMessage(chatId, '🔌 Entrez le port SSH (par défaut 22):');
  } else if (pending.step === 'port') {
    delete pendingActions[chatId];
    const port = parseInt(text.trim()) || 22;
    pending.serverData.port = port;
    pending.serverData.addedAt = new Date().toISOString();

    const servers = getServers();
    servers.push(pending.serverData);
    saveServers(servers);

    bot.sendMessage(chatId,
      `✅ Serveur *${pending.serverData.name}* ajouté!\n\n⚠️ N'oubliez pas de configurer l'accès SSH par clé:\n\`ssh-copy-id -p ${port} ${pending.serverData.user}@${pending.serverData.ip}\``,
      { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_multiserver' }]] } }
    );
  }
}

module.exports = { showMenu, handleCallback };
