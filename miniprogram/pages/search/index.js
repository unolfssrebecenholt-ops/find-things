const storage = require('../../services/storage');
const search = require('../../services/search');

function getUserData() {
  if (typeof storage.removeDemoData === 'function') {
    storage.removeDemoData();
  }
  return {
    containers: typeof storage.listUserContainers === 'function' ? storage.listUserContainers() : storage.listContainers(),
    items: typeof storage.listUserItems === 'function' ? storage.listUserItems() : storage.listItems()
  };
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

  onLoad() {
    this.refreshExamples();
  },

  onShow() {
    this.refreshExamples();
  },

  refreshExamples() {
    const data = getUserData();
    this.setData({
      examples: buildExamples(data.items)
    });
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
    const data = getUserData();
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
  },

  openResult(event) {
    const id = event.detail.containerId;
    if (!id) return;
    wx.navigateTo({ url: `/pages/container/detail?id=${id}` });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/index' });
  },

  showContainers() {
    wx.navigateTo({ url: '/pages/container/list' });
  }
});
