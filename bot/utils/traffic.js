const { runCommand } = require('./exec');
const fs = require('fs');
const path = require('path');

const TRAFFIC_DIR = '/etc/xray/traffic';
const LIMITS_DIR = '/etc/xray/limits';

async function ensureDirs() { try { await runCommand(`mkdir -p ${TRAFFIC_DIR} ${LIMITS_DIR}`); } catch {} }

async function getXrayTraffic(email) {
  try {
    const up = await runCommand(`xray api statsquery --server=127.0.0.1:10085 -pattern "user>>>${email}>>>traffic>>>uplink" 2>/dev/null | grep -oP '"value":\\s*"\\K[^"]+' || echo 0`).catch(() => '0');
    const down = await runCommand(`xray api statsquery --server=127.0.0.1:10085 -pattern "user>>>${email}>>>traffic>>>downlink" 2>/dev/null | grep -oP '"value":\\s*"\\K[^"]+' || echo 0`).catch(() => '0');
    const uplink = parseInt(up) || 0;
    const downlink = parseInt(down) || 0;
    return { uplink, downlink, total: uplink + downlink };
  } catch { return { uplink: 0, downlink: 0, total: 0 }; }
}

async function getSSHTraffic(username) {
  try {
    const result = await runCommand(`iptables -nvx -L OUTPUT 2>/dev/null | grep "owner UID match $(id -u ${username} 2>/dev/null)" | awk '{print $2}'`).catch(() => '0');
    const bytes = parseInt(result) || 0;
    return { uplink: 0, downlink: bytes, total: bytes };
  } catch { return { uplink: 0, downlink: 0, total: 0 }; }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
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
  await runCommand(`echo '${JSON.stringify(data)}' > ${filePath}`);
  return data;
}

async function getDataLimit(protocol, username) {
  try { const data = await runCommand(`cat ${LIMITS_DIR}/${protocol}_${username}.json 2>/dev/null`); return JSON.parse(data); }
  catch { return null; }
}

async function removeDataLimit(protocol, username) {
  try { await runCommand(`rm -f ${LIMITS_DIR}/${protocol}_${username}.json`); } catch {}
}

async function setConnLimit(protocol, username, maxConn) {
  await ensureDirs();
  const filePath = `${LIMITS_DIR}/${protocol}_${username}_conn.json`;
  const data = { protocol, username, maxConn };
  await runCommand(`echo '${JSON.stringify(data)}' > ${filePath}`);
}

async function getConnLimit(protocol, username) {
  try { const data = await runCommand(`cat ${LIMITS_DIR}/${protocol}_${username}_conn.json 2>/dev/null`); return JSON.parse(data); }
  catch { return null; }
}

async function countXrayConnections(email) {
  try {
    // Count actual connections via xray api or ss
    const result = await runCommand(`ss -tnp 2>/dev/null | grep -i xray | grep ESTAB | wc -l`).catch(() => '0');
    return parseInt(result) || 0;
  } catch { return 0; }
}

async function countSSHConnections(username) {
  try {
    const result = await runCommand(`ps aux 2>/dev/null | grep "sshd: ${username}" | grep -v grep | wc -l`);
    return parseInt(result) || 0;
  } catch { return 0; }
}

module.exports = {
  getXrayTraffic, getSSHTraffic, formatBytes, parseLimitToBytes,
  setDataLimit, getDataLimit, removeDataLimit,
  setConnLimit, getConnLimit, countXrayConnections, countSSHConnections,
  ensureDirs
};
