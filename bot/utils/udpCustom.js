const fs = require('fs');
const path = require('path');
const { runCommand } = require('./exec');

const UDP_SERVICE = 'udp-custom';
const UDP_CONFIG_CANDIDATES = ['/root/udp/config.json', '/etc/UDPCustom/config.json'];

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function normalizeUdpConfig(config = {}) {
  const normalized = { ...config };

  if (!normalized.listen || typeof normalized.listen !== 'string') {
    normalized.listen = ':1-65535';
  }

  if (!normalized.auth || typeof normalized.auth !== 'object') {
    normalized.auth = { mode: 'passwords', config: [] };
  }

  if (!normalized.auth.mode) normalized.auth.mode = 'passwords';
  if (!Array.isArray(normalized.auth.config)) normalized.auth.config = [];

  return normalized;
}

function getExistingConfigPaths() {
  return UDP_CONFIG_CANDIDATES.filter((p) => fs.existsSync(p));
}

function writeConfigToPath(configPath, config) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

async function restartUdpService() {
  await runCommand(`systemctl restart ${UDP_SERVICE} 2>/dev/null || true`).catch(() => {});
}

async function ensureUdpConfig() {
  await runCommand('mkdir -p /root/udp /etc/UDPCustom').catch(() => {});

  const existingPaths = getExistingConfigPaths();
  let config = null;
  let sourcePath = existingPaths[0] || UDP_CONFIG_CANDIDATES[0];

  for (const configPath of existingPaths) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(raw);
      sourcePath = configPath;
      break;
    } catch {
      // try next candidate
    }
  }

  config = normalizeUdpConfig(config || {});

  const writeTargets = new Set(existingPaths.length ? existingPaths : UDP_CONFIG_CANDIDATES);
  for (const target of writeTargets) writeConfigToPath(target, config);

  return { config, path: sourcePath, paths: [...writeTargets] };
}

async function readUdpConfig() {
  return ensureUdpConfig();
}

async function writeUdpConfig(config) {
  const normalized = normalizeUdpConfig(config);
  const ensured = await ensureUdpConfig();
  for (const target of ensured.paths) writeConfigToPath(target, normalized);
  return normalized;
}

function getCredentialVariants(username, password) {
  const variants = [];
  if (username && password) variants.push(`${username}:${password}`);
  if (password) variants.push(password);
  return [...new Set(variants)];
}

async function addUdpCredential(username, password) {
  const { config, paths } = await ensureUdpConfig();
  const variants = getCredentialVariants(username, password);

  for (const credential of variants) {
    if (!config.auth.config.includes(credential)) config.auth.config.push(credential);
  }

  for (const target of paths) writeConfigToPath(target, config);
  await restartUdpService();
}

async function removeUdpCredential(username, password) {
  const { config, paths } = await ensureUdpConfig();
  const variants = new Set(getCredentialVariants(username, password));

  config.auth.config = config.auth.config.filter((item) => !variants.has(item));

  for (const target of paths) writeConfigToPath(target, config);
  await restartUdpService();
}

async function updateUdpCredential(username, oldPassword, newPassword) {
  await removeUdpCredential(username, oldPassword);
  await addUdpCredential(username, newPassword);
}

function getUdpListenPort(config) {
  const listen = String(config?.listen || ':1-65535').trim();
  if (listen.includes(':')) {
    const tail = listen.split(':').pop();
    return tail || '1-65535';
  }
  return listen || '1-65535';
}

function toLinuxExpiryDate(expiryText) {
  const [datePart] = String(expiryText || '').split(' ');
  const [dd, mm, yyyy] = datePart.split('-').map((n) => parseInt(n, 10));
  if (!dd || !mm || !yyyy) return null;
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function isValidLinuxUsername(username) {
  return /^[a-z_][a-z0-9_-]{2,31}$/i.test(username);
}

async function syncUdpSystemUser(username, password, expiryText) {
  if (!isValidLinuxUsername(username)) return;

  const expiryDate = toLinuxExpiryDate(expiryText) || '2099-12-31';
  const hash = await runCommand(`openssl passwd -6 ${shellEscape(password)} 2>/dev/null || openssl passwd -1 ${shellEscape(password)}`)
    .catch(() => '');
  if (!hash) return;

  const exists = await runCommand(`id -u ${shellEscape(username)} >/dev/null 2>&1 && echo 1 || echo 0`).catch(() => '0');

  if (exists.trim() === '1') {
    await runCommand(`usermod -p ${shellEscape(hash.trim())} -e ${shellEscape(expiryDate)} -s /bin/false ${shellEscape(username)} 2>/dev/null || true`).catch(() => {});
  } else {
    await runCommand(`useradd -M -s /bin/false -e ${shellEscape(expiryDate)} -p ${shellEscape(hash.trim())} ${shellEscape(username)} 2>/dev/null || true`).catch(() => {});
  }
}

async function renameUdpSystemUser(oldUsername, newUsername) {
  if (!isValidLinuxUsername(oldUsername) || !isValidLinuxUsername(newUsername)) return;
  await runCommand(`id -u ${shellEscape(oldUsername)} >/dev/null 2>&1 && usermod -l ${shellEscape(newUsername)} ${shellEscape(oldUsername)} 2>/dev/null || true`).catch(() => {});
}

async function removeUdpSystemUser(username) {
  if (!isValidLinuxUsername(username)) return;
  await runCommand(`id -u ${shellEscape(username)} >/dev/null 2>&1 && userdel --force ${shellEscape(username)} 2>/dev/null || true`).catch(() => {});
}

async function lockUdpSystemUser(username) {
  if (!isValidLinuxUsername(username)) return;
  await runCommand(`id -u ${shellEscape(username)} >/dev/null 2>&1 && passwd -l ${shellEscape(username)} 2>/dev/null || true`).catch(() => {});
}

module.exports = {
  ensureUdpConfig,
  readUdpConfig,
  writeUdpConfig,
  addUdpCredential,
  removeUdpCredential,
  updateUdpCredential,
  getUdpListenPort,
  syncUdpSystemUser,
  renameUdpSystemUser,
  removeUdpSystemUser,
  lockUdpSystemUser,
  isValidLinuxUsername,
};
