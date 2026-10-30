/*
 * SetuTime 首页脚本
 * - 分类分页数据按需加载，后台并发预加载用于搜索
 * - 所有用户/数据文本都用 textContent 写入，避免 innerHTML 注入
 * - localStorage 全部经过安全封装，隐私模式下也不会中断页面
 */
(function () {
  'use strict';

  var ONE_HOUR = 60 * 60 * 1000;
  var DOWNLOAD_ORIGIN = 'https://dl.setutime.top';
  var HIDDEN_ENTRY_API = DOWNLOAD_ORIGIN + '/api/hidden-entry/check';
  var HIDDEN_ENTRY_TRIGGER_WINDOW = 1500;
  var HIDDEN_ENTRY_TRIGGER_COUNT = 5;
  var OWNED_SITE_HOSTS = ['setutime.com', 'www.setutime.com', 'setutime.top', 'setu.mom', 'www.setu.mom'];
  var ITEMS_PER_PAGE = 10;
  var SERVER_ITEMS_PER_FILE = 50;
  var SEARCH_RESULT_LIMIT = 60;
  var PRELOAD_CONCURRENCY = 4;
  var TABS = ['acg', 'setu', 'zrsetu'];
  var THEME_META = { acg: '#50C878', setu: '#428cca', zrsetu: '#f8b8c8' };
  var THEMES = {
    acg: { className: 'green-theme', subtitle: '全年龄向ACGイラストまとめ' },
    setu: { className: 'blue-theme', subtitle: 'ACGエッチ画像まとめ' },
    zrsetu: { className: 'pink-theme', subtitle: 'Cosplayエッチ画像まとめ' }
  };

  var rootUrl = window.location.protocol + '//' + window.location.host + '/';

  /* ---------------------------------------------------------------- 存储 */

  var memoryStore = new Map();

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return memoryStore.has(key) ? memoryStore.get(key) : null;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      memoryStore.set(key, value);
    }
  }

  function storageRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      memoryStore.delete(key);
    }
  }

  function getSavedPage(tabType) {
    try {
      var dataStr = storageGet('setutime_page_data_' + tabType);
      if (!dataStr) return 1;
      var item = JSON.parse(dataStr);
      if (!item || Date.now() - item.timestamp > ONE_HOUR) {
        storageRemove('setutime_page_data_' + tabType);
        return 1;
      }
      return parseInt(item.page, 10) || 1;
    } catch (error) {
      return 1;
    }
  }

  function savePage(tabType, pageNum) {
    storageSet('setutime_page_data_' + tabType, JSON.stringify({ page: pageNum, timestamp: Date.now() }));
  }

  /* ---------------------------------------------------------------- 状态 */

  var currentTab = 'acg';
  var currentPage = {
    acg: getSavedPage('acg'),
    setu: getSavedPage('setu'),
    zrsetu: getSavedPage('zrsetu')
  };

  // 每个分类独立缓存：服务端分页文件
  var cachePages = { acg: {}, setu: {}, zrsetu: {} };
  // 同一服务端分页的并发请求去重
  var serverPageRequests = { acg: {}, setu: {}, zrsetu: {} };
  // 累计已加载条目（搜索 + 前端分页）
  var allItems = { acg: [], setu: [], zrsetu: [] };
  var allItemKeys = { acg: new Set(), setu: new Set(), zrsetu: new Set() };
  // 各分类总条数（从任意一页 JSON 的 total 字段获取）
  var totalCount = { acg: 0, setu: 0, zrsetu: 0 };
  var preloadState = { acg: null, setu: null, zrsetu: null };

  var previewCache = {};
  var thumbState = 'unknown'; // unknown | available | unavailable
  var subpagePreviewCache = {};
  var subpagePreviewRequests = {};

  var renderRequestId = 0;
  var previewObserver = null;
  var previewQueue = [];
  var activePreviewLoads = 0;
  var MAX_PREVIEW_LOADS = 2;
  var skeletonTimer = null;
  var currentColumnCount = 0;
  var resizeTimer = null;
  var searchTimer = null;
  var lastFocusedElement = null;

  var hiddenEntryTapTimes = [];
  var hiddenEntryBusy = false;

  function $(id) {
    return document.getElementById(id);
  }

  function getVisibleTabIndex(type) {
    return TABS.indexOf(type) === -1 ? 0 : TABS.indexOf(type);
  }

  function getFileNumber(file) {
    var match = String(file || '').match(/\d+/);
    return match ? match[0] : '';
  }

  /* ---------------------------------------------------------------- 主题 */

  function setMetaThemeColor(color) {
    var meta = $('meta-theme-color');
    if (meta) meta.setAttribute('content', color);
  }

  function applyTheme(type, silent) {
    var theme = THEMES[type] || THEMES.acg;
    document.documentElement.classList.remove('green-theme', 'blue-theme', 'pink-theme');
    document.documentElement.classList.add(theme.className);
    currentTab = type;

    var slider = $('tabSlider');
    var tabs = $('tabsContainer');
    if (slider) {
      if (silent && tabs) tabs.classList.add('no-slider-transition');
      slider.style.transform = 'translateX(' + (getVisibleTabIndex(type) * 100) + '%)';
      if (silent && tabs) {
        // 强制一次重排后恢复过渡，避免首屏滑块从左侧滑入
        void slider.offsetHeight;
        window.requestAnimationFrame(function () {
          tabs.classList.remove('no-slider-transition');
        });
      }
    }

    TABS.forEach(function (tabName) {
      var btn = $('tab-' + tabName);
      if (!btn) return;
      var isActive = tabName === type;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
      btn.tabIndex = isActive ? 0 : -1;
    });

    var mainTitle = $('main-title');
    var subTitle = $('sub-title');
    if (mainTitle) mainTitle.textContent = 'SetuTime!';
    if (subTitle) subTitle.textContent = theme.subtitle;

    if (!document.documentElement.classList.contains('dark-theme')) {
      setMetaThemeColor(THEME_META[type]);
    }
  }

  function toggleDarkMode() {
    var isDark = document.documentElement.classList.toggle('dark-theme');
    storageSet('setutime_dark_mode', isDark ? 'true' : 'false');
    setMetaThemeColor(isDark ? '#111827' : THEME_META[currentTab]);
  }

  function watchSystemTheme() {
    var media = window.matchMedia('(prefers-color-scheme: dark)');
    if (!media.addEventListener) return;
    media.addEventListener('change', function (event) {
      if (storageGet('setutime_dark_mode') !== null) return;
      document.documentElement.classList.toggle('dark-theme', event.matches);
      setMetaThemeColor(event.matches ? '#111827' : THEME_META[currentTab]);
    });
  }

  /* ---------------------------------------------------------------- 隐藏入口 */

  function registerHiddenEntryTap() {
    var now = Date.now();
    hiddenEntryTapTimes = hiddenEntryTapTimes.filter(function (time) {
      return now - time <= HIDDEN_ENTRY_TRIGGER_WINDOW;
    });
    hiddenEntryTapTimes.push(now);
    if (hiddenEntryTapTimes.length >= HIDDEN_ENTRY_TRIGGER_COUNT) {
      hiddenEntryTapTimes = [];
      openHiddenEntryDialog();
      return true;
    }
    return false;
  }

  function openHiddenEntryDialog() {
    closeSearch(false);
    var overlay = $('hiddenEntryOverlay');
    var input = $('hiddenEntryInput');
    var error = $('hiddenEntryError');
    var submit = $('hiddenEntrySubmit');
    if (!overlay || !input) return;

    lastFocusedElement = document.activeElement;
    hiddenEntryBusy = false;
    input.value = '';
    if (error) error.textContent = '';
    if (submit) {
      submit.disabled = false;
      submit.textContent = '进入';
    }
    overlay.inert = false;
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('dialog-open');
    window.setTimeout(function () {
      input.focus();
    }, 80);
  }

  function closeHiddenEntryDialog() {
    var overlay = $('hiddenEntryOverlay');
    if (!overlay || !overlay.classList.contains('active')) return;
    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
    document.body.classList.remove('dialog-open');
    restoreFocus();
  }

  function isOwnedSiteHost(hostname) {
    return OWNED_SITE_HOSTS.indexOf(String(hostname || '').toLowerCase()) !== -1;
  }

  function resolveHiddenEntryUrl(value) {
    var raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.charAt(0) === '/') return window.location.origin + raw;
    try {
      var target = new URL(raw);
      // 只允许 http/https，避免 API 返回 javascript: 等可执行地址
      if (target.protocol !== 'http:' && target.protocol !== 'https:') return '';
      if (isOwnedSiteHost(target.hostname)) {
        return window.location.origin + target.pathname + target.search + target.hash;
      }
      return target.href;
    } catch (error) {
      return window.location.origin + '/' + raw.replace(/^\/+/, '');
    }
  }

  function submitHiddenEntry(event) {
    event.preventDefault();
    if (hiddenEntryBusy) return;

    var input = $('hiddenEntryInput');
    var error = $('hiddenEntryError');
    var submit = $('hiddenEntrySubmit');
    var code = input ? input.value.trim() : '';
    if (!code) {
      if (error) error.textContent = '请输入本期密码';
      return;
    }

    hiddenEntryBusy = true;
    if (error) error.textContent = '';
    if (submit) {
      submit.disabled = true;
      submit.textContent = '验证中...';
    }

    var query = new URLSearchParams({ code: code, siteOrigin: window.location.origin });

    fetch(HIDDEN_ENTRY_API + '?' + query.toString(), {
      method: 'GET',
      cache: 'no-store',
      referrerPolicy: 'no-referrer'
    })
      .then(function (response) {
        return response.json();
      })
      .then(function (data) {
        if (data && data.success && data.url) {
          var targetUrl = resolveHiddenEntryUrl(data.url);
          if (targetUrl) {
            window.location.href = targetUrl;
            return;
          }
        }
        if (error) error.textContent = data && data.msg ? data.msg : '入口密码不正确';
        resetHiddenEntrySubmit();
      })
      .catch(function () {
        if (error) error.textContent = '网络异常，请稍后重试';
        resetHiddenEntrySubmit();
      });
  }

  function resetHiddenEntrySubmit() {
    hiddenEntryBusy = false;
    var submit = $('hiddenEntrySubmit');
    if (submit) {
      submit.disabled = false;
      submit.textContent = '进入';
    }
  }

  /* ---------------------------------------------------------------- 数据 */

  function fetchJson(url) {
    var timestamp = Date.now();
    var connector = url.indexOf('?') === -1 ? '?' : '&';
    return fetch(url + connector + 't=' + timestamp)
      .then(function (response) {
        if (!response.ok) throw new Error('Network error: ' + response.status);
        return response.json();
      })
      .catch(function (error) {
        console.error('Fetch failed:', url, error);
        return null;
      });
  }

  // 合并分页数据到 allItems，并更新 totalCount
  function mergePageData(tab, pageData) {
    if (!pageData || !Array.isArray(pageData.items)) return;
    if (typeof pageData.total === 'number') totalCount[tab] = pageData.total;
    pageData.items.forEach(function (item) {
      if (!item || !item.file) return;
      if (allItemKeys[tab].has(item.file)) return;
      allItemKeys[tab].add(item.file);
      allItems[tab].push(item);
    });
  }

  // 确保某服务端分页文件已加载（并发调用共享同一个请求）
  function ensureServerPage(tab, serverPage) {
    if (cachePages[tab][serverPage]) return Promise.resolve(cachePages[tab][serverPage]);
    if (serverPageRequests[tab][serverPage]) return serverPageRequests[tab][serverPage];

    var request = fetchJson(rootUrl + 'data/' + tab + '/' + serverPage + '.json')
      .then(function (pageData) {
        if (pageData) {
          cachePages[tab][serverPage] = pageData;
          mergePageData(tab, pageData);
        }
        return pageData;
      })
      .finally(function () {
        delete serverPageRequests[tab][serverPage];
      });

    serverPageRequests[tab][serverPage] = request;
    return request;
  }

  function getDisplayTotal() {
    return totalCount[currentTab] || allItems[currentTab].length;
  }

  function getTotalPages() {
    return Math.max(1, Math.ceil(getDisplayTotal() / ITEMS_PER_PAGE));
  }

  /* ---------------------------------------------------------------- 预览图 */

  var PRIMARY_COVER_ORIGIN = 'https://eo.setutime.top';
  // 缩略图由 GitHub Actions 生成后上传到 R2，经 r2.setutime.top 的公开图片前缀提供
  var THUMB_ORIGIN = 'https://r2.setutime.top';
  var THUMB_DIR = 'thumbs-720';
  var THUMB_PATH_PREFIXES = ['acg_pic', 'setu_pic', 'zrsetu_pic', 'V'];

  function getPreviewKey(tab, file) {
    return tab + '/' + file;
  }

  // 旧 JSON / 旧的接口缓存里可能仍是 r2 地址，运行时统一改为 EO 主图床
  function normalizePreviewUrl(url) {
    var value = String(url || '').trim();
    if (!value) return '';
    return value.replace(/^https?:\/\/r2\.setutime\.top\//i, PRIMARY_COVER_ORIGIN + '/');
  }

  // 由原图地址推导 R2 缩略图地址；生成规则与 scripts/generate-thumbs.js 保持一致
  function getThumbUrl(previewUrl) {
    if (thumbState === 'unavailable') return '';
    var raw = String(previewUrl || '').trim();
    if (!raw) return '';
    var url;
    try {
      url = new URL(raw, window.location.href);
    } catch (error) {
      return '';
    }
    var host = url.hostname.toLowerCase();
    if (host !== 'eo.setutime.top' && host !== 'r2.setutime.top') return '';

    var pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch (error) {
      return '';
    }

    var segments = pathname.split('/').filter(Boolean);
    var prefix = segments.shift();
    if (!prefix || THUMB_PATH_PREFIXES.indexOf(prefix) === -1 || !segments.length) return '';
    if (segments.some(function (segment) { return segment === '..' || segment === '.'; })) return '';

    var file = segments.pop();
    if (!file) return '';
    file = file.replace(/\.[^.]+$/, '') + '.webp';

    var thumbPath = [THUMB_DIR, prefix].concat(segments, [file]).join('/');
    var encodedPath = thumbPath.split('/').map(encodeURIComponent).join('/');
    return THUMB_ORIGIN + '/' + encodedPath;
  }

  function fetchPreviewUrl(tab, item) {
    var key = getPreviewKey(tab, item.file);
    if (Object.prototype.hasOwnProperty.call(previewCache, key)) return previewCache[key];
    previewCache[key] = normalizePreviewUrl(item.preview) || null;
    return previewCache[key];
  }

  function extractMiddleImageUrl(doc, pageUrl) {
    var imageUrls = Array.prototype.slice.call(doc.querySelectorAll('.image-item img'))
      .map(function (img) {
        return img.getAttribute('data-src') || img.getAttribute('src');
      })
      .filter(Boolean)
      .map(function (url) {
        try {
          return new URL(url, pageUrl).href;
        } catch (error) {
          return '';
        }
      })
      .filter(Boolean);

    // 偶数张图取前一个中间位置，例如 40 张取第 20 张
    var middleIndex = imageUrls.length ? Math.ceil(imageUrls.length / 2) - 1 : -1;
    return middleIndex >= 0 ? imageUrls[middleIndex] : null;
  }

  // 回退封面：读取子页面自己的 image-item 图床地址
  function fetchSubpagePreviewUrl(tab, item) {
    var key = tab + '/' + item.file;
    if (Object.prototype.hasOwnProperty.call(subpagePreviewCache, key)) {
      return Promise.resolve(subpagePreviewCache[key]);
    }
    if (subpagePreviewRequests[key]) return subpagePreviewRequests[key];

    var pageUrl = rootUrl + tab + '/' + item.file;
    subpagePreviewRequests[key] = fetch(pageUrl, { cache: 'force-cache' })
      .then(function (response) {
        if (!response.ok) throw new Error('Fallback preview page request failed');
        return response.text();
      })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var fallbackUrl = extractMiddleImageUrl(doc, pageUrl);
        subpagePreviewCache[key] = fallbackUrl;
        return fallbackUrl;
      })
      .catch(function (error) {
        console.warn('Fallback preview extraction failed for ' + pageUrl, error);
        subpagePreviewCache[key] = null;
        return null;
      })
      .finally(function () {
        delete subpagePreviewRequests[key];
      });

    return subpagePreviewRequests[key];
  }

  function loadImageSource(image, sourceUrl) {
    return new Promise(function (resolve) {
      var settled = false;

      function finish(loaded) {
        if (settled) return;
        settled = true;
        image.onload = null;
        image.onerror = null;
        resolve(loaded);
      }

      image.onload = function () {
        finish(true);
      };
      image.onerror = function () {
        finish(false);
      };
      image.src = sourceUrl;

      if (image.complete) finish(image.naturalWidth > 0);
    });
  }

  function loadPreviewForCard(card, tab, item) {
    if (!card || !card.isConnected || !item) return Promise.resolve(false);

    var image = card.querySelector('.preview-wrap img');
    var previewWrap = card.querySelector('.preview-wrap');
    if (!image || !previewWrap) return Promise.resolve(false);

    var key = getPreviewKey(tab, item.file);
    function isStale() {
      return !card.isConnected || card.dataset.previewKey !== key;
    }

    var previewUrl = fetchPreviewUrl(tab, item);
    var thumbUrl = getThumbUrl(previewUrl);
    // 优先加载 480px 缩略图；缩略图还没生成时回退到原图
    var chain = thumbUrl
      ? loadImageSource(image, thumbUrl).then(function (loaded) {
          if (loaded) {
            thumbState = 'available';
            return true;
          }
          if (isStale()) return false;
          // 缩略图还没生成时只探测一次，避免整页每张卡都先发一个 404
          if (thumbState === 'unknown') thumbState = 'unavailable';
          return previewUrl ? loadImageSource(image, previewUrl) : false;
        })
      : (previewUrl ? loadImageSource(image, previewUrl) : Promise.resolve(false));

    return chain
      .then(function (loaded) {
        if (loaded || isStale()) return loaded;
        // EO 封面加载失败（或 JSON 没有 preview）时，回退到子页面内嵌的原始图床
        return fetchSubpagePreviewUrl(tab, item).then(function (fallbackUrl) {
          if (isStale() || !fallbackUrl || fallbackUrl === previewUrl) return false;
          return loadImageSource(image, fallbackUrl);
        });
      })
      .then(function (loaded) {
        if (isStale()) return loaded;
        if (loaded) {
          previewWrap.classList.add('loaded');
          previewWrap.classList.remove('preview-unavailable');
        } else {
          previewWrap.classList.add('preview-unavailable');
          previewWrap.classList.remove('loaded');
        }
        return loaded;
      })
      .catch(function (error) {
        console.warn('Preview load failed:', error);
        return false;
      });
  }

  /* ---------------------------------------------------------------- 列表渲染 */

  function getListColumnCount() {
    if (window.matchMedia('(min-width: 1200px)').matches) return 4;
    if (window.matchMedia('(min-width: 900px)').matches) return 3;
    return 2;
  }

  function createPreviewCard(item, tab, itemIndex) {
    var issue = getFileNumber(item.file) || '?';

    var card = document.createElement('a');
    card.className = 'preview-card';
    card.href = '/' + tab + '/' + item.file;
    card.dataset.itemIndex = String(itemIndex);
    card.dataset.previewKey = getPreviewKey(tab, item.file);
    card.setAttribute('aria-label', '第 ' + issue + ' 期：' + (item.caption || '精选合集'));

    var previewWrap = document.createElement('div');
    previewWrap.className = 'preview-wrap';

    var image = document.createElement('img');
    image.alt = '第 ' + issue + ' 期预览图';
    image.decoding = 'async';
    if (itemIndex < 2) {
      image.loading = 'eager';
      image.setAttribute('fetchpriority', 'high');
    } else {
      image.loading = 'lazy';
    }
    previewWrap.appendChild(image);

    var content = document.createElement('div');
    content.className = 'item-content';

    var left = document.createElement('div');
    left.className = 'item-left';

    var title = document.createElement('div');
    title.className = 'item-title';
    title.textContent = '第 ' + issue + ' 期';

    var sub = document.createElement('div');
    sub.className = 'item-sub';
    sub.textContent = item.caption || '精选合集发布';

    left.appendChild(title);
    left.appendChild(sub);
    content.appendChild(left);
    card.appendChild(previewWrap);
    card.appendChild(content);
    return card;
  }

  function distributeCardsRoundRobin(cards, columns) {
    cards.forEach(function (card, index) {
      columns[index % columns.length].appendChild(card);
    });
  }

  function createColumns(count) {
    return Array.from({ length: count }, function () {
      var column = document.createElement('div');
      column.className = 'list-column';
      return column;
    });
  }

  // 限制同时解码的大图数量：封面单张约 390 KB / 2482px，四张并发解码在手机上会明显掉帧
  function enqueuePreview(card, tab, item) {
    if (!card || !item) return;
    previewQueue.push({ card: card, tab: tab, item: item });
    pumpPreviewQueue();
  }

  function pumpPreviewQueue() {
    while (activePreviewLoads < MAX_PREVIEW_LOADS && previewQueue.length) {
      var job = previewQueue.shift();
      if (!job.card.isConnected) continue;
      activePreviewLoads += 1;
      loadPreviewForCard(job.card, job.tab, job.item)
        .catch(function () {})
        .then(function () {
          activePreviewLoads -= 1;
          pumpPreviewQueue();
        });
    }
  }

  function clearSkeletonTimer() {
    if (!skeletonTimer) return;
    window.clearTimeout(skeletonTimer);
    skeletonTimer = null;
  }

  function observeCards(cards, pageItems, tab) {
    if (!('IntersectionObserver' in window)) {
      cards.forEach(function (card, index) {
        enqueuePreview(card, tab, pageItems[index]);
      });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var card = entry.target;
          observer.unobserve(card);
          var itemIndex = Number(card.dataset.itemIndex);
          enqueuePreview(card, tab, pageItems[itemIndex]);
        });
      },
      { rootMargin: '0px' }
    );

    previewObserver = observer;
    cards.forEach(function (card) {
      observer.observe(card);
    });
  }

  function disconnectPreviewObserver() {
    if (!previewObserver) return;
    previewObserver.disconnect();
    previewObserver = null;
  }

  function makeMessage(title, description, actionLabel, actionHandler) {
    var message = document.createElement('div');
    message.className = 'list-message';

    var heading = document.createElement('strong');
    heading.textContent = title;
    message.appendChild(heading);

    if (description) {
      var text = document.createElement('div');
      text.textContent = description;
      message.appendChild(text);
    }

    if (actionLabel && actionHandler) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'retry-btn';
      button.textContent = actionLabel;
      button.addEventListener('click', actionHandler);
      message.appendChild(button);
    }

    return message;
  }

  function showLoadError(requestId) {
    if (requestId !== undefined && requestId !== renderRequestId) return;
    var listDiv = $('contentList');
    var pagination = $('paginationCtrl');
    var skeleton = $('skeleton');
    if (!listDiv) return;

    clearSkeletonTimer();
    disconnectPreviewObserver();
    listDiv.replaceChildren(
      makeMessage('数据加载失败', '网络异常或数据文件暂时不可用，请检查网络后重试。', '重新加载', function () {
        renderCurrentList({ tabSwitch: true });
      })
    );
    listDiv.classList.remove('is-switching', 'gallery-switching-in');
    listDiv.hidden = false;
    listDiv.style.opacity = '1';
    listDiv.setAttribute('aria-busy', 'false');
    if (skeleton) skeleton.hidden = true;
    if (pagination) pagination.hidden = true;
  }

  function updatePagination(activePage, totalPages) {
    var pageInput = $('pageCurrentInput');
    var pageTotal = $('pageTotalLabel');
    var prevBtn = $('prevPageBtn');
    var nextBtn = $('nextPageBtn');
    var pagination = $('paginationCtrl');
    if (pageInput) pageInput.value = String(activePage);
    if (pageTotal) pageTotal.textContent = String(totalPages);
    if (prevBtn) prevBtn.disabled = activePage <= 1;
    if (nextBtn) nextBtn.disabled = activePage >= totalPages;
    if (pagination) pagination.hidden = false;
  }

  function renderCurrentList(options) {
    var opts = options || {};
    var isTabSwitch = !!opts.tabSwitch;
    var isPageChange = !!opts.pageChange;
    var requestId = ++renderRequestId;
    var renderTab = currentTab;
    var listDiv = $('contentList');
    var pagination = $('paginationCtrl');
    var skeleton = $('skeleton');
    if (!listDiv || !pagination || !skeleton) return Promise.resolve();

    clearSkeletonTimer();
    previewQueue.length = 0;
    disconnectPreviewObserver();

    if (isTabSwitch) listDiv.classList.remove('gallery-switching-in');
    pagination.hidden = true;
    listDiv.setAttribute('aria-busy', 'true');

    // 数据有缓存时渲染只要几十毫秒，别先闪一下骨架屏；超过 200ms 才显示加载态
    if (isTabSwitch || isPageChange) {
      skeletonTimer = window.setTimeout(function () {
        if (requestId !== renderRequestId) return;
        listDiv.hidden = true;
        skeleton.hidden = false;
      }, 200);
    }

    // 首次进入某分类才请求第 1 页拿 total；已知 total 时直接复用，少一次切分类请求
    var firstPageReady = totalCount[renderTab]
      ? Promise.resolve(true)
      : ensureServerPage(renderTab, 1);
    return firstPageReady
      .then(function (firstPage) {
        if (requestId !== renderRequestId) return;
        if (!firstPage) {
          showLoadError(requestId);
          return;
        }

        var total = totalCount[renderTab] || allItems[renderTab].length;
        var totalPages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));
        if (currentPage[renderTab] > totalPages) {
          currentPage[renderTab] = totalPages;
          savePage(renderTab, totalPages);
        }

        var activePage = currentPage[renderTab];
        var startIdx = (activePage - 1) * ITEMS_PER_PAGE;
        // ITEMS_PER_PAGE(10) 整除 SERVER_ITEMS_PER_FILE(50)：一个前端页永远只落在一个 JSON 文件内，
        // 直接按文件内偏移取数据，不再依赖 allItems 的累计顺序（也支持直接跳页）。
        var pageFile = Math.floor(startIdx / SERVER_ITEMS_PER_FILE) + 1;
        var offsetInFile = startIdx % SERVER_ITEMS_PER_FILE;

        var pageReady = cachePages[renderTab][pageFile]
          ? Promise.resolve(true)
          : ensureServerPage(renderTab, pageFile).then(function (data) {
              return !!data;
            });

        return pageReady.then(function (ok) {
          if (requestId !== renderRequestId) return;
          if (!ok) {
            showLoadError(requestId);
            return;
          }

          listDiv.style.opacity = '1';

          var fileData = cachePages[renderTab][pageFile];
          var fileItems = fileData && Array.isArray(fileData.items) ? fileData.items.slice() : [];
          fileItems.sort(function (a, b) {
            return parseInt(getFileNumber(b.file) || 0, 10) - parseInt(getFileNumber(a.file) || 0, 10);
          });

          var pageItems = fileItems.slice(offsetInFile, offsetInFile + ITEMS_PER_PAGE);
          if (pageItems.length === 0) {
            listDiv.replaceChildren(makeMessage('暂无当前页数据', '可以返回第一页或切换分类看看。'));
          } else {
            var columnCount = getListColumnCount();
            currentColumnCount = columnCount;
            var columns = createColumns(columnCount);
            var fragment = document.createDocumentFragment();
            columns.forEach(function (column) {
              fragment.appendChild(column);
            });
            listDiv.replaceChildren(fragment);

            // 先让列表可见，再启动 IntersectionObserver，避免隐藏状态下观测不到卡片
            clearSkeletonTimer();
            skeleton.hidden = true;
            listDiv.hidden = false;

            var cards = pageItems.map(function (item, index) {
              return createPreviewCard(item, renderTab, index);
            });
            distributeCardsRoundRobin(cards, columns);
            observeCards(cards, pageItems, renderTab);

            var staggerStep = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 20;
            cards.forEach(function (card, index) {
              window.setTimeout(function () {
                card.classList.add('show');
              }, index * staggerStep);
            });
          }

          clearSkeletonTimer();
          skeleton.hidden = true;
          listDiv.hidden = false;
          listDiv.classList.remove('is-switching');
          listDiv.setAttribute('aria-busy', 'false');

          if (isTabSwitch || isPageChange) {
            listDiv.classList.add('gallery-switching-in');
            window.setTimeout(function () {
              if (requestId === renderRequestId) listDiv.classList.remove('gallery-switching-in');
            }, 220);
          }

          updatePagination(activePage, totalPages);
        });
      })
      .catch(function (error) {
        console.error('Render failed:', error);
        showLoadError(requestId);
      });
  }

  function handleInputJump(val) {
    var pageInput = $('pageCurrentInput');
    var totalPages = getTotalPages();
    var pageNum = parseInt(val, 10);

    if (isNaN(pageNum)) {
      if (pageInput) pageInput.value = String(currentPage[currentTab]);
      return;
    }
    pageNum = Math.min(Math.max(pageNum, 1), totalPages);

    if (pageNum === currentPage[currentTab]) {
      if (pageInput) pageInput.value = String(pageNum);
      return;
    }

    currentPage[currentTab] = pageNum;
    savePage(currentTab, pageNum);
    renderCurrentList({ pageChange: true });
  }

  function changePage(direction) {
    var totalPages = getTotalPages();
    var newPage = currentPage[currentTab] + direction;
    if (newPage < 1 || newPage > totalPages) return;
    currentPage[currentTab] = newPage;
    savePage(currentTab, newPage);
    renderCurrentList({ pageChange: true });
  }

  function rebuildColumns() {
    var listDiv = $('contentList');
    if (!listDiv || listDiv.hidden) return;
    var cards = Array.prototype.slice.call(listDiv.querySelectorAll('.preview-card'));
    if (!cards.length) return;

    var columnCount = getListColumnCount();
    if (columnCount === currentColumnCount) return;
    currentColumnCount = columnCount;

    var columns = createColumns(columnCount);
    cards.forEach(function (card, index) {
      columns[index % columnCount].appendChild(card);
    });
    var fragment = document.createDocumentFragment();
    columns.forEach(function (column) {
      fragment.appendChild(column);
    });
    listDiv.replaceChildren(fragment);
  }

  /* ---------------------------------------------------------------- 搜索 */

  function isSearchOpen() {
    var overlay = $('searchOverlay');
    return !!overlay && overlay.classList.contains('active');
  }

  function restoreFocus() {
    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function' && lastFocusedElement.isConnected) {
      lastFocusedElement.focus();
    }
    lastFocusedElement = null;
  }

  function openSearch() {
    var overlay = $('searchOverlay');
    var input = $('searchInput');
    if (!overlay || overlay.classList.contains('active')) return;

    lastFocusedElement = document.activeElement;
    overlay.inert = false;
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('dialog-open');
    window.setTimeout(function () {
      if (input) input.focus();
    }, 100);
    preloadAllSearchData(currentTab);
  }

  function closeSearch(shouldRestoreFocus) {
    var overlay = $('searchOverlay');
    var input = $('searchInput');
    var results = $('searchResults');
    if (!overlay || !overlay.classList.contains('active')) return;

    overlay.classList.remove('active');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
    document.body.classList.remove('dialog-open');
    if (input) input.value = '';
    if (results) results.replaceChildren();
    if (shouldRestoreFocus !== false) restoreFocus();
  }

  function toggleSearch(show) {
    if (show) openSearch();
    else closeSearch();
  }

  function preloadAllSearchData(tab) {
    var targetTab = tab || currentTab;
    if (preloadState[targetTab]) return preloadState[targetTab];
    if (totalCount[targetTab] && allItems[targetTab].length >= totalCount[targetTab]) return Promise.resolve();

    var promise = ensureServerPage(targetTab, 1)
      .then(function (first) {
        if (!first) return;
        var totalServerPages = Math.max(1, first.totalPages || 1);
        var start = 2;
        function nextBatch() {
          if (start > totalServerPages) return Promise.resolve();
          var batch = [];
          for (var i = 0; i < PRELOAD_CONCURRENCY && start <= totalServerPages; i += 1, start += 1) {
            batch.push(ensureServerPage(targetTab, start));
          }
          return Promise.all(batch).then(nextBatch);
        }
        return nextBatch();
      })
      .then(function () {
        if (isSearchOpen() && $('searchInput').value.trim()) doSearch();
      })
      .catch(function (error) {
        console.warn('Search preload failed:', error);
      })
      .finally(function () {
        if (preloadState[targetTab] === promise) preloadState[targetTab] = null;
      });

    preloadState[targetTab] = promise;
    return promise;
  }

  function scheduleSearch() {
    if (searchTimer) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(doSearch, 150);
  }

  function doSearch() {
    var input = $('searchInput');
    var resultsDiv = $('searchResults');
    if (!input || !resultsDiv) return;

    var val = input.value.trim().toLowerCase();
    resultsDiv.replaceChildren();
    if (!val) return;

    var pool = allItems[currentTab];
    var matched = [];

    for (var i = 0; i < pool.length; i += 1) {
      var item = pool[i];
      var issueNum = getFileNumber(item.file);
      var isCaptionMatch = item.caption && String(item.caption).toLowerCase().indexOf(val) !== -1;
      var isNumMatch = issueNum && issueNum.indexOf(val) !== -1;
      if (!isCaptionMatch && !isNumMatch) continue;
      matched.push(item);
    }

    matched.sort(function (a, b) {
      return parseInt(getFileNumber(b.file) || 0, 10) - parseInt(getFileNumber(a.file) || 0, 10);
    });

    var matchedCount = matched.length;
    var items = matched.slice(0, SEARCH_RESULT_LIMIT);

    var loadedCount = pool.length;
    var expectedCount = getDisplayTotal();
    var preloading = !!preloadState[currentTab] && loadedCount < expectedCount;

    if (matchedCount === 0) {
      var empty = document.createElement('div');
      empty.className = 'search-empty';
      var strong = document.createElement('strong');
      strong.textContent = '没有找到相关结果';
      empty.appendChild(strong);
      empty.appendChild(document.createTextNode('换一个期号或标题关键词试试'));
      resultsDiv.appendChild(empty);
      return;
    }

    var fragment = document.createDocumentFragment();

    var status = document.createElement('div');
    status.className = 'search-status';
    if (preloading) {
      status.textContent = '正在加载全部期号（已加载 ' + loadedCount + ' / ' + expectedCount + '）… 下方为当前已加载结果';
    } else if (matchedCount > SEARCH_RESULT_LIMIT) {
      status.textContent = '共 ' + matchedCount + ' 条结果，仅显示前 ' + SEARCH_RESULT_LIMIT + ' 条，输入更精确的关键词可缩小范围';
    } else {
      status.textContent = '共 ' + matchedCount + ' 条结果';
    }
    fragment.appendChild(status);

    items.forEach(function (item) {
      var link = document.createElement('a');
      link.className = 'item';
      link.href = '/' + currentTab + '/' + item.file;

      var title = document.createElement('div');
      title.className = 'title';
      title.textContent = '第 ' + (getFileNumber(item.file) || '?') + ' 期';

      var sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = item.caption || '完整合集';

      link.appendChild(title);
      link.appendChild(sub);
      fragment.appendChild(link);
    });

    resultsDiv.appendChild(fragment);
  }

  /* ---------------------------------------------------------------- 事件 */

  function trapFocus(container, event) {
    if (event.key !== 'Tab') return;
    var focusables = Array.prototype.slice
      .call(container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'))
      .filter(function (node) {
        return node.offsetParent !== null || node === document.activeElement;
      });
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function bindEvents() {
    TABS.forEach(function (type) {
      var tabButton = $('tab-' + type);
      if (tabButton) {
        tabButton.addEventListener('click', function () {
          handleTabClick(type);
        });
      }
    });

    var tabsContainer = $('tabsContainer');
    if (tabsContainer) {
      tabsContainer.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        var index = TABS.indexOf(currentTab);
        var nextIndex = index;
        if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
        if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = TABS.length - 1;
        var nextButton = $('tab-' + TABS[nextIndex]);
        if (nextButton) nextButton.focus();
        handleTabClick(TABS[nextIndex]);
      });
    }

    var darkBtn = $('darkModeToggle');
    if (darkBtn) {
      darkBtn.addEventListener('click', function () {
        if (registerHiddenEntryTap()) return;
        toggleDarkMode();
      });
    }

    var searchTrigger = $('searchTrigger');
    if (searchTrigger) {
      searchTrigger.addEventListener('click', function () {
        openSearch();
      });
    }

    var searchClose = $('searchClose');
    if (searchClose) {
      searchClose.addEventListener('click', function () {
        closeSearch();
      });
    }

    var searchOverlay = $('searchOverlay');
    var searchInput = $('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', scheduleSearch);
      searchInput.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        var firstResult = $('searchResults').querySelector('a.item');
        if (firstResult) {
          event.preventDefault();
          window.location.href = firstResult.href;
        }
      });
    }
    if (searchOverlay) {
      searchOverlay.addEventListener('keydown', function (event) {
        trapFocus(searchOverlay, event);
      });
      searchOverlay.addEventListener('click', function (event) {
        if (event.target === searchOverlay) closeSearch();
      });
    }

    var hiddenOverlay = $('hiddenEntryOverlay');
    if (hiddenOverlay) {
      hiddenOverlay.addEventListener('keydown', function (event) {
        trapFocus(hiddenOverlay, event);
      });
      hiddenOverlay.addEventListener('click', function (event) {
        if (event.target === hiddenOverlay) closeHiddenEntryDialog();
      });
    }

    var hiddenClose = $('hiddenEntryClose');
    if (hiddenClose) hiddenClose.addEventListener('click', closeHiddenEntryDialog);

    var hiddenForm = $('hiddenEntryForm');
    if (hiddenForm) hiddenForm.addEventListener('submit', submitHiddenEntry);

    var prevBtn = $('prevPageBtn');
    if (prevBtn) prevBtn.addEventListener('click', function () { changePage(-1); });
    var nextBtn = $('nextPageBtn');
    if (nextBtn) nextBtn.addEventListener('click', function () { changePage(1); });

    var pageInput = $('pageCurrentInput');
    if (pageInput) {
      pageInput.addEventListener('change', function () {
        handleInputJump(pageInput.value);
      });
      pageInput.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        handleInputJump(pageInput.value);
        pageInput.blur();
      });
    }

    document.addEventListener('keydown', function (event) {
      if ((event.ctrlKey || event.metaKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        openSearch();
        return;
      }
      if (event.key !== 'Escape') return;
      var hiddenOverlay = $('hiddenEntryOverlay');
      if (hiddenOverlay && hiddenOverlay.classList.contains('active')) {
        closeHiddenEntryDialog();
        return;
      }
      if (isSearchOpen()) closeSearch();
    });

    window.addEventListener('resize', function () {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(rebuildColumns, 180);
    });

    // 某些环境（如移动端地址栏收起）不一定触发 resize，用断点变化兜底
    ['(min-width: 900px)', '(min-width: 1200px)'].forEach(function (query) {
      var media = window.matchMedia(query);
      var onChange = function () {
        if (resizeTimer) window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(rebuildColumns, 180);
      };
      if (media.addEventListener) media.addEventListener('change', onChange);
    });

    // 关闭状态下让弹层完全不可聚焦
    if (searchOverlay) searchOverlay.inert = true;
    if (hiddenOverlay) hiddenOverlay.inert = true;

    watchSystemTheme();
  }

  function handleTabClick(type) {
    if (currentTab === type) return;
    applyTheme(type);
    storageSet('setutime_active_tab', type);

    var searchInput = $('searchInput');
    var searchResults = $('searchResults');
    if (searchInput) searchInput.value = '';
    if (searchResults) searchResults.replaceChildren();

    window.scrollTo(0, 0);
    renderCurrentList({ tabSwitch: true });
  }

  /* ---------------------------------------------------------------- 启动 */

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (error) {
        console.warn('Image cache service worker registration failed:', error);
      });
    });
  }



  function startAppNow() {
    var pBar = $('topProgressBar');
    if (pBar) pBar.style.width = '30%';

    var savedTab = storageGet('setutime_active_tab');
    if (TABS.indexOf(savedTab) === -1) savedTab = 'acg';
    applyTheme(savedTab, true);

    if (pBar) pBar.style.width = '55%';

    renderCurrentList()
      .then(function () {
        if (pBar) pBar.style.width = '100%';
        window.setTimeout(function () {
          if (pBar) pBar.style.opacity = '0';
        }, 200);

        var headerEl = $('appHeader');
        if (headerEl) headerEl.classList.remove('app-loading');
        document.body.classList.add('loaded');

        // 搜索数据只在打开搜索时加载，避免切分类时后台请求和封面图抢带宽
      })
      .catch(function (error) {
        console.error('App start failed:', error);
        showLoadError(renderRequestId);
        document.body.classList.add('loaded');
      });
  }

  function init() {
    bindEvents();
    registerServiceWorker();
    startAppNow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
