const { runCommand } = require('../utils/exec');
const config = require('../config');

function showMenu(bot, chatId) {
  const buttons = [
    [{ text: '📊 Stats globales', callback_data: 'stats_global' }],
    [{ text: '📈 Stats par protocole', callback_data: 'stats_protocol' }],
    [{ text: '🔥 Top utilisateurs', callback_data: 'stats_top' }],
    [{ text: '📅 Expirations proches', callback_data: 'stats_expiring' }],
    [{ text: '💾 Usage disque & RAM', callback_data: 'stats_resources' }],
    [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
  ];

  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━
📊 *STATISTIQUES*
━━━━━━━━━━━━━━━━━━━━━
Consultez les stats du serveur:
━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
  );
}

async function handleCallback(bot, chatId, data, query) {
  if (data === 'stats_global') {
    try {
      let vlessCount = '0', vmessCount = '0', trojanCount = '0', sshCount = '0', socksCount = '0';
      
      try { vlessCount = (await runCommand('grep -c "^###" /etc/xray/vless.json 2>/dev/null || echo 0')).trim(); } catch { vlessCount = '0'; }
      try { vmessCount = (await runCommand('grep -c "^###" /etc/xray/vmess.json 2>/dev/null || echo 0')).trim(); } catch { vmessCount = '0'; }
      try { trojanCount = (await runCommand('grep -c "^###" /etc/xray/trojan.json 2>/dev/null || echo 0')).trim(); } catch { trojanCount = '0'; }
      try { sshCount = (await runCommand('ls /etc/ssh-users/ 2>/dev/null | wc -l')).trim(); } catch { sshCount = '0'; }
      try { socksCount = (await runCommand('grep -c "^###" /etc/xray/socks.json 2>/dev/null || echo 0')).trim(); } catch { socksCount = '0'; }

      const total = parseInt(vlessCount) + parseInt(vmessCount) + parseInt(trojanCount) + parseInt(sshCount) + parseInt(socksCount);

      bot.sendMessage(chatId,
        `━━━━━━━━━━━━━━━━━━━━━
📊 *STATISTIQUES GLOBALES*
━━━━━━━━━━━━━━━━━━━━━
📦 Total comptes: ${total}

🔰 VLESS: ${vlessCount}
🔰 VMESS: ${vmessCount}
🔰 TROJAN: ${trojanCount}
🔑 SSH: ${sshCount}
🔰 SOCKS: ${socksCount}
━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_stats' }]] } }
      );
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
    }
  }

  if (data === 'stats_protocol') {
    try {
      const protocols = ['vless', 'vmess', 'trojan', 'socks'];
      let text = `━━━━━━━━━━━━━━━━━━━━━\n📈 *STATS PAR PROTOCOLE*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;

      for (const proto of protocols) {
        try {
          const users = await runCommand(`grep "^###" /etc/xray/${proto}.json 2>/dev/null | sed 's/^### //' || echo ""`);
          const list = users.trim().split('\n').filter(u => u);
          text += `🔰 *${proto.toUpperCase()}* — ${list.length} comptes\n`;
          if (list.length > 0) {
            list.slice(0, 5).forEach(u => { text += `  └ ${u}\n`; });
            if (list.length > 5) text += `  └ ... et ${list.length - 5} autres\n`;
          }
          text += '\n';
        } catch {
          text += `🔰 *${proto.toUpperCase()}* — 0 comptes\n\n`;
        }
      }

      text += '━━━━━━━━━━━━━━━━━━━━━';
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_stats' }]] } });
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
    }
  }

  if (data === 'stats_top') {
    try {
      let text = `━━━━━━━━━━━━━━━━━━━━━\n🔥 *TOP UTILISATEURS (Bande passante)*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
      
      try {
        const result = await runCommand(`vnstat --json 2>/dev/null || echo "{}"`);
        const vnData = JSON.parse(result);
        if (vnData.interfaces && vnData.interfaces.length > 0) {
          const iface = vnData.interfaces[0];
          text += `Interface: ${iface.name}\n`;
          text += `📥 RX Total: ${(iface.traffic?.total?.rx || 0 / 1024 / 1024).toFixed(2)} GB\n`;
          text += `📤 TX Total: ${(iface.traffic?.total?.tx || 0 / 1024 / 1024).toFixed(2)} GB\n`;
        } else {
          text += '⚠️ vnstat non installé ou pas de données\n';
        }
      } catch {
        text += '⚠️ vnstat non disponible. Installez avec: apt install vnstat\n';
      }

      text += '\n━━━━━━━━━━━━━━━━━━━━━';
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_stats' }]] } });
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
    }
  }

  if (data === 'stats_expiring') {
    try {
      let text = `━━━━━━━━━━━━━━━━━━━━━\n📅 *COMPTES EXPIRANT BIENTÔT*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
      
      const protocols = ['vless', 'vmess', 'trojan', 'socks'];
      let found = false;

      for (const proto of protocols) {
        try {
          const users = await runCommand(`grep "^###" /etc/xray/${proto}.json 2>/dev/null | sed 's/^### //'`);
          const list = users.trim().split('\n').filter(u => u);
          
          for (const user of list) {
            try {
              const parts = user.split(' ');
              const username = parts[0];
              const expDate = parts[1];
              if (expDate) {
                const [day, month, year] = expDate.split('-').map(Number);
                const exp = new Date(year, month - 1, day);
                const now = new Date();
                const diffDays = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
                
                if (diffDays <= 3 && diffDays >= 0) {
                  text += `⚠️ ${proto.toUpperCase()} - ${username}: expire dans ${diffDays}j\n`;
                  found = true;
                } else if (diffDays < 0) {
                  text += `❌ ${proto.toUpperCase()} - ${username}: expiré depuis ${Math.abs(diffDays)}j\n`;
                  found = true;
                }
              }
            } catch {}
          }
        } catch {}
      }

      if (!found) text += '✅ Aucun compte n\'expire dans les 3 prochains jours.\n';
      text += '\n━━━━━━━━━━━━━━━━━━━━━';
      bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_stats' }]] } });
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
    }
  }

  if (data === 'stats_resources') {
    try {
      let ram = 'N/A', disk = 'N/A', cpu = 'N/A', load = 'N/A';
      try { ram = await runCommand(`free -m | awk 'NR==2{printf "%sMB / %sMB (%.1f%%)", $3, $2, $3*100/$2}'`); } catch {}
      try { disk = await runCommand(`df -h / | awk 'NR==2{printf "%s / %s (%s)", $3, $2, $5}'`); } catch {}
      try { cpu = await runCommand(`top -bn1 | grep "Cpu(s)" | awk '{printf "%.1f%%", $2}'`); } catch {}
      try { load = await runCommand(`cat /proc/loadavg | awk '{print $1, $2, $3}'`); } catch {}

      bot.sendMessage(chatId,
        `━━━━━━━━━━━━━━━━━━━━━
💾 *USAGE RESSOURCES*
━━━━━━━━━━━━━━━━━━━━━
🧠 RAM: ${ram}
💽 Disque: ${disk}
⚙️ CPU: ${cpu}
📊 Load: ${load}
━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_stats' }]] } }
      );
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
    }
  }
}

module.exports = { showMenu, handleCallback };
