/* =====================================================================
 * Règles illustrées du Président, en fenêtre Tapis (T.Dialog à onglets).
 * Elles reprennent exactement ce que le moteur applique
 * (games/president/server/President.js), options de la table comprises.
 * ===================================================================== */

const C = (spec) => spec.split(' ').map((x) => {
  const suit = { s: 'pique', h: 'coeur', d: 'carreau', c: 'trefle' }[x.slice(-1)];
  const r = x.slice(0, -1);
  return { suit, rank: /^\d+$/.test(r) ? Number(r) : r };
});

export function rulesDialog(T, { tab = 'but', options = { twoCloses: true, revolution: false }, players = 4, rounds = 8 } = {}) {
  const cards = (spec, size = 'sm') => `<div class="tp-rules__cards pr-rules__cards">${C(spec).map((c) => T.Card({ size, ...c })).join('')}</div>`;
  const p = (...lines) => lines.map((l) => `<p class="body">${T.rich(l)}</p>`).join('');
  const h = (title) => `<h3 class="title-sm pr-rules__h">${T.rich(title)}</h3>`;
  const grid = (text, side) => `<div class="tp-rules__g"><div>${text}</div>${side ? `<div>${side}</div>` : ''}</div>`;
  const boxes = (list) => `<div class="pr-rules__boxes">${list.map(([title, text, side]) =>
    `<article class="pr-rules__box"><b class="body-strong">${T.rich(title)}</b>${side ?? ''}<span class="caption">${T.rich(text)}</span></article>`).join('')}</div>`;
  const table = (head, rows) => `<table class="tp-ss pr-rules__t"><thead><tr>${head.map((x) => `<th scope="col">${T.rich(x)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((x, i) => (i ? `<td>${T.rich(x)}</td>` : `<th scope="row">${T.rich(x)}</th>`)).join('')}</tr>`).join('')}</tbody></table>`;
  const here = `À cette table : ${players} joueurs, ${rounds} manches, ${options.twoCloses ? 'le 2 ferme le pli' : 'le 2 est la plus forte carte'}, ${options.revolution ? 'avec révolution' : 'sans révolution'}.`;

  const tabs = [
    {
      id: 'but',
      label: 'But',
      body: grid(
        p('Débarrasse-toi de toutes tes cartes avant les autres. Le premier à finir devient Président, le dernier Trouduc.',
          'Un jeu de 52 cartes est entièrement distribué, une carte à la fois. Si le compte ne tombe pas juste, les premiers servis ont une carte de plus : le donneur (l’hôte à la première manche, ensuite le Trouduc) sert d’abord le joueur suivant et se sert en dernier.'),
        cards('3c 7h Dd As 2s'),
      )
        + h('L’ordre des cartes')
        + p('Du plus faible au plus fort : 3, 4, 5, 6, 7, 8, 9, 10, Valet, Dame, Roi, As, puis le 2. Les couleurs ne comptent pas.')
        + cards('3d 4c 5h 6s 7d 8c 9h 10s Vd Dc Rh Ac 2s', 'xs')
        + p(here),
    },
    {
      id: 'jeu',
      label: 'Jouer',
      body: boxes([
        ['1. Entamer', 'Pose 1, 2, 3 ou 4 cartes de même valeur : une carte, une paire, un brelan ou un carré.', cards('9h 9s')],
        ['2. Suivre', 'Chacun à son tour pose autant de cartes, d’une valeur strictement plus forte (une valeur égale ne suffit pas)…', cards('Vd Vc')],
        ['3. Ou passer', '…ou passe. Passer ne t’exclut pas du pli : si ton tour revient, tu peux encore jouer.'],
        ['4. Le pli', 'Quand tous les autres ont passé à la suite, le dernier à avoir joué remporte le pli, le met de côté et entame.'],
      ])
        + p('Une combinaison que plus rien ne peut battre (des 2, ou des 3 pendant une révolution) ferme aussitôt le pli : son joueur entame le suivant.',
          'Au premier tour, celui qui a le 3 de {trefle} entame (sans obligation de le jouer). Ensuite, le Trouduc entame.',
          'Celui qui pose sa dernière carte prend la place suivante ; s’il a remporté le pli, son voisin encore en jeu entame. La manche finit quand il ne reste qu’un joueur : il est Trouduc.',
          'Pendant ton tour, les cartes que tu ne peux pas jouer sont estompées : survole-les pour savoir pourquoi.'),
    },
    {
      id: 'manche',
      label: 'Titres',
      body: table(['Place', 'Titre', 'Points'], [
        ['1er', 'Président', '4'],
        ['2e', 'Vice-président (dès 4 joueurs)', '3'],
        ['Au milieu', 'Neutre', '2'],
        ['Avant-dernier', 'Vice-trouduc (dès 4 joueurs)', '1'],
        ['Dernier', 'Trouduc', '0'],
      ])
        + p('À 3 joueurs : Président, Neutre et Trouduc.')
        + h('L’échange, au début de chaque manche suivante')
        + boxes([
          ['Le Trouduc', 'donne ses 2 meilleures cartes au Président, sans choisir : elles partent toutes seules.', cards('2c Ah')],
          ['Le Président', 'lui rend 2 cartes de son choix (souvent ses plus faibles).', cards('3s 4d')],
          ['Le Vice-trouduc', 'donne sa meilleure carte au Vice-président, qui lui en rend 1 de son choix.'],
        ])
        + p('Seuls les deux joueurs d’un échange voient les cartes échangées. Le plus gros total après la dernière manche gagne ; à égalité, tous les premiers gagnent.'),
    },
    {
      id: 'options',
      label: 'Options',
      body: boxes([
        ['Le 2 ferme le pli', 'Un 2 se pose sur n’importe quelle combinaison, avec autant de 2 que de cartes (deux 2 sur une paire). Le pli se ferme aussitôt et son joueur rejoue, même pendant une révolution.', cards('2h')],
        ['Le 2, plus forte carte', 'Le 2 est seulement la plus forte valeur. Pendant une révolution, il devient la plus faible.'],
        ['Révolution', 'Poser un carré inverse l’ordre jusqu’à la fin de la manche : il faut alors jouer plus bas, et le 3 devient la plus forte. Un autre carré rétablit l’ordre.', cards('7s 7h 7d 7c', 'xs')],
      ])
        + p(here),
    },
  ];
  return T.Dialog({ id: 'regles', kicker: 'Président', title: 'Règles', size: 'lg', tabs, tab });
}
