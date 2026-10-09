import { UNITS, TECHS, TECH_TIERS, TRIBES, COLORS } from './config.js';

export function unitEmoji(type) {
  return UNITS[type]?.emoji || '❔';
}

export function updateStrip(state, ctx) {
  const p1Tribe = TRIBES[state.tribes.player_1];
  const p2Tribe = TRIBES[state.tribes.player_2];

  document.getElementById('player-strip').innerHTML = `
    <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white font-semibold">
      <span>${p1Tribe.emoji} ${p1Tribe.name}</span>
      <span class="text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 text-xs">⭐ ${state.stars.player_1}</span>
    </div>
    <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white font-semibold">
      <span>${p2Tribe.emoji} ${p2Tribe.name}</span>
      <span class="text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-100 text-xs">⭐ ${state.stars.player_2}</span>
    </div>
  `;
}
