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

    // ==========================================
    // 0.5 底部像素宝可梦小人跳舞组 (Pokemondb 图鉴源)
    // ==========================================
    (function injectPixelCharacters() {
        const danceContainer = document.createElement('div');
        danceContainer.id = 'pixel-dance-container';
        
        const style = document.createElement('style');
        style.innerHTML = `
            #pixel-dance-container {
                position: relative;
                display: flex;
                justify-content: center;
                align-items: flex-end;
                gap: 25px;
                margin: 30px auto 100px;
                width: 100%;
                max-width: 500px;
                user-select: none;
                z-index: 10;
            }
            .pixel-sprite {
                width: 56px;
                height: 56px;
                image-rendering: pixelated;
                cursor: pointer;
                transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.6));
            }
            .pixel-sprite:hover {
                transform: scale(1.35) translateY(-5px);
            }
            .pixel-sprite:active {
                transform: scale(0.9) translateY(2px);
            }
            @keyframes pixelBounce {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-8px); }
            }
            .bounce-1 { animation: pixelBounce 0.8s infinite ease-in-out; }
            .bounce-2 { animation: pixelBounce 0.8s infinite ease-in-out 0.2s; }
            .bounce-3 { animation: pixelBounce 0.8s infinite ease-in-out 0.4s; }
            .bounce-4 { animation: pixelBounce 0.8s infinite ease-in-out 0.6s; }
        `;
        document.head.appendChild(style);

        // Pokemondb 基础图片路径
        const BASE_URL = 'https://img.pokemondb.net/sprites/black-white/anim/';

        const pokemons = [
            { name: 'pikachu', normal: `${BASE_URL}normal/pikachu.gif`, shiny: `${BASE_URL}shiny/pikachu.gif` },
            { name: 'squirtle', normal: `${BASE_URL}normal/squirtle.gif`, shiny: `${BASE_URL}shiny/squirtle.gif` },
            { name: 'gengar', normal: `${BASE_URL}normal/gengar.gif`, shiny: `${BASE_URL}shiny/gengar.gif` },
            { name: 'psyduck', normal: `${BASE_URL}normal/psyduck.gif`, shiny: `${BASE_URL}shiny/psyduck.gif` }
        ];

        pokemons.forEach((pokemon, index) => {
            const img = document.createElement('img');
            img.src = pokemon.normal;
            img.alt = pokemon.name;
            img.className = `pixel-sprite bounce-${index + 1}`;
            
            // 点击在普通形态和异色(Shiny)形态之间切换
            img.addEventListener('click', () => {
                img.src = (img.src === pokemon.normal) ? pokemon.shiny : pokemon.normal;
            });

            danceContainer.appendChild(img);
        });

        const targetContainer = document.querySelector('.image-grid') || document.body;
        const fixedButton = document.querySelector('.fixed-button');
        if (fixedButton) {
            targetContainer.insertBefore(danceContainer, fixedButton);
        } else {
            targetContainer.appendChild(danceContainer);
        }
    })();

    // ==========================================
    // 1. 解析分类与期数[cite: 4]
    // ==========================================
    const path = window.location.pathname; //[cite: 4]
    let category = 'setu'; // 默认分类[cite: 4]

    if (path.includes('/zrsetu/')) { //[cite: 4]
        category = 'zrsetu'; //[cite: 4]
    } else if (path.includes('/acg/')) { //[cite: 4]
        category = 'acg'; //[cite: 4]
    } else if (path.includes('/setu/')) { //[cite: 4]
        category = 'setu'; //[cite: 4]
    }

    let currentNo = null; //[cite: 4]
    const titleEl = document.querySelector('.title'); //[cite: 4]
    if (titleEl) { //[cite: 4]
        const match = titleEl.innerText.match(/\d+/); //[cite: 4]
        if (match) { //[cite: 4]
            currentNo = parseInt(match[0], 10); //[cite: 4]
        }
    }

    if (!currentNo) {
        const pathMatch = path.match(/\/(\d+)(\.html)?/); //[cite: 4]
        if (pathMatch) { //[cite: 4]
            currentNo = parseInt(pathMatch[1], 10); //[cite: 4]
        }
    }

    // ==========================================
    // 2. 空图片占位自动补全默认预览图[cite: 4]
    function fillEmptyImageSources() { //[cite: 4]
        const imageFolder = IMAGE_FOLDER_BY_CATEGORY[category]; //[cite: 4]
        if (!imageFolder || !currentNo) return; //[cite: 4]

        document.querySelectorAll('.img-wrap img[data-src]').forEach(img => { //[cite: 4]
            const source = (img.getAttribute('data-src') || '').trim(); //[cite: 4]
            if (source) return; //[cite: 4]

            const alt = (img.getAttribute('alt') || '').match(/\d+/); //[cite: 4]
            if (!alt) return; //[cite: 4]

            img.dataset.src = `${IMAGE_ORIGIN}/${imageFolder}/pic-${currentNo}-${alt[0]}.webp`; //[cite: 4]
        }); //[cite: 4]
    } //[cite: 4]

    fillEmptyImageSources(); //[cite: 4]

    // 3. 默认图床懒加载[cite: 4]
    // ==========================================
    function loadDefault(img, wrap) { //[cite: 4]
        const src = img.dataset.src; //[cite: 4]
        if (!src) return; //[cite: 4]
        img.decoding = 'async'; //[cite: 4]
        img.src = src; //[cite: 4]
        img.onload = () => wrap.classList.add('loaded'); //[cite: 4]
    }

    // ==========================================
    // 4. 内存回收机制[cite: 4]
    // ==========================================
    const MAX_ACTIVE_IMAGES = 100; //[cite: 4]

    function manageMemory() { //[cite: 4]
        const loadedWraps = Array.from(document.querySelectorAll('.img-wrap.loaded')); //[cite: 4]
        const activeImgs = loadedWraps //[cite: 4]
            .map(wrap => wrap.querySelector('img')) //[cite: 4]
            .filter(img => img && img.src && !img.src.includes('about:blank')); //[cite: 4]

        if (activeImgs.length > MAX_ACTIVE_IMAGES) { //[cite: 4]
            const countToRecycle = activeImgs.length - MAX_ACTIVE_IMAGES; //[cite: 4]
            for (let i = 0; i < countToRecycle; i++) { //[cite: 4]
                const imgToRecycle = activeImgs[i]; //[cite: 4]
                const rect = imgToRecycle.getBoundingClientRect(); //[cite: 4]
                if (rect.bottom < -1000) { //[cite: 4]
                    imgToRecycle.removeAttribute('src'); //[cite: 4]
                }
            }
        }
    }

    // ==========================================
    // 5. 滚动观察与预加载[cite: 4]
    // ==========================================
    const allImgs = Array.from(document.querySelectorAll('.img-wrap img')); //[cite: 4]

    if ('IntersectionObserver' in window) { //[cite: 4]
        const imageObserver = new IntersectionObserver((entries) => { //[cite: 4]
            entries.forEach(entry => { //[cite: 4]
                const img = entry.target; //[cite: 4]
                const wrap = img.parentElement; //[cite: 4]

                if (!entry.isIntersecting) return; //[cite: 4]
                if (img.src && img.src !== window.location.href && !img.src.includes('about:blank')) return; //[cite: 4]

                loadDefault(img, wrap); //[cite: 4]
            });

            manageMemory(); //[cite: 4]
        }, {
            rootMargin: "1500px 0px 1500px 0px" //[cite: 4]
        });

        allImgs.forEach(img => imageObserver.observe(img)); //[cite: 4]
    } else {
        allImgs.forEach(img => { //[cite: 4]
            loadDefault(img, img.parentElement); //[cite: 4]
        });
    }

    // ==========================================
    // 6. 动态计算链接[cite: 4]
    // ==========================================
    if (currentNo) { //[cite: 4]
        const prevNo = currentNo - 1; //[cite: 4]

        const prevLink = document.getElementById('prev-link'); //[cite: 4]
        if (prevLink) { //[cite: 4]
            prevLink.href = `${SITE_ORIGIN}/${category}/${prevNo}`; //[cite: 4]
        }

        const downloadUrl = `${DOWNLOAD_ORIGIN}/support?id=${category}_${currentNo}`; //[cite: 4]
        const topSaveBtn = document.querySelector('.save-blue'); //[cite: 4]
        if (topSaveBtn) { //[cite: 4]
            topSaveBtn.href = downloadUrl; //[cite: 4]
        }
        const bottomSaveBtn = document.querySelector('.preserve'); //[cite: 4]
        if (bottomSaveBtn) { //[cite: 4]
            bottomSaveBtn.href = downloadUrl; //[cite: 4]
        }
    }

    // ==========================================
    // 7. 底部固定按钮滚动显隐[cite: 4]
    // ==========================================
    const fixedBtn = document.querySelector('.fixed-button'); //[cite: 4]
    if (fixedBtn) { //[cite: 4]
        let lastScrollY = window.scrollY; //[cite: 4]
        let ticking = false; //[cite: 4]

        function updateButtonVisibility() { //[cite: 4]
            const currentScrollY = window.scrollY; //[cite: 4]
            if (currentScrollY > lastScrollY && currentScrollY > 10) { //[cite: 4]
                fixedBtn.classList.add('hidden'); //[cite: 4]
            } else {
                fixedBtn.classList.remove('hidden'); //[cite: 4]
            }
            lastScrollY = currentScrollY; //[cite: 4]
            ticking = false; //[cite: 4]
        }

        window.addEventListener('scroll', () => { //[cite: 4]
            if (!ticking) { //[cite: 4]
                window.requestAnimationFrame(updateButtonVisibility); //[cite: 4]
                ticking = true; //[cite: 4]
            }
        });
    }
});
