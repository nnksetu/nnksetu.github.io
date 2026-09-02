const IMAGE_CACHE_NAME = "setutime-image-cache-v1";
const IMAGE_META_CACHE_NAME = "setutime-image-cache-meta-v1";
const IMAGE_CACHE_TTL = 180 * 24 * 60 * 60 * 1000;
const CACHEABLE_IMAGE_HOSTS = new Set(["eo.setu.mom", "r2.setu.mom"]);
const COVER_IMAGE_PATH = /^\/(?:acg_pic|setu_pic|zrsetu_pic)\/pic-\d+-\d+\.webp$/;

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

async function fetchImage(request) {
    let cachedResponse = null;

    try {
        const imageCache = await caches.open(IMAGE_CACHE_NAME);
        cachedResponse = await imageCache.match(request, { ignoreVary: true });
        const cachedAt = cachedResponse ? await getCachedAt(request.url) : 0;
        const isFresh = cachedAt > 0 && Date.now() - cachedAt < IMAGE_CACHE_TTL;

        if (cachedResponse && isFresh) return cachedResponse;
    } catch (error) {
        // Cache API 不可用时继续走网络，不影响图片显示。
    }

    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok || networkResponse.type === "opaque") {
            try {
                await saveImage(request, networkResponse);
            } catch (error) {
                // 存储失败时仍返回网络响应。
            }
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
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
    if (isCacheableImage(event.request)) {
        event.respondWith(fetchImage(event.request));
    }
});
