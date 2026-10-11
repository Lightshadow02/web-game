'use strict';

const { ChuteDesRois } = require('./ChuteDesRois');

/** Point d'entrée du jeu, découvert automatiquement par le GameRegistry. */
module.exports = {
  id: 'chute-des-rois',
  name: 'La Chute des Rois',
  description:
    'Coopératif (1-4 joueurs). Unissez-vous pour renverser les 12 souverains corrompus avec un simple jeu de 52 cartes.',
  minPlayers: 1,
  maxPlayers: 4,
  createGame: ({ players }) => new ChuteDesRois({ players }),
};
