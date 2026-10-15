/* =====================================================================
 * Rami : cartes du moteur -> cartes Tapis, libellés français.
 * Moteur : { id: 'H7a', suit: 'S'|'H'|'D'|'C', rank: 1..13 } (1 As, 11 Valet, 12 Dame, 13 Roi),
 *          Joker { id: 'JK1', suit: 'JK', rank: 0, joker: true }.
 * Tapis n'a pas de Joker : il prend la carte de l'Excuse (même rôle de carte libre), renommée par jk().
 * ===================================================================== */

import { isJoker } from './melds.js';

export const SUIT = { S: 'pique', H: 'coeur', D: 'carreau', C: 'trefle' };
export const SUIT_NAME = { S: 'Pique', H: 'Cœur', D: 'Carreau', C: 'Trèfle' };
const RANK = { 1: 'A', 11: 'V', 12: 'D', 13: 'R', 14: 'A' };
const RANK_WORD = { 1: 'As', 11: 'Valet', 12: 'Dame', 13: 'Roi', 14: 'As' };
const RANK_PLURAL = { 1: 'd’As', 11: 'de Valets', 12: 'de Dames', 13: 'de Rois' };
/** Ordre d'une main triée par couleur (alternance noir/rouge, comme Tapis). */
const SUIT_ORDER = ['S', 'H', 'C', 'D'];

/** Carte du moteur vers Tapis ; extra : size, state, selected… */
export const tp = (c, extra = {}) => (isJoker(c)
  ? { suit: 'excuse', id: c.id, ...extra }
  : { suit: SUIT[c.suit], rank: RANK[c.rank] ?? c.rank, id: c.id, ...extra });

/** HTML Tapis contenant des cartes : l'Excuse devient le Joker (nom accessible, ruban, sans « Bout »). */
export const jk = (html) => (html.includes('data-suit="excuse"')
  ? html.replaceAll('L’Excuse (bout)', 'Joker').replaceAll('L’Excuse', 'Joker').replaceAll('>Excuse</text>', '>Joker</text>')
    .replace(/<text[^>]*class="tp-trump__bout">Bout<\/text>/g, '')
  : html);

/** « 7 {coeur} », « As {pique} », « Dame {trefle} », « Joker » (glyphes posés par Tapis.rich). */
export const lab = (c) => (isJoker(c) ? 'Joker' : `${RANK_WORD[c.rank] ?? c.rank} {${SUIT[c.suit]}}`);
/** « 7{coeur} », « A{pique} » : court, pour les listes. */
export const short = (c) => (isJoker(c) ? 'Joker' : `${RANK[c.rank] ?? c.rank}{${SUIT[c.suit]}}`);
/** Ce que remplace un Joker posé : « 6{coeur} », ou « 8 » dans un brelan sans couleur fixée. */
export const asText = (j) => (j.as ? `${RANK[j.as.rank] ?? j.as.rank}${j.as.suit ? `{${SUIT[j.as.suit]}}` : ''}` : '');

/** « Suite de 4 à {coeur} », « Brelan de 7 », « Carré de Rois », « Brelan d’As ». */
export function meldName(m) {
  if (m.type === 'run') return `Suite de ${m.cards.length} à {${SUIT[m.suit ?? m.cards.find((c) => !isJoker(c)).suit]}}`;
  const rank = m.rank ?? m.cards.find((c) => !isJoker(c)).rank;
  return `${m.cards.length === 4 ? 'Carré' : 'Brelan'} ${RANK_PLURAL[rank] ?? `de ${rank}`}`;
}
/** « la suite de Léa », « ton brelan ». */
export function meldOf(m, ownerName, mine) {
  const kind = m.type === 'run' ? 'suite' : m.cards.length === 4 ? 'carré' : 'brelan';
  if (mine) return `${kind === 'suite' ? 'ta' : 'ton'} ${kind}`;
  return `${kind === 'suite' ? 'la' : 'le'} ${kind} ${deName(ownerName)}`;
}

/** Texte sans glyphes, pour les noms accessibles : « Suite de 4 à Cœur ». */
export const plain = (text) => String(text).replace(/\{(pique|coeur|carreau|trefle)\}/g, (m, k) => ({ pique: 'Pique', coeur: 'Cœur', carreau: 'Carreau', trefle: 'Trèfle' })[k]);
/** « 7 de Cœur », « As de Pique », « Joker ». */
export const cardName = (c) => (isJoker(c) ? 'Joker' : `${RANK_WORD[c.rank] ?? c.rank} de ${SUIT_NAME[c.suit]}`);

/** « de Léa » / « d’Arthur ». */
export const deName = (name) => (/^[aeiouyhàâäéèêëîïôöûüù]/i.test(String(name)) ? `d’${name}` : `de ${name}`);
export const pl = (n, word, plural = `${word}s`) => `${n} ${n > 1 ? plural : word}`;
export const pts = (n) => `${n} pt${Math.abs(n) > 1 ? 's' : ''}`;

/** Main triée : par couleur (puis rang, As en tête) ou par rang (puis couleur) ; Jokers à la fin. */
export function sortHand(cards, mode = 'suit') {
  const key = (c) => {
    if (isJoker(c)) return [99, 99];
    const s = SUIT_ORDER.indexOf(c.suit);
    return mode === 'rank' ? [c.rank, s] : [s, c.rank];
  };
  return [...cards].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || a.id.localeCompare(b.id);
  });
}

/** Journal du moteur : glyphes ♠♥♦♣ vers les jetons Tapis. */
export function glyphs(text) {
  return String(text).replace(/[{}]/g, '').replace(/([0-9AVDR]+)?([♠♥♦♣])/g, (m, r, g) => `${r ?? ''}{${{ '♠': 'pique', '♥': 'coeur', '♦': 'carreau', '♣': 'trefle' }[g]}}`);
}
