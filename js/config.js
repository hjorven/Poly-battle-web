// Datenmodell orientiert an den echten Polytopia-Spieldaten
// (GameLogicData28.txt) – Werte in Anzeigeeinheiten (Rohwert / 10).

// Kartengröße ist pro Partie wählbar. `let` + Setter: Alle Module sehen über
// die Live-Bindung von ES-Modulen sofort die Größe der aktuellen Partie.
export let MAP_W = 26;
export let MAP_H = 18;
export function setMapSize(w, h) {
  MAP_W = w;
  MAP_H = h;
}
export const MAP_SIZES = {
  small: { label: 'Klein', w: 18, h: 12 },
  normal: { label: 'Normal', w: 26, h: 18 },
  large: { label: 'Groß', w: 34, h: 22 }
};
export const MAP_TYPES = {
  continents: { label: 'Kontinente' },
  pangaea: { label: 'Pangäa' },
  archipelago: { label: 'Archipel' }
};
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
    name: 'Krieger', hp: 10, atk: 2, def: 2, move: 1, range: 1, cost: 2, sight: 1,
    tech: null, abilities: ['dash', 'fortify', 'land']
  },
  archer: {
    name: 'Bogenschütze', hp: 10, atk: 2, def: 1, move: 1, range: 2, cost: 3, sight: 2,
    tech: 'archery', abilities: ['dash', 'fortify', 'land']
  },
  rider: {
    name: 'Reiter', hp: 10, atk: 2, def: 1, move: 2, range: 1, cost: 3, sight: 1,
    tech: 'riding', abilities: ['dash', 'escape', 'fortify', 'land']
  },
  defender: {
    name: 'Verteidiger', hp: 15, atk: 1, def: 3, move: 1, range: 1, cost: 3, sight: 1,
    tech: 'shields', abilities: ['fortify', 'land']
  },
  swordsman: {
    name: 'Schwertkämpfer', hp: 15, atk: 3, def: 3, move: 1, range: 1, cost: 5, sight: 1,
    tech: 'smithery', abilities: ['dash', 'land']
  },
  catapult: {
    name: 'Katapult', hp: 10, atk: 4, def: 0, move: 1, range: 3, cost: 8, sight: 2,
    tech: 'mathematics', abilities: ['stiff', 'land']
  },
  mindbender: {
    name: 'Gedankenbeuger', hp: 10, atk: 0, def: 1, move: 1, range: 1, cost: 5, sight: 1,
    tech: 'philosophy', abilities: ['heal', 'convert', 'stiff', 'land']
  },
  knight: {
    name: 'Ritter', hp: 10, atk: 3.5, def: 1, move: 3, range: 1, cost: 8, sight: 1,
    tech: 'chivalry', abilities: ['dash', 'persist', 'fortify', 'land']
  },
  giant: {
    name: 'Riese', hp: 40, atk: 5, def: 4, move: 1, range: 1, cost: 10, sight: 1,
    tech: null, abilities: ['static', 'land'], reward: true
  },
  boat: {
    name: 'Boot', hp: 10, atk: 2, def: 0, move: 2, range: 1, cost: 3, sight: 2,
    tech: 'sailing', abilities: ['dash', 'fortify', 'water']
  },
  ship: {
    name: 'Schiff', hp: 14, atk: 3, def: 1, move: 2, range: 2, cost: 5, sight: 2,
    tech: 'sailing', abilities: ['dash', 'fortify', 'water']
  },
  battleship: {
    name: 'Kriegsschiff', hp: 18, atk: 4, def: 2, move: 3, range: 2, cost: 8, sight: 2,
    tech: 'navigation', abilities: ['dash', 'fortify', 'water']
  },
  spy: {
    name: 'Spion', hp: 6, atk: 0, def: 1, move: 2, range: 1, cost: 4, sight: 2,
    tech: null, abilities: ['scout', 'land']
  },
  settler: {
    name: 'Siedler', hp: 10, atk: 0, def: 0, move: 1, range: 1, cost: 5, sight: 1,
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
  organization: { name: 'Organisation', tier: 1, req: null, desc: 'Zweig: Landwirtschaft, Schildmacher' },
  climbing: { name: 'Klettern', tier: 1, req: null, desc: 'Einheiten können Berge betreten' },
  fishing: { name: 'Fischerei', tier: 1, req: null, desc: 'Zweig: Segeln, Rammen' },
  hunting: { name: 'Jagd', tier: 1, req: null, desc: 'Zweig: Bogenschießen, Forstwirtschaft' },
  riding: { name: 'Reiten', tier: 1, req: null, desc: 'Zweig: Wege, Freier Geist' },

  farming: { name: 'Landwirtschaft', tier: 2, req: 'organization', desc: 'Farmen bauen (+1 Einkommen)' },
  shields: { name: 'Schildmacher', tier: 2, req: 'organization', desc: 'Verteidiger ausbilden' },
  mining: { name: 'Bergbau', tier: 2, req: 'climbing', desc: 'Minen bauen (+1 Einkommen)' },
  meditation: { name: 'Meditation', tier: 2, req: 'climbing', desc: 'Tempel bauen' },
  sailing: { name: 'Segeln', tier: 2, req: 'fishing', desc: 'Boote & Schiffe; Häfen; +1 Sicht' },
  ramming: { name: 'Rammen', tier: 2, req: 'fishing', desc: 'Zweig: Aquatismus' },
  archery: { name: 'Bogenschießen', tier: 2, req: 'hunting', desc: 'Bogenschützen; Wald-Verteidigung' },
  forestry: { name: 'Forstwirtschaft', tier: 2, req: 'hunting', desc: 'Sägewerke bauen (+1 Einkommen)' },
  roads: { name: 'Wege', tier: 2, req: 'riding', desc: 'Im eigenen Gebiet kostet Wald und Berg nur 1 Bewegung; Brücken bauen' },
  freespirit: { name: 'Freier Geist', tier: 2, req: 'riding', desc: 'Zweig: Ritterlichkeit' },

  construction: { name: 'Baukunst', tier: 3, req: 'farming', desc: '+1 Stern pro Stadt' },
  diplomacy: { name: 'Diplomatie', tier: 3, req: 'shields', desc: 'Botschaften und Bündnisse' },
  smithery: { name: 'Schmiedekunst', tier: 3, req: 'mining', desc: 'Schwertkämpfer ausbilden' },
  philosophy: { name: 'Philosophie', tier: 3, req: 'meditation', desc: 'Gedankenbeuger; Forschung -20 %' },
  navigation: { name: 'Navigation', tier: 3, req: 'sailing', desc: 'Kriegsschiffe ausbilden' },
  aquatism: { name: 'Aquatismus', tier: 3, req: 'ramming', desc: 'Verteidigungsbonus auf Wasser' },
  spiritualism: { name: 'Spiritualismus', tier: 3, req: 'archery', desc: '+1 Heilung pro Runde' },
  mathematics: { name: 'Mathematik', tier: 3, req: 'forestry', desc: 'Katapult ausbilden' },
  trade: { name: 'Handel', tier: 3, req: 'roads', desc: '+1 Stern pro Stadt' },
  chivalry: { name: 'Ritterlichkeit', tier: 3, req: 'freespirit', desc: 'Ritter ausbilden' },

  planning: { name: 'Stadtplanung', tier: 4, req: 'construction', desc: 'Bevölkerung kaufen kostet 2 Sterne weniger' },
  espionage: { name: 'Spionage', tier: 4, req: 'diplomacy', desc: 'Spione kosten 2 Sterne weniger und sehen 1 Feld weiter' },
  steel: { name: 'Stahl', tier: 4, req: 'smithery', desc: 'Krieger, Verteidiger und Schwertkämpfer +1 Angriff' },
  scholarship: { name: 'Gelehrsamkeit', tier: 4, req: 'philosophy', desc: '+1 Stern pro Stadt ab Stufe 3' },
  seapower: { name: 'Seemacht', tier: 4, req: 'navigation', desc: 'Boote, Schiffe und Kriegsschiffe +1 Bewegung' },
  harbors: { name: 'Hafenwirtschaft', tier: 4, req: 'aquatism', desc: 'Jeder Hafen bringt +1 Stern zusätzlich' },
  medicine: { name: 'Heilkunst', tier: 4, req: 'spiritualism', desc: 'Einheiten heilen jede Runde 2 Leben mehr' },
  engineering: { name: 'Ingenieurwesen', tier: 4, req: 'mathematics', desc: 'Katapulte kosten 3 Sterne weniger' },
  banking: { name: 'Bankwesen', tier: 4, req: 'trade', desc: '+1 Stern pro Stadt' },
  horseshoes: { name: 'Hufeisen', tier: 4, req: 'chivalry', desc: 'Reiter +1 Bewegung' }
};

// Stufe-4-Boni: Technologie → Wirkung (in rules.js ausgewertet).
export const TECH_BONUS = {
  planning: { popDiscount: 2 },
  espionage: { unitDiscount: { spy: 2 }, sight: { spy: 1 } },
  steel: { atk: { warrior: 1, defender: 1, swordsman: 1 } },
  seapower: { move: { boat: 1, ship: 1, battleship: 1 } },
  medicine: { heal: 2 },
  engineering: { unitDiscount: { catapult: 3 } },
  horseshoes: { move: { rider: 1 } }
};

export const TECH_TIERS = [
  ['organization', 'climbing', 'fishing', 'hunting', 'riding'],
  ['farming', 'shields', 'mining', 'meditation', 'sailing', 'ramming', 'archery', 'forestry', 'roads', 'freespirit'],
  ['construction', 'diplomacy', 'smithery', 'philosophy', 'navigation', 'aquatism', 'spiritualism', 'mathematics', 'trade', 'chivalry'],
  ['planning', 'espionage', 'steel', 'scholarship', 'seapower', 'harbors', 'medicine', 'engineering', 'banking', 'horseshoes']
];

// Echte Stämme (reguläre Auswahl) mit Farbe, Start-Technologie und Starteinheit.
export const TRIBES = {
  imperius: { name: 'Imperius', color: 0x0000ff, startTechs: ['organization'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Ausgeglichene Fraktion des Imperiums.', perk: { id: 'legion', name: 'Legion', desc: 'Krieger kosten 1 Stern weniger, die Hauptstadt bringt +1 Stern pro Runde.' } },
  bardur: { name: 'Bardur', color: 0x352514, startTechs: ['hunting'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Waldstämme des Nordens.', perk: { id: 'woodland', name: 'Waldvolk', desc: 'Wald kostet nur 1 Bewegung.' } },
  xinxi: { name: 'Xin-Xi', color: 0xcc0000, startTechs: ['climbing'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Bergvolk der Berge.', perk: { id: 'mountaineer', name: 'Bergsteiger', desc: 'Berge kosten nur 1 Bewegung.' } },
  kickoo: { name: 'Kickoo', color: 0x00ff00, startTechs: ['fishing'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Inselvolk der Südsee.', perk: { id: 'seafarer', name: 'Seefahrer', desc: 'Schiffe und Boote haben +1 Bewegung.' } },
  oumaji: { name: 'Oumaji', color: 0xffff00, startTechs: ['riding'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Wüstenreiter – startet mit Reiten.', perk: { id: 'lookouts', name: 'Späher', desc: 'Reiter und Ritter sehen 1 Feld weiter.' } },
  hoodrick: { name: 'Hoodrick', color: 0x996600, startTechs: ['archery'], startUnits: ['archer'], bonusStars: 0, blurb: 'Waldläufer – startet mit Bogenschützen.', perk: { id: 'longbow', name: 'Langbogen', desc: 'Bogenschützen kosten 1 Stern weniger.' } },
  quetzali: { name: 'Quetzali', color: 0x275c4a, startTechs: ['shields'], startUnits: ['defender'], bonusStars: 0, blurb: 'Startet mit Verteidiger.', perk: { id: 'guardians', name: 'Wächter', desc: 'Verteidiger kosten 1 Stern weniger.' } },
  vengir: { name: 'Vengir', color: 0xffffff, startTechs: ['smithery'], startUnits: ['swordsman'], bonusStars: 0, blurb: 'Kriegerisch – startet mit Schwertkämpfer.', perk: { id: 'forge', name: 'Schmiede', desc: 'Schwertkämpfer kosten 1 Stern weniger.' } },
  zebasi: { name: 'Zebasi', color: 0xff9900, startTechs: ['farming'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Savannenbauern – starke Wirtschaft.', perk: { id: 'harvest', name: 'Ernte', desc: 'Farmen bringen +1 Stern zusätzlich.' } },
  aimo: { name: 'Ai-Mo', color: 0x36e2aa, startTechs: ['meditation'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Weise – startet mit Meditation und günstiger Forschung.', perk: { id: 'wisdom', name: 'Weisheit', desc: 'Jede Technologie kostet 1 Stern weniger.' } },
  yadakk: { name: 'Yădakk', color: 0x7d231c, startTechs: ['roads'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Händler der Steppe.', perk: { id: 'traders', name: 'Händler', desc: '+1 Stern pro Runde für je 2 Städte.' } },
  luxidoor: { name: 'Luxidoor', color: 0xab3bd6, startTechs: [], startUnits: ['warrior'], bonusStars: 3, blurb: 'Reich, aber ohne Starttechnologie (+3 Sterne).', perk: { id: 'splendor', name: 'Prunk', desc: 'Die Hauptstadt bringt +2 Sterne pro Runde.' } }
};

export const TRIBE_POOL = Object.keys(TRIBES);

export function tribeColor(tribeId) {
  const t = TRIBES[tribeId];
  return t ? t.color : COLORS.neutral;
}

// Kosten: Stufenfaktor × (1 + Städte) + 2 je bereits erforschter Technologie.
// Späte Stufen sind deutlich teurer, damit nicht jeder den ganzen Baum hat.
const TIER_FACTOR = [1, 2, 4, 6];
export function researchCost(tier, cityCount, hasPhilosophy = false, known = 0) {
  let cost = TIER_FACTOR[tier - 1] * (1 + cityCount) + 2 * known;
  if (hasPhilosophy) cost = Math.ceil(cost * 0.8);
  return cost;
}

// Ressourcen auf Feldern. „bonus“ = +1 Einkommen der angrenzenden Stadt.
export const RESOURCES = {
  fruit: { name: 'Obst', terrain: ['field'], color: 0xe0526e },
  animals: { name: 'Wildtiere', terrain: ['forest'], color: 0x9c5a2b },
  fish: { name: 'Fische', terrain: ['water'], color: 0x4aa3df },
  minerals: { name: 'Mineralien', terrain: ['mountain'], color: 0x8a8f98 }
};

// Gebäude (Improvements) in einem Stadtfeld. `terrain` = zulässige Felder,
// `tech` = Freischaltung, `pop` = +Einkommen für die Stadt.
export const IMPROVEMENTS = {
  farm: { name: 'Farm', tech: 'farming', terrain: ['field'], cost: 6, pop: 1 },
  sawmill: { name: 'Sägewerk', tech: 'forestry', terrain: ['forest'], cost: 7, pop: 1 },
  mine: { name: 'Mine', tech: 'mining', terrain: ['mountain'], cost: 8, pop: 1 },
  port: { name: 'Hafen', tech: 'sailing', terrain: ['water', 'ocean'], cost: 7, pop: 1 },
  temple: { name: 'Tempel', tech: 'meditation', terrain: ['field'], cost: 10, pop: 2 },
  // Monumente: kostenlos, einmal je Stamm, nach einem Erfolg (siehe MONUMENTS).
  m_wisdom: { name: 'Turm der Weisheit', monument: true, terrain: ['field', 'forest'], cost: 0, pop: 0 },
  m_valor: { name: 'Tor der Tapferkeit', monument: true, terrain: ['field', 'forest'], cost: 0, pop: 0 },
  m_eye: { name: 'Auge der Welt', monument: true, terrain: ['field', 'forest'], cost: 0, pop: 0 },
  m_treasury: { name: 'Schatzkammer', monument: true, terrain: ['field', 'forest'], cost: 0, pop: 0 },
  m_park: { name: 'Großer Park', monument: true, terrain: ['field', 'forest'], cost: 0, pop: 0 },
  m_palace: { name: 'Kaiserpalast', monument: true, terrain: ['field', 'forest'], cost: 0, pop: 0 }
};

// Erfolge, die Monumente freischalten. Ein Monument gibt der Stadt, in deren
// Gebiet es steht, +MONUMENT_POP Bevölkerung und zählt zur Punktzahl.
export const MONUMENTS = {
  m_wisdom: { goal: '20 Technologien erforscht', color: 0x60a5fa },
  m_valor: { goal: '10 gegnerische Einheiten besiegt', color: 0xef4444 },
  m_eye: { goal: 'Alle Leuchttürme gefunden', color: 0xfacc15 },
  m_treasury: { goal: '100 Sterne auf einmal besessen', color: 0xf59e0b },
  m_park: { goal: 'Drei Städte auf Stufe 5', color: 0x22c55e },
  m_palace: { goal: '8 Städte besessen', color: 0xa855f7 }
};
export const MONUMENT_POP = 3;

// --- Brücken ----------------------------------------------------------------
// Landeinheiten bauen Brücken über 1–2 Felder Flachwasser; Schiffe fahren
// darunter durch oder reißen sie ein.
export const BRIDGE = { tech: 'roads', costPerTile: 5, maxLen: 2 };
// Auflösen einer Einheit erstattet diesen Anteil der Kosten.
export const DISBAND_REFUND = 0.5;

// Rabatte durch Stammes-Fähigkeiten (Perk-ID → Einheit).
export const PERK_DISCOUNT = {
  legion: 'warrior', longbow: 'archer', guardians: 'defender', forge: 'swordsman'
};

// --- Veteranen ----------------------------------------------------------------
// Nach VETERAN_KILLS Siegen wird eine Einheit befördert: +VETERAN_HP Leben
// und volle Heilung.
export const VETERAN_KILLS = 3;
export const VETERAN_HP = 5;

// --- Stadtstufen ------------------------------------------------------------
// Stufe = Bevölkerung. Bei jeder neuen Stufe (2 bis 5) wählt der Besitzer
// eine von zwei Belohnungen – wie in Polytopia.
export const CITY_REWARDS = {
  workshop: { name: 'Werkstatt', desc: '+1 Stern pro Runde' },
  explorer: { name: 'Erkunder', desc: 'Deckt die Umgebung im Umkreis von 4 Feldern auf' },
  wall: { name: 'Stadtmauer', desc: 'Verteidiger in dieser Stadt erhalten 4-fache Verteidigung' },
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

// --- Leuchttürme --------------------------------------------------------------
// In jeder Kartenecke steht ein Leuchtturm. Jeder Stamm kann jeden einmal
// erreichen (Schiff auf oder neben dem Turm): Sterne und Sicht auf die Umgebung,
// wer alle vier findet, bekommt einen Zusatzbonus.
export const LIGHTHOUSE = { stars: 3, reveal: 3, allBonus: 5 };

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
  city: 100, pop: 40, reward: 20, tech: 50, unitCost: 5, explored: 2, improvement: 30, ruin: 40, lighthouse: 40, monument: 200
};
