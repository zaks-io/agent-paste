FROM node:24-bookworm-slim@sha256:b31e7a42fdf8b8aa5f5ed477c72d694301273f1069c5a2f71d53c6482e99a2fc

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    findutils \
    git \
    jq \
    openssh-client \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

ENV PATH=/opt/agent-runner/node_modules/.bin:$PATH

COPY agent-runner-package.json /opt/agent-runner/package.json
COPY agent-runner-package-lock.json /opt/agent-runner/package-lock.json

RUN corepack enable \
  && cd /opt/agent-runner \
  && npm ci --omit=dev --ignore-scripts \
  && node node_modules/@anthropic-ai/claude-code/install.cjs \
  && npm cache clean --force

RUN useradd --create-home --shell /bin/bash agent

USER agent
WORKDIR /workspace

CMD ["sleep", "infinity"]
