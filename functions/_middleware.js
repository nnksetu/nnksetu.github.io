const DEFAULT_WORKER_DOWNLOAD_DOMAIN = "https://dl.setu.mom";
const DEFAULT_VIDEO_MEDIA_DOMAIN = "https://eo.setu.mom";
const DEFAULT_IMAGE_MEDIA_DOMAIN = "https://r2.setu.mom";

function getDomainSetting(env, name, fallback) {
  return String(env?.[name] || fallback).replace(/\/+$/, "");
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // 1. 文章页注入逻辑，Service Worker 单独设置整站控制权限
  const isTargetPage = 
    /^\/setu\/.+/.test(pathname) || 
    /^\/zrsetu\/.+/.test(pathname) || 
    /^\/acg\/.+/.test(pathname);
  const isServiceWorker = pathname === "/scripts/sw.js";

  // 如果不匹配目标路径，直接放行，绝不修改任何内容
  if (!isTargetPage && !isServiceWorker) {
    return context.next();
  }

  // 2. 获取原始页面响应
  const response = await context.next();

  if (isServiceWorker) {
    const headers = new Headers(response.headers);
    headers.set("Service-Worker-Allowed", "/");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
  
  // 兜底安全校验：如果不是 HTML 页面，也直接放行
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  const workerDownloadDomain = getDomainSetting(context.env, "WORKER_DOWNLOAD_DOMAIN", DEFAULT_WORKER_DOWNLOAD_DOMAIN);
  const videoMediaDomain = getDomainSetting(context.env, "VIDEO_MEDIA_DOMAIN", DEFAULT_VIDEO_MEDIA_DOMAIN);
  const imageMediaDomain = getDomainSetting(context.env, "IMAGE_MEDIA_DOMAIN", DEFAULT_IMAGE_MEDIA_DOMAIN);

  // 3. 仅在匹配成功的文章页面中注入文章页通用 JS 逻辑
  const injectScript = `
<script>
document.addEventListener("DOMContentLoaded", function() {
    const VIDEO_ORIGIN = ${JSON.stringify(videoMediaDomain)};
    const IMAGE_ORIGIN = ${JSON.stringify(imageMediaDomain)};
    const MANAGED_VIDEO_HOSTS = ["r2.setu.mom", "eo.setu.mom"];
    const IMAGE_FOLDER_BY_CATEGORY = {
        zrsetu: "zrsetu_pic",
        setu: "setu_pic",
        acg: "acg_pic"
    };

    function getIssueNumber() {
        const titleEl = document.querySelector('.title');
        if (titleEl) {
            const match = titleEl.innerText.match(/\\d+/);
            if (match) return match[0];
        }
        const pathMatch = window.location.pathname.match(/\\d+/);
        if (pathMatch) return pathMatch[0];
        return null;
    }

    function getCategory() {
        const declaredCategory = (document.body?.dataset.category || "").trim().toLowerCase();
        if (IMAGE_FOLDER_BY_CATEGORY[declaredCategory]) return declaredCategory;

        const path = window.location.pathname;
        if (path.includes('/zrsetu/')) return 'zrsetu';
        if (path.includes('/acg/')) return 'acg';
        if (path.includes('/setu/')) return 'setu';
        return null;
    }

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
            const path = raw.replace(/^\\/+/, "");
            return path ? VIDEO_ORIGIN + "/" + path : "";
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

    function fillEmptyImageSources() {
        const imageFolder = IMAGE_FOLDER_BY_CATEGORY[getCategory()];
        const issueNumber = getIssueNumber();
        if (!imageFolder || !issueNumber) return;

        document.querySelectorAll('.img-wrap img[data-src]').forEach(img => {
            const source = (img.getAttribute('data-src') || '').trim();
            if (source) return;

            const alt = (img.getAttribute('alt') || '').match(/\\d+/);
            if (!alt) return;

            img.dataset.src = IMAGE_ORIGIN + "/" + imageFolder + "/pic-" + issueNumber + "-" + alt[0] + ".webp";
        });
    }

    fillEmptyImageSources();

    function loadDefaultImage(img, wrap) {
        const defaultSrc = img.getAttribute('data-src');
        if (!defaultSrc) return;

        img.decoding = 'async';
        img.src = defaultSrc;
        img.onload = () => { wrap.classList.add('loaded'); };
    }

    // 获取所有待加载的图片
    const imgs = document.querySelectorAll('.img-wrap img');

    if ('IntersectionObserver' in window) {
        const imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const wrap = img.parentElement;
                    loadDefaultImage(img, wrap);
                    observer.unobserve(img);
                }
            });
        }, { rootMargin: "0px 0px 5000px 0px" }); // 5000px 快速滚动防白屏缓冲

        imgs.forEach(img => imageObserver.observe(img));
    } else {
        imgs.forEach(img => {
            loadDefaultImage(img, img.parentElement);
        });
    }

    // --- 处理“下一期链接”、“保存按钮”和“底部悬浮按钮”的逻辑 ---
    const titleEl = document.querySelector('.title');
    if (titleEl) {
        const match = titleEl.innerText.match(/\\d+/);
        if (match) {
            const currentNo = parseInt(match[0]);
            const prevNo = currentNo - 1;
            const prevLink = document.getElementById('prev-link');
            if (prevLink) {
                prevLink.href = \`https://setu.mom/zrsetu/\${prevNo}\`;
            }
            const downloadUrl = \`${workerDownloadDomain}/support?id=zrsetu_\${currentNo}\`;
            const topSaveBtn = document.querySelector('.save-blue');
            if (topSaveBtn) {
                topSaveBtn.href = downloadUrl;
            }
            const bottomSaveBtn = document.querySelector('.preserve');
            if (bottomSaveBtn) {
                bottomSaveBtn.href = downloadUrl;
            }
        }
    }

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
</script>
`;

  // 4. 使用 HTMLRewriter（仅对目标文章页面生效）
  //    - 移除原本自带的那个含有懒加载的旧 <script> 标签
  //    - 在 </body> 结束前注入全新合并后的新 <script>
  return new HTMLRewriter()
    .on("script", {
      element(element) {
        element.remove();
      }
    })
    .on("body", {
      element(element) {
        element.append(injectScript, { html: true });
      }
    })
    .transform(response);
}
