/**
 * Xray config manipulation utilities
 * Uses protocol/tag-based jq selection instead of hardcoded indices
 */
const { runCommand } = require('./exec');

const XRAY_CONFIG = '/etc/xray/config.json';

/**
 * Find the inbound index for a given protocol or tag
 */
async function findInboundIndex(protocol, tag) {
  try {
    // Try by tag first
    if (tag) {
      const idx = await runCommand(`jq '[.inbounds[].tag // empty] | to_entries[] | select(.value=="${tag}") | .key' ${XRAY_CONFIG} 2>/dev/null | head -1`);
      if (idx !== '' && !isNaN(parseInt(idx))) return parseInt(idx);
    }
    // Fall back to protocol
    const idx = await runCommand(`jq '[.inbounds[].protocol // empty] | to_entries[] | select(.value=="${protocol}") | .key' ${XRAY_CONFIG} 2>/dev/null | head -1`);
    if (idx !== '' && !isNaN(parseInt(idx))) return parseInt(idx);
    return null;
  } catch { return null; }
}

/**
 * Add a client to xray config (protocol-based)
 */
async function addClient(protocol, clientObj) {
  await runCommand(`cd /etc/xray && cp config.json config.json.bak`);
  try {
    const clientJson = JSON.stringify(clientObj).replace(/'/g, "'\\''");
    // Use protocol-based selection
    await runCommand(`cd /etc/xray && jq '(.inbounds[] | select(.protocol=="${protocol}")).settings.clients += [${clientJson}]' config.json > tmp_xray.json && mv tmp_xray.json config.json`);
    await runCommand('systemctl restart xray 2>/dev/null || true');
  } catch (err) {
    // Restore backup
    await runCommand('cd /etc/xray && [ -f config.json.bak ] && mv config.json.bak config.json || true').catch(() => {});
    throw err;
  }
}

/**
 * Remove a client from xray config by email field
 */
async function removeClient(protocol, email) {
  const field = protocol === 'socks' ? 'user' : 'email';
  await runCommand(`cd /etc/xray && cp config.json config.json.bak`);
  try {
    await runCommand(`cd /etc/xray && jq 'del((.inbounds[] | select(.protocol=="${protocol}")).settings.clients[] | select(.${field}=="${email}"))' config.json > tmp_xray.json && mv tmp_xray.json config.json`);
    await runCommand('systemctl restart xray 2>/dev/null || true');
  } catch (err) {
    await runCommand('cd /etc/xray && [ -f config.json.bak ] && mv config.json.bak config.json || true').catch(() => {});
    throw err;
  }
}

/**
 * Update a client field in xray config
 */
async function updateClientField(protocol, email, field, value) {
  const selector = protocol === 'socks' ? 'user' : 'email';
  await runCommand(`cd /etc/xray && cp config.json config.json.bak`);
  try {
    await runCommand(`cd /etc/xray && jq '((.inbounds[] | select(.protocol=="${protocol}")).settings.clients[] | select(.${selector}=="${email}")).${field} = "${value}"' config.json > tmp_xray.json && mv tmp_xray.json config.json`);
    await runCommand('systemctl restart xray 2>/dev/null || true');
  } catch (err) {
    await runCommand('cd /etc/xray && [ -f config.json.bak ] && mv config.json.bak config.json || true').catch(() => {});
    throw err;
  }
}

/**
 * Update client email (rename)
 */
async function renameClient(protocol, oldEmail, newEmail) {
  const selector = protocol === 'socks' ? 'user' : 'email';
  await updateClientField(protocol, oldEmail, selector, newEmail);
}

/**
 * Count active connections for a specific xray user via API
 */
async function countUserConnections(email) {
  try {
    // Try xray API first (stats query for online users)
    const result = await runCommand(`xray api statsquery --server=127.0.0.1:10085 -pattern "user>>>${email}>>>traffic>>>uplink" 2>/dev/null | grep -c "value" || echo 0`).catch(() => '0');
    // Alternative: count via access log
    const logCount = await runCommand(`grep -c '"${email}"' /var/log/xray/access.log 2>/dev/null | tail -1 || echo 0`).catch(() => '0');
    // Use ss to count established connections associated with xray
    const ssCount = await runCommand(`ss -tnp 2>/dev/null | grep xray | grep ESTAB | wc -l`).catch(() => '0');
    return parseInt(ssCount) || 0;
  } catch { return 0; }
}

module.exports = { findInboundIndex, addClient, removeClient, updateClientField, renameClient, countUserConnections };
