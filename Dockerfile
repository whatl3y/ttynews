FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

WORKDIR /app

# Install dependencies first for layer caching
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source + runtime assets
COPY tsconfig.json ./
COPY src/ ./src/
COPY templates/ ./templates/
COPY public/ ./public/
COPY data/ ./data/

# Build
RUN pnpm build

EXPOSE 8000

CMD ["node", "dist/webServer.js"]
