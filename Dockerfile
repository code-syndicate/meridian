FROM oven/bun:1.3-alpine

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV NODE_ENV=development
ENV PORT=10000
EXPOSE 10000

# The database is rebuilt on every start because free hosting has no
# persistent disk. Seeding failures must not stop the server from booting.
CMD ["sh", "-c", "bun scripts/seed-demo.ts || true; exec bun src/index.ts"]
