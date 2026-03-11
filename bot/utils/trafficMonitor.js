const { runCommand } = require('./exec');
const { getXrayTraffic, getSSHTraffic, getDataLimit, formatBytes } = require('./traffic');
const { removeClient } = require('./xray');
const config = require('../config');
const fs = require('fs');

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

function detailTraffic(bytes) {
  if (bytes === 0) return '0 B';
  const u = [{ n: 'TB', v: 1024 ** 4 }, { n: 'GB', v: 1024 ** 3 }, { n: 'MB', v: 1024 ** 2 }, { n: 'KB', v: 1024 }];
  let r = bytes; const p = [];
  for (const x of u) { if (r >= x.v) { p.push(`${Math.floor(r / x.v)} ${x.n}`); r %= x.v; } }
  return p.join(' + ') || `${bytes} B`;
}

async function checkAllQuotas(bot) {
  try {
    const limitsDir = '/etc/xray/limits';
    let files;
    try { files = fs.readdirSync(limitsDir).filter(f => f.endsWith('.json') && !f.includes('_conn')); } catch { return; }

    for (const file of files) {
      try {
        const limitData = JSON.parse(fs.readFileSync(`${limitsDir}/${file}`, 'utf8'));
        if (limitData.suspended) continue;

        const { protocol, username, limitBytes } = limitData;
        let traffic;

        if (protocol === 'ssh') traffic = await getSSHTraffic(username);
        else if (protocol === 'udp' || protocol === 'zivpn' || protocol === 'dns') continue;
        else traffic = await getXrayTraffic(username);

        if (traffic.total >= limitBytes) {
          limitData.suspended = true;
          fs.writeFileSync(`${limitsDir}/${file}`, JSON.stringify(limitData, null, 2), 'utf8');

          if (protocol === 'ssh') {
            await runCommand(`passwd -l ${username} 2>/dev/null || true`);
          } else {
            try { await removeClient(protocol, username); } catch {}
          }

          bot.sendMessage(config.ADMIN_ID,
            `⚠️ *QUOTA DÉPASSÉ*\n━━━━━━━━━━━━━━━━━━━━━\n📦 Protocole: *${protocol.toUpperCase()}*\n👤 Utilisateur: *${username}*\n📊 Utilisé: ${formatBytes(traffic.total)} (${detailTraffic(traffic.total)})\n📦 Limite: ${formatBytes(limitBytes)}\n${progressBar(traffic.total, limitBytes)}\n🔒 Compte suspendu!\n━━━━━━━━━━━━━━━━━━━━━`,
            { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '📦 Prolonger quota', callback_data: `quota_ext_${protocol}_${username}` }, { text: '🗑 Supprimer', callback_data: `quota_del_${protocol}_${username}` }]] } }
          );
        } else if (traffic.total >= limitBytes * 0.8) {
          const alertKey = `alert80_${protocol}_${username}`;
          const alertFile = `/tmp/${alertKey}`;
          try { fs.accessSync(alertFile); } catch {
            fs.writeFileSync(alertFile, '1', 'utf8');
            bot.sendMessage(config.ADMIN_ID,
              `⚠️ *ALERTE 80% QUOTA*\n━━━━━━━━━━━━━━━━━━━━━\n📦 ${protocol.toUpperCase()} - *${username}*\n📊 ${formatBytes(traffic.total)} / ${formatBytes(limitBytes)}\n📋 ${detailTraffic(traffic.total)}\n${progressBar(traffic.total, limitBytes)}\n━━━━━━━━━━━━━━━━━━━━━`,
              { parse_mode: 'Markdown' }
            );
          }
        }
      } catch {}
    }
  } catch {}
}

module.exports = { initTrafficMonitor };
