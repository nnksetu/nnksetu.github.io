document.addEventListener("DOMContentLoaded", function() {
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
    } else {
        const pathMatch = path.match(/\/(\d+)(\.html)?/); //[cite: 4]
        if (pathMatch) { //[cite: 4]
            currentNo = parseInt(pathMatch[1], 10); //[cite: 4]
        }
    }

    // ==========================================
    // 2. 前三张竞速，锁定更快渠道[cite: 4]
    // ==========================================
    const RACE_COUNT = 3; //[cite: 4]
    let lockedSource = null; //[cite: 4]
    const raceWins = []; //[cite: 4]

    function getR2Src(img) { //[cite: 4]
        if (!currentNo) return null; //[cite: 4]
        const imgIndex = img.alt ? img.alt.trim() : '1'; //[cite: 4]
        return `https://r2.setutime.com/${category}_pic/pic-${currentNo}-${imgIndex}.webp`; //[cite: 4]
    }

    function raceImage(img, wrap) { //[cite: 4]
        const defaultSrc = img.dataset.src; //[cite: 4]
        const r2Src = getR2Src(img); //[cite: 4]
        let settled = false; //[cite: 4]

        function trySrc(src, type) { //[cite: 4]
            if (!src) return; //[cite: 4]
            const temp = new Image(); //[cite: 4]
            temp.decoding = 'async'; //[cite: 4]
            temp.src = src; //[cite: 4]
            temp.onload = () => { //[cite: 4]
                if (settled) return; //[cite: 4]
                settled = true; //[cite: 4]
                img.src = src; //[cite: 4]
                wrap.classList.add('loaded'); //[cite: 4]
                raceWins.push(type); //[cite: 4]
                tryLock(); //[cite: 4]
            };
        }

        trySrc(defaultSrc, 'default'); //[cite: 4]
        if (r2Src) trySrc(r2Src, 'r2'); //[cite: 4]
    }

    function tryLock() { //[cite: 4]
        if (lockedSource || raceWins.length < RACE_COUNT) return; //[cite: 4]
        const r2Count = raceWins.filter(t => t === 'r2').length; //[cite: 4]
        lockedSource = r2Count >= 2 ? 'r2' : 'default'; //[cite: 4]
    }

    function loadLocked(img, wrap) { //[cite: 4]
        const defaultSrc = img.dataset.src; //[cite: 4]
        const r2Src = getR2Src(img); //[cite: 4]

        let primarySrc, fallbackSrc; //[cite: 4]
        if (lockedSource === 'r2' && r2Src) { //[cite: 4]
            primarySrc = r2Src; //[cite: 4]
            fallbackSrc = defaultSrc; //[cite: 4]
        } else {
            primarySrc = defaultSrc; //[cite: 4]
            fallbackSrc = r2Src; //[cite: 4]
        }

        img.decoding = 'async'; //[cite: 4]
        img.src = primarySrc; //[cite: 4]
        img.onload = () => wrap.classList.add('loaded'); //[cite: 4]
        img.onerror = () => { //[cite: 4]
            if (fallbackSrc && img.src !== fallbackSrc) { //[cite: 4]
                img.src = fallbackSrc; //[cite: 4]
            }
        };
    }

    // ==========================================
    // 3. 内存回收机制[cite: 4]
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
    // 4. 滚动观察与预加载[cite: 4]
    // ==========================================
    const allImgs = Array.from(document.querySelectorAll('.img-wrap img')); //[cite: 4]

    if ('IntersectionObserver' in window) { //[cite: 4]
        const imageObserver = new IntersectionObserver((entries) => { //[cite: 4]
            entries.forEach(entry => { //[cite: 4]
                const img = entry.target; //[cite: 4]
                const wrap = img.parentElement; //[cite: 4]

                if (!entry.isIntersecting) return; //[cite: 4]
                if (img.src && img.src !== window.location.href && !img.src.includes('about:blank')) return; //[cite: 4]

                const index = allImgs.indexOf(img); //[cite: 4]

                if (lockedSource) { //[cite: 4]
                    loadLocked(img, wrap); //[cite: 4]
                } else if (index < RACE_COUNT) { //[cite: 4]
                    raceImage(img, wrap); //[cite: 4]
                } else {
                    img.decoding = 'async'; //[cite: 4]
                    img.src = img.dataset.src; //[cite: 4]
                    img.onload = () => wrap.classList.add('loaded'); //[cite: 4]
                }
            });

            manageMemory(); //[cite: 4]
        }, {
            rootMargin: "1500px 0px 1500px 0px" //[cite: 4]
        });

        allImgs.forEach(img => imageObserver.observe(img)); //[cite: 4]
    } else {
        allImgs.forEach(img => { //[cite: 4]
            img.src = img.dataset.src; //[cite: 4]
            img.onload = () => img.parentElement.classList.add('loaded'); //[cite: 4]
        });
    }

    // ==========================================
    // 5. 动态计算链接[cite: 4]
    // ==========================================
    if (currentNo) { //[cite: 4]
        const prevNo = currentNo - 1; //[cite: 4]

        const prevLink = document.getElementById('prev-link'); //[cite: 4]
        if (prevLink) { //[cite: 4]
            prevLink.href = `https://www.setutime.com/${category}/${prevNo}`; //[cite: 4]
        }

        const downloadUrl = `https://dl.setutime.com/support?id=${category}_${currentNo}`; //[cite: 4]
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
    // 6. 底部固定按钮滚动显隐[cite: 4]
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
