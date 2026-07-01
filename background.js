// Service worker: settings bootstrap, cross-origin fetch on behalf of the
// content script (avoids page CSP restrictions), SITEINFO database updates,
// and the optional right-click context menu.
importScripts('common.js');
var APG = self.__APG_COMMON__;

// wedata.net (the original SITEINFO host) has gone offline; this is an
// actively maintained mirror with a compatible url/nextLink/pageElement schema.
var SITEINFO_URL = 'https://raw.githubusercontent.com/tophf/autopagerize/master/siteinfo.json';
var ALARM_NAME = 'autopager-siteinfo-daily-update';

// Work out how to decode a fetched page's bytes. Prefer the charset from the
// HTTP Content-Type header; if absent, sniff the HTML <meta charset> in the
// first bytes (read as latin1 so every byte maps 1:1 and the regex never fails).
function detectCharset(contentType, buf) {
  var m = contentType && contentType.match(/charset\s*=\s*["']?([\w-]+)/i);
  if (m) return m[1].toLowerCase();
  try {
    var head = new TextDecoder('windows-1252').decode(new Uint8Array(buf, 0, Math.min(buf.byteLength, 4096)));
    var m2 = head.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i) ||
             head.match(/charset\s*=\s*["']?([\w-]+)/i);
    if (m2) return m2[1].toLowerCase();
  } catch (e) {}
  return 'utf-8';
}

function getSettings() {
  return chrome.storage.local.get('settings').then(function (res) {
    return Object.assign({}, APG.DEFAULT_SETTINGS, res.settings || {});
  });
}

async function updateSiteInfo() {
  try {
    var res = await fetch(SITEINFO_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var json = await res.json();
    var list = (json || []).map(function (item) {
      return item && item.data ? item.data : item;
    }).filter(function (d) {
      return d && d.url && d.nextLink && d.pageElement;
    }).map(function (d) {
      return {
        url: d.url,
        nextLink: d.nextLink,
        pageElement: d.pageElement,
        exampleUrl: d.exampleUrl || '',
        insertBefore: d.insertBefore || ''
      };
    });
    var lastUpdated = Date.now();
    await chrome.storage.local.set({ siteinfoList: list, siteinfoLastUpdated: lastUpdated });
    return { ok: true, count: list.length, lastUpdated: lastUpdated };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function rebuildContextMenus(settings) {
  chrome.contextMenus.removeAll(function () {
    if (settings && settings.disableContextMenu) return;
    chrome.contextMenus.create({ id: 'autopager-load-next', title: 'AutoPager：立即加载下一页', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'autopager-toggle', title: 'AutoPager：暂停/继续本页翻页', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'autopager-exclude-site', title: 'AutoPager：排除此页面', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'autopager-options', title: 'AutoPager：打开设置', contexts: ['page'] });
  });
}

chrome.contextMenus.onClicked.addListener(function (info, tab) {
  if (info.menuItemId === 'autopager-options') {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (info.menuItemId === 'autopager-exclude-site' && tab && tab.url) {
    getSettings().then(function (settings) {
      var line = tab.url.split('?')[0] + '*';
      var text = settings.excludePatterns ? settings.excludePatterns + '\n' + line : line;
      settings.excludePatterns = text;
      chrome.storage.local.set({ settings: settings });
    });
    return;
  }
  if (!tab || !tab.id) return;
  var type = info.menuItemId === 'autopager-load-next' ? 'FORCE_LOAD_NEXT' : 'TOGGLE_ENABLED';
  chrome.tabs.sendMessage(tab.id, { type: type }).catch(function () {});
});

chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.get('settings').then(function (res) {
    if (!res.settings) {
      chrome.storage.local.set({ settings: APG.DEFAULT_SETTINGS });
    }
    rebuildContextMenus(res.settings || APG.DEFAULT_SETTINGS);
  });
  updateSiteInfo();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 24 * 60 });
});

chrome.runtime.onStartup.addListener(function () {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 24 * 60 });
  getSettings().then(rebuildContextMenus);
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === ALARM_NAME) updateSiteInfo();
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && changes.settings) {
    rebuildContextMenus(changes.settings.newValue);
  }
});

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return false;

  if (msg.type === 'FETCH_HTML') {
    fetch(msg.url, { credentials: 'include' })
      .then(async function (res) {
        if (!res.ok) { sendResponse({ ok: false, error: 'HTTP ' + res.status }); return; }
        // Response.text() always decodes as UTF-8 and ignores the charset, so
        // legacy-encoded pages (GBK, Big5, Shift_JIS…) come out as mojibake.
        // Decode the raw bytes with the charset we actually detect instead.
        var buf = await res.arrayBuffer();
        var charset = detectCharset(res.headers.get('content-type'), buf);
        var html;
        try {
          html = new TextDecoder(charset).decode(buf);
        } catch (e) {
          html = new TextDecoder('utf-8').decode(buf);
        }
        sendResponse({ ok: true, html: html, finalUrl: res.url });
      })
      .catch(function (err) { sendResponse({ ok: false, error: String(err) }); });
    return true;
  }

  if (msg.type === 'UPDATE_SITEINFO') {
    updateSiteInfo().then(sendResponse);
    return true;
  }

  return false;
});
