'use strict';

const { President } = require('./President');

/** Point d'entrée du jeu, découvert automatiquement par le GameRegistry. */
module.exports = {
  id: 'president',
  name: 'Président',
  description:
    'Le Président (ou Trouduc) : débarrasse-toi de tes cartes avant les autres. Le premier devient Président, le dernier Trouduc… et doit lui donner ses meilleures cartes. De 3 à 8 joueurs.',
  scoreLabel: 'Points',
  minPlayers: 3,
  maxPlayers: 8,
  options: [
    {
      id: 'rounds',
      label: 'Nombre de manches',
      default: 8,
      choices: [
        { value: 5, label: '5 manches', description: 'Partie courte.' },
        { value: 8, label: '8 manches', description: 'La partie classique.' },
        { value: 12, label: '12 manches', description: 'Partie longue : le Trouduc a le temps de se refaire.' },
      ],
    },
    {
      id: 'twoCloses',
      label: 'Le 2',
      default: 'ferme',
      choices: [
        { value: 'ferme', label: 'Le 2 ferme le pli', description: 'Un 2 se pose sur tout (autant de 2 que de cartes), ferme le pli et son joueur rejoue, même en révolution.' },
        { value: 'normal', label: 'Plus forte carte', description: 'Le 2 est seulement la plus forte carte (la plus faible en révolution).' },
      ],
    },
    {
      id: 'revolution',
      label: 'Révolution',
      default: 'non',
      choices: [
        { value: 'non', label: 'Sans révolution', description: 'Un carré est une combinaison comme les autres.' },
        { value: 'oui', label: 'Avec révolution', description: 'Poser un carré inverse l’ordre des cartes jusqu’à la fin de la manche (le 3 devient la plus forte).' },
      ],
    },
  ],
  createGame: ({ players, options }) => new President({ players, options }),
};
