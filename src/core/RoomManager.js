'use strict';

const { Room } = require('./Room');
const { randomCode, randomId, cleanText, UserError } = require('./utils');

const NAME_MAX_LENGTH = 20;

/**
 * Gère les sessions joueurs et le cycle de vie des salons.
 *
 * Une session est identifiée soit par le compte Discord (connexion activée), soit
 * par un jeton secret conservé par le navigateur (localStorage) : elle survit à un
 * rafraîchissement ou à une coupure réseau. L'id public du joueur (diffusé aux
 * autres) est distinct de ces identifiants.
 */
class RoomManager {
  /**
   * hooks (optionnels) :
   *   onLobbyChange()   : liste des salons ou des joueurs en ligne modifiée
   *   onGameEnd(match)  : partie terminée (voir Room.checkGameEnd)
   */
  constructor({ registry, transport, maxPlayersPerRoom = 8, reconnectGraceMs = 60_000, hooks = {} }) {
    this.hooks = hooks;
    this.lobbyChangeQueued = false;
    this.registry = registry;
    this.transport = transport;
    this.maxPlayersPerRoom = maxPlayersPerRoom;
    this.reconnectGraceMs = reconnectGraceMs;
    this.rooms = new Map(); // code -> Room
    this.sessions = new Map(); // clé (jeton ou discord:<id>) -> { key, playerId, identity, roomCode, sockets, timer }
  }

  // ---------------------------------------------------------------- sessions

  /**
   * Associe une socket à une session (créée si besoin).
   * - Mode Discord : `identity` ({ id, name, avatarUrl }) identifie le joueur, quel que soit l'appareil.
   * - Mode pseudo libre : `token` (localStorage) identifie le navigateur.
   */
  attachSocket(token, socketId, identity = null) {
    const key = identity ? `discord:${identity.id}` : token;
    let session = typeof key === 'string' ? this.sessions.get(key) : null;
    if (!session) {
      session = {
        key: identity ? key : randomId(16),
        playerId: randomId(6),
        identity: null,
        roomCode: null,
        sockets: new Set(),
        timer: null,
      };
      this.sessions.set(session.key, session);
    }
    if (identity) session.identity = identity; // nom/avatar rafraîchis à chaque connexion
    session.sockets.add(socketId);
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
    const room = this.getRoomOf(session);
    if (room) room.setConnected(session.playerId, true);
    this.notifyLobbyChange();
    return session;
  }

  /** Jeton à mémoriser côté navigateur (inutile en mode Discord : le cookie suffit). */
  clientToken(session) {
    return session.identity ? null : session.key;
  }

  detachSocket(session, socketId) {
    session.sockets.delete(socketId);
    if (session.sockets.size > 0) return; // un autre onglet est encore ouvert
    this.notifyLobbyChange();

    const room = this.getRoomOf(session);
    if (!room) {
      this.sessions.delete(session.key);
      return;
    }
    room.setConnected(session.playerId, false);
    session.timer = setTimeout(() => {
      session.timer = null;
      this.leaveRoom(session, 'a été déconnecté');
      this.sessions.delete(session.key);
    }, this.reconnectGraceMs);
    session.timer.unref?.();
  }

  getRoomOf(session) {
    return session.roomCode ? this.rooms.get(session.roomCode) ?? null : null;
  }

  // ---------------------------------------------------------------- salons

  createRoom(session, rawName) {
    const name = this.resolveName(session, rawName, null);
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
      hooks: {
        onChange: () => this.notifyLobbyChange(),
        onGameEnd: (match) => this.hooks.onGameEnd?.(match),
      },
    });
    this.rooms.set(code, room);
    room.addPlayer(this.playerInfo(session, name));
    session.roomCode = code;
    return room;
  }

  joinRoom(session, rawCode, rawName) {
    const code = cleanText(rawCode, 5).toUpperCase();
    const room = this.rooms.get(code);
    if (!room) throw new UserError(`Aucun salon avec le code "${code}".`);
    if (session.roomCode === code) return room;

    const name = this.resolveName(session, rawName, room);
    this.leaveRoom(session);
    room.addPlayer(this.playerInfo(session, name));
    session.roomCode = code;
    return room;
  }

  leaveRoom(session, reason) {
    const room = this.getRoomOf(session);
    session.roomCode = null;
    if (!room) return;
    room.removePlayer(session.playerId, reason);
    if (room.isEmpty) {
      this.rooms.delete(room.code);
      this.notifyLobbyChange();
    }
  }

  /** Session d'un compte Discord (pour le retirer, le notifier...). */
  sessionOfUser(userId) {
    return this.sessions.get(`discord:${userId}`) ?? null;
  }

  // ---------------------------------------------------------------- vue "Hub"

  /** Regroupe les changements d'un même tick en une seule notification. */
  notifyLobbyChange() {
    if (this.lobbyChangeQueued || !this.hooks.onLobbyChange) return;
    this.lobbyChangeQueued = true;
    setImmediate(() => {
      this.lobbyChangeQueued = false;
      this.hooks.onLobbyChange();
    });
  }

  lobbySnapshot() {
    const online = [...this.sessions.values()].filter((s) => s.sockets.size > 0);
    return {
      rooms: [...this.rooms.values()].map((room) => room.summary()).sort((a, b) => b.createdAt - a.createdAt),
      onlineCount: online.length,
      online: online
        .filter((s) => s.identity)
        .map((s) => ({ name: s.identity.name, avatarUrl: s.identity.avatarUrl, roomCode: s.roomCode }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** Mode Discord : nom imposé (suffixé si homonyme dans le salon). Sinon : pseudo saisi. */
  resolveName(session, rawName, room) {
    if (!session.identity) return this.validateName(rawName);
    const base = session.identity.name;
    const taken = new Set(room ? [...room.players.values()].map((p) => p.name.toLowerCase()) : []);
    let name = base;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base.slice(0, NAME_MAX_LENGTH - 3)} ${i}`;
    return name;
  }

  playerInfo(session, name) {
    return {
      id: session.playerId,
      userId: session.identity?.id ?? null,
      name,
      avatarUrl: session.identity?.avatarUrl ?? null,
    };
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
