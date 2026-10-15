/* =====================================================================
 * Règles illustrées de la Belote, en fenêtre Tapis (T.Dialog à onglets).
 * Reprend toutes les règles appliquées par le moteur (games/belote/server/Belote.js).
 * ===================================================================== */

const card = (suit, rank, extra = {}) => ({ suit, rank, ...extra });

export function rulesDialog(T, { tab = 'cartes', target = 1001, announces = true } = {}) {
  const cards = (list, size = 'sm') => `<div class="tp-rules__cards">${list.map((c) => T.Card({ size, ...c })).join('')}</div>`;
  const p = (...lines) => lines.map((l) => `<p class="body">${T.rich(l)}</p>`).join('');
  const h = (title) => `<h3 class="title-sm blt-rules__h">${T.rich(title)}</h3>`;
  const grid = (text, side) => `<div class="tp-rules__g"><div>${text}</div>${side ? `<div>${side}</div>` : ''}</div>`;
  const table = (head, rows) => `<table class="tp-ss blt-rt"><thead><tr>${head.map((x) => `<th scope="col">${T.rich(x)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((x, i) => (i ? `<td>${T.rich(x)}</td>` : `<th scope="row">${T.rich(x)}</th>`)).join('')}</tr>`).join('')}</tbody></table>`;
  const boxes = (list) => `<div class="blt-rules__boxes">${list.map(([title, text, side]) =>
    `<article class="blt-rules__box"><b class="body-strong">${T.rich(title)}</b>${side ?? ''}<span class="caption">${T.rich(text)}</span></article>`).join('')}</div>`;

  const tabs = [
    {
      id: 'cartes',
      label: 'Cartes',
      body: grid(
        p('32 cartes : du 7 à l’As dans les quatre couleurs. Quatre joueurs en deux équipes : ton partenaire est assis en face de toi (joueurs 1 et 3 contre 2 et 4).',
          'Une couleur est l’atout : ses cartes battent toutes les autres, et son Valet et son 9 deviennent les plus fortes.'),
        cards([card('coeur', 'V'), card('coeur', 9), card('pique', 'A')]),
      ) + h('Ordre et valeur des cartes')
        + table(['', 'V', '9', 'A', '10', 'R', 'D', '8', '7'], [['À l’atout', '20', '14', '11', '10', '4', '3', '0', '0']])
        + table(['', 'A', '10', 'R', 'D', 'V', '9', '8', '7'], [['Hors atout', '11', '10', '4', '3', '2', '0', '0', '0']])
        + p('Le dernier pli vaut 10 points de plus (« dix de der ») : 162 points en tout dans une donne.'),
    },
    {
      id: 'encheres',
      label: 'Enchères',
      body: p('Le donneur change à chaque donne. Le paquet n’est battu qu’une fois, au début de la partie : ensuite on ramasse les plis et le joueur avant le donneur coupe, comme à la vraie table.')
        + grid(p('Il distribue 3 cartes puis 2 à chacun, en commençant par le joueur qui le suit, puis retourne la carte suivante au milieu.'),
          cards([card('carreau', 'V'), card('carreau', 9)]))
        + boxes([
          ['Premier tour', 'Chacun à son tour prend la couleur retournée comme atout, ou passe.'],
          ['Second tour', 'Si personne n’a pris : chacun peut choisir une autre couleur, ou passer.'],
          ['Tout le monde passe', 'Deux fois : on ramasse, le joueur suivant coupe et distribue.'],
        ])
        + p('Le preneur reçoit la carte retournée et 2 cartes, les autres 3 : tout le monde a 8 cartes. L’équipe du preneur doit alors faire plus de points que l’autre.'),
    },
    {
      id: 'jeu',
      label: 'Jeu',
      body: p('Le joueur qui suit le donneur entame le premier pli ; le gagnant d’un pli entame le suivant.')
        + boxes([
          ['1. Fournir', 'Joue la couleur demandée si tu en as.'],
          ['2. Couper', 'Sinon, joue atout… sauf si ton partenaire est maître du pli : tu joues alors ce que tu veux.'],
          ['3. Monter', 'Si un atout est déjà posé, surcoupe si tu le peux. Sinon défausse-toi : on ne sous-coupe que si l’on n’a plus que de l’atout.'],
          ['4. À l’atout', 'Quand l’atout est demandé, monte toujours si tu le peux, même sur ton partenaire.'],
        ])
        + p('Le pli va au plus fort atout, sinon à la plus forte carte de la couleur demandée.', 'Pendant ton tour, les cartes interdites sont estompées : survole-les pour savoir pourquoi.'),
    },
    {
      id: 'annonces',
      label: 'Annonces',
      body: grid(p('Belote et rebelote : le Roi et la Dame d’atout dans la même main valent 20 points. « Belote ! » est dit quand tu joues le premier, « Rebelote ! » avec le second ; ici c’est automatique.',
        'Ces 20 points restent toujours à l’équipe qui les a, même dedans.'), cards([card('trefle', 'R'), card('trefle', 'D')]))
        + (announces
          ? h('Annonces pendant le premier pli')
            + table(['Annonce', 'Points'], [
              ['Tierce (3 cartes qui se suivent dans une couleur)', '20'],
              ['Cinquante (4 cartes)', '50'],
              ['Cent (5 cartes ou plus)', '100'],
              ['Carré de Valets', '200'],
              ['Carré de 9', '150'],
              ['Carré d’As, de 10, de Rois ou de Dames', '100'],
            ])
            + p('L’ordre naturel compte pour les séquences : 7 8 9 10 V D R A. Annonce avant de jouer ta première carte (tout ou rien) ; les autres n’entendent que le genre (« Tierce »).',
              'Au deuxième pli, seule l’équipe qui a la meilleure annonce marque toutes les siennes, et ses cartes sont montrées. Meilleure : la plus forte en points, un carré avant une séquence, puis la plus haute carte, puis la séquence à l’atout, puis le premier à parler.')
          : p('Les annonces (tierce, cinquante, cent, carrés) ne sont pas jouées dans cette partie : seule la belote compte.')),
    },
    {
      id: 'decompte',
      label: 'Décompte',
      body: boxes([
        ['Contrat réussi', 'L’équipe du preneur fait plus de points que l’autre (annonces et belote comprises) : chacune marque ses points.'],
        ['Dedans', 'Sinon, la défense marque 162 et toutes les annonces ; le preneur ne garde que sa belote.'],
        ['Litige', 'À égalité, la défense marque ses points ; ceux du preneur attendent et vont à l’équipe qui gagne la donne suivante.'],
        ['Capot', 'Une équipe qui fait les 8 plis marque 252 au lieu de 162.'],
      ])
        + p(`On compte les points réels, sans arrondi. La partie se joue en ${target} points : elle s’arrête à la fin de la donne où une équipe les atteint, et le plus haut total gagne. À égalité, on joue une donne de plus.`,
          'Les points en litige encore en attente à la fin de la partie sont perdus.'),
    },
  ];
  return T.Dialog({ id: 'regles', kicker: 'Belote', title: 'Règles', size: 'lg', tabs, tab });
}
