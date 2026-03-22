const { runCommand, getDomain, getServerIP } = require('../utils/exec');
const { getExpiryDate, adjustExpiry } = require('../utils/helpers');
const { paginatedKeyboard, getPageFromCallback } = require('../utils/pagination');
const { getSSHTraffic, formatBytes, parseLimitToBytes, setDataLimit, getDataLimit, removeDataLimit, setConnLimit, getConnLimit } = require('../utils/traffic');
const { autoDeleteSend } = require('../utils/autodelete');
const fs = require('fs');

const USERS_DB = '/etc/ssh-users';
const PROTO = 'ssh';
const UDP_CONFIG = '/etc/UDPCustom/config.json';

function editOrSend(bot, chatId, msgId, text, opts = {}) {
  if (msgId) return bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...opts }).catch(() => bot.sendMessage(chatId, text, opts));
  return bot.sendMessage(chatId, text, opts);
}

function backBtns() {
  return { inline_keyboard: [[{ text: '🔙 Retour', callback_data: `menu_${PROTO}` }], [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]] };
}

function showMenu(bot, chatId, msgId) {
  const text = `━━━━━━━━━━━━━━━━━━━━━\n🔑 *SSH MENU*\n━━━━━━━━━━━━━━━━━━━━━`;
  const opts = { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
    [{ text: '➕ Créer', callback_data: 'ssh_create' }, { text: '✏️ Modifier', callback_data: 'ssh_modify' }],
    [{ text: '🔄 Renouveler', callback_data: 'ssh_renew' }, { text: '🗑 Supprimer', callback_data: 'ssh_delete' }],
    [{ text: '📋 Liste', callback_data: 'ssh_list' }, { text: '🔍 Détails', callback_data: 'ssh_detail' }],
    [{ text: '🔒 Lock/Unlock', callback_data: 'ssh_lockuser' }],
    [{ text: '📊 Trafic', callback_data: 'ssh_traffic' }, { text: '📦 Quota Data', callback_data: 'ssh_quota' }],
    [{ text: '🔢 Limite Connexion', callback_data: 'ssh_connlimit' }],
    [{ text: '🏠 ACCUEIL', callback_data: 'back_main' }],
  ]}};
  editOrSend(bot, chatId, msgId, text, opts);
}

async function getUsers() {
  try {
    if (!fs.existsSync(USERS_DB)) return [];
    const files = fs.readdirSync(USERS_DB);
    return files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
  } catch { return []; }
}

async function handleCallback(bot, chatId, data, query, pendingActions) {
  const msgId = query?.message?.message_id;
  const P = 'ssh';

  // --- GESTION DE LA PAGINATION ---
  if (data.startsWith(`${P}_pgl_`)) return showPaginatedList(bot, chatId, msgId, `${P}_del_`, `${P}_pgl_`, getPageFromCallback(data, `${P}_pgl_`));
  if (data.startsWith(`${P}_pgr_`)) return showPaginatedList(bot, chatId, msgId, `${P}_ren_`, `${P}_pgr_`, getPageFromCallback(data, `${P}_pgr_`));
  if (data.startsWith(`${P}_pgd_`)) return showPaginatedList(bot, chatId, msgId, `${P}_det_`, `${P}_pgd_`, getPageFromCallback(data, `${P}_pgd_`));
  if (data.startsWith(`${P}_pglk_`)) return showPaginatedList(bot, chatId, msgId, `${P}_lck_`, `${P}_pglk_`, getPageFromCallback(data, `${P}_pglk_`));

  // --- ROUTAGE DES BOUTONS DU MENU ---
  switch (data) {
    case `${P}_create`:
      editOrSend(bot, chatId, msgId, '📝 Nom d\'utilisateur SSH:');
      pendingActions[chatId] = { action: `${P}_create`, step: 'username', handler: handleCreateFlow, fromId: query.from.id, fromName: query.from.first_name || query.from.username || String(query.from.id) };
      return;
    case `${P}_list`: return await listUsers(bot, chatId, msgId);
    case `${P}_delete`: return await showPaginatedList(bot, chatId, msgId, `${P}_del_`, `${P}_pgl_`, 0);
    case `${P}_renew`: return await showPaginatedList(bot, chatId, msgId, `${P}_ren_`, `${P}_pgr_`, 0);
    case `${P}_detail`: return await showPaginatedList(bot, chatId, msgId, `${P}_det_`, `${P}_pgd_`, 0);
    case `${P}_lockuser`: return await showPaginatedList(bot, chatId, msgId, `${P}_lck_`, `${P}_pglk_`, 0);
    case `${P}_modify`: 
    case `${P}_traffic`: 
    case `${P}_quota`: 
    case `${P}_connlimit`: 
      return editOrSend(bot, chatId, msgId, '🚧 Fonctionnalité en cours de développement...', { reply_markup: backBtns() });
  }

  // --- ACTIONS SUR LES UTILISATEURS SÉLECTIONNÉS ---
  
  // 1. SUPPRIMER
  if (data.startsWith(`${P}_del_`)) {
    const user = data.replace(`${P}_del_`, '');
    editOrSend(bot, chatId, msgId, `⚠️ Êtes-vous sûr de vouloir supprimer *${user}* ?`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '✅ Oui, Supprimer', callback_data: `${P}_dely_${user}` }, { text: '❌ Annuler', callback_data: `menu_${PROTO}` }]] } });
  }
  else if (data.startsWith(`${P}_dely_`)) {
    await deleteUser(bot, chatId, msgId, data.replace(`${P}_dely_`, ''));
  }
  
  // 2. RENOUVELER
  else if (data.startsWith(`${P}_ren_`)) {
    const user = data.replace(`${P}_ren_`, '');
    editOrSend(bot, chatId, msgId, `🔄 Combien de jours ajouter à *${user}* ?`);
    pendingActions[chatId] = { action: `${P}_renew`, step: 'days', username: user, handler: handleRenewFlow };
  }
  
  // 3. LOCK / UNLOCK
  else if (data.startsWith(`${P}_lck_`)) {
    await toggleLockUser(bot, chatId, msgId, data.replace(`${P}_lck_`, ''));
  }
  
  // 4. DÉTAILS
  else if (data.startsWith(`${P}_det_`)) {
    await showUserDetails(bot, chatId, msgId, data.replace(`${P}_det_`, ''));
  }
}

async function showPaginatedList(bot, chatId, msgId, prefix, pagePrefix, page) {
  const users = await getUsers();
  if (!users.length) { editOrSend(bot, chatId, msgId, '📋 Aucun utilisateur trouvé.', { reply_markup: backBtns() }); return; }
  editOrSend(bot, chatId, msgId, '👤 Sélectionnez un utilisateur :', paginatedKeyboard(users, prefix, pagePrefix, page, `menu_${PROTO}`));
}

// ==========================================
// FLUX DE CRÉATION
// ==========================================
async function handleCreateFlow(bot, chatId, text, pending, pendingActions) {
  if (pending.step === 'username') { pending.username = text.trim(); pending.step = 'password'; autoDeleteSend(bot, chatId, '🔑 Mot de passe:'); }
  else if (pending.step === 'password') { pending.password = text.trim(); pending.step = 'days'; autoDeleteSend(bot, chatId, '📅 Durée (jours):'); }
  else if (pending.step === 'days') {
    const days = parseInt(text);
    if (isNaN(days) || days < 1) { autoDeleteSend(bot, chatId, '❌ Invalide.'); delete pendingActions[chatId]; return; }
    pending.days = days; pending.step = 'connlimit';
    autoDeleteSend(bot, chatId, '🔢 Limite connexions (0 = illimité):');
  }
  else if (pending.step === 'connlimit') {
    const limit = parseInt(text);
    if (isNaN(limit) || limit < 0) { autoDeleteSend(bot, chatId, '❌ Invalide.'); delete pendingActions[chatId]; return; }
    pending.connLimit = limit; pending.step = 'datalimit';
    autoDeleteSend(bot, chatId, '📦 Limite données (ex: `5GB`, `0` = illimité):', { parse_mode: 'Markdown' });
  }
  else if (pending.step === 'datalimit') {
    delete pendingActions[chatId];
    let dataLimitBytes = 0;
    if (text.trim() !== '0') { 
        dataLimitBytes = parseLimitToBytes(text.trim()); 
        if (dataLimitBytes === null) { autoDeleteSend(bot, chatId, '❌ Format invalide.'); return; } 
    }
    await createUser(bot, chatId, pending.username, pending.password, pending.days, pending.connLimit, dataLimitBytes, pending.fromId, pending.fromName);
  }
}

async function createUser(bot, chatId, username, password, days, connLimit, dataLimitBytes, createdById, createdByName) {
  try {
    const expiry = getExpiryDate(days);
    const domain = await getDomain();
    const ip = await getServerIP();
    
    // Création du compte SSH Linux
    await runCommand(`useradd -e $(date -d "+${days} days" +%Y-%m-%d) -s /bin/false -M ${username} 2>/dev/null || true`);
    await runCommand(`echo "${username}:${password}" | chpasswd`);
    
    // Application de la limite de connexion système
    if (connLimit > 0) {
        await runCommand(`echo "${username} hard maxlogins ${connLimit}" >> /etc/security/limits.conf`);
    }

    if (!fs.existsSync(USERS_DB)) fs.mkdirSync(USERS_DB, { recursive: true });
    
    const userInfo = { username, password, expiry, locked: false, connLimit, dataLimit: dataLimitBytes, createdBy: createdByName || String(createdById || 'unknown'), createdById: createdById || null };
    fs.writeFileSync(`${USERS_DB}/${username}.json`, JSON.stringify(userInfo, null, 2), 'utf8');
    
    if (connLimit > 0) await setConnLimit(PROTO, username, connLimit);
    if (dataLimitBytes > 0) await setDataLimit(PROTO, username, dataLimitBytes);

    // INTÉGRATION AUTOMATIQUE UDP CUSTOM
    try {
        let udpConf = { auth: { mode: "passwords", config: [] } };
        if (fs.existsSync(UDP_CONFIG)) {
            udpConf = JSON.parse(fs.readFileSync(UDP_CONFIG, 'utf8'));
        }
        if (!udpConf.auth.config.includes(password)) {
            udpConf.auth.config.push(password);
            fs.writeFileSync(UDP_CONFIG, JSON.stringify(udpConf, null, 2), 'utf8');
            await runCommand('systemctl restart udp-custom 2>/dev/null || true');
        }
    } catch(e) { console.error("Erreur auto UDP:", e); }

    // Récupération clés SlowDNS & NS
    let slowDnsPub = "N/A";
    let nsDomain = "N/A";
    try { slowDnsPub = (await runCommand('cat /etc/slowdns/server.pub 2>/dev/null')).trim() || "N/A"; } catch(e){}
    try { nsDomain = (await runCommand('cat /etc/slowdns/nsdomain 2>/dev/null')).trim() || "N/A"; } catch(e){}

    // FORMAT DOTYWRT ASCII
    const msg = `\`\`\`text
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃               SSH ACCOUNT DETAILS                ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Username    : ${username}
┃ Password    : ${password}
┃ Expiry Date : ${expiry}
┃ Host/IP     : ${ip}
┃ Domain      : ${domain}
┃ NS Domain   : ${nsDomain}
●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●
┃ OpenSSH      : 22
┃ Dropbear     : 109, 143
┃ Stunnel      : 447, 777
┃ WS NTLS      : 80
┃ WS TLS       : 443
┃ UDPGW        : 7100–7900
┃ Squid        : 3128, 8080
┃ OpenVPN      : TCP 1194, SSL 2200, OHP 8000
┃ Slow DNS     : 22,53,5300,80,443
●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●
┃ UDP Custom
┃ ${domain}:1-65535@${username}:${password}
●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●
┃ Slow DNS
┃ PUB : ${slowDnsPub}
●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●
┃ OpenVPN File
┃ Download     : https://${domain}:2081
●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●
┃ Payload
┃ GET / HTTP/1.1[crlf]Host: ${domain}[crlf]Upgrade: websocket[crlf][crlf]
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
\`\`\``;

    bot.sendMessage(chatId, msg, { parse_mode: 'MarkdownV2', reply_markup: backBtns() });

  } catch (err) { bot.sendMessage(chatId, `❌ Erreur lors de la création SSH: ${err.message}`); }
}

// ==========================================
// ACTIONS (LISTE, DELETE, RENEW, LOCK, DETAILS)
// ==========================================

async function listUsers(bot, chatId, msgId) {
  const users = await getUsers();
  if (!users.length) return editOrSend(bot, chatId, msgId, '📋 Aucun utilisateur SSH.', { reply_markup: backBtns() });
  
  let text = `━━━━━━━━━━━━━━━━━━━━━\n📋 *SSH Users*\n━━━━━━━━━━━━━━━━━━━━━\n`;
  for (const u of users) { 
    try { 
      const d = JSON.parse(fs.readFileSync(`${USERS_DB}/${u}.json`, 'utf8')); 
      text += `👤 ${u} | 📅 ${d.expiry} | ${d.locked ? '🔒' : '🔓'}\n`; 
    } catch { 
      text += `👤 ${u} (Erreur de lecture)\n`; 
    } 
  }
  editOrSend(bot, chatId, msgId, text, { parse_mode: 'Markdown', reply_markup: backBtns() });
}

async function deleteUser(bot, chatId, msgId, username) {
  try {
    // 1. Suppression du système Linux
    await runCommand(`userdel -f ${username} 2>/dev/null || true`);
    
    // 2. Retrait de UDP Custom
    try {
        if (fs.existsSync(UDP_CONFIG) && fs.existsSync(`${USERS_DB}/${username}.json`)) {
            const userInfo = JSON.parse(fs.readFileSync(`${USERS_DB}/${username}.json`, 'utf8'));
            let udpConf = JSON.parse(fs.readFileSync(UDP_CONFIG, 'utf8'));
            udpConf.auth.config = udpConf.auth.config.filter(pwd => pwd !== userInfo.password);
            fs.writeFileSync(UDP_CONFIG, JSON.stringify(udpConf, null, 2), 'utf8');
            await runCommand('systemctl restart udp-custom 2>/dev/null || true');
        }
    } catch(e) { console.error("Erreur suppression UDP:", e); }

    // 3. Suppression fichiers de la DB
    if (fs.existsSync(`${USERS_DB}/${username}.json`)) {
        fs.unlinkSync(`${USERS_DB}/${username}.json`);
    }
    await removeDataLimit(PROTO, username);
    
    editOrSend(bot, chatId, msgId, `✅ Compte SSH *${username}* supprimé avec succès.`, { parse_mode: 'Markdown', reply_markup: backBtns() });
  } catch (err) {
    editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`, { reply_markup: backBtns() });
  }
}

async function handleRenewFlow(bot, chatId, text, pending, pendingActions) {
    const days = parseInt(text);
    if (isNaN(days) || days < 1) { 
        bot.sendMessage(chatId, '❌ Invalide. Annulation.'); 
        delete pendingActions[chatId]; 
        return; 
    }
    
    const username = pending.username;
    delete pendingActions[chatId];

    try {
        const userInfoPath = `${USERS_DB}/${username}.json`;
        if (!fs.existsSync(userInfoPath)) throw new Error("Utilisateur introuvable dans la base de données.");
        
        const userInfo = JSON.parse(fs.readFileSync(userInfoPath, 'utf8'));
        
        // Calcul de la nouvelle date (ajouter à la date actuelle ou à l'expiration si pas encore expiré)
        const expDate = new Date(userInfo.expiry);
        const now = new Date();
        const baseDate = (expDate > now) ? expDate : now;
        baseDate.setDate(baseDate.getDate() + days);
        const newExpiryStr = baseDate.toISOString().split('T')[0];
        
        // Mise à jour système Linux
        await runCommand(`usermod -e ${newExpiryStr} ${username} 2>/dev/null`);
        
        // Sauvegarde
        userInfo.expiry = newExpiryStr;
        fs.writeFileSync(userInfoPath, JSON.stringify(userInfo, null, 2), 'utf8');

        bot.sendMessage(chatId, `✅ Le compte *${username}* a été renouvelé.\nNouvelle date d'expiration : ${newExpiryStr}`, { parse_mode: 'Markdown', reply_markup: backBtns() });

    } catch (err) {
        bot.sendMessage(chatId, `❌ Erreur lors du renouvellement: ${err.message}`, { reply_markup: backBtns() });
    }
}

async function toggleLockUser(bot, chatId, msgId, username) {
  try {
    const userInfoPath = `${USERS_DB}/${username}.json`;
    if (!fs.existsSync(userInfoPath)) throw new Error("Utilisateur introuvable.");
    
    const userInfo = JSON.parse(fs.readFileSync(userInfoPath, 'utf8'));
    const isCurrentlyLocked = userInfo.locked;
    
    if (isCurrentlyLocked) {
        await runCommand(`usermod -U ${username} 2>/dev/null`); // Débloquer sur Linux
        userInfo.locked = false;
    } else {
        await runCommand(`usermod -L ${username} 2>/dev/null`); // Bloquer sur Linux
        await runCommand(`killall -u ${username} 2>/dev/null || true`); // Déconnecter
        userInfo.locked = true;
    }
    
    fs.writeFileSync(userInfoPath, JSON.stringify(userInfo, null, 2), 'utf8');
    
    editOrSend(bot, chatId, msgId, `✅ Compte *${username}* ${userInfo.locked ? 'bloqué 🔒' : 'débloqué 🔓'}.`, { parse_mode: 'Markdown', reply_markup: backBtns() });
  } catch (err) {
    editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`, { reply_markup: backBtns() });
  }
}

async function showUserDetails(bot, chatId, msgId, username) {
    try {
        const userInfoPath = `${USERS_DB}/${username}.json`;
        if (!fs.existsSync(userInfoPath)) throw new Error("Utilisateur introuvable.");
        
        const userInfo = JSON.parse(fs.readFileSync(userInfoPath, 'utf8'));
        const activeConn = await countSSHConnections(username) || 0;
        const limitStr = userInfo.connLimit > 0 ? userInfo.connLimit : 'Illimité';
        
        let text = `━━━━━━━━━━━━━━━━━━━━━\n🔍 *Détails SSH: ${username}*\n━━━━━━━━━━━━━━━━━━━━━\n`;
        text += `🔑 Mot de passe : \`${userInfo.password}\`\n`;
        text += `📅 Expiration : ${userInfo.expiry}\n`;
        text += `🔒 Statut : ${userInfo.locked ? 'Bloqué' : 'Actif'}\n`;
        text += `🔢 Limite Connexion : ${limitStr}\n`;
        text += `👥 En ligne actuellement : ${activeConn}\n`;
        if (userInfo.dataLimit) text += `📦 Limite Data : ${formatBytes(userInfo.dataLimit)}\n`;
        
        editOrSend(bot, chatId, msgId, text, { parse_mode: 'Markdown', reply_markup: backBtns() });
    } catch(err) {
        editOrSend(bot, chatId, msgId, `❌ Erreur: ${err.message}`, { reply_markup: backBtns() });
    }
}

module.exports = { showMenu, handleCallback };
