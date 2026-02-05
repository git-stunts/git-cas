# --- Node ---
FROM node:22-slim AS node
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV GIT_STUNTS_DOCKER=1
CMD ["npx", "vitest", "run", "test/unit"]

# --- Bun ---
FROM oven/bun:1-slim AS bun
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install
COPY . .
ENV GIT_STUNTS_DOCKER=1
CMD ["bunx", "vitest", "run", "test/unit"]

# --- Deno ---
FROM denoland/deno:latest AS deno
USER root
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN deno install --allow-scripts
ENV GIT_STUNTS_DOCKER=1
CMD ["deno", "run", "-A", "npm:vitest", "run", "test/unit"]
