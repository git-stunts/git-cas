FROM ubuntu:24.04 AS ubuntu-base
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

FROM node:22 AS node-runtime
FROM oven/bun:1 AS bun-runtime
FROM denoland/deno:ubuntu-2.7.1 AS deno-runtime

# --- Node ---
FROM ubuntu-base AS node
COPY --from=node-runtime /usr/local/ /usr/local/
RUN npm install -g pnpm@10
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV GIT_STUNTS_DOCKER=1
CMD ["pnpm", "vitest", "run", "test/unit"]

# --- Bun ---
FROM ubuntu-base AS bun
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY --from=bun-runtime /usr/local/bin/bunx /usr/local/bin/bunx
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .
ENV GIT_STUNTS_DOCKER=1
CMD ["bunx", "vitest", "run", "test/unit"]

# --- Deno ---
FROM ubuntu-base AS deno
COPY --from=deno-runtime /usr/bin/deno /usr/local/bin/deno
WORKDIR /app
COPY package.json ./
RUN deno install --allow-scripts || true
COPY . .
RUN deno install --allow-scripts
ENV GIT_STUNTS_DOCKER=1
CMD ["deno", "run", "-A", "npm:vitest", "run", "test/unit"]
