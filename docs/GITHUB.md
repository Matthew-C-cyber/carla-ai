# Putting Carla on GitHub

## 1. Create the repository

1. On GitHub: **New repository** → name `carla-ai` → **Public** → leave *Add a README* **unchecked** (the project has one) → Create.

## 2. First push

From the unzipped `carla-ai` folder on your computer:

```bash
npm install                 # creates package-lock.json (commit it: CI and the server use it)
git init
git add .
git status                  # make sure .env and data/ are NOT listed
git commit -m "Initial commit: Carla AI Discord bot"
git branch -M main
git remote add origin https://github.com/Matthew-C-cyber/carla-ai.git
git push -u origin main
```

If Git asks for a password, use a **personal access token** (GitHub → Settings → Developer settings → Personal access tokens) or sign in with GitHub Desktop / `gh auth login`.

Then open the **Actions** tab: the CI workflow (type-check, tests, build) should go green.

## 3. Polish the repo page

- Replace `Matthew-C-cyber` in the README badge and in `docs/DEPLOY_AWS.md`.
- **About** (gear icon on the repo page): a one-line description, plus topics such as `discord-bot`, `typescript`, `google-calendar-api`, `google-tasks-api`, `sqlite`, `aws`, `cron`.
- Add a screenshot or short GIF of `/tasks list` and a reminder DM to the README (save it as `docs/demo.gif` and add `![Demo](docs/demo.gif)` under the title). This is the first thing recruiters look at.
- **Pin** the repo on your GitHub profile.

## 4. Day-to-day workflow

```bash
git checkout -b feature/task-lists     # work on a branch
# ...edit, then:
npm run typecheck && npm test
git add -A && git commit -m "Add support for multiple task lists"
git push -u origin feature/task-lists  # open a Pull Request on GitHub, let CI pass, merge
```

Small, descriptive commits read much better in a commit history than one giant "update" commit.

## 5. If you ever commit a secret

Removing it in a new commit is **not** enough, because it stays in the history. Rotate it immediately:

- Discord token: Developer Portal → Bot → **Reset Token**.
- Google client secret: Cloud Console → Clients → your client → **Reset secret**.

Then update `.env` locally and on the server.

## 6. Resume line

Once it's deployed and a few people use it, run `/stats` in Discord and put real numbers in the bullet, for example: *"…used by 12 people across 3 servers, 400+ commands run and 150+ automated reminders sent."*
