'use strict';

const { Profondeurs } = require('./Profondeurs');

/** Point d'entrée du jeu, découvert automatiquement par le GameRegistry. */
module.exports = {
  id: 'profondeurs',
  name: 'Les Profondeurs',
  description:
    'Coopératif (1-4 joueurs). Explorez un donjon aux dés : placez vos dés ensemble sur les monstres et les pièges, gagnez objets et compétences, puis terrassez le boss.',
  scoreLabel: 'Progression',
  minPlayers: 1,
  maxPlayers: 4,
  createGame: ({ players }) => new Profondeurs({ players }),
};
