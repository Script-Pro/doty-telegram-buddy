const { runCommand } = require('./exec');
const { getXrayTraffic, getSSHTraffic, getUdpTraffic, getDataLimit, formatBytes, countSSHConnections, countXrayConnections, getConnLimit } = require('./traffic');
const { removeClient } = require('./xray');
const config = require('../config');
const fs = require('fs');

let checkInterval = null;

function initTrafficMonitor(bot) {
  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(async () => {
    await checkAllQuotas(bot);
    await enforceConnectionLimits(bot);
  }, 5 * 60 * 1000);
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
        else if (protocol === 'udp') traffic = await getUdpTraffic(username);
        else if (protocol === 'zivpn' || protocol === 'dns') continue;
        else traffic = await getXrayTraffic(username);

        if (traffic.total >= limitBytes) {
          limitData.suspended = true;
          fs.writeFileSync(`${limitsDir}/${file}`, JSON.stringify(limitData, null, 2), 'utf8');

          if (protocol === 'ssh') {
            await runCommand(`passwd -l ${username} 2>/dev/null || true`);
          } else if (protocol === 'udp') {
            // Remove password from UDP config
            try {
              const usersDir = '/etc/UDPCustom/users';
              const userInfo = JSON.parse(fs.readFileSync(`${usersDir}/${username}.json`, 'utf8'));
              if (userInfo.password) {
                const udpConfig = JSON.parse(fs.readFileSync('/etc/UDPCustom/config.json', 'utf8'));
                udpConfig.auth.config = udpConfig.auth.config.filter(p => p !== userInfo.password);
                fs.writeFileSync('/etc/UDPCustom/config.json', JSON.stringify(udpConfig, null, 2), 'utf8');
                await runCommand('systemctl restart udp-custom 2>/dev/null || true');
              }
            } catch {}
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

/**
 * Enforce connection limits — TMY-SSH-PRO kill logic
 * Kills excess sessions when users exceed their max connection limit
 */
async function enforceConnectionLimits(bot) {
  try {
    const limitsDir = '/etc/xray/limits';
    let files;
    try { files = fs.readdirSync(limitsDir).filter(f => f.includes('_conn.json')); } catch { return; }

    for (const file of files) {
      try {
        const connData = JSON.parse(fs.readFileSync(`${limitsDir}/${file}`, 'utf8'));
        const { protocol, username, maxConn } = connData;
        if (!maxConn || maxConn <= 0) continue;

        let activeConns = 0;

        if (protocol === 'ssh') {
          // TMY-SSH-PRO: count sshd processes for user
          activeConns = await countSSHConnections(username);
          if (activeConns > maxConn) {
            console.log(`[ENFORCE] SSH ${username}: ${activeConns}/${maxConn} — killing excess`);
            // Kill oldest sessions to bring back to limit
            try {
              const pids = await runCommand(
                `ps aux | grep "sshd: ${username}" | grep -v grep | awk '{print $2}' | tail -n +${maxConn + 1}`
              );
              if (pids.trim()) {
                await runCommand(`kill ${pids.trim().replace(/\n/g, ' ')} 2>/dev/null || true`);
              }
            } catch {}
            bot.sendMessage(config.ADMIN_ID,
              `⚠️ *LIMITE CONNEXION*\n━━━━━━━━━━━━━━━━━━━━━\n📦 SSH - *${username}*\n👥 ${activeConns}/${maxConn} connexions\n🔪 Sessions excédentaires coupées\n━━━━━━━━━━━━━━━━━━━━━`,
              { parse_mode: 'Markdown' }
            ).catch(() => {});
          }
        } else if (protocol === 'udp') {
          // UDP: can't easily kill per-user, skip
        } else {
          // Xray protocols: count via access log
          activeConns = await countXrayConnections(username);
          // For Xray, we can't kill individual connections easily
          // But we log the alert for admin
          if (activeConns > maxConn) {
            const alertKey = `connalert_${protocol}_${username}`;
            const alertFile = `/tmp/${alertKey}`;
            try { fs.accessSync(alertFile); } catch {
              fs.writeFileSync(alertFile, '1', 'utf8');
              bot.sendMessage(config.ADMIN_ID,
                `⚠️ *LIMITE CONNEXION*\n━━━━━━━━━━━━━━━━━━━━━\n📦 ${protocol.toUpperCase()} - *${username}*\n👥 ${activeConns}/${maxConn} connexions\n━━━━━━━━━━━━━━━━━━━━━`,
                { parse_mode: 'Markdown' }
              ).catch(() => {});
              // Clear alert after 10 min
              setTimeout(() => { try { fs.unlinkSync(alertFile); } catch {} }, 10 * 60 * 1000);
            }
          }
        }
      } catch {}
    }
  } catch {}
}

module.exports = { initTrafficMonitor };
