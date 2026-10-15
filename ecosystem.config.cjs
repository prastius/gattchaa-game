// PM2 process file: `pm2 start ecosystem.config.cjs`
// Keep instances at 1 until you add @colyseus/redis-presence + redis-driver
// (needed for multiple processes to share matchmaking).
module.exports = {
  apps: [
    {
      name: "my-world",
      script: "server/build/index.js",
      node_args: "--enable-source-maps",
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: 2567,
      },
    },
  ],
};
