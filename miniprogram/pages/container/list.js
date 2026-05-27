const storage = require('../../services/storage');
const { isMockAssetPath } = require('../../utils/mock-assets');
const { navigateHome } = require('../../utils/navigation');

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
    this.load();
  },

  load() {
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

  showContainerActions(event) {
    const { id, name } = event.currentTarget.dataset;
    if (!id) return;

    if (wx.showActionSheet) {
      wx.showActionSheet({
        itemList: ['删除容器'],
        itemColor: '#a33b2f',
        success: (result) => {
          if (result.tapIndex !== 0) return;
          this.confirmDeleteContainer(id, name);
        }
      });
      return;
    }

    this.confirmDeleteContainer(id, name);
  },

  confirmDeleteContainer(id, name) {
    wx.showModal({
      title: '删除容器',
      content: `确定删除「${name || '这个容器'}」吗？删除后，本地搜索不会再显示这个容器里的物品。`,
      confirmText: '删除',
      confirmColor: '#a33b2f',
      success: (result) => {
        if (!result.confirm) return;
        storage.deleteContainer(id);
        wx.showToast({ title: '已删除', icon: 'success' });
        this.load();
      }
    });
  },

  goHome() {
    navigateHome();
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/index' });
  },

  goCapture() {
    wx.navigateTo({ url: '/pages/capture/index' });
  }
});
