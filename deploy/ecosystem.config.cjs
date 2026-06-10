// ──────────────────────────────────────────────────────────────────────────────
// CONFIG PM2 — proceso manager para mantener el backend corriendo 24/7
// Ubicación: en el root del repo o /home/USER/Eccomerce_mm/
// Uso:
//   cd ~/Eccomerce_mm/backend
//   pm2 start ../deploy/ecosystem.config.cjs
//   pm2 save
//   pm2 startup    # (correr el comando que te tira, hace que PM2 arranque con el server)
// ──────────────────────────────────────────────────────────────────────────────

module.exports = {
  apps: [
    {
      name: "igwtstore-backend",
      cwd:  "./backend",                  // Asumiendo que ejecutás desde la raíz del repo
      script: "src/index.js",
      interpreter: "node",

      // Reinicio automático si crashea
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",

      // Logs
      out_file: "/var/log/pm2/igwtstore-out.log",
      error_file: "/var/log/pm2/igwtstore-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",

      // Recursos: si el proceso usa más de 500MB, lo reinicia (anti memory leak)
      max_memory_restart: "500M",

      // Variables de entorno: se leen del .env del backend automáticamente
      // (no hace falta replicarlas aquí — dotenv ya las carga)
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
