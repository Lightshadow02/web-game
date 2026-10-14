'use strict';

/**
 * Évaluation des mains de poker : la meilleure combinaison de 5 cartes parmi 1 à 7.
 *
 * evaluate(cards) -> {
 *   category,     0 Carte haute … 9 Quinte flush royale
 *   name,         « Paire », « Full »…
 *   description,  « Paire de Rois », « Full aux Dames par les 8 », « Quinte au 5 »…
 *   score,        [catégorie, rangs décisifs…] : comparé dans l'ordre (kickers compris)
 *   cards,        les cartes qui forment la combinaison (5 au plus), dans l'ordre de lecture
 * }
 * Avec moins de 5 cartes (avant le flop), seules paires, brelans et carrés comptent.
 */

const CATEGORIES = [
  'Carte haute', 'Paire', 'Double paire', 'Brelan', 'Quinte', 'Couleur', 'Full', 'Carré', 'Quinte flush', 'Quinte flush royale',
];

const NAME = { 11: 'Valet', 12: 'Dame', 13: 'Roi', 14: 'As' };
const PLURAL = { 11: 'Valets', 12: 'Dames', 13: 'Rois', 14: 'As' };
const rankName = (r) => NAME[r] ?? String(r);
const rankPlural = (r) => PLURAL[r] ?? String(r);
/** « de Rois », « d’As », « de 8 ». */
const de = (word) => (/^[AEIOUYÉ]/.test(word) ? `d’${word}` : `de ${word}`);
/** « à l’As », « à la Dame », « au Roi », « au 9 ». */
const au = (r) => (r === 14 ? 'à l’As' : r === 12 ? 'à la Dame' : `au ${rankName(r)}`);

function describe(category, v) {
  switch (category) {
    case 0: return `Hauteur ${rankName(v[0])}`;
    case 1: return `Paire ${de(rankPlural(v[0]))}`;
    case 2: return `Double paire, ${rankPlural(v[0])} et ${rankPlural(v[1])}`;
    case 3: return `Brelan ${de(rankPlural(v[0]))}`;
    case 4: return `Quinte ${au(v[0])}`;
    case 5: return `Couleur ${au(v[0])}`;
    case 6: return `Full aux ${rankPlural(v[0])} par les ${rankPlural(v[1])}`;
    case 7: return `Carré ${de(rankPlural(v[0]))}`;
    case 8: return `Quinte flush ${au(v[0])}`;
    default: return 'Quinte flush royale';
  }
}

const byRankDesc = (a, b) => b.rank - a.rank;

/** Meilleure quinte parmi des cartes (l'As compte aussi pour 1) : { high, cards } ou null. */
function bestStraight(cards) {
  const one = new Map();
  for (const c of [...cards].sort(byRankDesc)) if (!one.has(c.rank)) one.set(c.rank, c);
  for (let high = 14; high >= 5; high--) {
    const seq = [];
    for (let r = high; r > high - 5; r--) {
      const c = one.get(r === 1 ? 14 : r);
      if (!c) break;
      seq.push(c);
    }
    if (seq.length === 5) return { high, cards: seq };
  }
  return null;
}

function make(category, values, cards) {
  return {
    category,
    name: CATEGORIES[category],
    description: describe(category, values),
    score: [category, ...values],
    cards,
  };
}

function evaluate(cards) {
  if (!cards?.length) return null;
  const sorted = [...cards].sort(byRankDesc);
  const groups = new Map(); // rang -> cartes (rangs décroissants, ordre d'insertion)
  const suits = new Map();
  for (const c of sorted) {
    if (!groups.has(c.rank)) groups.set(c.rank, []);
    groups.get(c.rank).push(c);
    if (!suits.has(c.suit)) suits.set(c.suit, []);
    suits.get(c.suit).push(c);
  }
  const flush = [...suits.values()].find((list) => list.length >= 5) ?? null;
  if (flush) {
    const sf = bestStraight(flush);
    if (sf) return make(sf.high === 14 ? 9 : 8, [sf.high], sf.cards);
  }
  const ranks = [...groups.keys()];
  const quads = ranks.filter((r) => groups.get(r).length === 4);
  const trips = ranks.filter((r) => groups.get(r).length === 3);
  const pairs = ranks.filter((r) => groups.get(r).length === 2);
  const rest = (used, n) => sorted.filter((c) => !used.includes(c)).slice(0, n);
  const rk = (list) => list.map((c) => c.rank);

  if (quads.length) {
    const q = groups.get(quads[0]);
    const k = rest(q, 1);
    return make(7, [quads[0], ...rk(k)], [...q, ...k]);
  }
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0];
    const p = Math.max(trips[1] ?? 0, pairs[0] ?? 0);
    return make(6, [t, p], [...groups.get(t), ...groups.get(p).slice(0, 2)]);
  }
  if (flush) {
    const f = flush.slice(0, 5);
    return make(5, rk(f), f);
  }
  const straight = bestStraight(sorted);
  if (straight) return make(4, [straight.high], straight.cards);
  if (trips.length) {
    const t = groups.get(trips[0]);
    const k = rest(t, 2);
    return make(3, [trips[0], ...rk(k)], [...t, ...k]);
  }
  if (pairs.length >= 2) {
    const a = groups.get(pairs[0]);
    const b = groups.get(pairs[1]);
    const k = rest([...a, ...b], 1);
    return make(2, [pairs[0], pairs[1], ...rk(k)], [...a, ...b, ...k]);
  }
  if (pairs.length) {
    const p = groups.get(pairs[0]);
    const k = rest(p, 3);
    return make(1, [pairs[0], ...rk(k)], [...p, ...k]);
  }
  const top = sorted.slice(0, 5);
  return make(0, rk(top), top);
}

/** > 0 si a bat b, < 0 si b bat a, 0 en cas d'égalité parfaite (pot partagé). */
function compareHands(a, b) {
  const n = Math.max(a.score.length, b.score.length);
  for (let i = 0; i < n; i++) {
    const d = (a.score[i] ?? -1) - (b.score[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/** Rangs « principaux » de chaque catégorie, avant les kickers. */
const MAIN = { 0: 1, 1: 1, 2: 2, 3: 1, 7: 1 };

/**
 * Quand a bat b à la même combinaison (mêmes rangs principaux), la carte qui a fait la différence :
 * « kicker Dame ». Sinon null.
 */
function kickerNote(a, b) {
  if (!a || !b || a.category !== b.category || MAIN[a.category] == null) return null;
  const main = MAIN[a.category];
  for (let i = 1; i <= main; i++) if (a.score[i] !== b.score[i]) return null;
  for (let i = main + 1; i < a.score.length; i++) {
    if (a.score[i] !== b.score[i]) return a.score[i] > (b.score[i] ?? -1) ? `kicker ${rankName(a.score[i])}` : null;
  }
  return null;
}

module.exports = { CATEGORIES, evaluate, compareHands, kickerNote, describe, rankName, rankPlural };
