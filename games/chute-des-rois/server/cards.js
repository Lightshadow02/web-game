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

/** Valeur d'attaque / de défausse d'une carte (un boss récupéré vaut 10/15/20). */
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

/** Pioche "Taverne" : As à 10 des quatre couleurs (40 cartes). */
function buildTavern(rng) {
  const cards = [];
  for (const suit of SUITS) for (let rank = 1; rank <= 10; rank++) cards.push(makeCard(suit, rank));
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

module.exports = { SUITS, JACK, QUEEN, KING, BOSS_STATS, makeCard, cardValue, shuffle, buildTavern, buildCastle };
