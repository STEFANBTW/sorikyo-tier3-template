// ============================================================
// SoriKyo Tier 3 — Vanilla Data-Attribute SDK
// Phase 4: Stylize — sorikyo-tier3.js
//
// This SDK passively scans the DOM for data-sorikyo-* attributes
// placed by the human designer and automatically binds complex
// functionalities to those elements.
//
// Implements ALL 9 data attributes from the SDK Reference Manual:
// 1. data-sorikyo-action="rag-chat"
// 2. data-sorikyo-action="vibe-search"
// 3. data-sorikyo-action="whatsapp-deep"
// 4. data-sorikyo-haptic="[light|heavy|success|error]"
// 5. data-sorikyo-3d-model="[url]"
// 6. data-sorikyo-offline-morph="true"
// 7. data-sorikyo-glass-edit="[target-id]"
// 8. data-sorikyo-track="[item-id]"
// 9. data-sorikyo-intent-nav="true"
// ============================================================

(() => {
    'use strict';

    const API_BASE = window.SORIKYO_API_BASE || '';

    // ─── Utility: Reduced Motion Check ────────────────────────

    const prefersReducedMotion = () =>
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ─── Utility: Debounce ────────────────────────────────────

    function debounce(fn, ms) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), ms);
        };
    }

    // ============================================================
    // MODULE 1: Service Worker Registration
    // ============================================================

    function initServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker
                .register('/sw.js')
                .then((reg) => {
                    console.log('[SoriKyo] Service Worker registered:', reg.scope);
                })
                .catch((err) => {
                    console.warn('[SoriKyo] Service Worker registration failed:', err);
                });
        }
    }

    // ============================================================
    // MODULE 2: IndexedDB Wrapper (for SWR + offline data)
    // ============================================================

    const DB_NAME = 'sorikyo-tier3';
    const DB_VERSION = 1;
    const STORE_NAME = 'swr-cache';

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'url' });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function idbGet(url) {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(url);
            req.onsuccess = () => resolve(req.result?.data ?? null);
            req.onerror = () => resolve(null);
        });
    }

    async function idbSet(url, data) {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put({ url, data, timestamp: Date.now() });
            tx.oncomplete = () => resolve();
        });
    }

    // ============================================================
    // MODULE 3: Stale-While-Revalidate (SWR) Fetch Wrapper
    // ============================================================

    async function swrFetch(url, options = {}) {
        const { method = 'GET', body, onData, forceNetwork = false } = options;

        // 1. Instantly return cached data (stale)
        if (!forceNetwork && method === 'GET') {
            const cachedData = await idbGet(url);
            if (cachedData) {
                onData?.(cachedData, { source: 'cache' });
            }
        }

        // 2. Fetch fresh data from network (revalidate)
        try {
            const fetchOptions = { method, headers: { 'Content-Type': 'application/json' } };
            if (body) fetchOptions.body = JSON.stringify(body);

            const response = await fetch(`${API_BASE}${url}`, fetchOptions);

            if (!response.ok) {
                const err = await response.json().catch(() => ({ message: 'Request failed' }));
                throw new Error(err.message || `HTTP ${response.status}`);
            }

            const freshData = await response.json();

            // Cache for future SWR
            if (method === 'GET') {
                await idbSet(url, freshData);
            }

            onData?.(freshData, { source: 'network' });
            return freshData;
        } catch (err) {
            // If network fails and we already served cached data, silently fail
            // If no cache, propagate the error
            if (!navigator.onLine) {
                const cachedData = await idbGet(url);
                if (cachedData) {
                    onData?.(cachedData, { source: 'cache-offline' });
                    return cachedData;
                }
            }
            throw err;
        }
    }

    // ============================================================
    // MODULE 4: Network-Aware UI Morphing
    // data-sorikyo-offline-morph="true"
    // ============================================================

    function initOfflineMorphing() {
        let offlineBanner = null;

        function createOfflineBanner() {
            offlineBanner = document.createElement('div');
            offlineBanner.className = 'sorikyo-offline-banner';
            offlineBanner.textContent = '⚡ OFFLINE — Showing cached data. Some features are unavailable.';
            offlineBanner.setAttribute('role', 'alert');
            offlineBanner.setAttribute('aria-live', 'assertive');
            document.body.prepend(offlineBanner);
        }

        function morphElements(isOnline) {
            const morphTargets = document.querySelectorAll('[data-sorikyo-offline-morph]');

            morphTargets.forEach((el) => {
                const onlineHTML = el.getAttribute('data-sorikyo-online-content') || el.dataset.onlineContent;
                const offlineHTML = el.getAttribute('data-sorikyo-offline-content') || el.dataset.offlineContent;

                if (isOnline) {
                    if (onlineHTML) el.innerHTML = onlineHTML;
                    el.removeAttribute('disabled');
                    el.classList.remove('sorikyo-morphed-offline');
                } else {
                    if (offlineHTML) el.innerHTML = offlineHTML;
                    if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') {
                        el.setAttribute('disabled', 'true');
                    }
                    el.classList.add('sorikyo-morphed-offline');
                }
            });
        }

        createOfflineBanner();

        window.addEventListener('online', () => {
            offlineBanner?.classList.remove('visible');
            morphElements(true);
            console.log('[SoriKyo] Back online');
        });

        window.addEventListener('offline', () => {
            offlineBanner?.classList.add('visible');
            morphElements(false);
            console.log('[SoriKyo] Gone offline');
        });

        // Set initial state
        if (!navigator.onLine) {
            offlineBanner?.classList.add('visible');
            morphElements(false);
        }
    }

    // ============================================================
    // MODULE 5: Context-Aware WhatsApp Deep-Linking
    // data-sorikyo-action="whatsapp-deep"
    // ============================================================

    function initWhatsAppDeepLinks() {
        const elements = document.querySelectorAll('[data-sorikyo-action="whatsapp-deep"]');

        elements.forEach((el) => {
            const phone = el.dataset.sorikyoPhone || '+31612345678';
            const pageTitle = document.title;
            const pageUrl = window.location.href;

            // Read context from sibling data attributes
            const product = el.dataset.sorikyoProduct || '';
            const service = el.dataset.sorikyoService || '';
            const customMessage = el.dataset.sorikyoMessage || '';

            let message;
            if (customMessage) {
                message = customMessage;
            } else if (product) {
                message = `Hi! I'm interested in "${product}" — I saw it on ${pageUrl}`;
            } else if (service) {
                message = `Hi! I'd like to inquire about your "${service}" service — via ${pageUrl}`;
            } else {
                message = `Hi! I'm reaching out from ${pageTitle} — ${pageUrl}`;
            }

            const waUrl = `https://wa.me/${phone.replace(/[^0-9+]/g, '')}?text=${encodeURIComponent(message)}`;

            if (el.tagName === 'A') {
                el.href = waUrl;
                el.target = '_blank';
                el.rel = 'noopener noreferrer';
            } else {
                el.addEventListener('click', () => window.open(waUrl, '_blank'));
                el.style.cursor = 'pointer';
            }
        });
    }

    // ============================================================
    // MODULE 6: User-Action Recency Tracking (LRU Cache)
    // data-sorikyo-track="[item-id]"
    // ============================================================

    const RECENCY_KEY = 'sorikyo-recency';
    const RECENCY_MAX = 5;

    function getRecencyCache() {
        try {
            return JSON.parse(localStorage.getItem(RECENCY_KEY)) || [];
        } catch {
            return [];
        }
    }

    function pushToRecency(itemId) {
        let cache = getRecencyCache();

        // Remove if already exists (move to front)
        cache = cache.filter((id) => id !== itemId);

        // Push to front
        cache.unshift(itemId);

        // Trim to max length
        if (cache.length > RECENCY_MAX) {
            cache = cache.slice(0, RECENCY_MAX);
        }

        localStorage.setItem(RECENCY_KEY, JSON.stringify(cache));
        return cache;
    }

    function initRecencyTracking() {
        const elements = document.querySelectorAll('[data-sorikyo-track]');

        elements.forEach((el) => {
            el.addEventListener('click', () => {
                const itemId = el.dataset.sorikyoTrack;
                if (itemId) {
                    const cache = pushToRecency(itemId);
                    console.log('[SoriKyo] Recency updated:', cache);

                    // Dispatch custom event for "Welcome Back" logic
                    window.dispatchEvent(
                        new CustomEvent('sorikyo:recency-update', {
                            detail: { itemId, cache },
                        })
                    );
                }
            });
        });

        // On load, dispatch a "welcome back" event if cache has items
        const existingCache = getRecencyCache();
        if (existingCache.length > 0) {
            window.dispatchEvent(
                new CustomEvent('sorikyo:welcome-back', {
                    detail: { recentItems: existingCache },
                })
            );
        }
    }

    // ============================================================
    // MODULE 7: Haptic Feedback API
    // data-sorikyo-haptic="[light|heavy|success|error]"
    // ============================================================

    const HAPTIC_PATTERNS = {
        light: [15],
        heavy: [30],
        success: [10, 30, 10],
        error: [50, 30, 50, 30, 50],
    };

    function initHapticFeedback() {
        // Skip if reduced motion is preferred
        if (prefersReducedMotion()) {
            console.log('[SoriKyo] Haptic disabled — prefers-reduced-motion active');
            return;
        }

        if (!('vibrate' in navigator)) {
            console.log('[SoriKyo] Haptic unavailable — navigator.vibrate not supported');
            return;
        }

        const elements = document.querySelectorAll('[data-sorikyo-haptic]');

        elements.forEach((el) => {
            const type = el.dataset.sorikyoHaptic || 'light';
            const pattern = HAPTIC_PATTERNS[type] || HAPTIC_PATTERNS.light;

            const handler = () => {
                try {
                    navigator.vibrate(pattern);
                } catch (err) {
                    console.warn('[SoriKyo] Haptic failed:', err);
                }
            };

            el.addEventListener('click', handler);
            el.addEventListener('touchstart', handler, { passive: true });
        });
    }

    // ============================================================
    // MODULE 8: Spatial Commerce 3D Environment
    // data-sorikyo-3d-model="[url]"
    // ============================================================

    function initSpatialCommerce() {
        const containers = document.querySelectorAll('[data-sorikyo-3d-model]');
        if (containers.length === 0) return;

        // Lazy-load Three.js from CDN
        const loadThreeJS = () => {
            return new Promise((resolve, reject) => {
                if (window.THREE) return resolve(window.THREE);

                const scripts = [
                    'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.min.js',
                    'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/js/loaders/GLTFLoader.js',
                    'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/js/loaders/DRACOLoader.js',
                    'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/js/controls/OrbitControls.js',
                ];

                let loaded = 0;
                scripts.forEach((src) => {
                    const script = document.createElement('script');
                    script.src = src;
                    script.onload = () => {
                        loaded++;
                        if (loaded === scripts.length) resolve(window.THREE);
                    };
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            });
        };

        // Intersection Observer for lazy initialization
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        observer.unobserve(entry.target);
                        init3DModel(entry.target);
                    }
                });
            },
            { rootMargin: '200px' }
        );

        containers.forEach((container) => {
            container.classList.add('sorikyo-3d-viewport');
            container.innerHTML = '<div class="sorikyo-3d-loading">Loading 3D Model...</div>';
            observer.observe(container);
        });

        async function init3DModel(container) {
            try {
                const THREE = await loadThreeJS();
                const modelUrl = container.dataset.sorikyo3dModel;

                // Scene setup
                const scene = new THREE.Scene();
                scene.background = new THREE.Color(0x050505);

                // Camera
                const width = container.clientWidth;
                const height = container.clientHeight;
                const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
                camera.position.set(0, 1, 3);

                // Renderer with PBR
                const renderer = new THREE.WebGLRenderer({
                    antialias: true,
                    alpha: false,
                });
                renderer.setSize(width, height);
                renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
                renderer.toneMapping = THREE.ACESFilmicToneMapping;
                renderer.toneMappingExposure = 1;
                renderer.outputEncoding = THREE.sRGBEncoding;

                // Clear loading indicator and inject canvas
                container.innerHTML = '';
                container.appendChild(renderer.domElement);

                // Orbit Controls
                const OrbitControls = THREE.OrbitControls;
                const controls = new OrbitControls(camera, renderer.domElement);
                controls.enableDamping = true;
                controls.dampingFactor = 0.05;
                controls.maxPolarAngle = Math.PI / 1.8;

                // PBR Lighting
                const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
                scene.add(ambientLight);

                const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
                directionalLight.position.set(5, 5, 5);
                scene.add(directionalLight);

                const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
                fillLight.position.set(-3, 2, -3);
                scene.add(fillLight);

                // DRACO Loader for geometry compression
                const DRACOLoader = THREE.DRACOLoader;
                const dracoLoader = new DRACOLoader();
                dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');

                // GLTF Loader with MeshStandardMaterial (PBR)
                const GLTFLoader = THREE.GLTFLoader;
                const gltfLoader = new GLTFLoader();
                gltfLoader.setDRACOLoader(dracoLoader);

                gltfLoader.load(
                    modelUrl,
                    (gltf) => {
                        const model = gltf.scene;

                        // Apply MeshStandardMaterial if not already
                        model.traverse((child) => {
                            if (child.isMesh) {
                                child.material = new THREE.MeshStandardMaterial({
                                    color: child.material?.color || new THREE.Color(0xcccccc),
                                    metalness: 0.3,
                                    roughness: 0.7,
                                    normalMap: child.material?.normalMap || null,
                                });
                                child.castShadow = true;
                                child.receiveShadow = true;
                            }
                        });

                        // Center and scale model
                        const box = new THREE.Box3().setFromObject(model);
                        const center = box.getCenter(new THREE.Vector3());
                        const size = box.getSize(new THREE.Vector3());
                        const maxDim = Math.max(size.x, size.y, size.z);
                        model.scale.setScalar(2 / maxDim);
                        model.position.sub(center.multiplyScalar(2 / maxDim));

                        scene.add(model);
                    },
                    undefined,
                    (err) => {
                        console.error('[SoriKyo] 3D model load failed:', err);
                        container.innerHTML = '<div class="sorikyo-3d-loading">Failed to load 3D model</div>';
                    }
                );

                // Animation loop
                function animate() {
                    requestAnimationFrame(animate);
                    controls.update();
                    renderer.render(scene, camera);
                }
                animate();

                // Resize observer
                const resizeObserver = new ResizeObserver(() => {
                    const w = container.clientWidth;
                    const h = container.clientHeight;
                    camera.aspect = w / h;
                    camera.updateProjectionMatrix();
                    renderer.setSize(w, h);
                });
                resizeObserver.observe(container);
            } catch (err) {
                console.error('[SoriKyo] 3D initialization failed:', err);
                container.innerHTML = '<div class="sorikyo-3d-loading">3D not available</div>';
            }
        }
    }

    // ============================================================
    // MODULE 9: Glassmorphism Inline Editing
    // data-sorikyo-glass-edit="[target-id]"
    // ============================================================

    function initGlassEditing() {
        const triggers = document.querySelectorAll('[data-sorikyo-glass-edit]');

        triggers.forEach((trigger) => {
            trigger.addEventListener('click', () => {
                const targetId = trigger.dataset.sorikyoGlassEdit;
                const targetEl = document.getElementById(targetId);

                if (!targetEl) {
                    console.warn(`[SoriKyo] Glass edit target #${targetId} not found`);
                    return;
                }

                // Create glass overlay
                const overlay = document.createElement('div');
                overlay.className = 'sorikyo-glass-overlay';

                const panel = document.createElement('div');
                panel.className = 'sorikyo-glass-panel';

                // Clone target content into editable panel
                const editableContent = targetEl.cloneNode(true);
                editableContent.setAttribute('contenteditable', 'true');
                editableContent.style.outline = 'none';
                editableContent.style.minHeight = '100px';

                // Action buttons
                const actions = document.createElement('div');
                actions.style.cssText = 'display:flex;gap:0.75rem;margin-top:1.5rem;justify-content:flex-end;';

                const cancelBtn = document.createElement('button');
                cancelBtn.textContent = 'Cancel';
                cancelBtn.style.cssText = `
          background:transparent;border:1px solid var(--color-border, #2A2A2A);
          color:var(--color-text, #E0E0E0);padding:0.5rem 1.5rem;cursor:pointer;
          font-family:var(--font-mono, monospace);font-size:0.75rem;
          letter-spacing:0.1em;text-transform:uppercase;
        `;

                const saveBtn = document.createElement('button');
                saveBtn.textContent = 'Save';
                saveBtn.style.cssText = `
          background:var(--color-accent, #FFFFFF);color:var(--color-primary, #0A0A0A);
          border:none;padding:0.5rem 1.5rem;cursor:pointer;
          font-family:var(--font-mono, monospace);font-size:0.75rem;
          letter-spacing:0.1em;text-transform:uppercase;font-weight:600;
        `;

                actions.appendChild(cancelBtn);
                actions.appendChild(saveBtn);
                panel.appendChild(editableContent);
                panel.appendChild(actions);
                overlay.appendChild(panel);
                document.body.appendChild(overlay);

                // Focus trap
                requestAnimationFrame(() => {
                    overlay.classList.add('active');
                    editableContent.focus();
                });

                // Cancel
                cancelBtn.addEventListener('click', () => {
                    overlay.classList.remove('active');
                    setTimeout(() => overlay.remove(), 300);
                });

                // Click outside to cancel
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) {
                        overlay.classList.remove('active');
                        setTimeout(() => overlay.remove(), 300);
                    }
                });

                // Save
                saveBtn.addEventListener('click', () => {
                    targetEl.innerHTML = editableContent.innerHTML;
                    overlay.classList.remove('active');
                    setTimeout(() => overlay.remove(), 300);

                    // Dispatch event for server-side persistence
                    window.dispatchEvent(
                        new CustomEvent('sorikyo:glass-save', {
                            detail: {
                                targetId,
                                newContent: editableContent.innerHTML,
                            },
                        })
                    );
                });

                // Escape to cancel
                overlay.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        overlay.classList.remove('active');
                        setTimeout(() => overlay.remove(), 300);
                    }
                });
            });
        });
    }

    // ============================================================
    // MODULE 10: Semantic Vibe Search
    // data-sorikyo-action="vibe-search"
    // ============================================================

    function initVibeSearch() {
        const inputs = document.querySelectorAll('[data-sorikyo-action="vibe-search"]');

        inputs.forEach((input) => {
            const targetId = input.dataset.sorikyoTarget;
            const targetEl = targetId ? document.getElementById(targetId) : null;

            const search = debounce(async (query) => {
                if (!query || query.length < 3) return;

                try {
                    const data = await swrFetch('/api/vibe-search', {
                        method: 'POST',
                        body: { query },
                        onData: (result, meta) => {
                            if (targetEl && result.results) {
                                renderVibeResults(targetEl, result.results, meta.source);
                            }
                        },
                    });
                } catch (err) {
                    console.error('[SoriKyo] Vibe search failed:', err);
                    if (targetEl) {
                        targetEl.innerHTML = '<p style="color:var(--color-error)">Search unavailable</p>';
                    }
                }
            }, 400);

            input.addEventListener('input', (e) => search(e.target.value.trim()));
        });
    }

    function renderVibeResults(container, results, source) {
        if (!results || results.length === 0) {
            container.innerHTML = '<p style="color:var(--color-text-muted)">No results found</p>';
            return;
        }

        const sourceTag = source !== 'network'
            ? `<span style="color:var(--color-warning);font-size:0.7rem;">[${source}]</span>`
            : '';

        container.innerHTML = results
            .map(
                (item) => `
      <div style="padding:var(--space-md);border:1px solid var(--color-border);border-radius:var(--radius-md);margin-bottom:var(--space-sm);">
        <strong>${item.name || 'Unknown'}</strong> ${sourceTag}
        <p style="color:var(--color-text-muted);font-size:var(--text-sm);margin-top:var(--space-xs);">${item.description || ''}</p>
        ${item.price ? `<span style="font-family:var(--font-mono);font-size:var(--text-sm);">€${item.price}</span>` : ''}
      </div>
    `
            )
            .join('');
    }

    // ============================================================
    // MODULE 11: RAG Chat Interface
    // data-sorikyo-action="rag-chat"
    // ============================================================

    function initRAGChat() {
        const chatContainers = document.querySelectorAll('[data-sorikyo-action="rag-chat"]');

        chatContainers.forEach((container) => {
            const messagesDiv = container.querySelector('[data-sorikyo-chat-messages]')
                || createChatMessages(container);
            const inputEl = container.querySelector('[data-sorikyo-chat-input]')
                || createChatInput(container);
            const sendBtn = container.querySelector('[data-sorikyo-chat-send]')
                || createChatSend(container);

            const history = [];

            const sendMessage = async () => {
                const message = inputEl.value.trim();
                if (!message) return;

                // Add user bubble
                appendBubble(messagesDiv, message, 'user');
                inputEl.value = '';
                history.push({ role: 'user', content: message });

                // Create AI bubble placeholder
                const aiBubble = appendBubble(messagesDiv, '', 'ai');

                try {
                    const response = await fetch(`${API_BASE}/api/rag-chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message, history: history.slice(-10) }),
                    });

                    if (!response.ok) throw new Error(`HTTP ${response.status}`);

                    // Stream the response
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let fullResponse = '';

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split('\n');

                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = line.slice(6);
                                if (data === '[DONE]') break;
                                try {
                                    const parsed = JSON.parse(data);
                                    if (parsed.content) {
                                        fullResponse += parsed.content;
                                        aiBubble.textContent = fullResponse;
                                        messagesDiv.scrollTop = messagesDiv.scrollHeight;
                                    }
                                } catch { /* ignore parse errors for partial chunks */ }
                            }
                        }
                    }

                    history.push({ role: 'assistant', content: fullResponse });
                } catch (err) {
                    aiBubble.textContent = 'Sorry, I\'m having trouble connecting. Please try WhatsApp for immediate assistance.';
                    aiBubble.style.color = 'var(--color-error)';
                    console.error('[SoriKyo] RAG chat error:', err);
                }
            };

            sendBtn.addEventListener('click', sendMessage);
            inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });
        });
    }

    function createChatMessages(container) {
        const div = document.createElement('div');
        div.className = 'sorikyo-chat-messages';
        div.setAttribute('data-sorikyo-chat-messages', '');
        div.style.cssText = 'max-height:400px;overflow-y:auto;display:flex;flex-direction:column;gap:0.5rem;padding:1rem;';
        container.prepend(div);
        return div;
    }

    function createChatInput(container) {
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Ask me anything...';
        input.setAttribute('data-sorikyo-chat-input', '');
        input.style.cssText = `
      width:100%;padding:0.75rem 1rem;background:var(--color-surface, #111);
      border:1px solid var(--color-border, #2A2A2A);border-radius:var(--radius-md, 8px);
      color:var(--color-text, #E0E0E0);font-family:var(--font-primary, sans-serif);
      font-size:var(--text-sm, 0.875rem);outline:none;
    `;
        container.appendChild(input);
        return input;
    }

    function createChatSend(container) {
        const btn = document.createElement('button');
        btn.textContent = 'Send';
        btn.setAttribute('data-sorikyo-chat-send', '');
        btn.style.cssText = `
      margin-top:0.5rem;padding:0.5rem 1.5rem;background:var(--color-accent, #FFF);
      color:var(--color-primary, #0A0A0A);border:none;cursor:pointer;
      font-family:var(--font-mono, monospace);font-size:0.75rem;
      letter-spacing:0.1em;text-transform:uppercase;font-weight:600;
    `;
        container.appendChild(btn);
        return btn;
    }

    function appendBubble(messagesDiv, text, sender) {
        const bubble = document.createElement('div');
        bubble.className = sender === 'user' ? 'sorikyo-chat-bubble-user' : 'sorikyo-chat-bubble-ai';
        bubble.textContent = text;
        messagesDiv.appendChild(bubble);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
        return bubble;
    }

    // ============================================================
    // MODULE 12: Intent Navigation
    // data-sorikyo-intent-nav="true"
    // ============================================================

    function initIntentNav() {
        const inputs = document.querySelectorAll('[data-sorikyo-intent-nav]');

        inputs.forEach((input) => {
            const handleIntent = debounce(async (text) => {
                if (!text || text.length < 3) return;

                try {
                    const response = await fetch(`${API_BASE}/api/intent`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ input: text }),
                    });

                    if (!response.ok) return;

                    const data = await response.json();
                    const intent = data.intent;

                    if (!intent || intent.action === 'unknown') return;

                    switch (intent.action) {
                        case 'scroll': {
                            const target = document.querySelector(intent.target);
                            if (target) {
                                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                            break;
                        }
                        case 'open_modal': {
                            const modal = document.querySelector(intent.target);
                            if (modal) {
                                modal.classList.add('active');
                                modal.setAttribute('aria-hidden', 'false');
                            }
                            break;
                        }
                        case 'navigate': {
                            window.location.href = intent.target;
                            break;
                        }
                        case 'whatsapp': {
                            window.open(`https://wa.me/+31612345678?text=${encodeURIComponent(intent.message || '')}`, '_blank');
                            break;
                        }
                        case 'call': {
                            window.location.href = `tel:${intent.target}`;
                            break;
                        }
                    }
                } catch (err) {
                    console.error('[SoriKyo] Intent nav error:', err);
                }
            }, 600);

            if (input.tagName === 'INPUT' || input.tagName === 'TEXTAREA') {
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        handleIntent(input.value.trim());
                        input.value = '';
                    }
                });
            }
        });
    }

    // ============================================================
    // MODULE 13: Booking Form & Paystack Integration
    // data-sorikyo-form="booking"
    // ============================================================

    function initBookingForm() {
        const forms = document.querySelectorAll('form[data-sorikyo-form="booking"]');
        forms.forEach(form => {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const btn = form.querySelector('button[type="submit"]');
                const originalText = btn.textContent;
                btn.textContent = 'Processing...';
                btn.disabled = true;

                try {
                    const formData = new FormData(form);
                    const body = Object.fromEntries(formData.entries());
                    // Formatting ISO date for DB
                    body.startTime = new Date(body.startTime).toISOString();
                    body.endTime = new Date(body.endTime).toISOString();

                    const res = await fetch(`${API_BASE}/api/bookings/create`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });

                    const data = await res.json();
                    if (!res.ok) throw new Error(data.message || 'Booking failed');

                    // If deposit required, trigger Paystack
                    if (data.depositRequired > 0 && window.PaystackPop) {
                        const paystack = new window.PaystackPop();
                        paystack.newTransaction({
                            key: window.SORIKYO_PAYSTACK_PUBLIC || 'pk_test_dummy',
                            email: body.customerEmail || 'test@example.com',
                            amount: data.depositRequired * 100, // Kobo/Cents
                            currency: 'EUR',
                            ref: data.paymentReference,
                            onSuccess: (transaction) => {
                                alert('Payment successful! Reference: ' + transaction.reference);
                                form.reset();
                            },
                            onCancel: () => {
                                alert('Payment cancelled. Booking is pending.');
                            }
                        });
                    } else {
                        alert('Booking confirmed!');
                        form.reset();
                    }
                } catch (err) {
                    alert('Error: ' + err.message);
                } finally {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }
            });
        });
    }

    // ============================================================
    // MODULE 14: Predictive Prefetching
    // data-sorikyo-prefetch="[url]"
    // ============================================================

    function initPrefetch() {
        if (prefersReducedMotion() || navigator.connection?.saveData) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const url = entry.target.dataset.sorikyoPrefetch;
                    if (url && !document.querySelector(`link[rel="prefetch"][href="${url}"]`)) {
                        const link = document.createElement('link');
                        link.rel = 'prefetch';
                        link.href = url;
                        document.head.appendChild(link);
                        observer.unobserve(entry.target);
                    }
                }
            });
        }, { rootMargin: '100px' });

        document.querySelectorAll('[data-sorikyo-prefetch]').forEach(el => observer.observe(el));
    }

    // ============================================================
    // MODULE 15: Lazy Map Embed
    // data-sorikyo-map="[lat,lng]"
    // ============================================================

    function initLazyMaps() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const [lat, lng] = entry.target.dataset.sorikyoMap.split(',');
                    const iframe = document.createElement('iframe');
                    iframe.width = "100%";
                    iframe.height = "100%";
                    iframe.style.border = "0";
                    iframe.loading = "lazy";
                    iframe.src = `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`;
                    entry.target.appendChild(iframe);
                    observer.unobserve(entry.target);
                }
            });
        }, { rootMargin: '250px' });

        document.querySelectorAll('[data-sorikyo-map]').forEach(el => observer.observe(el));
    }

    // ============================================================
    // MODULE 16: UX Toggles (Contrast / Motion)
    // data-sorikyo-toggle="[contrast|motion]"
    // ============================================================

    function initUXToggles() {
        document.querySelectorAll('[data-sorikyo-toggle]').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.sorikyoToggle; // 'contrast' or 'motion'
                const html = document.documentElement;
                const cls = `sorikyo-${type}-override`;

                if (html.classList.contains(cls)) {
                    html.classList.remove(cls);
                    localStorage.removeItem(cls);
                } else {
                    html.classList.add(cls);
                    localStorage.setItem(cls, 'true');
                }
            });
        });

        // Apply saved states on load
        ['contrast', 'motion'].forEach(type => {
            if (localStorage.getItem(`sorikyo-${type}-override`)) {
                document.documentElement.classList.add(`sorikyo-${type}-override`);
            }
        });
    }

    // ============================================================
    // MODULE 17: Image Optimization Proxy
    // data-sorikyo-image-proxy="[url]"
    // ============================================================

    function initImageProxy() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const src = img.dataset.sorikyoImageProxy;
                    const w = img.getAttribute('width') || img.clientWidth || 800;
                    img.src = `${API_BASE}/api/images/proxy?url=${encodeURIComponent(src)}&w=${w}`;
                    observer.unobserve(img);
                }
            });
        });

        document.querySelectorAll('img[data-sorikyo-image-proxy]').forEach(el => observer.observe(el));
    }

    // ============================================================
    // MODULE 18: Scroll to Top
    // data-sorikyo-scroll-top="true"
    // ============================================================

    function initScrollTop() {
        const btns = document.querySelectorAll('[data-sorikyo-scroll-top]');
        btns.forEach(btn => {
            btn.style.opacity = '0';
            btn.style.pointerEvents = 'none';
            btn.style.transition = 'opacity 0.3s ease';

            window.addEventListener('scroll', throttle(() => {
                if (window.scrollY > 300) {
                    btn.style.opacity = '1';
                    btn.style.pointerEvents = 'auto';
                } else {
                    btn.style.opacity = '0';
                    btn.style.pointerEvents = 'none';
                }
            }, 100));

            btn.addEventListener('click', () => {
                window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
            });
        });
    }

    // Simple throttle helper for scroll
    function throttle(fn, wait) {
        let time = Date.now();
        return function () {
            if ((time + wait - Date.now()) < 0) {
                fn();
                time = Date.now();
            }
        }
    }

    // ============================================================
    // INIT: Bind everything on DOMContentLoaded
    // ============================================================

    document.addEventListener('DOMContentLoaded', () => {
        console.log('[SoriKyo] Tier 3 Omni-Stack SDK initializing...');

        // Core infrastructure
        initServiceWorker();
        initOfflineMorphing();

        // Feature modules
        initWhatsAppDeepLinks();
        initRecencyTracking();
        initHapticFeedback();
        initSpatialCommerce();
        initGlassEditing();
        initVibeSearch();
        initRAGChat();
        initIntentNav();

        // Expanded Omni-Stack Phase Modules
        initBookingForm();
        initPrefetch();
        initLazyMaps();
        initUXToggles();
        initImageProxy();
        initScrollTop();

        console.log('[SoriKyo] Tier 3 SDK ready ✅');
    });
})();
