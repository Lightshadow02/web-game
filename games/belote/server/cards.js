'use strict';

/**
 * Jeu de 32 cartes de la Belote : 4 couleurs (S ♠, H ♥, D ♦, C ♣) × 7, 8, 9, 10, Valet, Dame, Roi, As.
 * Les rangs sont écrits à la française, comme sur les cartes : '7' '8' '9' '10' 'V' 'D' 'R' 'A'.
 * Identifiant d'une carte : rang + couleur ('VH' = Valet de Cœur, '10S' = 10 de Pique).
 */

const SUITS = ['S', 'H', 'D', 'C'];
/** Ordre naturel (celui des séquences d'annonces) : 7 8 9 10 V D R A. */
const RANKS = ['7', '8', '9', '10', 'V', 'D', 'R', 'A'];
/** Force à l'atout, de la plus faible à la plus forte : 7 8 D R 10 A 9 V. */
const TRUMP_ORDER = ['7', '8', 'D', 'R', '10', 'A', '9', 'V'];
/** Force hors atout, de la plus faible à la plus forte : 7 8 9 V D R 10 A. */
const PLAIN_ORDER = ['7', '8', '9', 'V', 'D', 'R', '10', 'A'];
const TRUMP_POINTS = { V: 20, 9: 14, A: 11, 10: 10, R: 4, D: 3, 8: 0, 7: 0 };
const PLAIN_POINTS = { A: 11, 10: 10, R: 4, D: 3, V: 2, 9: 0, 8: 0, 7: 0 };
const DIX_DE_DER = 10;
const TOTAL = 162; // 152 points de cartes + dix de der
const CAPOT = 252;

const SUIT_NAME = { S: 'Pique', H: 'Cœur', D: 'Carreau', C: 'Trèfle' };
const RANK_NAME = { 7: '7', 8: '8', 9: '9', 10: '10', V: 'Valet', D: 'Dame', R: 'Roi', A: 'As' };
const SUIT_SYMBOL = { S: '♠︎', H: '♥︎', D: '♦︎', C: '♣︎' };

const makeCard = (rank, suit) => ({ id: `${rank}${suit}`, suit, rank });

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(makeCard(rank, suit));
  return deck;
}

/** Valeur d'une carte selon l'atout. */
const cardPoints = (c, trump) => (c.suit === trump ? TRUMP_POINTS[c.rank] : PLAIN_POINTS[c.rank]);
const sumPoints = (cards, trump) => cards.reduce((t, c) => t + cardPoints(c, trump), 0);

/** Force d'une carte dans sa couleur (atout ou non) : plus grand = plus fort. */
const power = (c, trump) => (c.suit === trump ? TRUMP_ORDER.indexOf(c.rank) : PLAIN_ORDER.indexOf(c.rank));

function shuffle(cards, rng = Math.random) {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** « le Valet de Cœur », « la Dame de Pique », « l’As de Trèfle », « le 10 de Carreau ». */
function describe(c) {
  const name = RANK_NAME[c.rank];
  const article = c.rank === 'A' ? 'l’' : c.rank === 'D' ? 'la ' : 'le ';
  return `${article}${name} de ${SUIT_NAME[c.suit]}`;
}

module.exports = {
  SUITS, RANKS, TRUMP_ORDER, PLAIN_ORDER, TRUMP_POINTS, PLAIN_POINTS, DIX_DE_DER, TOTAL, CAPOT,
  SUIT_NAME, RANK_NAME, SUIT_SYMBOL,
  makeCard, buildDeck, cardPoints, sumPoints, power, shuffle, describe,
};
