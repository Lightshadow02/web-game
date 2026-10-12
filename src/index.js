'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { GameRegistry } = require('./core/gameRegistry');
const { RoomManager } = require('./core/RoomManager');
const { registerSocketHandlers, createSocketTransport } = require('./core/socketHandlers');
const { createAuth } = require('./core/auth');
const { Store } = require('./core/store');

const ROOT = path.join(__dirname, '..');

/** Construit l'application (HTTP + Socket.io) sans démarrer l'écoute — utile pour les tests. */
function createHubServer(options = {}) {
  // ---------------------------------------------------------------- jeux
  const registry = new GameRegistry();
  registry.loadFromDirectory(options.gamesDir ?? path.join(ROOT, 'games'));

  // ---------------------------------------------------------------- HTTP
  // Stockage (comptes, demandes d'accès, stats) : uniquement avec la connexion Discord.
  const env = options.env ?? process.env;
  const store =
    options.store !== undefined
      ? options.store
      : createAuth(env).enabled
        ? new Store(options.dbFile ?? path.join(env.DATA_DIR || path.join(ROOT, 'data'), 'hub.db'))
        : null;
  const auth = options.auth ?? createAuth(env, { store });

  const app = express();
  app.disable('x-powered-by');
  app.use(auth.router); // /api/me, /auth/discord, /auth/discord/callback, /auth/logout
  // no-cache = le navigateur revalide (ETag) à chaque chargement : une mise à jour est vue tout de suite.
  const staticOptions = { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') };
  app.use(express.static(path.join(ROOT, 'public'), staticOptions));
  // Chaque jeu expose son interface sur /games/<id>/ (index.js, style.css, ...)
  for (const { id, dir } of registry.clientDirs()) {
    app.use(`/games/${id}`, express.static(dir, staticOptions));
  }

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',') } : undefined,
  });

  // ---------------------------------------------------------------- Core
  const manager = new RoomManager({
    registry,
    transport: createSocketTransport(io),
    maxPlayersPerRoom: options.maxPlayersPerRoom ?? (Number(process.env.MAX_PLAYERS_PER_ROOM) || 8),
    reconnectGraceMs: options.reconnectGraceMs ?? (Number(process.env.RECONNECT_GRACE_MS) || 60_000),
  });

  app.get('/health', (req, res) => res.json({ status: 'ok', ...manager.stats() }));
  app.get('/api/games', (req, res) => res.json(registry.list()));

  registerSocketHandlers(io, manager, auth, store);
  return { app, server, io, manager, registry, auth, store };
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3001;
  const { server, io, auth } = createHubServer();
  server.listen(PORT, () => {
    console.log(`[hub] Serveur prêt sur http://localhost:${PORT}`);
    if (!auth.enabled) {
      console.log('[hub] Connexion Discord désactivée (DISCORD_CLIENT_ID/SECRET absents) : pseudo libre.');
      return;
    }
    console.log(`[hub] Connexion Discord activée${auth.approval ? ' (validation des demandes par un admin)' : ''}.`);
    if (!auth.adminIds.size) {
      console.warn('[hub] Aucun admin : ajoutez votre ID Discord dans ADMIN_DISCORD_IDS pour valider les demandes.');
    }
    console.log(`[hub] URL de retour à déclarer dans Discord (OAuth2 > Redirects) : ${auth.redirectUri}`);
    if (/mondomaine|example\.com/.test(auth.redirectUri)) {
      console.warn('[hub] ATTENTION : PUBLIC_URL est encore la valeur d’exemple, remplacez-la dans .env.');
    }
  });

  // Arrêt propre (docker stop envoie SIGTERM)
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log(`[hub] ${signal} reçu, arrêt...`);
      io.close();
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 3_000).unref();
    });
  }
}

module.exports = { createHubServer };
