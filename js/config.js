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
export const DEF_BONUS = { none: 1, standard: 1.5, fort: 3, wall: 4 };

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
  ice: { name: 'Eis', color: 0xd8eef7, height: 0.45, walkable: true, move: 1, def: 1, tech: null, enterTech: null },
  // Hügel: für alle begehbar, Verteidigung ohne Technologie, Einheiten darauf sehen weiter.
  hills: { name: 'Hügel', color: 0xa3a94f, height: 0.72, walkable: true, move: 1, def: 1.5, tech: null, enterTech: null, sight: 1 },
  // Sumpf: Betreten beendet die Bewegung (`stop`), Verteidiger stehen schlechter.
  swamp: { name: 'Sumpf', color: 0x6b7d4a, height: 0.4, walkable: true, move: 1, def: 0.75, tech: null, enterTech: null, stop: true }
};

// Anteil der neuen Landschaften, die nach der Kartenerzeugung auf freie Felder
// gesetzt werden (siehe rules.js: addLandscapes).
export const LANDSCAPE = { hillsNearMountain: 0.5, hills: 0.08, swampNearWater: 0.3, swamp: 0.03 };

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
  scout: { name: 'Spähen', desc: 'Greift nicht an, betritt Berge ohne Klettern und sieht von Bergen 1 Feld weiter.' },
  air: { name: 'Fliegen', desc: 'Fliegt über Wasser, Berge und Wald (je 1 Bewegung) und ignoriert Kontrollzonen. Nahkämpfer erreichen sie nicht. Erobert keine Städte, heilt nur im eigenen Gebiet.' },
  fragile: { name: 'Zerbrechlich', desc: 'Ein Treffer eines Fernkämpfers (Bogenschütze, Katapult, Schiff, Luftschiff) zerstört sie sofort.' },
  flak: { name: 'Große Hülle', desc: 'Nimmt von Fernkämpfern doppelten Schaden.' },
  cargo: { name: 'Transport', desc: 'Nimmt eine benachbarte eigene Landeinheit auf und setzt sie anderswo ab.' },
  siege: { name: 'Belagerung', desc: 'Dreifacher Schaden gegen Einheiten in Städten und auf Burgen; dort ohne Gegenschlag.' },
  trade: { name: 'Handel', desc: 'In oder neben einer anderen Stadt: einmalig Sterne, mehr je weiter von der Heimatstadt entfernt. Erobert keine Städte.' },
  pikes: { name: 'Pikenwall', desc: 'Anderthalbfacher Schaden gegen Reiter, Ritter und Paladine – auch beim Gegenschlag.' },
  ranger: { name: 'Pfadfinder', desc: 'Wald, Hügel und Sumpf kosten nur 1 Bewegung und halten nicht auf; aus dem Wald +1 Angriff.' },
  banner: { name: 'Banner', desc: 'Eigene Einheiten direkt daneben haben +0,5 Angriff (mehrere Banner zählen nicht doppelt).' },
  fireship: { name: 'Brandsatz', desc: 'Geht beim Angriff unter, trifft aber auch alle Feinde neben dem Ziel mit halbem Schaden. Kein Gegenschlag.' }
};

// Werte der neuen Fähigkeiten (siehe rules.js: attackOf, attack).
export const BANNER_ATK = 0.5;
export const RANGER_FOREST_ATK = 1;

// Eintrag einer Tabelle nur über eigene Schlüssel: IDs aus Zugprotokoll,
// Online-Stand oder Klicks dürfen nie auf Object.prototype zeigen
// („__proto__“, „constructor“ …).
export function own(table, key) {
  return (typeof key === 'string' || typeof key === 'number') && Object.hasOwn(table, key) ? table[key] : undefined;
}

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
  horsearcher: {
    name: 'Bogenreiter', hp: 10, atk: 2, def: 1, move: 2, range: 2, cost: 6, sight: 2,
    tech: 'horseshoes', abilities: ['dash', 'escape', 'land']
  },
  ram: {
    name: 'Rammbock', hp: 15, atk: 1, def: 1, move: 1, range: 1, cost: 6, sight: 1,
    tech: 'construction', abilities: ['siege', 'land']
  },
  cart: {
    name: 'Händlerkarren', hp: 6, atk: 0, def: 1, move: 2, range: 1, cost: 5, sight: 1,
    tech: 'trade', abilities: ['trade', 'land']
  },
  knight: {
    name: 'Ritter', hp: 10, atk: 3, def: 1, move: 3, range: 1, cost: 11, sight: 1,
    tech: 'chivalry', abilities: ['dash', 'persist', 'fortify', 'land']
  },
  // Riese: nur als Stadtbelohnung, kostet beim Wählen `cost` Sterne.
  giant: {
    name: 'Riese', hp: 40, atk: 5, def: 4, move: 1, range: 1, cost: 25, sight: 1,
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
  pikeman: {
    name: 'Pikenier', hp: 10, atk: 2, def: 3, move: 1, range: 1, cost: 4, sight: 1,
    tech: 'pikes', abilities: ['dash', 'fortify', 'land', 'pikes']
  },
  crossbow: {
    name: 'Armbrustschütze', hp: 10, atk: 3, def: 1, move: 1, range: 2, cost: 6, sight: 2,
    tech: 'crossbows', abilities: ['dash', 'fortify', 'land']
  },
  paladin: {
    name: 'Paladin', hp: 15, atk: 4, def: 2, move: 3, range: 1, cost: 15, sight: 1,
    tech: 'paladins', abilities: ['dash', 'persist', 'fortify', 'land']
  },
  balloon: {
    name: 'Heißluftballon', hp: 4, atk: 0, def: 1, move: 3, range: 1, cost: 4, sight: 3,
    tech: 'ballooning', abilities: ['air', 'fragile']
  },
  // Ausgemustert (`retired`: nicht mehr ausbildbar). Bleiben in der Liste,
  // weil Wiederholungen die Einheitenart als Position speichern.
  cargoballoon: {
    name: 'Lastenballon', hp: 6, atk: 0, def: 1, move: 3, range: 1, cost: 6, sight: 2,
    tech: 'ballooning', abilities: ['air', 'fragile', 'cargo'], retired: true
  },
  fireballoon: {
    name: 'Brandballon', hp: 6, atk: 3, def: 0, move: 2, range: 1, cost: 8, sight: 2,
    tech: 'airships', abilities: ['air', 'fragile'], retired: true
  },
  airship: {
    name: 'Kriegsluftschiff', hp: 12, atk: 3, def: 2, move: 2, range: 2, cost: 12, sight: 3,
    tech: 'airships', abilities: ['air', 'flak']
  },
  spy: {
    name: 'Spion', hp: 6, atk: 0, def: 1, move: 2, range: 1, cost: 4, sight: 2,
    tech: null, abilities: ['scout', 'land']
  },
  settler: {
    name: 'Siedler', hp: 10, atk: 0, def: 0, move: 1, range: 1, cost: 5, sight: 1,
    tech: null, abilities: ['static', 'land', 'settle'], capital: true
  },
  // Neue Einheiten stehen am Ende: Wiederholungen speichern die Art als
  // Position in dieser Liste.
  ranger: {
    name: 'Waldläufer', hp: 10, atk: 2, def: 2, move: 1, range: 1, cost: 4, sight: 2,
    tech: 'forestry', abilities: ['dash', 'fortify', 'land', 'ranger']
  },
  bannerman: {
    name: 'Bannerträger', hp: 10, atk: 1, def: 2, move: 1, range: 1, cost: 6, sight: 1,
    tech: 'freespirit', abilities: ['fortify', 'land', 'banner']
  },
  fireship: {
    name: 'Brander', hp: 8, atk: 4, def: 0, move: 3, range: 1, cost: 6, sight: 2,
    tech: 'aquatism', abilities: ['dash', 'water', 'fireship']
  }
};

export const UNIT_ORDER = [
  'warrior', 'archer', 'ranger', 'rider', 'defender', 'pikeman', 'swordsman', 'crossbow',
  'catapult', 'ram', 'mindbender', 'bannerman', 'horsearcher', 'knight', 'paladin', 'cart', 'giant',
  'boat', 'ship', 'fireship', 'battleship', 'balloon', 'airship', 'spy', 'settler'
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
  forestry: { name: 'Forstwirtschaft', tier: 2, req: 'hunting', desc: 'Sägewerke bauen (+1 Einkommen); Waldläufer' },
  roads: { name: 'Wege', tier: 2, req: 'riding', desc: 'Wege (halbe Bewegung) und Brücken bauen; im eigenen Gebiet kosten Wald und Berg nur 1' },
  freespirit: { name: 'Freier Geist', tier: 2, req: 'riding', desc: 'Bannerträger; Zweig: Ritterlichkeit' },

  // Je Ast: Stufe 2 → 3 → 4 → 5 (seit Oktober 2026 ohne Stufe 6, siehe RETIRED_TECHS).
  construction: { name: 'Baukunst', tier: 3, req: 'farming', desc: '+1 Stern pro Stadt' },
  mills: { name: 'Mühlenbau', tier: 4, req: 'construction', desc: 'Windmühle: +1 Stern je angrenzender Farm' },
  rotation: { name: 'Fruchtfolge', tier: 5, req: 'mills', desc: 'Jede Farm bringt +1 Stern zusätzlich' },

  pikes: { name: 'Pikeniere', tier: 3, req: 'shields', desc: 'Pikenier: stark gegen Reiter, Ritter und Paladine' },
  diplomacy: { name: 'Diplomatie', tier: 4, req: 'pikes', desc: 'Frieden mit anderen Stämmen anbieten' },
  castles: { name: 'Burgbau', tier: 5, req: 'diplomacy', desc: 'Burg: Einheiten darauf haben 3-fache Verteidigung' },

  smithery: { name: 'Schmiedekunst', tier: 3, req: 'mining', desc: 'Schwertkämpfer ausbilden' },
  smelting: { name: 'Verhüttung', tier: 4, req: 'smithery', desc: 'Schmelzhütte: +2 Sterne je angrenzender Mine' },
  steel: { name: 'Stahl', tier: 5, req: 'smelting', desc: 'Krieger, Verteidiger, Pikeniere und Schwertkämpfer +1 Angriff' },

  philosophy: { name: 'Philosophie', tier: 3, req: 'meditation', desc: 'Gedankenbeuger; Forschung -20 %' },
  scholarship: { name: 'Gelehrsamkeit', tier: 4, req: 'philosophy', desc: '+1 Stern pro Stadt ab Stufe 3' },
  monastic: { name: 'Klosterwesen', tier: 5, req: 'scholarship', desc: 'Kloster: +2 Sterne, Einheiten im Stadtgebiet heilen 2 mehr' },

  navigation: { name: 'Navigation', tier: 3, req: 'sailing', desc: 'Kriegsschiffe ausbilden' },
  cartography: { name: 'Kartografie', tier: 4, req: 'navigation', desc: 'Alle Einheiten sehen 1 Feld weiter' },
  seapower: { name: 'Seemacht', tier: 5, req: 'cartography', desc: 'Boote, Schiffe und Kriegsschiffe +1 Bewegung' },

  aquatism: { name: 'Aquatismus', tier: 3, req: 'ramming', desc: 'Verteidigungsbonus auf Wasser; Brander' },
  fishfarming: { name: 'Fischzucht', tier: 4, req: 'aquatism', desc: 'Fischgründe bringen +1 Stern zusätzlich' },
  harbors: { name: 'Hafenwirtschaft', tier: 5, req: 'fishfarming', desc: 'Jeder Hafen bringt +1 Stern zusätzlich' },

  crossbows: { name: 'Armbrust', tier: 3, req: 'archery', desc: 'Armbrustschütze: Reichweite 2, Angriff 3' },
  medicine: { name: 'Heilkunst', tier: 4, req: 'crossbows', desc: 'Einheiten heilen jede Runde 2 Leben mehr' },
  marksmen: { name: 'Meisterschützen', tier: 5, req: 'medicine', desc: 'Bogen- und Armbrustschützen +1 Angriff' },

  mathematics: { name: 'Mathematik', tier: 3, req: 'forestry', desc: 'Katapult ausbilden' },
  ballooning: { name: 'Ballonfahrt', tier: 4, req: 'mathematics', desc: 'Ballonplatz und Heißluftballon (Späher)' },
  airships: { name: 'Luftschiffbau', tier: 5, req: 'ballooning', desc: 'Kriegsluftschiff' },

  trade: { name: 'Handel', tier: 3, req: 'roads', desc: '+1 Stern pro Stadt' },
  markets: { name: 'Märkte', tier: 4, req: 'trade', desc: 'Markt: +1 Stern je angrenzendem Gebäude (bis 4)' },
  guilds: { name: 'Zünfte', tier: 5, req: 'markets', desc: 'Alle Gebäude kosten 2 Sterne weniger' },

  chivalry: { name: 'Ritterlichkeit', tier: 3, req: 'freespirit', desc: 'Ritter ausbilden' },
  horseshoes: { name: 'Hufeisen', tier: 4, req: 'chivalry', desc: 'Reiter +1 Bewegung' },
  paladins: { name: 'Ritterorden', tier: 5, req: 'horseshoes', desc: 'Paladin: schwerer Ritter' }
};

// Stufe-4-Boni: Technologie → Wirkung (in rules.js ausgewertet).
// Ausgemusterte Technologien: nicht mehr erforschbar und ohne Wirkung. Alte
// Spielstände dürfen sie noch enthalten (siehe save.js).
export const RETIRED_TECHS = ['planning', 'espionage', 'plate', 'printing', 'naval', 'shipyards', 'spiritualism', 'engineering', 'banking', 'tournaments'];

export const TECH_BONUS = {
  steel: { atk: { warrior: 1, defender: 1, pikeman: 1, swordsman: 1 } },
  seapower: { move: { boat: 1, ship: 1, battleship: 1 } },
  medicine: { heal: 2 },
  marksmen: { atk: { archer: 1, crossbow: 1 } },
  horseshoes: { move: { rider: 1 } },
  cartography: { sightAll: 1 },
  rotation: { farmBonus: 1 },
  fishfarming: { fishBonus: 1 },
  guilds: { buildDiscount: 2 }
};

export const TECH_TIERS = [1, 2, 3, 4, 5].map(t => Object.keys(TECHS).filter(k => TECHS[k].tier === t));

// Echte Stämme (reguläre Auswahl) mit Farbe, Start-Technologie und Starteinheit.
export const TRIBES = {
  imperius: { name: 'Imperius', color: 0x0000ff, startTechs: ['organization'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Ausgeglichene Fraktion des Imperiums.', perk: { id: 'legion', name: 'Legion', desc: 'Krieger kosten 1 Stern weniger, die Hauptstadt bringt +1 Stern pro Runde, Einheiten in eigenen Städten +1 Verteidigung.' } },
  bardur: { name: 'Bardur', color: 0x352514, startTechs: ['hunting'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Waldstämme des Nordens.', perk: { id: 'woodland', name: 'Waldvolk', desc: 'Wald kostet nur 1 Bewegung.' } },
  xinxi: { name: 'Xin-Xi', color: 0xcc0000, startTechs: ['climbing', 'mining'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Bergvolk der Berge.', perk: { id: 'mountaineer', name: 'Bergsteiger', desc: 'Berge kosten nur 1 Bewegung.' } },
  kickoo: { name: 'Kickoo', color: 0x00ff00, startTechs: ['fishing'], startUnits: ['warrior', 'boat'], bonusStars: 0, blurb: 'Inselvolk der Südsee – startet mit einem Boot.', perk: { id: 'seafarer', name: 'Seefahrer', desc: 'Schiffe und Boote haben +1 Bewegung; Start mit einem Boot.' } },
  oumaji: { name: 'Oumaji', color: 0xffff00, startTechs: [], startUnits: ['warrior'], bonusStars: 3, blurb: 'Wüstenreiter – +3 Sterne zum Start, Reiten ist schnell erforscht.', perk: { id: 'lookouts', name: 'Späher', desc: 'Reiter und Ritter sehen 1 Feld weiter.' } },
  hoodrick: { name: 'Hoodrick', color: 0x996600, startTechs: ['archery'], startUnits: ['archer', 'warrior'], bonusStars: 0, blurb: 'Waldläufer – startet mit Bogenschütze und Krieger.', perk: { id: 'longbow', name: 'Langbogen', desc: 'Bogenschützen kosten 1 Stern weniger und schießen aus dem Wald 1 Feld weiter.' } },
  quetzali: { name: 'Quetzali', color: 0x275c4a, startTechs: ['shields'], startUnits: ['defender'], bonusStars: 0, blurb: 'Startet mit Verteidiger.', perk: { id: 'guardians', name: 'Wächter', desc: 'Verteidiger kosten 1 Stern weniger.' } },
  vengir: { name: 'Vengir', color: 0xffffff, startTechs: ['smithery'], startUnits: ['swordsman'], bonusStars: 0, blurb: 'Kriegerisch – startet mit Schwertkämpfer.', perk: { id: 'forge', name: 'Schmiede', desc: 'Schwertkämpfer kosten 1 Stern weniger.' } },
  zebasi: { name: 'Zebasi', color: 0xff9900, startTechs: ['farming'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Savannenbauern – starke Wirtschaft.', perk: { id: 'harvest', name: 'Ernte', desc: 'Farmen bringen +1 Stern zusätzlich.' } },
  aimo: { name: 'Ai-Mo', color: 0x36e2aa, startTechs: ['meditation'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Weise – startet mit Meditation und günstiger Forschung.', perk: { id: 'wisdom', name: 'Weisheit', desc: 'Jede Technologie kostet 1 Stern weniger.' } },
  yadakk: { name: 'Yădakk', color: 0x7d231c, startTechs: ['roads'], startUnits: ['warrior'], bonusStars: 0, blurb: 'Händler der Steppe.', perk: { id: 'traders', name: 'Händler', desc: '+1 Stern pro Runde für je 2 Städte.' } },
  luxidoor: { name: 'Luxidoor', color: 0xab3bd6, startTechs: [], startUnits: ['warrior'], bonusStars: 3, blurb: 'Reich, aber ohne Starttechnologie (+3 Sterne).', perk: { id: 'splendor', name: 'Prunk', desc: 'Die Hauptstadt bringt +2 Sterne pro Runde.' } }
};

export const TRIBE_POOL = Object.keys(TRIBES);

export function tribeColor(tribeId) {
  const t = own(TRIBES, tribeId);
  return t ? t.color : COLORS.neutral;
}

// Kosten: Stufenfaktor × (1 + Städte) + 2 je bereits erforschter Technologie.
// Späte Stufen sind deutlich teurer, damit nicht jeder den ganzen Baum hat.
const TIER_FACTOR = [1, 2, 4, 6, 7, 8];
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
  mine: { name: 'Mine', tech: 'mining', terrain: ['mountain', 'hills'], cost: 6, pop: 1 },
  port: { name: 'Hafen', tech: 'sailing', terrain: ['water', 'ocean'], cost: 7, pop: 1 },
  temple: { name: 'Tempel', tech: 'meditation', terrain: ['field'], cost: 10, pop: 2 },
  // Ballonplatz: dort steigen Luft-Einheiten auf (wie Schiffe im Hafen).
  airfield: { name: 'Ballonplatz', tech: 'ballooning', terrain: ['field'], cost: 8, pop: 1 },
  // Gebäude mit Nachbarschaftsbonus (siehe rules.js: improvementIncome).
  mill: { name: 'Windmühle', tech: 'mills', terrain: ['field'], cost: 6, pop: 1, adjacent: { farm: 1 } },
  forge: { name: 'Schmelzhütte', tech: 'smelting', terrain: ['field'], cost: 6, pop: 1, adjacent: { mine: 2 }, adjacentTerrain: { mountain: 1 } },
  market: { name: 'Markt', tech: 'markets', terrain: ['field'], cost: 8, pop: 0, adjacent: { '*': 1 }, max: 5, resources: true },
  // Wachturm: weite Sicht; Einheiten darauf und daneben verteidigen anderthalbfach.
  watchtower: { name: 'Wachturm', tech: 'shields', terrain: ['field', 'mountain', 'hills'], cost: 5, pop: 0, sight: 3 },
  // Fischerhütte: am Wasser, lohnt neben Fischgründen.
  fishhut: { name: 'Fischerhütte', tech: 'fishing', terrain: ['water'], cost: 5, pop: 1, adjacentRes: { fish: 1 } },
  fort: { name: 'Burg', tech: 'castles', terrain: ['field', 'forest', 'hills'], cost: 10, pop: 0 },
  monastery: { name: 'Kloster', tech: 'monastic', terrain: ['field'], cost: 12, pop: 2 },
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
// Straßen: Schritt von Straße zu Straße (Städte und Brücken zählen mit) kostet
// halbe Bewegung. Bau im eigenen Gebiet über das Stadtmenü, sonst mit einer
// Einheit auf dem Feld (nicht in fremdem Gebiet).
export const ROAD = { tech: 'roads', cost: 3 };
// Auflösen einer Einheit erstattet diesen Anteil der Kosten.
export const DISBAND_REFUND = 0.5;
// Aufrüsten: Einheit → nächste Stufe derselben Gattung (Kosten = Preisunterschied).
export const UPGRADES = {
  warrior: 'swordsman', archer: 'crossbow', rider: 'knight',
  boat: 'ship', ship: 'battleship',
  balloon: 'airship'
};

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
  park: { name: 'Park', desc: '+2 Sterne pro Runde' },
  giant: { name: 'Riese', desc: 'Ein Riese (40 Leben) erscheint bei der Stadt, kostet 25 Sterne' }
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
// Beute: Sterne für jede besiegte gegnerische Einheit.
export const BOUNTY = 1;

// KI-Persönlichkeiten: Verhalten (siehe ai.js) und kurze Botschaften.
export const PERSONAS = {
  conqueror: {
    name: 'Eroberer', peace: 1.0,
    lines: {
      meet: ['Eure Mauern sehen zerbrechlich aus.', 'Beugt euch – oder brennt.', 'Noch ein Stamm, der bald mir gehört.'],
      war: ['Genug geredet. Zu den Waffen!', 'Euer Land wird meines sein.'],
      winCity: ['Diese Stadt gehört jetzt mir.', 'Eine Fahne weniger für euch.'],
      loseCity: ['Das werdet ihr bereuen!', 'Ein Rückschlag – mehr nicht.'],
      peaceYes: ['Fürs Erste. Aber vergesst nicht, wer stärker ist.'],
      peaceNo: ['Frieden? Mit euch? Niemals.', 'Kniet nieder, dann reden wir.'],
      doom: ['Mein Banner fällt … doch mein Name bleibt.']
    }
  },
  merchant: {
    name: 'Händler', peace: 1.6,
    lines: {
      meet: ['Willkommen, Fremder! Handel nützt uns beiden.', 'Schöne Straßen habt ihr. Noch.'],
      war: ['Das Geschäft verlangt es. Nichts Persönliches.'],
      winCity: ['Eine gute Investition.', 'Diese Stadt rechnet sich.'],
      loseCity: ['Das wird teuer für euch.', 'Ein schlechtes Geschäft!'],
      peaceYes: ['Ein Handschlag ist besser als ein Schwert.', 'Abgemacht – auf gute Geschäfte!'],
      peaceNo: ['Euer Angebot ist nichts wert.'],
      doom: ['Alles verloren … die Bücher schließen sich.']
    }
  },
  seafarer: {
    name: 'Seefahrer', peace: 1.25,
    lines: {
      meet: ['Ahoi! Das Meer gehört allen – meistens mir.', 'Seht ihr unsere Segel am Horizont?'],
      war: ['Hisst die Segel – Angriff!', 'Das Meer wird rot.'],
      winCity: ['Ein neuer Hafen für meine Flotte.'],
      loseCity: ['Die Gezeiten wenden sich wieder.', 'Wir kommen mit der Flut zurück!'],
      peaceYes: ['Ruhige See zwischen uns.'],
      peaceNo: ['Wir segeln lieber gegen den Wind.'],
      doom: ['Die letzte Flagge sinkt in die Wellen.']
    }
  },
  builder: {
    name: 'Baumeister', peace: 1.4,
    lines: {
      meet: ['Seht unsere Türme! Kommt uns nicht zu nahe.', 'Wir bauen für die Ewigkeit.'],
      war: ['Unsere Mauern schützen uns – eure nicht.'],
      winCity: ['Diese Stadt bauen wir schöner wieder auf.'],
      loseCity: ['Stein um Stein holen wir sie zurück.', 'Unsere Mauern … gefallen!'],
      peaceYes: ['Frieden lässt uns weiterbauen.'],
      peaceNo: ['Erst, wenn unsere Mauern fertig sind.'],
      doom: ['Unsere Werke überdauern uns.']
    }
  }
};

// Sonderregeln der Wochen-Herausforderung (eine je Kalenderwoche).
export const WEEKLY_RULES = {
  clearsky: { name: 'Klarer Himmel', desc: 'Kein Nebel – alle sehen die ganze Karte.' },
  fortress: { name: 'Festungen', desc: 'Jede Stadt startet mit Stadtmauer.' },
  riches: { name: 'Goldrausch', desc: 'Alle Stämme starten mit 25 Sternen.' },
  seafarers: { name: 'Seefahrer', desc: 'Inselkarte, alle kennen Fischerei und Segeln.' },
  titans: { name: 'Titanen', desc: 'Jede Hauptstadt startet mit einem Riesen.' },
  blitz: { name: 'Blitz', desc: 'Nur 20 Runden – schnell Punkte sammeln.' }
};

// --- Leuchttürme --------------------------------------------------------------
// In jeder Kartenecke steht ein Leuchtturm. Jeder Stamm kann jeden einmal
// erreichen (Schiff auf oder neben dem Turm): Sterne und Sicht auf die Umgebung,
// wer alle vier findet, bekommt einen Zusatzbonus.
export const LIGHTHOUSE = { stars: 3, reveal: 3, allBonus: 5 };

// --- Söldnerlager -------------------------------------------------------------
// Neutrale Lager abseits der Startstädte. Eine eigene Landeinheit auf dem Lager
// wirbt die angebotene Einheit an – ohne Technologie, einmal je Stamm und Lager.
// `count` je Kartengröße, `minDist` = Abstand zu jeder Stadt.
export const MERC = {
  count: { small: 2, normal: 3, large: 4 },
  minDist: 4,
  types: ['swordsman', 'crossbow', 'knight', 'pikeman', 'horsearcher', 'catapult'],
  extra: 2
};

// --- Spielmodi & Schwierigkeit ---------------------------------------------
export const GAME_MODES = {
  conquest: { label: 'Eroberung', turnLimit: null },
  perfection: { label: 'Perfektion (30 Runden)', turnLimit: 30 }
};
export const AI_LEVELS = {
  // grace: so viele Runden greift die KI Menschen nicht an (außer sie werden angegriffen).
  easy: { label: 'Leicht', incomeFactor: 0.7, incomeBonus: 0, startBonus: 0, grace: 12 },
  normal: { label: 'Normal', incomeFactor: 1, incomeBonus: 0, startBonus: 0, grace: 6 },
  hard: { label: 'Schwer', incomeFactor: 1, incomeBonus: 2, startBonus: 3, grace: 0 }
};
// Punktewertung (Perfektion und Endstatistik).
export const SCORE = {
  city: 100, pop: 40, reward: 20, tech: 50, unitCost: 5, explored: 2, improvement: 30, ruin: 40, lighthouse: 40, monument: 200
};
