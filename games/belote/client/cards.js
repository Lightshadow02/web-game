/* =====================================================================
 * Belote : conversions moteur -> design system « Tapis » et miroirs des règles
 * (raisons des cartes injouables). Le serveur reste l'autorité : ces fonctions
 * ne servent qu'à expliquer, jamais à décider.
 *
 * Cartes du moteur : { id: 'VH' | '10S' | 'AC', suit: S|H|D|C, rank: '7'…'10' | 'V' | 'D' | 'R' | 'A' }.
 * Les cartes Tapis gardent l'id du moteur (data-card-id) : main, pli et animations parlent la même langue.
 * ===================================================================== */

export const SUIT = { S: 'pique', H: 'coeur', D: 'carreau', C: 'trefle' };
export const SUIT_NAME = { S: 'Pique', H: 'Cœur', D: 'Carreau', C: 'Trèfle' };
export const SUITS = ['S', 'H', 'D', 'C'];
const RANK_NAME = { 7: '7', 8: '8', 9: '9', 10: '10', V: 'Valet', D: 'Dame', R: 'Roi', A: 'As' };
const TRUMP_ORDER = ['7', '8', 'D', 'R', '10', 'A', '9', 'V'];
const PLAIN_ORDER = ['7', '8', '9', 'V', 'D', 'R', '10', 'A'];

/** Carte du moteur -> props Tapis.Card (jeu de 52 : As « A », figures V D R). */
export function tp(c, extra = {}) {
  const r = Number(c.rank);
  return { id: c.id, suit: SUIT[c.suit], rank: Number.isNaN(r) ? c.rank : r, ...extra };
}

/** « {coeur} » pour Tapis.rich. */
export const glyph = (suit) => `{${SUIT[suit]}}`;

/** « le Valet de Cœur », « la Dame de Pique », « l’As de Trèfle », « le 10 de Carreau ». */
export function cardName(c) {
  const article = c.rank === 'A' ? 'l’' : c.rank === 'D' ? 'la ' : 'le ';
  return `${article}${RANK_NAME[c.rank]} de ${SUIT_NAME[c.suit]}`;
}

const power = (c, trump) => (c.suit === trump ? TRUMP_ORDER.indexOf(c.rank) : PLAIN_ORDER.indexOf(c.rank));

/** Qui gagne le pli en cours (non vide). */
function trickWinner(trick, trump) {
  const lead = trick[0].card.suit;
  let best = trick[0];
  for (const t of trick.slice(1)) {
    const a = t.card;
    const b = best.card;
    const wins = a.suit === b.suit ? power(a, trump) > power(b, trump) : a.suit === trump || (a.suit === lead && b.suit !== trump);
    if (wins) best = t;
  }
  return best;
}

/**
 * Pendant mon tour : raison de chaque carte injouable (miroir de legalCards du moteur ; la liste qui fait foi
 * reste state.legalCardIds) et une phrase d'aide pour le statut.
 */
export function playHints(hand, trick, legalIds, trump, partnerId) {
  const legal = new Set(legalIds);
  let reasonFor = () => 'Carte non autorisée';
  let detail = 'Entame le pli';
  if (trick.length) {
    const lead = trick[0].card.suit;
    const leadName = SUIT_NAME[lead];
    const trumps = hand.filter((c) => c.suit === trump);
    const top = Math.max(-1, ...trick.filter((t) => t.card.suit === trump).map((t) => power(t.card, trump)));
    const topCard = trick.filter((t) => t.card.suit === trump).map((t) => t.card).find((c) => power(c, trump) === top);
    const over = trumps.filter((c) => power(c, trump) > top);
    const master = trickWinner(trick, trump).playerId === partnerId;
    if (lead === trump) {
      if (over.length) {
        reasonFor = (c) => (c.suit !== trump ? 'Tu dois jouer atout' : `Tu dois monter sur ${cardName(topCard)}`);
        detail = master ? 'Atout demandé : monte, même sur ton partenaire' : 'Atout demandé : monte';
      } else if (trumps.length) {
        reasonFor = () => 'Tu dois jouer atout';
        detail = 'Atout demandé : tu ne peux pas monter, joue un atout';
      } else {
        detail = 'Pas d’atout : défausse-toi';
      }
    } else if (hand.some((c) => c.suit === lead)) {
      reasonFor = () => `Tu dois fournir à ${leadName}`;
      detail = `Fournis à ${leadName}`;
    } else if (master) {
      detail = 'Ton partenaire est maître : joue ce que tu veux';
    } else if (!trumps.length) {
      detail = `Ni ${leadName} ni atout : défausse-toi`;
    } else if (over.length) {
      const cut = top >= 0;
      reasonFor = (c) => (c.suit !== trump ? (cut ? 'Tu dois surcouper' : 'Tu dois couper') : `Tu dois monter sur ${cardName(topCard)}`);
      detail = cut ? `Pas de ${leadName} : surcoupe` : `Pas de ${leadName} : coupe`;
    } else if (hand.some((c) => c.suit !== trump)) {
      reasonFor = () => 'Tu ne peux pas sous-couper';
      detail = `Pas de ${leadName} et tu ne peux pas surcouper : défausse-toi`;
    } else {
      detail = 'Que de l’atout : tu sous-coupes';
    }
  }
  const reasons = {};
  for (const c of hand) if (!legal.has(c.id)) reasons[c.id] = reasonFor(c);
  return { reasons, detail };
}

/** Les glyphes ♠︎ ♥︎ ♦︎ ♣︎ éventuels d'un texte du moteur deviennent les glyphes du système. */
export function richLog(text) {
  return String(text)
    .replace(/[{}]/g, '')
    .replace(/♠︎?/g, '{pique}').replace(/♥︎?/g, '{coeur}')
    .replace(/♦︎?/g, '{carreau}').replace(/♣︎?/g, '{trefle}');
}
