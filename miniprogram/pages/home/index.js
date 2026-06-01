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
  return createXiaolanReminderSummary(notices);
}

function reminderName(notice) {
  const name = notice && (notice.displayName || notice.name || notice.itemName);
  return name || '有件物品';
}

function firstText(values) {
  const list = Array.isArray(values) ? values : [values];
  for (let index = 0; index < list.length; index += 1) {
    const value = list[index];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function createXiaolanReminderSummary(notices) {
  const list = (notices || []).filter(Boolean);
  if (!list.length) return '';
  const names = list.slice(0, 3).map(reminderName).join('、');
  const remaining = Math.max(0, list.length - 3);
  return remaining > 0
    ? `${names}要到期啦，另外还有 ${remaining} 件也快到期啦。`
    : `${names}要到期啦。`;
}

function toTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatDate(timestamp) {
  const value = toTimestamp(timestamp);
  if (!value) return '未设置日期';
  return new Date(value + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function remainingDaysText(expiresAt, now) {
  const expiry = toTimestamp(expiresAt);
  if (!expiry) return '';
  const dayMs = 24 * 60 * 60 * 1000;
  const beijingOffset = 8 * 60 * 60 * 1000;
  const today = Math.floor((toTimestamp(now) + beijingOffset) / dayMs);
  const expiryDay = Math.floor((expiry + beijingOffset) / dayMs);
  const days = expiryDay - today;
  if (days < 0) return `已过期 ${Math.abs(days)} 天`;
  if (days === 0) return '今天到期';
  return `还有 ${days} 天`;
}

function detailImagePath(notice) {
  return (notice && (
    notice.thumbFileId
    || notice.sourceImageThumbFileId
    || notice.contentThumbFileId
    || notice.imagePath
    || notice.photo
    || notice.coverPhoto
    || notice.sourceImageFileId
    || notice.contentImageFileId
  )) || '';
}

function containerText(notice) {
  const location = notice && (notice.containerLocation || notice.locationPath || notice.locationText);
  const name = notice && (notice.containerName || notice.boxName);
  return [location, name].filter(Boolean).join(' / ') || '未填写位置';
}

function mapById(records) {
  return (records || []).reduce((map, record) => {
    if (record && record._id) map[record._id] = record;
    return map;
  }, {});
}

function itemContainerId(item) {
  return firstText([
    item && item.containerId,
    item && item.parentId,
    item && item.container_id
  ]);
}

function imageFileId(image) {
  return firstText([
    image && image.fileId,
    image && image.fileID,
    image && image.imageFileId,
    image && image.imagePath
  ]);
}

function imageThumbFileId(image) {
  return firstText([
    image && image.thumbFileId,
    image && image.thumbnailFileId,
    image && image.previewFileId
  ]);
}

function findSourceImage(item, container) {
  const images = (container && container.contentImages) || [];
  const sourceImageId = firstText([
    item && item.sourceImageId,
    item && item.imageId,
    item && item.image_id
  ]);
  const sourceImageFileId = firstText([
    item && item.sourceImageFileId,
    item && item.imageFileId,
    item && item.imagePath
  ]);
  return images.find((image) => sourceImageId && image && image.imageId === sourceImageId)
    || images.find((image) => sourceImageFileId && imageFileId(image) === sourceImageFileId)
    || null;
}

function findNoticeItem(notice, itemsById, items) {
  const itemId = firstText(notice && notice.itemId);
  if (itemId && itemsById[itemId]) return itemsById[itemId];
  const name = firstText(notice && [notice.displayName, notice.name, notice.itemName]);
  const remindAt = toTimestamp(notice && notice.remindAt);
  return (items || []).find((item) => (
    name
    && reminderName(item) === name
    && (!remindAt || toTimestamp(item && item.remindAt) === remindAt)
  )) || null;
}

function findNoticeContainer(notice, item, containersById) {
  const containerId = firstText([
    notice && notice.containerId,
    itemContainerId(item)
  ]);
  return containerId ? containersById[containerId] || null : null;
}

function enrichReminderNotice(notice, itemsById, containersById, items) {
  const item = findNoticeItem(notice, itemsById, items);
  const container = findNoticeContainer(notice, item, containersById);
  const sourceImage = findSourceImage(item, container);
  const containerPreview = getContainerPreview(container || {});
  const thumbFileId = firstText([
    notice && notice.thumbFileId,
    notice && notice.sourceImageThumbFileId,
    item && item.thumbFileId,
    item && item.sourceImageThumbFileId,
    imageThumbFileId(sourceImage),
    container && container.contentThumbFileId,
    containerPreview.thumb
  ]);
  const sourceImageFileId = firstText([
    notice && notice.sourceImageFileId,
    notice && notice.contentImageFileId,
    item && item.sourceImageFileId,
    item && item.imagePath,
    imageFileId(sourceImage),
    container && container.contentImageFileId,
    containerPreview.original
  ]);
  return Object.assign({}, notice, {
    displayName: firstText([
      notice && notice.displayName,
      item && item.displayName,
      item && item.name
    ]) || reminderName(notice),
    containerName: firstText([
      notice && notice.containerName,
      notice && notice.boxName,
      item && item.containerName,
      container && container.name
    ]),
    locationPath: firstText([
      notice && notice.locationPath,
      notice && notice.containerLocation,
      container && container.locationPath
    ]),
    locationText: firstText([
      notice && notice.locationText,
      item && item.locationText,
      item && item.relativePosition
    ]),
    thumbFileId,
    sourceImageFileId,
    contentThumbFileId: firstText([
      notice && notice.contentThumbFileId,
      container && container.contentThumbFileId
    ]),
    contentImageFileId: firstText([
      notice && notice.contentImageFileId,
      container && container.contentImageFileId
    ])
  });
}

function enrichReminderNotices(notices, items, containers) {
  const itemsById = mapById(items);
  const containersById = mapById(containers);
  return (notices || []).map((notice) => enrichReminderNotice(notice, itemsById, containersById, items || []));
}

function createReminderDetails(notices, now) {
  const timestamp = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  return (notices || []).filter(Boolean).map((notice) => Object.assign({}, notice, {
    displayName: reminderName(notice),
    imagePath: detailImagePath(notice),
    hasImage: !!detailImagePath(notice),
    showImagePlaceholder: !detailImagePath(notice),
    containerText: containerText(notice),
    expiryDateText: formatDate(notice.expiresAt || notice.remindAt),
    remainingDaysText: remainingDaysText(notice.expiresAt || notice.remindAt, timestamp)
  }));
}

function collectReminderImagePaths(details) {
  return (details || []).map((detail) => detail && detail.imagePath).filter(Boolean);
}

function resolveReminderDetails(details) {
  const paths = collectReminderImagePaths(details);
  if (!imageDisplay.hasResolvablePath(paths)) return Promise.resolve(details || []);
  return imageDisplay.resolveImagePaths(paths).then((resolvedPaths) => (
    (details || []).map((detail) => {
      const imagePath = imageDisplay.pickDisplayPath([detail.imagePath], resolvedPaths);
      return Object.assign({}, detail, {
        imagePath,
        hasImage: !!imagePath,
        showImagePlaceholder: !imagePath
      });
    })
  ));
}

Page({
  data: {
    recentContainers: [],
    hasRecentContainers: false,
    showEmptyRecentContainers: true,
    expiryReminderCount: 0,
    expiryReminderNotices: [],
    expiryReminderDetails: [],
    expiryReminderPreview: '',
    showExpiryReminderEntry: false,
    showExpiryReminderPanel: false
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
      .then(({ containers, items, visibleContainers, recentContainers, expiryReminderNotices }) => {
        const enrichedNotices = enrichReminderNotices(expiryReminderNotices, items, containers);
        const details = createReminderDetails(enrichedNotices);
        return resolveReminderDetails(details).then((expiryReminderDetails) => {
          this.setData({
            recentContainers,
            hasRecentContainers: recentContainers.length > 0,
            showEmptyRecentContainers: recentContainers.length === 0,
            expiryReminderNotices: enrichedNotices,
            expiryReminderDetails,
            expiryReminderPreview: reminderPreview(enrichedNotices),
            expiryReminderCount: enrichedNotices.length,
            showExpiryReminderEntry: enrichedNotices.length > 0
          });
          this.ensureRecentThumbnails(visibleContainers);
        });
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
    const details = createReminderDetails(notices);
    return resolveReminderDetails(details).then((expiryReminderDetails) => this.setData({
      expiryReminderDetails,
      showExpiryReminderPanel: true
    }));
  },

  closeExpiryReminderDetails() {
    this.setData({ showExpiryReminderPanel: false });
  },

  confirmExpiryReminderDetails() {
    const wxAdapter = wx;
    const notices = this.data.expiryReminderNotices || [];
    const service = getStorageService();
    return markExpiryRemindersRead(service, notices)
      .then(() => {
        this.setData({
          expiryReminderNotices: [],
          expiryReminderDetails: [],
          expiryReminderPreview: '',
          expiryReminderCount: 0,
          showExpiryReminderEntry: false,
          showExpiryReminderPanel: false
        });
        wxAdapter.showToast({ title: '小懒先帮你收起啦', icon: 'none' });
        this.load();
      })
      .catch((error) => {
        wxAdapter.showToast({
          title: error && error.message ? error.message : '数据同步失败',
          icon: 'none'
        });
      });
  },

  openContainer(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || id === 'demo_container') return;
    wx.navigateTo({ url: `/pages/container/detail?id=${id}` });
  }
});
