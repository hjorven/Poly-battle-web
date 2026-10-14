// Ergebnisbild zum Teilen: ganze Karte ohne Nebel, Rangliste und Punkteverlauf
// in einem PNG (2160 × 2700, Format 4:5 – passt gut in Chats und Stories).

import { TERRAIN, MAP_W, NAMES } from './config.js';
import { toWorld, forEachHex, hk } from './hex.js';
import { cityTiles, playerColor, tribeName, ranking, scoreBreakdown } from './rules.js';

const W = 1080, H = 1350;
const GAME_URL = 'hjorven.github.io/Poly-battle-web';
const css = c => '#' + c.toString(16).padStart(6, '0');
const nameOf = (state, p) => tribeName(state, p) || NAMES[p];

function hexPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + i * Math.PI / 3;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

function drawMap(ctx, state, box) {
  // Kartengrenzen in Weltkoordinaten.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  forEachHex((q, r) => {
    const p = toWorld(q, r);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  });
  const scale = Math.min(box.w / (maxX - minX + 2), box.h / (maxZ - minZ + 2));
  const ox = box.x + (box.w - (maxX - minX) * scale) / 2 - minX * scale;
  const oz = box.y + (box.h - (maxZ - minZ) * scale) / 2 - minZ * scale;
  const at = (q, r) => { const p = toWorld(q, r); return [ox + p.x * scale, oz + p.z * scale]; };

  // Wem gehört welches Feld (Stadtgebiete)?
  const owner = new Map();
  for (const c of state.cities) {
    if (!c.owner) continue;
    for (const [q, r] of cityTiles(state, c)) owner.set(hk(q, r), c.owner);
  }
  forEachHex((q, r) => {
    const [x, y] = at(q, r);
    hexPath(ctx, x, y, scale * 0.6);
    ctx.fillStyle = css(TERRAIN[state.terrain[r * MAP_W + q]].color);
    ctx.fill();
    const o = owner.get(hk(q, r));
    if (o) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = css(playerColor(state, o));
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  });
  for (const k of Object.keys(state.roads || {})) {
    const [q, r] = k.split(',').map(Number);
    const [x, y] = at(q, r);
    ctx.fillStyle = '#b4875a';
    ctx.beginPath(); ctx.arc(x, y, scale * 0.14, 0, Math.PI * 2); ctx.fill();
  }
  for (const c of state.cities) {
    const [x, y] = at(c.q, c.r);
    const rad = scale * (c.isCapital ? 0.5 : 0.38);
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = c.owner ? css(playerColor(state, c.owner)) : '#d4d4d8';
    ctx.fill();
    ctx.lineWidth = Math.max(2, scale * 0.1);
    ctx.strokeStyle = '#111827';
    ctx.stroke();
    if (c.isCapital) {
      ctx.beginPath(); ctx.arc(x, y, rad * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill();
    }
  }
  for (const k of Object.keys(state.lighthouses || {})) {
    const [q, r] = k.split(',').map(Number);
    const [x, y] = at(q, r);
    ctx.fillStyle = '#facc15';
    ctx.beginPath(); ctx.arc(x, y, scale * 0.3, 0, Math.PI * 2); ctx.fill();
  }
}

function drawChart(ctx, state, box) {
  const hist = state.history || [];
  if (hist.length < 2) return;
  const players = state.players || [];
  const maxY = Math.max(10, ...hist.flatMap(h => players.map(p => h.scores[p] || 0)));
  const r0 = hist[0].round, r1 = hist[hist.length - 1].round;
  const x = r => box.x + ((r - r0) / Math.max(1, r1 - r0)) * box.w;
  const y = v => box.y + (1 - v / maxY) * box.h;
  ctx.strokeStyle = '#e4e4e7'; ctx.lineWidth = 2;
  for (const f of [0, 0.5, 1]) { ctx.beginPath(); ctx.moveTo(box.x, y(maxY * f)); ctx.lineTo(box.x + box.w, y(maxY * f)); ctx.stroke(); }
  // Dunkler Rand, damit auch helle Stammesfarben (Weiß, Gelb) sichtbar sind.
  for (const p of players) {
    const path = () => { ctx.beginPath(); hist.forEach((h, i) => { const fn = i ? 'lineTo' : 'moveTo'; ctx[fn](x(h.round), y(h.scores[p] || 0)); }); };
    ctx.lineJoin = 'round';
    path(); ctx.strokeStyle = 'rgba(24,24,27,0.75)'; ctx.lineWidth = 8; ctx.stroke();
    path(); ctx.strokeStyle = css(playerColor(state, p)); ctx.lineWidth = 4; ctx.stroke();
  }
  ctx.fillStyle = '#71717a'; ctx.font = '24px system-ui, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(`Punkteverlauf · Runde ${r0}–${r1}`, box.x, box.y + box.h + 34);
}

// Zeichnet das Bild; `me` = eigener Stamm (oder null), `headline` z. B. „Sieg!“.
export function drawShareImage(state, me, headline, mapImage = null) {
  // Doppelte Auflösung, damit Städte und Straßen beim Heranzoomen scharf bleiben.
  const canvas = document.createElement('canvas');
  canvas.width = W * 2; canvas.height = H * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#18181b'; ctx.fillRect(0, 0, W, 190);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#facc15'; ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillText('POLY BATTLE', 48, 62);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.fillText(headline, 48, 132);
  ctx.fillStyle = '#a1a1aa'; ctx.font = '28px system-ui, sans-serif';
  const sub = [me ? nameOf(state, me) : null, `Runde ${state.round}`, state.daily ? `Tagesherausforderung ${state.daily.split('-').reverse().join('.')}` : null].filter(Boolean).join(' · ');
  ctx.fillText(sub, 48, 172);

  if (mapImage) {
    // Foto der 3D-Welt (Städte, Straßen, Felder, Gebäude wie im Spiel).
    const bw = W, bh = 620, s = Math.max(bw / mapImage.width, bh / mapImage.height);
    const sw = bw / s, sh = bh / s;
    ctx.drawImage(mapImage, (mapImage.width - sw) / 2, (mapImage.height - sh) / 2, sw, sh, 0, 202, bw, bh);
  } else {
    ctx.fillStyle = '#1e3a5f';
    ctx.fillRect(24, 214, W - 48, 600);
    drawMap(ctx, state, { x: 40, y: 230, w: W - 80, h: 568 });
  }

  // Rangliste
  const rows = ranking(state).slice(0, 5);
  let y = 880;
  ctx.font = 'bold 26px system-ui, sans-serif'; ctx.fillStyle = '#71717a';
  ctx.fillText('RANGLISTE', 48, y - 20);
  rows.forEach(({ player, score }, i) => {
    const b = scoreBreakdown(state, player);
    const rowY = y + i * 52;
    if (player === me) { ctx.fillStyle = '#fef3c7'; ctx.fillRect(36, rowY - 8, 560, 48); }
    ctx.fillStyle = '#18181b'; ctx.font = 'bold 30px system-ui, sans-serif';
    ctx.fillText(`${i + 1}.`, 48, rowY + 26);
    ctx.fillStyle = css(playerColor(state, player));
    ctx.fillRect(96, rowY + 4, 24, 24);
    ctx.strokeStyle = '#18181b'; ctx.lineWidth = 2;
    ctx.strokeRect(96, rowY + 4, 24, 24);
    ctx.fillStyle = b.cities ? '#18181b' : '#a1a1aa';
    ctx.font = (player === me ? 'bold ' : '') + '30px system-ui, sans-serif';
    ctx.fillText(nameOf(state, player) + (player === me ? ' (du)' : ''), 134, rowY + 26);
    ctx.textAlign = 'right';
    ctx.fillText(`${score} P`, 588, rowY + 26);
    ctx.textAlign = 'left';
  });
  drawChart(ctx, state, { x: 640, y: 870, w: 392, h: 220 });

  ctx.fillStyle = '#18181b'; ctx.fillRect(0, H - 90, W, 90);
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 30px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(`Spiel mit: ${GAME_URL}`, W / 2, H - 34);
  return canvas;
}

// Teilen (Handy: Teilen-Menü mit Bild) oder herunterladen (PC).
export async function shareResult(state, me, headline, text, mapImage = null) {
  const canvas = drawShareImage(state, me, headline, mapImage);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
  if (!blob) return 'fehler';
  const file = new File([blob], `poly-battle-runde-${state.round}.png`, { type: 'image/png' });
  const fullText = `${text} https://${GAME_URL}/`;
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Poly Battle', text: fullText });
      return 'geteilt';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'abgebrochen';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  try { await navigator.clipboard.writeText(fullText); } catch (e) { /* Text ist Beiwerk */ }
  return 'geladen';
}
