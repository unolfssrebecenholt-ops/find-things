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

function markExpiryRemindersRead(service, notices) {
  const targetNotices = (notices || []).filter((notice) => notice && notice._id);
  if (!service || targetNotices.length === 0) return Promise.resolve();
  const markRead = typeof service.markReminderNoticeReadAsync === 'function'
    ? service.markReminderNoticeReadAsync.bind(service)
    : typeof service.markReminderNoticeRead === 'function'
      ? (noticeId, timestamp) => Promise.resolve(service.markReminderNoticeRead(noticeId, timestamp))
      : null;
  if (!markRead) return Promise.resolve();

  const readAt = Date.now();
  return Promise.all(targetNotices.map((notice) => markRead(notice._id, readAt)));
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

function listReminderNotices(service, useDatabase) {
  if (!service) return Promise.resolve([]);
  if (useDatabase && typeof service.listPendingReminderNoticesAsync === 'function') {
    return service.listPendingReminderNoticesAsync();
  }
  if (typeof service.listPendingReminderNotices === 'function') {
    return Promise.resolve(service.listPendingReminderNotices());
  }
  return Promise.resolve([]);
}

function triggerExpiryReminderScan(useDatabase) {
  if (!useDatabase || typeof wx === 'undefined' || !wx.cloud || typeof wx.cloud.callFunction !== 'function') {
    return Promise.resolve();
  }
  return wx.cloud.callFunction({
    name: 'ftExpiryReminder',
    data: { now: Date.now() }
  }).catch(() => null);
}

function reminderPreview(notices) {
  const first = (notices || [])[0];
  if (!first) return '';
  return first.message || `${first.displayName || first.name || '物品'} 已过期，请及时处理。`;
}

Page({
  data: {
    recentContainers: [],
    hasRecentContainers: false,
    showEmptyRecentContainers: true,
    expiryReminderCount: 0,
    expiryReminderNotices: [],
    expiryReminderPreview: '',
    showExpiryReminderEntry: false
  },

  onShow() {
    this.load();
  },

  load() {
    const service = getStorageService();
    const useDatabase = service && typeof service.isDatabaseAvailable === 'function' && service.isDatabaseAvailable();
    const loadData = useDatabase && typeof service.removeDemoDataAsync === 'function'
      ? service.removeDemoDataAsync().then(() => triggerExpiryReminderScan(true)).then(() => {
        if (service && typeof service.loadFromDatabase === 'function') return service.loadFromDatabase();
        return null;
      }).then(() => Promise.all([
        service.listUserContainersAsync(),
        typeof service.listUserItemsAsync === 'function' ? service.listUserItemsAsync() : [],
        listReminderNotices(service, true)
      ]))
      : Promise.resolve([
          service
            ? (typeof service.listUserContainers === 'function' ? service.listUserContainers() : service.listContainers())
            : [],
          service
            ? (typeof service.listUserItems === 'function' ? service.listUserItems() : [])
            : [],
          service && typeof service.listPendingReminderNotices === 'function'
            ? service.listPendingReminderNotices()
            : []
        ]);

    return loadData
      .then(([containers, items, reminderNotices]) => {
        const visibleContainers = containers.slice(0, 4);
        const rendered = createContainerViewModels(visibleContainers);
        const apply = (recentContainers) => ({
          containers,
          visibleContainers,
          recentContainers,
          expiryReminderNotices: reminderNotices || []
        });
        return rendered && typeof rendered.then === 'function'
          ? rendered.then(apply)
          : apply(rendered);
      })
      .then(({ visibleContainers, recentContainers, expiryReminderNotices }) => {
        this.setData({
          recentContainers,
          hasRecentContainers: recentContainers.length > 0,
          showEmptyRecentContainers: recentContainers.length === 0,
          expiryReminderNotices,
          expiryReminderPreview: reminderPreview(expiryReminderNotices),
          expiryReminderCount: expiryReminderNotices.length,
          showExpiryReminderEntry: expiryReminderNotices.length > 0
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

  openExpiryReminders() {
    const notices = this.data.expiryReminderNotices || [];
    const messages = notices.slice(0, 3).map((notice) => notice.message || `${notice.displayName || notice.name || '物品'} 已过期，请及时处理。`);
    wx.showModal({
      title: '到期提醒',
      content: messages.length ? messages.join('、') : '暂无需要处理的到期提醒',
      showCancel: false,
      confirmColor: '#1f6048',
      success: (result) => {
        if (!result || !result.confirm) return;
        const service = getStorageService();
        markExpiryRemindersRead(service, notices)
          .then(() => {
            this.setData({
              expiryReminderNotices: [],
              expiryReminderPreview: '',
              expiryReminderCount: 0,
              showExpiryReminderEntry: false
            });
            this.load();
          })
          .catch(showDataError);
      }
    });
  },

  openContainer(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === 'demo_container') return;
    wx.navigateTo({ url: `/pages/container/detail?id=${id}` });
  }
});
