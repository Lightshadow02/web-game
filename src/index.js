'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { GameRegistry } = require('./core/gameRegistry');
const { RoomManager } = require('./core/RoomManager');
const { registerSocketHandlers, createSocketTransport } = require('./core/socketHandlers');
const { createAuth } = require('./core/auth');

const ROOT = path.join(__dirname, '..');

/** Construit l'application (HTTP + Socket.io) sans démarrer l'écoute — utile pour les tests. */
function createHubServer(options = {}) {
  // ---------------------------------------------------------------- jeux
  const registry = new GameRegistry();
  registry.loadFromDirectory(options.gamesDir ?? path.join(ROOT, 'games'));

  // ---------------------------------------------------------------- HTTP
  const auth = options.auth ?? createAuth(options.env ?? process.env);

  const app = express();
  app.disable('x-powered-by');
  app.use(auth.router); // /api/me, /auth/discord, /auth/discord/callback, /auth/logout
  app.use(express.static(path.join(ROOT, 'public')));
  // Chaque jeu expose son interface sur /games/<id>/ (index.js, style.css, ...)
  for (const { id, dir } of registry.clientDirs()) {
    app.use(`/games/${id}`, express.static(dir));
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

  registerSocketHandlers(io, manager, auth);
  return { app, server, io, manager, registry, auth };
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3001;
  const { server, io, auth } = createHubServer();
  server.listen(PORT, () => {
    console.log(`[hub] Serveur prêt sur http://localhost:${PORT}`);
    console.log(auth.enabled
      ? '[hub] Connexion Discord activée.'
      : '[hub] Connexion Discord désactivée (DISCORD_CLIENT_ID/SECRET absents) : pseudo libre.');
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
