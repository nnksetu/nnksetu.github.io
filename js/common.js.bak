document.addEventListener("DOMContentLoaded", function() {
    const SITE_ORIGIN = "https://www.setu.mom";
    const DOWNLOAD_ORIGIN = "https://dl.setu.mom";
    const VIDEO_ORIGIN = "https://eo.setu.mom";
    const IMAGE_ORIGIN = "https://eo.setu.mom";
    const MANAGED_VIDEO_HOSTS = ["r2.setu.mom", "eo.setu.mom"];
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
        if (path.includes('/zrsetu/')) return 'zrsetu';
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
    function fillEmptyImageSources() {
        const imageFolder = IMAGE_FOLDER_BY_CATEGORY[category];
        if (!imageFolder || !currentNo) return;

        document.querySelectorAll('.img-wrap img[data-src]').forEach(img => {
            const source = (img.getAttribute('data-src') || '').trim();
            if (source) return;

            const alt = (img.getAttribute('alt') || '').match(/\d+/);
            if (!alt) return;

            img.dataset.src = `${IMAGE_ORIGIN}/${imageFolder}/pic-${currentNo}-${alt[0]}.webp`;
        });
    }

    fillEmptyImageSources();

    // 3. 默认图床懒加载
    function loadDefault(img, wrap) {
        const src = img.dataset.src;
        if (!src) return;
        img.decoding = 'async';
        img.src = src;
        img.onload = () => wrap.classList.add('loaded');
    }

    // 4. 智能缓存管理（100P 以内不回收，超出 100P 回收最远端图片）
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

    // 5. 激进预加载 & 滚动观察
    const allImgs = Array.from(document.querySelectorAll('.img-wrap img'));

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

    // 6. 动态设置下一期/上一期与下载链接
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

    // 7. 底部悬浮按钮滚动显隐控制
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
