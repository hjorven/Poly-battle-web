// Service Worker: Poly Battle auch ohne Verbindung spielbar (gegen KI,
// Hotseat, Kampagne). Erst das Netz fragen, damit nach jedem Update sofort
// die neue Version läuft; nur wenn das Netz fehlt, die gemerkte Kopie nehmen.
// Online-Partien und Bestenliste (Supabase) laufen nie über den Cache.

const CACHE = 'pb-v1';
const CORE = [
  './', 'index.html', 'css/style.css',
  'js/main.js', 'js/ui.js', 'js/render.js', 'js/rules.js', 'js/ai.js', 'js/config.js', 'js/hex.js',
  'js/net.js', 'js/save.js', 'js/profile.js', 'js/campaign.js', 'js/share.js', 'js/sound.js',
  'js/admin.js', 'js/admin-panel.js',
  'vendor/three/three.module.min.js', 'vendor/three/addons/controls/OrbitControls.js',
  'vendor/supabase/supabase.js'
];

self.addEventListener('install', event => {
  // Fehlt eine Datei, trotzdem installieren: der Rest wird beim Spielen gemerkt.
  event.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })
    .then(hit => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
