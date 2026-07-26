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

    // 2. 双图床竞速加载器 (Race Loader)
    function loadFastestImage(img, primarySrc, secondarySrc, wrap) {
        let isLoaded = false;

        // 绑定异步解码
        img.decoding = 'async';

        // 尝试设置加载链接
        function trySource(src) {
            if (!src || isLoaded) return;
            
            const tempImg = new Image();
            tempImg.decoding = 'async';
            tempImg.src = src;
            
            tempImg.onload = () => {
                if (!isLoaded) {
                    isLoaded = true;
                    img.src = src;
                    wrap.classList.add('loaded');
                }
            };

            tempImg.onerror = () => {
                // 如果最快响应的图片失败了，尝试另一个源
                if (!isLoaded) {
                    const fallbackSrc = (src === primarySrc) ? secondarySrc : primarySrc;
                    if (fallbackSrc && img.src !== fallbackSrc) {
                        img.src = fallbackSrc;
                        img.onload = () => { wrap.classList.add('loaded'); };
                    }
                }
            };
        }

        // 同时发起两个图床的请求，谁先完成 onload 谁先上屏
        trySource(primarySrc);
        if (secondarySrc) {
            trySource(secondarySrc);
        }
    }

    // 3. 图片懒加载 & 内存回收 (IntersectionObserver)
    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const img = entry.target;
                const wrap = img.parentElement;

                if (entry.isIntersecting) {
                    // 进入视口区域：开始竞速加载
                    if (!img.src || img.src === window.location.href || img.src.includes('about:blank')) {
                        const primarySrc = img.dataset.src;
                        const imgIndex = img.alt ? img.alt.trim() : '1';
                        
                        // 拼接 R2 图床 URL：https://r2.setutime.com/{category}_pic/pic-{currentNo}-{imgIndex}.webp
                        let secondarySrc = '';
                        if (currentNo) {
                            secondarySrc = `https://r2.setutime.com/${category}_pic/pic-${currentNo}-${imgIndex}.webp`;
                        }

                        loadFastestImage(img, primarySrc, secondarySrc, wrap);
                    }
                } else {
                    // 离开视口区域：回收显存，防止大量高清图片占用 GPU 导致崩溃
                    if (img.src && wrap.classList.contains('loaded')) {
                        img.removeAttribute('src');
                    }
                }
            });
        }, { 
            rootMargin: "1000px 0px 1000px 0px" // 预加载边界扩大至 1000px，提升顺畅度
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
        
        // 设置下一期/上一期链接
        const prevLink = document.getElementById('prev-link');
        if (prevLink) {
            prevLink.href = `https://www.setutime.com/${category}/${prevNo}`;
        }

        // 设置下载链接
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