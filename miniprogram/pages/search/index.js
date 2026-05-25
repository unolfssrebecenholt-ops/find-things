const storage = require('../../services/storage');
const search = require('../../services/search');

Page({
  data: {
    query: '',
    results: [],
    hasResults: false,
    showEmptyResults: false,
    showSearchHint: true,
    searched: false,
    resultHeading: '搜索结果',
    examples: ['书', '黑色笔', '蓝色发卡']
  },

  onLoad() {
    storage.seedDemoData();
    this.runSearch('蓝色封面的书');
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
    const results = search.searchItems(query, {
      containers: storage.listContainers(),
      items: storage.listItems()
    });
    this.setData({
      query,
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
    const first = storage.listContainers()[0];
    if (first) {
      wx.navigateTo({ url: `/pages/container/detail?id=${first._id}` });
      return;
    }
    wx.showToast({ title: '先保存一个容器', icon: 'none' });
  }
});
