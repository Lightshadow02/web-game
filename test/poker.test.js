'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Poker, blindsAt } = require('../games/poker/server/Poker');
const { evaluate, compareHands, kickerNote } = require('../games/poker/server/evaluator');
const { parseCard, buildDeck, shuffle } = require('../games/poker/server/cards');
const manifest = require('../games/poker/server/index');

// ---------------------------------------------------------------- utilitaires

const H = (s) => s.trim().split(/\s+/).map(parseCard);
const ev = (s) => evaluate(H(s));
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `J${i}` }));

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Partie de test : cartes imposées par main ({ [main]: { hands, board } }), tapis au choix. */
function newGame(n, { stacks, rigs = {}, options = {}, seed = 1 } = {}) {
  return new Poker({ players: players(n), stacks, options, rng: seeded(seed), rig: (hand) => rigs[hand] ?? null });
}
const cur = (g) => g.players[g.currentIndex]?.id ?? null;
const act = (g, type, amount) => g.handleAction(cur(g), type, amount == null ? {} : { amount });
const chips = (g) => Object.fromEntries(g.players.map((p) => [p.id, p.chips]));
const totalChips = (g) => g.players.reduce((s, p) => s + p.chips + (p.inHand && g.phase === 'betting' ? p.total : 0), 0);
const eventsOf = (g, type) => g.events.filter((e) => e.type === type);
/** Tout le monde suit ou dit parole jusqu'à la fin de la main. */
function checkDown(g) {
  let guard = 0;
  while (g.phase === 'betting') {
    if (++guard > 100) throw new Error('boucle');
    const s = g.getStateFor(cur(g));
    act(g, s.me.canCheck ? 'check' : 'call');
  }
}

// ================================================================ évaluateur

test('évaluateur : chaque combinaison, avec son nom et sa description', () => {
  const cases = [
    ['AS KD 9H 7C 4S 3D 2C', 0, 'Carte haute', 'Hauteur As'],
    ['KS KD 9H 7C 4S 3D 2C', 1, 'Paire', 'Paire de Rois'],
    ['AS AD 9H 7C 4S 3D 2C', 1, 'Paire', 'Paire d’As'],
    ['8S 8D AH 7C 4S 3D 2C', 1, 'Paire', 'Paire de 8'],
    ['KS KD 8H 8C 4S 3D 2C', 2, 'Double paire', 'Double paire, Rois et 8'],
    ['QS QD QH 7C 4S 3D 2C', 3, 'Brelan', 'Brelan de Dames'],
    ['9S TD JH QC KS 3D 2C', 4, 'Quinte', 'Quinte au Roi'],
    ['TS JD QH KC AS 3D 2C', 4, 'Quinte', 'Quinte à l’As'],
    ['AS 2D 3H 4C 5S 9D KC', 4, 'Quinte', 'Quinte au 5'],
    ['AH 9H 7H 4H 2H KS QD', 5, 'Couleur', 'Couleur à l’As'],
    ['QH 9H 7H 4H 2H KS 3D', 5, 'Couleur', 'Couleur à la Dame'],
    ['QS QD QH 8C 8S 3D 2C', 6, 'Full', 'Full aux Dames par les 8'],
    ['AS AD AH KC KS 3D 2C', 6, 'Full', 'Full aux As par les Rois'],
    ['7S 7D 7H 7C KS 3D 2C', 7, 'Carré', 'Carré de 7'],
    ['AS AD AH AC KS 3D 2C', 7, 'Carré', 'Carré d’As'],
    ['5H 6H 7H 8H 9H AS AD', 8, 'Quinte flush', 'Quinte flush au 9'],
    ['AH 2H 3H 4H 5H KS KD', 8, 'Quinte flush', 'Quinte flush au 5'],
    ['TS JS QS KS AS 2D 3C', 9, 'Quinte flush royale', 'Quinte flush royale'],
  ];
  for (const [cards, category, name, description] of cases) {
    const e = ev(cards);
    assert.equal(e.category, category, cards);
    assert.equal(e.name, name, cards);
    assert.equal(e.description, description, cards);
    assert.equal(e.cards.length, 5, `${cards} : 5 cartes retenues`);
  }
  // chaque catégorie bat toutes celles du dessous
  for (const [x, cx] of cases) {
    for (const [y, cy] of cases) {
      if (cx > cy) assert.ok(compareHands(ev(x), ev(y)) > 0, `${x} bat ${y}`);
    }
  }
});

test('évaluateur : les cas limites (quinte blanche, plusieurs paires, deux brelans, couleur et quinte)', () => {
  assert.deepEqual(ev('AS 2D 3H 4C 5S 9D KC').score, [4, 5], 'A-2-3-4-5 : quinte au 5');
  assert.equal(ev('AS 2D 3H 4C 5S 9D KC').cards.map((c) => c.rank).join(','), '5,4,3,2,14', 'l’As se lit en dernier');
  assert.ok(compareHands(ev('2S 3D 4H 5C 6S 9D KC'), ev('AS 2D 3H 4C 5S 9D KC')) > 0, 'la quinte au 6 bat la quinte blanche');
  assert.deepEqual(ev('4S 5D 6H 7C 8S 9D 2C').score, [4, 9], 'six cartes à la suite : la plus haute quinte');
  assert.deepEqual(ev('KS KD 8H 8C 4S 4D QC').score, [2, 13, 8, 12], 'trois paires : les deux meilleures, puis le meilleur kicker');
  assert.deepEqual(ev('KS KD 8H 8C 4S 4D 2C').score, [2, 13, 8, 4], 'le kicker peut venir de la troisième paire');
  assert.deepEqual(ev('QS QD QH 8C 8S 8D 2C').score, [6, 12, 8], 'deux brelans : full');
  assert.deepEqual(ev('QS QD QH 8C 8S 3D 3C').score, [6, 12, 8], 'brelan + deux paires : la plus haute paire');
  assert.deepEqual(ev('7S 7D 7H 7C 8S 8D 8C').score, [7, 7, 8], 'carré + brelan : le kicker vient du brelan');
  assert.equal(ev('4H 5H 6S 7H 8C 9H KH').category, 5, 'couleur plutôt que quinte');
  assert.deepEqual(ev('AH KH 9H 7H 4H 2H 3D').score, [5, 14, 13, 9, 7, 4], 'six cartes à la couleur : les cinq plus hautes');
  assert.equal(ev('9H TH JH QH KH AH 2D').category, 9, 'six à la suite en couleur : la royale');
  // avant le flop (2 cartes) : seules les paires comptent
  assert.equal(ev('AS AD').description, 'Paire d’As');
  assert.equal(ev('AS KD').description, 'Hauteur As');
  assert.equal(ev('9S 9D 9H').description, 'Brelan de 9');
});

test('évaluateur : kickers et égalités', () => {
  const aK = ev('KS KD AH 7C 4S 3D 2C');
  const qK = ev('KH KC QH 7D 4H 3S 2D');
  assert.ok(compareHands(aK, qK) > 0, 'Paire de Rois kicker As > kicker Dame');
  assert.equal(kickerNote(aK, qK), 'kicker As');
  assert.equal(kickerNote(ev('KS KD 8H 8C AS 3D 2C'), ev('KH KC 8D 8S QS 3H 2D')), 'kicker As', 'double paire : le kicker décide');
  assert.equal(kickerNote(ev('AS AD 9H 7C 4S'), ev('KS KD 9D 7S 4H')), null, 'paires différentes : pas de kicker');
  assert.ok(compareHands(ev('AS JD 9H 7C 5S'), ev('AH JC 9D 7S 4H')) > 0, 'carte haute départagée à la 5e carte');
  assert.equal(compareHands(ev('AS JD 9H 7C 5S'), ev('AH JC 9D 7S 5H')), 0, 'mêmes rangs : égalité');
  assert.equal(compareHands(ev('7S 7D 7H 7C KS 3D 2C'), ev('7S 7D 7H 7C KH 5D 4C')), 0, 'carré du tableau, même kicker : partage');
  assert.ok(compareHands(ev('QS QD QH 8C 8S'), ev('JS JD JH AC AS')) > 0, 'full : le brelan décide d’abord');
});

test('évaluateur : le tableau joue (égalité) et meilleure main de 5 parmi 7', () => {
  const board = 'TS JS QS KS AS';
  assert.equal(compareHands(ev(`${board} 2D 3C`), ev(`${board} AH KH`)), 0, 'quinte flush royale au tableau : partage');
  assert.equal(compareHands(ev('5D 6C 7H 8S 9D 2C 2H'), ev('5D 6C 7H 8S 9D 3S 4S')), 0, 'quinte au tableau, cartes privées inutiles');
  assert.ok(compareHands(ev('5D 6C 7H 8S 9D TC 2H'), ev('5D 6C 7H 8S 9D 3S 4S')) > 0, 'une carte privée prolonge la quinte');

  // la meilleure main de 7 cartes = la meilleure des 21 mains de 5, et ses 5 cartes forment bien cette main
  const rng = seeded(42);
  for (let k = 0; k < 2000; k++) {
    const seven = shuffle(buildDeck(), rng).slice(0, 7);
    const best = evaluate(seven);
    let ref = null;
    for (let a = 0; a < 7; a++) {
      for (let b = a + 1; b < 7; b++) {
        const five = seven.filter((_, i) => i !== a && i !== b);
        const e = evaluate(five);
        if (!ref || compareHands(e, ref) > 0) ref = e;
      }
    }
    assert.deepEqual(best.score, ref.score, seven.map((c) => c.id).join(' '));
    assert.equal(best.cards.length, 5);
    assert.ok(best.cards.every((c) => seven.includes(c)), 'cartes retenues prises parmi les 7');
    assert.deepEqual(evaluate(best.cards).score, best.score, 'les 5 cartes retenues font la main annoncée');
  }
});

// ================================================================ blindes et ordre de parole

test('manifeste : options du salon et contrat du Hub', () => {
  assert.equal(manifest.id, 'poker');
  assert.equal(manifest.minPlayers, 2);
  assert.equal(manifest.maxPlayers, 8);
  assert.deepEqual(manifest.options.map((o) => [o.id, o.default]), [['stack', 2000], ['blinds', 'normale']]);
  assert.deepEqual(manifest.options[0].choices.map((c) => c.value), [1000, 2000, 5000]);
  assert.deepEqual(manifest.options[1].choices.map((c) => c.value), ['rapide', 'normale', 'lente']);
  const g = manifest.createGame({ players: players(3), options: { stack: 5000, blinds: 'lente' } });
  assert.equal(g.startStack, 5000);
  assert.equal(g.handsPerLevel, 15);
  assert.equal(totalChips(g), 15000);
});

test('blindes, bouton et ordre de parole à 4 joueurs', () => {
  const g = newGame(4);
  const s = g.getStateFor('p0');
  assert.equal(s.buttonId, 'p3', 'premier bouton : dernière place');
  assert.equal(s.sbId, 'p0');
  assert.equal(s.bbId, 'p1');
  assert.deepEqual([chips(g).p0, chips(g).p1], [1990, 1980]);
  assert.deepEqual(s.blinds, { level: 1, sb: 10, bb: 20, next: { sb: 15, bb: 30 }, handsPerLevel: 10, handsLeft: 9 });
  assert.equal(cur(g), 'p2', 'le joueur après la grosse blinde parle en premier');
  assert.throws(() => g.handleAction('p3', 'call'), /Ce n’est pas ton tour/);
  act(g, 'call'); // p2
  act(g, 'call'); // p3
  act(g, 'call'); // p0 complète
  assert.equal(cur(g), 'p1', 'la grosse blinde garde la parole');
  const bb = g.getStateFor('p1').me;
  assert.ok(bb.canCheck && bb.canRaise && !bb.canCall);
  act(g, 'check');
  assert.equal(g.street, 'flop');
  assert.equal(g.board.length, 3);
  assert.equal(cur(g), 'p0', 'après le flop, le premier joueur à gauche du bouton parle');
  assert.equal(g.getStateFor('p0').pot, 80);
});

test('tête-à-tête : le bouton paie la petite blinde, parle en premier avant le flop, en dernier après', () => {
  const g = newGame(2);
  const s = g.getStateFor('p0');
  assert.equal(s.buttonId, 'p1');
  assert.equal(s.sbId, 'p1');
  assert.equal(s.bbId, 'p0');
  assert.equal(cur(g), 'p1');
  act(g, 'call');
  assert.equal(cur(g), 'p0', 'la grosse blinde a la parole');
  act(g, 'check');
  assert.equal(g.street, 'flop');
  assert.equal(cur(g), 'p0', 'après le flop, la grosse blinde (hors bouton) parle d’abord');
  act(g, 'check');
  assert.equal(cur(g), 'p1');
  act(g, 'check');
  assert.equal(g.street, 'turn');
});

test('ordre de parole : après une relance, ceux qui ont déjà parlé reparlent', () => {
  const g = newGame(5); // bouton p4, blindes p0/p1, premier : p2
  assert.equal(cur(g), 'p2');
  act(g, 'call'); // p2
  act(g, 'raise', 80); // p3
  assert.equal(cur(g), 'p4');
  act(g, 'fold'); // p4
  act(g, 'fold'); // p0
  act(g, 'call'); // p1
  assert.equal(cur(g), 'p2', 'p2 avait suivi 20 : il doit compléter, se coucher ou relancer');
  assert.ok(g.getStateFor('p2').me.canRaise);
  act(g, 'call');
  assert.equal(g.street, 'flop');
  assert.equal(cur(g), 'p1', 'premier encore en jeu à gauche du bouton');
});

// ================================================================ validation des actions

test('validation : parole refusée face à une mise, relance minimum, montant « relancer à »', () => {
  const g = newGame(3); // bouton p2, blindes p0/p1, premier : p2
  assert.throws(() => act(g, 'check'), /parole : il y a 20 à suivre/);
  assert.throws(() => act(g, 'raise', 30), /Relance minimum : à 40/);
  assert.throws(() => act(g, 'raise', 20), /mise plus de 20/);
  assert.throws(() => act(g, 'raise', 5000), /au plus 2\u202f000/);
  assert.throws(() => act(g, 'raise', 'beaucoup'), /Montant invalide/);
  assert.throws(() => act(g, 'raise', 45.5), /Montant invalide/);
  assert.throws(() => act(g, 'danse'), /Action inconnue/);
  act(g, 'raise', 100); // p2 relance à 100 (relance de 80)
  assert.equal(g.players[2].bet, 100);
  assert.equal(g.players[2].chips, 1900);
  const sb = g.getStateFor('p0').me;
  assert.equal(sb.toCall, 90);
  assert.equal(sb.minRaiseTo, 180, 'relance minimum = dernière relance (80)');
  assert.throws(() => act(g, 'raise', 170), /Relance minimum : à 180/);
  act(g, 'raise', 180); // p0 : met 170 de plus
  assert.equal(g.players[0].bet, 180);
  assert.equal(g.players[0].chips, 1820);
});

test('validation : rien à suivre, mise minimum après le flop, tapis de moins que la blinde', () => {
  const g = newGame(2);
  act(g, 'call');
  assert.throws(() => act(g, 'call'), /Rien à suivre/);
  act(g, 'check');
  // flop : mise minimum = grosse blinde
  assert.throws(() => act(g, 'bet', 10), /Mise minimum : 20/);
  act(g, 'bet', 20);
  assert.equal(g.getStateFor('p1').me.minRaiseTo, 40);
  act(g, 'raise', 60);
  assert.equal(g.getStateFor('p0').me.minRaiseTo, 100);
});

test('un joueur à tapis pour moins que la grosse blinde : pot principal et pot annexe', () => {
  const g = newGame(3, {
    stacks: [1000, 5, 1000], // la grosse blinde (p1) n'a que 5
    rigs: { 1: { hands: { p0: ['2C', '7D'], p1: ['AS', 'AD'], p2: ['3C', '8D'] }, board: ['KS', 'QH', '9C', '5D', '4H'] } },
  });
  assert.equal(g.players[1].bet, 5);
  assert.ok(g.players[1].allIn);
  assert.equal(g.currentBet, 20, 'il faut quand même suivre la grosse blinde entière');
  act(g, 'call'); // p2
  act(g, 'call'); // p0
  assert.equal(g.street, 'flop', 'la grosse blinde à tapis ne parle pas');
  checkDown(g);
  const pots = g.lastHand.pots;
  assert.deepEqual(pots.map((p) => [p.amount, p.eligible.length]), [[15, 3], [30, 2]]);
  assert.deepEqual(pots[0].winners, ['p1'], 'la paire d’As gagne le pot principal');
  assert.equal(chips(g).p1, 15);
});

test('tête-à-tête : petite blinde à tapis pour moins, la grosse blinde ne parle pas et récupère le surplus', () => {
  const g = newGame(2, {
    stacks: [2000, 5],
    rigs: { 1: { hands: { p0: ['2C', '7D'], p1: ['AS', 'AD'] }, board: ['KS', 'QH', '9C', '5D', '4H'] } },
  });
  assert.equal(g.phase, 'handEnd', 'personne ne peut parler : la main se joue toute seule');
  assert.equal(eventsOf(g, 'uncalled')[0].amount, 15, 'la grosse blinde reprend 15');
  assert.equal(g.lastHand.pots[0].amount, 10);
  assert.equal(chips(g).p1, 10);
  assert.equal(chips(g).p0, 1995, '2 000 − 20 + 15');
});

test('tapis trop court : les enchères ne sont pas rouvertes pour qui a déjà parlé', () => {
  const g = newGame(3, { stacks: [150, 1000, 1000] }); // bouton p2, PB p0 (150), GB p1
  act(g, 'raise', 100); // p2 : relance de 80
  act(g, 'allin'); // p0 : tapis à 150 (+50, moins qu'une relance complète)
  assert.equal(g.currentBet, 150);
  assert.equal(g.minRaise, 80, 'la relance minimum reste 80');
  const bb = g.getStateFor('p1').me;
  assert.ok(bb.canRaise, 'la grosse blinde n’a pas encore parlé : elle peut relancer');
  assert.equal(bb.minRaiseTo, 230);
  act(g, 'call'); // p1 suit 150
  assert.equal(cur(g), 'p2');
  const me = g.getStateFor('p2').me;
  assert.ok(!me.canRaise && me.canCall, 'p2 peut seulement suivre ou se coucher');
  assert.match(me.raiseBlock, /Relance fermée/);
  assert.throws(() => act(g, 'raise', 400), /Relance fermée/);
  assert.throws(() => act(g, 'allin'), /Relance fermée/);
  act(g, 'call');
  assert.equal(g.street, 'flop');
});

test('deux tapis courts qui cumulent une relance complète rouvrent les enchères', () => {
  const g = newGame(4, { stacks: [210, 2000, 2000, 150] }); // bouton p3 (150), PB p0 (210), GB p1, premier p2
  act(g, 'raise', 100); // p2 : relance de 80
  act(g, 'allin'); // p3 : 150 (+50)
  act(g, 'allin'); // p0 : 210 (+60)
  assert.equal(g.minRaise, 80);
  act(g, 'call'); // p1 suit 210
  assert.equal(cur(g), 'p2');
  assert.ok(g.getStateFor('p2').me.canRaise, '210 − 100 = 110 ≥ 80 : p2 fait face à une relance complète');
  act(g, 'raise', 290);
});

test('pots annexes : trois tapis de tailles différentes, surplus rendu', () => {
  const g = newGame(4, {
    stacks: [100, 300, 600, 1000], // bouton p3, PB p0, GB p1, premier p2
    rigs: {
      1: {
        hands: { p0: ['AS', 'AD'], p1: ['KS', 'KD'], p2: ['QS', 'QD'], p3: ['7C', '2H'] },
        board: ['3C', '8D', '9H', 'JS', '4D'],
      },
    },
  });
  act(g, 'allin'); // p2 : 600
  act(g, 'allin'); // p3 : 1000
  act(g, 'allin'); // p0 : 100
  act(g, 'allin'); // p1 : 300
  assert.equal(g.phase, 'handEnd');
  const unc = eventsOf(g, 'uncalled');
  assert.deepEqual(unc.map((e) => [e.playerId, e.amount]), [['p3', 400]], 'personne ne couvre les 400 derniers de p3');
  const pots = g.lastHand.pots;
  assert.deepEqual(pots.map((p) => p.amount), [400, 600, 600]);
  assert.deepEqual(pots.map((p) => p.eligible), [['p0', 'p1', 'p2', 'p3'], ['p1', 'p2', 'p3'], ['p2', 'p3']]);
  assert.deepEqual(pots.map((p) => p.winners), [['p0'], ['p1'], ['p2']]);
  assert.deepEqual(chips(g), { p0: 400, p1: 600, p2: 600, p3: 400 });
  assert.equal(totalChips(g), 2000);
  // tout le tableau est sorti, mains retournées
  assert.deepEqual(eventsOf(g, 'street').map((e) => e.street), ['flop', 'turn', 'river']);
  assert.equal(eventsOf(g, 'reveal').length, 1);
  assert.equal(g.getStateFor('p3').players[0].cards.length, 2, 'les mains abattues sont visibles de tous');
});

test('pot partagé à deux avec un jeton impair', () => {
  const board = ['KS', 'KH', '7C', '7D', '2S'];
  const g = newGame(3, {
    rigs: {
      // p0 et p1 : Rois et 7 avec kicker As ; p2 : kicker Dame
      1: { hands: { p0: ['AH', '3C'], p1: ['AD', '4C'], p2: ['QH', '5C'] }, board },
      // main 2 (bouton p0) : p0 et p2 gagnent, p1 perd
      2: { hands: { p0: ['AH', '3C'], p1: ['QH', '5C'], p2: ['AD', '4C'] }, board },
    },
  });
  act(g, 'raise', 41); // p2
  act(g, 'call'); // p0
  act(g, 'call'); // p1
  checkDown(g);
  let pot = g.lastHand.pots[0];
  assert.equal(pot.amount, 123);
  assert.deepEqual(pot.winners, ['p0', 'p1'], 'dans l’ordre de la table à partir de la gauche du bouton (p2)');
  assert.deepEqual(pot.shares, { p0: 62, p1: 61 });
  assert.equal(pot.kicker, 'kicker As');
  assert.match(pot.description, /Double paire, Rois et 7/);

  g.handleAction('p0', 'next'); // bouton p0, PB p1, GB p2
  act(g, 'raise', 41); // p0
  act(g, 'call'); // p1
  act(g, 'call'); // p2
  checkDown(g);
  pot = g.lastHand.pots[0];
  assert.deepEqual(pot.winners, ['p2', 'p0'], 'p1 (à gauche du bouton) perd : le jeton impair va à p2');
  assert.deepEqual(pot.shares, { p2: 62, p0: 61 });
});

test('mise non suivie rendue, victoire sans abattage : les cartes restent cachées', () => {
  const g = newGame(2);
  const hidden = g.players[1].cards.map((c) => c.id);
  act(g, 'raise', 500); // p1 (bouton)
  act(g, 'fold'); // p0
  assert.equal(g.phase, 'handEnd');
  assert.deepEqual(eventsOf(g, 'uncalled').map((e) => [e.playerId, e.amount]), [['p1', 480]]);
  assert.deepEqual(chips(g), { p0: 1980, p1: 2020 });
  assert.equal(g.lastHand.showdown, false);
  assert.deepEqual(g.lastHand.hands, []);
  assert.equal(g.lastHand.uncontested, 'p1');
  const s = g.getStateFor('p0');
  assert.equal(s.players[1].cards, null, 'pas de cartes montrées');
  const json = JSON.stringify(s);
  for (const id of hidden) assert.ok(!json.includes(`"${id}"`), `${id} ne fuit pas`);
  assert.equal(eventsOf(g, 'reveal').length + eventsOf(g, 'showdown').length, 0);
});

test('mise après le flop non suivie : rendue au miseur', () => {
  const g = newGame(3);
  act(g, 'call');
  act(g, 'call');
  act(g, 'check');
  act(g, 'bet', 300); // p0
  act(g, 'fold'); // p1
  act(g, 'fold'); // p2
  assert.equal(eventsOf(g, 'uncalled').at(-1).amount, 300);
  assert.deepEqual(chips(g), { p0: 2040, p1: 1980, p2: 1980 });
});

test('tapis suivi et perdu : le joueur quitte la table, les deux mains sont montrées', () => {
  const g = newGame(3, {
    rigs: { 1: { hands: { p0: ['AS', 'AD'], p1: ['KS', 'KD'], p2: ['7C', '2H'] }, board: ['3C', '8D', '9H', 'JS', '4D'] } },
  });
  act(g, 'fold'); // p2
  act(g, 'allin'); // p0
  assert.equal(g.street, 'preflop');
  assert.equal(g.getStateFor('p1').players[0].cards, null, 'pas encore retournée');
  act(g, 'call'); // p1 suit à tapis
  assert.equal(g.phase, 'handEnd');
  assert.deepEqual(chips(g), { p0: 4000, p1: 0, p2: 2000 });
  assert.equal(g.players[1].out, true);
  assert.equal(g.players[1].place, 3);
  assert.deepEqual(g.getStateFor('p2').players[1].cards.map((c) => c.id), ['KS', 'KD']);
});

test('tapis suivi : run-out, abattage visible de tous sauf la main couchée', () => {
  const g = newGame(3, {
    stacks: [500, 2000, 2000],
    rigs: { 1: { hands: { p0: ['AS', 'AD'], p1: ['KS', 'KD'], p2: ['7C', '2H'] }, board: ['3C', '8D', '9H', 'JS', '4D'] } },
  });
  act(g, 'call'); // p2 limpe
  act(g, 'allin'); // p0 : 500
  act(g, 'call'); // p1 suit 500
  act(g, 'fold'); // p2 se couche
  assert.equal(g.phase, 'handEnd');
  const types = g.events.map((e) => e.type);
  const i = types.lastIndexOf('reveal');
  assert.deepEqual(types.slice(i, i + 6), ['reveal', 'street', 'street', 'street', 'showdown', 'win']);
  const s = g.getStateFor('p2');
  assert.deepEqual(s.players[0].cards.map((c) => c.id), ['AS', 'AD']);
  assert.deepEqual(s.players[1].cards.map((c) => c.id), ['KS', 'KD']);
  const s1 = g.getStateFor('p1');
  assert.equal(s1.players[2].cards, null, 'la main couchée reste cachée');
  assert.ok(!JSON.stringify(s1).includes('"7C"'));
  assert.equal(g.lastHand.hands.length, 2);
  assert.equal(g.lastHand.hands.find((h) => h.playerId === 'p0').description, 'Paire d’As');
  assert.deepEqual(g.lastHand.awards, { p0: 1020 });
  assert.equal(chips(g).p0, 1020);
});

test('blindes : niveaux qui montent selon la vitesse choisie, puis doublement', () => {
  assert.deepEqual(blindsAt(0), [10, 20]);
  assert.deepEqual(blindsAt(4), [75, 150]);
  assert.deepEqual(blindsAt(10), [1000, 2000]);
  assert.deepEqual(blindsAt(11), [2000, 4000]);
  assert.deepEqual(blindsAt(12), [4000, 8000]);
  const g = newGame(2, { options: { blinds: 'rapide' } });
  for (let hand = 1; hand <= 5; hand++) {
    assert.equal(g.bb, 20, `main ${hand}`);
    assert.equal(g.getStateFor('p0').blinds.handsLeft, 5 - hand);
    act(g, 'fold');
    g.handleAction('p0', 'next');
  }
  assert.equal(g.handNumber, 6);
  assert.deepEqual([g.sb, g.bb], [15, 30]);
  assert.equal(eventsOf(g, 'level').at(-1).level, 2);
  assert.equal(g.getStateFor('p0').blinds.level, 2);
  const lente = newGame(2, { options: { blinds: 'lente', stack: 1000 } });
  assert.equal(lente.handsPerLevel, 15);
  assert.equal(lente.startStack, 1000);
});

test('bouton : avance d’une place, saute les joueurs éliminés ; tête-à-tête ensuite', () => {
  const g = newGame(3, {
    stacks: [100, 2000, 2000],
    rigs: { 1: { hands: { p0: ['7C', '2H'], p1: ['AS', 'AD'], p2: ['8C', '3H'] }, board: ['KS', 'QD', '9H', '5S', '4D'] } },
  });
  // main 1 : bouton p2, PB p0, GB p1
  act(g, 'fold'); // p2
  act(g, 'allin'); // p0 : 100
  act(g, 'call'); // p1
  assert.equal(g.phase, 'handEnd');
  assert.equal(g.players[0].out, true);
  assert.equal(g.players[0].place, 3);
  assert.deepEqual(g.lastHand.eliminated, [{ playerId: 'p0', place: 3 }]);
  assert.throws(() => g.handleAction('p0', 'next'), /quitté la table/);
  g.handleAction('p2', 'next');
  const s = g.getStateFor('p0');
  assert.equal(s.buttonId, 'p1', 'le bouton passe au joueur suivant encore en jeu (p0 est éliminé)');
  assert.equal(s.sbId, 'p1', 'tête-à-tête : le bouton paie la petite blinde');
  assert.equal(s.bbId, 'p2');
  assert.equal(s.players[0].inHand, false);
  assert.equal(s.players[0].hasCards, false);
  assert.equal(s.me.inGame, false);
  assert.equal(cur(g), 'p1');
});

test('bouton : sans élimination, il avance d’une place à chaque main', () => {
  const g = newGame(4);
  const seen = [];
  for (let k = 0; k < 5; k++) {
    seen.push(g.getStateFor('p0').buttonId);
    while (g.phase === 'betting') act(g, 'fold');
    g.handleAction('p0', 'next');
  }
  assert.deepEqual(seen, ['p3', 'p0', 'p1', 'p2', 'p3']);
});

test('éliminations dans la même main : le plus gros tapis de départ finit devant', () => {
  const g = newGame(4, {
    stacks: [300, 200, 3000, 200],
    rigs: {
      1: {
        hands: { p0: ['7C', '2H'], p1: ['8C', '3H'], p2: ['AS', 'AD'], p3: ['9C', '4H'] },
        board: ['KS', 'QD', 'JH', '5S', '6D'],
      },
    },
  });
  // bouton p3, PB p0, GB p1, premier p2
  act(g, 'raise', 1000); // p2
  act(g, 'allin'); // p3 : 200
  act(g, 'allin'); // p0 : 300
  act(g, 'allin'); // p1 : 200
  assert.equal(g.phase, 'gameOver');
  const places = Object.fromEntries(g.players.map((p) => [p.id, p.place]));
  assert.deepEqual(places, { p0: 2, p1: 3, p2: 1, p3: 3 }, 'p1 et p3 (200 chacun) partagent la 3e place');
  assert.equal(g.winnerId, 'p2');
  const r = g.getResult();
  assert.deepEqual(r.players.map((p) => [p.playerId, p.result, p.score]), [['p0', 'loss', 2], ['p1', 'loss', 1], ['p2', 'win', 3], ['p3', 'loss', 1]]);
  assert.match(r.summary, /J2 remporte le tournoi \(4 joueurs, 1 main\) · 2e J0 · 3e J1 · 3e J3/);
});

test('fin de partie : le dernier joueur avec des jetons gagne ; plus aucune action', () => {
  const g = newGame(2, {
    rigs: { 1: { hands: { p0: ['AS', 'AD'], p1: ['7C', '2H'] }, board: ['KS', 'QD', '9H', '5S', '4D'] } },
  });
  act(g, 'allin'); // p1
  act(g, 'call'); // p0
  assert.ok(g.isOver());
  assert.equal(g.winnerId, 'p0');
  assert.equal(chips(g).p0, 4000);
  assert.equal(eventsOf(g, 'gameOver').length, 1);
  assert.throws(() => g.handleAction('p0', 'next'), /terminée/);
  const r = g.getResult();
  assert.deepEqual(r.players, [{ playerId: 'p0', result: 'win', score: 1 }, { playerId: 'p1', result: 'loss', score: 0 }]);
  assert.equal(g.getStateFor('p1').winnerId, 'p0');
});

test('main suivante : n’importe quel joueur encore en jeu la lance, jamais pendant une main', () => {
  const g = newGame(3);
  assert.throws(() => g.handleAction('p0', 'next'), /encore en cours/);
  while (g.phase === 'betting') act(g, 'fold');
  assert.equal(g.getStateFor('p1').canNext, true);
  g.handleAction('p1', 'next');
  assert.equal(g.handNumber, 2);
  assert.throws(() => g.handleAction('p2', 'fold'), /Ce n’est pas ton tour/);
});

test('getStateFor ne montre jamais les cartes des autres ni le paquet', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const g = newGame(4, { seed });
    let guard = 0;
    while (g.phase === 'betting' && ++guard < 50) {
      for (const viewer of g.players) {
        const s = g.getStateFor(viewer.id);
        const json = JSON.stringify(s);
        assert.ok(!('deck' in s) && !json.includes('"deck"'));
        for (const p of g.players) {
          if (p === viewer || p.shown) continue;
          const view = s.players.find((x) => x.id === p.id);
          assert.equal(view.cards, null);
          for (const c of p.cards) assert.ok(!json.includes(`"${c.id}"`), `seed ${seed} : ${c.id} de ${p.id} visible par ${viewer.id}`);
        }
        assert.deepEqual(s.me.cards.map((c) => c.id), viewer.cards.map((c) => c.id), 'mes cartes');
      }
      const s = g.getStateFor(cur(g));
      act(g, s.me.canCheck ? 'check' : 'call');
    }
  }
});

test('meilleure main du joueur et options de relance dans sa vue', () => {
  const g = newGame(2, { rigs: { 1: { hands: { p0: ['8S', '8D'], p1: ['AS', 'KD'] }, board: ['8H', 'QD', '2C', '5S', '9D'] } } });
  assert.equal(g.getStateFor('p0').me.best.description, 'Paire de 8');
  assert.equal(g.getStateFor('p1').me.best.description, 'Hauteur As');
  const me = g.getStateFor('p1').me;
  assert.deepEqual([me.toCall, me.canCall, me.canCheck, me.canRaise, me.minRaiseTo, me.maxRaiseTo], [10, true, false, true, 40, 2000]);
  act(g, 'call');
  act(g, 'check');
  const s = g.getStateFor('p0');
  assert.equal(s.me.best.description, 'Brelan de 8');
  assert.deepEqual(s.me.best.cards.slice(0, 3).sort(), ['8D', '8H', '8S']);
  assert.equal(s.potTotal, 40);
});

/** Robot : action au hasard parmi celles que la vue autorise (souvent à tapis, pour finir vite). */
function botMove(g, rng) {
  const id = cur(g);
  const { me } = g.getStateFor(id);
  const r = rng();
  if (me.canRaise && r < 0.25) return g.handleAction(id, 'allin');
  if (me.canRaise && r < 0.5) {
    const span = me.maxRaiseTo - me.minRaiseTo;
    return g.handleAction(id, 'raise', { amount: me.minRaiseTo + Math.floor(rng() * (span + 1) * 0.3) });
  }
  if (r < 0.65 && me.canCall) return g.handleAction(id, 'fold');
  return g.handleAction(id, me.canCheck ? 'check' : 'call');
}

test('parties complètes au hasard (2 à 8 joueurs) : jetons conservés, un vainqueur, résultat valide', () => {
  for (let n = 2; n <= 8; n++) {
    for (const seed of [11, 23]) {
      const rng = seeded(seed * n);
      const g = new Poker({ players: players(n), options: { stack: 1000, blinds: 'rapide' }, rng });
      const total = n * 1000;
      let steps = 0;
      while (!g.isOver()) {
        assert.ok(++steps < 20000, 'la partie finit');
        if (g.phase === 'handEnd') {
          const starter = g.players.find((p) => !p.out);
          g.handleAction(starter.id, 'next');
        } else botMove(g, rng);
        assert.equal(totalChips(g), total, `jetons conservés (n=${n}, main ${g.handNumber})`);
        assert.ok(g.players.every((p) => p.chips >= 0 && p.bet >= 0));
      }
      const r = g.getResult();
      assert.equal(r.players.filter((p) => p.result === 'win').length, 1);
      assert.equal(g.player(g.winnerId).chips, total);
      assert.deepEqual(r.players.map((p) => p.score).sort((a, b) => a - b).at(-1), n - 1);
      assert.ok(g.players.every((p) => p.place >= 1 && p.place <= n));
    }
  }
});
