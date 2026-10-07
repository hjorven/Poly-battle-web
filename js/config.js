export const MAP_W = 14;
export const MAP_H = 11;
export const HEX_SIZE = 1;
export const MAX_HP = 10;
export const MAX_POP = 5;
export const START_STARS = 3;
export const BASE_CITY_POP = 2;

export const NAMES = { player_1: 'Blau', player_2: 'Rot' };
export const COLORS = { player_1: 0x2563eb, player_2: 0xdc2626, neutral: 0xa1a1aa };

export const TERRAIN = {
  plains: { name: 'Ebene', color: 0x74c043, height: 0.5, walkable: true, move: 1, def: 0 },
  forest: { name: 'Wald', color: 0x4c9a2a, height: 0.5, walkable: true, move: 2, def: 2 },
  mountain: { name: 'Berg', color: 0x9b9b94, height: 1.15, walkable: false, move: 99, def: 4 },
  water: { name: 'Wasser', color: 0x3fa7e0, height: 0.3, walkable: false, move: 99, def: 0 }
};

export const UNITS = {
  warrior: { name: 'Krieger', cost: 2, atk: 2, def: 2, move: 2, range: 1, tech: null },
  archer: { name: 'Schütze', cost: 3, atk: 2, def: 1, move: 2, range: 2, tech: 'jagd' },
  rider: { name: 'Reiter', cost: 3, atk: 2, def: 1, move: 3, range: 1, tech: 'reitkunst' },
  defender: { name: 'Verteidiger', cost: 3, atk: 1, def: 4, move: 1, range: 1, tech: 'bergbau' },
  swordsman: { name: 'Schwertkämpfer', cost: 5, atk: 4, def: 3, move: 2, range: 1, tech: 'handwerk' },
  catapult: { name: 'Katapult', cost: 5, atk: 4, def: 1, move: 1, range: 2, tech: 'mathematik' }
};

export const TECHS = {
  jagd: { name: 'Jagd', cost: 5, req: null, desc: 'Schütze freischalten' },
  ackerbau: { name: 'Ackerbau', cost: 5, req: null, desc: '+1 Stern pro Stadt und Runde' },
  reitkunst: { name: 'Reitkunst', cost: 8, req: 'jagd', desc: 'Reiter freischalten' },
  bergbau: { name: 'Bergbau', cost: 8, req: 'ackerbau', desc: 'Verteidiger freischalten' },
  handwerk: { name: 'Handwerk', cost: 12, req: 'bergbau', desc: 'Schwertkämpfer freischalten' },
  mathematik: { name: 'Mathematik', cost: 15, req: 'handwerk', desc: 'Katapult freischalten' }
};

export const TECH_TIERS = [
  ['jagd', 'ackerbau'],
  ['reitkunst', 'bergbau'],
  ['handwerk'],
  ['mathematik']
];

export const UNIT_ORDER = ['warrior', 'archer', 'rider', 'defender', 'swordsman', 'catapult'];
