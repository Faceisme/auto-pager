// Shared helpers used by content.js, options.js and popup.js.
// Loaded as a plain classic script (no ES modules) so it works both as a
// content script and inside extension pages via <script src="common.js">.
(function (global) {
  'use strict';

  var DEFAULT_SETTINGS = {
    enabled: true,
    excludePatterns: '',
    distance: 400,
    openInNewTab: true,
    fixScrollOver: false,
    suppressSiteinfoSinglePost: false,
    usePrefetch: false,
    iconVisibility: 'show', // 'show' | 'hide' | 'mouseover'
    iconOpacity: 1,
    iconSize: 16,
    disablePageSeparator: false,
    disableContextMenu: false,
    markLoadedLinks: false
  };

  var MAIN_CONTENT_SELECTORS = [
    'main', '[role="main"]', '#main', '#content', '#main-content',
    '.main-content', 'article', '#article', '.post-list',
    '.posts', '#posts', '#content-list',
    '#threadlisttableid', '#postlist'
  ];

  var NEXT_LINK_SELECTORS = [
    '.pagination .next a', 'a.pagination-next', '.pager-next a',
    '.pages-next a', '.next-page a', '#pagination .next a',
    '.page-next a', 'a.nextpostslink', '.next a', 'a.next',
    '.pg a.nxt', 'a.nxt'
  ];

  var NEXT_TEXT_PATTERN = /^(next|older( posts)?|more|下一页|下一頁|后一页|後一頁|下页|次のページ|次へ|»|›|>|load more)$/i;

  // ---- Exclude pages: wildcard(*) or /regex/flags per line ----
  function patternToRegExp(line) {
    line = (line || '').trim();
    if (!line) return null;
    var regexLiteral = line.match(/^\/(.*)\/([a-z]*)$/i);
    if (regexLiteral) {
      try { return new RegExp(regexLiteral[1], regexLiteral[2]); } catch (e) { return null; }
    }
    var escaped = line.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    try { return new RegExp('^' + escaped + '$'); } catch (e) { return null; }
  }

  function isExcluded(url, excludeText) {
    var lines = (excludeText || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var re = patternToRegExp(lines[i]);
      if (re && re.test(url)) return true;
    }
    return false;
  }

  // ---- XPath ----
  function evalXPath(xpath, doc, contextNode, single) {
    if (!xpath) return single ? null : [];
    try {
      var type = single ? XPathResult.FIRST_ORDERED_NODE_TYPE : XPathResult.ORDERED_NODE_SNAPSHOT_TYPE;
      var result = doc.evaluate(xpath, contextNode || doc, null, type, null);
      if (single) return result.singleNodeValue;
      var nodes = [];
      for (var i = 0; i < result.snapshotLength; i++) nodes.push(result.snapshotItem(i));
      return nodes;
    } catch (e) {
      return single ? null : [];
    }
  }

  function hrefOf(node, baseUrl) {
    if (!node) return null;
    var raw = node.getAttribute ? (node.getAttribute('href') || node.getAttribute('src')) : null;
    if (!raw && node.href) raw = node.href;
    if (!raw) return null;
    try { return new URL(raw, baseUrl).href; } catch (e) { return null; }
  }

  // ---- SITEINFO matching ----
  function findSiteInfoMatch(siteinfoList, url) {
    if (!siteinfoList || !siteinfoList.length) return null;
    var best = null;
    for (var i = 0; i < siteinfoList.length; i++) {
      var item = siteinfoList[i];
      if (!item || !item.url || !item.nextLink || !item.pageElement) continue;
      var re;
      try { re = new RegExp(item.url); } catch (e) { continue; }
      if (re.test(url)) {
        if (!best || item.url.length > best.url.length) best = item;
      }
    }
    return best;
  }

  // ---- Generic fallback (no SITEINFO entry matched) ----
  function findMainContainer(doc) {
    for (var i = 0; i < MAIN_CONTENT_SELECTORS.length; i++) {
      var el = doc.querySelector(MAIN_CONTENT_SELECTORS[i]);
      if (el && el.children && el.children.length > 0) {
        return { el: el, selector: MAIN_CONTENT_SELECTORS[i] };
      }
    }
    return null;
  }

  function findGenericNextLink(doc, baseUrl) {
    var relNext = doc.querySelector('a[rel~="next"], link[rel~="next"]');
    var url = hrefOf(relNext, baseUrl);
    if (url) return url;

    for (var i = 0; i < NEXT_LINK_SELECTORS.length; i++) {
      var el = doc.querySelector(NEXT_LINK_SELECTORS[i]);
      if (el) {
        var link = el.tagName === 'A' ? el : el.querySelector('a');
        url = hrefOf(link, baseUrl);
        if (url) return url;
      }
    }

    var anchors = doc.querySelectorAll('a[href]');
    for (var j = 0; j < anchors.length; j++) {
      var text = (anchors[j].textContent || '').trim();
      if (NEXT_TEXT_PATTERN.test(text)) {
        url = hrefOf(anchors[j], baseUrl);
        if (url) return url;
      }
    }
    return null;
  }

  // ---- "Suppress SITEINFO in single post" heuristic ----
  // The next page is treated as a continuation of the same listing/article when
  // the two URLs are identical apart from their numbers. Masking every digit run
  // (not just a trailing one) covers page numbers wherever they sit — in the
  // filename (forum-40-1.html -> forum-40-2.html), the path (/p/1 -> /p/2) or the
  // query (?page=1 -> ?page=2) — while still rejecting jumps to different content.
  function isSameContentContinuation(currentUrl, nextUrl) {
    try {
      var a = new URL(currentUrl);
      var b = new URL(nextUrl);
      if (a.origin !== b.origin) return false;
      var shape = function (u) {
        return (u.pathname + u.search).replace(/\d+/g, '#');
      };
      return shape(a) === shape(b);
    } catch (e) {
      return true;
    }
  }

  // ---- Rewrite relative href/src/srcset in a fetched fragment to absolute ----
  function resolveUrls(root, baseUrl) {
    var attrs = ['href', 'src'];
    var all = root.querySelectorAll('[href],[src],[srcset]');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      for (var a = 0; a < attrs.length; a++) {
        var val = el.getAttribute(attrs[a]);
        if (val) {
          try { el.setAttribute(attrs[a], new URL(val, baseUrl).href); } catch (e) {}
        }
      }
      var srcset = el.getAttribute('srcset');
      if (srcset) {
        try {
          var rewritten = srcset.split(',').map(function (part) {
            var bits = part.trim().split(/\s+/);
            bits[0] = new URL(bits[0], baseUrl).href;
            return bits.join(' ');
          }).join(', ');
          el.setAttribute('srcset', rewritten);
        } catch (e) {}
      }
    }
  }

  global.__APG_COMMON__ = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    patternToRegExp: patternToRegExp,
    isExcluded: isExcluded,
    evalXPath: evalXPath,
    hrefOf: hrefOf,
    findSiteInfoMatch: findSiteInfoMatch,
    findMainContainer: findMainContainer,
    findGenericNextLink: findGenericNextLink,
    isSameContentContinuation: isSameContentContinuation,
    resolveUrls: resolveUrls
  };
})(typeof window !== 'undefined' ? window : self);
