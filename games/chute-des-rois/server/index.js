'use strict';

const { ChuteDesRois, DIFFICULTIES } = require('./ChuteDesRois');

const DEFAULT_DIFFICULTY = 'normal';

/** Point d'entrée du jeu, découvert automatiquement par le GameRegistry. */
module.exports = {
  id: 'chute-des-rois',
  name: 'La Chute des Rois',
  description:
    'Coopératif (1-4 joueurs). Unissez-vous pour renverser les 12 souverains corrompus avec un simple jeu de 52 cartes.',
  scoreLabel: 'Souverains vaincus', // libellé du score dans les stats du Hub
  minPlayers: 1,
  maxPlayers: 4,
  // Réglée par l'hôte dans le salon : nombre de Jokers mélangés dans la Taverne.
  options: [
    {
      id: 'difficulty',
      label: 'Difficulté',
      default: DEFAULT_DIFFICULTY,
      choices: [
        { value: 'facile', label: 'Facile (2 Jokers)', description: 'Deux Jokers dans la Taverne : chacun lève l’immunité d’un boss et évite sa riposte.' },
        { value: 'normal', label: 'Normal (1 Joker)', description: 'Un Joker dans la Taverne : il lève l’immunité d’un boss et évite sa riposte.' },
        { value: 'classique', label: 'Classique (sans Joker)', description: 'Les règles d’origine, sans Joker.' },
      ],
    },
  ],
  createGame: ({ players, options }) => {
    const difficulty = options?.difficulty ?? DEFAULT_DIFFICULTY;
    return new ChuteDesRois({ players, difficulty: DIFFICULTIES[difficulty] ? difficulty : DEFAULT_DIFFICULTY });
  },
};
