'use strict';

const SUITS = ['H', 'D', 'C', 'S']; // Cœur, Carreau, Trèfle, Pique
const JACK = 11;
const QUEEN = 12;
const KING = 13;

/** Statistiques des boss : PV et attaque. */
const BOSS_STATS = {
  [JACK]: { hp: 20, attack: 10 },
  [QUEEN]: { hp: 30, attack: 15 },
  [KING]: { hp: 40, attack: 20 },
};

function makeCard(suit, rank) {
  return { id: `${rank}${suit}`, suit, rank };
}

/** Joker (n = 1 ou 2) : sans couleur, valeur 0. */
function makeJoker(n) {
  return { id: `JK${n}`, suit: null, rank: 0, joker: true };
}

/** Valeur d'attaque / de défausse d'une carte (un boss récupéré vaut 10/15/20, un Joker 0). */
function cardValue(card) {
  if (card.rank <= 10) return card.rank;
  return BOSS_STATS[card.rank].attack;
}

function shuffle(cards, rng = Math.random) {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Pioche "Taverne" : As à 10 des quatre couleurs (40 cartes), plus 0 à 2 Jokers selon la difficulté. */
function buildTavern(rng, jokers = 0) {
  const cards = [];
  for (const suit of SUITS) for (let rank = 1; rank <= 10; rank++) cards.push(makeCard(suit, rank));
  for (let n = 1; n <= jokers; n++) cards.push(makeJoker(n));
  return shuffle(cards, rng);
}

/**
 * Pile "Château" : Rois au fond, puis Dames, puis Valets au sommet.
 * Convention : le sommet d'une pile est la FIN du tableau (pop()).
 */
function buildCastle(rng) {
  const group = (rank) => shuffle(SUITS.map((s) => makeCard(s, rank)), rng);
  return [...group(KING), ...group(QUEEN), ...group(JACK)];
}

module.exports = { SUITS, JACK, QUEEN, KING, BOSS_STATS, makeCard, makeJoker, cardValue, shuffle, buildTavern, buildCastle };
