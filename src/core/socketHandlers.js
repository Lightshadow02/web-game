'use strict';

const { UserError } = require('./utils');

const CHAT_RATE = { max: 5, windowMs: 5_000 };

/**
 * Branche les événements Socket.io sur le RoomManager.
 *
 * Client -> serveur (tous acceptent un callback d'acquittement `ack({ ok, error })`) :
 *   room:create { name }        room:join { code, name }     room:leave
 *   room:selectGame { gameId }  room:startGame               room:endGame
 *   chat:send { text }          game:action { type, payload }
 *
 *   hub:get                      stats:get                    stats:leaderboard { gameId }
 *   admin:users (admin)          admin:decide { userId, status } (admin)
 *
 * Serveur -> client :
 *   session { token, playerId, roomCode, user }  games:list [...]   room:state {...}   room:left
 *   chat:history [...]           chat:message {...} game:state { gameId, state }
 *   hub:lobby { rooms, online, onlineCount }      stats:changed     admin:changed   admin:request { name }
 */
function registerSocketHandlers(io, manager, auth = null, store = null) {
  // Connexion Discord activée : seuls les comptes validés ouvrent une socket.
  if (auth?.enabled) {
    io.use((socket, next) => {
      const user = auth.userFromCookieHeader(socket.handshake.headers.cookie);
      if (!user) return next(new Error('unauthorized'));
      if (user.status !== 'approved') return next(new Error(user.status)); // 'pending' | 'rejected'
      socket.data.user = user;
      next();
    });
  }

  // ---------------------------------------------------------------- événements globaux
  manager.hooks.onLobbyChange = () => io.to(HUB_CHANNEL).emit('hub:lobby', manager.lobbySnapshot());

  if (store) {
    manager.hooks.onGameEnd = (match) => {
      try {
        store.recordMatch(match);
      } catch (err) {
        console.error('[stats] enregistrement de la partie impossible', err);
      }
    };
    store.on('match', ({ userIds }) => {
      for (const userId of userIds) {
        const session = manager.sessionOfUser(userId);
        if (session) io.to(playerChannel(session.playerId)).emit('stats:changed');
      }
    });
    store.on('users:changed', () => io.to(ADMIN_CHANNEL).emit('admin:changed'));
    store.on('request', (user) => io.to(ADMIN_CHANNEL).emit('admin:request', { name: user.name }));
    // Compte refusé/révoqué : retiré de son salon et déconnecté sur-le-champ.
    store.on('status', (user) => {
      if (user.status === 'approved') return;
      const session = manager.sessionOfUser(user.id);
      if (!session) return;
      manager.leaveRoom(session, "a été retiré par l'administrateur");
      for (const socketId of session.sockets) io.sockets.sockets.get(socketId)?.disconnect(true);
    });
  }

  io.on('connection', (socket) => {
    const session = manager.attachSocket(socket.handshake.auth?.token, socket.id, socket.data.user ?? null);
    socket.join(playerChannel(session.playerId));

    socket.emit('session', {
      token: manager.clientToken(session),
      playerId: session.playerId,
      roomCode: session.roomCode,
      user: session.identity,
    });
    socket.emit('games:list', manager.registry.list());
    socket.join(HUB_CHANNEL);
    socket.emit('hub:lobby', manager.lobbySnapshot());
    const isAdmin = Boolean(session.identity?.isAdmin);
    if (isAdmin) socket.join(ADMIN_CHANNEL);

    // Reconnexion : on replace la socket dans son salon et on renvoie tout l'état.
    const currentRoom = manager.getRoomOf(session);
    if (currentRoom) {
      socket.join(roomChannel(currentRoom.code));
      currentRoom.sendSnapshotTo(session.playerId);
    }

    /** Enveloppe chaque handler : erreurs métier -> ack({ ok:false, error }). */
    const on = (event, handler) => {
      socket.on(event, (data, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          const result = handler(data && typeof data === 'object' ? data : {});
          reply({ ok: true, ...(result || {}) });
        } catch (err) {
          if (!(err instanceof UserError) && !err.isGameError) {
            console.error(`[socket] ${event}`, err);
          }
          reply({ ok: false, error: err.isGameError || err instanceof UserError ? err.message : 'Erreur serveur.' });
        }
      });
    };

    const requireRoom = () => {
      const room = manager.getRoomOf(session);
      if (!room) throw new UserError("Vous n'êtes dans aucun salon.");
      return room;
    };

    /** Synchronise les channels Socket.io de *toutes* les sockets de la session. */
    const syncChannels = (previousCode) => {
      const next = session.roomCode;
      for (const socketId of session.sockets) {
        const s = io.sockets.sockets.get(socketId);
        if (!s) continue;
        if (previousCode && previousCode !== next) s.leave(roomChannel(previousCode));
        if (next) s.join(roomChannel(next));
      }
    };

    on('room:create', ({ name }) => {
      const previous = session.roomCode;
      const room = manager.createRoom(session, name);
      syncChannels(previous);
      room.sendSnapshotTo(session.playerId);
      return { code: room.code };
    });

    on('room:join', ({ code, name }) => {
      const previous = session.roomCode;
      const room = manager.joinRoom(session, code, name);
      syncChannels(previous);
      room.sendSnapshotTo(session.playerId);
      return { code: room.code };
    });

    on('room:leave', () => {
      const previous = session.roomCode;
      manager.leaveRoom(session);
      syncChannels(previous);
      io.to(playerChannel(session.playerId)).emit('room:left');
    });

    on('room:selectGame', ({ gameId }) => requireRoom().selectGame(session.playerId, gameId));
    on('room:startGame', () => requireRoom().startGame(session.playerId));
    on('room:endGame', () => requireRoom().endGame(session.playerId));

    const chatTimes = [];
    on('chat:send', ({ text }) => {
      const now = Date.now();
      while (chatTimes.length && now - chatTimes[0] > CHAT_RATE.windowMs) chatTimes.shift();
      if (chatTimes.length >= CHAT_RATE.max) throw new UserError('Doucement ! Trop de messages.');
      chatTimes.push(now);
      requireRoom().postChat(session.playerId, text);
    });

    on('game:action', ({ type, payload }) => requireRoom().gameAction(session.playerId, type, payload));

    // ---------------------------------------------------------------- Hub : stats & admin
    const requireStore = () => {
      if (!store || !session.identity) throw new UserError('Statistiques disponibles avec la connexion Discord.');
      return store;
    };
    const requireAdmin = () => {
      if (!isAdmin) throw new UserError('Réservé aux administrateurs.');
      return requireStore();
    };

    on('hub:get', () => ({ lobby: manager.lobbySnapshot() }));

    on('stats:get', () => {
      const db = requireStore();
      return { stats: db.statsForUser(session.identity.id), recent: db.recentMatches(session.identity.id) };
    });

    on('stats:leaderboard', ({ gameId }) => {
      if (!manager.registry.get(gameId)) throw new UserError('Jeu inconnu.');
      return { leaderboard: requireStore().leaderboard(gameId) };
    });

    on('admin:users', () => {
      const db = requireAdmin();
      return { pending: db.listUsers('pending'), approved: db.listUsers('approved'), rejected: db.listUsers('rejected') };
    });

    on('admin:decide', ({ userId, status }) => {
      const db = requireAdmin();
      if (!['approved', 'rejected'].includes(status)) throw new UserError('Décision invalide.');
      if (userId === session.identity.id) throw new UserError('Vous ne pouvez pas modifier votre propre accès.');
      try {
        const user = db.setStatus(String(userId), status, session.identity.id);
        if (!user) throw new UserError('Compte introuvable.');
        return { user };
      } catch (err) {
        if (err instanceof UserError) throw err;
        throw new UserError(err.message);
      }
    });

    socket.on('disconnect', () => manager.detachSocket(session, socket.id));
  });
}

const HUB_CHANNEL = 'hub';
const ADMIN_CHANNEL = 'admins';
const roomChannel = (code) => `room:${code}`;
const playerChannel = (playerId) => `player:${playerId}`;

/** Implémentation Socket.io du "transport" utilisé par les salons. */
function createSocketTransport(io) {
  return {
    toRoom: (code, event, data) => io.to(roomChannel(code)).emit(event, data),
    toPlayer: (playerId, event, data) => io.to(playerChannel(playerId)).emit(event, data),
  };
}

module.exports = { registerSocketHandlers, createSocketTransport };
