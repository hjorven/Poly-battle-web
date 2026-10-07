import { HEX_SIZE, MAP_W, MAP_H } from './config.js';

export const DIRS = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]
];

export const hk = (q, r) => q + ',' + r;

export function inBounds(q, r) {
  return q >= 0 && q < MAP_W && r >= 0 && r < MAP_H;
}

export function neighbors(q, r) {
  const out = [];
  for (const [dq, dr] of DIRS) {
    const nq = q + dq, nr = r + dr;
    if (inBounds(nq, nr)) out.push([nq, nr]);
  }
  return out;
}

export function hexDistance(q1, r1, q2, r2) {
  const dq = q1 - q2, dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

export function toWorld(q, r) {
  return {
    x: HEX_SIZE * Math.sqrt(3) * (q + r / 2),
    z: HEX_SIZE * 1.5 * r
  };
}

export function fromWorld(x, z) {
  const qf = (Math.sqrt(3) / 3 * x - z / 3) / HEX_SIZE;
  const rf = (2 / 3 * z) / HEX_SIZE;
  return axialRound(qf, rf);
}

function axialRound(qf, rf) {
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}

export function forEachHex(fn) {
  for (let r = 0; r < MAP_H; r++) {
    for (let q = 0; q < MAP_W; q++) fn(q, r);
  }
}
