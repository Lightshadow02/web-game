# ---- dépendances de production uniquement
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- image finale
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/data
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY games ./games

# Base SQLite (comptes, demandes d'accès, stats) : volume possédé par l'utilisateur node.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
