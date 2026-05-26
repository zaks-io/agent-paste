FROM node:24-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    curl \
    git \
    jq \
    openssl \
  && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.19.0 --activate
