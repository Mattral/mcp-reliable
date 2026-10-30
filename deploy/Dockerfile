# mcp-reliable image: the released npm packages on Node 22.
#
#   docker build -f deploy/Dockerfile --build-arg MCP_RELIABLE_VERSION=1.2.2 -t mcp-reliable deploy/
#   docker run -p 4317:4317 -v mcp-reliable-data:/data mcp-reliable
#
# The default command runs the REST API and web dashboard on port 4317. Any
# command you pass replaces it, for example the CLI against the same data:
#
#   docker run --rm -v mcp-reliable-data:/data mcp-reliable mcp-reliable report
#
# State lives in the SQLite database at /data/data.sqlite (MCP_RELIABLE_DB);
# mount a volume at /data to keep it between runs.
#
# Built and pushed to ghcr.io/mattral/mcp-reliable by .github/workflows/container.yml.

# Debian slim rather than Alpine: better-sqlite3 ships glibc prebuilds, so it
# installs without a compiler. Pinned by digest (multi-arch index) for
# reproducible builds.
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

ARG MCP_RELIABLE_VERSION

LABEL maintainer="Min Htet Myet (Mattral)" \
      org.opencontainers.image.authors="Min Htet Myet (Mattral)" \
      org.opencontainers.image.ref.name="mcp-reliable" \
      org.opencontainers.image.base.name="docker.io/library/node:22-bookworm-slim" \
      org.opencontainers.image.source="https://github.com/Mattral/mcp-reliable" \
      org.opencontainers.image.title="mcp-reliable" \
      org.opencontainers.image.description="Runtime observability and reliability for Model Context Protocol servers: CLI, REST API, and web dashboard" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${MCP_RELIABLE_VERSION}" \
      org.opencontainers.image.url="https://github.com/Mattral/mcp-reliable"

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    MCP_RELIABLE_DB=/data/data.sqlite \
    MCP_RELIABLE_PORT=4317

# The CLI (`mcp-reliable`) and the server with its bundled dashboard
# (`mcp-reliable-server`), at exactly the requested version.
RUN test -n "${MCP_RELIABLE_VERSION}" || (echo "--build-arg MCP_RELIABLE_VERSION is required" && exit 1) \
    && npm install --global "mcp-reliable@${MCP_RELIABLE_VERSION}" "@mattral/server@${MCP_RELIABLE_VERSION}" \
    && npm cache clean --force \
    && test "$(mcp-reliable --version)" = "${MCP_RELIABLE_VERSION}" \
    && mkdir -p /data && chown node:node /data

# The base image's non-root `node` user (UID 1000).
USER node
WORKDIR /data
VOLUME /data
EXPOSE 4317

CMD ["mcp-reliable-server"]
