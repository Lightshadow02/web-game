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
 * Champs optionnels du module :
 *   scoreLabel  libellé du score affiché dans les stats ;
 *   options     réglages choisis par l'hôte dans le salon avant de lancer, transmis à
 *               createGame({ players, options }) sous la forme { [id]: value } :
 *               [{ id, label, default, choices: [{ value, label, description? }] }]
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
    for (const opt of gameModule.options ?? []) {
      const values = (opt.choices ?? []).map((c) => c.value);
      if (!opt.id || !opt.label || !values.length || !values.includes(opt.default)) {
        throw new Error(`Option de jeu invalide dans ${gameModule.id} : ${opt.id ?? '?'}`);
      }
    }
    this.games.set(gameModule.id, { module: gameModule, clientDir });
  }

  loadFromDirectory(gamesDir) {
    for (const entry of fs.readdirSync(gamesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const serverEntry = path.join(gamesDir, entry.name, 'server', 'index.js');
      if (!fs.existsSync(serverEntry)) continue;
      // Un jeu sans interface (en cours de développement) n'est pas proposé dans les salons.
      if (!fs.existsSync(path.join(gamesDir, entry.name, 'client', 'index.js'))) {
        console.log(`[games] "${entry.name}" ignoré : pas encore d'interface (client/index.js).`);
        continue;
      }
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
      options: (g.options ?? []).map(({ id, label, default: def, choices }) => ({
        id, label, default: def,
        choices: choices.map(({ value, label: l, description }) => ({ value, label: l, description: description ?? '' })),
      })),
    }));
  }

  clientDirs() {
    return [...this.games.values()]
      .filter((g) => g.clientDir)
      .map(({ module: g, clientDir }) => ({ id: g.id, dir: clientDir }));
  }
}

/** Options d'un jeu avec leurs valeurs par défaut, complétées par les choix de l'hôte (valeurs inconnues ignorées). */
function resolveOptions(gameModule, chosen = {}) {
  const out = {};
  for (const opt of gameModule?.options ?? []) {
    const value = chosen[opt.id];
    out[opt.id] = opt.choices.some((c) => c.value === value) ? value : opt.default;
  }
  return out;
}

module.exports = { GameRegistry, resolveOptions };
