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

    // 2. 前三张竞速，锁定更快渠道
    const RACE_COUNT = 3;
    let lockedSource = null; // 'r2' | 'default' | null
    const raceWins = [];     // 记录前三张的胜出渠道

    function getR2Src(img) {
        if (!currentNo) return null;
        const imgIndex = img.alt ? img.alt.trim() : '1';
        return `https://r2.setutime.com/${category}_pic/pic-${currentNo}-${imgIndex}.webp`;
    }

    // 竞速单张：双发，谁先 onload 用谁，并记录胜出渠道
    function raceImage(img, wrap) {
        const defaultSrc = img.dataset.src;
        const r2Src = getR2Src(img);
        let settled = false;

        function trySrc(src, type) {
            if (!src) return;
            const temp = new Image();
            temp.decoding = 'async';
            temp.src = src;
            temp.onload = () => {
                if (settled) return;
                settled = true;
                img.src = src;
                wrap.classList.add('loaded');
                raceWins.push(type);
                tryLock();
            };
            // onerror 忽略，等另一条线
        }

        trySrc(defaultSrc, 'default');
        if (r2Src) trySrc(r2Src, 'r2');
    }

    // 根据前三张结果锁定渠道（多数胜出）
    function tryLock() {
        if (lockedSource || raceWins.length < RACE_COUNT) return;
        const r2Count = raceWins.filter(t => t === 'r2').length;
        lockedSource = r2Count >= 2 ? 'r2' : 'default';
    }

    // 已锁定后的单线路加载（失败可回退另一条）
    function loadLocked(img, wrap) {
        const defaultSrc = img.dataset.src;
        const r2Src = getR2Src(img);

        let primarySrc, fallbackSrc;
        if (lockedSource === 'r2' && r2Src) {
            primarySrc = r2Src;
            fallbackSrc = defaultSrc;
        } else {
            primarySrc = defaultSrc;
            fallbackSrc = r2Src;
        }

        img.decoding = 'async';
        img.src = primarySrc;
        img.onload = () => wrap.classList.add('loaded');
        img.onerror = () => {
            if (fallbackSrc && img.src !== fallbackSrc) {
                img.src = fallbackSrc;
            }
        };
    }

    // 3. 智能缓存管理（100P 以内不回收，超出 100P 回收最远端图片）
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

    // 4. 激进预加载 & 滚动观察
    const allImgs = Array.from(document.querySelectorAll('.img-wrap img'));

    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const img = entry.target;
                const wrap = img.parentElement;

                if (!entry.isIntersecting) return;
                if (img.src && img.src !== window.location.href && !img.src.includes('about:blank')) return;

                const index = allImgs.indexOf(img);

                if (lockedSource) {
                    // 已锁定，只用胜出渠道
                    loadLocked(img, wrap);
                } else if (index < RACE_COUNT) {
                    // 前三张：竞速
                    raceImage(img, wrap);
                } else {
                    // 尚未锁定且不是前三张：先走默认
                    img.decoding = 'async';
                    img.src = img.dataset.src;
                    img.onload = () => wrap.classList.add('loaded');
                }
            });

            manageMemory();
        }, {
            rootMargin: "1500px 0px 1500px 0px"
        });

        allImgs.forEach(img => imageObserver.observe(img));
    } else {
        // 降级：全部用默认
        allImgs.forEach(img => {
            img.src = img.dataset.src;
            img.onload = () => img.parentElement.classList.add('loaded');
        });
    }

    // 5. 动态设置下一期/上一期与下载链接
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

    // 6. 底部悬浮按钮滚动显隐控制
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