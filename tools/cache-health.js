// ============================================================
// SoriKyo Tier 3 — Cache Health Check
// Phase 2: Link — Verify Service Worker manifest & IndexedDB
// Run: node tools/cache-health.js
// ============================================================

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PASS = '✅';
const FAIL = '❌';
const INFO = 'ℹ️';

function checkCacheHealth() {
    console.log('\n══════════════════════════════════════════');
    console.log('  SoriKyo Tier 3 — Cache Health Check');
    console.log('══════════════════════════════════════════\n');

    const results = [];

    // ─── Test 1: Service Worker File Existence ──────────────
    const swPath = resolve('./public/sw.js');
    if (existsSync(swPath)) {
        const swContent = readFileSync(swPath, 'utf-8');
        results.push({ test: 'Service Worker (sw.js)', status: PASS, detail: `${swContent.length} bytes` });

        // Validate critical patterns in sw.js
        const patterns = [
            { name: 'Cache Name', regex: /CACHE_NAME|cacheName/i },
            { name: 'Fetch Intercept', regex: /addEventListener.*fetch/i },
            { name: 'Install Handler', regex: /addEventListener.*install/i },
            { name: 'Activate Handler', regex: /addEventListener.*activate/i },
        ];

        for (const p of patterns) {
            results.push({
                test: `SW Pattern: ${p.name}`,
                status: p.regex.test(swContent) ? PASS : FAIL,
                detail: p.regex.test(swContent) ? 'Found' : 'Missing in sw.js',
            });
        }
    } else {
        results.push({ test: 'Service Worker (sw.js)', status: FAIL, detail: `Not found at ${swPath}` });
    }

    // ─── Test 2: Offline Fallback Page ──────────────────────
    const offlinePath = resolve('./public/offline.html');
    if (existsSync(offlinePath)) {
        results.push({ test: 'Offline Fallback (offline.html)', status: PASS, detail: 'Found' });
    } else {
        results.push({ test: 'Offline Fallback (offline.html)', status: FAIL, detail: 'Missing — L3 Ghost Mode requires offline.html' });
    }

    // ─── Test 3: sorikyo-tier3.js SDK Existence ─────────────
    const sdkPath = resolve('./public/sorikyo-tier3.js');
    if (existsSync(sdkPath)) {
        const sdkContent = readFileSync(sdkPath, 'utf-8');
        results.push({ test: 'SDK (sorikyo-tier3.js)', status: PASS, detail: `${sdkContent.length} bytes` });

        // Validate IndexedDB schema patterns
        const idbPatterns = [
            { name: 'IndexedDB Open', regex: /indexedDB\.open|openDB/i },
            { name: 'SWR Logic', regex: /stale.*while.*revalidate|swrFetch|cachedData/i },
            { name: 'Online/Offline Listener', regex: /addEventListener.*online|addEventListener.*offline/i },
        ];

        for (const p of idbPatterns) {
            results.push({
                test: `SDK Pattern: ${p.name}`,
                status: p.regex.test(sdkContent) ? PASS : FAIL,
                detail: p.regex.test(sdkContent) ? 'Found' : 'Missing in sorikyo-tier3.js',
            });
        }
    } else {
        results.push({ test: 'SDK (sorikyo-tier3.js)', status: FAIL, detail: `Not found at ${sdkPath}` });
    }

    // ─── Test 4: Theme CSS ──────────────────────────────────
    const themePath = resolve('./public/sorikyo-theme.css');
    if (existsSync(themePath)) {
        const themeContent = readFileSync(themePath, 'utf-8');
        const hasRoot = /:root\s*\{/.test(themeContent);
        const hasReducedMotion = /prefers-reduced-motion/.test(themeContent);
        results.push({ test: 'Theme CSS (:root vars)', status: hasRoot ? PASS : FAIL, detail: hasRoot ? 'CSS variables found' : 'Missing :root block' });
        results.push({ test: 'Theme CSS (vestibular safety)', status: hasReducedMotion ? PASS : FAIL, detail: hasReducedMotion ? 'Reduced motion query found' : 'Missing prefers-reduced-motion' });
    } else {
        results.push({ test: 'Theme CSS (sorikyo-theme.css)', status: FAIL, detail: `Not found at ${themePath}` });
    }

    // ─── Report ─────────────────────────────────────────────
    console.log('Results:');
    for (const r of results) {
        console.log(`  ${r.status} ${r.test} — ${r.detail}`);
    }

    const failures = results.filter(r => r.status === FAIL);
    console.log(`\n${INFO} Total: ${results.length} tests, ${results.length - failures.length} passed, ${failures.length} failed\n`);

    if (failures.length > 0) {
        console.error(`${FAIL} WARNING: Cache infrastructure has issues. Review before deploying L3 Offline Ghost Mode.\n`);
    } else {
        console.log(`${PASS} Cache infrastructure verified. L3 Offline Ghost Mode ready.\n`);
    }
}

checkCacheHealth();
