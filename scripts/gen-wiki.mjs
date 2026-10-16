// Erzeugt die Datenseiten des Wikis (Einheiten, Stämme, Technologien,
// Gebäude, Kampagne) direkt aus den Spieldaten, damit sie nie veralten.
// Aufruf: npm run wiki   → schreibt nach docs/wiki/

import { writeFileSync, mkdirSync } from 'node:fs';
import {
  UNITS, UNIT_ORDER, ABILITY_INFO, TRIBES, TRIBE_POOL, TECHS, IMPROVEMENTS, MONUMENTS, MONUMENT_POP,
  TERRAIN, RESOURCES, CITY_REWARDS, REWARD_CHOICES, UPGRADES, ROAD, BRIDGE, WEEKLY_RULES, AI_LEVELS, PERSONAS, MAP_TYPES, MAP_SIZES, MERC
} from '../js/config.js';
import { MISSIONS } from '../js/campaign.js';

const OUT = new URL('../docs/wiki/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const HEAD = '> Diese Seite wird aus den Spieldaten erzeugt (`npm run wiki`). Änderungen bitte in `js/config.js` bzw. `js/campaign.js` machen.\n\n';
const write = (name, text) => writeFileSync(new URL(name + '.md', OUT), text.trimEnd() + '\n');
const techName = id => (id && TECHS[id] ? TECHS[id].name : '–');
const terr = list => list.map(t => TERRAIN[t].name).join(', ');
const row = cells => '| ' + cells.join(' | ') + ' |';
const fmt = n => String(n).replace('.', ',');

// --- Einheiten ---------------------------------------------------------------------
{
  const order = [...UNIT_ORDER, ...Object.keys(UNITS).filter(t => !UNIT_ORDER.includes(t))];
  const groups = [
    ['Landeinheiten', t => !UNITS[t].abilities.includes('water') && !UNITS[t].abilities.includes('air')],
    ['Schiffe', t => UNITS[t].abilities.includes('water')],
    ['Luft-Einheiten', t => UNITS[t].abilities.includes('air')]
  ];
  let md = '# Einheiten\n\n' + HEAD;
  md += 'Werte: Kosten in Sternen, Leben, Angriff, Verteidigung, Bewegung, Reichweite. Veteranen (nach 3 Siegen) bekommen zusätzliches Leben.\n\n';
  for (const [title, pick] of groups) {
    md += `## ${title}\n\n` + row(['Einheit', 'Kosten', 'Leben', 'Angriff', 'Verteidigung', 'Bewegung', 'Reichweite', 'Technologie', 'Fähigkeiten']) + '\n';
    md += row(Array(9).fill('---')) + '\n';
    for (const t of order.filter(pick)) {
      const u = UNITS[t];
      const ab = u.abilities.filter(a => a !== 'land' && a !== 'water' && ABILITY_INFO[a]).map(a => ABILITY_INFO[a].name).join(', ') || '–';
      md += row([`**${u.name}**${u.reward ? ' (nur als Belohnung)' : ''}`, u.reward ? '–' : u.cost, u.hp, fmt(u.atk), u.def, u.move, u.range, techName(u.tech), ab]) + '\n';
    }
    md += '\n';
  }
  md += '## Fähigkeiten\n\n' + row(['Fähigkeit', 'Wirkung']) + '\n' + row(['---', '---']) + '\n';
  for (const [, a] of Object.entries(ABILITY_INFO)) md += row([`**${a.name}**`, a.desc]) + '\n';
  md += '\n## Aufrüsten\n\nSteht eine Einheit zu Zugbeginn im eigenen Gebiet, kann sie gegen den Preisunterschied aufgerüstet werden (Technologie nötig, verbraucht den Zug):\n\n';
  for (const [from, to] of Object.entries(UPGRADES)) md += `- ${UNITS[from].name} wird zu ${UNITS[to].name}\n`;
  write('Einheiten', md);
}

// --- Stämme -------------------------------------------------------------------------
{
  let md = '# Stämme\n\n' + HEAD + 'Jeder Stamm startet mit einer Technologie, einer Einheit und einer Besonderheit.\n\n';
  md += row(['Stamm', 'Start-Technologie', 'Start-Einheit', 'Besonderheit']) + '\n' + row(['---', '---', '---', '---']) + '\n';
  for (const id of TRIBE_POOL) {
    const t = TRIBES[id];
    const tech = t.startTechs.length ? t.startTechs.map(techName).join(', ') : `keine (+${t.bonusStars} Sterne)`;
    md += row([`**${t.name}**`, tech, t.startUnits.map(u => UNITS[u].name).join(', '), t.perk ? `${t.perk.name}: ${t.perk.desc}` : '–']) + '\n';
  }
  md += '\n## KI-Persönlichkeiten\n\nJeder KI-Stamm bekommt zu Spielbeginn eine Persönlichkeit. Sie bestimmt, wie gern er angreift, baut oder Frieden schließt.\n\n';
  for (const p of Object.values(PERSONAS)) md += `- **${p.name}** – zum Beispiel: „${p.lines.meet[0]}“\n`;
  md += '\n## KI-Stärke\n\n' + row(['Stufe', 'Einkommen', 'Extra-Einkommen', 'Extra-Startsterne', 'Schonfrist bis Runde']) + '\n' + row(Array(5).fill('---')) + '\n';
  for (const l of Object.values(AI_LEVELS)) md += row([l.label, `${Math.round(l.incomeFactor * 100)} %`, `+${l.incomeBonus}`, `+${l.startBonus}`, l.grace || 'keine']) + '\n';
  write('Staemme', md);
}

// --- Technologien -------------------------------------------------------------------
{
  const roots = Object.keys(TECHS).filter(t => !TECHS[t].req);
  const kids = id => Object.keys(TECHS).filter(t => TECHS[t].req === id);
  let md = '# Technologien\n\n' + HEAD;
  md += `Der Forschungsbaum hat ${Object.keys(TECHS).length} Technologien in sechs Stufen. Die Kosten steigen mit der Stufe, der Zahl deiner Städte und der Zahl bereits erforschter Technologien.\n\n`;
  for (const r of roots) {
    md += `## ${TECHS[r].name}\n\n` + row(['Stufe', 'Technologie', 'Voraussetzung', 'Bringt']) + '\n' + row(['---', '---', '---', '---']) + '\n';
    const walk = id => { const t = TECHS[id]; md += row([t.tier, `**${t.name}**`, techName(t.req), t.desc || '']) + '\n'; kids(id).forEach(walk); };
    walk(r);
    md += '\n';
  }
  write('Technologien', md);
}

// --- Städte und Gebäude -------------------------------------------------------------
{
  let md = '# Städte und Gebäude\n\n' + HEAD;
  md += '## Stadtstufen\n\nWächst eine Stadt auf eine neue Stufe, wählst du eine von zwei Belohnungen:\n\n' + row(['Stufe', 'Wahl 1', 'Wahl 2']) + '\n' + row(['---', '---', '---']) + '\n';
  for (const [lvl, [a, b]] of Object.entries(REWARD_CHOICES)) md += row([lvl, `**${CITY_REWARDS[a].name}**: ${CITY_REWARDS[a].desc}`, `**${CITY_REWARDS[b].name}**: ${CITY_REWARDS[b].desc}`]) + '\n';
  md += '\n## Gebäude\n\nGebaut wird im Stadtmenü über **Ausbauen**: Feld im Stadtgebiet antippen, dann das Gebäude wählen.\n\n';
  md += row(['Gebäude', 'Kosten', 'Gelände', 'Technologie', 'Ertrag']) + '\n' + row(Array(5).fill('---')) + '\n';
  for (const [id, d] of Object.entries(IMPROVEMENTS).filter(([, d]) => !d.monument)) {
    let y = d.pop ? `+${d.pop} pro Runde` : '';
    if (d.adjacent) y = Object.entries(d.adjacent).map(([k, v]) => `+${v} je angrenzende${k === '*' ? 'm Gebäude' : 'r ' + IMPROVEMENTS[k].name}`).join(', ') + (d.max ? ` (bis ${d.max})` : '');
    if (d.adjacent) y = (d.pop ? `+${d.pop}, ` : '') + y + (d.resources ? ', Rohstoffe zählen mit' : '');
    if (d.adjacentTerrain) y += ', ' + Object.entries(d.adjacentTerrain).map(([k, v]) => `+${v} je angrenzendem ${TERRAIN[k].name} ohne Gebäude`).join(', ');
    if (d.adjacentRes) y += ', ' + Object.entries(d.adjacentRes).map(([k, v]) => `+${v} je angrenzendem Fischgrund`).join(', ');
    if (d.sight) y = `Sicht ${d.sight} Felder; Einheiten darauf und daneben verteidigen anderthalbfach`;
    if (id === 'fort') y = 'Einheiten darauf verteidigen dreifach';
    if (id === 'monastery') y = `+${d.pop}, Einheiten im Gebiet heilen mehr`;
    md += row([`**${d.name}**`, d.cost, terr(d.terrain), techName(d.tech), y || 'Sonderwirkung']) + '\n';
  }
  md += `| **Weg** | ${ROAD.cost} | Land | ${techName(ROAD.tech)} | Schritt von Weg zu Weg kostet halbe Bewegung |\n`;
  md += `| **Brücke** | ${BRIDGE.costPerTile} je Feld | Flachwasser, bis ${BRIDGE.maxLen} Felder | ${techName(BRIDGE.tech)} | Landeinheiten überqueren Wasser |\n`;
  md += `\n## Monumente\n\nMonumente sind kostenlos, jeder Stamm baut jedes einmal, auf Feld oder Wald im Stadtgebiet. Jedes bringt der Stadt +${MONUMENT_POP} Bevölkerung und 200 Punkte.\n\n`;
  md += row(['Monument', 'Freigeschaltet durch']) + '\n' + row(['---', '---']) + '\n';
  for (const [id, m] of Object.entries(MONUMENTS)) md += row([`**${IMPROVEMENTS[id].name}**`, m.goal]) + '\n';
  md += '\n## Gelände und Rohstoffe\n\n' + row(['Gelände', 'Begehbar', 'Bewegung', 'Verteidigung', 'Betreten mit', 'Besonderheit']) + '\n' + row(Array(6).fill('---')) + '\n';
  for (const t of Object.values(TERRAIN)) {
    const note = [t.stop ? 'Betreten beendet die Bewegung' : '', t.sight ? `Einheiten darauf sehen ${t.sight} Feld weiter` : ''].filter(Boolean).join(', ') || '–';
    md += row([t.name, t.walkable ? 'ja' : 'nein (Schiffe)', t.move, `${fmt(t.def)}-fach`, techName(t.enterTech), note]) + '\n';
  }
  md += '\nRohstoffe im Stadtgebiet bringen Ertrag, solange nichts darauf gebaut ist: ' + Object.values(RESOURCES).map(r => `${r.name} (${terr(r.terrain)})`).join(', ') + '.\n';
  md += '\n## Söldnerlager\n\nJe nach Kartengröße gibt es ' + Object.entries(MAP_SIZES).map(([k, v]) => `${MERC.count[k]} (${v.label.toLowerCase()})`).join(', ') + ' Lager. Eine eigene Landeinheit auf dem Lager wirbt die angebotene Einheit an, ohne die nötige Technologie. Jeder Stamm nutzt jedes Lager einmal, das verbraucht den Zug der Einheit. Preis: normale Kosten + ' + MERC.extra + ' Sterne.\n\n';
  md += row(['Mögliches Angebot', 'Preis']) + '\n' + row(['---', '---']) + '\n';
  for (const t of MERC.types) md += row([UNITS[t].name, UNITS[t].cost + MERC.extra]) + '\n';
  write('Staedte-und-Gebaeude', md);
}

// --- Kampagne und Wochenregeln ------------------------------------------------------
{
  let md = '# Kampagne und Herausforderungen\n\n' + HEAD;
  md += '## Kampagne\n\nMissionen mit festem Aufbau. Ziel erreicht = 1 Stern, schneller als die Vorgaben = 2 oder 3 Sterne. Jede Mission schaltet die nächste frei.\n\n';
  md += row(['Nr.', 'Mission', 'Ziel', 'Stamm', 'Karte', 'Gegner', '2 / 3 Sterne bis Runde']) + '\n' + row(Array(7).fill('---')) + '\n';
  MISSIONS.forEach((m, i) => {
    const s = m.setup;
    md += row([i + 1, `**${m.title}**`, m.goal, TRIBES[s.tribe].name, `${MAP_SIZES[s.mapSize].label}, ${MAP_TYPES[s.mapType].label}`, `${s.count - 1}, ${AI_LEVELS[s.aiLevel].label}${s.rule === 'nograce' ? ', ohne Schonfrist' : ''}`, m.par ? `${m.par[0]} / ${m.par[1]}` : (m.starHint || 'Sterne für 3 bzw. 5 Städte am Ende')]) + '\n';
  });
  md += '\n## Wochen-Herausforderung\n\nJede Woche eine feste Karte mit einer dieser Sonderregeln:\n\n';
  for (const r of Object.values(WEEKLY_RULES)) md += `- **${r.name}**: ${r.desc}\n`;
  md += '\n## Tagesherausforderung\n\nJeden Tag dieselbe Karte und derselbe Stamm für alle, 30 Runden. Es zählt die Punktzahl. Mit Namen erscheinst du in der Bestenliste.\n';
  write('Kampagne-und-Herausforderungen', md);
}

console.log('Wiki-Datenseiten geschrieben nach docs/wiki/');
