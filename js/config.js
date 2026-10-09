export const MAP_W = 14;
export const MAP_H = 11;
export const HEX_SIZE = 1;
export const MAX_HP = 10;
export const MAX_POP = 5;
export const START_STARS = 5;
export const BASE_CITY_POP = 1;

export const NAMES = { player_1: 'Blau', player_2: 'Rot' };
export const COLORS = { player_1: 0x2563eb, player_2: 0xdc2626, neutral: 0xa1a1aa };

export const TERRAIN = {
  plains: { name: 'Ebene', color: 0x74c043, height: 0.5, walkable: true, move: 1, def: 0 },
  forest: { name: 'Wald', color: 0x4c9a2a, height: 0.5, walkable: true, move: 2, def: 1 },
  mountain: { name: 'Berg', color: 0x9b9b94, height: 1.15, walkable: false, move: 99, def: 2 },
  water: { name: 'Wasser', color: 0x3fa7e0, height: 0.3, walkable: false, move: 99, def: 0 },
  ocean: { name: 'Ozean', color: 0x2b73b5, height: 0.2, walkable: false, move: 99, def: 0 }
};

export const UNITS = {
  warrior: { name: 'Krieger', cost: 2, atk: 2, def: 2, move: 2, range: 1, maxHp: 10, tech: null, skill: null },
  rider: { name: 'Reiter', cost: 3, atk: 2, def: 1, move: 3, range: 1, maxHp: 10, tech: 'reitkunst', skill: 'escape' },
  archer: { name: 'Schütze', cost: 3, atk: 2, def: 1, move: 2, range: 2, maxHp: 10, tech: 'jagd', skill: null },
  defender: { name: 'Verteidiger', cost: 3, atk: 1, def: 3, move: 1, range: 1, maxHp: 15, tech: 'bergbau', skill: 'fortify' },
  swordsman: { name: 'Schwertkämpfer', cost: 5, atk: 3, def: 3, move: 2, range: 1, maxHp: 15, tech: 'handwerk', skill: null },
  catapult: { name: 'Katapult', cost: 8, atk: 4, def: 1, move: 1, range: 3, maxHp: 10, tech: 'mathematik', skill: null },
  giant: { name: 'Riese', cost: 0, atk: 5, def: 4, move: 2, range: 1, maxHp: 20, tech: null, skill: 'super' }
};

export const TECHS = {
  jagd: { name: 'Jagd', tier: 1, baseCost: 5, req: null, desc: 'Schütze freischalten' },
  ackerbau: { name: 'Ackerbau', tier: 1, baseCost: 5, req: null, desc: '+1 Stern pro Stadt/Runde' },
  strassen: { name: 'Straßenbau', tier: 1, baseCost: 5, req: null, desc: 'Erhöht Truppen-Bewegung' },
  reitkunst: { name: 'Reitkunst', tier: 2, baseCost: 7, req: 'jagd', desc: 'Reiter mit Rückzugs-Fähigkeit' },
  bergbau: { name: 'Bergbau', tier: 2, baseCost: 7, req: 'ackerbau', desc: 'Verteidiger freischalten' },
  handwerk: { name: 'Handwerk', tier: 3, baseCost: 11, req: 'bergbau', desc: 'Schwertkämpfer freischalten' },
  mathematik: { name: 'Mathematik', tier: 4, baseCost: 14, req: 'handwerk', desc: 'Katapulte freischalten' }
};

export const TECH_TIERS = [
  ['jagd', 'ackerbau', 'strassen'],
  ['reitkunst', 'bergbau'],
  ['handwerk'],
  ['mathematik']
];

export const UNIT_ORDER = ['warrior', 'rider', 'archer', 'defender', 'swordsman', 'catapult'];
