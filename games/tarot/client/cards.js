/* =====================================================================
 * Tarot : conversions moteur -> design system « Tapis » et miroirs des règles
 * (raisons des cartes injouables, écart). Le serveur reste l'autorité :
 * ces fonctions ne servent qu'à expliquer, jamais à décider.
 *
 * Cartes du moteur : { id: 'H14' | 'T21' | 'EX', suit: S|H|D|C|T|E, rank }.
 * Les cartes Tapis gardent l'id du moteur (data-card-id), si bien que la main,
 * le chien, le pli et les animations parlent tous la même langue.
 * ===================================================================== */

export const SUIT = { S: 'pique', H: 'coeur', D: 'carreau', C: 'trefle', T: 'atout', E: 'excuse' };
export const SUIT_NAME = { S: 'Pique', H: 'Cœur', D: 'Carreau', C: 'Trèfle' };
export const FIG = { 11: 'V', 12: 'C', 13: 'D', 14: 'R' };
export const RANK_NAME = { 11: 'Valet', 12: 'Cavalier', 13: 'Dame', 14: 'Roi' };
export const SUIT_OF_TAPIS = { pique: 'S', coeur: 'H', carreau: 'D', trefle: 'C' };

/** Enchères : ids du moteur <-> ids Tapis. */
export const BID = { passe: 'passe', petite: 'petite', garde: 'garde', garde_sans: 'garde-sans', garde_contre: 'garde-contre' };
export const BID_BACK = Object.fromEntries(Object.entries(BID).map(([k, v]) => [v, k]));
export const BID_LABEL = {
  passe: 'Passe', petite: 'Petite', garde: 'Garde', garde_sans: 'Garde sans le chien', garde_contre: 'Garde contre le chien',
};
export const BID_SHORT = { passe: 'Passe', petite: 'Petite', garde: 'Garde', garde_sans: 'Garde sans', garde_contre: 'Garde contre' };
export const POIGNEE_NAME = { simple: 'simple', double: 'double', triple: 'triple' };

/** Carte du moteur -> props Tapis.Card. Le 1 d'une couleur reste « 1 » (pas d'As au Tarot). */
export function tp(c, extra = {}) {
  if (c.suit === 'E') return { id: c.id, suit: 'excuse', ...extra };
  return { id: c.id, suit: SUIT[c.suit], rank: c.suit === 'T' ? c.rank : (FIG[c.rank] ?? c.rank), ...extra };
}

export const isPlainSuit = (c) => c.suit === 'S' || c.suit === 'H' || c.suit === 'D' || c.suit === 'C';
export const isBout = (c) => c.suit === 'E' || (c.suit === 'T' && (c.rank === 1 || c.rank === 21));
export const isKing = (c) => isPlainSuit(c) && c.rank === 14;
export const trumpCount = (hand) => hand.filter((c) => c.suit === 'T' || c.suit === 'E').length;

/** « le Roi de Cœur », « la Dame de Pique », « le 7 de Trèfle », « le Petit », « le 12 d’atout », « l’Excuse ». */
export function cardName(c) {
  if (c.suit === 'E') return 'l’Excuse';
  if (c.suit === 'T') return c.rank === 1 ? 'le Petit' : c.rank === 21 ? 'le 21 d’atout' : `le ${c.rank} d’atout`;
  const fig = RANK_NAME[c.rank];
  if (!fig) return `le ${c.rank} de ${SUIT_NAME[c.suit]}`;
  return `${c.rank === 13 ? 'la' : 'le'} ${fig} de ${SUIT_NAME[c.suit]}`;
}

/** Nom d'une figure appelée : « Roi », « Dame »… et son article (« un Roi », « une Dame »). */
export const calledRankName = (rank) => RANK_NAME[rank] ?? 'Roi';
export const calledArticle = (rank) => (rank === 13 ? 'une' : 'un');
export const calledDef = (rank) => (rank === 13 ? 'la' : 'le');

/** « de Malo » / « d’Inès » (élision devant une voyelle). */
export function deName(name) {
  return /^[aeiouyàâäéèêëîïôöùûüœæ]/i.test(String(name).trim()) ? `d’${name}` : `de ${name}`;
}

/** Nombre à la française : 45,5 ; signé avec un vrai signe moins : +4,5 / −3. */
export const num = (n) => String(n).replace('.', ',');
export function signed(n) {
  if (n > 0) return `+${num(n)}`;
  if (n < 0) return `−${num(Math.abs(n))}`;
  return '0';
}

/**
 * Pendant mon tour de jeu : raison de chaque carte injouable (miroir de legalCards du moteur,
 * la liste qui fait foi reste state.legalCardIds) et une phrase d'aide pour le statut.
 */
export function playHints(hand, trick, legalIds) {
  const legal = new Set(legalIds);
  const played = trick.filter((t) => t.card.suit !== 'E');
  let reasonFor = () => 'Carte non autorisée';
  let detail;
  if (!played.length) {
    detail = trick.length ? 'L’Excuse ne donne pas la couleur : joue ce que tu veux' : 'Entame le pli';
  } else {
    const lead = played[0].card.suit;
    const max = Math.max(0, ...played.filter((t) => t.card.suit === 'T').map((t) => t.card.rank));
    const hasLead = lead !== 'T' && hand.some((c) => c.suit === lead);
    const trumps = hand.filter((c) => c.suit === 'T');
    const higher = trumps.filter((c) => c.rank > max);
    const leadName = lead === 'T' ? '' : SUIT_NAME[lead]; // en toutes lettres, comme la maquette (« Fournis à Cœur »)
    if (hasLead) {
      reasonFor = () => `Tu dois fournir à ${SUIT_NAME[lead]}`;
      detail = `Fournis à ${leadName}`;
    } else if (trumps.length) {
      reasonFor = (c) => (c.suit !== 'T' ? (lead === 'T' ? 'Tu dois jouer atout' : 'Tu dois couper avec un atout') : `Tu dois monter sur le ${max}`);
      if (lead === 'T') detail = higher.length ? `Monte sur le ${max}` : 'Joue atout (tu ne peux pas monter)';
      else detail = max && higher.length ? `Pas de ${leadName} : coupe et monte` : max ? `Pas de ${leadName} : coupe (tu ne peux pas monter)` : `Pas de ${leadName} : coupe`;
    } else {
      detail = lead === 'T' ? 'Pas d’atout : défausse-toi' : `Ni ${leadName} ni atout : défausse-toi`;
    }
  }
  const reasons = {};
  for (const c of hand) if (!legal.has(c.id)) reasons[c.id] = reasonFor(c);
  return { reasons, detail };
}

/** Écart (miroir du moteur) : ni Roi ni bout ; des atouts seulement si les autres cartes manquent. */
export function ecartRules(hand, need) {
  const plain = hand.filter((c) => isPlainSuit(c) && c.rank !== 14).length;
  const trumpsAllowed = plain < need;
  const reason = (c) => {
    if (isBout(c)) return 'Un bout ne va pas à l’écart';
    if (isKing(c)) return 'Un Roi ne va pas à l’écart';
    if (c.suit === 'T' && !trumpsAllowed) return 'Un atout ne va à l’écart que si tu manques d’autres cartes';
    return null;
  };
  return { reason, trumpsAllowed };
}

/** Comment le pli a été gagné (statut du pli complet). */
export function winDetail(cards, winnerId) {
  const win = cards.find((t) => t.playerId === winnerId)?.card;
  if (!win) return '';
  const lead = cards.find((t) => t.card.suit !== 'E')?.card.suit;
  if (win.suit === 'T') return lead === 'T' ? `Avec ${cardName(win)}` : `Coupe avec ${cardName(win)}`;
  return `Avec ${cardName(win)}`;
}

/** Les glyphes ♠︎ ♥︎ ♦︎ ♣︎ du journal du moteur deviennent les glyphes du système. */
export function richLog(text) {
  return String(text)
    .replace(/[{}]/g, '')
    .replace(/♠︎?/g, '{pique}').replace(/♥︎?/g, '{coeur}')
    .replace(/♦︎?/g, '{carreau}').replace(/♣︎?/g, '{trefle}');
}
