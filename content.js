(function () {
  'use strict';

  var APG = window.__APG_COMMON__;
  if (!APG || window.__APG_CONTENT_LOADED__) return;
  window.__APG_CONTENT_LOADED__ = true;

  var settings = APG.DEFAULT_SETTINGS;
  var mode = null;          // 'siteinfo' | 'generic' | null
  var siteEntry = null;     // matched SITEINFO entry
  var observerRef = null;
  var sentinelEl = null;
  var uiEls = {};

  var state = {
    container: null,
    lastNode: null,
    nextUrl: null,
    visited: null,
    prefetchCache: null,
    prefetchInFlight: null,
    pageCount: 1,
    loading: false,
    stopped: false
  };

  function fetchHtml(url) {
    return chrome.runtime.sendMessage({ type: 'FETCH_HTML', url: url })
      .catch(function (err) { return { ok: false, error: String(err) }; });
  }

  function getInsertionPoint() {
    if (mode === 'siteinfo' && siteEntry.insertBefore) {
      var beforeNode = APG.evalXPath(siteEntry.insertBefore, document, document, true);
      if (beforeNode && beforeNode.parentNode) return { parent: beforeNode.parentNode, ref: beforeNode };
    }
    var parent = state.container;
    var ref = (state.lastNode && state.lastNode.parentNode === parent) ? state.lastNode.nextSibling : null;
    return { parent: parent, ref: ref };
  }

  function extractContent(doc, baseUrl) {
    if (mode === 'siteinfo') {
      var nodes = APG.evalXPath(siteEntry.pageElement, doc, doc, false);
      var nextNode = APG.evalXPath(siteEntry.nextLink, doc, doc, true);
      return { nodes: nodes, nextUrl: APG.hrefOf(nextNode, baseUrl) };
    }
    var container = doc.querySelector(mode === 'generic' ? state.containerSelector : '');
    var childNodes = container ? Array.prototype.slice.call(container.children) : [];
    return { nodes: childNodes, nextUrl: APG.findGenericNextLink(doc, baseUrl) };
  }

  // Widest row wins so the bar spans the full table width (auto-detected).
  function detectColumnCount(table) {
    if (!table) return 1;
    var rows = table.querySelectorAll('tr');
    var max = 1;
    for (var i = 0; i < rows.length && i < 30; i++) {
      var cells = rows[i].children, c = 0;
      for (var j = 0; j < cells.length; j++) c += cells[j].colSpan || 1;
      if (c > max) max = c;
    }
    return max;
  }

  // Build a separator that is valid markup for the current container. A bare
  // <div> dropped inside a <table> gets hoisted out by the browser and renders
  // detached/misaligned, so in a table we emit a real full-width colspan cell
  // that lines up edge-to-edge with the list rows.
  function buildSeparator(parent) {
    var bar = document.createElement('div');
    bar.className = 'apg-bar';
    var tag = parent && parent.tagName;
    var outer;
    if (tag === 'TABLE' || tag === 'TBODY' || tag === 'THEAD' || tag === 'TFOOT') {
      var table = tag === 'TABLE' ? parent : parent.closest('table');
      var td = document.createElement('td');
      td.colSpan = detectColumnCount(table);
      td.appendChild(bar);
      var tr = document.createElement('tr');
      tr.appendChild(td);
      if (tag === 'TABLE') {
        outer = document.createElement('tbody');
        outer.className = 'apg-sep-tbody';
        outer.appendChild(tr);
      } else {
        tr.className = 'apg-sep-row';
        outer = tr;
      }
    } else {
      outer = document.createElement('div');
      outer.className = 'apg-sep-block';
      outer.appendChild(bar);
    }
    outer._apgBar = bar;
    return outer;
  }

  function setSeparatorState(bar, kind, text) {
    bar.className = 'apg-bar apg-bar-' + kind;
    bar.innerHTML = kind === 'loading'
      ? '<span class="apg-spin"></span><span class="apg-txt"></span>'
      : '<span class="apg-txt"></span>';
    bar.querySelector('.apg-txt').textContent = text || '';
  }

  function insertSeparator(kind) {
    if (settings.disablePageSeparator) return null;
    var point = getInsertionPoint();
    var outer = buildSeparator(point.parent);
    setSeparatorState(outer._apgBar, kind, kind === 'loading' ? '正在加载下一页…' : '');
    point.parent.insertBefore(outer, point.ref);
    state.lastNode = outer;
    return outer;
  }

  function updateSeparator(el, kind, errorMsg, pageNum) {
    if (!el || !el._apgBar) return;
    var text;
    if (kind === 'done') text = '第 ' + pageNum + ' 页';
    else if (kind === 'error') text = errorMsg ? ('已停止 · ' + errorMsg) : '没有更多了';
    else text = '正在加载下一页…';
    setSeparatorState(el._apgBar, kind, text);
  }

  function insertNodes(nodes, baseUrl) {
    var importedTopNodes = [];
    var frag = document.createDocumentFragment();
    nodes.forEach(function (n) {
      var imported = document.importNode(n, true);
      APG.resolveUrls(imported, baseUrl);
      importedTopNodes.push(imported);
      frag.appendChild(imported);
    });
    var point = getInsertionPoint();
    point.parent.insertBefore(frag, point.ref);
    if (importedTopNodes.length) state.lastNode = importedTopNodes[importedTopNodes.length - 1];

    if (settings.openInNewTab) {
      importedTopNodes.forEach(function (top) {
        if (top.nodeType !== 1) return;
        if (top.tagName === 'A') {
          top.target = '_blank';
          top.rel = (top.rel ? top.rel + ' ' : '') + 'noopener';
        }
        var anchors = top.querySelectorAll ? top.querySelectorAll('a[href]') : [];
        anchors.forEach(function (a) {
          a.target = '_blank';
          a.rel = (a.rel ? a.rel + ' ' : '') + 'noopener';
        });
      });
    }
  }

  function markLoadedLinks() {
    var anchors = document.querySelectorAll('a[href]:not(.apg-loaded-mark)');
    anchors.forEach(function (a) {
      try {
        var href = new URL(a.getAttribute('href'), location.href).href;
        if (state.visited.has(href)) a.classList.add('apg-loaded-mark');
      } catch (e) {}
    });
  }

  function prefetchNext() {
    if (!state.nextUrl) return;
    if (state.prefetchCache.has(state.nextUrl)) return;
    if (state.prefetchInFlight === state.nextUrl) return;
    state.prefetchInFlight = state.nextUrl;
    var url = state.nextUrl;
    fetchHtml(url).then(function (res) {
      state.prefetchCache.set(url, res);
      if (state.prefetchInFlight === url) state.prefetchInFlight = null;
    });
  }

  async function loadNextPage() {
    if (state.loading || !state.nextUrl || state.stopped) return;
    // Stop auto-triggering while this load runs; armNextLoad() re-arms it only
    // after the user scrolls again, so we never preload a burst of pages.
    disconnectObserver();
    var url = state.nextUrl;
    if (state.visited.has(url)) {
      state.stopped = true;
      disconnectObserver();
      updateUI('stopped');
      return;
    }
    state.visited.add(url);
    state.loading = true;
    updateUI('loading');
    var sep = insertSeparator('loading');

    var result = state.prefetchCache.get(url);
    state.prefetchCache.delete(url);
    if (!result) result = await fetchHtml(url);

    if (!result || !result.ok) {
      state.stopped = true;
      updateSeparator(sep, 'error', result && result.error);
      updateUI('stopped');
      disconnectObserver();
      state.loading = false;
      return;
    }

    var doc = new DOMParser().parseFromString(result.html, 'text/html');
    var baseUrl = result.finalUrl || url;
    var extracted = extractContent(doc, baseUrl);

    if (!extracted.nodes.length) {
      state.stopped = true;
      updateSeparator(sep, 'error', '未找到可拼接的内容');
      updateUI('stopped');
      disconnectObserver();
      state.loading = false;
      return;
    }

    insertNodes(extracted.nodes, baseUrl);
    state.pageCount++;
    updateSeparator(sep, 'done', null, state.pageCount);
    state.nextUrl = (extracted.nextUrl && extracted.nextUrl !== url) ? extracted.nextUrl : null;

    if (settings.markLoadedLinks) markLoadedLinks();
    if (sentinelEl) document.body.appendChild(sentinelEl);

    if (!state.nextUrl) {
      updateUI('end');
      disconnectObserver();
    } else {
      updateUI('idle');
      armNextLoad();
    }
    state.loading = false;
  }

  function startObserving() {
    if (observerRef) observerRef.disconnect();
    observerRef = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) loadNextPage();
      });
    }, { root: null, rootMargin: '0px 0px ' + (settings.distance || 400) + 'px 0px', threshold: 0 });
    observerRef.observe(sentinelEl);
  }

  function disconnectObserver() {
    if (observerRef) { observerRef.disconnect(); observerRef = null; }
  }

  // Demand-driven loading: after a page loads we wait for the user to scroll
  // once more before re-observing the sentinel. Because the freshly inserted
  // page pushes the sentinel out of view, the next load only fires when the
  // reader actually scrolls down to it — no bursts, "just enough" preloading.
  function armNextLoad() {
    if (settings.usePrefetch) prefetchNext();
    var onScroll = function () {
      window.removeEventListener('scroll', onScroll);
      if (!state.stopped && state.nextUrl && !state.loading) startObserving();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  function mountSentinel() {
    sentinelEl = document.createElement('div');
    sentinelEl.id = 'apg-sentinel';
    sentinelEl.style.cssText = 'height:1px;width:100%;';
    document.body.appendChild(sentinelEl);
  }

  function applyFixScrollOver() {
    document.documentElement.style.overscrollBehaviorY = 'contain';
  }

  var UI_STYLE = '.wrap{display:flex;align-items:center;gap:4px;background:rgba(255,255,255,.92);' +
    'border:1px solid #ccc;border-radius:6px;padding:3px 5px;box-shadow:0 1px 4px rgba(0,0,0,.2);' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;transition:opacity .15s ease;}' +
    '.btn{cursor:pointer;border:none;background:transparent;font-size:var(--apg-size,16px);line-height:1;' +
    'padding:2px 3px;color:#333;}' +
    '.btn:hover{background:rgba(0,0,0,.08);border-radius:4px;}' +
    '.btn:disabled{opacity:.4;cursor:default;}' +
    '.spinner{width:10px;height:10px;border:2px solid #bbb;border-top-color:#3b82f6;border-radius:50%;' +
    'animation:apgspin .6s linear infinite;margin:0 2px;}' +
    '.spinner[hidden]{display:none;}' +
    '@keyframes apgspin{to{transform:rotate(360deg);}}' +
    '.wrap.mouseover{opacity:0;}' +
    '.wrap.mouseover:hover{opacity:var(--apg-opacity,1);}';

  function mountUI() {
    var host = document.createElement('div');
    host.id = 'apg-ui-host';
    host.style.position = 'fixed';
    host.style.top = '8px';
    host.style.right = '8px';
    host.style.zIndex = '2147483647';
    document.documentElement.appendChild(host);

    var shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = UI_STYLE;
    var wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML =
      '<button class="btn" data-action="toggle" title="暂停 / 继续本页的自动翻页">⏸</button>' +
      '<button class="btn" data-action="loadnow" title="立即加载下一页">⤓</button>' +
      '<span class="spinner" hidden></span>' +
      '<button class="btn" data-action="options" title="打开 AutoPager 设置">⚙</button>';

    shadow.appendChild(style);
    shadow.appendChild(wrap);

    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action]');
      if (!btn) return;
      var action = btn.dataset.action;
      if (action === 'toggle') {
        state.stopped = !state.stopped;
        if (state.stopped) { disconnectObserver(); btn.textContent = '▶'; updateUI('paused'); }
        else { startObserving(); btn.textContent = '⏸'; updateUI('idle'); }
      } else if (action === 'loadnow') {
        loadNextPage();
      } else if (action === 'options') {
        // openOptionsPage 在内容脚本上下文不可用，转交后台 service worker 打开
        chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
      }
    });

    uiEls.host = host;
    uiEls.wrap = wrap;
    applyUIVisibility();
  }

  function applyUIVisibility() {
    if (!uiEls.wrap) return;
    uiEls.wrap.style.setProperty('--apg-size', (settings.iconSize || 16) + 'px');
    uiEls.wrap.style.setProperty('--apg-opacity', settings.iconOpacity == null ? 1 : settings.iconOpacity);
    uiEls.wrap.classList.toggle('mouseover', settings.iconVisibility === 'mouseover');
    if (settings.iconVisibility === 'mouseover') {
      uiEls.wrap.style.opacity = '';
    } else {
      uiEls.wrap.style.opacity = settings.iconOpacity == null ? 1 : settings.iconOpacity;
    }
    uiEls.host.style.display = settings.iconVisibility === 'hide' ? 'none' : 'block';
  }

  function updateUI(uiState) {
    if (!uiEls.wrap) return;
    var spinner = uiEls.wrap.querySelector('.spinner');
    if (spinner) spinner.hidden = uiState !== 'loading';
    var loadBtn = uiEls.wrap.querySelector('[data-action="loadnow"]');
    if (loadBtn) loadBtn.disabled = (uiState === 'end' || uiState === 'stopped' || uiState === 'loading');
  }

  function init() {
    chrome.storage.local.get(['settings', 'siteinfoList']).then(function (res) {
      settings = Object.assign({}, APG.DEFAULT_SETTINGS, res.settings || {});
      if (!settings.enabled) return;
      if (APG.isExcluded(location.href, settings.excludePatterns)) return;
      // 电商等风控敏感站点:固定禁用自动翻页,避免后台抓取被判定为爬虫。
      if (APG.isRiskControlledSite(location.href)) return;

      var siteinfoList = res.siteinfoList || [];
      var matched = APG.findSiteInfoMatch(siteinfoList, location.href);

      if (matched) {
        var nodes = APG.evalXPath(matched.pageElement, document, document, false);
        var nextNode = APG.evalXPath(matched.nextLink, document, document, true);
        var nextUrl = APG.hrefOf(nextNode, location.href);
        if (nodes.length && nextUrl) {
          if (!(settings.suppressSiteinfoSinglePost && !APG.isSameContentContinuation(location.href, nextUrl))) {
            mode = 'siteinfo';
            siteEntry = matched;
            state.container = nodes[nodes.length - 1].parentNode;
            state.lastNode = nodes[nodes.length - 1];
            state.nextUrl = nextUrl;
          }
        }
      }

      if (!mode) {
        var mainContainer = APG.findMainContainer(document);
        var genericNext = mainContainer ? APG.findGenericNextLink(document, location.href) : null;
        if (mainContainer && genericNext) {
          if (!(settings.suppressSiteinfoSinglePost && !APG.isSameContentContinuation(location.href, genericNext))) {
            mode = 'generic';
            state.containerSelector = mainContainer.selector;
            state.container = mainContainer.el;
            state.lastNode = mainContainer.el.lastElementChild;
            state.nextUrl = genericNext;
          }
        }
      }

      if (!mode || !state.nextUrl) return;

      state.visited = new Set([location.href]);
      state.prefetchCache = new Map();

      mountUI();
      mountSentinel();
      startObserving();
      if (settings.fixScrollOver) applyFixScrollOver();
    }).catch(function (err) { console.warn('[AutoPager] 初始化失败:', err); });
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;
    if (!mode) { if (msg.type === 'GET_STATUS') sendResponse({ active: false }); return; }
    if (msg.type === 'FORCE_LOAD_NEXT') {
      loadNextPage();
    } else if (msg.type === 'TOGGLE_ENABLED') {
      state.stopped = !state.stopped;
      if (state.stopped) disconnectObserver(); else startObserving();
      updateUI(state.stopped ? 'paused' : 'idle');
    } else if (msg.type === 'GET_STATUS') {
      sendResponse({ active: true, stopped: state.stopped, pageCount: state.pageCount, mode: mode });
    }
  });

  init();
})();
