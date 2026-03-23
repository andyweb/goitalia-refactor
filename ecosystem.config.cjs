module.exports = {
  apps: [{
    name: 'goitalia-impresa',
    script: '/usr/bin/tsx',
    args: 'server/src/index.ts',
    cwd: '/var/www/impresa-goitalia',
    env: {
      DATABASE_URL: 'postgres://goitalia:goitalia@localhost:5435/goitalia_impresa',
      PORT: 3102,
      SERVE_UI: 'true',
      PAPERCLIP_DEPLOYMENT_MODE: 'authenticated',
      PAPERCLIP_DEPLOYMENT_EXPOSURE: 'public',
      PAPERCLIP_AUTH_PUBLIC_BASE_URL: 'https://impresa.goitalia.eu',
      PAPERCLIP_MIGRATION_AUTO_APPLY: 'true',
      PAPERCLIP_STORAGE_PROVIDER: 'local_disk',
      PAPERCLIP_SECRETS_STRICT_MODE: 'false',
      PAPERCLIP_ALLOWED_HOSTNAMES: 'impresa.goitalia.eu',
      BETTER_AUTH_SECRET: '78a529301c8abf975cef10f8e909b18ff0b9336453a77e770343200bd052541b',
      PAPERCLIP_AGENT_JWT_SECRET: '2caea0e369f54708ba42dbb1e9a218778470a31d97d0e611301571c73422e19e'
    }
  }]
};
