# Deploying

The app is a long-running Express process: three background timers (price feed,
news feed, deposit poller) and an SSE endpoint only work in a process that
outlives a request, so it needs a real server rather than a serverless function.

Storage is libSQL through `@libsql/client`. `DATABASE_PATH` takes either a local
file path or a remote URL, so the same code runs against a file in development
and against Turso in a deployment.

## The database

Free hosting has no persistent disk, so a deployed instance keeps its data in a
remote Turso database instead of on the filesystem.

    turso db create meridian
    turso db show meridian --url          # DATABASE_PATH
    turso db tokens create meridian       # DATABASE_AUTH_TOKEN

Migrations run at process start, so a fresh database needs no separate step.

## Render, free plan

    render.yaml is committed. Point Render at this repo and it picks it up.

Set these in the dashboard (they are `sync: false`, so they are not in the
repo):

| Variable | Value |
|---|---|
| `DATABASE_PATH` | `libsql://<name>-<org>.turso.io` |
| `DATABASE_AUTH_TOKEN` | token from `turso db tokens create` |
| `SESSION_SECRET` | 32+ random characters |
| `TOTP_ENCRYPTION_KEY` | 32+ random characters |
| `CUSTODY_MNEMONIC` | output of `bun run new-mnemonic` |
| `DEMO_PASSWORD` | optional, defaults to `demo1234` |

Generate the secrets with:

    head -c 48 /dev/urandom | base64

### What the free plan costs you

**Sleeps after inactivity.** The first request after a sleep takes roughly 30
to 60 seconds while the container starts. Open the site a minute before anyone
else does.

**Every query is a network round trip.** Against a remote database a write
takes tens of milliseconds where a local file took microseconds. It is fine for
a demo and for ordinary use; it is not fine for bulk work in a loop. Put the
Turso database in the same region as the Render service.

The filesystem is still ephemeral, but nothing depends on it any more: the data
lives in Turso and survives deploys and sleeps. `scripts/seed-demo.ts` runs at
boot and returns immediately when the database already has an admin account, so
restarts do not touch existing data.

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

A local path needs no `DATABASE_AUTH_TOKEN`. To run the image against Turso,
pass `DATABASE_PATH=libsql://...` and `DATABASE_AUTH_TOKEN=...` instead.

## Other hosts

Anything that runs a container works unchanged now that storage is remote:
Fly.io, Railway, a VPS. Vercel still does not: it runs Node rather than Bun and
kills the background pollers.
