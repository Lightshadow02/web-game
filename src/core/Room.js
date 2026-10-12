'use strict';

const { UserError } = require('./utils');

/**
 * Un salon : liste des joueurs, hôte, jeu sélectionné et partie en cours.
 * Ne connaît pas Socket.io : il émet via un objet `transport`
 * ({ toRoom(code, event, data), toPlayer(playerId, event, data) }).
 */
class Room {
  /**
   * hooks (optionnels) :
   *   onChange()          : l'état public du salon a changé (liste des salons du Hub)
   *   onGameEnd(match)    : une partie vient de se terminer -> { gameId, roomCode, summary, players:[{ userId, result, score }] }
   */
  constructor({ code, registry, transport, maxPlayers, hooks = {} }) {
    this.hooks = hooks;
    this.code = code;
    this.registry = registry;
    this.transport = transport;
    this.maxPlayers = maxPlayers;
    this.players = new Map(); // id -> { id, userId, name, avatarUrl, connected }
    this.hostId = null;
    this.selectedGameId = registry.list()[0]?.id ?? null;
    this.game = null; // { id, instance }
    this.createdAt = Date.now();
  }

  get status() {
    return this.game ? 'playing' : 'lobby';
  }

  get isEmpty() {
    return this.players.size === 0;
  }

  // ---------------------------------------------------------------- joueurs

  addPlayer(player) {
    if (this.players.size >= this.maxPlayers) throw new UserError('Le salon est complet.');
    if (this.game) throw new UserError('Une partie est déjà en cours dans ce salon.');
    const nameTaken = [...this.players.values()].some(
      (p) => p.name.toLowerCase() === player.name.toLowerCase(),
    );
    if (nameTaken) throw new UserError('Ce pseudo est déjà utilisé dans le salon.');

    this.players.set(player.id, {
      id: player.id,
      userId: player.userId ?? null, // compte Discord (stats) ; null en mode pseudo libre
      name: player.name,
      avatarUrl: player.avatarUrl ?? null,
      connected: true,
    });
    if (!this.hostId) this.hostId = player.id;
    this.systemMessage(`${player.name} a rejoint le salon.`);
    this.broadcastState();
  }

  removePlayer(playerId, reason = 'a quitté le salon') {
    const player = this.players.get(playerId);
    if (!player) return;
    this.players.delete(playerId);

    // le joueur qui part ne reçoit pas sa propre annonce
    if (this.game) {
      this.game = null;
      this.systemMessage(`Partie interrompue : ${player.name} ${reason}.`, playerId);
    } else {
      this.systemMessage(`${player.name} ${reason}.`, playerId);
    }

    if (this.hostId === playerId) {
      // Transfert d'hôte : priorité aux joueurs connectés.
      const next = [...this.players.values()].sort((a, b) => b.connected - a.connected)[0];
      this.hostId = next?.id ?? null;
      if (next) this.systemMessage(`${next.name} est le nouvel hôte.`, playerId);
    }
    this.broadcastState();
  }

  setConnected(playerId, connected) {
    const player = this.players.get(playerId);
    if (!player || player.connected === connected) return;
    player.connected = connected;
    this.broadcastState();
  }

  isHost(playerId) {
    return this.hostId === playerId;
  }

  assertHost(playerId) {
    if (!this.isHost(playerId)) throw new UserError("Seul l'hôte peut faire cela.");
  }

  // ---------------------------------------------------------------- jeux

  selectGame(playerId, gameId) {
    this.assertHost(playerId);
    if (this.game) throw new UserError('Impossible de changer de jeu pendant une partie.');
    const game = this.registry.get(gameId);
    if (!game) throw new UserError('Jeu inconnu.');
    this.selectedGameId = gameId;
    this.broadcastState();
  }

  startGame(playerId) {
    this.assertHost(playerId);
    if (this.game) throw new UserError('Une partie est déjà en cours.');
    const gameModule = this.registry.get(this.selectedGameId);
    if (!gameModule) throw new UserError("Aucun jeu n'est sélectionné.");

    const players = [...this.players.values()];
    if (players.length < gameModule.minPlayers || players.length > gameModule.maxPlayers) {
      throw new UserError(
        `${gameModule.name} se joue de ${gameModule.minPlayers} à ${gameModule.maxPlayers} joueurs.`,
      );
    }
    if (players.some((p) => !p.connected)) {
      throw new UserError('Tous les joueurs doivent être connectés pour lancer la partie.');
    }

    const instance = gameModule.createGame({
      players: players.map(({ id, name }) => ({ id, name })),
    });
    this.game = { id: gameModule.id, instance, recorded: false };
    this.broadcastState();
    this.broadcastGame();
  }

  endGame(playerId) {
    this.assertHost(playerId);
    if (!this.game) return;
    this.game = null;
    this.systemMessage("L'hôte a ramené tout le monde au salon.");
    this.broadcastState();
  }

  gameAction(playerId, type, payload) {
    if (!this.game) throw new UserError('Aucune partie en cours.');
    if (typeof type !== 'string') throw new UserError('Action invalide.');
    this.game.instance.handleAction(playerId, type, payload ?? {});
    this.broadcastGame();
    this.checkGameEnd();
  }

  /** Contrat générique : un jeu terminé peut exposer getResult() -> { summary, players:[{ playerId, result, score }] }. */
  checkGameEnd() {
    const game = this.game;
    if (!game || game.recorded || !game.instance.isOver?.()) return;
    game.recorded = true;
    const result = game.instance.getResult?.();
    if (!result || !this.hooks.onGameEnd) return;
    this.hooks.onGameEnd({
      gameId: game.id,
      roomCode: this.code,
      summary: result.summary ?? null,
      players: (result.players ?? []).map((p) => ({
        userId: this.players.get(p.playerId)?.userId ?? null,
        result: p.result,
        score: p.score,
      })),
    });
    this.hooks.onChange?.();
  }

  // ---------------------------------------------------------------- annonces

  /** Annonce courte affichée chez les joueurs du salon (arrivée, départ, nouvel hôte...), sauf `exceptPlayerId`. */
  systemMessage(text, exceptPlayerId = null) {
    this.transport.toRoom(this.code, 'room:notice', { text, ts: Date.now() }, exceptPlayerId);
  }

  // ---------------------------------------------------------------- diffusion

  publicState() {
    return {
      code: this.code,
      hostId: this.hostId,
      status: this.status,
      selectedGameId: this.selectedGameId,
      gameId: this.game?.id ?? null,
      maxPlayers: this.maxPlayers,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        avatarUrl: p.avatarUrl,
        connected: p.connected,
        isHost: p.id === this.hostId,
      })),
    };
  }

  broadcastState() {
    this.transport.toRoom(this.code, 'room:state', this.publicState());
    this.hooks.onChange?.();
  }

  /** Résumé affiché dans la liste des salons du Hub. */
  summary() {
    const game = this.registry.get(this.game?.id ?? this.selectedGameId);
    const host = this.players.get(this.hostId);
    return {
      code: this.code,
      status: this.status,
      gameId: game?.id ?? null,
      gameName: game?.name ?? null,
      hostName: host?.name ?? null,
      playerCount: this.players.size,
      players: [...this.players.values()].map((p) => ({ name: p.name, avatarUrl: p.avatarUrl })),
      maxPlayers: Math.min(this.maxPlayers, game?.maxPlayers ?? this.maxPlayers),
      createdAt: this.createdAt,
    };
  }

  /** Chaque joueur reçoit sa propre vue (cartes en main cachées aux autres). */
  broadcastGame() {
    if (!this.game) return;
    for (const playerId of this.players.keys()) this.sendGameTo(playerId);
  }

  sendGameTo(playerId) {
    if (!this.game) return;
    this.transport.toPlayer(playerId, 'game:state', {
      gameId: this.game.id,
      state: this.game.instance.getStateFor(playerId),
    });
  }

  /** Tout ce qu'un joueur (re)connecté doit recevoir pour reconstruire son écran. */
  sendSnapshotTo(playerId) {
    this.transport.toPlayer(playerId, 'room:state', this.publicState());
    this.sendGameTo(playerId);
  }
}

module.exports = { Room };
