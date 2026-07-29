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

    // 2. 智能缓存管理（100P 以内不回收，超出 100P 回收最远端图片）
    const MAX_ACTIVE_IMAGES = 100; // 安全阀值：100张

    function manageMemory() {
        // 获取所有已经加载（带 src）的图片
        const loadedWraps = Array.from(document.querySelectorAll('.img-wrap.loaded'));
        const activeImgs = loadedWraps
            .map(wrap => wrap.querySelector('img'))
            .filter(img => img && img.src && !img.src.includes('about:blank'));

        // 如果已激活图片超过 100 张，回收距离当前视口顶部最远（最上方）的图片
        if (activeImgs.length > MAX_ACTIVE_IMAGES) {
            const countToRecycle = activeImgs.length - MAX_ACTIVE_IMAGES;
            
            // 按元素在 DOM 中的位置排序，优先清理排在最前面的（最上面的）
            for (let i = 0; i < countToRecycle; i++) {
                const imgToRecycle = activeImgs[i];
                // 确保回收的图片目前不在屏幕视口内（位于屏幕上方才回收）
                const rect = imgToRecycle.getBoundingClientRect();
                if (rect.bottom < -1000) { // 必须离开屏幕上方 1000px 以上
                    imgToRecycle.removeAttribute('src');
                }
            }
        }
    }

    // 3. 激进预加载 & 滚动观察
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const img = entry.target;
                const wrap = img.parentElement;

                if (entry.isIntersecting) {
                    // 进入视口预加载范围（上下 1500px）
                    if (!img.src || img.src === window.location.href || img.src.includes('about:blank')) {
                        img.decoding = 'async';
                        img.src = img.dataset.src;
                        img.onload = () => { wrap.classList.add('loaded'); };
                    }
                }
            });

            // 每次观察状态变动时检查全局内存
            manageMemory();
        }, { 
            rootMargin: "1500px 0px 1500px 0px" // 上下扩大到 1500px 预加载，滑动极度丝滑
        });

        const imgs = document.querySelectorAll('.img-wrap img');
        imgs.forEach(img => imageObserver.observe(img));
    } else {
        // 降级兼容处理
        const imgs = document.querySelectorAll('.img-wrap img');
        imgs.forEach(img => {
            img.src = img.dataset.src;
            img.onload = () => img.parentElement.classList.add('loaded');
        });
    }

    // 4. 动态设置下一期/上一期与下载链接
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

    // 5. 底部悬浮按钮滚动显隐控制
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