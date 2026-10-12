'use strict';

const { Tarot } = require('./Tarot');

/** Point d'entrée du jeu, découvert automatiquement par le GameRegistry. */
module.exports = {
  id: 'tarot',
  name: 'Tarot',
  description:
    'Le Tarot français (FFT) : enchères, chien, poignées, Petit au bout. À 4 classique, à 5 avec appel au Roi (et à 3). Une donne par joueur.',
  scoreLabel: 'Points',
  minPlayers: 3,
  maxPlayers: 5,
  createGame: ({ players }) => new Tarot({ players }),
};
