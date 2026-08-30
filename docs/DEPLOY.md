# Deploying the demo

The app is a long-running Express process that writes to a SQLite file. It
needs a real server, not a serverless function: three background timers (price
feed, news feed, deposit poller) and an SSE endpoint only work in a process
that outlives a request.

## Render, free plan

    render.yaml is committed. Point Render at this repo and it picks it up.

Set these three in the dashboard (they are `sync: false`, so they are not in
the repo):

| Variable | Value |
|---|---|
| `SESSION_SECRET` | 32+ random characters |
| `TOTP_ENCRYPTION_KEY` | 32+ random characters |
| `CUSTODY_MNEMONIC` | output of `bun run new-mnemonic` |
| `DEMO_PASSWORD` | optional, defaults to `demo1234` |

Generate the secrets with:

    head -c 48 /dev/urandom | base64

### What the free plan costs you

**No persistent disk.** The database resets on every deploy and every time the
service wakes from sleep. `scripts/seed-demo.ts` runs at boot and rebuilds a
working demo, so the site is never empty, but anything a stakeholder does
between restarts is lost. Say so before the demo rather than during it.

**Sleeps after inactivity.** The first request after a sleep takes roughly 30
to 60 seconds while the container starts. Open the site a minute before anyone
else does.

To keep data, add a Render disk mounted at `/var/data` and set
`DATABASE_PATH=/var/data/meridian.db`. Disks are a paid feature; nothing else
about the deployment changes.

### Why NODE_ENV is not production

`production` refuses the sandbox and HD custody providers, because both hold or
fake keys in ways a real deployment must not. A demo has no custodian behind
it, so it runs as `development` on purpose. Do not carry that setting into a
real deployment.

## Seeded accounts

All three use `DEMO_PASSWORD` (default `demo1234`):

- `admin@meridian.demo` — admin, sees the back office at `/admin`
- `alice@meridian.demo` — verified, holds BTC, ETH and USDT
- `bob@meridian.demo` — unverified, holds SOL, has a verification application
  waiting in the admin queue

## Running the image locally

    docker build -t meridian .
    docker run --rm -p 10000:10000 \
      -e SESSION_SECRET="$(head -c 48 /dev/urandom | base64)" \
      -e TOTP_ENCRYPTION_KEY="$(head -c 48 /dev/urandom | base64)" \
      -e DATABASE_PATH=/tmp/meridian.db \
      meridian

## Other hosts

Anything that runs a container with a persistent disk works unchanged: Fly.io,
Railway, a VPS. Vercel does not: it runs Node rather than Bun, has no
persistent filesystem, and kills the background pollers.
