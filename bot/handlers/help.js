const PAGES = [
  {
    title: '📖 AIDE — Page 1/6 — Protocoles VPN',
    content: `🔰 *VLESS / VMESS / TROJAN / SOCKS*
━━━━━━━━━━━━━━━━━━━━━
➕ *Créer* — Créer un compte (username, durée, limite conn, quota data)
✏️ *Modifier* — Changer username ou régénérer UUID/password
🗑 *Supprimer* — Supprimer un compte avec confirmation
🔄 *Renouveler* — Ajouter/retirer jours, heures ou minutes
📋 *Liste* — Voir tous les comptes créés
🔍 *Détails* — Infos complètes d'un compte
🔒 *Lock/Unlock* — Verrouiller/déverrouiller un compte
📊 *Trafic* — Voir upload/download en temps réel
📦 *Quota Data* — Définir limite en GB/MB (suspension auto)
🔢 *Limite Connexion* — Max connexions simultanées`
  },
  {
    title: '📖 AIDE — Page 2/6 — SSH & OpenVPN',
    content: `🔑 *SSH*
━━━━━━━━━━━━━━━━━━━━━
Mêmes fonctionnalités que les protocoles VPN ci-dessus.
Le compte SSH supporte WebSocket TLS/NTLS.
Les comptes sont créés comme utilisateurs Linux.

🌐 *OPENVPN*
━━━━━━━━━━━━━━━━━━━━━
➕ *Créer Client* — Génère un fichier .ovpn
🗑 *Supprimer* — Révoquer un client
📋 *Liste* — Voir tous les clients
🔄 *Restart* — Redémarrer TCP ou UDP
📊 *Status* — État des services TCP/UDP`
  },
  {
    title: '📖 AIDE — Page 3/6 — UDP / ZIVPN / SlowDNS',
    content: `🔌 *UDP CUSTOM*
━━━━━━━━━━━━━━━━━━━━━
Gestion complète des comptes UDP Custom.
Status/Restart du service, config, quotas et limites.

📱 *ZIVPN*
━━━━━━━━━━━━━━━━━━━━━
Gestion complète des comptes ZIVPN (port 5667 UDP).
Mêmes options : créer, modifier, supprimer, renouveler, trafic, quota.

📡 *DNS / SLOWDNS*
━━━━━━━━━━━━━━━━━━━━━
Gestion des comptes SlowDNS avec clé NS.
Créer, modifier, supprimer, renouveler + quotas et limites.`
  },
  {
    title: '📖 AIDE — Page 4/6 — Outils Serveur',
    content: `🌍 *DOMAIN* — Configurer le domaine du serveur
🔧 *PORTS* — Voir et gérer les ports ouverts
📊 *STATUS* — État de tous les services
📋 *LOGS* — Consulter les logs système/xray
💾 *BACKUP* — Sauvegarder et restaurer la configuration
🛡️ *NETGUARD* — Protection réseau et ban IP
🧪 *SPEEDTEST* — Tester la vitesse du serveur
🔐 *FIREWALL* — Gérer les règles iptables`
  },
  {
    title: '📖 AIDE — Page 5/6 — Administration',
    content: `👥 *ADMINS* — Gérer les administrateurs du bot
📢 *BROADCAST* — Envoyer un message à tous les utilisateurs
⏰ *AUTO-EXPIRE* — Suppression auto des comptes expirés
📊 *STATS* — Statistiques globales du serveur
📦 *MULTI-SERVER* — Gérer plusieurs serveurs
🕐 *TRIAL* — Créer des comptes d'essai temporaires
📱 *QR CODE* — Générer des QR codes de connexion
🛡️ *MONITOR* — Surveillance et alertes automatiques
📋 *AUDIT* — Journal des actions admin`
  },
  {
    title: '📖 AIDE — Page 6/6 — Commandes',
    content: `📌 *Commandes disponibles:*
━━━━━━━━━━━━━━━━━━━━━
/start — Menu principal
/menu — Menu principal (alias)
/help — Cette aide
━━━━━━━━━━━━━━━━━━━━━

💡 *Astuces:*
• Les boutons ⬅️ et ➡️ naviguent dans les listes
• 🏠 ACCUEIL ramène au menu principal
• 🔙 Retour revient au menu précédent
• Les messages sont mis à jour au lieu d'en créer de nouveaux
• Le quota se définit en GB ou MB (ex: 5GB, 500MB)
• Limite connexion 0 = illimité
• Le moniteur de trafic vérifie les quotas toutes les 5 min`
  }
];

function showHelp(bot, chatId, page = 0) {
  const p = PAGES[page];
  const kb = [];
  const navRow = [];
  if (page > 0) navRow.push({ text: '⬅️ Précédent', callback_data: `help_page_${page - 1}` });
  navRow.push({ text: `📄 ${page + 1}/${PAGES.length}`, callback_data: 'noop' });
  if (page < PAGES.length - 1) navRow.push({ text: '➡️ Suivant', callback_data: `help_page_${page + 1}` });
  kb.push(navRow);
  kb.push([{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]);

  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━\n${p.title}\n━━━━━━━━━━━━━━━━━━━━━\n${p.content}\n━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }
  );
}

function handleCallback(bot, chatId, data, query) {
  const msgId = query?.message?.message_id;
  if (data.startsWith('help_page_')) {
    const page = parseInt(data.replace('help_page_', '')) || 0;
    const p = PAGES[page];
    const kb = [];
    const navRow = [];
    if (page > 0) navRow.push({ text: '⬅️ Précédent', callback_data: `help_page_${page - 1}` });
    navRow.push({ text: `📄 ${page + 1}/${PAGES.length}`, callback_data: 'noop' });
    if (page < PAGES.length - 1) navRow.push({ text: '➡️ Suivant', callback_data: `help_page_${page + 1}` });
    kb.push(navRow);
    kb.push([{ text: '🏠 ACCUEIL', callback_data: 'back_main' }]);

    const text = `━━━━━━━━━━━━━━━━━━━━━\n${p.title}\n━━━━━━━━━━━━━━━━━━━━━\n${p.content}\n━━━━━━━━━━━━━━━━━━━━━`;
    if (msgId) {
      bot.editMessageText(text, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(() => {});
    }
  }
}

module.exports = { showHelp, handleCallback };
