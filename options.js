(function () {
  'use strict';

  var hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  var APG = window.__APG_COMMON__;
  var DEFAULTS = APG.DEFAULT_SETTINGS;

  var els = {
    globalEnabled: document.getElementById('globalEnabled'),
    excludePatterns: document.getElementById('excludePatterns'),
    saveExclude: document.getElementById('saveExclude'),
    saveExcludeStatus: document.getElementById('saveExcludeStatus'),
    distance: document.getElementById('distance'),
    openInNewTab: document.getElementById('openInNewTab'),
    fixScrollOver: document.getElementById('fixScrollOver'),
    suppressSiteinfoSinglePost: document.getElementById('suppressSiteinfoSinglePost'),
    usePrefetch: document.getElementById('usePrefetch'),
    iconOpacity: document.getElementById('iconOpacity'),
    iconOpacityVal: document.getElementById('iconOpacityVal'),
    iconSize: document.getElementById('iconSize'),
    iconSizeVal: document.getElementById('iconSizeVal'),
    disablePageSeparator: document.getElementById('disablePageSeparator'),
    disableContextMenu: document.getElementById('disableContextMenu'),
    markLoadedLinks: document.getElementById('markLoadedLinks'),
    updateSiteinfo: document.getElementById('updateSiteinfo'),
    siteinfoStatus: document.getElementById('siteinfoStatus'),
    exportSettings: document.getElementById('exportSettings'),
    importSettingsBtn: document.getElementById('importSettingsBtn'),
    importSettingsFile: document.getElementById('importSettingsFile'),
    resetSettings: document.getElementById('resetSettings'),
    dataStatus: document.getElementById('dataStatus')
  };

  function getStorage(keys) {
    if (!hasChrome) return Promise.resolve({});
    return chrome.storage.local.get(keys);
  }

  function setStorage(obj) {
    if (!hasChrome) return Promise.resolve();
    return chrome.storage.local.set(obj);
  }

  function loadSettings() {
    return getStorage(['settings']).then(function (res) {
      return Object.assign({}, DEFAULTS, res.settings || {});
    });
  }

  function saveSettings(settings) {
    return setStorage({ settings: settings });
  }

  function currentFormSettings(base) {
    var s = Object.assign({}, base);
    s.enabled = els.globalEnabled.checked;
    s.excludePatterns = els.excludePatterns.value;
    s.distance = parseInt(els.distance.value, 10) || DEFAULTS.distance;
    s.openInNewTab = els.openInNewTab.checked;
    s.fixScrollOver = els.fixScrollOver.checked;
    s.suppressSiteinfoSinglePost = els.suppressSiteinfoSinglePost.checked;
    s.usePrefetch = els.usePrefetch.checked;
    var radio = document.querySelector('input[name="iconVisibility"]:checked');
    s.iconVisibility = radio ? radio.value : DEFAULTS.iconVisibility;
    s.iconOpacity = parseFloat(els.iconOpacity.value);
    s.iconSize = parseInt(els.iconSize.value, 10) || DEFAULTS.iconSize;
    s.disablePageSeparator = els.disablePageSeparator.checked;
    s.disableContextMenu = els.disableContextMenu.checked;
    s.markLoadedLinks = els.markLoadedLinks.checked;
    return s;
  }

  function populateForm(settings) {
    els.globalEnabled.checked = !!settings.enabled;
    els.excludePatterns.value = settings.excludePatterns || '';
    els.distance.value = settings.distance;
    els.openInNewTab.checked = !!settings.openInNewTab;
    els.fixScrollOver.checked = !!settings.fixScrollOver;
    els.suppressSiteinfoSinglePost.checked = !!settings.suppressSiteinfoSinglePost;
    els.usePrefetch.checked = !!settings.usePrefetch;
    var radio = document.querySelector('input[name="iconVisibility"][value="' + settings.iconVisibility + '"]');
    if (radio) radio.checked = true;
    els.iconOpacity.value = settings.iconOpacity;
    els.iconOpacityVal.textContent = settings.iconOpacity;
    els.iconSize.value = settings.iconSize;
    els.iconSizeVal.textContent = settings.iconSize;
    els.disablePageSeparator.checked = !!settings.disablePageSeparator;
    els.disableContextMenu.checked = !!settings.disableContextMenu;
    els.markLoadedLinks.checked = !!settings.markLoadedLinks;
  }

  function flashStatus(el, text, type, ms) {
    el.textContent = text;
    el.classList.remove('success', 'error');
    if (type) el.classList.add(type);
    if (ms) {
      setTimeout(function () {
        if (el.textContent === text) { el.textContent = ''; el.classList.remove('success', 'error'); }
      }, ms);
    }
  }

  function formatDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    function pad(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function autoSave() {
    loadSettings().then(function (base) {
      var s = currentFormSettings(base);
      saveSettings(s);
    });
  }

  function refreshSiteinfoStatus() {
    getStorage(['siteinfoLastUpdated', 'siteinfoList']).then(function (res) {
      var count = res.siteinfoList ? res.siteinfoList.length : 0;
      els.siteinfoStatus.textContent = '上次更新：' + formatDate(res.siteinfoLastUpdated) +
        (count ? '　·　共 ' + count + ' 条规则' : '');
    });
  }

  function initScrollSpy() {
    var navItems = Array.prototype.slice.call(document.querySelectorAll('.nav-item'));
    var sections = navItems.map(function (item) {
      return document.getElementById(item.dataset.target);
    });

    navItems.forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.preventDefault();
        var target = document.getElementById(item.dataset.target);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    function setActive() {
      var scrollPos = window.scrollY + 90;
      var activeIndex = 0;
      sections.forEach(function (sec, i) {
        if (sec && sec.offsetTop <= scrollPos) activeIndex = i;
      });
      navItems.forEach(function (item, i) {
        item.classList.toggle('active', i === activeIndex);
      });
    }

    window.addEventListener('scroll', setActive, { passive: true });
    setActive();
  }

  function init() {
    loadSettings().then(populateForm);
    refreshSiteinfoStatus();
    initScrollSpy();

    els.globalEnabled.addEventListener('change', autoSave);

    els.saveExclude.addEventListener('click', function () {
      loadSettings().then(function (base) {
        var s = Object.assign({}, base, { excludePatterns: els.excludePatterns.value });
        saveSettings(s).then(function () {
          flashStatus(els.saveExcludeStatus, '已保存', 'success', 1800);
        });
      });
    });

    var autoSaveInputs = [
      els.distance, els.openInNewTab, els.fixScrollOver, els.suppressSiteinfoSinglePost,
      els.usePrefetch, els.disablePageSeparator, els.disableContextMenu, els.markLoadedLinks
    ];
    autoSaveInputs.forEach(function (el) {
      el.addEventListener('change', autoSave);
    });

    document.querySelectorAll('input[name="iconVisibility"]').forEach(function (r) {
      r.addEventListener('change', autoSave);
    });

    els.iconOpacity.addEventListener('input', function () {
      els.iconOpacityVal.textContent = els.iconOpacity.value;
    });
    els.iconOpacity.addEventListener('change', autoSave);

    els.iconSize.addEventListener('input', function () {
      els.iconSizeVal.textContent = els.iconSize.value;
    });
    els.iconSize.addEventListener('change', autoSave);

    els.updateSiteinfo.addEventListener('click', function () {
      els.updateSiteinfo.disabled = true;
      var prevText = els.updateSiteinfo.textContent;
      els.updateSiteinfo.textContent = '正在更新…';
      var done = function (res) {
        els.updateSiteinfo.disabled = false;
        els.updateSiteinfo.textContent = prevText;
        if (res && res.ok) {
          els.siteinfoStatus.textContent = '上次更新：' + formatDate(res.lastUpdated) + '　·　共 ' + res.count + ' 条规则';
        } else {
          els.siteinfoStatus.textContent = '更新失败' + (res && res.error ? '：' + res.error : '');
        }
      };
      if (hasChrome) {
        chrome.runtime.sendMessage({ type: 'UPDATE_SITEINFO' }).then(done).catch(function (e) { done({ ok: false, error: String(e) }); });
      } else {
        done({ ok: false, error: '未在扩展环境中运行' });
      }
    });

    els.exportSettings.addEventListener('click', function () {
      loadSettings().then(function (settings) {
        var blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'autopager-settings.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        flashStatus(els.dataStatus, '已导出设置文件', 'success', 1800);
      });
    });

    els.importSettingsBtn.addEventListener('click', function () {
      els.importSettingsFile.click();
    });

    els.importSettingsFile.addEventListener('change', function () {
      var file = els.importSettingsFile.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var imported = JSON.parse(reader.result);
          var merged = Object.assign({}, DEFAULTS, imported);
          saveSettings(merged).then(function () {
            populateForm(merged);
            flashStatus(els.dataStatus, '已导入设置', 'success', 1800);
          });
        } catch (e) {
          flashStatus(els.dataStatus, '文件格式不正确', 'error', 2200);
        }
      };
      reader.readAsText(file);
      els.importSettingsFile.value = '';
    });

    els.resetSettings.addEventListener('click', function () {
      if (!confirm('确定要将所有 AutoPager 设置恢复为默认值吗？')) return;
      saveSettings(Object.assign({}, DEFAULTS)).then(function () {
        populateForm(DEFAULTS);
        flashStatus(els.dataStatus, '已恢复默认设置', 'success', 1800);
      });
    });
  }

  init();
})();
