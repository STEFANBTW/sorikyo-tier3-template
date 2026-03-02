// ============================================================
// SoriKyo Tier 3 — Service Worker (L3 Offline Ghost Mode)
// Phase 4: Stylize — Cache-first with network fallback
// ============================================================

const CACHE_NAME = 'sorikyo-tier3-v1';
const OFFLINE_URL = '/offline.html';

// Static assets to pre-cache on install
const PRECACHE_ASSETS = [
    '/',
    '/index.html',
    '/sorikyo-theme.css',
    '/sorikyo-tier3.js',
    '/offline.html',
];

// ─── Install: Pre-cache static shell ────────────────────────

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE_ASSETS);
        })
    );
    self.skipWaiting();
});

// ─── Activate: Clean old caches ─────────────────────────────

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// ─── Fetch: Network-first for API, Cache-first for assets ───

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // API calls: Network-first with no cache fallback
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/qr/')) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // Cache successful API responses for SWR
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, clone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // Return cached API response if offline
                    return caches.match(request).then((cached) => {
                        if (cached) return cached;

                        // Return a synthetic offline JSON response
                        return new Response(
                            JSON.stringify({
                                status: 'offline',
                                code: 503,
                                message: 'You are currently offline. Data shown may be stale.',
                            }),
                            {
                                status: 503,
                                headers: { 'Content-Type': 'application/json' },
                            }
                        );
                    });
                })
        );
        return;
    }

    // Static assets: Cache-first with network fallback
    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;

            return fetch(request)
                .then((response) => {
                    // Cache new static assets
                    if (response.ok && response.type === 'basic') {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, clone);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // HTML navigation failures → offline page
                    if (request.headers.get('Accept')?.includes('text/html')) {
                        return caches.match(OFFLINE_URL);
                    }
                });
        })
    );
});

// ─── Message Handler: Manual cache busting ──────────────────

self.addEventListener('message', (event) => {
    if (event.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data === 'CLEAR_CACHE') {
        caches.delete(CACHE_NAME).then(() => {
            caches.open(CACHE_NAME).then((cache) => {
                cache.addAll(PRECACHE_ASSETS);
            });
        });
    }
});
