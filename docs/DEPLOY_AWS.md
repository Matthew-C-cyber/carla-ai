# Deploying Carla on AWS EC2

The bot only makes **outbound** connections (to Discord and Google), so it needs no open web ports, domain or load balancer. One small EC2 instance running PM2 is enough.

## 1. Launch the instance

1. In the AWS Console → **EC2 → Launch instance**.
2. **Name:** `carla-ai`. **AMI:** Ubuntu Server 24.04 LTS.
3. **Instance type:** `t3.micro` is plenty (check the AWS Free Tier page for what your account gets).
4. **Key pair:** create one (e.g. `carla-key`), download the `.pem` file and keep it safe.
5. **Network settings → Security group:** allow **SSH (22) from *My IP*** only. Nothing else is needed.
6. **Storage:** the default 8 GB is fine. Launch.

Set up a **billing alarm** (Billing → Budgets) so you're never surprised by a charge.

## 2. Connect and install Node.js and PM2

```bash
chmod 400 carla-key.pem
ssh -i carla-key.pem ubuntu@<your-instance-public-ip>

# On the server:
sudo apt-get update && sudo apt-get install -y git build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
node --version   # should print v22.x
```

Optional, but helps `npm ci` on a 1 GB instance:

```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 3. Get the code and configure it

```bash
git clone https://github.com/Matthew-C-cyber/carla-ai.git
cd carla-ai
cp .env.example .env
nano .env        # paste your real values (same ones that work locally)
```

If you're moving an existing `data/carla.db` from your laptop, keep the **same** `TOKEN_ENCRYPTION_KEY`, or everyone will need to reconnect Google. To copy the database up: `scp -i carla-key.pem data/carla.db ubuntu@<ip>:~/carla-ai/data/`.

## 4. Build, register and start

```bash
npm ci
npm run build
npm run register:prod
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup      # prints a command: copy and run it so the bot restarts after a reboot
```

Check it's running:

```bash
pm2 status
pm2 logs carla-ai     # Ctrl+C to exit
```

You should see `Logged in as Carla AI#1234` and `[scheduler] started`.

## 5. Updating after you push to GitHub

```bash
ssh -i carla-key.pem ubuntu@<ip>
cd carla-ai && bash scripts/update.sh
```

`update.sh` pulls, installs, builds, re-registers commands and reloads PM2.

## 6. Backups

All state lives in `~/carla-ai/data/carla.db`. The simplest backup is an EBS snapshot (EC2 → Volumes → *Create snapshot*), or automate it with **Data Lifecycle Manager**. A manual copy works too:

```bash
scp -i carla-key.pem ubuntu@<ip>:~/carla-ai/data/carla.db ./carla-backup.db
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Missing required environment variable` | A value in `.env` is empty. |
| Commands don't appear in Discord | Run `npm run register:prod`; with no `DISCORD_GUILD_ID`, restart your Discord client. |
| "Google connection expired" after ~7 days | Your OAuth app is still in *Testing*. Publish it (see README, step 2.5). |
| No reminder DMs | The user has DMs from server members turned off, or `/settings reminders` is 0. |
| Instance is slow during `npm ci` | Add the swap file above. |
