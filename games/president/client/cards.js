/* =====================================================================
 * Président : conversions moteur -> design system « Tapis », noms français
 * et miroir des règles d'ordre (pour expliquer un refus, jamais pour décider :
 * le serveur reste l'autorité).
 *
 * Cartes du moteur : { id: '3C' | '10H' | 'QS' | 'AD' | '2C', rank: 2..14 (11 V, 12 D, 13 R, 14 As), suit: S|H|D|C }.
 * Les cartes Tapis gardent l'id du moteur (data-card-id) : main, pile et animations parlent la même langue.
 * ===================================================================== */

export const SUIT = { S: 'pique', H: 'coeur', D: 'carreau', C: 'trefle' };
const FIG = { 11: 'V', 12: 'D', 13: 'R', 14: 'A' };
const SUITS = ['S', 'H', 'C', 'D'];
export const RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 2];

/** Carte du moteur -> props Tapis.Card. */
export const tp = (c, extra = {}) => ({ id: c.id, suit: SUIT[c.suit], rank: FIG[c.rank] ?? c.rank, ...extra });

// ---------------------------------------------------------------- noms

const RANK_NAME = { 11: 'Valet', 12: 'Dame', 13: 'Roi', 14: 'As' };
export const rankName = (r) => RANK_NAME[r] ?? String(r);
const plural = (r) => (r >= 11 && r <= 13 ? `${rankName(r)}s` : rankName(r));
/** « le 9 », « la Dame », « l’As » ; au pluriel « les 9 », « les Dames ». */
export function rankArticle(r, count = 1) {
  if (count > 1) return `les ${plural(r)}`;
  if (r === 14) return 'l’As';
  return `${r === 12 ? 'la' : 'le'} ${rankName(r)}`;
}
/** « le 9 », « la paire de 9 », « le brelan de Dames », « le carré d’As » (article compris). */
export function comboName(rank, count, { article = true } = {}) {
  if (count === 1) return article ? rankArticle(rank) : rankName(rank);
  const kind = { 2: 'paire', 3: 'brelan', 4: 'carré' }[count];
  const de = rank === 14 ? 'd’' : 'de ';
  const name = `${kind} ${de}${plural(rank)}`;
  if (!article) return name;
  return `${count === 2 ? 'la' : 'le'} ${name}`;
}
/** « Paire de 9 », « Dame » : avec une majuscule, sans article. */
export const comboTitle = (rank, count) => {
  const s = comboName(rank, count, { article: false });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const cardsText = (n) => `${n} carte${n > 1 ? 's' : ''}`;
export const placeText = (p) => (p === 1 ? '1er' : `${p}e`);

/** Titres de manche : libellé, icône, ton du badge Tapis. */
export const TITLE = {
  president: { label: 'Président', short: 'Président', icon: 'crown', tone: 'accent', points: 4 },
  'vice-president': { label: 'Vice-président', short: 'V-prés.', icon: 'chevron-up', tone: 'positive', points: 3 },
  neutre: { label: 'Neutre', short: 'Neutre', icon: null, tone: 'muted', points: 2 },
  'vice-trouduc': { label: 'Vice-trouduc', short: 'V-trou.', icon: 'chevron-down', tone: 'muted', points: 1 },
  trouduc: { label: 'Trouduc', short: 'Trouduc', icon: 'chevron-down', tone: 'danger', points: 0 },
};

/** Signé avec un vrai signe moins : +4, −3. */
export function signed(n) {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${-n}`;
  return '0';
}

/** « de Malo » / « d’Inès ». */
export const deName = (name) => (/^[aeiouyàâäéèêëîïôöùûüœæh]/i.test(String(name).trim()) ? `d’${name}` : `de ${name}`);

// ---------------------------------------------------------------- ordre des valeurs (miroir du moteur)

const power = (r) => (r === 2 ? 15 : r);

export function makeOrder({ revolution = false, twoCloses = true } = {}) {
  // le 2 qui ferme reste au-dessus de tout, même en révolution
  const value = (r) => (twoCloses && r === 2 ? 99 : revolution ? -power(r) : power(r));
  const canBeat = (r, cur) => {
    if (twoCloses && cur === 2) return false;
    if (twoCloses && r === 2) return true;
    return value(r) > value(cur);
  };
  const unbeatable = (cur) => !RANKS.some((r) => canBeat(r, cur));
  return { value, canBeat, unbeatable };
}

/** Ma main dans l'ordre du moment, de la plus faible à la plus forte (en révolution, le 3 passe à droite). */
export function sortForOrder(cards, order) {
  return [...cards].sort((a, b) => order.value(a.rank) - order.value(b.rank) || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));
}

/** « 2 cartes plus fortes que les 9 » (ou plus basses, en révolution ; « ou des 2 » quand le 2 ferme). */
export function followText(top, revolution, twoCloses) {
  const what = top.count === 1 ? 'une carte' : `${top.count} cartes`;
  const adj = revolution ? (top.count === 1 ? 'plus basse' : 'plus basses') : (top.count === 1 ? 'plus forte' : 'plus fortes');
  const extra = revolution && twoCloses && top.rank !== 2 ? (top.count === 1 ? ' (ou un 2)' : ' (ou des 2)') : '';
  return `${what} ${adj} que ${rankArticle(top.rank, top.count)}${extra}`;
}

/** « Il faut 2 cartes plus fortes que les 9 » ; « Révolution : il faut… ». */
export const needText = (top, revolution, twoCloses) => `${revolution ? 'Révolution : il' : 'Il'} faut ${followText(top, revolution, twoCloses)}`;

/**
 * Pourquoi je ne peux pas jouer cette carte maintenant (ou null) : valeur trop faible, ou pas assez d'exemplaires.
 * Seulement quand je dois suivre (à l'entame, tout est jouable).
 */
export function cardReason(card, hand, top, s) {
  if (!top) return null;
  const order = makeOrder({ revolution: s.revolution, twoCloses: s.options.twoCloses });
  if (!order.canBeat(card.rank, top.rank)) return needText(top, s.revolution, s.options.twoCloses);
  const have = hand.filter((c) => c.rank === card.rank).length;
  if (have < top.count) return `Il te faut ${top.count} ${plural(card.rank)} : tu en as ${have}`;
  return null;
}

/** Ma sélection est-elle jouable ? { ok, reason, label } */
export function checkSelection(sel, s) {
  const top = s.pile.at(-1) ?? null;
  if (!sel.length) {
    return { ok: false, reason: top ? `Choisis ${top.count === 1 ? 'une carte' : `${top.count} cartes de même valeur`}, ou passe` : 'Choisis de 1 à 4 cartes de même valeur' };
  }
  const rank = sel[0].rank;
  if (sel.some((c) => c.rank !== rank)) return { ok: false, reason: 'Les cartes posées ensemble doivent être de même valeur' };
  if (top && sel.length !== top.count) {
    return { ok: false, reason: top.count === 1 ? 'Une seule carte, comme l’entame' : `Il faut ${top.count} cartes, comme l’entame (${sel.length}/${top.count})` };
  }
  const order = makeOrder({ revolution: s.revolution, twoCloses: s.options.twoCloses });
  if (top && !order.canBeat(rank, top.rank)) return { ok: false, reason: needText(top, s.revolution, s.options.twoCloses) };
  return { ok: true, rank, count: sel.length };
}

/** Les glyphes ♠ ♥ ♦ ♣ du journal du moteur deviennent les glyphes du système. */
export function richLog(text) {
  return String(text)
    .replace(/[{}]/g, '')
    .replace(/♠︎?/g, '{pique}').replace(/♥︎?/g, '{coeur}')
    .replace(/♦︎?/g, '{carreau}').replace(/♣︎?/g, '{trefle}');
}
