// PM2 process file: keeps the bot alive, restarts it on crashes, and survives reboots (pm2 startup).
module.exports = {
  apps: [
    {
      name: 'carla-ai',
      script: 'dist/index.js',
      cwd: __dirname,
      // Keep this at 1: the cron scheduler must not run twice or users get duplicate DMs.
      instances: 1,
      autorestart: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
