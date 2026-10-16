// Spielerprofil über alle Partien: Erfahrung und Stufe, Erfolge, Statistik
// und die Tagesherausforderung. Liegt nur im Browser (localStorage).

import { TRIBE_POOL, MAP_TYPES, TECHS, WEEKLY_RULES } from './config.js';

const KEY = 'pb_profile_v1';

function storage(store) {
  if (store) return store;
  try { return globalThis.localStorage || null; } catch (e) { return null; }
}

export function emptyProfile() {
  return {
    v: 1, xp: 0, games: 0, wins: 0, losses: 0, winStreak: 0, bestWinStreak: 0,
    totals: { kills: 0, captures: 0, trained: 0, rounds: 0, techs: 0 }, tribeGames: {}, recent: [],
    bestScore: 0, fastestWin: null, tribeWins: {}, achievements: {}, seen: [],
    daily: { last: null, streak: 0, bestStreak: 0, best: {} },
    weekly: { best: {} },
    look: {},
    campaign: {},
    name: null
  };
}

export function loadProfile(store) {
  const s = storage(store);
  if (!s) return emptyProfile();
  try {
    const p = JSON.parse(s.getItem(KEY) || 'null');
    if (!p || p.v !== 1) return emptyProfile();
    return sanitize(p);
  } catch (e) {
    return emptyProfile();
  }
}

// Werte prüfen und begrenzen: beschädigte oder manipulierte Profile dürfen das
// Spiel nie lahmlegen (z. B. riesige Erfahrung, falsche Typen).
const num = (v, max = 1e7) => (Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), max) : 0);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
function sanitize(p) {
  const base = emptyProfile();
  const d = obj(p.daily);
  return {
    ...base,
    xp: num(p.xp), games: num(p.games), wins: num(p.wins), losses: num(p.losses),
    winStreak: num(p.winStreak), bestWinStreak: num(p.bestWinStreak), bestScore: num(p.bestScore, 1e9),
    fastestWin: Number.isFinite(p.fastestWin) && p.fastestWin > 0 ? p.fastestWin : null,
    tribeWins: obj(p.tribeWins), achievements: obj(p.achievements),
    totals: Object.fromEntries(['kills', 'captures', 'trained', 'rounds', 'techs'].map(k => [k, num(obj(p.totals)[k], 1e9)])),
    tribeGames: obj(p.tribeGames),
    recent: Array.isArray(p.recent) ? p.recent.filter(x => x && typeof x === 'object').slice(-10) : [],
    seen: Array.isArray(p.seen) ? p.seen.filter(x => typeof x === 'string').slice(-50) : [],
    daily: {
      last: typeof d.last === 'string' ? d.last : null,
      streak: num(d.streak), bestStreak: num(d.bestStreak), best: obj(d.best)
    },
    weekly: { best: obj(obj(p.weekly).best) },
    look: Object.fromEntries(Object.entries(obj(p.look)).filter(([k, v]) => typeof v === 'string' && COSMETICS[k] && COSMETICS[k].items[v])),
    campaign: Object.fromEntries(Object.entries(obj(p.campaign)).map(([k, v]) => [k, Math.min(3, num(v))])),
    name: typeof p.name === 'string' && p.name.length <= 16 ? p.name : null
  };
}

// Von außen (z. B. vom Server) geladenes Profil prüfen und übernehmen.
export function sanitizeProfile(p) {
  return sanitize(p && typeof p === 'object' ? { ...p, v: 1 } : {});
}

// Mitteilung bei Online-Zug (Einstellung im Browser, unabhängig vom Profil).
export function notifyEnabled() {
  try { return globalThis.localStorage.getItem('pb_notify') === '1'; } catch (e) { return false; }
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

// Direkt berechnet (keine Schleife): größtes n mit 100·n·(n−1) ≤ xp.
export function levelOf(xp) {
  const x = Number.isFinite(xp) && xp > 0 ? Math.min(xp, 1e12) : 0;
  let n = Math.max(1, Math.floor((1 + Math.sqrt(1 + x / 25)) / 2));
  while (n > 1 && xpFor(n) > x) n--;
  while (xpFor(n + 1) <= x) n++;
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
  online: { name: 'Gemeinsam stark', desc: 'Gewinne ein Online-Spiel.', check: r => r.won && r.mode === 'online' },
  weekly: { name: 'Wochenkämpfer', desc: 'Schließe eine Wochen-Herausforderung ab.', check: r => !!r.weekly },
  trader: { name: 'Kaufmann', desc: 'Handle 5-mal in einem Spiel mit Händlerkarren.', check: r => r.trades >= 5 },
  breaker: { name: 'Mauerbrecher', desc: 'Erobere eine Stadt mit einem Rammbock.', check: r => r.siegeCaptures >= 1 },
  selfmade: { name: 'Aus eigener Kraft', desc: 'Gewinne auf Schwer, ohne einen Tipp zu benutzen.', check: r => r.won && r.vsAi && r.aiLevel === 'hard' && !r.coached }
};

// --- Kosmetik -------------------------------------------------------------------
// Freigeschaltet über Stufe oder Erfolg; im Spiel für eigene Städte/Einheiten.

export const COSMETICS = {
  banner: {
    label: 'Banner',
    items: {
      standard: { name: 'Standard' },
      pennant: { name: 'Wimpel', need: { level: 2 } },
      swallow: { name: 'Schwalbenschwanz', need: { level: 4 } },
      gold: { name: 'Goldbanner', need: { ach: 'win_hard' } }
    }
  },
  plume: {
    label: 'Helmbusch',
    items: {
      none: { name: 'Keiner' },
      red: { name: 'Rot', need: { ach: 'first_win' } },
      white: { name: 'Weiß', need: { level: 3 } },
      gold: { name: 'Gold', need: { ach: 'warlord' } }
    }
  },
  decor: {
    label: 'Stadtschmuck',
    items: {
      none: { name: 'Keiner' },
      fountain: { name: 'Brunnen', need: { level: 5 } },
      statue: { name: 'Statue', need: { ach: 'builder' } },
      garden: { name: 'Gärten', need: { ach: 'streak3' } }
    }
  }
};

export function cosmeticUnlocked(profile, cat, id) {
  const item = COSMETICS[cat] && COSMETICS[cat].items[id];
  if (!item) return false;
  const need = item.need;
  if (!need) return true;
  if (need.level) return levelOf(profile.xp) >= need.level;
  if (need.ach) return !!profile.achievements[need.ach];
  return false;
}

export function cosmeticHint(cat, id) {
  const need = COSMETICS[cat].items[id].need;
  if (!need) return '';
  if (need.level) return `ab Stufe ${need.level}`;
  return `Erfolg „${ACHIEVEMENTS[need.ach].name}“`;
}

// Gewähltes Aussehen, nur freigeschaltete Teile.
export function lookOf(profile) {
  const look = {};
  for (const cat of Object.keys(COSMETICS)) {
    const want = profile.look && profile.look[cat];
    look[cat] = want && cosmeticUnlocked(profile, cat, want) ? want : Object.keys(COSMETICS[cat].items)[0];
  }
  return look;
}

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

// Kalenderwoche nach ISO 8601, z. B. „2026-W42“.
export function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}

// Wochen-Herausforderung: Karte, Stamm und Sonderregel hängen nur von der Woche ab.
export function weeklyChallenge(key = weekKey()) {
  const seed = hashStr('poly-battle-week:' + key);
  const rules = Object.keys(WEEKLY_RULES);
  const rule = rules[seed % rules.length];
  const types = Object.keys(MAP_TYPES);
  return {
    key, seed, rule, ...WEEKLY_RULES[rule],
    tribe: TRIBE_POOL[(seed >>> 4) % TRIBE_POOL.length],
    mapType: rule === 'seafarers' ? 'archipelago' : types[(seed >>> 9) % types.length],
    mapSize: 'normal', count: 4, aiLevel: 'normal', turnLimit: rule === 'blitz' ? 20 : 30, stars: 5
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
    captures: (state.capturesBy && state.capturesBy[me]) || 0,
    trained: (state.trainedBy && state.trainedBy[me]) || 0,
    techs: (state.techs[me] || []).filter(t => t !== 'basic').length,
    techTotal: Object.keys(TECHS).length,
    monuments: ((state.monumentsBuilt && state.monumentsBuilt[me]) || []).length,
    lighthouses: Object.values(state.lighthouses || {}).filter(list => list.includes(me)).length,
    ruins: (state.ruinsBy && state.ruinsBy[me]) || 0,
    comeback: !!(state.comeback && state.comeback[me]),
    daily: state.daily || null,
    weekly: state.weekly || null,
    mission: state.mission || null,
    missionStars: state.missionStars || 0,
    trades: (state.tradesBy && state.tradesBy[me]) || 0,
    siegeCaptures: (state.siegeCapturesBy && state.siegeCapturesBy[me]) || 0,
    coached: !!state.coached
  };
}

const LEVEL_MULT = { easy: 1, normal: 1.5, hard: 2 };

// Passende KI-Stärke: drei Siege in Folge auf derselben Stufe → eine Stufe
// höher vorschlagen, drei Niederlagen → eine niedriger (nur freie Partien gegen die KI).
const LEVELS = ['easy', 'normal', 'hard'];
export function difficultyAdvice(profile) {
  const games = (profile.recent || []).filter(g => g.mode === 'bot' && g.aiLevel).slice(-3);
  if (games.length < 3 || games.some(g => g.aiLevel !== games[0].aiLevel)) return null;
  const i = LEVELS.indexOf(games[0].aiLevel);
  if (games.every(g => g.won) && i < LEVELS.length - 1) return { dir: 'up', level: LEVELS[i + 1] };
  if (games.every(g => !g.won) && i > 0) return { dir: 'down', level: LEVELS[i - 1] };
  return null;
}

// Trägt eine Partie ein. Gibt zurück, was der Spieler dafür bekommen hat.
export function recordGame(profile, facts) {
  const before = profile.xp;
  const mult = facts.vsAi ? (LEVEL_MULT[facts.aiLevel] || 1) : 1.5;
  let gain = Math.round((Math.min(400, facts.score / 20) + (facts.won ? 150 : 30)) * mult);
  profile.games++;
  const t = profile.totals || (profile.totals = { kills: 0, captures: 0, trained: 0, rounds: 0, techs: 0 });
  t.kills += facts.kills || 0;
  t.captures += facts.captures || 0;
  t.trained += facts.trained || 0;
  t.rounds += facts.round || 0;
  t.techs += facts.techs || 0;
  if (facts.tribe) profile.tribeGames[facts.tribe] = (profile.tribeGames[facts.tribe] || 0) + 1;
  profile.recent = [...(profile.recent || []), {
    date: dateKey(), mode: facts.daily ? 'daily' : facts.weekly ? 'weekly' : facts.mission ? 'mission' : facts.mode,
    tribe: facts.tribe, won: !!facts.won, score: facts.score, round: facts.round,
    ...(facts.vsAi ? { aiLevel: facts.aiLevel } : {})
  }].slice(-10);
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

  let mission = null;
  if (facts.mission) {
    if (!profile.campaign) profile.campaign = {};
    const before = profile.campaign[facts.mission] || 0;
    profile.campaign[facts.mission] = Math.max(before, facts.missionStars || 0);
    gain += Math.max(0, (facts.missionStars || 0) - before) * 60;
    mission = { id: facts.mission, stars: facts.missionStars || 0, best: profile.campaign[facts.mission], improved: (facts.missionStars || 0) > before };
  }
  let weekly = null;
  if (facts.weekly) {
    const prevBest = profile.weekly.best[facts.weekly] || 0;
    if (prevBest === 0) gain += 150;
    profile.weekly.best[facts.weekly] = Math.max(prevBest, facts.score);
    const keys = Object.keys(profile.weekly.best).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 26))) delete profile.weekly.best[k];
    weekly = { key: facts.weekly, score: facts.score, best: profile.weekly.best[facts.weekly], improved: facts.score > prevBest };
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
    achievements: fresh, daily, weekly, mission
  };
}
