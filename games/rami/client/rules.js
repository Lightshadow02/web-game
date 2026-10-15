import { jk } from './cards.js';

/* =====================================================================
 * Règles illustrées du Rami, en fenêtre Tapis (T.Dialog à onglets).
 * Reprend exactement les règles appliquées par le moteur (games/rami/server/Rami.js).
 * ===================================================================== */

const card = (suit, rank, extra = {}) => ({ suit, rank, ...extra });
const joker = () => ({ suit: 'excuse' });

export function rulesDialog(T, { tab = 'but', opening = 51 } = {}) {
  const cards = (list, size = 'sm') => `<div class="tp-rules__cards rm-rules__cards">${list.map((c) => T.Card({ size, ...c })).join('')}</div>`;
  const p = (...lines) => lines.map((l) => `<p class="body">${T.rich(l)}</p>`).join('');
  const h = (title) => `<h3 class="title-sm rm-rules__h">${T.rich(title)}</h3>`;
  const grid = (text, side) => `<div class="tp-rules__g"><div>${text}</div>${side ? `<div>${side}</div>` : ''}</div>`;
  const table = (head, rows) => `<table class="tp-ss rm-rt"><thead><tr>${head.map((x) => `<th scope="col">${T.rich(x)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((x, i) => (i ? `<td>${T.rich(x)}</td>` : `<th scope="row">${T.rich(x)}</th>`)).join('')}</tr>`).join('')}</tbody></table>`;
  const boxes = (list) => `<div class="rm-rules__boxes">${list.map(([title, text, side]) =>
    `<article class="rm-rules__box"><b class="body-strong">${T.rich(title)}</b>${side ?? ''}<span class="caption">${T.rich(text)}</span></article>`).join('')}</div>`;

  const tabs = [
    {
      id: 'but',
      label: 'But',
      body: grid(
        p('Débarrasse-toi de toutes tes cartes en les posant sur la table en combinaisons. Les autres comptent alors les cartes qui leur restent : ce sont des pénalités.',
          'Deux jeux de 52 cartes et 4 Jokers (108 cartes), de 2 à 6 joueurs. Chacun reçoit 13 cartes ; une carte est retournée pour commencer la défausse. Le joueur à gauche du donneur commence, puis on joue chacun son tour.',
          'Après le nombre de donnes choisi (3, 5 ou 7), le plus petit total de pénalités gagne.'),
        cards([card('coeur', 7), card('coeur', 8), card('coeur', 9), joker()]),
      ),
    },
    {
      id: 'tour',
      label: 'Ton tour',
      body: boxes([
        ['1. Piocher', 'La carte du dessus du talon, ou celle de la défausse. Une carte prise à la défausse doit être posée dans le même tour (et faire partie de ton ouverture si tu n’as pas encore ouvert) ; sinon, repose-la et pioche au talon.'],
        ['2. Poser', 'Des combinaisons de ta main. La première fois, c’est l’ouverture : au moins ' + opening + ' points en une fois.'],
        ['3. Compléter', 'Une fois ouvert (dès ce tour-là), ajoute tes cartes aux combinaisons de la table, les tiennes comme celles des autres.'],
        ['4. Défausser', 'Une carte sur la défausse : ton tour s’arrête là.'],
      ])
        + h('Échanger le Joker')
        + grid(p('Une fois ouvert, tu peux prendre un Joker posé sur la table en donnant la vraie carte qu’il remplace. Le Joker revient dans ta main et doit être reposé dans le même tour (nouvelle combinaison ou ajout).',
          'Dans un brelan, la carte donnée doit être d’une couleur qui manque.'),
        cards([card('pique', 5), joker(), card('pique', 7)]))
        + p('À l’écran : choisis tes cartes dans ta main, puis « Poser ». Pour compléter ou échanger, touche une combinaison de la table, puis tes cartes. Avant l’ouverture, « Préparer » met une combinaison de côté pour l’ajouter aux autres.'),
    },
    {
      id: 'combinaisons',
      label: 'Combinaisons',
      body: h('Brelan et carré')
        + grid(p('3 ou 4 cartes de même rang, toutes de couleurs différentes.'), cards([card('pique', 'D'), card('coeur', 'D'), card('trefle', 'D')]))
        + h('Suite')
        + grid(p('3 cartes ou plus qui se suivent dans la même couleur.',
          'L’As se place en bas (As-2-3) ou en haut (Dame-Roi-As), jamais au milieu : pas de Roi-As-2.'),
        cards([card('carreau', 'D'), card('carreau', 'R'), card('carreau', 'A')]))
        + h('Le Joker')
        + grid(p('Il remplace n’importe quelle carte, un seul par combinaison. En bout de suite, il se place en haut si possible.',
          'Sur la table, une petite étiquette dit quelle carte il remplace.'),
        cards([card('trefle', 4), card('trefle', 5), joker()])),
    },
    {
      id: 'points',
      label: 'Points',
      body: h('Ouverture')
        + table(['Carte', 'Valeur'], [
          ['2 à 10', 'Leur chiffre'],
          ['Valet, Dame, Roi', '10'],
          ['As', '1 dans As-2-3, 11 sinon'],
          ['Joker', 'La valeur de la carte qu’il remplace'],
        ])
        + p(`Ta première pose doit valoir au moins ${opening} points en une seule fois, avec tes propres combinaisons (option du salon : 51 ou 30).`)
        + h('Fin de donne')
        + boxes([
          ['Sortir', 'Le premier qui n’a plus de cartes gagne la donne : en défaussant sa dernière carte, ou en posant tout.'],
          ['Rami', 'Ouvrir et sortir dans le même tour (en posant tout ou en défaussant la dernière carte) : les pénalités des autres sont doublées.'],
          ['Pénalités', 'Chacun compte sa main : Joker 20, As 11, figures 10, les autres leur chiffre.'],
        ])
        + p('Talon vide : la défausse, sauf sa carte du dessus, est mélangée pour refaire un talon. S’il n’y a plus rien à piocher, la donne s’arrête et chacun compte sa main.'),
    },
  ];
  return jk(T.Dialog({ id: 'regles', kicker: 'Rami', title: 'Règles', size: 'lg', tabs, tab }));
}
