/* =====================================================================
 * Blackjack : conversions moteur -> design system « Tapis » et petits outils.
 *
 * Cartes du moteur : { id: 'c12', suit: S|H|D|C, rank: 1..13 } (1 = As, 11 Valet, 12 Dame, 13 Roi).
 * L'identifiant est donné par le serveur au moment où la carte sort du sabot : il devient
 * le data-card-id de la carte Tapis, si bien que les animations retrouvent chaque carte.
 * La carte cachée de la banque arrive sous la forme { hidden: true }, sans rien d'autre.
 * ===================================================================== */

export const SUIT = { S: 'pique', H: 'coeur', D: 'carreau', C: 'trefle' };
export const RANK = { 1: 'A', 11: 'V', 12: 'D', 13: 'R' };

/** Carte du moteur -> props Tapis.Card. */
export function tp(c, extra = {}) {
  return { id: c.id, suit: SUIT[c.suit], rank: RANK[c.rank] ?? c.rank, ...extra };
}

/** Nombres à la française : 1 450 (espace fine insécable), +50, −25 (vrai signe moins). */
const NF = new Intl.NumberFormat('fr-FR');
export const fmt = (n) => NF.format(n);
export function signed(n) {
  if (n > 0) return `+${fmt(n)}`;
  if (n < 0) return `−${fmt(-n)}`;
  return '0';
}

/** Jetons : coupures dessinées (les boutons de mise n'utilisent que 10, 25, 100 et 500). */
export const DENOMS = [500, 100, 25, 10, 5, 1];
export const CHIP_BUTTONS = [10, 25, 100, 500];

/** Décompose un montant en jetons (les plus gros en bas de la pile), au plus `max` jetons dessinés. */
export function chipList(amount, max = 8) {
  const out = [];
  let rest = Math.max(0, Math.floor(amount));
  for (const d of DENOMS) {
    while (rest >= d) {
      out.push(d);
      rest -= d;
    }
  }
  return out.length > max ? out.slice(0, max) : out;
}

/** Valeur d'une carte (As = 1) et d'une main, comme le serveur (pour les animations pas à pas). */
const cardValue = (c) => (c.rank === 1 ? 1 : Math.min(10, c.rank));
export function handText(cards) {
  let low = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.hidden) continue;
    low += cardValue(c);
    if (c.rank === 1) aces++;
  }
  const soft = aces > 0 && low + 10 <= 21;
  const total = soft ? low + 10 : low;
  return soft && total < 21 ? `${low} / ${total}` : String(total);
}

/** Journal du moteur : rien à convertir sinon les accolades (réservées aux glyphes Tapis). */
export const richLog = (text) => String(text).replace(/[{}]/g, '');
