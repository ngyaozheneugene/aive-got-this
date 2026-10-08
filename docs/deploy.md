# Redeploy the live box

The live desk is `https://54.179.142.4.sslip.io/desk`, on the Lightsail instance `dispatch-coordinator` (Singapore). It runs `main` with Docker Compose, on Postgres.

## After merging to main

1. Open the terminal: Lightsail console → instance `dispatch-coordinator` → **Connect** → **Connect using SSH**.
2. Paste this one line:

```bash
cd ~/aive-got-this && git pull --ff-only && bash scripts/redeploy.sh
```

It finishes with `Deployed <commit>. Health: {...}`. That takes a few minutes, mostly the image build.

[`scripts/redeploy.sh`](../scripts/redeploy.sh) does the following:
- pulls `main` and makes sure `.env` has `USE_MEMORY_DB=false`;
- rebuilds `app` and `optimizer`, and **stops if the build fails**, so the site keeps the previous build rather than half-updating;
- recreates only those two containers, leaving Caddy, the certificate and Postgres untouched;
- waits until `/health` reports `"databaseOk":true`.

## Check it from anywhere

```bash
curl -s https://54.179.142.4.sslip.io/health
```

The current build reports `"database":"postgres","databaseOk":true` and a `boardVersion`. For a demo, open `https://54.179.142.4.sslip.io/desk?mode=simulation`. To start the sample day fresh, use **Reset the demo day** there, or:

```bash
curl -s -X POST -H 'x-workspace: simulation' https://54.179.142.4.sslip.io/api/demo/reset
```

A reset without that header is refused (403): the company's own workspace cannot be reset.

## If something goes wrong

These are run in the box terminal. The first shows what the app is complaining about:

```bash
cd ~/aive-got-this && docker compose logs --tail 50 app
```

To get the site up immediately on the in-memory board while you look into it:

```bash
cd ~/aive-got-this && sed -i 's/^USE_MEMORY_DB=.*/USE_MEMORY_DB=true/' .env && docker compose up -d --force-recreate app
```

To go back to an earlier commit, replace `<commit>` with its hash:

```bash
cd ~/aive-got-this && git checkout <commit> && docker compose build app optimizer && docker compose up -d --force-recreate app optimizer
```

The next `redeploy.sh` puts it back on `main`.

## Never

- `docker compose down -v`. It deletes the volumes: the TLS certificate and all Postgres data.
- `docker compose up -d --build` on its own. It has left containers running the old image while reporting success. Use the script.
