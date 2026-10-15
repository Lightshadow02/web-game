'use strict';

/**
 * Président : le jeu de 52 cartes et l'ordre des valeurs.
 * Carte : { id: '3C' | '10H' | 'QS' | 'AD' | '2C', rank: 2..14 (11 V, 12 D, 13 R, 14 As), suit: S|H|D|C }.
 * Ordre normal, du plus faible au plus fort : 3 4 5 6 7 8 9 10 V D R As 2.
 */

const SUITS = ['S', 'H', 'C', 'D']; // ♠ ♥ ♣ ♦ : couleurs alternées, comme le tri de Tapis
const RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 2]; // ordre normal, du plus faible au plus fort
const RANK_CHAR = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const CHAR_RANK = { J: 11, Q: 12, K: 13, A: 14 };
const SUIT_SIGN = { S: '♠', H: '♥', D: '♦', C: '♣' };

/** Puissance dans l'ordre normal : 3 -> 3 … As -> 14, 2 -> 15. */
const power = (rank) => (rank === 2 ? 15 : rank);

const cardId = (rank, suit) => `${RANK_CHAR[rank] ?? rank}${suit}`;

function parseCard(id) {
  const m = /^(10|[2-9JQKA])([SHDC])$/.exec(String(id));
  if (!m) throw new Error(`Carte inconnue : ${id}`);
  const rank = CHAR_RANK[m[1]] ?? Number(m[1]);
  return { id: cardId(rank, m[2]), rank, suit: m[2] };
}

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ id: cardId(rank, suit), rank, suit });
  return deck;
}

/** Mélange de Fisher-Yates (rng injectable pour les tests). */
function shuffle(cards, rng = Math.random) {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Main triée par puissance croissante (ordre normal), puis par couleur. */
function sortHand(hand) {
  return [...hand].sort((a, b) => power(a.rank) - power(b.rank) || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
}

/** Noms français : « 9 », « Valet », « Dame », « Roi », « As », « 2 ». */
const RANK_NAME = { 11: 'Valet', 12: 'Dame', 13: 'Roi', 14: 'As' };
const rankName = (rank) => RANK_NAME[rank] ?? String(rank);
/** « le 9 », « la Dame », « l’As » ; au pluriel « les 9 », « les Dames », « les As ». */
function rankArticle(rank, count = 1) {
  const name = rankName(rank);
  if (count > 1) return `les ${rank === 11 || rank === 12 || rank === 13 ? `${name}s` : name}`;
  if (rank === 14) return 'l’As';
  return `${rank === 12 ? 'la' : 'le'} ${name}`;
}
/** « 9 ♠ 9 ♥ » pour le journal. */
const describe = (cards) => cards.map((c) => `${rankName(c.rank)} ${SUIT_SIGN[c.suit]}`).join(' ');

module.exports = { SUITS, RANKS, power, cardId, parseCard, buildDeck, shuffle, sortHand, rankName, rankArticle, describe };
