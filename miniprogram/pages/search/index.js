const storage = require('../../services/storage');
const search = require('../../services/search');
const imageThumbs = require('../../services/image-thumbs');
const {
  SEARCH_URL,
  consumeSectionRefresh,
  syncTabBar
} = require('../../utils/navigation');

function getUserData() {
  if (typeof storage.removeDemoData === 'function') {
    storage.removeDemoData();
  }
  return {
    containers: typeof storage.listUserContainers === 'function' ? storage.listUserContainers() : storage.listContainers(),
    items: typeof storage.listUserItems === 'function' ? storage.listUserItems() : storage.listItems()
  };
}

function getUserDataAsync() {
  const useDatabase = typeof storage.isDatabaseAvailable === 'function' && storage.isDatabaseAvailable();
  if (!useDatabase || typeof storage.removeDemoDataAsync !== 'function') {
    return Promise.resolve(getUserData());
  }
  return storage.removeDemoDataAsync().then(() => Promise.all([
    typeof storage.listUserContainersAsync === 'function' ? storage.listUserContainersAsync() : storage.listUserContainers(),
    typeof storage.listUserItemsAsync === 'function' ? storage.listUserItemsAsync() : storage.listUserItems()
  ])).then(([containers, items]) => ({ containers, items }));
}

function showDataError(error) {
  wx.showToast({
    title: error && error.message ? error.message : '数据同步失败',
    icon: 'none'
  });
}

function unique(values) {
  return values.reduce((result, value) => {
    const text = String(value || '').trim();
    if (text && result.indexOf(text) < 0) result.push(text);
    return result;
  }, []);
}

function buildExamples(items) {
  const fromItems = unique((items || []).reduce((values, item) => {
    values.push(item.displayName);
    if (Array.isArray(item.aliases)) values.push(item.aliases[0]);
    if (Array.isArray(item.colors) && item.colors[0] && item.displayName) {
      values.push(`${item.colors[0]}${item.displayName}`);
    }
    return values;
  }, []));
  return fromItems.length ? fromItems.slice(0, 3) : ['书', '钥匙', '纸巾'];
}

Page({
  data: {
    query: '',
    results: [],
    hasResults: false,
    showEmptyResults: false,
    showSearchHint: true,
    searched: false,
    resultHeading: '搜索结果',
    examples: ['书', '钥匙', '纸巾']
  },

  onShow() {
    syncTabBar(this, SEARCH_URL);
    const shouldRefresh = consumeSectionRefresh(SEARCH_URL);
    if (!this.examplesLoaded || shouldRefresh) this.refreshExamples();
  },

  refreshExamples() {
    getUserDataAsync()
      .then((data) => {
        this.setData({
          examples: buildExamples(data.items)
        });
        this.examplesLoaded = true;
      })
      .catch(showDataError);
  },

  inputQuery(event) {
    this.setData({ query: event.detail.value });
  },

  useExample(event) {
    const query = event.currentTarget.dataset.query;
    this.setData({ query });
    this.runSearch(query);
  },

  submitSearch() {
    this.runSearch(this.data.query);
  },

  runSearch(query) {
    const keyword = String(query || '').trim();
    if (!keyword) {
      this.setData({
        query: '',
        results: [],
        hasResults: false,
        showEmptyResults: false,
        showSearchHint: true,
        searched: false,
        resultHeading: '搜索结果'
      });
      return;
    }
    getUserDataAsync()
      .then((data) => {
        const results = search.searchItems(keyword, {
          containers: data.containers,
          items: data.items
        });
        this.setData({
          query: keyword,
          results,
          hasResults: results.length > 0,
          showEmptyResults: results.length === 0,
          showSearchHint: false,
          searched: true,
          resultHeading: results.length ? `找到 ${results.length} 个可能结果` : '搜索结果'
        });
        this.ensureResultThumbnails(results, keyword);
      })
      .catch(showDataError);
  },

  ensureResultThumbnails(results, keyword) {
    if (this.thumbnailRefreshPending) return;
    const containers = (results || []).map((result) => result.container).filter(Boolean);
    if (!containers.length) return;
    this.thumbnailRefreshPending = true;
    imageThumbs.ensureContainerThumbnails(containers, { limit: 8 })
      .then((changed) => {
        if (changed && this.data.query === keyword) {
          this.runSearch(keyword);
        }
      })
      .finally(() => {
        this.thumbnailRefreshPending = false;
      });
  },

  openResult(event) {
    const id = event.detail.containerId;
    if (!id) return;
    wx.navigateTo({ url: `/pages/container/detail?id=${id}` });
  },

  goCapture() {
    wx.navigateTo({ url: '/pages/capture/index' });
  }
});
