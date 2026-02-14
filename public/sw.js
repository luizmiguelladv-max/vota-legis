// Service Worker para PWA de Ponto Eletronico
const CACHE_NAME = 'ponto-eletronico-v8';
const DB_NAME = 'ponto-offline-db';
const DB_VERSION = 2;
const STORE_NAME = 'pontos-pendentes';
const USER_STORE_NAME = 'user-info';

const urlsToCache = [
    '/app-mobile',
    '/app-facial',
    '/manifest.json',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

// ========== IndexedDB Helper ==========
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('synced', 'synced', { unique: false });
            }
            if (!db.objectStoreNames.contains(USER_STORE_NAME)) {
                db.createObjectStore(USER_STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

// ========== User Info Storage ==========
async function saveUserInfo(userInfo) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(USER_STORE_NAME, 'readwrite');
        const store = tx.objectStore(USER_STORE_NAME);
        const data = { id: 'current_user', ...userInfo, savedAt: Date.now() };
        const request = store.put(data);
        request.onsuccess = () => resolve(data);
        request.onerror = () => reject(request.error);
    });
}

async function getUserInfo() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(USER_STORE_NAME, 'readonly');
        const store = tx.objectStore(USER_STORE_NAME);
        const request = store.get('current_user');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

async function clearUserInfo() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(USER_STORE_NAME, 'readwrite');
        const store = tx.objectStore(USER_STORE_NAME);
        const request = store.delete('current_user');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// ========== Offline Ponto Storage ==========
async function salvarPontoOffline(ponto) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        const pontoComMeta = {
            ...ponto,
            timestamp: Date.now(),
            synced: false,
            tentativas: 0
        };

        const request = store.add(pontoComMeta);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getPontosNaoSincronizados() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('synced');
        const request = index.getAll(false);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function marcarComoSincronizado(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
            const ponto = request.result;
            if (ponto) {
                ponto.synced = true;
                ponto.syncedAt = Date.now();
                store.put(ponto);
            }
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

async function removerPontosSincronizados() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('synced');
        const request = index.openCursor(true);

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            } else {
                resolve();
            }
        };
        request.onerror = () => reject(request.error);
    });
}

async function getLastPonto() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const request = index.openCursor(null, 'prev');

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            resolve(cursor ? cursor.value : null);
        };
        request.onerror = () => reject(request.error);
    });
}

// Instalacao - cache dos arquivos
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Cache aberto');
                return cache.addAll(urlsToCache);
            })
            .catch(err => console.log('[SW] Erro no cache:', err))
    );
    self.skipWaiting();
});

// Ativacao - limpa caches antigos
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        console.log('[SW] Removendo cache antigo:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch - estrategia network-first com fallback para cache
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    if (event.request.url.includes('/api/')) return;
    if (event.request.url.includes('localhost:5001') || event.request.url.includes('127.0.0.1:5001')) return;

    const url = new URL(event.request.url);
    if (!['http:', 'https:'].includes(url.protocol)) return;
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, responseClone);
                    }).catch(err => console.log('[SW] Erro ao cachear:', err));
                }
                return response;
            })
            .catch(() => {
                return caches.match(event.request).then(response => {
                    if (response) return response;
                    if (event.request.destination === 'document') {
                        return caches.match('/app-mobile');
                    }
                    return new Response('', { status: 404, statusText: 'Not Found' });
                });
            })
    );
});

// Push notifications
self.addEventListener('push', event => {
    const data = event.data?.json() || {};
    const options = {
        body: data.body || 'Nova notificacao',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-72.png',
        vibrate: [100, 50, 100],
        data: { url: data.url || '/app' },
        actions: [
            { action: 'open', title: 'Abrir' },
            { action: 'close', title: 'Fechar' }
        ]
    };
    event.waitUntil(self.registration.showNotification(data.title || 'Ponto Eletronico', options));
});

// Sincronizacao em background
self.addEventListener('sync', event => {
    if (event.tag === 'sync-pontos') {
        event.waitUntil(sincronizarPontosOffline());
    }
});

async function sincronizarPontosOffline() {
    try {
        console.log('[SW] Iniciando sincronizacao de pontos offline...');
        const pontosPendentes = await getPontosNaoSincronizados();
        console.log('[SW] ' + pontosPendentes.length + ' ponto(s) para sincronizar');

        let sincronizados = 0;
        let erros = 0;

        for (const ponto of pontosPendentes) {
            try {
                const response = await fetch('/api/app/sync-offline', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        cpf: ponto.cpf,
                        matricula: ponto.matricula,
                        tipo: ponto.tipo,
                        dataHora: ponto.dataHora,
                        latitude: ponto.latitude || 0,
                        longitude: ponto.longitude || 0,
                        id: ponto.offlineId || ponto.id
                    })
                });

                if (response.ok) {
                    await marcarComoSincronizado(ponto.id);
                    sincronizados++;
                    console.log('[SW] Ponto ' + ponto.id + ' sincronizado');
                } else {
                    erros++;
                    console.error('[SW] Erro ao sincronizar ponto ' + ponto.id + ':', response.status);
                }
            } catch (err) {
                erros++;
                console.error('[SW] Erro ao sincronizar ponto ' + ponto.id + ':', err);
            }
        }

        await removerPontosSincronizados();

        const clients = await self.clients.matchAll();
        clients.forEach(client => {
            client.postMessage({
                type: 'SYNC_COMPLETE',
                sincronizados,
                erros,
                total: pontosPendentes.length
            });
        });

        console.log('[SW] Sincronizacao concluida: ' + sincronizados + ' ok, ' + erros + ' erros');
    } catch (error) {
        console.error('[SW] Erro na sincronizacao:', error);
    }
}

// Mensagens do app
self.addEventListener('message', async event => {
    if (event.data && event.data.type === 'SYNC_NOW') {
        sincronizarPontosOffline();
    }

    if (event.data && event.data.type === 'GET_PENDING_COUNT') {
        const pontos = await getPontosNaoSincronizados();
        event.source.postMessage({ type: 'PENDING_COUNT', count: pontos.length });
    }

    if (event.data && event.data.type === 'SAVE_USER_INFO') {
        try {
            await saveUserInfo(event.data.userInfo);
            event.source.postMessage({ type: 'USER_INFO_SAVED', success: true });
        } catch (e) {
            event.source.postMessage({ type: 'USER_INFO_SAVED', success: false, error: e.message });
        }
    }

    if (event.data && event.data.type === 'GET_USER_INFO') {
        try {
            const userInfo = await getUserInfo();
            event.source.postMessage({ type: 'USER_INFO', userInfo });
        } catch (e) {
            event.source.postMessage({ type: 'USER_INFO', userInfo: null, error: e.message });
        }
    }

    if (event.data && event.data.type === 'CLEAR_USER_INFO') {
        try {
            await clearUserInfo();
            event.source.postMessage({ type: 'USER_INFO_CLEARED', success: true });
        } catch (e) {
            event.source.postMessage({ type: 'USER_INFO_CLEARED', success: false });
        }
    }

    if (event.data && event.data.type === 'SAVE_OFFLINE_PONTO') {
        try {
            const id = await salvarPontoOffline(event.data.ponto);
            event.source.postMessage({ type: 'OFFLINE_PONTO_SAVED', success: true, id });
        } catch (e) {
            event.source.postMessage({ type: 'OFFLINE_PONTO_SAVED', success: false, error: e.message });
        }
    }

    if (event.data && event.data.type === 'GET_LAST_PONTO') {
        try {
            const lastPonto = await getLastPonto();
            event.source.postMessage({ type: 'LAST_PONTO', ponto: lastPonto });
        } catch (e) {
            event.source.postMessage({ type: 'LAST_PONTO', ponto: null });
        }
    }

    if (event.data && event.data.type === 'PRESENCA_ATRASADA') {
        self.registration.showNotification('Marcar Presenca!', {
            body: event.data.mensagem || 'Voce esta atrasado para marcar presenca',
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-72.png',
            vibrate: [200, 100, 200, 100, 200],
            requireInteraction: true,
            tag: 'presenca-alerta',
            actions: [
                { action: 'marcar', title: 'Marcar Agora' },
                { action: 'ignorar', title: 'Depois' }
            ],
            data: { url: '/app-mobile' }
        });
    }
});

// Clique na notificacao
self.addEventListener('notificationclick', event => {
    event.notification.close();

    if (event.notification.tag === 'presenca-alerta') {
        if (event.action === 'ignorar') return;
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then(clientList => {
                for (const client of clientList) {
                    if (client.url.includes('/app-mobile') && 'focus' in client) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) return clients.openWindow('/app-mobile');
            })
        );
    } else {
        if (event.action === 'close') return;
        event.waitUntil(clients.openWindow(event.notification.data?.url || '/app'));
    }
});
