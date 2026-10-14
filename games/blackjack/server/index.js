'use strict';

const { Blackjack } = require('./Blackjack');

/** Point d'entrée du jeu, découvert automatiquement par le GameRegistry. */
module.exports = {
  id: 'blackjack',
  name: 'Blackjack',
  description:
    'Le Blackjack du casino : chacun contre la banque, sabot de 6 jeux, blackjack payé 3 pour 2, assurance, doubler et séparer. De 1 à 5 joueurs.',
  scoreLabel: 'Jetons',
  minPlayers: 1,
  maxPlayers: 5,
  options: [
    {
      id: 'chips',
      label: 'Jetons de départ',
      default: 1000,
      choices: [
        { value: 500, label: '500', description: 'Partie courte et tendue' },
        { value: 1000, label: '1 000' },
        { value: 2500, label: '2 500', description: 'De quoi miser gros' },
      ],
    },
    {
      id: 'rounds',
      label: 'Nombre de donnes',
      default: 10,
      choices: [
        { value: 5, label: '5' },
        { value: 10, label: '10' },
        { value: 20, label: '20' },
      ],
    },
  ],
  createGame: ({ players, options }) => new Blackjack({ players, options }),
};
