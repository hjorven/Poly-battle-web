// Wappen der Stämme und kleine Symbole für die Oberfläche – alles als SVG
// (keine Emojis, keine Schriftzeichen als Symbol).

// Schildform und ein schlichtes Zeichen je Stamm (24er-Raster).
const SHIELD = 'M3 2.5h18v8.5c0 6.2-4.6 9.8-9 11.5-4.4-1.7-9-5.3-9-11.5z';
const EMBLEMS = {
  // Turm mit Zinnen
  tower: 'M8 7h1.6v1.6h1.6V7h1.6v1.6h1.6V7H16v3.4h-1v6.1H9v-6.1H8z',
  // Tanne
  tree: 'M12 5.5l3.6 4.6h-1.8l2.6 3.4h-2l2.4 3H12.9v2h-1.8v-2H7.2l2.4-3h-2l2.6-3.4H8.4z',
  // Berg mit Schneekappe
  mountain: 'M5.5 16.5l4.4-7.2 2 3 2.6-4.6 4 8.8z',
  // zwei Wellen
  wave: 'M6 10.6c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 3 0v1.8c0-1.3-1.5-1.3-3 0s-3 1.3-4.5 0-3-1.3-4.5 0zM6 14.6c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0 3-1.3 3 0v1.8c0-1.3-1.5-1.3-3 0s-3 1.3-4.5 0-3-1.3-4.5 0z',
  // Sonne
  sun: 'M12 8.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8zM11.3 5h1.4v2.2h-1.4zM11.3 16.8h1.4V19h-1.4zM6 11.3h2.2v1.4H6zM15.8 11.3H18v1.4h-2.2z',
  // Bogen mit Pfeil
  bow: 'M8.2 5.6c4.6 1.2 7.4 5.2 6.6 10.6l-1.4-.2c.6-4.5-1.6-7.9-5.6-9zM7.6 6.4l8.6 8.6-1 1-8.6-8.6zM15.6 13.4l1.8 3.4-3.4-1.8z',
  // Kreuz
  cross: 'M10.8 6h2.4v4.4h4.3v2.4h-4.3V18h-2.4v-5.2H6.5v-2.4h4.3z',
  // Hammer
  hammer: 'M7.5 7.2h6.8v3.2H12v7.6h-2v-7.6H7.5z',
  // Ähre
  wheat: 'M11.2 18.5V9h1.6v9.5zM12 5.5c1.3 1 1.3 2.6 0 3.6-1.3-1-1.3-2.6 0-3.6zM9.4 8.6c1.6.2 2.4 1.5 2 3-1.6-.2-2.4-1.5-2-3zM14.6 8.6c.4 1.5-.4 2.8-2 3-.4-1.5.4-2.8 2-3zM9.4 11.8c1.6.2 2.4 1.5 2 3-1.6-.2-2.4-1.5-2-3zM14.6 11.8c.4 1.5-.4 2.8-2 3-.4-1.5.4-2.8 2-3z',
  // Mondsichel
  moon: 'M13.6 6.2a6 6 0 1 0 3.2 10.4 5 5 0 1 1-3.2-10.4z',
  // Rad
  wheel: 'M12 6.3a5.7 5.7 0 1 1 0 11.4 5.7 5.7 0 0 1 0-11.4zm0 1.6a4.1 4.1 0 1 0 0 8.2 4.1 4.1 0 0 0 0-8.2zm-.7 0h1.4v8.2h-1.4zM7.9 11.3h8.2v1.4H7.9z',
  // Krone
  crown: 'M6.5 15.8l-.8-7 3.5 2.7L12 7l2.8 4.5 3.5-2.7-.8 7zM6.8 16.8h10.4v1.6H6.8z'
};
const TRIBE_EMBLEM = {
  imperius: 'tower', bardur: 'tree', xinxi: 'mountain', kickoo: 'wave', oumaji: 'sun', hoodrick: 'bow',
  quetzali: 'cross', vengir: 'hammer', zebasi: 'wheat', aimo: 'moon', yadakk: 'wheel', luxidoor: 'crown'
};
const FALLBACK = ['tower', 'cross', 'wave', 'sun', 'crown'];

const toCss = c => typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c;
// Helle Farben (Gelb, Weiß) bekommen ein dunkles Zeichen, sonst ein helles.
function light(css) {
  const n = parseInt(css.slice(1), 16);
  const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

// Wappen eines Spielers: tribeId (oder null), Farbe, Größe in px.
export function crest(tribeId, color, size = 28, playerIndex = 0, extraClass = '') {
  const css = toCss(color);
  const emblem = EMBLEMS[TRIBE_EMBLEM[tribeId] || FALLBACK[playerIndex % FALLBACK.length]];
  const mark = light(css) ? '#2e221a' : '#f3ecdc';
  return `<svg class="crest ${extraClass}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
    <path d="${SHIELD}" fill="${css}" stroke="#1d150f" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="${emblem}" fill="${mark}"/>
  </svg>`;
}

// Symbole für Werte und Aktionen (Strichzeichnung, Farbe über currentColor).
const ICONS = {
  coin: '<circle cx="12" cy="12" r="8" fill="currentColor"/><circle cx="12" cy="12" r="5.2" fill="none" stroke="#2e221a" stroke-opacity=".45" stroke-width="1.4"/>',
  heart: '<path d="M12 19.5s-7-4.3-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.1c0 5.1-7 9.4-7 9.4z" fill="currentColor"/>',
  sword: '<path d="M19.5 3.5l-.6 3.4-8 8-2.8-2.8 8-8z" fill="currentColor"/><path d="M6 11.6l1.4-1.4 6.4 6.4-1.4 1.4z" fill="currentColor"/><path d="M8.6 15.4l1.4 1.4-3.6 3.6a1 1 0 0 1-1.4-1.4z" fill="currentColor"/>',
  shield: '<path d="M12 3.5l7 2.6v5.2c0 4.6-3 7.8-7 9.2-4-1.4-7-4.6-7-9.2V6.1z" fill="currentColor"/>',
  boot: '<path d="M7 3.5h6v8l5.2 2.4A3 3 0 0 1 20 16.6V18H6.2L7 13.5z" fill="currentColor"/><path d="M5.8 19.2H20v1.6H5.8z" fill="currentColor"/>',
  bow: '<path d="M6.5 4.5c7 1 11.4 6.6 10.6 14.4l-1.6-.2c.7-6.9-3.2-11.7-9.2-12.6z" fill="currentColor"/><path d="M6.8 5.6L18 16.8" stroke="currentColor" stroke-width="1.2"/><path d="M19.4 18.3l-1.2-3.6-1.6 1.6z" fill="currentColor"/>',
  hourglass: '<path d="M7 3.5h10v1.6c0 2.6-2.2 4.6-3.6 6.9 1.4 2.3 3.6 4.3 3.6 6.9v1.6H7v-1.6c0-2.6 2.2-4.6 3.6-6.9C9.2 9.7 7 7.7 7 5.1z" fill="currentColor"/>',
  next: '<path d="M8 5l8 7-8 7z" fill="currentColor"/>'
};

export function icon(name, size = 14, extraClass = '') {
  return `<svg class="ico ${extraClass}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
