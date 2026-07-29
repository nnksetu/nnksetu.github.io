document.addEventListener("DOMContentLoaded", function() {
    // 1. 从当前页面 URL 解析分类与期数
    const path = window.location.pathname;
    let category = 'setu'; // 默认分类

    if (path.includes('/zrsetu/')) {
        category = 'zrsetu';
    } else if (path.includes('/acg/')) {
        category = 'acg';
    } else if (path.includes('/setu/')) {
        category = 'setu';
    }

    // 提取页面期数 (例如 /zrsetu/757.html -> 757)
    let currentNo = null;
    const titleEl = document.querySelector('.title');
    if (titleEl) {
        const match = titleEl.innerText.match(/\d+/);
        if (match) {
            currentNo = parseInt(match[0], 10);
        }
    } else {
        const pathMatch = path.match(/\/(\d+)(\.html)?/);
        if (pathMatch) {
            currentNo = parseInt(pathMatch[1], 10);
        }
    }

    // 2. 探测 r2 可用性 + 耗时（只做一次）
    // 超时或延迟过高 → 降级到默认图床
    const R2_PROBE_URL = 'https://r2.setutime.com/ping.txt';
    const R2_TIMEOUT_MS = 1000;   // 超过此时间视为不可用
    const R2_SLOW_MS = 700;       // 延迟超过此值主动降级

    let useR2 = false; // 最终是否启用 r2 优先

    function probeR2() {
        return new Promise((resolve) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), R2_TIMEOUT_MS);
            const start = performance.now();

            fetch(R2_PROBE_URL + '?t=' + Date.now(), {
                method: 'GET',
                mode: 'no-cors',
                cache: 'no-store',
                signal: controller.signal
            }).then(() => {
                clearTimeout(timer);
                const latency = performance.now() - start;
                // 可达且不够慢才启用
                resolve(latency < R2_SLOW_MS);
            }).catch(() => {
                clearTimeout(timer);
                resolve(false);
            });
        });
    }

    // 3. 智能缓存管理（100P 以内不回收，超出 100P 回收最远端图片）
    const MAX_ACTIVE_IMAGES = 100; // 安全阀值：100张

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

    // 4. 图片加载（优先线路 + 失败回退，不双发）
    function loadImage(img, primarySrc, fallbackSrc, wrap) {
        if (!primarySrc) return;

        img.decoding = 'async';
        img.src = primarySrc;

        img.onload = () => {
            wrap.classList.add('loaded');
        };

        img.onerror = () => {
            if (fallbackSrc && img.src !== fallbackSrc) {
                img.src = fallbackSrc;
                // onload 已绑定，成功后会加 loaded
            }
        };
    }

    // 5. 激进预加载 & 滚动观察（等探测结果后再启动）
    function startImageObserver() {
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    const img = entry.target;
                    const wrap = img.parentElement;

                    if (entry.isIntersecting) {
                        if (!img.src || img.src === window.location.href || img.src.includes('about:blank')) {
                            const defaultSrc = img.dataset.src;
                            const imgIndex = img.alt ? img.alt.trim() : '1';

                            let primarySrc = defaultSrc;
                            let fallbackSrc = null;

                            if (useR2 && currentNo) {
                                // r2 优先，默认图床作为回退
                                primarySrc = `https://r2.setutime.com/${category}_pic/pic-${currentNo}-${imgIndex}.webp`;
                                fallbackSrc = defaultSrc;
                            }

                            loadImage(img, primarySrc, fallbackSrc, wrap);
                        }
                    }
                });

                manageMemory();
            }, {
                rootMargin: "1500px 0px 1500px 0px"
            });

            const imgs = document.querySelectorAll('.img-wrap img');
            imgs.forEach(img => imageObserver.observe(img));
        } else {
            // 降级兼容处理
            const imgs = document.querySelectorAll('.img-wrap img');
            imgs.forEach(img => {
                const defaultSrc = img.dataset.src;
                const imgIndex = img.alt ? img.alt.trim() : '1';

                let primarySrc = defaultSrc;
                let fallbackSrc = null;

                if (useR2 && currentNo) {
                    primarySrc = `https://r2.setutime.com/${category}_pic/pic-${currentNo}-${imgIndex}.webp`;
                    fallbackSrc = defaultSrc;
                }

                loadImage(img, primarySrc, fallbackSrc, img.parentElement);
            });
        }
    }

    // 先探测，再启动图片观察
    probeR2().then(ok => {
        useR2 = ok;
        startImageObserver();
    });

    // 6. 动态设置下一期/上一期与下载链接
    if (currentNo) {
        const prevNo = currentNo - 1;

        const prevLink = document.getElementById('prev-link');
        if (prevLink) {
            prevLink.href = `https://www.setutime.com/${category}/${prevNo}`;
        }

        const downloadUrl = `https://dl.setutime.com/support?id=${category}_${currentNo}`;
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