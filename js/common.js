document.addEventListener("DOMContentLoaded", function() {
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/scripts/sw.js", { scope: "/" }).catch(error => {
            console.warn("Image cache service worker registration failed:", error);
        });
    }

    const SITE_ORIGIN = "https://www.setu.mom";
    const DOWNLOAD_ORIGIN = "https://dl.setu.mom";
    const VIDEO_ORIGIN = "https://eo.setu.mom";
    const IMAGE_ORIGIN = "https://r2.setu.mom";
    const MANAGED_VIDEO_HOSTS = ["r2.setu.mom", "eo.setu.mom"];
    const IMAGE_RACE_COUNT = 3;
    const IMAGE_FOLDER_BY_CATEGORY = {
        zrsetu: "zrsetu_pic",
        setu: "setu_pic",
        acg: "acg_pic"
    };

    function isManagedVideoHost(hostname) {
        return MANAGED_VIDEO_HOSTS.includes(String(hostname || "").toLowerCase());
    }

    function buildManagedVideoUrl(value) {
        const raw = String(value || "").trim();
        if (!raw) return "";

        try {
            const parsed = new URL(raw);
            if (!isManagedVideoHost(parsed.hostname)) return raw;
            return VIDEO_ORIGIN + parsed.pathname + parsed.search + parsed.hash;
        } catch (error) {
            const path = raw.replace(/^\/+/, "");
            return path ? `${VIDEO_ORIGIN}/${path}` : "";
        }
    }

    function hydrateVideos() {
        document.querySelectorAll("video source").forEach(source => {
            const currentSrc = source.getAttribute("src") || "";
            const sourcePath = source.dataset.videoPath || source.dataset.src || currentSrc;
            const nextSrc = buildManagedVideoUrl(sourcePath);

            if (!nextSrc || currentSrc === nextSrc) return;
            source.src = nextSrc;

            const video = source.closest("video");
            if (video) video.load();
        });
    }

    hydrateVideos();

    // 1. 优先读取页面声明的分类，旧页面再从 URL 解析
    const path = window.location.pathname;
    function getCategoryFromPath() {
        if (path.includes('/zrsetu/') || path.includes('/zesetu/')) return 'zrsetu';
        if (path.includes('/acg/')) return 'acg';
        if (path.includes('/setu/')) return 'setu';
        return null;
    }

    const declaredCategory = (document.body?.dataset.category || '').trim().toLowerCase();
    const category = IMAGE_FOLDER_BY_CATEGORY[declaredCategory]
        ? declaredCategory
        : (getCategoryFromPath() || 'setu');

    // 提取页面期数 (例如 /zrsetu/757.html -> 757)
    let currentNo = null;
    const titleEl = document.querySelector('.title');
    if (titleEl) {
        const match = titleEl.innerText.match(/\d+/);
        if (match) {
            currentNo = parseInt(match[0], 10);
        }
    }

    if (!currentNo) {
        const pathMatch = path.match(/\/(\d+)(\.html)?/);
        if (pathMatch) {
            currentNo = parseInt(pathMatch[1], 10);
        }
    }

    // 2. 空图片占位自动补全默认预览图
    function getImageNumber(img) {
        const match = (img.getAttribute('alt') || '').match(/\d+/);
        return match ? match[0] : null;
    }

    function getHtmlImageSource(img) {
        return (img.dataset.htmlSrc || '').trim();
    }

    function buildManagedImageUrl(img) {
        const imageFolder = IMAGE_FOLDER_BY_CATEGORY[category];
        const imageNumber = getImageNumber(img);
        if (!imageFolder || !currentNo || !imageNumber) return '';

        return `${IMAGE_ORIGIN}/${imageFolder}/pic-${currentNo}-${imageNumber}.webp`;
    }

    function fillEmptyImageSources() {
        document.querySelectorAll('.img-wrap img').forEach(img => {
            const source = (img.getAttribute('data-src') || '').trim();
            if (source) {
                img.dataset.htmlSrc = source;
                return;
            }

            const htmlSource = (img.getAttribute('src') || '').trim();
            if (htmlSource && htmlSource !== window.location.href && !htmlSource.includes('about:blank')) {
                img.dataset.htmlSrc = htmlSource;
                return;
            }

            const managedSource = buildManagedImageUrl(img);
            if (managedSource) {
                img.dataset.managedSrc = managedSource;
                if (!source) img.dataset.src = managedSource;
            }
        });
    }

    fillEmptyImageSources();

    // 3. 前三张图片双线路竞速，胜出线路用于本页其余图片
    function raceImageSources(htmlSource, managedSource) {
        const sources = [
            { route: 'html', src: htmlSource },
            { route: 'managed', src: managedSource }
        ].filter(({ src }, index, items) => src && items.findIndex(item => item.src === src) === index);

        if (!sources.length) return Promise.resolve(null);
        if (sources.length === 1) return Promise.resolve(sources[0]);

        return new Promise(resolve => {
            let pending = sources.length;
            let settled = false;

            sources.forEach(source => {
                const probe = new Image();
                const finish = success => {
                    if (settled) return;
                    if (success) {
                        settled = true;
                        resolve(source);
                    } else if (--pending === 0) {
                        settled = true;
                        resolve(null);
                    }
                };

                probe.onload = () => finish(true);
                probe.onerror = () => finish(false);
                probe.src = source.src;
            });
        });
    }

    function getImageSource(img, route) {
        const htmlSource = getHtmlImageSource(img);
        const managedSource = (img.dataset.managedSrc || buildManagedImageUrl(img)).trim();

        if (route === 'managed') return managedSource || htmlSource;
        return htmlSource || managedSource;
    }

    function getFallbackImageSource(img, route, primarySource) {
        const fallbackRoute = route === 'managed' ? 'html' : 'managed';
        const fallbackSource = getImageSource(img, fallbackRoute);
        return fallbackSource !== primarySource ? fallbackSource : '';
    }

    function loadImage(img, wrap, primarySource, fallbackSource = '') {
        if (!primarySource || img.dataset.loading === 'true') return;

        img.decoding = 'async';
        img.dataset.loading = 'true';
        let retried = false;

        const setSource = source => {
            img.onload = () => {
                img.dataset.loading = 'false';
                wrap.classList.add('loaded');
            };
            img.onerror = () => {
                if (!retried && fallbackSource) {
                    retried = true;
                    setSource(fallbackSource);
                    return;
                }

                img.dataset.loading = 'false';
            };
            img.src = source;
        };

        setSource(primarySource);
    }

    const allImgs = Array.from(document.querySelectorAll('.img-wrap img'));
    let selectedImageRoute = null;

    const imageRouteReady = Promise.all(
        allImgs.slice(0, IMAGE_RACE_COUNT).map(img => {
            const wrap = img.parentElement;
            const htmlSource = getHtmlImageSource(img);
            const managedSource = buildManagedImageUrl(img);

            img.dataset.racing = 'true';
            return raceImageSources(htmlSource, managedSource).then(winner => {
                img.dataset.racing = 'false';
                if (winner) {
                    loadImage(
                        img,
                        wrap,
                        winner.src,
                        winner.route === 'html' ? managedSource : htmlSource
                    );
                }
                return winner?.route || null;
            });
        })
    ).then(results => {
        const managedWins = results.filter(route => route === 'managed').length;
        const htmlWins = results.filter(route => route === 'html').length;

        selectedImageRoute = managedWins > htmlWins ? 'managed' : 'html';
        allImgs.slice(0, IMAGE_RACE_COUNT).forEach(img => {
            loadDefault(img, img.parentElement);
        });
        return selectedImageRoute;
    });

    // 4. 按竞速胜出的图床懒加载
    function loadDefault(img, wrap) {
        if (img.dataset.racing === 'true') return;
        const currentSource = img.getAttribute('src') || '';
        if ((currentSource && !currentSource.includes('about:blank')) || img.dataset.loading === 'true') return;

        if (!selectedImageRoute) {
            imageRouteReady.then(() => loadDefault(img, wrap));
            return;
        }

        const primarySource = getImageSource(img, selectedImageRoute);
        const fallbackSource = getFallbackImageSource(img, selectedImageRoute, primarySource);
        loadImage(img, wrap, primarySource, fallbackSource);
    }

    // 5. 智能缓存管理（100P 以内不回收，超出 100P 回收最远端图片）
    const MAX_ACTIVE_IMAGES = 100;

    function manageMemory() {
        const loadedWraps = Array.from(document.querySelectorAll('.img-wrap.loaded'));
        const activeImgs = loadedWraps
            .map(wrap => wrap.querySelector('img'))
            .filter(img => img && img.src && !img.src.includes('about:blank'));

        if (activeImgs.length > MAX_ACTIVE_IMAGES) {
            const countToRecycle = activeImgs.length - MAX_ACTIVE_IMAGES;
            for (let i = 0; i < countToRecycle; i++) {
                const imgToRecycle = activeImgs[i];
                const rect = imgToRecycle.getBoundingClientRect();
                if (rect.bottom < -1000) {
                    imgToRecycle.removeAttribute('src');
                }
            }
        }
    }

    // 6. 激进预加载 & 滚动观察

    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const img = entry.target;
                const wrap = img.parentElement;

                if (!entry.isIntersecting) return;
                if (img.src && img.src !== window.location.href && !img.src.includes('about:blank')) return;

                loadDefault(img, wrap);
            });

            manageMemory();
        }, {
            rootMargin: "1500px 0px 1500px 0px"
        });

        allImgs.forEach(img => imageObserver.observe(img));
    } else {
        // 降级：全部用默认
        allImgs.forEach(img => {
            loadDefault(img, img.parentElement);
        });
    }

    // 7. 动态设置下一期/上一期与下载链接
    if (currentNo) {
        const prevNo = currentNo - 1;

        const prevLink = document.getElementById('prev-link');
        if (prevLink) {
            prevLink.href = `${SITE_ORIGIN}/${category}/${prevNo}`;
        }

        const downloadUrl = `${DOWNLOAD_ORIGIN}/support?id=${category}_${currentNo}`;
        const topSaveBtn = document.querySelector('.save-blue');
        if (topSaveBtn) {
            topSaveBtn.href = downloadUrl;
        }
        const bottomSaveBtn = document.querySelector('.preserve');
        if (bottomSaveBtn) {
            bottomSaveBtn.href = downloadUrl;
        }
    }

    // 8. 底部悬浮按钮滚动显隐控制
    const fixedBtn = document.querySelector('.fixed-button');
    if (fixedBtn) {
        let lastScrollY = window.scrollY;
        let ticking = false;

        function updateButtonVisibility() {
            const currentScrollY = window.scrollY;
            if (currentScrollY > lastScrollY && currentScrollY > 10) {
                fixedBtn.classList.add('hidden');
            } else {
                fixedBtn.classList.remove('hidden');
            }
            lastScrollY = currentScrollY;
            ticking = false;
        }

        window.addEventListener('scroll', () => {
            if (!ticking) {
                window.requestAnimationFrame(updateButtonVisibility);
                ticking = true;
            }
        });
    }
});
