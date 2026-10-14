'use strict';

/**
 * Cartes du Blackjack : jeu de 52 cartes, sabot de plusieurs jeux.
 *   - couleurs S ♠, H ♥, D ♦, C ♣ ; rangs 1 (As) à 13 (11 Valet, 12 Dame, 13 Roi) ;
 *   - valeurs : As = 1 ou 11, 2 à 10 = leur valeur, figures = 10.
 * Les cartes du sabot n'ont pas d'identifiant : il est attribué au moment où la carte
 * est tirée (c1, c2…), si bien qu'un identifiant ne dit rien de la place d'une carte dans le sabot.
 */

const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_NAME = { S: 'Pique', H: 'Cœur', D: 'Carreau', C: 'Trèfle' };
const RANK_NAME = { 1: 'As', 11: 'Valet', 12: 'Dame', 13: 'Roi' };

/** Sabot neuf (non mélangé) de `decks` jeux de 52 cartes. */
function buildShoe(decks = 6) {
  const shoe = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) shoe.push({ suit, rank });
  }
  return shoe;
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

/** Valeur d'une carte, l'As compté 1 (le 11 est décidé par handValue). */
const cardValue = (c) => (c.rank === 1 ? 1 : Math.min(10, c.rank));

/**
 * Valeur d'une main : { total, low, soft }.
 * `low` compte tous les As à 1 ; une main est « souple » (soft) quand un As peut valoir 11 sans dépasser 21.
 * Exemple : As + 6 -> { total: 17, low: 7, soft: true } (affiché « 7 / 17 »).
 */
function handValue(cards) {
  let low = 0;
  let aces = 0;
  for (const c of cards) {
    low += cardValue(c);
    if (c.rank === 1) aces++;
  }
  const soft = aces > 0 && low + 10 <= 21;
  return { total: soft ? low + 10 : low, low, soft };
}

/** Blackjack naturel : As + carte de valeur 10 en deux cartes (hors main issue d'une séparation). */
const isNatural = (cards) => cards.length === 2 && handValue(cards).total === 21;

/** « Dame de Cœur », « 7 de Pique », « As de Trèfle ». */
const cardName = (c) => `${RANK_NAME[c.rank] ?? c.rank} de ${SUIT_NAME[c.suit]}`;

module.exports = { SUITS, SUIT_NAME, RANK_NAME, buildShoe, shuffle, cardValue, handValue, isNatural, cardName };
