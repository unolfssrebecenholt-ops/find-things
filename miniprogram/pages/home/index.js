let storageService = null;
const { isMockAssetPath } = require('../../utils/mock-assets');

function getStorageService() {
  if (!storageService) {
    try {
      storageService = require('../../services/storage');
    } catch (error) {
      storageService = null;
    }
  }
  return storageService;
}

function getContainerStatus(container, index) {
  const updatedAt = Number(container.updatedAt) || 0;
  if (!updatedAt) return index === 0 ? '已保存' : '已整理';
  const delta = Date.now() - updatedAt;
  if (delta < 60 * 60 * 1000) return '刚刚更新';
  if (delta < 24 * 60 * 60 * 1000) return '今天更新';
  return '已保存';
}

function createContainerViewModel(container, index) {
  const coverPhoto = container.coverImageFileId || container.contentImageFileId || '';
  const hasCoverPhoto = !!coverPhoto && !isMockAssetPath(coverPhoto);
  return Object.assign({}, container, {
    coverPhoto: hasCoverPhoto ? coverPhoto : '',
    showPlaceholder: !hasCoverPhoto,
    displayLocation: container.locationPath || '未填写位置',
    displayStatus: getContainerStatus(container, Number(index) || 0)
  });
}

Page({
  data: {
    recentContainers: [],
    hasRecentContainers: false,
    showEmptyRecentContainers: true
  },

  onShow() {
    const service = getStorageService();
    if (service && typeof service.removeDemoData === 'function') {
      service.removeDemoData();
    }
    const containers = service
      ? (typeof service.listUserContainers === 'function' ? service.listUserContainers() : service.listContainers())
      : [];
    const recentContainers = containers.slice(0, 4).map(createContainerViewModel);

    this.setData({
      recentContainers,
      hasRecentContainers: recentContainers.length > 0,
      showEmptyRecentContainers: recentContainers.length === 0
    });
  },

  goCapture() {
    wx.navigateTo({ url: '/pages/capture/index' });
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/index' });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/index' });
  },

  showContainers() {
    wx.navigateTo({ url: '/pages/container/list' });
  },

  openContainer(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === 'demo_container') return;
    wx.navigateTo({ url: `/pages/container/detail?id=${id}` });
  }
});
