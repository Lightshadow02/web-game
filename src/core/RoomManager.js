'use strict';

const { Room } = require('./Room');
const { randomCode, randomId, cleanText, UserError } = require('./utils');

const NAME_MAX_LENGTH = 20;

/**
 * Gère les sessions joueurs et le cycle de vie des salons.
 *
 * Une session est identifiée par un jeton secret conservé par le navigateur
 * (localStorage) : elle survit à un rafraîchissement de page ou à une coupure
 * réseau. L'id public du joueur (diffusé aux autres) est distinct du jeton.
 */
class RoomManager {
  constructor({ registry, transport, maxPlayersPerRoom = 8, reconnectGraceMs = 60_000 }) {
    this.registry = registry;
    this.transport = transport;
    this.maxPlayersPerRoom = maxPlayersPerRoom;
    this.reconnectGraceMs = reconnectGraceMs;
    this.rooms = new Map(); // code -> Room
    this.sessions = new Map(); // token -> { token, playerId, roomCode, sockets:Set, timer }
  }

  // ---------------------------------------------------------------- sessions

  /** Associe une socket à une session (créée si le jeton est inconnu). */
  attachSocket(token, socketId) {
    let session = typeof token === 'string' ? this.sessions.get(token) : null;
    if (!session) {
      session = { token: randomId(16), playerId: randomId(6), roomCode: null, sockets: new Set(), timer: null };
      this.sessions.set(session.token, session);
    }
    session.sockets.add(socketId);
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
    const room = this.getRoomOf(session);
    if (room) room.setConnected(session.playerId, true);
    return session;
  }

  detachSocket(session, socketId) {
    session.sockets.delete(socketId);
    if (session.sockets.size > 0) return; // un autre onglet est encore ouvert

    const room = this.getRoomOf(session);
    if (!room) {
      this.sessions.delete(session.token);
      return;
    }
    room.setConnected(session.playerId, false);
    session.timer = setTimeout(() => {
      session.timer = null;
      this.leaveRoom(session, 'a été déconnecté');
      this.sessions.delete(session.token);
    }, this.reconnectGraceMs);
    session.timer.unref?.();
  }

  getRoomOf(session) {
    return session.roomCode ? this.rooms.get(session.roomCode) ?? null : null;
  }

  // ---------------------------------------------------------------- salons

  createRoom(session, rawName) {
    const name = this.validateName(rawName);
    this.leaveRoom(session);

    let code;
    do {
      code = randomCode(this.rooms.size > 100_000 ? 5 : 4);
    } while (this.rooms.has(code));

    const room = new Room({
      code,
      registry: this.registry,
      transport: this.transport,
      maxPlayers: this.maxPlayersPerRoom,
    });
    this.rooms.set(code, room);
    room.addPlayer({ id: session.playerId, name });
    session.roomCode = code;
    return room;
  }

  joinRoom(session, rawCode, rawName) {
    const name = this.validateName(rawName);
    const code = cleanText(rawCode, 5).toUpperCase();
    const room = this.rooms.get(code);
    if (!room) throw new UserError(`Aucun salon avec le code "${code}".`);
    if (session.roomCode === code) return room;

    this.leaveRoom(session);
    room.addPlayer({ id: session.playerId, name });
    session.roomCode = code;
    return room;
  }

  leaveRoom(session, reason) {
    const room = this.getRoomOf(session);
    session.roomCode = null;
    if (!room) return;
    room.removePlayer(session.playerId, reason);
    if (room.isEmpty) this.rooms.delete(room.code);
  }

  validateName(rawName) {
    const name = cleanText(rawName, NAME_MAX_LENGTH);
    if (name.length < 2) throw new UserError('Le pseudo doit contenir au moins 2 caractères.');
    return name;
  }

  stats() {
    return { rooms: this.rooms.size, sessions: this.sessions.size };
  }
}

module.exports = { RoomManager };
