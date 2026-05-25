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
  const statusByName = {
    '书桌左侧抽屉': '刚刚更新',
    '卧室 3 号箱': '换季衣物',
    '客厅工具盒': '常用',
    '露营装备袋': '待复核'
  };
  const fallbackStatuses = ['刚刚更新', '换季衣物', '常用', '待复核'];
  return statusByName[container.name] || fallbackStatuses[index % fallbackStatuses.length];
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
    if (service && typeof service.seedDemoData === 'function') {
      service.seedDemoData();
    }
    const recentContainers = service
      ? service.listContainers().slice(0, 4).map(createContainerViewModel)
      : [
          createContainerViewModel({
            _id: 'demo_container',
            name: '示例抽屉',
            locationPath: '卧室 / 书桌',
            itemCount: 4,
            coverImageFileId: ''
          })
        ];

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
    const first = this.data.recentContainers[0];
    if (first && first._id !== 'demo_container') {
      wx.navigateTo({ url: `/pages/container/detail?id=${first._id}` });
      return;
    }
    wx.showToast({ title: '先保存一个容器', icon: 'none' });
  },

  openContainer(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === 'demo_container') return;
    wx.navigateTo({ url: `/pages/container/detail?id=${id}` });
  }
});
