# Production container for Agentic UX Prototype
# Uses Puppeteer base image which includes Chromium and deps
FROM ghcr.io/puppeteer/puppeteer:22.10.0

WORKDIR /app

# Install dependencies first (better cache)
COPY --chown=pptruser:pptruser package*.json ./
RUN npm ci --no-audit --no-fund

# Copy source and build
COPY --chown=pptruser:pptruser . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund --no-package-lock

# Environment
ENV NODE_ENV=production \
    PORT=8787 \
    FLOWS_PATH=/app/flows.json \
    CHROME_PATH=/usr/bin/google-chrome \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome

EXPOSE 8787

# Persist run artifacts (reports, screenshots)
VOLUME ["/app/runs"]

CMD ["node", "dist/index.js"]
