// Service Worker for Drive Mad - Offline Support
const CACHE_NAME = 'drive-mad-v1';
const DB_NAME = 'DriveMadDB';
const DB_VERSION = 1;
const STORE_NAME = 'resources';

// URLs to cache
const urlsToCache = [
  '/',
  '/index.html',
  'https://deckard.openprocessing.org/user485717/visual2458132/hf42bec4b58ab09712c0f3bedb92cada1/index.wasm.js',
  'https://deckard.openprocessing.org/user485717/visual2458132/hf42bec4b58ab09712c0f3bedb92cada1/index.data.js'
];

// Open IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'url' });
      }
    };
  });
}

// Save to IndexedDB
async function saveToIndexedDB(url, response) {
  try {
    const db = await openDB();
    const blob = await response.blob();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await store.put({
      url: url,
      data: blob,
      timestamp: Date.now()
    });

    return response;
  } catch (error) {
    console.error('Error saving to IndexedDB:', error);
    return response;
  }
}

// Get from IndexedDB
async function getFromIndexedDB(url) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get(url);
      request.onsuccess = () => {
        if (request.result) {
          resolve(new Response(request.result.data));
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error getting from IndexedDB:', error);
    return null;
  }
}

// Install event - cache resources
self.addEventListener('install', (event) => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Cache opened');
        return cache.addAll(urlsToCache.filter(url => !url.startsWith('http')));
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache/IndexedDB or network
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then(async (response) => {
        // Return cached response if found
        if (response) {
          return response;
        }

        // Check IndexedDB for external resources
        if (event.request.url.includes('openprocessing.org')) {
          const dbResponse = await getFromIndexedDB(event.request.url);
          if (dbResponse) {
            return dbResponse;
          }
        }

        // Try to fetch from network
        return fetch(event.request)
          .then((response) => {
            // Don't cache if not a valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              // For external resources, still try to cache them
              if (event.request.url.includes('openprocessing.org')) {
                return fetch(event.request).then(async (res) => {
                  if (res && res.status === 200) {
                    const resClone = res.clone();
                    await saveToIndexedDB(event.request.url, resClone);
                  }
                  return res;
                });
              }
              return response;
            }

            // Clone the response
            const responseToCache = response.clone();

            // Cache the response
            if (event.request.url.includes('openprocessing.org')) {
              saveToIndexedDB(event.request.url, responseToCache.clone());
            } else {
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(event.request, responseToCache);
                });
            }

            return response;
          })
          .catch(async (error) => {
            console.error('Fetch failed, trying IndexedDB:', error);
            // If network fails, try IndexedDB as fallback
            const dbResponse = await getFromIndexedDB(event.request.url);
            if (dbResponse) {
              return dbResponse;
            }
            throw error;
          });
      })
  );
});
