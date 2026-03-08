const { runCommand } = require('../utils/exec');
const { readJSON, writeJSON } = require('../utils/helpers');
const path = require('path');

const SPEEDTEST_LOG = path.join(__dirname, '..', 'data', 'speedtest_history.json');

function getHistory() {
  return readJSON(SPEEDTEST_LOG) || [];
}

function saveResult(result) {
  const history = getHistory();
  history.push(result);
  if (history.length > 20) history.shift();
  writeJSON(SPEEDTEST_LOG, history);
}

function showMenu(bot, chatId) {
  const buttons = [
    [{ text: '🚀 Lancer Speedtest', callback_data: 'speed_run' }],
    [{ text: '📊 Speedtest rapide (curl)', callback_data: 'speed_quick' }],
    [{ text: '📋 Historique', callback_data: 'speed_history' }],
    [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
  ];

  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━
🧪 *SPEEDTEST*
━━━━━━━━━━━━━━━━━━━━━
Testez la vitesse de votre serveur:
━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
  );
}

async function handleCallback(bot, chatId, data, query) {
  if (data === 'speed_run') {
    bot.sendMessage(chatId, '🚀 Speedtest en cours... (peut prendre 30-60 secondes)');

    try {
      // Try speedtest-cli first
      let result;
      try {
        result = await runCommand('speedtest-cli --simple 2>/dev/null', 90000);
      } catch {
        // Try speedtest (ookla)
        try {
          result = await runCommand('speedtest --simple 2>/dev/null', 90000);
        } catch {
          // Install and retry
          await runCommand('pip3 install speedtest-cli 2>/dev/null || pip install speedtest-cli 2>/dev/null');
          result = await runCommand('speedtest-cli --simple', 90000);
        }
      }

      const lines = result.trim().split('\n');
      let ping = 'N/A', download = 'N/A', upload = 'N/A';

      lines.forEach(line => {
        if (line.startsWith('Ping')) ping = line.split(':')[1]?.trim() || 'N/A';
        if (line.startsWith('Download')) download = line.split(':')[1]?.trim() || 'N/A';
        if (line.startsWith('Upload')) upload = line.split(':')[1]?.trim() || 'N/A';
      });

      const entry = {
        ping, download, upload,
        date: new Date().toISOString(),
      };
      saveResult(entry);

      bot.sendMessage(chatId,
        `━━━━━━━━━━━━━━━━━━━━━
🧪 *RÉSULTAT SPEEDTEST*
━━━━━━━━━━━━━━━━━━━━━
🏓 Ping: ${ping}
📥 Download: ${download}
📤 Upload: ${upload}
📅 Date: ${entry.date.split('T')[0]}
━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_speedtest' }]] } }
      );
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur speedtest: ${err.message}\n\n💡 Installez speedtest-cli: \`pip3 install speedtest-cli\``, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_speedtest' }]] },
      });
    }
  }

  if (data === 'speed_quick') {
    bot.sendMessage(chatId, '⚡ Test rapide en cours...');
    try {
      const dlSpeed = await runCommand(`curl -s -o /dev/null -w '%{speed_download}' http://speedtest.tele2.net/10MB.zip 2>/dev/null`, 30000);
      const speedMbps = (parseFloat(dlSpeed) / 1024 / 1024 * 8).toFixed(2);

      const pingResult = await runCommand(`ping -c 3 8.8.8.8 | tail -1 | awk -F '/' '{print $5}'`);

      bot.sendMessage(chatId,
        `━━━━━━━━━━━━━━━━━━━━━
⚡ *TEST RAPIDE*
━━━━━━━━━━━━━━━━━━━━━
📥 Download: ~${speedMbps} Mbps
🏓 Ping (Google): ${pingResult.trim()} ms
━━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_speedtest' }]] } }
      );
    } catch (err) {
      bot.sendMessage(chatId, `❌ Erreur: ${err.message}`);
    }
  }

  if (data === 'speed_history') {
    const history = getHistory();
    if (history.length === 0) {
      return bot.sendMessage(chatId, '📋 Aucun historique de speedtest.', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_speedtest' }]] },
      });
    }

    let text = `━━━━━━━━━━━━━━━━━━━━━\n📋 *HISTORIQUE SPEEDTEST*\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    history.slice(-10).reverse().forEach(r => {
      const date = r.date.split('T')[0];
      text += `📅 ${date}\n`;
      text += `  🏓 ${r.ping} | 📥 ${r.download} | 📤 ${r.upload}\n\n`;
    });

    text += '━━━━━━━━━━━━━━━━━━━━━';
    bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 Retour', callback_data: 'menu_speedtest' }]] },
    });
  }
}

module.exports = { showMenu, handleCallback };
