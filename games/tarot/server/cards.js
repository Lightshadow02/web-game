'use strict';

/**
 * Jeu de Tarot (78 cartes) :
 *   - 4 couleurs (S ♠, H ♥, D ♦, C ♣), rangs 1..10, 11 Valet, 12 Cavalier, 13 Dame, 14 Roi ;
 *   - 21 atouts (suit 'T', rangs 1..21) ;
 *   - l'Excuse (suit 'E').
 * Les trois « bouts » (oudlers) : le Petit (1 d'atout), le 21 et l'Excuse.
 */

const SUITS = ['S', 'H', 'D', 'C'];
const TRUMP = 'T';
const EXCUSE = 'E';

const makeCard = (suit, rank) => ({ id: suit === EXCUSE ? 'EX' : `${suit}${rank}`, suit, rank });

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) for (let rank = 1; rank <= 14; rank++) deck.push(makeCard(suit, rank));
  for (let rank = 1; rank <= 21; rank++) deck.push(makeCard(TRUMP, rank));
  deck.push(makeCard(EXCUSE, 0));
  return deck;
}

const isOudler = (c) => c.suit === EXCUSE || (c.suit === TRUMP && (c.rank === 1 || c.rank === 21));
const isKing = (c) => SUITS.includes(c.suit) && c.rank === 14;

/** Valeur en points (total du jeu : 91). */
function cardPoints(c) {
  if (isOudler(c)) return 4.5;
  if (SUITS.includes(c.suit)) {
    if (c.rank === 14) return 4.5;
    if (c.rank === 13) return 3.5;
    if (c.rank === 12) return 2.5;
    if (c.rank === 11) return 1.5;
  }
  return 0.5;
}

const sumPoints = (cards) => cards.reduce((total, c) => total + cardPoints(c), 0);

function shuffle(cards, rng = Math.random) {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const RANK_LABEL = { 11: 'V', 12: 'C', 13: 'D', 14: 'R' };
const SUIT_SYMBOL = { S: '♠︎', H: '♥︎', D: '♦︎', C: '♣︎' };

function describe(c) {
  if (c.suit === EXCUSE) return 'l’Excuse';
  if (c.suit === TRUMP) return c.rank === 1 ? 'le Petit' : `l’atout ${c.rank}`;
  return `${RANK_LABEL[c.rank] ?? c.rank}${SUIT_SYMBOL[c.suit]}`;
}

module.exports = { SUITS, TRUMP, EXCUSE, makeCard, buildDeck, isOudler, isKing, cardPoints, sumPoints, shuffle, describe };
