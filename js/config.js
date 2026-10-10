export const MAP_W = 20;
export const MAP_H = 14;
export const HEX_SIZE = 1;
export const MAX_HP = 10;
export const MAX_POP = 5;
export const START_STARS = 3;
export const BASE_CITY_POP = 2;
export const VISION = { unit: 1, city: 2 };

export const NAMES = {
  player_1: 'Blau',
  player_2: 'Rot',
  player_3: 'Orange',
  player_4: 'Türkis'
};
export const COLORS = {
  player_1: 0x2563eb,
  player_2: 0xdc2626,
  player_3: 0xd97706,
  player_4: 0x0d9488,
  neutral: 0xa1a1aa
};

export const TERRAIN = {
  plains: { name: 'Ebene', color: 0x74c043, height: 0.5, walkable: true, move: 1, def: 0 },
  forest: { name: 'Wald', color: 0x4c9a2a, height: 0.5, walkable: true, move: 2, def: 2 },
  mountain: { name: 'Berg', color: 0x9b9b94, height: 1.15, walkable: false, move: 2, def: 4 },
  water: { name: 'Wasser', color: 0x3fa7e0, height: 0.3, walkable: false, move: 99, def: 0 }
};

export const UNITS = {
  warrior: { name: 'Krieger', cost: 2, atk: 2, def: 2, move: 2, range: 1, sight: 1, tech: null },
  archer: { name: 'Schütze', cost: 3, atk: 2, def: 1, move: 2, range: 2, sight: 2, tech: 'bogenschiessen' },
  rider: { name: 'Reiter', cost: 3, atk: 2, def: 1, move: 3, range: 1, sight: 1, tech: 'reiten' },
  defender: { name: 'Verteidiger', cost: 3, atk: 1, def: 4, move: 1, range: 1, sight: 1, tech: 'schildmacher' },
  swordsman: { name: 'Schwertkämpfer', cost: 5, atk: 4, def: 3, move: 2, range: 1, sight: 1, tech: 'schmiedekunst' },
  catapult: { name: 'Katapult', cost: 5, atk: 4, def: 1, move: 1, range: 3, sight: 2, tech: 'mathematik' },
  mind_bender: { name: 'Gedankenbeuger', cost: 5, atk: 1, def: 2, move: 1, range: 1, sight: 1, tech: 'philosophie', heal: 2 }
};

export const TECHS = {
  organisation: { name: 'Organisation', tier: 1, req: null, desc: '+1 Stern pro Stadt und Runde' },
  jagd: { name: 'Jagd', tier: 1, req: null, desc: 'Zweig: Forstwirtschaft, Bogenschießen' },
  klettern: { name: 'Klettern', tier: 1, req: null, desc: 'Einheiten können Berge betreten' },
  reiten: { name: 'Reiten', tier: 1, req: null, desc: 'Reiter ausbilden' },
  fischerei: { name: 'Fischerei', tier: 1, req: null, desc: 'Zweig: Segeln' },

  landwirtschaft: { name: 'Landwirtschaft', tier: 2, req: 'organisation', desc: '+1 Stern pro Stadt und Runde' },
  schildmacher: { name: 'Schildmacher', tier: 2, req: 'organisation', desc: 'Verteidiger ausbilden' },
  forstwirtschaft: { name: 'Forstwirtschaft', tier: 2, req: 'jagd', desc: 'Zweig: Mathematik' },
  bogenschiessen: { name: 'Bogenschießen', tier: 2, req: 'jagd', desc: 'Schützen ausbilden' },
  bergbau: { name: 'Bergbau', tier: 2, req: 'klettern', desc: 'Zweig: Schmiedekunst' },
  medaillen: { name: 'Freie Hände', tier: 2, req: 'klettern', desc: 'Ruinen erforschen' },
  roesser: { name: 'Wege', tier: 2, req: 'reiten', desc: '+1 Bewegung für alle Einheiten' },
  segeln: { name: 'Segeln', tier: 2, req: 'fischerei', desc: 'Zweig: Navigation' },

  philosophie: { name: 'Philosophie', tier: 3, req: 'landwirtschaft', desc: 'Forschungskosten -20 %, Gedankenbeuger' },
  diplomatie: { name: 'Diplomatie', tier: 3, req: 'schildmacher', desc: 'Botschaften und Bündnisse' },
  mathematik: { name: 'Mathematik', tier: 3, req: 'forstwirtschaft', desc: 'Katapult ausbilden' },
  schmiedekunst: { name: 'Schmiedekunst', tier: 3, req: 'bergbau', desc: 'Schwertkämpfer ausbilden' },
  navigation: { name: 'Navigation', tier: 3, req: 'segeln', desc: 'Kriegsschiffe ausbilden' }
};

export const TECH_TIERS = [
  ['organisation', 'jagd', 'klettern', 'reiten', 'fischerei'],
  ['landwirtschaft', 'schildmacher', 'forstwirtschaft', 'bogenschiessen', 'bergbau', 'medaillen', 'roesser', 'segeln'],
  ['philosophie', 'diplomatie', 'mathematik', 'schmiedekunst', 'navigation']
];

export const UNIT_ORDER = ['warrior', 'archer', 'rider', 'defender', 'swordsman', 'catapult', 'mind_bender'];

export const TRIBES = {
  imperius: { name: 'Imperius', startTechs: ['organisation'] },
  bardur: { name: 'Bardur', startTechs: ['jagd'] },
  xinxi: { name: 'Xin-Xi', startTechs: ['klettern'] },
  kickoo: { name: 'Kickoo', startTechs: ['fischerei'] },
  oumaji: { name: 'Oumaji', startTechs: ['reiten'] }
};

export const TRIBE_POOL = Object.keys(TRIBES);

export function researchCost(tier, cityCount, hasPhilosophy = false) {
  let cost = tier * (1 + cityCount);
  if (hasPhilosophy) cost = Math.ceil(cost * 0.8);
  return cost;
}