'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Profondeurs, scaleBoxes } = require('../games/profondeurs/server/Profondeurs');
const { HEROES, s, t } = require('../games/profondeurs/server/content');

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `J${i}` }));

function started(n = 2, heroes = ['guerriere', 'mage', 'paladin', 'voleur']) {
  const g = new Profondeurs({ players: players(n) });
  for (let i = 0; i < n; i++) g.handleAction(`p${i}`, 'pickHero', { heroId: heroes[i] });
  g.handleAction('p0', 'start');
  return g;
}

/** Ouvre une salle « monstre » avec des cases et des dés choisis. */
function fight(g, boxes, dice) {
  g.phase = 'dice';
  g.encounter = { kind: 'monster', name: 'Test', room: { xp: 2, loot: { type: 'item', id: 'epee_batarde' } }, boxes: boxes.map((b, i) => ({ ...b, id: `b${i}` })), shield: 0, noTime: false };
  g.readySet = new Set();
  g.skillUses = new Set();
  g.dice = dice.map(([owner, color, value], i) => ({ id: `x${i}`, owner, color, value, box: null }));
}

test('préparation : héros uniques, tous doivent choisir', () => {
  const g = new Profondeurs({ players: players(2) });
  g.handleAction('p0', 'pickHero', { heroId: 'mage' });
  assert.throws(() => g.handleAction('p1', 'pickHero', { heroId: 'mage' }), /déjà choisi/);
  assert.throws(() => g.handleAction('p0', 'start'), /Chaque joueur/);
  g.handleAction('p1', 'pickHero', { heroId: 'barde' });
  g.handleAction('p1', 'pickDungeon', { dungeonId: 'mines' });
  g.handleAction('p0', 'start');
  assert.equal(g.phase, 'explore');
  assert.equal(g.getStateFor('p0').heroes[1].name, 'Barde');
  assert.equal(g.dungeon().id, 'mines');
});

test('adaptation au nombre de joueurs et à l’étage', () => {
  const boxes = [s('F', 4, 't1'), t('M', 6, 'd2')];
  const solo = scaleBoxes(boxes, 1, 1);
  const quatre = scaleBoxes(boxes, 4, 1);
  assert.equal(solo.length, 2);
  assert.equal(quatre.filter((b) => b.mode === 'single').length, 4, 'une case unique par joueur');
  assert.ok(quatre.find((b) => b.mode === 'sum').target > solo.find((b) => b.mode === 'sum').target * 3.5, 'total plus que proportionnel');
  assert.equal(quatre.filter((b) => b.penalty.time).length, 1, 'les copies ne coûtent pas de torche');
  assert.ok(scaleBoxes(boxes, 1, 3)[0].target > solo[0].target, 'plus dur en profondeur');
  assert.ok(scaleBoxes([s('F', 6, 'd1')], 1, 3)[0].target <= 6, 'un seuil unique ne dépasse jamais 6');
});

test('placement : couleur, dé d’or, case unique, dés des autres', () => {
  const g = started(2);
  fight(g, [s('F', 4, 'd2'), t('X', 7, 'd1')], [['p0', 'F', 5], ['p0', 'A', 6], ['p1', 'G', 2], ['p1', 'M', 3], ['p0', 'F', 1]]);
  assert.throws(() => g.handleAction('p0', 'place', { dieId: 'x1', boxId: 'b0' }), /couleur/);
  assert.throws(() => g.handleAction('p0', 'place', { dieId: 'x3', boxId: 'b0' }), /autre héros/);
  g.handleAction('p0', 'place', { dieId: 'x0', boxId: 'b0' });
  assert.throws(() => g.handleAction('p0', 'place', { dieId: 'x4', boxId: 'b0' }), /un seul dé/);
  // case « total » toute couleur : les deux joueurs y contribuent
  g.handleAction('p0', 'place', { dieId: 'x1', boxId: 'b1' });
  g.handleAction('p1', 'place', { dieId: 'x2', boxId: 'b1' });
  assert.deepEqual(g.coverage(), { b0: { total: 5, covered: true }, b1: { total: 8, covered: true } });
  g.handleAction('p0', 'place', { dieId: 'x0', boxId: null });
  assert.equal(g.coverage().b0.covered, false);
});

test('fusion de deux dés en un dé d’or', () => {
  const g = started(1);
  fight(g, [s('M', 5, 'd2')], [['p0', 'F', 5], ['p0', 'A', 2]]);
  g.handleAction('p0', 'fuse', { dieIds: ['x0', 'x1'] });
  assert.equal(g.dice.length, 1);
  assert.deepEqual({ color: g.dice[0].color, value: g.dice[0].value }, { color: 'G', value: 5 });
  g.handleAction('p0', 'place', { dieId: 'x0', boxId: 'b0' });
  assert.equal(g.coverage().b0.covered, true);
});

test('compétences : une fois par salle, ciblage du bon dé', () => {
  const g = started(2); // Guerrière (coup puissant) et Mage (transmutation)
  fight(g, [s('F', 6, 'd2')], [['p0', 'F', 4], ['p0', 'A', 3], ['p1', 'M', 2]]);
  assert.throws(() => g.handleAction('p0', 'skill', { skillId: 'coup_puissant', dieId: 'x1' }), /Force/);
  g.handleAction('p0', 'skill', { skillId: 'coup_puissant', dieId: 'x0' });
  assert.equal(g.dice[0].value, 6);
  assert.throws(() => g.handleAction('p0', 'skill', { skillId: 'coup_puissant', dieId: 'x0' }), /déjà utilisée/);
  g.handleAction('p1', 'skill', { skillId: 'transmutation', dieId: 'x2' });
  assert.equal(g.dice[2].color, 'G');
});

test('résolution : dégâts au plus en forme, armure, torche, récompense', () => {
  const g = started(2);
  g.hero('p0').items.push('bouclier_chene'); // armure 1 pour la Guerrière (la plus en forme, donc ciblée)
  const torch = g.torch;
  fight(g, [s('F', 6, 'd3'), s('A', 6, 't2'), s('M', 2, 'd5')], [['p0', 'M', 3]]);
  g.handleAction('p0', 'place', { dieId: 'x0', boxId: 'b2' });
  const before = g.heroes.map((h) => h.pv);
  g.handleAction('p0', 'ready');
  g.handleAction('p1', 'ready'); // tous prêts -> résolution
  assert.equal(g.phase, 'reward');
  const taken = g.lastResolution.taken;
  assert.equal((taken.p0 ?? 0) + (taken.p1 ?? 0) + 1, 3, '3 dégâts répartis, 1 absorbé par l’armure');
  assert.equal(g.heroes[0].pv, before[0] - (taken.p0 ?? 0));
  assert.equal(g.torch, torch - 2);
  g.handleAction('p1', 'reward', { choice: 0, heroOf: 'p1' });
  assert.ok(g.hero('p1').items.includes('epee_batarde'));
  assert.equal(g.phase, 'explore');
});

test('expérience et niveaux : dé d’or et PV en plus', () => {
  const g = started(1);
  const pvMax = g.heroStats(g.heroes[0]).pvMax;
  g.gainXp(5);
  assert.equal(g.level, 2);
  assert.equal(g.heroStats(g.heroes[0]).gold, 1);
  assert.equal(g.heroStats(g.heroes[0]).pvMax, pvMax + 2);
});

test('gardien en plusieurs rounds, puis repos et étage suivant', () => {
  const g = started(1);
  g.torch = 0;
  g.handleAction('p0', 'descend');
  assert.equal(g.encounter.kind, 'guardian');
  const pv = g.encounter.bossPv;
  // round 1 : on couvre tout -> le gardien encaisse
  for (const box of g.encounter.boxes) g.dice.push({ id: `w${box.id}`, owner: 'p0', color: 'G', value: 6, box: box.id });
  for (const box of g.encounter.boxes.filter((b) => b.mode === 'sum')) {
    for (let i = 0; i < Math.ceil(box.target / 6); i++) g.dice.push({ id: `w${box.id}-${i}`, owner: 'p0', color: 'G', value: 6, box: box.id });
  }
  g.resolve();
  assert.ok(g.encounter.bossPv < pv);
  assert.equal(g.encounter.round, 2, 'nouveau round, dés relancés');
  g.encounter.bossPv = 1;
  for (const box of g.encounter.boxes.filter((b) => b.hit)) g.dice.push({ id: `k${box.id}`, owner: 'p0', color: 'G', value: 6, box: box.id });
  g.dice.find((d) => d.box && g.encounter.boxes.find((b) => b.id === d.box).mode === 'single');
  g.encounter.boxes = g.encounter.boxes.filter((b) => b.mode === 'single');
  g.resolve();
  assert.equal(g.phase, 'reward');
  assert.equal(g.rewardOffer.loots.length, 2);
  g.handleAction('p0', 'reward', { choice: 'skip' });
  assert.equal(g.phase, 'camp');
  g.handleAction('p0', 'continue');
  assert.equal(g.floor, 2);
  assert.equal(g.phase, 'explore');
});

test('pouvoirs des gardiens : malédiction et invocation', () => {
  const g = started(1);
  g.dungeonId = 'crypte';
  g.floor = 2;
  g.phase = 'explore';
  g.handleAction('p0', 'descend'); // La Dame Voilée : dés de Force -1
  assert.ok(g.dice.filter((d) => d.color === 'F').every((d) => d.value <= 5));
  const g2 = started(1);
  g2.dungeonId = 'mines';
  g2.floor = 2;
  g2.phase = 'explore';
  g2.handleAction('p0', 'descend'); // Le Ver de lave : une case de plus
  assert.equal(g2.encounter.boxes.length, 4);
});

test('défaite quand tous les héros tombent', () => {
  const g = started(1);
  g.heroes[0].pv = 2;
  fight(g, [s('F', 6, 'd5')], []);
  g.resolve();
  assert.equal(g.phase, 'defeat');
  assert.equal(g.getResult().players[0].result, 'loss');
});

test('parties complètes simulées de 1 à 4 joueurs : toujours une fin', () => {
  for (const n of [1, 2, 3, 4]) {
    for (let k = 0; k < 40; k++) {
      const g = started(n, Object.keys(HEROES).slice(k % 3, (k % 3) + n));
      let steps = 0;
      while (!g.isOver()) {
        assert.ok(++steps < 4000, 'boucle infinie');
        if (g.phase === 'explore') g.handleAction('p0', g.canExplore() ? 'openDoors' : 'descend');
        else if (g.phase === 'doors') g.handleAction('p0', 'enter', { index: 0 });
        else if (g.phase === 'peril') g.handleAction('p0', 'choose', { index: 1 });
        else if (g.phase === 'dice') {
          for (const d of g.dice) {
            const box = g.encounter.boxes.find((b) => (d.color === 'G' || b.color === 'X' || b.color === d.color) && (b.mode === 'sum' || !g.dice.some((o) => o.box === b.id)));
            if (box) g.handleAction(d.owner, 'place', { dieId: d.id, boxId: box.id });
          }
          for (const h of g.heroes) if (h.pv > 0) g.handleAction(h.playerId, 'ready');
        } else if (g.phase === 'reward') g.handleAction('p0', 'reward', { choice: g.rewardOffer.xp ? 'xp' : 'skip' });
        else if (g.phase === 'camp') g.handleAction('p0', 'continue');
      }
      const r = g.getResult();
      assert.equal(r.players.length, n);
    }
  }
});

test('coup fatal : un ennemi abattu l’emporte sur la chute du dernier héros (Vague de froid)', () => {
  const g = started(1, ['mage']);
  g.floor = 3;
  g.torch = 0;
  g.dungeonId = 'crypte'; // Morvhal : -1 PV à chaque héros par round
  g.handleAction('p0', 'descend');
  assert.equal(g.encounter.kind, 'boss');
  g.heroes[0].pv = 1;
  g.encounter.bossPv = 1;
  g.dice = g.encounter.boxes.map((b) => ({ id: `k${b.id}`, owner: 'p0', color: 'G', value: 6, box: b.id }));
  for (const box of g.encounter.boxes.filter((b) => b.mode === 'sum')) {
    for (let i = 0; i < Math.ceil(box.target / 6); i++) g.dice.push({ id: `k${box.id}-${i}`, owner: 'p0', color: 'G', value: 6, box: box.id });
  }
  g.resolve();
  assert.equal(g.heroes[0].pv, 0, 'le froid a frappé');
  assert.equal(g.phase, 'victory');
  assert.equal(g.getResult().players[0].result, 'win');
  assert.deepEqual(g.lastResolution.aoeTargets, ['p0']);
});

test('actions réseau : index validés, pas de résolution forcée, pas de clé de prototype', () => {
  const g = started(1);
  assert.throws(() => g.handleAction('p0', 'resolve'), /Action inconnue/);
  g.handleAction('p0', 'openDoors');
  for (const index of ['length', -1, 9, 1.5, '0']) assert.throws(() => g.handleAction('p0', 'enter', { index }), /Porte inconnue/);
  assert.equal(g.phase, 'doors', 'la partie continue');
  const h = new Profondeurs({ players: players(1) });
  assert.throws(() => h.handleAction('p0', 'pickHero', { heroId: 'constructor' }), /Héros inconnu/);
});

test('relève : seul le camp relève un héros à terre ; bilan du camp', () => {
  const g = started(2);
  g.heroes[1].pv = 0;
  g.gainXp(5);
  assert.equal(g.heroes[1].pv, 0, 'la montée de niveau ne relève pas');
  g.offerReward({ xp: 0, loots: [{ type: 'item', id: 'anneau_vigueur' }], guardian: true });
  g.handleAction('p0', 'reward', { choice: 0, heroOf: 'p1' });
  assert.equal(g.phase, 'camp');
  const camp = g.getStateFor('p0').camp;
  assert.deepEqual(camp.revived, ['p1']);
  assert.equal(camp.healed.p1, 4);
});

test('malédiction marquée sur les dés, effacée par une relance', () => {
  const g = started(1, ['rodeuse']);
  g.torch = 0;
  g.dungeonId = 'bois_noir';
  g.floor = 2; // Sorcière des racines : Agilité -1
  g.handleAction('p0', 'descend');
  const agi = g.dice.filter((d) => d.color === 'A');
  assert.ok(agi.length && agi.every((d) => d.cursed));
  assert.ok(g.dice.filter((d) => d.color !== 'A').every((d) => !d.cursed));
  g.handleAction('p0', 'skill', { skillId: 'second_souffle' });
  assert.ok(g.dice.every((d) => !d.cursed), 'relancés : plus maudits');
});
