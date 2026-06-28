FROM node:24-bookworm@sha256:fdddfb3e688158251943d52eba361de991548f6814007acba4917ae6b512d6be

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
ENV COREPACK_HOME=/usr/local/share/corepack
WORKDIR /workspace
RUN corepack enable \
  && corepack prepare pnpm@10.19.0 --activate \
  && chown -R node:node /workspace /usr/local/share/corepack
USER node
