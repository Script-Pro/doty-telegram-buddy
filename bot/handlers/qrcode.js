const { runCommand, getDomain } = require('../utils/exec');
const fs = require('fs');
const path = require('path');

const QR_DIR = path.join(__dirname, '..', 'data', 'qrcodes');

function showMenu(bot, chatId) {
  const buttons = [
    [{ text: '🔰 QR VLESS', callback_data: 'qr_vless' }],
    [{ text: '🔰 QR VMESS', callback_data: 'qr_vmess' }],
    [{ text: '🔰 QR TROJAN', callback_data: 'qr_trojan' }],
    [{ text: '📝 QR depuis texte', callback_data: 'qr_custom' }],
    [{ text: '🔙 Menu Principal', callback_data: 'back_main' }],
  ];

  bot.sendMessage(chatId,
    `━━━━━━━━━━━━━━━━━━━━━
📱 *QR CODE GENERATOR*
━━━━━━━━━━━━━━━━━━━━━
Générez des QR codes pour vos liens:
━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }
  );
}

async function generateQR(text, filename) {
  if (!fs.existsSync(QR_DIR)) fs.mkdirSync(QR_DIR, { recursive: true });
  const filePath = path.join(QR_DIR, filename);

  // Try qrencode first, then fallback to python
  try {
    await runCommand(`qrencode -o "${filePath}" -s 10 -m 2 "${text}"`);
  } catch {
    try {
      await runCommand(`python3 -c "
import qrcode
img = qrcode.make('${text.replace(/'/g, "\\'")}')
img.save('${filePath}')
"`);
    } catch {
      // Last resort: install qrencode
      await runCommand('apt-get install -y qrencode 2>/dev/null');
      await runCommand(`qrencode -o "${filePath}" -s 10 -m 2 "${text}"`);
    }
  }

  return filePath;
}

async function handleCallback(bot, chatId, data, query, pendingActions) {
  if (data === 'qr_vless' || data === 'qr_vmess' || data === 'qr_trojan') {
    const proto = data.replace('qr_', '');
    pendingActions[chatId] = {
      action: `qr_gen_${proto}`,
      handler: async (bot, cid, text, pending, pa) => {
        delete pa[cid];
        const username = text.trim();

        bot.sendMessage(cid, '⏳ Génération du QR code...');

        try {
          // Get user config
          const domain = await getDomain();
          let link = '';

          if (proto === 'vless') {
            const uuid = await runCommand(`grep -A 2 "### ${username}" /etc/xray/vless.json 2>/dev/null | grep '"id"' | cut -d'"' -f4`);
            link = `vless://${uuid.trim()}@${domain}:443?type=ws&security=tls&path=/vless&sni=${domain}#${username}`;
          } else if (proto === 'vmess') {
            const uuid = await runCommand(`grep -A 2 "### ${username}" /etc/xray/vmess.json 2>/dev/null | grep '"id"' | cut -d'"' -f4`);
            const vmessConfig = Buffer.from(JSON.stringify({
              v: '2', ps: username, add: domain, port: '443',
              id: uuid.trim(), aid: '0', net: 'ws', type: 'none',
              host: domain, path: '/vmess', tls: 'tls', sni: domain,
            })).toString('base64');
            link = `vmess://${vmessConfig}`;
          } else if (proto === 'trojan') {
            const uuid = await runCommand(`grep -A 2 "### ${username}" /etc/xray/trojan.json 2>/dev/null | grep '"password"' | cut -d'"' -f4`);
            link = `trojan://${uuid.trim()}@${domain}:443?type=ws&security=tls&path=/trojan&sni=${domain}#${username}`;
          }

          if (!link) {
            return bot.sendMessage(cid, `❌ Utilisateur "${username}" non trouvé pour ${proto.toUpperCase()}.`);
          }

          const filename = `${proto}_${username}_${Date.now()}.png`;
          const filePath = await generateQR(link, filename);

          await bot.sendPhoto(cid, filePath, {
            caption: `📱 QR Code ${proto.toUpperCase()} pour *${username}*`,
            parse_mode: 'Markdown',
          });

          // Cleanup
          try { fs.unlinkSync(filePath); } catch {}
        } catch (err) {
          bot.sendMessage(cid, `❌ Erreur: ${err.message}\n\n💡 Installez qrencode: \`apt install qrencode\``, { parse_mode: 'Markdown' });
        }
      },
    };
    bot.sendMessage(chatId, `📱 Entrez le nom d'utilisateur ${data.replace('qr_', '').toUpperCase()}:`);
  }

  if (data === 'qr_custom') {
    pendingActions[chatId] = {
      action: 'qr_custom_text',
      handler: async (bot, cid, text, pending, pa) => {
        delete pa[cid];
        bot.sendMessage(cid, '⏳ Génération du QR code...');

        try {
          const filename = `custom_${Date.now()}.png`;
          const filePath = await generateQR(text.trim(), filename);

          await bot.sendPhoto(cid, filePath, {
            caption: '📱 QR Code généré',
          });

          try { fs.unlinkSync(filePath); } catch {}
        } catch (err) {
          bot.sendMessage(cid, `❌ Erreur: ${err.message}`);
        }
      },
    };
    bot.sendMessage(chatId, '📝 Entrez le texte ou lien à encoder en QR code:');
  }
}

module.exports = { showMenu, handleCallback };
