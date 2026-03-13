/**
 * Xray config manipulation utilities
 * Direct JSON manipulation with atomic writes + backup restore.
 */
const { runCommand } = require('./exec');
const fs = require('fs');

const XRAY_CONFIG = '/etc/xray/config.json';
const XRAY_BACKUP = `${XRAY_CONFIG}.bak`;
const XRAY_TMP = '/tmp/xray_config_tmp.json';

function parseJsonLenient(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    // Fallback for accidental comments/trailing commas in manually edited configs
    const sanitized = String(raw)
      .replace(/^\uFEFF/, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(sanitized);
  }
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function selectorField(protocol) {
  return protocol === 'socks' ? 'user' : 'email';
}

/**
 * Safely read and parse xray config
 */
async function readXrayConfig() {
  try {
    const raw = fs.readFileSync(XRAY_CONFIG, 'utf8');
    return parseJsonLenient(raw);
  } catch {
    const raw = await runCommand(`cat ${XRAY_CONFIG}`);
    return parseJsonLenient(raw);
  }
}

/**
 * Safely write xray config (with backup)
 */
async function writeXrayConfig(config) {
  // Ensure config itself is JSON-serializable
  const payload = JSON.stringify(config, null, 2);
  JSON.parse(payload);

  await runCommand(`cp ${XRAY_CONFIG} ${XRAY_BACKUP}`).catch(() => {});
  fs.writeFileSync(XRAY_TMP, payload, 'utf8');
  await runCommand(`mv ${XRAY_TMP} ${XRAY_CONFIG}`);
}

/**
 * Find first inbound by protocol (backward compatibility)
 */
function findInbound(config, protocol) {
  return config.inbounds ? config.inbounds.find((ib) => ib.protocol === protocol) : null;
}

/**
 * Find all inbounds by protocol
 */
function findInbounds(config, protocol) {
  return Array.isArray(config.inbounds)
    ? config.inbounds.filter((ib) => ib.protocol === protocol)
    : [];
}

function ensureClientsArray(inbound) {
  if (!inbound.settings) inbound.settings = {};
  if (!Array.isArray(inbound.settings.clients)) inbound.settings.clients = [];
}

/**
 * Add a client to all inbounds of a protocol
 */
async function addClient(protocol, clientObj) {
  try {
    const config = await readXrayConfig();
    const inbounds = findInbounds(config, protocol);
    if (!inbounds.length) throw new Error(`Inbound ${protocol} non trouvé dans la config Xray`);

    const selector = selectorField(protocol);
    for (const inbound of inbounds) {
      ensureClientsArray(inbound);
      const alreadyExists = inbound.settings.clients.some((c) => c?.[selector] === clientObj?.[selector]);
      if (!alreadyExists) inbound.settings.clients.push({ ...clientObj });
    }

    await writeXrayConfig(config);
    await runCommand('systemctl restart xray 2>/dev/null || true');
  } catch (err) {
    await runCommand(`[ -f ${XRAY_BACKUP} ] && mv ${XRAY_BACKUP} ${XRAY_CONFIG} || true`).catch(() => {});
    throw err;
  }
}

/**
 * Remove a client from all inbounds of a protocol
 */
async function removeClient(protocol, email) {
  try {
    const config = await readXrayConfig();
    const inbounds = findInbounds(config, protocol);
    if (!inbounds.length) return;

    const field = selectorField(protocol);
    for (const inbound of inbounds) {
      ensureClientsArray(inbound);
      inbound.settings.clients = inbound.settings.clients.filter((c) => c[field] !== email);
    }

    await writeXrayConfig(config);
    await runCommand('systemctl restart xray 2>/dev/null || true');
  } catch (err) {
    await runCommand(`[ -f ${XRAY_BACKUP} ] && mv ${XRAY_BACKUP} ${XRAY_CONFIG} || true`).catch(() => {});
    throw err;
  }
}

/**
 * Update a client field across all inbounds of a protocol
 */
async function updateClientField(protocol, email, field, value) {
  try {
    const config = await readXrayConfig();
    const inbounds = findInbounds(config, protocol);
    if (!inbounds.length) throw new Error('Client non trouvé');

    const selector = selectorField(protocol);
    let updated = 0;

    for (const inbound of inbounds) {
      ensureClientsArray(inbound);
      for (const client of inbound.settings.clients) {
        if (client?.[selector] === email) {
          client[field] = value;
          updated++;
        }
      }
    }

    if (!updated) throw new Error(`Client ${email} non trouvé`);

    await writeXrayConfig(config);
    await runCommand('systemctl restart xray 2>/dev/null || true');
  } catch (err) {
    await runCommand(`[ -f ${XRAY_BACKUP} ] && mv ${XRAY_BACKUP} ${XRAY_CONFIG} || true`).catch(() => {});
    throw err;
  }
}

/**
 * Rename client (update selector field)
 */
async function renameClient(protocol, oldEmail, newEmail) {
  const selector = selectorField(protocol);
  await updateClientField(protocol, oldEmail, selector, newEmail);
}

/**
 * Count active connections for a specific xray user
 */
async function countUserConnections(email) {
  try {
    const grepNeedle = shellEscape(email);

    // Method 1: Unique source IPs in recent access log
    const logCount = await runCommand(
      `grep -F -- ${grepNeedle} /var/log/xray/access.log 2>/dev/null | tail -200 | awk '{print $3}' | cut -d: -f1 | sort -u | wc -l`
    ).catch(() => '0');

    const parsedLogCount = parseInt(logCount, 10) || 0;
    if (parsedLogCount > 0) return parsedLogCount;

    // Method 2: Xray API stats existence
    try {
      const result = await runCommand(
        `xray api statsquery --server=127.0.0.1:10085 -pattern "user>>>${email}>>>traffic>>>uplink" 2>/dev/null`
      );
      if (result && result.includes('value')) return 1;
    } catch {}

    // Method 3: Fallback to global established connections
    const ssCount = await runCommand(`ss -tnp 2>/dev/null | grep xray | grep ESTAB | wc -l`).catch(() => '0');
    return parseInt(ssCount, 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Get list of all clients for a protocol (deduplicated by selector)
 */
async function getClients(protocol) {
  try {
    const config = await readXrayConfig();
    const inbounds = findInbounds(config, protocol);
    const selector = selectorField(protocol);
    const byKey = new Map();

    for (const inbound of inbounds) {
      ensureClientsArray(inbound);
      for (const client of inbound.settings.clients) {
        const key = client?.[selector];
        if (key && !byKey.has(key)) byKey.set(key, client);
      }
    }

    return [...byKey.values()];
  } catch {
    return [];
  }
}

/**
 * Get first inbound port for a protocol (backward compatibility)
 */
async function getInboundPort(protocol) {
  try {
    const config = await readXrayConfig();
    const inbound = findInbound(config, protocol);
    return inbound ? inbound.port : null;
  } catch {
    return null;
  }
}

/**
 * Get protocol inbound profiles (ws/grpc/tcp + tls/non-tls)
 */
async function getProtocolProfiles(protocol) {
  try {
    const config = await readXrayConfig();
    const inbounds = findInbounds(config, protocol);

    return inbounds.map((inbound) => {
      const stream = inbound.streamSettings || {};
      const ws = stream.wsSettings || {};
      const grpc = stream.grpcSettings || {};
      return {
        tag: inbound.tag || '',
        port: inbound.port || null,
        network: stream.network || 'tcp',
        security: stream.security || 'none',
        path: ws.path || null,
        host: ws?.headers?.Host || ws.host || null,
        serviceName: grpc.serviceName || null,
      };
    });
  } catch {
    return [];
  }
}

module.exports = {
  readXrayConfig,
  writeXrayConfig,
  findInbound,
  findInbounds,
  addClient,
  removeClient,
  updateClientField,
  renameClient,
  countUserConnections,
  getClients,
  getInboundPort,
  getProtocolProfiles,
};
