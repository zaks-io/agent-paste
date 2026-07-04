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

WORKDIR /opt/agent-runner

# @earendil-works/pi-coding-agent ships an npm-shrinkwrap with
# brace-expansion@5.0.6, so the root lockfile cannot override the nested copy.
RUN corepack enable \
  && npm ci --omit=dev --ignore-scripts \
  && npm install --prefix node_modules/@earendil-works/pi-coding-agent --omit=dev --ignore-scripts --no-save brace-expansion@5.0.7 \
  && test "$(node -p "require('./node_modules/@earendil-works/pi-coding-agent/node_modules/brace-expansion/package.json').version")" = "5.0.7" \
  && node node_modules/@anthropic-ai/claude-code/install.cjs \
  && npm cache clean --force

RUN useradd --create-home --shell /bin/bash agent

USER agent
WORKDIR /workspace

CMD ["sleep", "infinity"]
