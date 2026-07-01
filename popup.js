(function () {
  'use strict';

  var hasChrome = typeof chrome !== 'undefined' && chrome.tabs;
  var APG = window.__APG_COMMON__;
  var DEFAULTS = APG.DEFAULT_SETTINGS;

  var dot = document.getElementById('statusDot');
  var text = document.getElementById('statusText');
  var enabledToggle = document.getElementById('enabledToggle');
  var loadNowBtn = document.getElementById('loadNowBtn');
  var excludeSiteBtn = document.getElementById('excludeSiteBtn');
  var optionsBtn = document.getElementById('optionsBtn');

  var activeTab = null;

  function getActiveTab() {
    if (!hasChrome) return Promise.resolve(null);
    return chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
      return tabs && tabs[0] ? tabs[0] : null;
    });
  }

  function refreshStatus() {
    if (!activeTab || !activeTab.id) {
      dot.className = 'dot';
      text.textContent = '没有活动标签页';
      loadNowBtn.disabled = true;
      return;
    }
    chrome.tabs.sendMessage(activeTab.id, { type: 'GET_STATUS' }).then(function (res) {
      if (!res || !res.active) {
        dot.className = 'dot';
        text.textContent = '当前页面未检测到可翻页内容';
        loadNowBtn.disabled = true;
        return;
      }
      dot.className = 'dot ' + (res.stopped ? 'paused' : 'active');
      var modeLabel = res.mode === 'siteinfo' ? '规则库匹配' : '通用识别';
      text.textContent = res.stopped
        ? '已暂停 · 第 ' + res.pageCount + ' 页'
        : '运行中(' + modeLabel + ') · 第 ' + res.pageCount + ' 页';
      loadNowBtn.disabled = !!res.stopped;
    }).catch(function () {
      dot.className = 'dot';
      text.textContent = '当前页面未检测到可翻页内容';
      loadNowBtn.disabled = true;
    });
  }

  function loadSettings() {
    if (!hasChrome) return Promise.resolve(Object.assign({}, DEFAULTS));
    return chrome.storage.local.get('settings').then(function (res) {
      return Object.assign({}, DEFAULTS, res.settings || {});
    });
  }

  function init() {
    loadSettings().then(function (settings) {
      enabledToggle.checked = !!settings.enabled;
    });

    getActiveTab().then(function (tab) {
      activeTab = tab;
      refreshStatus();
    });

    enabledToggle.addEventListener('change', function () {
      loadSettings().then(function (settings) {
        settings.enabled = enabledToggle.checked;
        chrome.storage.local.set({ settings: settings });
      });
    });

    loadNowBtn.addEventListener('click', function () {
      if (!activeTab || !activeTab.id) return;
      chrome.tabs.sendMessage(activeTab.id, { type: 'FORCE_LOAD_NEXT' }).then(function () {
        setTimeout(refreshStatus, 400);
      }).catch(function () {});
    });

    excludeSiteBtn.addEventListener('click', function () {
      if (!activeTab || !activeTab.url) return;
      loadSettings().then(function (settings) {
        var line = activeTab.url.split('?')[0] + '*';
        settings.excludePatterns = settings.excludePatterns ? settings.excludePatterns + '\n' + line : line;
        chrome.storage.local.set({ settings: settings }).then(function () {
          excludeSiteBtn.textContent = '已排除，刷新页面生效';
          excludeSiteBtn.disabled = true;
        });
      });
    });

    optionsBtn.addEventListener('click', function () {
      chrome.runtime.openOptionsPage();
    });
  }

  init();
})();
