export const MAP_W = 14;
export const MAP_H = 11;
export const HEX_SIZE = 1;
export const MAX_HP = 10;
export const MAX_POP = 5;
export const START_STARS = 5;
export const BASE_CITY_POP = 1;

export const NAMES = { player_1: 'Spieler 1', player_2: 'Spieler 2' };
export const COLORS = { player_1: 0x2563eb, player_2: 0xdc2626, neutral: 0xa1a1aa };

export const TRIBES = {
  imperius: { id: 'imperius', name: 'Imperius', code: 'IMP', tech: 'organisation', biome: 'plains', color: 0x2563eb, desc: 'Ausgewogen mit schnellem Städtewachstum.' },
  bardur: { id: 'bardur', name: 'Bardur', code: 'BAR', tech: 'jagd', biome: 'forest', color: 0x475569, desc: 'Startet in dichten Nadelwäldern.' },
  oumaji: { id: 'oumaji', name: 'Oumaji', code: 'OUM', tech: 'reitkunst', biome: 'plains', color: 0xd97706, desc: 'Schnelle Reiterei in weiten Ebenen.' },
  kickoo: { id: 'kickoo', name: 'Kickoo', code: 'KCK', tech: 'fischerei', biome: 'water', color: 0x0d9488, desc: 'Seefahrervolk mit reicher Küste.' },
  xin_xi: { id: 'xin_xi', name: 'Xin-Xi', code: 'XIN', tech: 'klettern', biome: 'mountain', color: 0xdc2626, desc: 'Bergvolk mit hoher Sichtweite.' }
};

export const TERRAIN = {
  plains: { name: 'Ebene', color: 0x74c043, height: 0.5, walkable: true, move: 1, def: 0 },
  forest: { name: 'Wald', color: 0x4c9a2a, height: 0.5, walkable: true, move: 2, def: 1 },
  mountain: { name: 'Berg', color: 0x9b9b94, height: 1.15, walkable: false, move: 99, def: 2 },
  water: { name: 'Wasser', color: 0x3fa7e0, height: 0.3, walkable: false, move: 99, def: 0 },
  ocean: { name: 'Ozean', color: 0x2b73b5, height: 0.2, walkable: false, move: 99, def: 0 }
};

export const UNITS = {
  warrior: { name: 'Krieger', code: 'KRG', cost: 2, atk: 2, def: 2, move: 2, range: 1, maxHp: 10, tech: null, skill: null },
  rider: { name: 'Reiter', code: 'RTR', cost: 3, atk: 2, def: 1, move: 3, range: 1, maxHp: 10, tech: 'reitkunst', skill: 'escape' },
  archer: { name: 'Schütze', code: 'SCH', cost: 3, atk: 2, def: 1, move: 2, range: 2, maxHp: 10, tech: 'bogenschiessen', skill: null },
  defender: { name: 'Verteidiger', code: 'VTD', cost: 3, atk: 1, def: 3, move: 1, range: 1, maxHp: 15, tech: 'schildmacher', skill: 'fortify' },
  swordsman: { name: 'Schwertkämpfer', code: 'SWK', cost: 5, atk: 3, def: 3, move: 2, range: 1, maxHp: 15, tech: 'schmiedekunst', skill: null },
  catapult: { name: 'Katapult', code: 'KAT', cost: 8, atk: 4, def: 1, move: 1, range: 3, maxHp: 10, tech: 'mathematik', skill: null },
  mindbender: { name: 'Gedankenbeuger', code: 'GDB', cost: 5, atk: 0, def: 1, move: 1, range: 1, maxHp: 10, tech: 'philosophie', skill: 'convert' }
};

export const TECHS = {
  // Tier 1
  organisation: { name: 'Organisation', tier: 1, baseCost: 5, req: null, desc: '+1 Stern pro Stadt/Runde' },
  jagd: { name: 'Jagd', tier: 1, baseCost: 5, req: null, desc: 'Ermöglicht Jagd in Wäldern' },
  fischerei: { name: 'Fischerei', tier: 1, baseCost: 5, req: null, desc: 'Ermöglicht Fischen auf Wasserfeldern' },
  klettern: { name: 'Klettern', tier: 1, baseCost: 5, req: null, desc: 'Einheiten können Berge betreten' },
  reitkunst: { name: 'Reitkunst', tier: 1, baseCost: 5, req: null, desc: 'Reiter freischalten' },

  // Tier 2
  bogenschiessen: { name: 'Bogenschießen', tier: 2, baseCost: 7, req: 'jagd', desc: 'Schützen freischalten' },
  forstwirtschaft: { name: 'Forstwirtschaft', tier: 2, baseCost: 7, req: 'jagd', desc: 'Hütten in Wäldern bauen' },
  segeln: { name: 'Segeln', tier: 2, baseCost: 7, req: 'fischerei', desc: 'Häfen bauen & Boote nutzen' },
  bergbau: { name: 'Bergbau', tier: 2, baseCost: 7, req: 'klettern', desc: 'Minen auf Bergen bauen' },
  schildmacher: { name: 'Schildmacher', tier: 2, baseCost: 7, req: 'organisation', desc: 'Verteidiger freischalten' },
  strassen: { name: 'Straßenbau', tier: 2, baseCost: 7, req: 'reitkunst', desc: 'Verbindet Städte für Ertrag' },

  // Tier 3
  schmiedekunst: { name: 'Schmiedekunst', tier: 3, baseCost: 11, req: 'bergbau', desc: 'Schwertkämpfer freischalten' },
  mathematik: { name: 'Mathematik', tier: 3, baseCost: 11, req: 'forstwirtschaft', desc: 'Katapulte freischalten' },
  philosophie: { name: 'Philosophie', tier: 3, baseCost: 11, req: 'organisation', desc: 'Gedankenbeuger & 20% Tech-Rabatt' },
  diplomatie: { name: 'Diplomatie', tier: 3, baseCost: 11, req: 'schildmacher', desc: 'Botschaften & Bündnisse' }
};

export const TECH_TIERS = [
  ['organisation', 'jagd', 'fischerei', 'klettern', 'reitkunst'],
  ['bogenschiessen', 'forstwirtschaft', 'segeln', 'bergbau', 'schildmacher', 'strassen'],
  ['schmiedekunst', 'mathematik', 'philosophie', 'diplomatie']
];

export const UNIT_ORDER = ['warrior', 'rider', 'archer', 'defender', 'swordsman', 'catapult', 'mindbender'];
