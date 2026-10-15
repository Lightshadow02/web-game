/* =====================================================================
 * Rami : validation des combinaisons côté client (aperçu en direct de la sélection).
 * Copie fidèle de games/rami/server/melds.js (le serveur reste l'arbitre) ;
 * test/rami.test.js vérifie que les deux donnent les mêmes réponses.
 * ===================================================================== */

const SUITS = ['S', 'H', 'D', 'C'];
const JOKER = 'JK';
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_NAME = { S: 'Pique', H: 'Cœur', D: 'Carreau', C: 'Trèfle' };
const RANK_SHORT = { 1: 'A', 11: 'V', 12: 'D', 13: 'R', 14: 'A' };

const isJoker = (c) => !!c && (c.joker === true || c.suit === JOKER);

/** Valeur d'une position de suite (As bas 1, As haut 11, figures 10). */
const posValue = (pos) => (pos === 1 ? 1 : pos === 14 ? 11 : pos >= 11 ? 10 : pos);
/** Valeur d'un rang dans un brelan/carré (As 11, figures 10). */
const rankValue = (rank) => (rank === 1 ? 11 : rank >= 11 ? 10 : rank);
/** Pénalité d'une carte restée en main : Joker 20, As 11, figures 10, autres leur valeur. */
const PENALTY_JOKER = 20;
const penalty = (c) => (isJoker(c) ? PENALTY_JOKER : rankValue(c.rank));
const handPenalty = (cards) => cards.reduce((sum, c) => sum + penalty(c), 0);

/** « 7♥ », « A♠ », « Joker » (journal). */
function describe(c) {
  if (isJoker(c)) return 'Joker';
  return `${RANK_SHORT[c.rank] ?? c.rank}${SUIT_SYMBOL[c.suit]}`;
}

const fail = (error) => ({ ok: false, error });
const strip = (c) => {
  const { as, pos, ...rest } = c;
  return rest;
};

/**
 * Analyse une suite. items : cartes naturelles, Jokers déjà placés (as.pos fixé) ou Joker libre.
 * jokerEnd : 'low' | 'high' pour placer un Joker libre en bout de suite (défaut : en haut si possible).
 */
function analyzeRun(cards, { jokerEnd } = {}) {
  const naturals = cards.filter((c) => !isJoker(c));
  const jokers = cards.filter(isJoker);
  const fixed = jokers.filter((j) => j.as && j.as.pos);
  const free = jokers.filter((j) => !(j.as && j.as.pos));
  if (!naturals.length) return fail('Il faut au moins une vraie carte');
  const suit = naturals[0].suit;
  if (naturals.some((c) => c.suit !== suit)) {
    return fail('Une suite se fait dans une seule couleur, et un brelan avec des cartes de même rang');
  }
  if (fixed.some((j) => j.as.suit && j.as.suit !== suit)) return fail('Le Joker ne remplace pas une carte de cette couleur');
  const tries = [];
  const hasAce = naturals.some((c) => c.rank === 1);
  for (const aceHigh of hasAce ? [false, true] : [false]) {
    const placed = naturals.map((c) => ({ card: c, pos: c.rank === 1 && aceHigh ? 14 : c.rank }))
      .concat(fixed.map((j) => ({ card: j, pos: j.as.pos })));
    const positions = placed.map((p) => p.pos);
    if (new Set(positions).size !== positions.length) {
      tries.push('Une suite ne peut pas contenir deux fois la même carte');
      continue;
    }
    const min = Math.min(...positions);
    const max = Math.max(...positions);
    const gaps = max - min + 1 - placed.length;
    if (gaps > free.length) {
      tries.push(free.length ? 'Les cartes ne se suivent pas, même avec le Joker' : 'Les cartes ne se suivent pas');
      continue;
    }
    if (free.length) {
      const joker = free[0];
      let pos;
      if (gaps === 1) {
        for (let p = min; p <= max; p++) if (!positions.includes(p)) pos = p;
      } else {
        const ends = jokerEnd === 'low' ? [min - 1, max + 1] : [max + 1, min - 1];
        pos = ends.find((p) => p >= 1 && p <= 14);
      }
      if (pos === undefined) {
        tries.push('Pas de place pour le Joker dans cette suite');
        continue;
      }
      placed.push({ card: joker, pos });
    }
    const all = placed.map((p) => p.pos);
    if (Math.min(...all) < 1 || Math.max(...all) > 14) {
      tries.push('Pas de tour du coin : l’As est bas (A-2-3) ou haut (D-R-A)');
      continue;
    }
    placed.sort((a, b) => a.pos - b.pos);
    const out = placed.map(({ card, pos }) => (isJoker(card)
      ? { ...strip(card), as: { rank: pos === 14 ? 1 : pos, suit, pos }, pos }
      : { ...strip(card), pos }));
    return { ok: true, type: 'run', suit, cards: out, value: placed.reduce((s, p) => s + posValue(p.pos), 0) };
  }
  return fail(tries[0] ?? 'Suite impossible');
}

/** Analyse un brelan ou un carré. */
function analyzeSet(cards) {
  const naturals = cards.filter((c) => !isJoker(c));
  const jokers = cards.filter(isJoker);
  if (!naturals.length) return fail('Il faut au moins une vraie carte');
  const rank = naturals[0].rank;
  if (naturals.some((c) => c.rank !== rank)) return fail('Un brelan se fait avec des cartes de même rang');
  if (cards.length > 4) return fail('Un carré compte 4 cartes au plus');
  const suits = naturals.map((c) => c.suit);
  if (new Set(suits).size !== suits.length) return fail('Les cartes d’un brelan sont de couleurs différentes');
  for (const j of jokers) {
    if (j.as && j.as.rank && j.as.rank !== rank) return fail('Le Joker ne remplace pas une carte de ce rang');
    if (j.as && j.as.suit && suits.includes(j.as.suit)) return fail('Le Joker remplace une couleur déjà présente');
  }
  const missing = SUITS.filter((s) => !suits.includes(s));
  const ordered = [...naturals].sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)).map(strip);
  const out = ordered.concat(jokers.map((j) => ({
    ...strip(j), as: { rank, suit: missing.length === 1 ? missing[0] : (j.as && j.as.suit) || null },
  })));
  return { ok: true, type: 'set', rank, cards: out, value: cards.length * rankValue(rank) };
}

/**
 * Valide une combinaison. opts.type force 'set' ou 'run' (ajout sur une combinaison posée) ;
 * opts.jokerEnd place un Joker libre en bas ou en haut d'une suite.
 * Renvoie { ok: true, type, cards (ordonnées, Joker avec `as`), value } ou { ok: false, error }.
 */
function analyzeMeld(cards, opts = {}) {
  if (!Array.isArray(cards) || cards.length < 3) return fail('Une combinaison compte au moins 3 cartes');
  const jokers = cards.filter(isJoker);
  if (jokers.length > 1) return fail('Un seul Joker par combinaison');
  const naturals = cards.filter((c) => !isJoker(c));
  if (!naturals.length) return fail('Il faut au moins une vraie carte');
  if (opts.type === 'set') return analyzeSet(cards);
  if (opts.type === 'run') return analyzeRun(cards, opts);
  const sameRank = naturals.every((c) => c.rank === naturals[0].rank);
  if (sameRank && naturals.length >= 2) return analyzeSet(cards);
  return analyzeRun(cards, opts);
}

/** Ce que le Joker d'une combinaison remplace : la carte naturelle qui peut le libérer ? */
function canReplaceJoker(meld, card) {
  if (isJoker(card)) return false;
  const joker = meld.cards.find(isJoker);
  if (!joker) return false;
  if (meld.type === 'run') return card.suit === joker.as.suit && card.rank === joker.as.rank;
  const suits = meld.cards.filter((c) => !isJoker(c)).map((c) => c.suit);
  return card.rank === joker.as.rank && !suits.includes(card.suit) && (!joker.as.suit || joker.as.suit === card.suit);
}

/** Valeur d'une combinaison (ouverture) : chaque carte vaut sa place, le Joker celle de la carte qu'il remplace. */
function meldValue(meld) {
  if (meld.type === 'run') return meld.cards.reduce((s, c) => s + posValue(c.pos), 0);
  return meld.cards.length * rankValue(meld.rank ?? meld.cards.find((c) => !isJoker(c)).rank);
}

export {
  SUITS, JOKER, SUIT_SYMBOL, SUIT_NAME, PENALTY_JOKER,
  isJoker, posValue, rankValue, penalty, handPenalty, describe,
  analyzeMeld, canReplaceJoker, meldValue,
};
