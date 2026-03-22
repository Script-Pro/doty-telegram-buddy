module.exports = {
  // ⚠️ CHANGE THIS TOKEN - the one shown is exposed and must be revoked
  BOT_TOKEN: '8539244180:AAGtVmWibFBe29pypQVRAk_M8GOBeWQjPLg',
  
  // Admin Telegram ID
  ADMIN_ID: 8003638877,

  // Paths to dotycat scripts on VPS
  PATHS: {
    MENU: '/usr/local/sbin',
    XRAY_CONFIG: '/etc/xray',
    SSH_DB: '/etc/ssh-users',
    NGINX_CONF: '/etc/nginx',
    CERT_DIR: '/etc/letsencrypt/live',
    LOG_DIR: '/var/log',
    DOTY_DIR: '/root',
    VPN_DIR: '/etc/openvpn',
    SLOWDNS_DIR: '/etc/slowdns',
    ZIVPN_DIR: '/etc/zivpn',
    UDP_DIR: '/etc/udp',
  },

  // Default ports
  PORTS: {
    VLESS_TLS: 443,
    VLESS_NTLS: 80,
    VMESS_TLS: 443,
    VMESS_NTLS: 80,
    TROJAN_TLS: 443,
    TROJAN_NTLS: 80,
    SOCKS_TLS: 443,
    SOCKS_NTLS: 80,
    SSH_WS_TLS: 443,
    SSH_WS_NTLS: 80,
    SQUID_1: 3128,
    SQUID_2: 8080,
    OPENVPN_TCP: 1194,
    OPENVPN_UDP: 2200,
    OHP: 8000,
    ZIVPN: 5667,
    VMESS_TLS_CUSTOM: 2083,
    VMESS_NTLS_CUSTOM: 2082,
    VLESS_TLS_CUSTOM: 2087,
    VLESS_NTLS_CUSTOM: 2086,
  }
};
