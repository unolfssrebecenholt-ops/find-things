let storageService = null;
const { isMockAssetPath } = require('../../utils/mock-assets');
const { getContainerPreview } = require('../../utils/image-preview');
const imageThumbs = require('../../services/image-thumbs');
const imageDisplay = require('../../services/image-display');
const { navigateHome } = require('../../utils/navigation');

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

function showDataError(error) {
  wx.showToast({
    title: error && error.message ? error.message : '数据同步失败',
    icon: 'none'
  });
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
  const preview = getContainerPreview(container);
  const coverPhoto = container.coverPhoto || preview.display || preview.original || '';
  const hasCoverPhoto = !!coverPhoto && !isMockAssetPath(coverPhoto);
  return Object.assign({}, container, {
    coverPhoto: hasCoverPhoto ? coverPhoto : '',
    showPlaceholder: !hasCoverPhoto,
    displayLocation: container.locationPath || '未填写位置',
    displayStatus: getContainerStatus(container, Number(index) || 0)
  });
}

function collectContainerPreviewPaths(containers) {
  return (containers || []).reduce((paths, container) => {
    const preview = getContainerPreview(container);
    paths.push(preview.display);
    paths.push(preview.original);
    return paths;
  }, []).filter(Boolean);
}

function createContainerViewModels(containers) {
  const paths = collectContainerPreviewPaths(containers);
  if (!imageDisplay.hasResolvablePath(paths)) {
    return (containers || []).map(createContainerViewModel);
  }
  return imageDisplay.resolveImagePaths(paths)
    .then((resolvedPaths) => (containers || []).map((container, index) => {
      const preview = getContainerPreview(container);
      const displayPath = imageDisplay.pickDisplayPath([preview.display, preview.original], resolvedPaths);
      return createContainerViewModel(Object.assign({}, container, { coverPhoto: displayPath }), index);
    }));
}

Page({
  data: {
    recentContainers: [],
    hasRecentContainers: false,
    showEmptyRecentContainers: true
  },

  onShow() {
    this.load();
  },

  load() {
    const service = getStorageService();
    const useDatabase = service && typeof service.isDatabaseAvailable === 'function' && service.isDatabaseAvailable();
    const loadData = useDatabase && typeof service.removeDemoDataAsync === 'function'
      ? service.removeDemoDataAsync().then(() => service.listUserContainersAsync())
      : Promise.resolve(service
        ? (typeof service.listUserContainers === 'function' ? service.listUserContainers() : service.listContainers())
        : []);

    loadData
      .then((containers) => {
        const visibleContainers = containers.slice(0, 4);
        const rendered = createContainerViewModels(visibleContainers);
        const apply = (recentContainers) => ({
          containers,
          visibleContainers,
          recentContainers
        });
        return rendered && typeof rendered.then === 'function'
          ? rendered.then(apply)
          : apply(rendered);
      })
      .then(({ visibleContainers, recentContainers }) => {
        this.setData({
          recentContainers,
          hasRecentContainers: recentContainers.length > 0,
          showEmptyRecentContainers: recentContainers.length === 0
        });
        this.ensureRecentThumbnails(visibleContainers);
      })
      .catch(showDataError);
  },

  ensureRecentThumbnails(containers) {
    if (this.thumbnailRefreshPending) return;
    this.thumbnailRefreshPending = true;
    imageThumbs.ensureContainerThumbnails(containers, { limit: 4 })
      .then((changed) => {
        if (changed) this.load();
      })
      .finally(() => {
        this.thumbnailRefreshPending = false;
      });
  },

  goCapture() {
    wx.navigateTo({ url: '/pages/capture/index' });
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/index' });
  },

  goHome() {
    navigateHome();
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
