'use strict';

const { Poker } = require('./Poker');

/** Point d'entrée du jeu, découvert automatiquement par le GameRegistry. */
module.exports = {
  id: 'poker',
  name: "Poker Texas Hold'em",
  description:
    'Texas Hold’em No Limit en tournoi : même tapis pour tous, blindes qui montent, le dernier joueur avec des jetons gagne. De 2 à 8 joueurs.',
  scoreLabel: 'Adversaires battus',
  minPlayers: 2,
  maxPlayers: 8,
  options: [
    {
      id: 'stack',
      label: 'Tapis de départ',
      default: 2000,
      choices: [
        { value: 1000, label: '1 000 jetons', description: 'Partie courte : 50 grosses blindes au départ.' },
        { value: 2000, label: '2 000 jetons', description: '100 grosses blindes au départ.' },
        { value: 5000, label: '5 000 jetons', description: 'Partie longue : 250 grosses blindes au départ.' },
      ],
    },
    {
      id: 'blinds',
      label: 'Montée des blindes',
      default: 'normale',
      choices: [
        { value: 'rapide', label: 'Rapide', description: 'Les blindes montent toutes les 5 mains.' },
        { value: 'normale', label: 'Normale', description: 'Les blindes montent toutes les 10 mains.' },
        { value: 'lente', label: 'Lente', description: 'Les blindes montent toutes les 15 mains.' },
      ],
    },
  ],
  createGame: ({ players, options }) => new Poker({ players, options }),
};
