// Spielerprofil über alle Partien: Erfahrung und Stufe, Erfolge, Statistik
// und die Tagesherausforderung. Liegt nur im Browser (localStorage).

import { TRIBE_POOL, MAP_TYPES, TECHS } from './config.js';

const KEY = 'pb_profile_v1';

function storage(store) {
  if (store) return store;
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}

export function emptyProfile() {
  return {
    v: 1, xp: 0, games: 0, wins: 0, losses: 0, winStreak: 0, bestWinStreak: 0,
    bestScore: 0, fastestWin: null, tribeWins: {}, achievements: {},
    daily: { last: null, streak: 0, bestStreak: 0, best: {} }
  };
}

export function loadProfile(store) {
  const s = storage(store);
  if (!s) return emptyProfile();
  try {
    const p = JSON.parse(s.getItem(KEY) || 'null');
    if (!p || p.v !== 1) return emptyProfile();
    const base = emptyProfile();
    return { ...base, ...p, daily: { ...base.daily, ...(p.daily || {}) } };
  } catch (e) {
    return emptyProfile();
  }
}

export function saveProfile(profile, store) {
  const s = storage(store);
  if (!s) return false;
  try { s.setItem(KEY, JSON.stringify(profile)); return true; } catch (e) { return false; }
}

// --- Stufen ---------------------------------------------------------------------
// Stufe n braucht 100 · n · (n − 1) Erfahrung insgesamt (200, 600, 1200 …).

export function xpFor(level) {
  return 100 * level * (level - 1);
}

export function levelOf(xp) {
  let n = 1;
  while (xp >= xpFor(n + 1)) n++;
  return n;
}

const TITLES = [[1, 'Häuptling'], [3, 'Fürst'], [5, 'König'], [8, 'Kaiser'], [12, 'Legende']];
export function titleOf(level) {
  let t = TITLES[0][1];
  for (const [min, name] of TITLES) if (level >= min) t = name;
  return t;
}

// Fortschritt innerhalb der aktuellen Stufe (0–1).
export function levelProgress(xp) {
  const n = levelOf(xp);
  const lo = xpFor(n), hi = xpFor(n + 1);
  return { level: n, title: titleOf(n), into: xp - lo, need: hi - lo, frac: (xp - lo) / (hi - lo) };
}

// --- Erfolge --------------------------------------------------------------------
// `check(r)` bekommt das Ergebnis einer Partie (siehe gameFacts) und das Profil
// nach dem Eintragen dieser Partie.

export const ACHIEVEMENTS = {
  first_win: { name: 'Erster Sieg', desc: 'Gewinne ein Spiel.', check: r => r.won },
  win_normal: { name: 'Ernstfall', desc: 'Gewinne auf Normal oder Schwer.', check: r => r.won && r.aiLevel !== 'easy' && r.vsAi },
  win_hard: { name: 'Meisterstratege', desc: 'Gewinne auf Schwer.', check: r => r.won && r.aiLevel === 'hard' && r.vsAi },
  blitz: { name: 'Blitzkrieg', desc: 'Erobere alles in höchstens 25 Runden.', check: r => r.won && r.conquest && r.round <= 25 },
  empire: { name: 'Großreich', desc: 'Besitze 10 Städte gleichzeitig.', check: r => r.peakCities >= 10 },
  warlord: { name: 'Feldherr', desc: 'Besiege 25 Einheiten in einem Spiel.', check: r => r.kills >= 25 },
  scholar: { name: 'Gelehrter', desc: 'Erforsche alle Technologien.', check: r => r.techs >= r.techTotal },
  builder: { name: 'Baumeister', desc: 'Errichte 3 Monumente in einem Spiel.', check: r => r.monuments >= 3 },
  sailor: { name: 'Weltumsegler', desc: 'Finde alle Leuchttürme.', check: r => r.lighthouses >= 4 },
  explorer: { name: 'Schatzsucher', desc: 'Erkunde 5 Ruinen in einem Spiel.', check: r => r.ruins >= 5 },
  survivor: { name: 'Zäh', desc: 'Halte 40 Runden durch.', check: r => r.round >= 40 },
  comeback: { name: 'Comeback', desc: 'Gewinne, nachdem du von 3+ Städten auf eine geschrumpft bist.', check: r => r.won && r.comeback },
  daily: { name: 'Tagesform', desc: 'Schließe eine Tagesherausforderung ab.', check: r => !!r.daily },
  streak3: { name: 'Stammgast', desc: 'Spiele die Tagesherausforderung 3 Tage in Folge.', check: (r, p) => p.daily.streak >= 3 },
  tribes5: { name: 'Vielseitig', desc: 'Gewinne mit 5 verschiedenen Stämmen.', check: (r, p) => Object.keys(p.tribeWins).length >= 5 },
  online: { name: 'Gemeinsam stark', desc: 'Gewinne ein Online-Spiel.', check: r => r.won && r.mode === 'online' }
};

// --- Tagesherausforderung -----------------------------------------------------

export function dateKey(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function hashStr(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Für alle gleich: Karte, Stamm und Kartentyp hängen nur vom Datum ab.
export function dailyChallenge(key = dateKey()) {
  const seed = hashStr('poly-battle:' + key);
  const types = Object.keys(MAP_TYPES);
  return {
    key, seed,
    tribe: TRIBE_POOL[seed % TRIBE_POOL.length],
    mapType: types[(seed >>> 8) % types.length],
    mapSize: 'normal', count: 4, aiLevel: 'normal', turnLimit: 30, stars: 5
  };
}

function prevDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d - 1));
}

// --- Partie auswerten ------------------------------------------------------------

// Kennzahlen einer beendeten Partie aus Sicht von `me`.
export function gameFacts(state, me, { won, mode, score }) {
  const cities = state.cities.filter(c => c.owner === me).length;
  return {
    won, mode, score,
    vsAi: (state.ai || []).length > 0,
    aiLevel: state.aiLevel || 'normal',
    round: state.round,
    conquest: state.endReason === 'conquest',
    tribe: state.tribes ? state.tribes[me] : null,
    peakCities: Math.max(cities, (state.peak && state.peak[me]) || 0),
    kills: (state.killsBy && state.killsBy[me]) || 0,
    techs: (state.techs[me] || []).filter(t => t !== 'basic').length,
    techTotal: Object.keys(TECHS).length,
    monuments: ((state.monumentsBuilt && state.monumentsBuilt[me]) || []).length,
    lighthouses: Object.values(state.lighthouses || {}).filter(list => list.includes(me)).length,
    ruins: (state.ruinsBy && state.ruinsBy[me]) || 0,
    comeback: !!(state.comeback && state.comeback[me]),
    daily: state.daily || null
  };
}

const LEVEL_MULT = { easy: 1, normal: 1.5, hard: 2 };

// Trägt eine Partie ein. Gibt zurück, was der Spieler dafür bekommen hat.
export function recordGame(profile, facts) {
  const before = profile.xp;
  const mult = facts.vsAi ? (LEVEL_MULT[facts.aiLevel] || 1) : 1.5;
  let gain = Math.round((Math.min(400, facts.score / 20) + (facts.won ? 150 : 30)) * mult);
  profile.games++;
  if (facts.won) {
    profile.wins++;
    profile.winStreak++;
    profile.bestWinStreak = Math.max(profile.bestWinStreak, profile.winStreak);
    if (facts.tribe) profile.tribeWins[facts.tribe] = (profile.tribeWins[facts.tribe] || 0) + 1;
    if (facts.conquest && (!profile.fastestWin || facts.round < profile.fastestWin)) profile.fastestWin = facts.round;
  } else {
    profile.losses++;
    profile.winStreak = 0;
  }
  profile.bestScore = Math.max(profile.bestScore, facts.score);

  let daily = null;
  if (facts.daily) {
    const d = profile.daily;
    const prevBest = d.best[facts.daily] || 0;
    if (d.last !== facts.daily) {
      d.streak = d.last === prevDay(facts.daily) ? d.streak + 1 : 1;
      d.last = facts.daily;
      gain += 100;
    }
    d.bestStreak = Math.max(d.bestStreak, d.streak);
    d.best[facts.daily] = Math.max(prevBest, facts.score);
    // Nur die letzten 60 Tage aufheben.
    const keys = Object.keys(d.best).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete d.best[k];
    daily = { key: facts.daily, score: facts.score, best: d.best[facts.daily], improved: facts.score > prevBest, streak: d.streak };
  }

  const fresh = [];
  for (const [id, a] of Object.entries(ACHIEVEMENTS)) {
    if (profile.achievements[id]) continue;
    if (a.check(facts, profile)) {
      profile.achievements[id] = dateKey();
      fresh.push(id);
    }
  }
  gain += fresh.length * 50;
  profile.xp += gain;
  return {
    gain, levelBefore: levelOf(before), levelAfter: levelOf(profile.xp),
    achievements: fresh, daily
  };
}
