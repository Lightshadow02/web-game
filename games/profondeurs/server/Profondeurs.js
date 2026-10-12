'use strict';

const { SKILLS, HEROES, ITEMS, MONSTERS, PERILS, DUNGEONS } = require('./content');

/* =====================================================================
 * « Les Profondeurs » — exploration de donjon coopérative aux dés, 1 à 4 joueurs.
 *
 * Phases :
 *   setup     choix des héros et du donjon
 *   explore   on ouvre des portes (coût : 1 torche) ou on affronte le gardien
 *   doors     choix entre deux salles
 *   peril     choix de la façon d'affronter un péril
 *   dice      tout le monde lance et place ses dés ; résolution quand tous sont prêts
 *   reward    choix de la récompense (expérience ou objet/compétence pour un héros)
 *   camp      repos entre deux étages
 *   victory / defeat
 * ===================================================================== */

const FLOORS = 3;
const ROOMS_PER_FLOOR = 10;
/** Réglages d'équilibrage (ajustés par simulation, voir test/profondeurs.test.js). */
const BALANCE = {
  torch: 6, // torche par étage (ouvrir des portes coûte 1)
  singleBonus: 1, // bonus global des seuils « dé unique »
  sumMult: 1.4, // multiplicateur global des totaux
  floorSingle: 1, // + par étage sur les seuils uniques
  floorSum: 0.35, // + % par étage sur les totaux
  bossPv: 2.2, // multiplicateur des PV de gardiens/boss
  perPlayer: 0.15, // durcissement des totaux par joueur en plus (mettre ses dés en commun aide)
};
const XP_LEVELS = [0, 5, 12, 20]; // niveau 1, 2, 3, 4
const CAMP_HEAL = 4;
const LOG_SIZE = 60;
const EVENT_SIZE = 80;

class GameError extends Error {
  constructor(message) {
    super(message);
    this.isGameError = true;
  }
}

const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * Adapte les cases au nombre de joueurs et à l'étage.
 *  - cases « dé unique » : une copie par joueur (les copies coûtent 1 dégât au lieu de la torche) ;
 *  - cases « total » : seuil multiplié par le nombre de joueurs ;
 *  - étage : seuils uniques +1 par étage, totaux +20 % par étage.
 */
function scaleBoxes(boxes, players, floor) {
  const out = [];
  for (const box of boxes) {
    if (box.mode === 'single') {
      const target = Math.min(6, box.target + BALANCE.singleBonus + BALANCE.floorSingle * (floor - 1));
      for (let i = 0; i < players; i++) {
        const copy = clone({ ...box, target });
        if (i > 0 && copy.penalty.time) copy.penalty = { damage: 1, time: 0 };
        out.push(copy);
      }
    } else {
      out.push(clone({ ...box, target: Math.round(box.target * BALANCE.sumMult * players * (1 + BALANCE.perPlayer * (players - 1)) * (1 + BALANCE.floorSum * (floor - 1))) }));
    }
  }
  return out.map((b, i) => ({ ...b, id: `b${i}` }));
}

class Profondeurs {
  constructor({ players, rng = Math.random }) {
    if (players.length < 1 || players.length > 4) throw new GameError('Les Profondeurs se jouent de 1 à 4 joueurs.');
    this.rng = rng;
    this.players = players.map((p) => ({ id: p.id, name: p.name }));
    this.phase = 'setup';
    this.picks = {}; // playerId -> heroId
    this.dungeonId = DUNGEONS[0].id;
    this.heroes = [];
    this.events = [];
    this.eventSeq = 0;
    this.log = [];
    this.diceSeq = 0;
    this.stats = { rooms: 0, guardians: 0 };
  }

  // ================================================================ API publique

  handleAction(playerId, type, payload = {}) {
    if (this.isOver()) throw new GameError('L’aventure est terminée.');
    if (!this.players.some((p) => p.id === playerId)) throw new GameError('Joueur inconnu.');
    const actions = {
      pickHero: () => this.pickHero(playerId, payload.heroId),
      pickDungeon: () => this.pickDungeon(payload.dungeonId),
      start: () => this.start(),
      openDoors: () => this.openDoors(),
      descend: () => this.faceGuardian(),
      enter: () => this.enter(payload.index),
      choose: () => this.choosePeril(payload.index),
      place: () => this.place(playerId, payload.dieId, payload.boxId ?? null),
      fuse: () => this.fuse(playerId, payload.dieIds),
      skill: () => this.useSkill(playerId, payload.skillId, payload.dieId),
      ready: () => this.setReady(playerId, payload.ready !== false),
      resolve: () => this.resolve(),
      reward: () => this.takeReward(payload.choice, payload.heroOf),
      continue: () => this.nextFloor(),
    };
    if (!actions[type]) throw new GameError(`Action inconnue : ${type}`);
    return actions[type]();
  }

  isOver() {
    return this.phase === 'victory' || this.phase === 'defeat';
  }

  getResult() {
    if (!this.isOver()) return null;
    const won = this.phase === 'victory';
    const score = this.stats.rooms + this.stats.guardians * 5 + (won ? 10 : 0);
    return {
      summary: won
        ? `Victoire contre ${this.dungeon().boss.name}`
        : `Défaite à l’étage ${this.floor} (${this.dungeon().name})`,
      players: this.players.map((p) => ({ playerId: p.id, result: won ? 'win' : 'loss', score })),
    };
  }

  getStateFor(playerId) {
    const enc = this.encounter;
    return {
      phase: this.phase,
      // préparation
      picks: this.picks,
      dungeonId: this.dungeonId,
      catalog: this.phase === 'setup' ? { heroes: HEROES, dungeons: DUNGEONS.map(({ id, name, text, boss }) => ({ id, name, text, boss: boss.name })) } : null,
      // groupe
      dungeon: this.heroes.length ? { id: this.dungeon().id, name: this.dungeon().name } : null,
      floor: this.floor,
      floors: FLOORS,
      torch: this.torch,
      torchMax: this.torchMax,
      roomsLeft: this.deck?.length ?? 0,
      level: this.level,
      xp: this.xp,
      xpNext: XP_LEVELS[this.level] ?? null,
      heroes: this.heroes.map((h) => this.publicHero(h)),
      me: playerId,
      // salle
      doors: this.doors?.map((d) => this.preview(d)) ?? [],
      encounter: enc && {
        kind: enc.kind,
        name: enc.name,
        options: enc.options?.map((o) => ({ label: o.label, box: o.box })),
        boxes: enc.boxes,
        round: enc.round,
        bossPv: enc.bossPv,
        bossPvMax: enc.bossPvMax,
        ability: enc.ability ?? null,
        shield: enc.shield,
        noTime: enc.noTime,
      },
      dice: this.dice ?? [],
      ready: this.readySet ? [...this.readySet] : [],
      coverage: this.dice ? this.coverage() : {},
      lastResolution: this.lastResolution ?? null,
      reward: this.rewardOffer ?? null,
      events: this.events,
      log: this.log,
      stats: this.stats,
    };
  }

  // ================================================================ préparation

  pickHero(playerId, heroId) {
    this.assertPhase('setup');
    if (!HEROES[heroId]) throw new GameError('Héros inconnu.');
    const takenBy = Object.entries(this.picks).find(([pid, h]) => h === heroId && pid !== playerId);
    if (takenBy) throw new GameError('Ce héros est déjà choisi.');
    this.picks[playerId] = heroId;
  }

  pickDungeon(dungeonId) {
    this.assertPhase('setup');
    if (!DUNGEONS.some((d) => d.id === dungeonId)) throw new GameError('Donjon inconnu.');
    this.dungeonId = dungeonId;
  }

  start() {
    this.assertPhase('setup');
    if (this.players.some((p) => !this.picks[p.id])) throw new GameError('Chaque joueur doit choisir un héros.');
    this.heroes = this.players.map((p) => {
      const def = HEROES[this.picks[p.id]];
      return {
        playerId: p.id,
        playerName: p.name,
        heroId: this.picks[p.id],
        base: { ...def.stats },
        basePv: def.pv,
        pv: def.pv,
        skills: [def.skill],
        items: [],
      };
    });
    this.level = 1;
    this.xp = 0;
    this.floor = 1;
    this.addLog(`Le groupe entre dans ${this.dungeon().name}.`);
    this.startFloor();
  }

  // ================================================================ étages et salles

  dungeon() {
    return DUNGEONS.find((d) => d.id === this.dungeonId);
  }

  startFloor() {
    const pool = [
      ...MONSTERS.map((m) => ({ kind: 'monster', ...m })),
      ...MONSTERS.map((m) => ({ kind: 'monster', ...m })),
      ...PERILS.map((p) => ({ kind: 'peril', ...p })),
    ];
    this.deck = this.shuffle(pool).slice(0, ROOMS_PER_FLOOR).map((room) => ({ ...room, loot: this.randomLoot() }));
    this.torchMax = BALANCE.torch + this.heroes.reduce((n, h) => n + this.heroStats(h).torch, 0);
    this.torch = this.torchMax;
    this.doors = null;
    this.encounter = null;
    this.dice = null;
    this.phase = 'explore';
    this.emit('floor', { floor: this.floor });
    this.addLog(`Étage ${this.floor} : ${this.torch} de torche.`);
  }

  openDoors() {
    this.assertPhase('explore');
    if (!this.canExplore()) throw new GameError('Plus de torche ni de salle : affrontez le gardien.');
    this.torch -= 1;
    this.doors = this.deck.splice(0, Math.min(2, this.deck.length));
    this.phase = 'doors';
    this.emit('doors', { count: this.doors.length });
  }

  canExplore() {
    return this.torch > 0 && this.deck.length > 0;
  }

  enter(index) {
    this.assertPhase('doors');
    const room = this.doors[index];
    if (!room) throw new GameError('Porte inconnue.');
    const other = this.doors.filter((_, i) => i !== index);
    this.deck.push(...other); // l'autre salle retourne au fond de l'étage
    this.doors = null;
    this.addLog(`Le groupe entre : ${room.name}.`);
    if (room.kind === 'peril') {
      this.encounter = { kind: 'peril', name: room.name, room, options: room.options };
      this.phase = 'peril';
      return;
    }
    this.startEncounter({ kind: 'monster', name: room.name, room, boxes: scaleBoxes(room.boxes, this.heroes.length, this.floor) });
  }

  choosePeril(index) {
    this.assertPhase('peril');
    const option = this.encounter.options[index];
    if (!option) throw new GameError('Choix inconnu.');
    this.addLog(`${this.encounter.name} : « ${option.label} ».`);
    this.startEncounter({ ...this.encounter, chosen: option.label, boxes: scaleBoxes([option.box], this.heroes.length, this.floor) });
  }

  /** Gardien de l'étage (boss final au dernier étage). */
  faceGuardian() {
    this.assertPhase('explore');
    const final = this.floor === FLOORS;
    const def = final ? this.dungeon().boss : this.dungeon().guardians[this.floor - 1];
    const n = this.heroes.length;
    const pv = Math.round(def.pv * n * BALANCE.bossPv);
    this.addLog(`${def.name} se dresse devant le groupe !`);
    this.startEncounter({
      kind: final ? 'boss' : 'guardian',
      name: def.name,
      def,
      ability: def.ability ?? null,
      bossPv: pv,
      bossPvMax: pv,
      round: 1,
      boxes: this.bossBoxes(def, pv, pv),
    });
  }

  bossBoxes(def, pv, pvMax) {
    let boxes = [...def.boxes];
    if (def.ability?.type === 'summon') boxes.push(def.ability.box);
    let scaled = scaleBoxes(boxes, this.heroes.length, this.floor);
    if (def.ability?.type === 'enrage' && pv <= pvMax / 2) {
      scaled = scaled.map((b) => ({ ...b, target: b.mode === 'single' ? Math.min(6, b.target + 1) : b.target + 1 }));
    }
    return scaled;
  }

  // ================================================================ dés

  startEncounter(encounter) {
    this.encounter = { shield: 0, noTime: false, ...encounter };
    this.phase = 'dice';
    this.lastResolution = null;
    this.rollAll();
    this.emit('encounter', { kind: encounter.kind, name: encounter.name });
  }

  rollAll() {
    this.dice = [];
    this.readySet = new Set();
    this.skillUses = new Set();
    const curse = this.encounter.ability?.type === 'curse' ? this.encounter.ability.color : null;
    for (const h of this.heroes) {
      if (h.pv <= 0) continue;
      const st = this.heroStats(h);
      for (const color of ['F', 'A', 'M', 'G']) {
        const count = color === 'G' ? st.gold : st[color];
        for (let i = 0; i < count; i++) {
          let value = this.d6();
          if (color === curse) value = Math.max(1, value - 1);
          this.dice.push({ id: `d${++this.diceSeq}`, owner: h.playerId, color, value, box: null });
        }
      }
    }
    this.emit('roll', { round: this.encounter.round ?? 1 });
  }

  die(playerId, dieId) {
    const die = this.dice.find((d) => d.id === dieId);
    if (!die) throw new GameError('Dé introuvable.');
    if (die.owner !== playerId) throw new GameError('Ce dé appartient à un autre héros.');
    return die;
  }

  /** Place un de ses dés dans une case (ou le reprend si boxId est null). */
  place(playerId, dieId, boxId) {
    this.assertPhase('dice');
    const die = this.die(playerId, dieId);
    if (boxId === null) {
      die.box = null;
      this.readySet.delete(playerId);
      return;
    }
    const box = this.encounter.boxes.find((b) => b.id === boxId);
    if (!box) throw new GameError('Case inconnue.');
    if (die.color !== 'G' && box.color !== 'X' && die.color !== box.color) throw new GameError('Ce dé n’est pas de la bonne couleur.');
    if (box.mode === 'single' && this.dice.some((d) => d.box === boxId && d.id !== dieId)) {
      throw new GameError('Cette case ne prend qu’un seul dé.');
    }
    die.box = boxId;
    this.readySet.delete(playerId);
  }

  /** Fusion : deux de ses dés non placés deviennent un dé d'or (valeur du plus fort). */
  fuse(playerId, dieIds) {
    this.assertPhase('dice');
    if (!Array.isArray(dieIds) || dieIds.length !== 2 || dieIds[0] === dieIds[1]) throw new GameError('Choisissez deux dés.');
    const [a, b] = dieIds.map((id) => this.die(playerId, id));
    if (a.box || b.box) throw new GameError('Retirez d’abord ces dés de leur case.');
    this.dice = this.dice.filter((d) => d !== b);
    a.color = 'G';
    a.value = Math.max(a.value, b.value);
    this.readySet.delete(playerId);
    this.emit('fuse', { owner: playerId, dieId: a.id });
  }

  useSkill(playerId, skillId, dieId) {
    this.assertPhase('dice');
    const hero = this.hero(playerId);
    if (!hero || hero.pv <= 0) throw new GameError('Héros à terre.');
    if (!hero.skills.includes(skillId)) throw new GameError('Compétence inconnue.');
    const key = `${playerId}:${skillId}`;
    if (this.skillUses.has(key)) throw new GameError('Compétence déjà utilisée dans cette salle.');
    const skill = SKILLS[skillId];
    const needDie = ['boost', 'six', 'gold'].includes(skill.effect);
    let die = null;
    if (needDie) {
      if (!dieId) throw new GameError('Sélectionnez d’abord un de vos dés.');
      die = this.die(playerId, dieId);
      if (skill.color && die.color !== skill.color) throw new GameError(`Il faut un dé de ${{ F: 'Force', A: 'Agilité', M: 'Magie' }[skill.color]}.`);
    }
    switch (skill.effect) {
      case 'boost':
        die.value = Math.min(6, die.value + skill.amount);
        break;
      case 'six':
        die.value = 6;
        break;
      case 'gold':
        die.color = 'G';
        break;
      case 'reroll':
        for (const d of this.dice) if (d.owner === playerId && !d.box) d.value = this.d6();
        break;
      case 'ballad':
        for (const d of this.dice) if (!d.box && d.value <= 2) d.value = this.d6();
        break;
      case 'heal': {
        const target = [...this.heroes].sort((x, y) => x.pv / this.heroStats(x).pvMax - y.pv / this.heroStats(y).pvMax)[0];
        target.pv = Math.min(this.heroStats(target).pvMax, target.pv + skill.amount);
        this.addLog(`${skill.name} : ${HEROES[target.heroId].name} récupère ${skill.amount} PV.`);
        break;
      }
      case 'shield':
        this.encounter.shield += skill.amount;
        break;
      case 'notime':
        this.encounter.noTime = true;
        break;
      default:
        throw new GameError('Effet inconnu.');
    }
    this.skillUses.add(key);
    this.emit('skill', { owner: playerId, skillId, dieId: die?.id ?? null });
    this.addLog(`${HEROES[hero.heroId].name} utilise ${skill.name}.`);
  }

  setReady(playerId, ready) {
    this.assertPhase('dice');
    const hero = this.hero(playerId);
    if (!hero || hero.pv <= 0) return;
    if (ready) this.readySet.add(playerId);
    else this.readySet.delete(playerId);
    const alive = this.heroes.filter((h) => h.pv > 0);
    if (alive.every((h) => this.readySet.has(h.playerId))) this.resolve();
  }

  /** Couverture actuelle de chaque case : { boxId: { total, covered } }. */
  coverage() {
    const out = {};
    for (const box of this.encounter.boxes) {
      const dice = this.dice.filter((d) => d.box === box.id);
      const total = dice.reduce((n, d) => n + d.value, 0);
      out[box.id] = { total, covered: dice.length > 0 && total >= box.target && (box.mode === 'sum' || dice.length === 1) };
    }
    return out;
  }

  // ================================================================ résolution

  resolve() {
    this.assertPhase('dice');
    const enc = this.encounter;
    const cov = this.coverage();
    let damage = 0;
    let time = 0;
    let hits = 0;
    const results = enc.boxes.map((box) => {
      const covered = cov[box.id].covered;
      if (covered) hits += box.hit;
      else {
        damage += box.penalty.damage;
        time += box.penalty.time;
      }
      return { boxId: box.id, covered };
    });
    if (enc.noTime) time = 0;
    damage = Math.max(0, damage - enc.shield);

    const taken = this.distributeDamage(damage);
    if (enc.ability?.type === 'aoe') {
      for (const h of this.heroes) {
        if (h.pv <= 0) continue;
        h.pv = Math.max(0, h.pv - enc.ability.amount);
        taken[h.playerId] = (taken[h.playerId] ?? 0) + enc.ability.amount;
      }
    }
    this.torch = Math.max(0, this.torch - time);
    if (hits && enc.bossPv !== undefined) enc.bossPv = Math.max(0, enc.bossPv - hits);

    this.lastResolution = { name: enc.name, kind: enc.kind, round: enc.round, results, damage, taken, time, hits, bossPv: enc.bossPv };
    this.emit('resolve', { results, taken, time, hits, bossPv: enc.bossPv });
    this.addLog(
      `${enc.name} : ${results.filter((r) => r.covered).length}/${results.length} cases réussies` +
        (damage ? `, ${damage} dégât(s)` : '') + (time ? `, −${time} torche` : '') + (hits ? `, ${hits} coup(s) portés` : '') + '.',
    );
    this.dice = null;

    if (this.heroes.every((h) => h.pv <= 0)) {
      this.phase = 'defeat';
      this.encounter = null;
      this.emit('defeat', {});
      this.addLog('Tous les héros sont tombés…');
      return;
    }

    if (enc.kind === 'boss' || enc.kind === 'guardian') {
      if (enc.bossPv > 0) {
        enc.round += 1;
        enc.boxes = this.bossBoxes(enc.def, enc.bossPv, enc.bossPvMax);
        this.rollAll();
        return;
      }
      this.stats.guardians += 1;
      this.emit('bossDefeated', { name: enc.name, kind: enc.kind });
      if (enc.kind === 'boss') {
        this.phase = 'victory';
        this.encounter = null;
        this.addLog(`${enc.name} est vaincu. VICTOIRE !`);
        return;
      }
      this.addLog(`${enc.name} est vaincu !`);
      this.gainXp(enc.def.xp);
      this.offerReward({ xp: 0, loots: [this.randomLoot(), this.randomLoot()], guardian: true });
      return;
    }

    this.stats.rooms += 1;
    this.offerReward({ xp: enc.room.xp, loots: [enc.room.loot] });
  }

  /** Les dégâts frappent un par un le héros le plus en forme ; l'armure réduit ce que chacun prend. */
  distributeDamage(amount) {
    const alloc = {};
    const alive = () => this.heroes.filter((h) => h.pv - (alloc[h.playerId] ?? 0) > 0);
    for (let i = 0; i < amount; i++) {
      const pool = alive();
      if (!pool.length) break;
      const target = pool.reduce((best, h) =>
        h.pv - (alloc[h.playerId] ?? 0) > best.pv - (alloc[best.playerId] ?? 0) ? h : best);
      alloc[target.playerId] = (alloc[target.playerId] ?? 0) + 1;
    }
    const taken = {};
    for (const h of this.heroes) {
      const raw = alloc[h.playerId] ?? 0;
      const dmg = Math.max(0, raw - this.heroStats(h).armor);
      if (!dmg) continue;
      h.pv = Math.max(0, h.pv - dmg);
      taken[h.playerId] = dmg;
      if (h.pv === 0) this.addLog(`${HEROES[h.heroId].name} (${h.playerName}) est à terre !`);
    }
    return taken;
  }

  // ================================================================ récompenses et progression

  randomLoot() {
    const items = Object.keys(ITEMS).map((id) => ({ type: 'item', id }));
    const skills = Object.keys(SKILLS).map((id) => ({ type: 'skill', id }));
    const pool = [...items, ...items, ...skills];
    return pool[Math.floor(this.rng() * pool.length)];
  }

  offerReward({ xp, loots, guardian = false }) {
    this.rewardOffer = {
      xp,
      guardian,
      loots: loots.map((l) => ({ ...l, ...(l.type === 'item' ? ITEMS[l.id] : SKILLS[l.id]) })),
    };
    this.encounter = null;
    this.phase = 'reward';
  }

  /** choice : 'xp', 'skip' ou un index de butin ; heroOf : joueur dont le héros reçoit le butin. */
  takeReward(choice, heroOf) {
    this.assertPhase('reward');
    const offer = this.rewardOffer;
    if (choice === 'skip') {
      this.addLog('Le groupe laisse la récompense.');
    } else if (choice === 'xp') {
      if (!offer.xp) throw new GameError('Pas d’expérience à prendre ici.');
      this.gainXp(offer.xp);
    } else {
      const loot = offer.loots[Number(choice)];
      if (!loot) throw new GameError('Récompense inconnue.');
      const hero = this.hero(heroOf);
      if (!hero) throw new GameError('Choisissez le héros qui reçoit la récompense.');
      if (loot.type === 'skill') {
        if (hero.skills.includes(loot.id)) throw new GameError('Ce héros connaît déjà cette compétence.');
        hero.skills.push(loot.id);
      } else {
        const before = this.heroStats(hero).pvMax;
        hero.items.push(loot.id);
        hero.pv += this.heroStats(hero).pvMax - before; // les PV bonus arrivent pleins
      }
      this.addLog(`${HEROES[hero.heroId].name} (${hero.playerName}) obtient ${loot.name}.`);
      this.emit('loot', { heroOf, name: loot.name });
    }
    this.rewardOffer = null;
    if (offer.guardian) {
      this.phase = 'camp';
      for (const h of this.heroes) h.pv = Math.min(this.heroStats(h).pvMax, Math.max(h.pv, 0) + CAMP_HEAL);
      this.addLog(`Le groupe se repose avant de descendre (+${CAMP_HEAL} PV, les héros à terre se relèvent).`);
      return;
    }
    this.phase = 'explore';
  }

  gainXp(amount) {
    this.xp += amount;
    while (this.level < XP_LEVELS.length && this.xp >= XP_LEVELS[this.level]) {
      this.level += 1;
      for (const h of this.heroes) h.pv = Math.min(this.heroStats(h).pvMax, h.pv + 2);
      this.emit('levelUp', { level: this.level });
      this.addLog(`Niveau ${this.level} ! Chaque héros gagne 1 dé d’or et 2 PV max.`);
    }
  }

  nextFloor() {
    this.assertPhase('camp');
    this.floor += 1;
    this.startFloor();
  }

  // ================================================================ héros

  hero(playerId) {
    return this.heroes.find((h) => h.playerId === playerId);
  }

  heroStats(h) {
    const st = { ...h.base, gold: this.level - 1, armor: 0, torch: 0, pvMax: h.basePv + 2 * (this.level - 1) };
    for (const id of h.items) {
      const b = ITEMS[id].bonus;
      for (const k of ['F', 'A', 'M', 'gold', 'armor', 'torch']) st[k] += b[k] ?? 0;
      st.pvMax += b.pv ?? 0;
    }
    return st;
  }

  publicHero(h) {
    const st = this.heroStats(h);
    return {
      playerId: h.playerId,
      playerName: h.playerName,
      heroId: h.heroId,
      name: HEROES[h.heroId].name,
      icon: HEROES[h.heroId].icon,
      pv: h.pv,
      pvMax: st.pvMax,
      stats: { F: st.F, A: st.A, M: st.M, gold: st.gold, armor: st.armor },
      skills: h.skills.map((id) => ({ id, ...SKILLS[id], used: this.skillUses?.has(`${h.playerId}:${id}`) ?? false })),
      items: h.items.map((id) => ({ id, ...ITEMS[id] })),
    };
  }

  preview(room) {
    if (room.kind === 'peril') return { kind: 'peril', name: room.name, options: room.options.map((o) => o.label), loot: room.loot };
    return { kind: 'monster', name: room.name, xp: room.xp, boxes: scaleBoxes(room.boxes, this.heroes.length, this.floor), loot: room.loot };
  }

  // ================================================================ utilitaires

  d6() {
    return 1 + Math.floor(this.rng() * 6);
  }

  shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  assertPhase(phase) {
    if (this.phase !== phase) throw new GameError('Ce n’est pas le moment.');
  }

  emit(type, data) {
    this.events.push({ id: ++this.eventSeq, type, ...data });
    if (this.events.length > EVENT_SIZE) this.events.shift();
  }

  addLog(text) {
    this.log.push({ text });
    if (this.log.length > LOG_SIZE) this.log.shift();
  }
}

module.exports = { Profondeurs, GameError, scaleBoxes, FLOORS, XP_LEVELS, BALANCE };
