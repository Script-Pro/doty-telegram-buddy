const path = require('path');
const { readJSON, writeJSON } = require('./helpers');

const AUDIT_FILE = path.join(__dirname, '..', 'data', 'audit_log.json');
const MAX_ENTRIES = 1000;

function getLog() {
  return readJSON(AUDIT_FILE) || [];
}

function log(userId, category, action) {
  const logs = getLog();
  logs.push({
    userId,
    category,
    action,
    timestamp: new Date().toISOString(),
  });

  // Keep only last MAX_ENTRIES
  if (logs.length > MAX_ENTRIES) {
    logs.splice(0, logs.length - MAX_ENTRIES);
  }

  writeJSON(AUDIT_FILE, logs);
}

function getFiltered({ userId, category, fromDate, toDate, limit = 50 } = {}) {
  let logs = getLog();

  if (userId) logs = logs.filter(l => l.userId === userId);
  if (category) logs = logs.filter(l => l.category === category);
  if (fromDate) logs = logs.filter(l => l.timestamp >= fromDate);
  if (toDate) logs = logs.filter(l => l.timestamp <= toDate);

  return logs.slice(-limit).reverse();
}

function exportAsText() {
  const logs = getLog();
  let text = 'AUDIT LOG - DOTYCAT TUNNEL BOT\n';
  text += `Generated: ${new Date().toISOString()}\n`;
  text += '='.repeat(60) + '\n\n';

  logs.forEach(l => {
    text += `[${l.timestamp}] User:${l.userId} | ${l.category} | ${l.action}\n`;
  });

  return text;
}

module.exports = { log, getLog, getFiltered, exportAsText };
