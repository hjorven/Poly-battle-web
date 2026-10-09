import {
  MAP_W, MAP_H, MAX_HP, MAX_POP, START_STARS, BASE_CITY_POP,
  TERRAIN, UNITS, TECHS, TRIBES
} from './config.js';
import { hk, inBounds, neighbors, hexDistance, forEachHex } from './hex.js';

const idx = (q, r) => r * MAP_W + q;

export function createGame(seed = Date.now(), tribeP1 = 'imperius', tribeP2 = 'bardur') {
  const rand = mulberry32(seed);
  
  const state = {
    terrain: generateTerrain(rand),
    cities: [], 
    units: [],
    tribes: { player_1: tribeP1, player_2: tribeP2 },
    stars: { player_1: START_STARS, player_2: START_STARS },
    techs: { 
      player_1: [TRIBES[tribeP1].tech], 
      player_2: [TRIBES[tribeP2].tech] 
    },
    turn: 'player_1', 
    round: 1, 
    winner: null
  };

  const s1 = [1, MAP_H - 2];
  const s2 = [MAP_W - 2, 1];

  // Biom-Einfluss rund um die Hauptstädte
  applyBiome(state, s1[0], s1[1], TRIBES[tribeP1].biome);
  applyBiome(state, s2[0], s2[1], TRIBES[tribeP2].biome);

  // Hauptstädte platzieren
  placeCity(state, s1[0], s1[1], 'player_1', BASE_CITY_POP + 1);
  placeCity(state, s2[0], s2[1], 'player_2', BASE_CITY_POP + 1);

  // Start-Einheiten spawnen
  spawnWarrior(state, 'player_1', s1[0], s1[1]);
  spawnWarrior(state, 'player_2', s2[0], s2[1]);

  startTurn(state);
  return state;
}

function applyBiome(state, q, r, biome) {
  forEachHex((nq, nr) => {
    if (hexDistance(q, r, nq, nr) <= 3) {
      const i = idx(nq, nr);
      if (biome === 'forest') state.terrain[i] = 'forest';
      else if (biome === 'mountain' && hexDistance(q, r, nq, nr) > 1) state.terrain[i] = 'mountain';
      else if (biome === 'water' && hexDistance(q, r, nq, nr) > 1) state.terrain[i] = 'water';
      else state.terrain[i] = 'plains';
    }
  });
}

function placeCity(state, q, r, owner, pop) {
  state.terrain[idx(q, r)] = 'plains';
  state.cities.push({ q, r, owner, pop, trained: false });
}

function spawnWarrior(state, owner, q, r) {
  state.units.push({
    id: `${owner}_start_${Date.now().toString(36)}`,
    owner, type: 'warrior', q, r, hp: MAX_HP, maxHp: MAX_HP, mp: UNITS.warrior.move, acted: false
  });
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateTerrain(rand) {
  const t = new Array(MAP_W * MAP_H);
  for (let i = 0; i < t.length; i++) {
    const r = rand();
    if (r < 0.15) t[i] = 'water';
    else if (r < 0.35) t[i] = 'forest';
    else if (r < 0.50) t[i] = 'mountain';
    else t[i] = 'plains';
  }
  return t;
}
