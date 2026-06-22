FROM node:24-bookworm-slim

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

RUN corepack enable \
  && npm install -g --ignore-scripts \
    @earendil-works/pi-coding-agent@0.79.9 \
    @openai/codex@0.141.0 \
  && npm install -g --ignore-scripts @anthropic-ai/claude-code@2.1.185 \
  && npm cache clean --force

RUN useradd --create-home --shell /bin/bash agent

USER agent
WORKDIR /workspace

CMD ["sleep", "infinity"]
