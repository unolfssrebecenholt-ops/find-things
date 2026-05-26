const storage = require('../../services/storage');
const { isMockAssetPath } = require('../../utils/mock-assets');

function createContainerViewModel(container) {
  const coverPhoto = container.coverImageFileId || container.contentImageFileId || '';
  const hasCoverPhoto = !!coverPhoto && !isMockAssetPath(coverPhoto);
  return Object.assign({}, container, {
    coverPhoto: hasCoverPhoto ? coverPhoto : '',
    showPlaceholder: !hasCoverPhoto,
    displayLocation: container.locationPath || '未填写位置',
    imageCount: (container.contentImages || []).length
  });
}

function getUserContainers() {
  if (typeof storage.removeDemoData === 'function') {
    storage.removeDemoData();
  }
  const containers = typeof storage.listUserContainers === 'function'
    ? storage.listUserContainers()
    : storage.listContainers();
  return containers.map(createContainerViewModel);
}

Page({
  data: {
    containers: [],
    hasContainers: false,
    showEmpty: true
  },

  onShow() {
    const containers = getUserContainers();
    this.setData({
      containers,
      hasContainers: containers.length > 0,
      showEmpty: containers.length === 0
    });
  },

  openContainer(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/container/detail?id=${id}` });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/home/index' });
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/index' });
  },

  goCapture() {
    wx.navigateTo({ url: '/pages/capture/index' });
  }
});
