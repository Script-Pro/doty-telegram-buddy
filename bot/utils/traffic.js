const { runCommand } = require('./exec');
const fs = require('fs');

const TRAFFIC_DIR = '/etc/xray/traffic';
const LIMITS_DIR = '/etc/xray/limits';

async function ensureDirs() { try { await runCommand(`mkdir -p ${TRAFFIC_DIR} ${LIMITS_DIR}`); } catch {} }

/**
 * Get xray traffic stats via API (grpc stats service) — 3x-ui logic
 */
async function getXrayTraffic(email) {
  try {
    let uplink = 0, downlink = 0;

    // Method 1: Xray API statsquery (3x-ui approach)
    try {
      const upResult = await runCommand(
        `xray api statsquery --server=127.0.0.1:10085 -pattern "user>>>${email}>>>traffic>>>uplink" 2>/dev/null`
      );
      const upMatch = upResult.match(/"value"\s*:\s*"?(\d+)"?/);
      if (upMatch) uplink = parseInt(upMatch[1]) || 0;
    } catch {}

    try {
      const downResult = await runCommand(
        `xray api statsquery --server=127.0.0.1:10085 -pattern "user>>>${email}>>>traffic>>>downlink" 2>/dev/null`
      );
      const downMatch = downResult.match(/"value"\s*:\s*"?(\d+)"?/);
      if (downMatch) downlink = parseInt(downMatch[1]) || 0;
    } catch {}

    // Method 2: Fallback to stored traffic file
    if (uplink === 0 && downlink === 0) {
      try {
        const stored = JSON.parse(fs.readFileSync(`${TRAFFIC_DIR}/${email}.json`, 'utf8'));
        uplink = stored.uplink || 0;
        downlink = stored.downlink || 0;
      } catch {}
    }

    // Store current traffic for persistence
    if (uplink > 0 || downlink > 0) {
      try {
        await ensureDirs();
        fs.writeFileSync(`${TRAFFIC_DIR}/${email}.json`, JSON.stringify({ uplink, downlink, updatedAt: new Date().toISOString() }), 'utf8');
      } catch {}
    }

    return { uplink, downlink, total: uplink + downlink };
  } catch { return { uplink: 0, downlink: 0, total: 0 }; }
}

/**
 * Get SSH traffic via iptables (TMY-SSH-PRO logic)
 */
async function getSSHTraffic(username) {
  try {
    const result = await runCommand(
      `iptables -nvx -L OUTPUT 2>/dev/null | grep "owner UID match $(id -u ${username} 2>/dev/null)" | awk '{print $2}'`
    ).catch(() => '0');
    const bytes = parseInt(result) || 0;
    return { uplink: 0, downlink: bytes, total: bytes };
  } catch { return { uplink: 0, downlink: 0, total: 0 }; }
}

/**
 * Get UDP traffic via iptables (udp-custom logic)
 * Since udp-custom runs as a single process, we track per-user via stored counters
 */
async function getUdpTraffic(username) {
  try {
    // Try iptables owner match first
    const result = await runCommand(
      `iptables -L OUTPUT -v -n -x 2>/dev/null | grep "owner UID match $(id -u ${username} 2>/dev/null)" | awk '{print $2}'`
    ).catch(() => '0');
    const totalBytes = parseInt(result) || 0;
    if (totalBytes > 0) {
      return { uplink: Math.floor(totalBytes / 2), downlink: Math.floor(totalBytes / 2), total: totalBytes };
    }

    // Fallback: check stored traffic
    try {
      const stored = JSON.parse(fs.readFileSync(`${TRAFFIC_DIR}/udp_${username}.json`, 'utf8'));
      return { uplink: stored.uplink || 0, downlink: stored.downlink || 0, total: (stored.uplink || 0) + (stored.downlink || 0) };
    } catch {}

    return { uplink: 0, downlink: 0, total: 0 };
  } catch { return { uplink: 0, downlink: 0, total: 0 }; }
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function parseLimitToBytes(limitStr) {
  const match = limitStr.toUpperCase().match(/^(\d+(?:\.\d+)?)\s*(GB|MB|TB|KB)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  const unit = match[2];
  const multipliers = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return Math.floor(value * multipliers[unit]);
}

async function setDataLimit(protocol, username, limitBytes) {
  await ensureDirs();
  const filePath = `${LIMITS_DIR}/${protocol}_${username}.json`;
  const data = { protocol, username, limitBytes, suspended: false, createdAt: new Date().toISOString() };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

async function getDataLimit(protocol, username) {
  try {
    const data = fs.readFileSync(`${LIMITS_DIR}/${protocol}_${username}.json`, 'utf8');
    return JSON.parse(data);
  } catch { return null; }
}

async function removeDataLimit(protocol, username) {
  try { fs.unlinkSync(`${LIMITS_DIR}/${protocol}_${username}.json`); } catch {}
}

async function setConnLimit(protocol, username, maxConn) {
  await ensureDirs();
  const filePath = `${LIMITS_DIR}/${protocol}_${username}_conn.json`;
  const data = { protocol, username, maxConn };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function getConnLimit(protocol, username) {
  try {
    const data = fs.readFileSync(`${LIMITS_DIR}/${protocol}_${username}_conn.json`, 'utf8');
    return JSON.parse(data);
  } catch { return null; }
}

/**
 * Count SSH connections (TMY-SSH-PRO logic: ps aux | grep "sshd: username")
 */
async function countSSHConnections(username) {
  try {
    const result = await runCommand(`ps aux 2>/dev/null | grep "sshd: ${username}" | grep -v grep | wc -l`);
    return parseInt(result) || 0;
  } catch { return 0; }
}

/**
 * Count xray connections via access log + ss
 */
async function countXrayConnections(email) {
  try {
    // Method 1: unique source IPs in recent access log
    const result = await runCommand(
      `grep '${email}' /var/log/xray/access.log 2>/dev/null | tail -100 | awk '{print $3}' | cut -d: -f1 | sort -u | wc -l`
    ).catch(() => '0');
    const count = parseInt(result) || 0;
    if (count > 0) return count;

    // Method 2: ss established connections for xray
    const ssCount = await runCommand(`ss -tnp 2>/dev/null | grep xray | grep ESTAB | wc -l`).catch(() => '0');
    return parseInt(ssCount) || 0;
  } catch { return 0; }
}

/**
 * Count UDP connections via ss
 */
async function countUdpConnections() {
  try {
    const result = await runCommand(`ss -unp 2>/dev/null | grep -i "udp-custom\\|UDPCustom" | wc -l`).catch(() => '0');
    return parseInt(result) || 0;
  } catch { return 0; }
}

module.exports = {
  getXrayTraffic, getSSHTraffic, getUdpTraffic, formatBytes, parseLimitToBytes,
  setDataLimit, getDataLimit, removeDataLimit,
  setConnLimit, getConnLimit, countXrayConnections, countSSHConnections, countUdpConnections,
  ensureDirs
};
