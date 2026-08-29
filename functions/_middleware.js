const DEFAULT_WORKER_DOWNLOAD_DOMAIN = "https://dl.setu.mom";

function getWorkerDownloadDomain(env) {
  return String(env?.WORKER_DOWNLOAD_DOMAIN || DEFAULT_WORKER_DOWNLOAD_DOMAIN).replace(/\/+$/, "");
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathname = url.pathname;

  // 1. 精准路径匹配：只有属于 /setu/、/zrsetu/、/acg/ 目录下的具体文章页面才进行处理
  const isTargetPage = 
    /^\/setu\/.+/.test(pathname) || 
    /^\/zrsetu\/.+/.test(pathname) || 
    /^\/acg\/.+/.test(pathname);

  // 如果不匹配目标路径，直接放行，绝不修改任何内容
  if (!isTargetPage) {
    return context.next();
  }

  // 2. 获取原始页面响应
  const response = await context.next();
  
  // 兜底安全校验：如果不是 HTML 页面，也直接放行
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  const workerDownloadDomain = getWorkerDownloadDomain(context.env);

  // 3. 仅在匹配成功的文章页面中注入文章页通用 JS 逻辑
  const injectScript = `
<script>
document.addEventListener("DOMContentLoaded", function() {
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
