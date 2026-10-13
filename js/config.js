// Datenmodell orientiert an den echten Polytopia-Spieldaten
// (GameLogicData28.txt) – Werte in Anzeigeeinheiten (Rohwert / 10).

export const MAP_W = 26;
export const MAP_H = 18;
export const HEX_SIZE = 1;

export const MAX_POP = 5;
export const START_STARS = 5;
export const BASE_CITY_POP = 1;
export const STARS_OPTIONS = {
  knapp: { label: 'Knapp', stars: 2 },
  normal: { label: 'Normal', stars: 5 },
  reich: { label: 'Reich', stars: 10 }
};
export const VISION = { unit: 1, city: 2 };

// Kampfformel-Konstante (siehe BattleHelpers / Wiki).
export const ACCELERATOR = 4.5;
export const DEF_BONUS = { none: 1, standard: 1.5, wall: 4 };

export const NAMES = {
  player_1: 'Spieler 1',
  player_2: 'Spieler 2',
  player_3: 'Spieler 3',
  player_4: 'Spieler 4',
  player_5: 'Spieler 5'
};

// Fallback-Farben, falls kein Stamm zugeordnet ist.
export const COLORS = {
  player_1: 0x2563eb,
  player_2: 0xdc2626,
  player_3: 0xd97706,
  player_4: 0x0d9488,
  player_5: 0x7c3aed,
  neutral: 0xa1a1aa
};

// Echter Terrain-Satz. `move` = Pfadkosten, `def` = Verteidigungsbonus,
// `tech` = Technologie, die den Bonus freischaltet,
// `enterTech` = Technologie, die das Betreten erlaubt.
export const TERRAIN = {
  field: { name: 'Feld', color: 0x7dc242, height: 0.5, walkable: true, move: 1, def: 1, tech: null, enterTech: null },
  forest: { name: 'Wald', color: 0x3f8a2e, height: 0.5, walkable: true, move: 2, def: 1.5, tech: 'archery', enterTech: null },
  mountain: { name: 'Berg', color: 0x9b9b94, height: 1.15, walkable: true, move: 2, def: 1.5, tech: 'climbing', enterTech: 'climbing' },
  water: { name: 'Flachwasser', color: 0x3fa7e0, height: 0.24, walkable: false, move: 2, def: 1.5, tech: 'aquatism', enterTech: null },
  ocean: { name: 'Ozean', color: 0x2b6fbd, height: 0.18, walkable: false, move: 2, def: 1.5, tech: 'aquatism', enterTech: null },
  ice: { name: 'Eis', color: 0xd8eef7, height: 0.45, walkable: true, move: 1, def: 1, tech: null, enterTech: null }
};

// Fähigkeiten (abilities) je Einheit – Namen wie in den Spieldaten.
export const ABILITY_INFO = {
  dash: { name: 'Sturm', desc: 'Kann nach dem Ziehen angreifen.' },
  fortify: { name: 'Verschanzen', desc: 'Heilt, wenn sie nichts tut; erhält Stadt-Verteidigungsbonus.' },
  escape: { name: 'Rückzug', desc: 'Kann nach dem Angriff weiterziehen.' },
  persist: { name: 'Durchhalten', desc: 'Kann nach dem Angriff weiterziehen.' },
  stiff: { name: 'Starr', desc: 'Kann nicht nach dem Ziehen angreifen und nicht zurückschlagen.' },
  static: { name: 'Statisch', desc: 'Keine besonderen Fähigkeiten.' },
  heal: { name: 'Heilen', desc: 'Heilt benachbarte Verbündete zu Rundenbeginn um 4.' },
  convert: { name: 'Bekehren', desc: 'Übernimmt eine benachbarte feindliche Einheit.' },
  land: { name: 'Land', desc: 'Kann auf Land stehen.' },
  water: { name: 'Wasser', desc: 'Kann sich ausschließlich auf Wasser und Ozean bewegen.' },
  settle: { name: 'Siedeln', desc: 'Gründet auf einem freien Feld eine neue Stadt (mind. 2 Felder von anderen Städten entfernt).' },
  scout: { name: 'Spähen', desc: 'Greift nicht an, betritt Berge ohne Klettern und sieht von Bergen 1 Feld weiter.' }
};

export function hasAbility(type, name) {
  return (UNITS[type].abilities || []).includes(name);
}

// Echte Einheiten. hp/atk/def/move/range/cost in Anzeigeeinheiten.
export const UNITS = {
  warrior: {
    name: 'Krieger', icon: '⚔️', hp: 10, atk: 2, def: 2, move: 1, range: 1, cost: 2, sight: 1,
    tech: null, abilities: ['dash', 'fortify', 'land']
  },
  archer: {
    name: 'Bogenschütze', icon: '🏹', hp: 10, atk: 2, def: 1, move: 1, range: 2, cost: 3, sight: 2,
    tech: 'archery', abilities: ['dash', 'fortify', 'land']
  },
  rider: {
    name: 'Reiter', icon: '🐎', hp: 10, atk: 2, def: 1, move: 2, range: 1, cost: 3, sight: 1,
    tech: 'riding', abilities: ['dash', 'escape', 'fortify', 'land']
  },
  defender: {
    name: 'Verteidiger', icon: '🛡️', hp: 15, atk: 1, def: 3, move: 1, range: 1, cost: 3, sight: 1,
    tech: 'shields', abilities: ['fortify', 'land']
  },
  swordsman: {
    name: 'Schwertkämpfer', icon: '🗡️', hp: 15, atk: 3, def: 3, move: 1, range: 1, cost: 5, sight: 1,
    tech: 'smithery', abilities: ['dash', 'land']
  },
  catapult: {
    name: 'Katapult', icon: '💣', hp: 10, atk: 4, def: 0, move: 1, range: 3, cost: 8, sight: 2,
    tech: 'mathematics', abilities: ['stiff', 'land']
  },
  mindbender: {
    name: 'Gedankenbeuger', icon: '🔮', hp: 10, atk: 0, def: 1, move: 1, range: 1, cost: 5, sight: 1,
    tech: 'philosophy', abilities: ['heal', 'convert', 'stiff', 'land']
  },
  knight: {
    name: 'Ritter', icon: '⚜️', hp: 10, atk: 3.5, def: 1, move: 3, range: 1, cost: 8, sight: 1,
    tech: 'chivalry', abilities: ['dash', 'persist', 'fortify', 'land']
  },
  giant: {
    name: 'Riese', icon: '🗿', hp: 40, atk: 5, def: 4, move: 1, range: 1, cost: 10, sight: 1,
    tech: null, abilities: ['static', 'land'], reward: true
  },
  boat: {
    name: 'Boot', icon: '🛶', hp: 10, atk: 2, def: 0, move: 2, range: 1, cost: 3, sight: 2,
    tech: 'sailing', abilities: ['dash', 'fortify', 'water']
  },
  ship: {
    name: 'Schiff', icon: '⛵', hp: 14, atk: 3, def: 1, move: 2, range: 1, cost: 5, sight: 2,
    tech: 'sailing', abilities: ['dash', 'fortify', 'water']
  },
  battleship: {
    name: 'Kriegsschiff', icon: '🚤', hp: 18, atk: 4, def: 2, move: 3, range: 1, cost: 8, sight: 2,
    tech: 'navigation', abilities: ['dash', 'fortify', 'water']
  },
  spy: {
    name: 'Spion', icon: '🕵️', hp: 6, atk: 0, def: 1, move: 2, range: 1, cost: 4, sight: 2,
    tech: null, abilities: ['scout', 'land']
  },
  settler: {
    name: 'Siedler', icon: '🧑‍🌾', hp: 10, atk: 0, def: 0, move: 1, range: 1, cost: 5, sight: 1,
    tech: null, abilities: ['static', 'land', 'settle'], capital: true
  }
};

export const UNIT_ORDER = [
  'warrior', 'archer', 'rider', 'defender', 'swordsman',
  'catapult', 'mindbender', 'knight', 'giant',
  'boat', 'ship', 'battleship', 'spy', 'settler'
];

// Echter Technologiebaum (Basis-Äste; `req` = Voraussetzung, `tier` = Stufe/Kosten).
export const TECHS = {
  organization: { name: 'Organisation', icon: '🏛️', tier: 1, req: null, desc: 'Zweig: Landwirtschaft, Schildmacher' },
  climbing: { name: 'Klettern', icon: '⛰️', tier: 1, req: null, desc: 'Einheiten können Berge betreten' },
  fishing: { name: 'Fischerei', icon: '🎣', tier: 1, req: null, desc: 'Zweig: Segeln, Rammen' },
  hunting: { name: 'Jagd', icon: '🦌', tier: 1, req: null, desc: 'Zweig: Bogenschießen, Forstwirtschaft' },
  riding: { name: 'Reiten', icon: '🐎', tier: 1, req: null, desc: 'Zweig: Wege, Freier Geist' },

  farming: { name: 'Landwirtschaft', icon: '🌾', tier: 2, req: 'organization', desc: 'Farmen bauen (+1 Einkommen)' },
  shields: { name: 'Schildmacher', icon: '🛡️', tier: 2, req: 'organization', desc: 'Verteidiger ausbilden' },
  mining: { name: 'Bergbau', icon: '⛏️', tier: 2, req: 'climbing', desc: 'Minerven bauen (+1 Einkommen)' },
  meditation: { name: 'Meditation', icon: '🧘', tier: 2, req: 'climbing', desc: 'Tempel bauen' },
  sailing: { name: 'Segeln', icon: '⛵', tier: 2, req: 'fishing', desc: 'Boote & Schiffe; Häfen; +1 Sicht' },
  ramming: { name: 'Rammen', icon: '🛳️', tier: 2, req: 'fishing', desc: 'Zweig: Aquatismus' },
  archery: { name: 'Bogenschießen', icon: '🎯', tier: 2, req: 'hunting', desc: 'Bogenschützen; Wald-Verteidigung' },
  forestry: { name: 'Forstwirtschaft', icon: '🌲', tier: 2, req: 'hunting', desc: 'Sägewerke bauen (+1 Einkommen)' },
  roads: { name: 'Wege', icon: '🛣️', tier: 2, req: 'riding', desc: '+1 Bewegung für alle Einheiten; Brücken bauen' },
  freespirit: { name: 'Freier Geist', icon: '🕊️', tier: 2, req: 'riding', desc: 'Zweig: Ritterlichkeit' },

  construction: { name: 'Baukunst', icon: '🏗️', tier: 3, req: 'farming', desc: '+1 Stern pro Stadt' },
  diplomacy: { name: 'Diplomatie', icon: '🤝', tier: 3, req: 'shields', desc: 'Botschaften und Bündnisse' },
  smithery: { name: 'Schmiedekunst', icon: '⚒️', tier: 3, req: 'mining', desc: 'Schwertkämpfer ausbilden' },
  philosophy: { name: 'Philosophie', icon: '📜', tier: 3, req: 'meditation', desc: 'Gedankenbeuger; Forschung -20 %' },
  navigation: { name: 'Navigation', icon: '🧭', tier: 3, req: 'sailing', desc: 'Kriegsschiffe ausbilden' },
  aquatism: { name: 'Aquatismus', icon: '🌊', tier: 3, req: 'ramming', desc: 'Verteidigungsbonus auf Wasser' },
  spiritualism: { name: 'Spiritualismus', icon: '✨', tier: 3, req: 'archery', desc: '+1 Heilung pro Runde' },
  mathematics: { name: 'Mathematik', icon: '➗', tier: 3, req: 'forestry', desc: 'Katapult ausbilden' },
  trade: { name: 'Handel', icon: '💰', tier: 3, req: 'roads', desc: '+1 Stern pro Stadt' },
  chivalry: { name: 'Ritterlichkeit', icon: '⚔️', tier: 3, req: 'freespirit', desc: 'Ritter ausbilden' }
};

export const TECH_TIERS = [
  ['organization', 'climbing', 'fishing', 'hunting', 'riding'],
  ['farming', 'shields', 'mining', 'meditation', 'sailing', 'ramming', 'archery', 'forestry', 'roads', 'freespirit'],
  ['construction', 'diplomacy', 'smithery', 'philosophy', 'navigation', 'aquatism', 'spiritualism', 'mathematics', 'trade', 'chivalry']
];

// Echte Stämme (reguläre Auswahl) mit Farbe, Start-Technologie und Starteinheit.
export const TRIBES = {
  imperius: { name: 'Imperius', color: 0x0000ff, startTechs: ['organization'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Ausgeglichene Fraktion des Imperiums.' },
  bardur: { name: 'Bardur', color: 0x352514, startTechs: ['hunting'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Waldstämme des Nordens.' },
  xinxi: { name: 'Xin-Xi', color: 0xcc0000, startTechs: ['climbing'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Bergvolk der Berge.' },
  kickoo: { name: 'Kickoo', color: 0x00ff00, startTechs: ['fishing'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Inselvolk der Südsee.' },
  oumaji: { name: 'Oumaji', color: 0xffff00, startTechs: ['riding'], startUnits: ['rider'], bonusStars: 0, blurb: 'Wüstenreiter – startet mit Reiter.' },
  hoodrick: { name: 'Hoodrick', color: 0x996600, startTechs: ['archery'], startUnits: ['archer'], bonusStars: 0, blurb: 'Waldläufer – startet mit Bogenschützen.' },
  quetzali: { name: 'Quetzali', color: 0x275c4a, startTechs: ['shields'], startUnits: ['defender'], bonusStars: 0, blurb: 'Startet mit Verteidiger.' },
  vengir: { name: 'Vengir', color: 0xffffff, startTechs: ['smithery'], startUnits: ['swordsman'], bonusStars: 0, blurb: 'Kriegerisch – startet mit Schwertkämpfer.' },
  zebasi: { name: 'Zebasi', color: 0xff9900, startTechs: ['farming'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Savannenbauern – starke Wirtschaft.' },
  aimo: { name: 'Ai-Mo', color: 0x36e2aa, startTechs: ['philosophy'], startUnits: ['mindbender'], bonusStars: 0, blurb: 'Weise – startet mit Gedankenbeuger und günstiger Forschung.' },
  yadakk: { name: 'Yădakk', color: 0x7d231c, startTechs: ['roads'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Händler der Steppe.' },
  luxidoor: { name: 'Luxidoor', color: 0xab3bd6, startTechs: [], startUnits: ['warrior'], bonusStars: 3, blurb: 'Reich, aber ohne Starttechnologie (+3 Sterne).' }
};

export const TRIBE_POOL = Object.keys(TRIBES);

export function tribeColor(tribeId) {
  const t = TRIBES[tribeId];
  return t ? t.color : COLORS.neutral;
}

export function researchCost(tier, cityCount, hasPhilosophy = false) {
  let cost = tier * (1 + cityCount);
  if (hasPhilosophy) cost = Math.ceil(cost * 0.8);
  return cost;
}

// Ressourcen auf Feldern. „bonus“ = +1 Einkommen der angrenzenden Stadt.
export const RESOURCES = {
  fruit: { name: 'Obst', icon: '🍎', terrain: ['field'], color: 0xe0526e },
  animals: { name: 'Wildtiere', icon: '🦌', terrain: ['forest'], color: 0x9c5a2b },
  fish: { name: 'Fische', icon: '🐟', terrain: ['water'], color: 0x4aa3df },
  minerals: { name: 'Mineralien', icon: '⛏️', terrain: ['mountain'], color: 0x8a8f98 }
};

// Gebäude (Improvements) in einem Stadtfeld. `terrain` = zulässige Felder,
// `tech` = Freischaltung, `pop` = +Einkommen für die Stadt.
export const IMPROVEMENTS = {
  farm: { name: 'Farm', icon: '🌾', tech: 'farming', terrain: ['field'], cost: 6, pop: 1 },
  sawmill: { name: 'Sägewerk', icon: '🪵', tech: 'forestry', terrain: ['forest'], cost: 7, pop: 1 },
  mine: { name: 'Mine', icon: '⛏️', tech: 'mining', terrain: ['mountain'], cost: 8, pop: 1 },
  port: { name: 'Hafen', icon: '⚓', tech: 'sailing', terrain: ['water', 'ocean', 'ice'], cost: 7, pop: 1 },
  temple: { name: 'Tempel', icon: '🛕', tech: 'meditation', terrain: ['field'], cost: 10, pop: 2 }
};

// --- Brücken ----------------------------------------------------------------
// Landeinheiten bauen Brücken über 1–2 Felder Flachwasser; Schiffe fahren
// darunter durch oder reißen sie ein.
export const BRIDGE = { tech: 'roads', costPerTile: 5, maxLen: 2 };
// Auflösen einer Einheit erstattet diesen Anteil der Kosten.
export const DISBAND_REFUND = 0.5;

// --- Stadtstufen ------------------------------------------------------------
// Stufe = Bevölkerung. Bei jeder neuen Stufe (2 bis 5) wählt der Besitzer
// eine von zwei Belohnungen – wie in Polytopia.
export const CITY_REWARDS = {
  workshop: { name: 'Werkstatt', desc: '+1 Stern pro Runde' },
  explorer: { name: 'Erkunder', desc: 'Deckt die Umgebung im Umkreis von 4 Feldern auf' },
  wall: { name: 'Stadtmauer', desc: 'Verteidiger in dieser Stadt erhalten ×4 Verteidigung' },
  resources: { name: 'Vorräte', desc: '+5 Sterne sofort' },
  growth: { name: 'Wachstum', desc: '+1 Bevölkerung (nächste Stufe)' },
  borders: { name: 'Grenzerweiterung', desc: 'Stadtgebiet wächst auf 2 Felder Umkreis' },
  park: { name: 'Park', desc: '+1 Stern pro Runde' },
  giant: { name: 'Riese', desc: 'Ein Riese (40 Leben) erscheint bei der Stadt' }
};
export const REWARD_CHOICES = {
  2: ['workshop', 'explorer'],
  3: ['wall', 'resources'],
  4: ['growth', 'borders'],
  5: ['park', 'giant']
};

// --- Ruinen -----------------------------------------------------------------
export const RUIN_REWARDS = {
  stars: { name: 'Schatz', weight: 30 },
  tech: { name: 'Altes Wissen', weight: 25 },
  unit: { name: 'Verbündete', weight: 20 },
  pop: { name: 'Siedler aus der Ruine', weight: 15 },
  reveal: { name: 'Alte Karte', weight: 10 }
};
export const RUIN_STARS = 10;

// --- Spielmodi & Schwierigkeit ---------------------------------------------
export const GAME_MODES = {
  conquest: { label: 'Eroberung', turnLimit: null },
  perfection: { label: 'Perfektion (30 Runden)', turnLimit: 30 }
};
export const AI_LEVELS = {
  easy: { label: 'Leicht', incomeFactor: 0.7, incomeBonus: 0, startBonus: 0 },
  normal: { label: 'Normal', incomeFactor: 1, incomeBonus: 0, startBonus: 0 },
  hard: { label: 'Schwer', incomeFactor: 1, incomeBonus: 2, startBonus: 3 }
};
// Punktewertung (Perfektion und Endstatistik).
export const SCORE = {
  city: 100, pop: 40, reward: 20, tech: 50, unitCost: 5, explored: 2, improvement: 30, ruin: 40
};
