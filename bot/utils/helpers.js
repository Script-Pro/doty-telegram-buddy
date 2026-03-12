const fs = require('fs');
const path = require('path');
const config = require('../config');
const { runCommand } = require('./exec');

function isAdmin(userId) {
  return userId === config.ADMIN_ID;
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatDate(date) {
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

function formatDateTime(date) {
  const d = new Date(date);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function getExpiryDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function adjustExpiry(currentExpiry, amount, unit) {
  let d;
  const parts = currentExpiry.split(' ');
  const dateParts = parts[0].split('-');
  if (dateParts.length === 3) {
    const day = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]) - 1;
    const year = parseInt(dateParts[2]);
    d = new Date(year, month, day);
    if (parts[1]) {
      const timeParts = parts[1].split(':');
      d.setHours(parseInt(timeParts[0]) || 0, parseInt(timeParts[1]) || 0);
    }
  } else {
    d = new Date();
  }
  
  if (d < new Date() && amount > 0) {
    d = new Date();
  }

  switch (unit) {
    case 'days': d.setDate(d.getDate() + amount); break;
    case 'hours': d.setTime(d.getTime() + amount * 60 * 60 * 1000); break;
    case 'minutes': d.setTime(d.getTime() + amount * 60 * 1000); break;
  }
  return formatDateTime(d);
}

function readJSON(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function writeJSON(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function escapeMarkdown(text) {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}

/**
 * Find a free port starting from defaultPort
 * Checks ss -tuln to avoid conflicts
 */
async function getFreePort(defaultPort) {
  let port = defaultPort;
  const maxAttempts = 100;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await runCommand(`ss -tuln | grep ":${port} " 2>/dev/null`);
      if (!result || result.trim() === '') return port;
      port++;
    } catch {
      // grep returns error code 1 when no match = port is free
      return port;
    }
  }
  return port;
}

module.exports = { isAdmin, generateUUID, formatDate, formatDateTime, getExpiryDate, adjustExpiry, readJSON, writeJSON, escapeMarkdown, getFreePort };
