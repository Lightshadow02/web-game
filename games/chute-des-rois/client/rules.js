import { jk, DIFFICULTY } from './view.js';

/* =====================================================================
 * Règles illustrées de « La Chute des Rois » : une fenêtre Tapis à 5 onglets.
 * Textes statiques (aucune donnée de joueur) ; **gras** et {pique}… passent par Tapis.rich.
 * info : { difficulty, jokerCount, solo } de la partie affichée (onglet « Le Joker »).
 * ===================================================================== */

export const RULES_TABS = ['base', 'pouvoirs', 'combos', 'joker', 'astuces'];
const JOKERS = { facile: 2, normal: 1, classique: 0 };

export function rulesDialog(T, tab = 'base', info = {}) {
  const md = (t) => T.rich(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const p = (t, cls = 'body') => `<p class="${cls}">${md(t)}</p>`;
  const cards = (list) => `<div class="cdr-r__cards">${jk(list.map((c) => T.Card({ ...c, size: 'sm' })).join(''))}</div>`;
  const head = (icon, title) => `<h3 class="cdr-r__h title-sm">${T.icon(icon)}<span>${md(title)}</span></h3>`;
  const example = (list, result) => `<div class="cdr-r__ex">${cards(list)}<span class="caption">${md(result)}</span></div>`;
  const c = (rank, suit) => ({ rank, suit });
  const joker = { suit: 'excuse', id: 'JK' };
  const level = DIFFICULTY[info.difficulty] ? info.difficulty : null;
  const jokers = level ? JOKERS[level] : null;

  const base = `
    <section class="cdr-r__lead">
      ${head('crown', 'Le but')}
      ${p('La partie est coopérative : toute la table forme **une seule équipe** (toi seul, en solo). Ensemble, renversez les **12 souverains** du Château : 4 Valets, puis 4 Dames, puis 4 Rois.')}
      ${p('Si un joueur ne peut plus encaisser une riposte, toute l’équipe perd.', 'body cdr-r__warn')}
    </section>
    <ul class="cdr-r__bosses">${[[c('V', 'pique'), 'Valet', 20, 10], [c('D', 'coeur'), 'Dame', 30, 15], [c('R', 'trefle'), 'Roi', 40, 20]].map(([card, name, hp, atk]) => `
      <li class="cdr-r__boss">${T.Card({ ...card, size: 'sm' })}<span><b class="title-sm">${name}</b><span class="caption">${hp} PV · attaque ${atk}</span></span></li>`).join('')}
    </ul>
    ${head('sword', 'Un tour de jeu')}
    <ol class="cdr-r__steps">${[
      ['Joue', 'Pose une carte ou un combo : sa valeur est ton attaque. Tu peux aussi passer.'],
      ['Pouvoir', 'La couleur jouée déclenche son effet : soin, pioche, dégâts doublés ou bouclier.'],
      ['Dégâts', 'Le boss perd autant de PV. À 0, il tombe et tu rejoues aussitôt contre le suivant.'],
      ['Riposte', 'Sinon il frappe : défausse des cartes dont le total couvre son attaque.'],
    ].map(([t, txt], i) => `<li class="cdr-r__step"><span class="cdr-r__num stat">${i + 1}</span><span><b class="body-strong">${t}</b>${p(txt)}</span></li>`).join('')}</ol>`;

  const powers = [
    ['coeur', 'heal', 'Soin', 'Mélange la défausse et remet N cartes sous la Taverne : ta réserve de cartes ne s’épuise pas.', [c(7, 'coeur')], '7 cartes de la défausse retournent dans la Taverne.'],
    ['carreau', 'draw', 'Pioche', 'L’équipe pioche N cartes, une chacun à tour de rôle en commençant par toi. Une main pleine est sautée.', [c(4, 'carreau')], '4 cartes sont distribuées autour de la table.'],
    ['trefle', 'double', 'Double', 'Les dégâts infligés au boss sont doublés.', [c(8, 'trefle')], '16 dégâts au lieu de 8.'],
    ['pique', 'shield', 'Bouclier', 'L’attaque du boss baisse de N jusqu’à sa chute. Les boucliers s’additionnent.', [c(6, 'pique')], 'La riposte du boss perd 6 points pour tout le combat.'],
  ];
  const pouvoirs = `
    ${p('N = la valeur de la carte jouée. Le pouvoir s’applique en plus des dégâts.', 'body cdr-r__intro')}
    <div class="cdr-r__grid">${powers.map(([suit, icon, name, text, ex, res]) => `
      <article class="cdr-r__card" data-suit="${suit}">
        <header class="cdr-r__ch"><span class="cdr-r__g">${T.icon(suit, { className: `tp-suit-${suit}` })}</span><span><b class="title-sm">${name}</b><span class="caption">${T.icon(icon)} ${T.suitName(suit)}</span></span></header>
        ${p(text)}${example(ex, `→ ${res}`)}
      </article>`).join('')}
    </div>
    <section class="cdr-r__note">
      ${head('immune', 'L’immunité')}
      ${p('Chaque boss ignore le pouvoir de **sa propre couleur**. Les dégâts, eux, comptent toujours.')}
      <div class="cdr-r__ex">${cards([c('D', 'coeur')])}<span class="caption cdr-r__vs">contre</span>${cards([c(7, 'coeur')])}<span class="caption">${md('→ 7 dégâts, mais aucun soin.')}</span></div>
    </section>`;

  const combos = `
    ${head('deck', 'Valeur des cartes')}
    <ul class="cdr-r__values">${[[c('A', 'coeur'), 1], [c(5, 'pique'), 5], [c(10, 'carreau'), 10], [c('V', 'trefle'), 10], [c('D', 'coeur'), 15], [c('R', 'pique'), 20], ...(jokers === 0 ? [] : [[joker, 0]])]
      .map(([card, v]) => `<li>${jk(T.Card({ ...card, size: 'sm' }))}<b class="stat">${v}</b></li>`).join('')}</ul>
    ${p('Les Valets, Dames et Rois n’arrivent dans ta main que si l’équipe les a recrutés (voir Astuces).', 'body cdr-r__intro')}
    ${head('bolt', 'Combos autorisés')}
    <div class="cdr-r__grid">
      <article class="cdr-r__card"><b class="title-sm">L’As compagnon</b>
        ${p('Un As accompagne n’importe quelle carte. Les deux pouvoirs s’appliquent sur le total.')}
        ${example([c('A', 'coeur'), c(7, 'trefle')], '→ Attaque 8 : 8 cartes soignées, et 16 dégâts grâce au {trefle}.')}</article>
      <article class="cdr-r__card"><b class="title-sm">Les cartes jumelles</b>
        ${p('Plusieurs cartes de même valeur, si leur total ne dépasse pas 10.')}
        ${example([c(3, 'pique'), c(3, 'carreau'), c(3, 'trefle')], '→ Attaque 9 : bouclier 9, 9 cartes piochées, 18 dégâts.')}</article>
    </div>
    ${p(`Interdit : 6 + 6 (total 12), ou 2 + 5 (valeurs différentes, sans As).${jokers === 0 ? '' : ' Le Joker se joue toujours seul.'}`, 'body cdr-r__warn')}`;

  const levels = [['facile', 'Facile', '2 Jokers'], ['normal', 'Normal', '1 Joker'], ['classique', 'Classique', 'sans Joker']];
  const thisGame = !level ? 'L’hôte choisit la difficulté dans le salon, avant de lancer la partie.'
    : jokers ? `Cette partie : **${DIFFICULTY[level]}**, ${jokers === 1 ? '1 Joker mélangé' : `${jokers} Jokers mélangés`} dans la Taverne au départ.`
      : `Cette partie se joue en **Classique** : aucun Joker dans la Taverne. L’hôte choisit la difficulté dans le salon.`;
  const choice = info.solo ? 'En solo, pas de choix : tu rejoues aussitôt.'
    : 'Toutes les mains sont **révélées à toute la table**. Celui qui a joué le Joker choisit qui joue ensuite, lui compris. Puis les mains redeviennent secrètes.';
  const jokerTab = `
    <section class="cdr-r__lead">
      ${head('star', 'Le Joker')}
      <div class="cdr-r__ex">${cards([joker])}<span>${p('Le Joker vaut **0** et se joue **seul** : jamais en combo, jamais avec un As. Il n’inflige aucun dégât, mais il change le combat.')}</span></div>
    </section>
    <ol class="cdr-r__steps">${[
      ['Immunité levée', 'Le boss perd son immunité jusqu’à sa chute : les cartes jouées ensuite déclenchent aussi le pouvoir de sa couleur. Celles déjà posées ne gagnent rien.'],
      ['Pas de riposte', 'Le boss ne frappe pas ce tour-ci.'],
      ['Qui joue ?', choice],
      ['Boss suivant', 'Il arrive de nouveau immunisé.'],
    ].map(([t, txt], i) => `<li class="cdr-r__step"><span class="cdr-r__num stat">${i + 1}</span><span><b class="body-strong">${t}</b>${p(txt)}</span></li>`).join('')}</ol>
    <section class="cdr-r__note">
      ${head('heal', 'Exemple')}
      <div class="cdr-r__ex">${cards([c('V', 'coeur')])}<span class="caption cdr-r__vs">contre</span>${cards([joker, c(7, 'coeur')])}<span class="caption">${md('→ Après le Joker, le 7 {coeur} soigne bien 7 cartes.')}</span></div>
    </section>
    ${p('Pour encaisser une riposte, le Joker compte 0. Il part à la défausse comme les autres cartes, peut revenir par le Soin {coeur} et compte dans la taille de ta main.')}
    <section class="cdr-r__note">
      ${head('user', 'Difficulté')}
      ${p(thisGame)}
      <ul class="cdr-r__levels">${levels.map(([id, name, n]) => `<li${id === level ? ' data-current=""' : ''}><b class="body-strong">${name}</b><span class="caption">${n}</span></li>`).join('')}</ul>
    </section>`;

  const tips = [
    ['crown', 'Victoire « pile »', 'Si le boss tombe à exactement 0 PV, il rejoint ton camp : il est posé sur la Taverne et vaudra 10, 15 ou 20 en main.'],
    ['pass', 'Passer ton tour', 'Tu peux passer sans jouer, mais tu subis quand même la riposte. Impossible si tous les autres viennent de passer.'],
    ['shield', 'Encaisser malin', 'Pour la riposte, toutes les cartes comptent pour leur valeur. Garde tes {pique} et {trefle} pour attaquer, défausse le reste.'],
    ['heal', 'Le soin d’abord', 'Dans un combo {coeur} + {carreau}, le soin passe avant la pioche : tu pioches dans une réserve remplie.'],
    ['user', 'Taille de main', '1 joueur : 8 cartes · 2 joueurs : 7 · 3 joueurs : 6 · 4 joueurs : 5.'],
    ['renew', 'En solo', 'Deux Renouveaux : défausse toute ta main et repioche une main complète, à tout moment de ton tour.'],
  ];
  const astuces = `<div class="cdr-r__tips">${tips.map(([icon, title, text]) => `
    <article class="cdr-r__tip"><span class="cdr-r__ti">${T.icon(icon)}</span><span><b class="body-strong">${md(title)}</b>${p(text)}</span></article>`).join('')}</div>`;

  const tabs = [
    { id: 'base', label: 'L’essentiel', body: `<div class="cdr-r">${base}</div>` },
    { id: 'pouvoirs', label: 'Pouvoirs', body: `<div class="cdr-r">${pouvoirs}</div>` },
    { id: 'combos', label: 'Combos et valeurs', body: `<div class="cdr-r">${combos}</div>` },
    { id: 'joker', label: 'Le Joker', body: `<div class="cdr-r">${jokerTab}</div>` },
    { id: 'astuces', label: 'Astuces', body: `<div class="cdr-r">${astuces}</div>` },
  ];
  return T.Dialog({
    id: 'regles', kicker: 'La Chute des Rois', title: 'Règles', size: 'lg', tabs, tab: RULES_TABS.includes(tab) ? tab : 'base',
    actions: T.Button({ variant: 'primary', icon: 'check', label: 'C’est parti', attrs: { 'data-close': 'regles' } }),
  });
}
