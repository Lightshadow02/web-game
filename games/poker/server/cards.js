'use strict';

/**
 * Jeu de 52 cartes du poker.
 *   - couleurs : S ♠, H ♥, D ♦, C ♣ ;
 *   - rangs 2..14 (11 Valet, 12 Dame, 13 Roi, 14 As ; l'As sert aussi de 1 dans la quinte A-2-3-4-5).
 * Identifiant court et stable : rang (2-9, T, J, Q, K, A) + couleur, ex. 'AS', 'TD', '7H'.
 */

const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const RANK_CHAR = { 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const CHAR_RANK = { T: 10, J: 11, Q: 12, K: 13, A: 14 };

const makeCard = (rank, suit) => ({ id: `${RANK_CHAR[rank] ?? rank}${suit}`, rank, suit });

/** 'AS' -> { id: 'AS', rank: 14, suit: 'S' } ; accepte aussi '10H'. */
function parseCard(id) {
  const text = String(id).toUpperCase();
  const suit = text.slice(-1);
  const r = text.slice(0, -1);
  const rank = CHAR_RANK[r] ?? Number(r);
  if (!SUITS.includes(suit) || !RANKS.includes(rank)) throw new Error(`Carte inconnue : ${id}`);
  return makeCard(rank, suit);
}

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(makeCard(rank, suit));
  return deck;
}

/** Mélange de Fisher-Yates (rng injectable pour les tests). */
function shuffle(cards, rng = Math.random) {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Libellé court à la française pour le journal : « R♠ », « 10♥ », « A♦ ». */
const RANK_SHORT = { 11: 'V', 12: 'D', 13: 'R', 14: 'A' };
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const cardLabel = (c) => `${RANK_SHORT[c.rank] ?? c.rank}${SUIT_SYMBOL[c.suit]}`;

module.exports = { SUITS, RANKS, makeCard, parseCard, buildDeck, shuffle, cardLabel };
