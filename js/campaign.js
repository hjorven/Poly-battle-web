// Kampagne: Missionen mit festem Aufbau, einem Ziel und Sternwertung.
// 1 Stern = Ziel erreicht, 2 bzw. 3 Sterne = schneller als die Vorgaben.

import * as R from './rules.js';

const ME = 'player_1';
const mine = st => st.cities.filter(c => c.owner === ME);

export const MISSIONS = [
  {
    id: 'm1', title: 'Erste Schritte',
    story: 'Ein kleines Tal, ein schwacher Nachbar. Gründe dein Reich.',
    goal: 'Nimm ein Dorf ein (2 Städte).',
    setup: { mapSize: 'small', mapType: 'continents', count: 2, aiLevel: 'easy', tribe: 'imperius' },
    // Nur Eroberungen zählen, eine selbst gegründete Stadt erfüllt das Ziel nicht.
    progress: st => [Math.min(mine(st).length, 1 + ((st.capturesBy && st.capturesBy[ME]) || 0)), 2], par: [8, 5]
  },
  {
    id: 'm2', title: 'Alte Mauern',
    story: 'Ruinen einer vergessenen Zeit liegen verstreut. Was sie wohl bergen?',
    goal: 'Erkunde 2 Ruinen.',
    setup: { mapSize: 'small', mapType: 'pangaea', count: 2, aiLevel: 'easy', tribe: 'bardur' },
    progress: st => [(st.ruinsBy && st.ruinsBy[ME]) || 0, 2], par: [12, 8]
  },
  {
    id: 'm3', title: 'Wachstum',
    story: 'Eine große Stadt ist ein starkes Herz. Lass sie wachsen.',
    goal: 'Bringe eine Stadt auf Stufe 5.',
    setup: { mapSize: 'small', mapType: 'continents', count: 2, aiLevel: 'easy', tribe: 'zebasi' },
    progress: st => [Math.max(0, ...mine(st).map(c => c.pop)), 5], par: [10, 7]
  },
  {
    id: 'm4', title: 'Leuchtfeuer',
    story: 'Seeleute erzählen von Feuern an den Enden der Welt.',
    goal: 'Erreiche 2 Leuchttürme.',
    setup: { mapSize: 'small', mapType: 'archipelago', count: 2, aiLevel: 'easy', tribe: 'kickoo' },
    progress: st => [R.lighthouseCount(st, ME), 2], par: [24, 16]
  },
  {
    id: 'm5', title: 'Baumeister',
    story: 'Felder, Minen, Mühlen – Wohlstand will gebaut werden.',
    goal: 'Errichte 10 Gebäude.',
    setup: { mapSize: 'normal', mapType: 'continents', count: 3, aiLevel: 'easy', tribe: 'luxidoor' },
    progress: st => [mine(st).reduce((n, c) => n + R.cityTiles(st, c).filter(([q, r]) => R.improvementAt(st, q, r)).length, 0), 10], par: [11, 8]
  },
  {
    id: 'm6', title: 'Feuertaufe',
    story: 'Die Nachbarn rüsten auf. Zeige, dass dein Volk sich wehren kann.',
    goal: 'Besiege 8 gegnerische Einheiten.',
    setup: { mapSize: 'small', mapType: 'pangaea', count: 3, aiLevel: 'normal', tribe: 'vengir', rule: 'nograce' },
    progress: st => [(st.killsBy && st.killsBy[ME]) || 0, 8], par: [15, 11]
  },
  {
    id: 'm7', title: 'Belagerung',
    story: 'Die Hauptstadt des Feindes ist sein Stolz. Nimm sie ihm.',
    goal: 'Erobere eine gegnerische Hauptstadt.',
    setup: { mapSize: 'small', mapType: 'continents', count: 2, aiLevel: 'normal', tribe: 'oumaji' },
    // Fremde Hauptstädte: alle Hauptstädte in deiner Hand außer der eigenen Start-Hauptstadt.
    progress: st => [mine(st).filter(c => c.isCapital && !(st.home && c.q === st.home.q && c.r === st.home.r)).length, 1], par: [20, 14]
  },
  {
    id: 'm8', title: 'Gelehrte',
    story: 'Wissen ist die schärfste Waffe. Füll die Bibliotheken.',
    goal: 'Erforsche 15 Technologien.',
    setup: { mapSize: 'normal', mapType: 'continents', count: 3, aiLevel: 'normal', tribe: 'aimo' },
    progress: st => [(st.techs[ME] || []).filter(t => t !== 'basic').length, 15], par: [22, 17]
  },
  {
    id: 'm9', title: 'Standhaft',
    story: 'Zwei kriegerische Stämme haben es auf dich abgesehen. Halte durch.',
    goal: 'Überlebe 20 Runden.',
    setup: { mapSize: 'small', mapType: 'pangaea', count: 3, aiLevel: 'normal', tribe: 'quetzali', rule: 'nograce' },
    progress: st => [Math.min(st.round - 1, 20), 20], par: null, survive: true, stars: st => 1 + (mine(st).length >= 3 ? 1 : 0) + (mine(st).length >= 5 ? 1 : 0)
  },
  {
    id: 'm10', title: 'Großreich',
    story: 'Die ganze Welt wartet. Vereine sie unter deinem Banner.',
    goal: 'Besiege alle Gegner.',
    setup: { mapSize: 'normal', mapType: 'continents', count: 4, aiLevel: 'normal', tribe: 'yadakk' },
    progress: st => [st.players.filter(p => p !== ME && !R.alive(st, p)).length, st.players.length - 1], par: [50, 35]
  },
  {
    id: 'm11', title: 'Handelsweg',
    story: 'Zwischen deinen Städten liegt Gold auf der Straße – wenn du es abholst.',
    goal: 'Verdiene 25 Sterne durch Handel mit Händlerkarren.',
    setup: { mapSize: 'small', mapType: 'continents', count: 2, aiLevel: 'easy', tribe: 'yadakk' },
    prepare: st => {
      for (const t of ['riding', 'roads', 'trade']) if (!st.techs[ME].includes(t)) st.techs[ME].push(t);
      st.stars[ME] += 5;
    },
    progress: st => [(st.tradeStarsBy && st.tradeStarsBy[ME]) || 0, 25], par: [18, 13]
  },
  {
    id: 'm12', title: 'Mauern brechen',
    story: 'Die Hauptstadt des Feindes trotzt hinter dicken Mauern. Ein Rammbock steht bereit.',
    goal: 'Erobere die ummauerte Hauptstadt des Gegners.',
    setup: { mapSize: 'small', mapType: 'pangaea', count: 2, aiLevel: 'normal', tribe: 'imperius', rule: 'nograce' },
    prepare: st => {
      for (const t of ['organization', 'farming', 'construction']) if (!st.techs[ME].includes(t)) st.techs[ME].push(t);
      for (const c of st.cities) if (c.owner && c.owner !== ME && c.isCapital) c.rewards = { ...(c.rewards || {}), 3: 'wall' };
      const home = st.cities.find(c => c.owner === ME && c.isCapital);
      const spot = home && R.freeLandAround(st, home.q, home.r);
      if (spot) st.units.push({ id: 'm12_ram', owner: ME, type: 'ram', q: spot[0], r: spot[1], hp: R.maxHp('ram'), mp: 1, hasMoved: false, acted: false });
    },
    progress: st => [mine(st).filter(c => c.isCapital && !(st.home && c.q === st.home.q && c.r === st.home.r)).length, 1], par: [22, 15]
  },
  {
    id: 'm13', title: 'Wacht an der Grenze',
    story: 'Drei Eroberer rücken an. Türme sehen sie kommen – halte jede Stadt.',
    goal: 'Überlebe 15 Runden.',
    setup: { mapSize: 'small', mapType: 'pangaea', count: 3, aiLevel: 'normal', tribe: 'quetzali', rule: 'nograce' },
    prepare: st => { st.stars[ME] += 5; },
    progress: st => [Math.min(st.round - 1, 15), 15], par: null, survive: true,
    stars: st => 1 + (((st.lostBy && st.lostBy[ME]) || 0) === 0 ? 1 : 0) +
      (Object.entries(st.improvements || {}).filter(([k, t]) => { const [q, r] = k.split(',').map(Number); return t === 'watchtower' && R.ownLand(st, ME, q, r); }).length >= 2 ? 1 : 0),
    starHint: 'Sterne: keine Stadt verlieren, mindestens 2 Wachtürme'
  }
];

// Mission für den Start vorbereiten: Start-Hauptstadt merken, Sonderregeln.
export function prepareMission(state, m) {
  state.mission = m.id;
  const home = state.cities.find(c => c.owner === ME && c.isCapital);
  state.home = home ? { q: home.q, r: home.r } : null;
  // Ohne Schonfrist: die KI darf von Anfang an angreifen.
  if (m.setup.rule === 'nograce') state.provoked = Object.fromEntries(state.players.map(p => [p, true]));
  if (m.prepare) m.prepare(state);
}

export function missionById(id) {
  return MISSIONS.find(m => m.id === id) || null;
}

// Stand der Mission: Fortschritt und – wenn geschafft – die Sterne.
export function missionStatus(state) {
  const m = missionById(state.mission);
  if (!m) return null;
  const [have, need] = m.progress(state);
  const done = have >= need;
  let stars = 0;
  if (done) {
    if (m.stars) stars = m.stars(state);
    else stars = 1 + (state.round <= m.par[0] ? 1 : 0) + (state.round <= m.par[1] ? 1 : 0);
  }
  return { mission: m, have: Math.max(0, have), need, done, stars };
}

// Mission i ist spielbar, wenn die vorige mindestens einen Stern hat.
export function missionUnlocked(profile, index) {
  if (index === 0) return true;
  const prev = MISSIONS[index - 1];
  return ((profile.campaign && profile.campaign[prev.id]) || 0) > 0;
}

export function campaignStars(profile) {
  return MISSIONS.reduce((n, m) => n + ((profile.campaign && profile.campaign[m.id]) || 0), 0);
}
