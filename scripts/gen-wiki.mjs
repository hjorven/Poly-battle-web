// Erzeugt die Datenseiten des Wikis (Einheiten, Stämme, Technologien,
// Gebäude, Kampagne) direkt aus den Spieldaten, damit sie nie veralten.
// Zwei Sprachen: Englisch (Hauptsprache, docs/wiki/) und Deutsch (docs/wiki/de/).
// Die Spieldaten sind deutsch; die englischen Texte stehen in scripts/wiki-en.json,
// Schlüssel ist jeweils der deutsche Text. Fehlt eine Übersetzung, bricht das Skript ab
// und nennt die fehlenden Texte, damit die englischen Seiten nie still veralten.
// Aufruf: npm run wiki

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import {
  UNITS, UNIT_ORDER, ABILITY_INFO, TRIBES, TRIBE_POOL, TECHS, IMPROVEMENTS, MONUMENTS, MONUMENT_POP,
  TERRAIN, RESOURCES, CITY_REWARDS, REWARD_CHOICES, UPGRADES, ROAD, BRIDGE, WEEKLY_RULES, AI_LEVELS, PERSONAS, MAP_TYPES, MAP_SIZES, MERC
} from '../js/config.js';
import { MISSIONS } from '../js/campaign.js';

const EN = JSON.parse(readFileSync(new URL('./wiki-en.json', import.meta.url), 'utf8'));
const missing = new Set();
const row = cells => '| ' + cells.join(' | ') + ' |';
const sep = n => row(Array(n).fill('---'));

// Seitennamen: Die deutschen Seiten behalten ihre alten Namen, damit bestehende Links weiter funktionieren.
const PAGES = {
  units: { en: 'Units', de: 'Einheiten' },
  tribes: { en: 'Tribes', de: 'Staemme' },
  techs: { en: 'Technologies', de: 'Technologien' },
  cities: { en: 'Cities-and-Buildings', de: 'Staedte-und-Gebaeude' },
  campaign: { en: 'Campaign-and-Challenges', de: 'Kampagne-und-Herausforderungen' }
};

// Sprachabhängige Textbausteine. Alles, was aus den Spieldaten kommt, läuft über tr().
const TEXT = {
  de: {
    dir: '../docs/wiki/de/',
    other: 'English',
    head: '> Diese Seite wird aus den Spieldaten erzeugt (`npm run wiki`). Änderungen bitte in `js/config.js` bzw. `js/campaign.js` machen.',
    tr: s => s,
    num: n => String(n).replace('.', ','),
    none: '–',
    units: {
      title: 'Einheiten',
      intro: 'Werte: Kosten in Sternen, Leben, Angriff, Verteidigung, Bewegung, Reichweite. Veteranen (nach 3 Siegen) bekommen zusätzliches Leben.',
      groups: ['Landeinheiten', 'Schiffe', 'Luft-Einheiten'],
      cols: ['Einheit', 'Kosten', 'Leben', 'Angriff', 'Verteidigung', 'Bewegung', 'Reichweite', 'Technologie', 'Fähigkeiten'],
      reward: ' (nur als Belohnung)',
      abilities: 'Fähigkeiten', abCols: ['Fähigkeit', 'Wirkung'],
      upgrade: 'Aufrüsten',
      upgradeIntro: 'Steht eine Einheit zu Zugbeginn im eigenen Gebiet, kann sie gegen den Preisunterschied aufgerüstet werden (Technologie nötig, verbraucht den Zug):',
      upgradeLine: (a, b) => `- ${a} wird zu ${b}`
    },
    tribes: {
      title: 'Stämme',
      intro: 'Jeder Stamm startet mit einer Technologie, einer Einheit und einer Besonderheit.',
      cols: ['Stamm', 'Start-Technologie', 'Start-Einheit', 'Besonderheit'],
      noTech: n => `keine (+${n} Sterne)`,
      personas: 'KI-Persönlichkeiten',
      personasIntro: 'Jeder KI-Stamm bekommt zu Spielbeginn eine Persönlichkeit. Sie bestimmt, wie gern er angreift, baut oder Frieden schließt.',
      personaLine: (n, l) => `- **${n}** – zum Beispiel: „${l}“`,
      levels: 'KI-Stärke',
      levelCols: ['Stufe', 'Einkommen', 'Extra-Einkommen', 'Extra-Startsterne', 'Schonfrist bis Runde'],
      noGrace: 'keine'
    },
    techs: {
      title: 'Technologien',
      intro: n => `Der Forschungsbaum hat ${n} Technologien in fünf Stufen. Die Kosten steigen mit der Stufe, der Zahl deiner Städte und der Zahl bereits erforschter Technologien.`,
      cols: ['Stufe', 'Technologie', 'Voraussetzung', 'Bringt']
    },
    cities: {
      title: 'Städte und Gebäude',
      levels: 'Stadtstufen',
      levelsIntro: 'Wächst eine Stadt auf eine neue Stufe, wählst du eine von zwei Belohnungen:',
      levelCols: ['Stufe', 'Wahl 1', 'Wahl 2'],
      buildings: 'Gebäude',
      buildingsIntro: 'Gebaut wird im Stadtmenü über **Ausbauen**: Feld im Stadtgebiet antippen, dann das Gebäude wählen.',
      buildCols: ['Gebäude', 'Kosten', 'Gelände', 'Technologie', 'Ertrag'],
      perTurn: n => `+${n} pro Runde`,
      adjBuilding: v => `+${v} je angrenzendem Gebäude`,
      adjNamed: (v, n) => `+${v} je angrenzender ${n}`,
      upTo: n => ` (bis ${n})`,
      resCount: ', Rohstoffe zählen mit',
      adjTerrain: (v, n) => `+${v} je angrenzendem ${n} ohne Gebäude`,
      adjFish: v => `+${v} je angrenzendem Fischgrund`,
      sight: n => `Sicht ${n} Felder; Einheiten darauf und daneben verteidigen anderthalbfach`,
      fort: 'Einheiten darauf verteidigen dreifach',
      monastery: n => `+${n}, Einheiten im Gebiet heilen mehr`,
      special: 'Sonderwirkung',
      road: c => `| **Weg** | ${c[0]} | Land | ${c[1]} | Schritt von Weg zu Weg kostet halbe Bewegung |`,
      bridge: c => `| **Brücke** | ${c[0]} je Feld | Flachwasser, bis ${c[2]} Felder | ${c[1]} | Landeinheiten überqueren Wasser |`,
      monuments: 'Monumente',
      monumentsIntro: p => `Monumente sind kostenlos, jeder Stamm baut jedes einmal, auf Feld oder Wald im Stadtgebiet. Jedes bringt der Stadt +${p} Bevölkerung und 200 Punkte.`,
      monCols: ['Monument', 'Freigeschaltet durch'],
      terrain: 'Gelände und Rohstoffe',
      terrCols: ['Gelände', 'Begehbar', 'Bewegung', 'Verteidigung', 'Betreten mit', 'Besonderheit'],
      yes: 'ja', noShips: 'nein (Schiffe)',
      factor: f => `${f}-fach`,
      stop: 'Betreten beendet die Bewegung',
      seeFurther: n => `Einheiten darauf sehen ${n} Feld weiter`,
      resources: l => `Rohstoffe im Stadtgebiet bringen Ertrag, solange nichts darauf gebaut ist: ${l}.`,
      merc: 'Söldnerlager',
      mercIntro: (counts, extra) => `Je nach Kartengröße gibt es ${counts} Lager. Eine eigene Landeinheit auf dem Lager wirbt die angebotene Einheit an, ohne die nötige Technologie. Jeder Stamm nutzt jedes Lager einmal, das verbraucht den Zug der Einheit. Preis: normale Kosten + ${extra} Sterne.`,
      mercCols: ['Mögliches Angebot', 'Preis'],
      lower: s => s.toLowerCase()
    },
    campaign: {
      title: 'Kampagne und Herausforderungen',
      campaign: 'Kampagne',
      intro: 'Missionen mit festem Aufbau. Ziel erreicht = 1 Stern, schneller als die Vorgaben = 2 oder 3 Sterne. Jede Mission schaltet die nächste frei.',
      cols: ['Nr.', 'Mission', 'Ziel', 'Stamm', 'Karte', 'Gegner', '2 / 3 Sterne bis Runde'],
      noGrace: ', ohne Schonfrist',
      defaultStars: 'Sterne für 3 bzw. 5 Städte am Ende',
      weekly: 'Wochen-Herausforderung',
      weeklyIntro: 'Jede Woche eine feste Karte mit einer dieser Sonderregeln:',
      daily: 'Tagesherausforderung',
      dailyText: 'Jeden Tag dieselbe Karte und derselbe Stamm für alle, 30 Runden. Es zählt die Punktzahl. Mit Namen erscheinst du in der Bestenliste.'
    }
  },
  en: {
    dir: '../docs/wiki/',
    other: 'Deutsch',
    head: '> This page is generated from the game data (`npm run wiki`). Please make changes in `js/config.js` or `js/campaign.js`; English texts live in `scripts/wiki-en.json`.',
    tr: s => {
      if (s == null || s === '') return s;
      if (!(s in EN)) { missing.add(s); return s; }
      return EN[s];
    },
    num: n => String(n),
    none: '–',
    units: {
      title: 'Units',
      intro: 'Stats: cost in stars, health, attack, defence, movement, range. Veterans (after 3 victories) gain extra health.',
      groups: ['Land units', 'Ships', 'Air units'],
      cols: ['Unit', 'Cost', 'Health', 'Attack', 'Defence', 'Movement', 'Range', 'Technology', 'Abilities'],
      reward: ' (reward only)',
      abilities: 'Abilities', abCols: ['Ability', 'Effect'],
      upgrade: 'Upgrading',
      upgradeIntro: 'A unit that starts its turn inside your own territory can be upgraded for the difference in price (requires the technology, uses up its turn):',
      upgradeLine: (a, b) => `- ${a} becomes ${b}`
    },
    tribes: {
      title: 'Tribes',
      intro: 'Every tribe starts with one technology, one unit and one special trait.',
      cols: ['Tribe', 'Starting technology', 'Starting unit', 'Special trait'],
      noTech: n => `none (+${n} stars)`,
      personas: 'AI personalities',
      personasIntro: 'Every AI tribe gets a personality at the start of the game. It decides how eager the tribe is to attack, build or make peace.',
      personaLine: (n, l) => `- **${n}** – for example: “${l}”`,
      levels: 'AI difficulty',
      levelCols: ['Level', 'Income', 'Extra income', 'Extra starting stars', 'Grace period until turn'],
      noGrace: 'none'
    },
    techs: {
      title: 'Technologies',
      intro: n => `The tech tree has ${n} technologies in five tiers. Costs rise with the tier, the number of your cities and the number of technologies you have already researched.`,
      cols: ['Tier', 'Technology', 'Requires', 'Unlocks']
    },
    cities: {
      title: 'Cities and Buildings',
      levels: 'City levels',
      levelsIntro: 'When a city grows to a new level, you pick one of two rewards:',
      levelCols: ['Level', 'Choice 1', 'Choice 2'],
      buildings: 'Buildings',
      buildingsIntro: 'You build from the city menu with **Ausbauen** (Build): tap a tile in the city area, then choose the building.',
      buildCols: ['Building', 'Cost', 'Terrain', 'Technology', 'Yield'],
      perTurn: n => `+${n} per turn`,
      adjBuilding: v => `+${v} per adjacent building`,
      adjNamed: (v, n) => `+${v} per adjacent ${n}`,
      upTo: n => ` (up to ${n})`,
      resCount: ', resources count too',
      adjTerrain: (v, n) => `+${v} per adjacent ${n} without a building`,
      adjFish: v => `+${v} per adjacent fishing ground`,
      sight: n => `Sight ${n} tiles; units on and next to it defend at 1.5×`,
      fort: 'Units on it defend at 3×',
      monastery: n => `+${n}, units in the territory heal more`,
      special: 'Special effect',
      road: c => `| **Road** | ${c[0]} | Land | ${c[1]} | Moving from road to road costs half a movement point |`,
      bridge: c => `| **Bridge** | ${c[0]} per tile | Shallow water, up to ${c[2]} tiles | ${c[1]} | Land units can cross water |`,
      monuments: 'Monuments',
      monumentsIntro: p => `Monuments are free. Every tribe can build each one once, on a field or forest tile in a city area. Each gives the city +${p} population and 200 points.`,
      monCols: ['Monument', 'Unlocked by'],
      terrain: 'Terrain and resources',
      terrCols: ['Terrain', 'Walkable', 'Movement', 'Defence', 'Entry requires', 'Notes'],
      yes: 'yes', noShips: 'no (ships)',
      factor: f => `${f}×`,
      stop: 'Entering ends movement',
      seeFurther: n => `Units on it see ${n} tile further`,
      resources: l => `Resources in a city area give a yield as long as nothing is built on them: ${l}.`,
      merc: 'Mercenary camps',
      mercIntro: (counts, extra) => `Depending on map size there are ${counts} camps. One of your land units standing on a camp can hire the unit on offer, even without the required technology. Every tribe can use each camp once, which uses up the unit's turn. Price: normal cost + ${extra} stars.`,
      mercCols: ['Possible offer', 'Price'],
      lower: s => s.toLowerCase()
    },
    campaign: {
      title: 'Campaign and Challenges',
      campaign: 'Campaign',
      intro: 'Missions with a fixed setup. Reaching the goal = 1 star, beating the target turns = 2 or 3 stars. Each mission unlocks the next one.',
      cols: ['No.', 'Mission', 'Goal', 'Tribe', 'Map', 'Opponents', '2 / 3 stars by turn'],
      noGrace: ', no grace period',
      defaultStars: 'Stars for 3 or 5 cities at the end',
      weekly: 'Weekly challenge',
      weeklyIntro: 'Every week brings a fixed map with one of these special rules:',
      daily: 'Daily challenge',
      dailyText: 'Every day, everyone gets the same map and the same tribe for 30 turns. Your score counts. With a name you appear on the leaderboard.'
    }
  }
};

function generate(lang) {
  const L = TEXT[lang];
  const tr = L.tr;
  const OUT = new URL(L.dir, import.meta.url);
  mkdirSync(OUT, { recursive: true });
  const otherLang = lang === 'en' ? 'de' : 'en';
  // Kopfzeile jeder Seite: Sprachumschalter und Hinweis auf die Erzeugung.
  const page = (key, title, body) => {
    const top = `# ${title}\n\n**${lang === 'en' ? 'English' : 'Deutsch'}** · [${L.other}](${PAGES[key][otherLang]})\n\n${L.head}\n\n`;
    writeFileSync(new URL(PAGES[key][lang] + '.md', OUT), (top + body).trimEnd() + '\n');
  };
  const techName = id => (id && TECHS[id] ? tr(TECHS[id].name) : L.none);
  const terr = list => list.map(t => tr(TERRAIN[t].name)).join(', ');
  const fmt = L.num;

  // --- Einheiten ---------------------------------------------------------------------
  {
    const T = L.units;
    // Ausgemusterte Einheiten stehen nicht mehr im Wiki.
    const order = [...UNIT_ORDER, ...Object.keys(UNITS).filter(t => !UNIT_ORDER.includes(t) && !UNITS[t].retired)];
    const picks = [
      t => !UNITS[t].abilities.includes('water') && !UNITS[t].abilities.includes('air'),
      t => UNITS[t].abilities.includes('water'),
      t => UNITS[t].abilities.includes('air')
    ];
    let md = T.intro + '\n\n';
    picks.forEach((pick, i) => {
      md += `## ${T.groups[i]}\n\n` + row(T.cols) + '\n' + sep(9) + '\n';
      for (const t of order.filter(pick)) {
        const u = UNITS[t];
        const ab = u.abilities.filter(a => a !== 'land' && a !== 'water' && ABILITY_INFO[a]).map(a => tr(ABILITY_INFO[a].name)).join(', ') || L.none;
        md += row([`**${tr(u.name)}**${u.reward ? T.reward : ''}`, u.cost, u.hp, fmt(u.atk), u.def, u.move, u.range, techName(u.tech), ab]) + '\n';
      }
      md += '\n';
    });
    md += `## ${T.abilities}\n\n` + row(T.abCols) + '\n' + sep(2) + '\n';
    for (const a of Object.values(ABILITY_INFO)) md += row([`**${tr(a.name)}**`, tr(a.desc)]) + '\n';
    md += `\n## ${T.upgrade}\n\n${T.upgradeIntro}\n\n`;
    for (const [from, to] of Object.entries(UPGRADES)) md += T.upgradeLine(tr(UNITS[from].name), tr(UNITS[to].name)) + '\n';
    page('units', T.title, md);
  }

  // --- Stämme -------------------------------------------------------------------------
  {
    const T = L.tribes;
    let md = T.intro + '\n\n' + row(T.cols) + '\n' + sep(4) + '\n';
    for (const id of TRIBE_POOL) {
      const t = TRIBES[id];
      const tech = t.startTechs.length ? t.startTechs.map(techName).join(', ') : T.noTech(t.bonusStars);
      md += row([`**${tr(t.name)}**`, tech, t.startUnits.map(u => tr(UNITS[u].name)).join(', '), t.perk ? `${tr(t.perk.name)}: ${tr(t.perk.desc)}` : L.none]) + '\n';
    }
    md += `\n## ${T.personas}\n\n${T.personasIntro}\n\n`;
    for (const p of Object.values(PERSONAS)) md += T.personaLine(tr(p.name), tr(p.lines.meet[0])) + '\n';
    md += `\n## ${T.levels}\n\n` + row(T.levelCols) + '\n' + sep(5) + '\n';
    for (const l of Object.values(AI_LEVELS)) md += row([tr(l.label), `${Math.round(l.incomeFactor * 100)} %`, `+${l.incomeBonus}`, `+${l.startBonus}`, l.grace || T.noGrace]) + '\n';
    page('tribes', T.title, md);
  }

  // --- Technologien -------------------------------------------------------------------
  {
    const T = L.techs;
    const roots = Object.keys(TECHS).filter(t => !TECHS[t].req);
    const kids = id => Object.keys(TECHS).filter(t => TECHS[t].req === id);
    let md = T.intro(Object.keys(TECHS).length) + '\n\n';
    for (const r of roots) {
      md += `## ${tr(TECHS[r].name)}\n\n` + row(T.cols) + '\n' + sep(4) + '\n';
      const walk = id => { const t = TECHS[id]; md += row([t.tier, `**${tr(t.name)}**`, techName(t.req), tr(t.desc || '')]) + '\n'; kids(id).forEach(walk); };
      walk(r);
      md += '\n';
    }
    page('techs', T.title, md);
  }

  // --- Städte und Gebäude -------------------------------------------------------------
  {
    const T = L.cities;
    let md = `## ${T.levels}\n\n${T.levelsIntro}\n\n` + row(T.levelCols) + '\n' + sep(3) + '\n';
    const reward = id => `**${tr(CITY_REWARDS[id].name)}**: ${tr(CITY_REWARDS[id].desc)}`;
    for (const [lvl, [a, b]] of Object.entries(REWARD_CHOICES)) md += row([lvl, reward(a), reward(b)]) + '\n';
    md += `\n## ${T.buildings}\n\n${T.buildingsIntro}\n\n` + row(T.buildCols) + '\n' + sep(5) + '\n';
    for (const [id, d] of Object.entries(IMPROVEMENTS).filter(([, d]) => !d.monument)) {
      let y = d.pop ? T.perTurn(d.pop) : '';
      if (d.adjacent) y = Object.entries(d.adjacent).map(([k, v]) => k === '*' ? T.adjBuilding(v) : T.adjNamed(v, tr(IMPROVEMENTS[k].name))).join(', ') + (d.max ? T.upTo(d.max) : '');
      if (d.adjacent) y = (d.pop ? `+${d.pop}, ` : '') + y + (d.resources ? T.resCount : '');
      if (d.adjacentTerrain) y += ', ' + Object.entries(d.adjacentTerrain).map(([k, v]) => T.adjTerrain(v, tr(TERRAIN[k].name))).join(', ');
      if (d.adjacentRes) y += ', ' + Object.values(d.adjacentRes).map(v => T.adjFish(v)).join(', ');
      if (d.sight) y = T.sight(d.sight);
      if (id === 'fort') y = T.fort;
      if (id === 'monastery') y = T.monastery(d.pop);
      md += row([`**${tr(d.name)}**`, d.cost, terr(d.terrain), techName(d.tech), y || T.special]) + '\n';
    }
    md += T.road([ROAD.cost, techName(ROAD.tech)]) + '\n';
    md += T.bridge([BRIDGE.costPerTile, techName(BRIDGE.tech), BRIDGE.maxLen]) + '\n';
    md += `\n## ${T.monuments}\n\n${T.monumentsIntro(MONUMENT_POP)}\n\n` + row(T.monCols) + '\n' + sep(2) + '\n';
    for (const [id, m] of Object.entries(MONUMENTS)) md += row([`**${tr(IMPROVEMENTS[id].name)}**`, tr(m.goal)]) + '\n';
    md += `\n## ${T.terrain}\n\n` + row(T.terrCols) + '\n' + sep(6) + '\n';
    for (const t of Object.values(TERRAIN)) {
      const note = [t.stop ? T.stop : '', t.sight ? T.seeFurther(t.sight) : ''].filter(Boolean).join(', ') || L.none;
      md += row([tr(t.name), t.walkable ? T.yes : T.noShips, t.move, T.factor(fmt(t.def)), techName(t.enterTech), note]) + '\n';
    }
    md += '\n' + T.resources(Object.values(RESOURCES).map(r => `${tr(r.name)} (${terr(r.terrain)})`).join(', ')) + '\n';
    const counts = Object.entries(MAP_SIZES).map(([k, v]) => `${MERC.count[k]} (${T.lower(tr(v.label))})`).join(', ');
    md += `\n## ${T.merc}\n\n${T.mercIntro(counts, MERC.extra)}\n\n` + row(T.mercCols) + '\n' + sep(2) + '\n';
    for (const t of MERC.types) md += row([tr(UNITS[t].name), UNITS[t].cost + MERC.extra]) + '\n';
    page('cities', T.title, md);
  }

  // --- Kampagne und Wochenregeln ------------------------------------------------------
  {
    const T = L.campaign;
    let md = `## ${T.campaign}\n\n${T.intro}\n\n` + row(T.cols) + '\n' + sep(7) + '\n';
    MISSIONS.forEach((m, i) => {
      const s = m.setup;
      md += row([i + 1, `**${tr(m.title)}**`, tr(m.goal), tr(TRIBES[s.tribe].name), `${tr(MAP_SIZES[s.mapSize].label)}, ${tr(MAP_TYPES[s.mapType].label)}`, `${s.count - 1}, ${tr(AI_LEVELS[s.aiLevel].label)}${s.rule === 'nograce' ? T.noGrace : ''}`, m.par ? `${m.par[0]} / ${m.par[1]}` : (m.starHint ? tr(m.starHint) : T.defaultStars)]) + '\n';
    });
    md += `\n## ${T.weekly}\n\n${T.weeklyIntro}\n\n`;
    for (const r of Object.values(WEEKLY_RULES)) md += `- **${tr(r.name)}**: ${tr(r.desc)}\n`;
    md += `\n## ${T.daily}\n\n${T.dailyText}\n`;
    page('campaign', T.title, md);
  }
}

generate('de');
generate('en');

if (missing.size) {
  console.error(`Es fehlen ${missing.size} englische Texte in scripts/wiki-en.json (deutscher Text als Schlüssel):`);
  for (const s of missing) console.error('  ' + JSON.stringify(s));
  process.exit(1);
}
console.log('Wiki-Datenseiten geschrieben nach docs/wiki/ (Englisch) und docs/wiki/de/ (Deutsch)');
