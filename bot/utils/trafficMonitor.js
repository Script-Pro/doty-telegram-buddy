const { runCommand } = require('./exec');
const { getXrayTraffic, getSSHTraffic, getDataLimit, formatBytes } = require('./traffic');
const { removeClient } = require('./xray');
const config = require('../config');

let checkInterval = null;

function initTrafficMonitor(bot) {
  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(async () => { await checkAllQuotas(bot); }, 5 * 60 * 1000);
  console.log('📊 Traffic monitor started (every 5 min)');
}

function progressBar(used, total) {
  const pct = Math.min((used / total) * 100, 100);
  const f = Math.round(pct / 10);
  const fc = pct >= 80 ? '🟥' : '🟩';
  return `${fc.repeat(f)}${'⬜'.repeat(10 - f)} ${pct.toFixed(1)}%`;
}

async function checkAllQuotas(bot) {
  try {
    const files = await runCommand(`ls /etc/xray/limits/ 2>/dev/null | grep -v _conn`).catch(() => '');
    if (!files) return;

    for (const file of files.split('\n').filter(Boolean)) {
      try {
        const limitData = JSON.parse(await runCommand(`cat /etc/xray/limits/${file}`));
        if (limitData.suspended) continue;

        const { protocol, username, limitBytes } = limitData;
        let traffic;

        if (protocol === 'ssh') traffic = await getSSHTraffic(username);
        else if (protocol === 'udp' || protocol === 'zivpn' || protocol === 'dns') continue;
        else traffic = await getXrayTraffic(username);

        if (traffic.total >= limitBytes) {
          limitData.suspended = true;
          await runCommand(`echo '${JSON.stringify(limitData)}' > /etc/xray/limits/${file}`);

          if (protocol === 'ssh') {
            await runCommand(`passwd -l ${username} 2>/dev/null || true`);
          } else {
            // Use protocol-based removal
            try { await removeClient(protocol, username); } catch {}
          }

          bot.sendMessage(config.ADMIN_ID,
            `⚠️ *QUOTA DÉPASSÉ*\n━━━━━━━━━━━━━━━━━━━━━\n📦 Protocole: *${protocol.toUpperCase()}*\n👤 Utilisateur: *${username}*\n📊 Utilisé: ${formatBytes(traffic.total)}\n📦 Limite: ${formatBytes(limitBytes)}\n${progressBar(traffic.total, limitBytes)}\n🔒 Compte suspendu!\n━━━━━━━━━━━━━━━━━━━━━`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📦 Prolonger quota', callback_data: `quota_ext_${protocol}_${username}` }, { text: '🗑 Supprimer', callback_data: `quota_del_${protocol}_${username}` }]] } }
          );
        } else if (traffic.total >= limitBytes * 0.8) {
          const alertKey = `alert80_${protocol}_${username}`;
          const alertFile = `/tmp/${alertKey}`;
          try { await runCommand(`cat ${alertFile}`); } catch {
            await runCommand(`touch ${alertFile}`);
            bot.sendMessage(config.ADMIN_ID,
              `⚠️ *ALERTE 80% QUOTA*\n━━━━━━━━━━━━━━━━━━━━━\n📦 ${protocol.toUpperCase()} - *${username}*\n📊 ${formatBytes(traffic.total)} / ${formatBytes(limitBytes)}\n${progressBar(traffic.total, limitBytes)}\n━━━━━━━━━━━━━━━━━━━━━`,
              { parse_mode: 'Markdown' }
            );
          }
        }
      } catch {}
    }
  } catch {}
}

module.exports = { initTrafficMonitor };
