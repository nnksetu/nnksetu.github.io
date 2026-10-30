// 放在根目录，Service Worker 作用域自然就是 /，可以拦截首页封面请求。
const IMAGE_CACHE_NAME = "setutime-image-cache-v2";
const IMAGE_META_CACHE_NAME = "setutime-image-cache-meta-v2";
const IMAGE_CACHE_TTL = 180 * 24 * 60 * 60 * 1000;
const MAX_IMAGE_ENTRIES = 300; // 控制缓存体积，避免长期使用撑爆配额
const TRIM_INTERVAL = 10 * 60 * 1000;
const CACHEABLE_IMAGE_HOSTS = new Set(["eo.setutime.top", "r2.setutime.top"]);
const COVER_IMAGE_PATH = /^\/(?:acg_pic|setu_pic|zrsetu_pic)\/(?:thumbs\/)?pic-\d+-\d+\.webp$/;

let lastTrimAt = 0;

function isCacheableImage(request) {
    if (request.method !== "GET" || request.destination !== "image") return false;

    try {
        const url = new URL(request.url);
        return (
            CACHEABLE_IMAGE_HOSTS.has(url.hostname.toLowerCase()) &&
            COVER_IMAGE_PATH.test(url.pathname)
        );
    } catch (error) {
        return false;
    }
}

function getMetadataKey(url) {
    return new Request(
        `${self.location.origin}/__setutime_image_cache_meta__?url=${encodeURIComponent(url)}`
    );
}

async function getCachedAt(url) {
    const metadataCache = await caches.open(IMAGE_META_CACHE_NAME);
    const response = await metadataCache.match(getMetadataKey(url));
    if (!response) return 0;

    const timestamp = Number(await response.text());
    return Number.isFinite(timestamp) ? timestamp : 0;
}

async function saveImage(request, response) {
    const [imageCache, metadataCache] = await Promise.all([
        caches.open(IMAGE_CACHE_NAME),
        caches.open(IMAGE_META_CACHE_NAME)
    ]);

    await Promise.all([
        imageCache.put(request, response.clone()),
        metadataCache.put(
            getMetadataKey(request.url),
            new Response(String(Date.now()), {
                headers: { "Content-Type": "text/plain; charset=utf-8" }
            })
        )
    ]);
}

// 按最久未访问优先删除，保留最新的 MAX_IMAGE_ENTRIES 张
async function trimImageCache(force) {
    const now = Date.now();
    if (!force && now - lastTrimAt < TRIM_INTERVAL) return;
    lastTrimAt = now;

    const [imageCache, metadataCache] = await Promise.all([
        caches.open(IMAGE_CACHE_NAME),
        caches.open(IMAGE_META_CACHE_NAME)
    ]);

    const requests = await imageCache.keys();
    const expired = [];
    const entries = [];

    for (const request of requests) {
        const response = await metadataCache.match(getMetadataKey(request.url));
        const cachedAt = response ? Number(await response.text()) || 0 : 0;
        if (!cachedAt || now - cachedAt > IMAGE_CACHE_TTL) expired.push(request);
        else entries.push({ request, cachedAt });
    }

    entries.sort((a, b) => a.cachedAt - b.cachedAt);
    const excess = Math.max(0, entries.length - MAX_IMAGE_ENTRIES);
    const toDelete = expired.concat(entries.slice(0, excess).map(entry => entry.request));

    await Promise.all(
        toDelete.map(request =>
            Promise.all([
                imageCache.delete(request, { ignoreVary: true }),
                metadataCache.delete(getMetadataKey(request.url))
            ])
        )
    );
}

async function fetchImage(event, request) {
    let cachedResponse = null;

    try {
        const imageCache = await caches.open(IMAGE_CACHE_NAME);
        cachedResponse = await imageCache.match(request, { ignoreVary: true });
        if (cachedResponse) {
            const cachedAt = await getCachedAt(request.url);
            if (cachedAt > 0 && Date.now() - cachedAt < IMAGE_CACHE_TTL) return cachedResponse;
        }
    } catch (error) {
        // Cache API 不可用时继续走网络，不影响图片显示。
    }

    try {
        const networkResponse = await fetch(request);
        if (networkResponse.status === 200 || networkResponse.type === "opaque") {
            // 先返回图片，再在后台写入缓存与清理，减少首屏等待。
            event.waitUntil(
                saveImage(request, networkResponse)
                    .then(() => trimImageCache(false))
                    .catch(() => {})
            );
        }
        return networkResponse;
    } catch (error) {
        if (cachedResponse) return cachedResponse;
        throw error;
    }
}

self.addEventListener("install", event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
    event.waitUntil(
        (async () => {
            const keep = new Set([IMAGE_CACHE_NAME, IMAGE_META_CACHE_NAME]);
            const names = await caches.keys();
            await Promise.all(
                names.filter(name => !keep.has(name)).map(name => caches.delete(name))
            );
            await trimImageCache(true).catch(() => {});
            await self.clients.claim();
        })()
    );
});

self.addEventListener("fetch", event => {
    if (isCacheableImage(event.request)) {
        event.respondWith(fetchImage(event, event.request));
    }
});
