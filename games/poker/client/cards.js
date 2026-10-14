/* =====================================================================
 * Poker : conversions moteur -> design system « Tapis » et petits textes.
 * Cartes du moteur : { id: 'AS' | 'TD' | '7H', rank: 2..14, suit: S|H|D|C }.
 * Les cartes Tapis gardent l'id du moteur (data-card-id) : main, tableau, abattage
 * et animations parlent la même langue.
 * ===================================================================== */

export const SUIT = { S: 'pique', H: 'coeur', D: 'carreau', C: 'trefle' };
const FIG = { 11: 'V', 12: 'D', 13: 'R', 14: 'A' };

/** Carte du moteur -> props Tapis.Card (Valet V, Dame D, Roi R, As A). */
export const tp = (c, extra = {}) => ({ id: c.id, suit: SUIT[c.suit], rank: FIG[c.rank] ?? c.rank, ...extra });

/** 1500 -> « 1 500 » (espace fine insécable). */
export const fmt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
export function signed(n) {
  if (n > 0) return `+${fmt(n)}`;
  if (n < 0) return `−${fmt(-n)}`;
  return '±0';
}

/** Dernière action affichée sur un siège. */
export function actionText(a) {
  if (!a) return '';
  switch (a.type) {
    case 'fold': return 'Couché';
    case 'check': return 'Parole';
    case 'call': return `Suit ${fmt(a.amount)}`;
    case 'bet': return `Mise ${fmt(a.amount)}`;
    case 'raise': return `Relance à ${fmt(a.amount)}`;
    case 'allin': return 'Tapis';
    case 'sb': return 'Petite blinde';
    case 'bb': return 'Grosse blinde';
    default: return '';
  }
}

/** Bulle d'annonce pour un événement d'action. */
export function bubbleText(e) {
  if (e.action === 'fold') return { text: 'Couché', tone: 'pass' };
  if (e.action === 'check') return { text: 'Parole', tone: 'pass' };
  if (e.allIn) return { text: 'Tapis' };
  if (e.action === 'call') return { text: `Suit ${fmt(e.amount)}` };
  if (e.action === 'bet') return { text: `Mise ${fmt(e.amount)}` };
  return { text: `Relance à ${fmt(e.amount)}` };
}

/** Jetons : valeurs et nombre de pastilles pour dessiner une pile (du bas vers le haut). */
export const DENOMS = [5000, 1000, 500, 100, 25, 5, 1];
export function chipList(amount, max = 8) {
  const out = [];
  let rest = Math.max(0, Math.round(amount));
  for (const d of DENOMS) {
    while (rest >= d && out.length < 40) {
      out.push(d);
      rest -= d;
    }
  }
  // une pile d'un ou deux jetons paraît maigre : on fait la monnaie du plus gros (3 jetons au moins)
  for (let guard = 0; out.length < 3 && guard < 6; guard++) {
    const i = out.findIndex((d) => d > 1);
    if (i < 0) break;
    const lower = DENOMS[DENOMS.indexOf(out[i]) + 1];
    const k = Math.floor(out[i] / lower);
    const change = [...Array(k).fill(lower), ...chipList(out[i] - k * lower, 99)];
    if (out.length - 1 + change.length > max) break;
    out.splice(i, 1, ...change);
    out.sort((a, b) => b - a);
  }
  if (out.length <= max) return out;
  // trop de jetons : on garde la proportion des couleurs, du plus gros au plus petit
  const step = out.length / max;
  return Array.from({ length: max }, (_, i) => out[Math.floor(i * step)]);
}
/** Jusqu'à 3 colonnes de couleurs pour un gros pot. */
export function chipColumns(amount, perColumn = 7, maxColumns = 3) {
  const list = chipList(amount, 60);
  const cols = [];
  for (const d of list) {
    let col = cols.find((c) => c[0] === d && c.length < perColumn);
    if (!col) {
      if (cols.length >= maxColumns) {
        col = cols.reduce((a, b) => (a.length <= b.length ? a : b));
        if (col.length >= perColumn) continue;
      } else {
        col = [];
        cols.push(col);
      }
    }
    col.push(d);
  }
  return cols;
}

/** Les glyphes ♠ ♥ ♦ ♣ du journal du moteur deviennent les glyphes du système. */
export function richLog(text) {
  return String(text)
    .replace(/[{}]/g, '')
    .replace(/♠︎?/g, '{pique}').replace(/♥︎?/g, '{coeur}')
    .replace(/♦︎?/g, '{carreau}').replace(/♣︎?/g, '{trefle}');
}

export const STREET_LABEL = { preflop: 'Préflop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Abattage' };
