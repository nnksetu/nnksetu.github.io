document.addEventListener("DOMContentLoaded", function() {
    const SITE_ORIGIN = "https://setutime.top";
    const DOWNLOAD_ORIGIN = "https://dl.setutime.top";
    const VIDEO_ORIGIN = "https://v.setutime.top";
    const MANAGED_VIDEO_HOSTS = new Set(["v.setutime.top"]);

    function buildVideoUrl(value) {
        const raw = String(value || "").trim();
        if (!raw) return "";

        try {
            const parsed = new URL(raw);
            if (!MANAGED_VIDEO_HOSTS.has(parsed.hostname.toLowerCase())) return raw;
            return `${VIDEO_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
        } catch (error) {
            const path = raw.replace(/^\/+/, "");
            return path ? `${VIDEO_ORIGIN}/${path}` : "";
        }
    }

    function hydrateVideos() {
        document.querySelectorAll("video source").forEach(source => {
            const currentSrc = source.getAttribute("src") || "";
            const sourcePath = source.dataset.videoPath || source.dataset.src || currentSrc;
            const nextSrc = buildVideoUrl(sourcePath);

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
    // 1. 从页面声明或 URL 获取分类，并更新页面导航链接
    // ==========================================
    const path = window.location.pathname;
    const validCategories = new Set(["zrsetu", "acg", "setu"]);

    function getCategoryFromPath() {
        if (path.includes("/zrsetu/")) return "zrsetu";
        if (path.includes("/acg/")) return "acg";
        if (path.includes("/setu/")) return "setu";
        return null;
    }

    const declaredCategory = (document.body?.dataset.category || "").trim().toLowerCase();
    const category = validCategories.has(declaredCategory)
        ? declaredCategory
        : (getCategoryFromPath() || "setu");

    let currentNo = null;
    const titleEl = document.querySelector(".title");
    if (titleEl) {
        const match = titleEl.innerText.match(/\d+/);
        if (match) currentNo = parseInt(match[0], 10);
    }

    if (!currentNo) {
        const pathMatch = path.match(/\/(\d+)(\.html)?/);
        if (pathMatch) currentNo = parseInt(pathMatch[1], 10);
    }

    if (currentNo) {
        const prevLink = document.getElementById("prev-link");
        if (prevLink) {
            prevLink.href = `${SITE_ORIGIN}/${category}/${currentNo - 1}`;
        }

        const downloadUrl = `${DOWNLOAD_ORIGIN}/support?id=${category}_${currentNo}`;
        const topSaveBtn = document.querySelector(".save-blue");
        if (topSaveBtn) topSaveBtn.href = downloadUrl;

        const bottomSaveBtn = document.querySelector(".preserve");
        if (bottomSaveBtn) bottomSaveBtn.href = downloadUrl;
    }

    // ==========================================
    // 2. 底部固定按钮滚动显隐
    // ==========================================
    const fixedBtn = document.querySelector(".fixed-button");
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
