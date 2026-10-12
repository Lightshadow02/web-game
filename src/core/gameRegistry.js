'use strict';

/**
 * Registre des jeux : découvre automatiquement chaque dossier de /games.
 *
 * Contrat d'un module de jeu (games/<id>/server/index.js) :
 *   {
 *     id, name, description, minPlayers, maxPlayers,
 *     createGame({ players: [{ id, name }] }) -> instance
 *   }
 * Contrat d'une instance :
 *   handleAction(playerId, type, payload)  // lève une erreur si l'action est invalide
 *   getStateFor(playerId)                  // vue (privée) de l'état pour ce joueur
 *   isOver()                               // optionnel
 *   getResult()                            // optionnel, pour les stats :
 *     -> { summary, players: [{ playerId, result: 'win'|'loss'|'draw', score? }] }
 *
 * Champ optionnel du module : scoreLabel (libellé du score affiché dans les stats).
 *
 * Le dossier games/<id>/client est servi en statique sur /games/<id>/ et doit
 * exposer un module ES "index.js" (voir public/js/app.js pour l'interface).
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_FIELDS = ['id', 'name', 'minPlayers', 'maxPlayers', 'createGame'];

class GameRegistry {
  constructor() {
    this.games = new Map();
  }

  register(gameModule, clientDir = null) {
    for (const field of REQUIRED_FIELDS) {
      if (gameModule[field] === undefined) {
        throw new Error(`Module de jeu invalide : champ "${field}" manquant`);
      }
    }
    if (this.games.has(gameModule.id)) {
      throw new Error(`Jeu déjà enregistré : ${gameModule.id}`);
    }
    this.games.set(gameModule.id, { module: gameModule, clientDir });
  }

  loadFromDirectory(gamesDir) {
    for (const entry of fs.readdirSync(gamesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const serverEntry = path.join(gamesDir, entry.name, 'server', 'index.js');
      if (!fs.existsSync(serverEntry)) continue;
      const gameModule = require(serverEntry);
      const clientDir = path.join(gamesDir, entry.name, 'client');
      this.register(gameModule, fs.existsSync(clientDir) ? clientDir : null);
      console.log(`[games] "${gameModule.name}" chargé (${gameModule.id})`);
    }
  }

  get(id) {
    return this.games.get(id)?.module ?? null;
  }

  /** Liste publique envoyée aux clients. */
  list() {
    return [...this.games.values()].map(({ module: g }) => ({
      id: g.id,
      name: g.name,
      description: g.description ?? '',
      scoreLabel: g.scoreLabel ?? null,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
    }));
  }

  clientDirs() {
    return [...this.games.values()]
      .filter((g) => g.clientDir)
      .map(({ module: g, clientDir }) => ({ id: g.id, dir: clientDir }));
  }
}

module.exports = { GameRegistry };
