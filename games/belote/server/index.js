'use strict';

const { Belote } = require('./Belote');

/** Point d'entrée du jeu, découvert automatiquement par le GameRegistry. */
module.exports = {
  id: 'belote',
  name: 'Belote',
  description:
    'La Belote classique à 4, en deux équipes face à face : on prend à la carte retournée, belote-rebelote, annonces, dix de der et capot.',
  scoreLabel: 'Points',
  minPlayers: 4,
  maxPlayers: 4,
  options: [
    {
      id: 'target',
      label: 'Partie en',
      default: 1001,
      choices: [
        { value: 501, label: '501 points', description: 'Une partie courte, environ 4 donnes.' },
        { value: 1001, label: '1001 points', description: 'La partie classique, environ 8 donnes.' },
        { value: 1501, label: '1501 points', description: 'Une longue soirée, environ 12 donnes.' },
      ],
    },
    {
      id: 'announces',
      label: 'Annonces',
      default: 'oui',
      choices: [
        { value: 'oui', label: 'Oui', description: 'Tierce 20, cinquante 50, cent 100, carrés (Valets 200, 9 150, autres 100), plus la belote.' },
        { value: 'non', label: 'Non', description: 'Seule la belote-rebelote compte.' },
      ],
    },
  ],
  createGame: ({ players, options = {} }) => new Belote({
    players,
    target: Number(options.target) || 1001,
    announces: (options.announces ?? 'oui') !== 'non',
  }),
};
