'use strict';

const { Rami } = require('./Rami');

/** Point d'entrée du jeu, découvert automatiquement par le GameRegistry. */
module.exports = {
  id: 'rami',
  name: 'Rami',
  description:
    'Le Rami 51 : brelans, carrés et suites à poser sur la table, Jokers à reprendre, ouverture à 51 points. Le moins de pénalités gagne. De 2 à 6 joueurs.',
  // score enregistré : points d'avance sur le dernier (pénalités du dernier − les tiennes), plus c'est haut mieux c'est
  scoreLabel: 'Points d’avance',
  minPlayers: 2,
  maxPlayers: 6,
  options: [
    {
      id: 'opening',
      label: 'Ouverture',
      default: 51,
      choices: [
        { value: 51, label: '51 points', description: 'La règle classique du Rami 51' },
        { value: 30, label: '30 points', description: 'Pour ouvrir plus vite' },
      ],
    },
    {
      id: 'rounds',
      label: 'Nombre de donnes',
      default: 5,
      choices: [
        { value: 3, label: '3' },
        { value: 5, label: '5' },
        { value: 7, label: '7' },
      ],
    },
  ],
  createGame: ({ players, options }) => new Rami({ players, options }),
};
