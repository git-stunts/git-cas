FROM ubuntu:24.04 AS ubuntu-base
ENV DEBIAN_FRONTEND=noninteractive
RUN set -eux; \
    for attempt in 1 2 3 4 5; do \
      apt-get update \
      && apt-get install -y --no-install-recommends ca-certificates git \
      && break; \
      if [ "$attempt" -eq 5 ]; then exit 1; fi; \
      rm -rf /var/lib/apt/lists/*; \
      sleep "$((attempt * 5))"; \
    done; \
    groupadd --system gitstunts; \
    useradd --system --gid gitstunts --create-home --shell /usr/sbin/nologin gitstunts; \
    rm -rf /var/lib/apt/lists/*

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
RUN chown -R gitstunts:gitstunts /app
ENV GIT_STUNTS_DOCKER=1
ENV HOME=/home/gitstunts
USER gitstunts
CMD ["pnpm", "vitest", "run", "test/unit"]

# --- Bun ---
FROM ubuntu-base AS bun
COPY --from=node-runtime /usr/local/ /usr/local/
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY --from=bun-runtime /usr/local/bin/bunx /usr/local/bin/bunx
WORKDIR /app
COPY package.json ./
RUN bun install
COPY . .
RUN chown -R gitstunts:gitstunts /app
ENV GIT_STUNTS_DOCKER=1
ENV HOME=/home/gitstunts
USER gitstunts
CMD ["bunx", "vitest", "run", "test/unit"]

# --- Deno ---
FROM ubuntu-base AS deno
COPY --from=deno-runtime /usr/bin/deno /usr/local/bin/deno
COPY --from=node-runtime /usr/local/ /usr/local/
WORKDIR /app
COPY package.json ./
RUN deno install --allow-scripts || true
COPY . .
RUN deno install --allow-scripts
RUN chown -R gitstunts:gitstunts /app
ENV GIT_STUNTS_DOCKER=1
ENV HOME=/home/gitstunts
USER gitstunts
CMD ["deno", "run", "-A", "npm:vitest", "run", "test/unit"]
