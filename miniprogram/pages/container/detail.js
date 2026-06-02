const ai = require('../../services/ai');
const imageDisplay = require('../../services/image-display');
const imageStore = require('../../services/image-store');
const storage = require('../../services/storage');
const { withDisplayIndexes } = require('../../utils/geometry');
const {
  HOME_URL,
  SEARCH_URL,
  navigateHome,
  switchSection
} = require('../../utils/navigation');
const { createImageMetadata } = require('../../utils/image-metadata');

const CONTENT_IMAGE_LIMIT = storage.CONTENT_IMAGE_LIMIT || 5;
let expiryReminder = null;
try {
  expiryReminder = require('../../services/expiry-reminder');
} catch (error) {
  expiryReminder = null;
}

function getChosenPath(result) {
  if (result && result.tempFiles && result.tempFiles[0]) {
    return result.tempFiles[0].tempFilePath;
  }
  if (result && result.tempFilePaths && result.tempFilePaths[0]) {
    return result.tempFilePaths[0];
  }
  return '';
}

function createUsageLimitMessage(status) {
  const message = status && status.errorMessage ? status.errorMessage : '今日识别次数已用完，请明天再试';
  const remaining = Number(status && status.remainingToday);
  const limit = Number(status && status.dailyAnalyzeLimit);
  if (Number.isFinite(remaining) && Number.isFinite(limit)) {
    return `${message}\n今日剩余 ${remaining}/${limit} 次`;
  }
  return message;
}

function showUsageLimit(status) {
  wx.showModal({
    title: status && status.errorCode === 'ANALYZE_DISABLED'
      ? '识别暂时不可用'
      : (status && status.blocked ? '账号暂时不可用' : '今日识别次数已用完'),
    content: createUsageLimitMessage(status),
    showCancel: false,
    confirmColor: '#1f6048'
  });
}

function createImageId(index) {
  return `content_image_${Date.now()}_${index + 1}`;
}

function pickAddedContentImage(result, imageInput, index) {
  if (result && result.image) return result.image;
  if (result && result.contentImage) return result.contentImage;

  const container = result && result.container ? result.container : result;
  const images = container && Array.isArray(container.contentImages) ? container.contentImages : [];
  const matchedById = images.find((image) => image.imageId === imageInput.imageId);
  if (matchedById) return matchedById;
  return images[index] || imageInput;
}

function unique(values) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatExpiryDateValue(value) {
  const expiresAt = toTimestamp(value);
  if (!expiresAt) return '';
  const date = new Date(expiresAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getFallbackExpiryState(item) {
  const expiresAt = toTimestamp(item && item.expiresAt);
  if (!expiresAt) {
    return {
      state: 'none',
      label: ''
    };
  }
  const now = Date.now();
  const remindAt = toTimestamp(item && item.remindAt);
  if (expiresAt < now) {
    return {
      state: 'expired',
      label: '已过期'
    };
  }
  if (remindAt && remindAt <= now) {
    return {
      state: 'expiring',
      label: '即将到期'
    };
  }
  const date = new Date(expiresAt);
  return {
    state: 'normal',
    label: `${date.getMonth() + 1}月${date.getDate()}日到期`
  };
}

function getExpiryState(item) {
  if (expiryReminder && typeof expiryReminder.getExpiryState === 'function') {
    return expiryReminder.getExpiryState(item, Date.now());
  }
  return getFallbackExpiryState(item);
}

function getItemKey(item, index) {
  return String((item && (item.itemKey || item.tempId || item._id)) || `detail_item_${index + 1}`);
}

function createManualItem(image, index) {
  const tempId = `manual_item_${Date.now()}_${index + 1}`;
  const sourceImageIndex = Number.isFinite(image && image.sortOrder) ? image.sortOrder : 0;
  const sourceImageLabel = (image && image.label) || `照片 ${sourceImageIndex + 1}`;
  return {
    tempId,
    displayName: '新物品',
    category: '',
    features: [],
    colors: [],
    aliases: [],
    description: '',
    note: '',
    confidence: 0,
    confirmed: true,
    sourceImageId: (image && image.imageId) || '',
    sourceImageFileId: (image && image.fileId) || '',
    sourceImageIndex,
    sourceImageLabel,
    locationText: sourceImageLabel ? `${sourceImageLabel} · 手动添加` : '手动添加'
  };
}

function stripItemViewFields(item) {
  const value = Object.assign({}, item);
  [
    'itemKey',
    'hasTags',
    'tagList',
    'tagText',
    'featureSummary',
    'displayDescription',
    'confidenceLabel',
    'sourceLabel',
    'stateClass',
    'isExpanded',
    'isCollapsed',
    'showExpandAction',
    'showCollapseAction',
    'showRemoveAction',
    'expandText',
    'expiryLabel',
    'expiryState',
    'hasExpiry',
    'isExpired',
    'isExpiring',
    'expiryDateValue',
    'expiryDateText',
    'editorItems'
  ].forEach((key) => {
    delete value[key];
  });
  return value;
}

function stripImageViewFields(image) {
  const value = Object.assign({}, image);
  delete value.items;
  delete value.displayFileId;
  delete value.displayThumbFileId;
  delete value.displaySrc;
  delete value.refreshingDisplayFileId;
  return value;
}

function normalizeRawItems(items) {
  return withDisplayIndexes(items || []).map((item, index) => {
    const value = stripItemViewFields(item);
    if (!value._id && !value.tempId) {
      value.tempId = getItemKey(item, index);
    }
    return value;
  });
}

function createItemViewModel(item, index, expandedItemKeys) {
  const itemKey = getItemKey(item, index);
  const isExpanded = (expandedItemKeys || []).indexOf(itemKey) >= 0;
  const confidence = Number(item.confidence);
  const fullTagList = unique(asArray(item.colors).concat(asArray(item.features), asArray(item.aliases)));
  const tagList = fullTagList.slice(0, 6);
  const sourceImageIndex = Number(item.sourceImageIndex);
  const fallbackSourceLabel = Number.isFinite(sourceImageIndex) ? `照片 ${sourceImageIndex + 1}` : '清单物品';
  const sourceLabel = item.locationText || item.sourceImageLabel || fallbackSourceLabel;
  const featureSummary = tagList.join(' / ');
  const expiry = getExpiryState(item);
  const expiryDateValue = formatExpiryDateValue(item.expiresAt);
  const viewModel = Object.assign({}, item, {
    itemKey,
    hasTags: tagList.length > 0,
    tagList,
    tagText: fullTagList.join(' '),
    featureSummary,
    displayDescription: item.description || featureSummary || '可以补充位置、外观和用途',
    confidenceLabel: confidence > 0 ? `${Math.round(confidence * 100)}%` : '手动',
    sourceLabel,
    stateClass: isExpanded ? 'expanded' : 'collapsed',
    isExpanded,
    isCollapsed: !isExpanded,
    showExpandAction: !isExpanded,
    showCollapseAction: isExpanded,
    showRemoveAction: isExpanded,
    expandText: isExpanded ? '收起' : '展开',
    expiryLabel: expiry.label,
    expiryState: expiry.state,
    hasExpiry: expiry.state !== 'none',
    isExpired: expiry.state === 'expired',
    isExpiring: expiry.state === 'expiring',
    expiryDateValue,
    expiryDateText: expiryDateValue || '选择日期'
  });
  viewModel.editorItems = [Object.assign({}, viewModel)];
  return viewModel;
}

function getMissingInventoryText(container) {
  const count = Number(container && container.itemCount) || 0;
  return count > 0 ? `历史清单显示有 ${count} 件物品，但明细还没同步回来。` : '';
}

function createContainerViewModel(container) {
  return Object.assign({}, container, {
    displayLocation: container.locationPath || '未填写位置'
  });
}

function collectImagePaths(container, contentImages) {
  const paths = [];
  (contentImages || []).forEach((image) => {
    paths.push(image && image.thumbFileId);
    paths.push(image && image.fileId);
  });
  return paths.filter(Boolean);
}

function applyImageDisplayPaths(container, contentImages, resolvedPaths) {
  const resolved = resolvedPaths || {};
  return {
    container: Object.assign({}, container),
    contentImages: (contentImages || []).map((image) => Object.assign({}, image, {
      displayThumbFileId: resolved[image.thumbFileId] || image.thumbFileId || '',
      displayFileId: resolved[image.fileId] || image.fileId || '',
      displaySrc: resolved[image.fileId] || resolved[image.thumbFileId] || image.fileId || image.thumbFileId || ''
    }))
  };
}

Page({
  data: {
    id: '',
    container: null,
    hasContainer: false,
    showMissingContainer: false,
    rawItems: [],
    items: [],
    hasItems: false,
    showItemsEmpty: true,
    showRecoverInventory: false,
    canRecoverInventory: false,
    missingInventoryText: '',
    expandedItemKeys: [],
    inventoryStatusText: '点开清单可继续修正',
    inventorySaving: false,
    currentItems: [],
    contentImages: [],
    hasContentImages: false,
    showContentEmpty: true,
    currentImageIndex: 0,
    currentPhotoLabel: '照片 1/1',
    addPhotoLabel: '添加照片',
    recognizing: false,
    recognizingDescText: '小懒正在认真扒拉照片，稍等一下下。',
    recognizingHintText: '这会儿适合眨眨眼，别和小懒一起紧张。',
    recognizingProgressCount: 0,
    recognizingProgressText: '正在找线索',
    recognizingProgressStateText: '快啦',
    photoLimit: CONTENT_IMAGE_LIMIT
  },

  onLoad(options) {
    this.setData({ id: options.id || '' });
  },

  onShow() {
    this.load();
  },

  load() {
    const loadContainer = typeof storage.removeDemoDataAsync === 'function'
      ? storage.removeDemoDataAsync().then(() => storage.getContainerAsync(this.data.id))
      : Promise.resolve(storage.getContainer(this.data.id));
    loadContainer
      .then((container) => this.renderContainer(container))
      .catch((error) => {
        wx.showToast({
          title: error && error.message ? error.message : '数据同步失败',
          icon: 'none'
        });
      });
  },

  renderContainer(container) {
    if (!container) {
      this.setData({
        container: null,
        hasContainer: false,
        showMissingContainer: true,
        rawItems: [],
        items: [],
        hasItems: false,
        showItemsEmpty: true,
        showRecoverInventory: false,
        canRecoverInventory: false,
        missingInventoryText: '',
        expandedItemKeys: [],
        inventoryStatusText: '点开清单可继续修正',
        inventorySaving: false,
        currentItems: [],
        contentImages: [],
        hasContentImages: false,
        showContentEmpty: true
      });
      return;
    }

    const loadItems = typeof storage.getItemsByContainerAsync === 'function'
      ? Promise.all([storage.getItemsByContainerAsync(container._id), storage.getContentImagesAsync(container._id)])
      : Promise.resolve([storage.getItemsByContainer(container._id), this.getContentImages(container)]);

    return loadItems
      .then(([items, baseImages]) => {
        const rawItems = normalizeRawItems(items);
        const contentImages = this.decorateContentImages(baseImages, rawItems);
        const showRecoverInventory = rawItems.length === 0 && Number(container.itemCount) > 0;
        const canRecoverInventory = showRecoverInventory && contentImages.length > 0;
        return imageDisplay.resolveImagePaths(collectImagePaths(container, contentImages))
          .then((resolvedPaths) => ({
            rawItems,
            contentImages,
            showRecoverInventory,
            canRecoverInventory,
            displayState: applyImageDisplayPaths(container, contentImages, resolvedPaths)
          }));
      })
      .then(({ rawItems, contentImages, showRecoverInventory, canRecoverInventory, displayState }) => {
        const displayContainer = displayState.container;
        const displayContentImages = displayState.contentImages;

        this.setData({
          container: createContainerViewModel(displayContainer),
          hasContainer: true,
          showMissingContainer: false,
          rawItems,
          items: this.createItemViewModels(rawItems, this.data.expandedItemKeys),
          hasItems: rawItems.length > 0,
          showItemsEmpty: rawItems.length === 0 && !showRecoverInventory,
          showRecoverInventory,
          canRecoverInventory,
          missingInventoryText: getMissingInventoryText(displayContainer),
          contentImages: displayContentImages,
          hasContentImages: displayContentImages.length > 0,
          showContentEmpty: displayContentImages.length === 0,
          inventoryStatusText: '点开清单可继续修正',
          inventorySaving: false
        });
        this.syncCurrentImage(this.data.currentImageIndex);
      })
      .catch((error) => {
        wx.showToast({
          title: error && error.message ? error.message : '数据同步失败',
          icon: 'none'
        });
      });
  },

  getContentImages(container) {
    if (typeof storage.getContentImages === 'function') {
      const images = storage.getContentImages(container._id);
      if (Array.isArray(images) && images.length) return images;
    }
    if (Array.isArray(container.contentImages) && container.contentImages.length) {
      return container.contentImages;
    }
    if (container.contentImageFileId) {
      return [{
        imageId: 'legacy_content_1',
        fileId: container.contentImageFileId,
        thumbFileId: container.contentThumbFileId || '',
        label: '照片 1',
        sortOrder: 0,
        itemCount: container.itemCount || 0
      }];
    }
    return [];
  },

  createItemViewModels(rawItems, expandedItemKeys) {
    return withDisplayIndexes(rawItems || []).map((item, index) => (
      createItemViewModel(item, index, expandedItemKeys)
    ));
  },

  decorateContentImages(baseImages, rawItems) {
    const items = withDisplayIndexes(rawItems || []);
    return (baseImages || []).map((image, index) => {
      const imageItems = items.filter((item) => {
        if (item.sourceImageId && image.imageId) return item.sourceImageId === image.imageId;
        if (item.sourceImageFileId && image.fileId) return item.sourceImageFileId === image.fileId;
        return index === 0;
      });
      return Object.assign({}, image, {
        label: image.label || `照片 ${index + 1}`,
        sortOrder: Number.isFinite(image.sortOrder) ? image.sortOrder : index,
        itemCount: imageItems.length,
        items: withDisplayIndexes(imageItems)
      });
    });
  },

  setInventoryState(rawItems, baseImages, expandedItemKeys, patch) {
    const normalizedItems = normalizeRawItems(rawItems);
    const contentImages = this.decorateContentImages(baseImages || this.data.contentImages, normalizedItems);
    this.setData(Object.assign({
      rawItems: normalizedItems,
      items: this.createItemViewModels(normalizedItems, expandedItemKeys),
      hasItems: normalizedItems.length > 0,
      showItemsEmpty: normalizedItems.length === 0,
      showRecoverInventory: false,
      canRecoverInventory: false,
      missingInventoryText: '',
      expandedItemKeys,
      contentImages,
      hasContentImages: contentImages.length > 0,
      showContentEmpty: contentImages.length === 0
    }, patch || {}));
    this.syncCurrentImage(this.data.currentImageIndex);
  },

  syncCurrentImage(index) {
    const contentImages = this.data.contentImages || [];
    const safeIndex = Math.max(0, Math.min(Number(index) || 0, contentImages.length - 1));
    const image = contentImages[safeIndex] || {};
    const nextPhotoNumber = contentImages.length + 1;
    this.setData({
      currentImageIndex: safeIndex,
      currentItems: image.items || [],
      currentPhotoLabel: `照片 ${safeIndex + 1}/${Math.max(contentImages.length, 1)}`,
      addPhotoLabel: contentImages.length >= CONTENT_IMAGE_LIMIT ? '添加照片' : `加第 ${nextPhotoNumber} 张`
    });
  },

  onSwiperChange(event) {
    this.syncCurrentImage(event.detail.current);
  },

  handleContentImageError(event) {
    const index = Number(event.currentTarget && event.currentTarget.dataset.index);
    if (!Number.isFinite(index)) return;
    const contentImages = this.data.contentImages || [];
    const image = contentImages[index];
    if (!image || image.refreshingDisplayFileId) return;

    const originalPath = image.fileId || image.thumbFileId || '';
    if (!originalPath) return;
    const nextImages = contentImages.map((contentImage, imageIndex) => {
      if (imageIndex !== index) return contentImage;
      return Object.assign({}, contentImage, { refreshingDisplayFileId: true });
    });
    this.setData({ contentImages: nextImages });

    imageDisplay.resolveImagePath(originalPath, { force: true }).then((displayFileId) => {
      const refreshedImages = (this.data.contentImages || []).map((contentImage, imageIndex) => {
        if (imageIndex !== index) return contentImage;
        const nextDisplayFileId = displayFileId || contentImage.fileId || '';
        return Object.assign({}, contentImage, {
          displayFileId: nextDisplayFileId,
          displaySrc: nextDisplayFileId || contentImage.displayThumbFileId || contentImage.thumbFileId || '',
          refreshingDisplayFileId: false
        });
      });
      this.setData({ contentImages: refreshedImages });
      this.syncCurrentImage(this.data.currentImageIndex);
    });
  },

  toggleItemExpanded(event) {
    const itemKey = String(event.currentTarget.dataset.key || '');
    if (!itemKey) return;
    const expandedItemKeys = this.data.expandedItemKeys || [];
    const nextKeys = expandedItemKeys.indexOf(itemKey) >= 0
      ? expandedItemKeys.filter((key) => key !== itemKey)
      : expandedItemKeys.concat(itemKey);
    this.setInventoryState(this.data.rawItems || [], this.data.contentImages || [], nextKeys);
  },

  handleExpandedItemChange(event) {
    const contextKey = String(event.detail.contextKey || '');
    if (!contextKey) return;
    const editedItems = event.detail.items || [];
    const shouldRemove = editedItems.length === 0;
    const nextItems = (this.data.rawItems || []).reduce((items, item, index) => {
      if (getItemKey(item, index) !== contextKey) return items.concat(item);
      if (shouldRemove) return items;
      return items.concat(stripItemViewFields(Object.assign({}, item, editedItems[0])));
    }, []);
    const expandedItemKeys = shouldRemove
      ? (this.data.expandedItemKeys || []).filter((key) => key !== contextKey)
      : (this.data.expandedItemKeys || []);
    this.persistInventory(nextItems, expandedItemKeys, shouldRemove ? '已移除物品' : '已保存修改');
  },

  removeExpandedItem(event) {
    const itemKey = String(event.currentTarget.dataset.key || '');
    if (!itemKey) return;
    wx.showModal({
      title: '移除这件物品？',
      content: '移除后，这件物品不会再出现在搜索结果里。',
      cancelText: '取消',
      confirmText: '移除',
      confirmColor: '#a33b2f',
      success: (result) => {
        if (!result.confirm) return;
        this.removeInventoryItem(itemKey);
      }
    });
  },

  removeInventoryItem(itemKey) {
    const nextItems = (this.data.rawItems || []).filter((item, index) => getItemKey(item, index) !== itemKey);
    const expandedItemKeys = (this.data.expandedItemKeys || []).filter((key) => key !== itemKey);
    this.persistInventory(nextItems, expandedItemKeys, '已移除物品');
  },

  addManualItem() {
    const rawItems = normalizeRawItems(this.data.rawItems || []);
    const contentImages = this.data.contentImages || [];
    const image = contentImages[this.data.currentImageIndex] || contentImages[0] || {};
    const item = createManualItem(image, rawItems.length);
    const expandedItemKeys = (this.data.expandedItemKeys || []).concat(item.tempId);
    this.persistInventory(rawItems.concat(item), expandedItemKeys, '已添加，可继续修改');
  },

  persistInventory(rawItems, expandedItemKeys, doneText) {
    if (!this.data.container || !this.data.container._id) return Promise.resolve();

    const cleanItems = normalizeRawItems(rawItems).map(stripItemViewFields);
    const contentImages = (this.data.contentImages || []).map(stripImageViewFields);
    const saveData = Object.assign({}, this.data.container, {
      contentImages,
      contentImageFileId: contentImages[0] ? contentImages[0].fileId : '',
      contentThumbFileId: contentImages[0] ? (contentImages[0].thumbFileId || '') : '',
      items: cleanItems
    });
    this.inventorySaveVersion = (this.inventorySaveVersion || 0) + 1;
    const saveVersion = this.inventorySaveVersion;

    this.setInventoryState(cleanItems, contentImages, expandedItemKeys, {
      inventoryStatusText: '正在保存...',
      inventorySaving: true
    });

    const runSave = () => {
      const request = typeof storage.saveContainerAsync === 'function'
        ? storage.saveContainerAsync(saveData)
        : Promise.resolve(storage.saveContainer(saveData));
      return request
        .then((saved) => {
          if (saveVersion !== this.inventorySaveVersion) return saved;
          const container = (saved && saved.container) || saveData;
          const items = normalizeRawItems((saved && saved.items) || cleanItems);
          const images = (container.contentImages || contentImages).map(stripImageViewFields);
          this.setInventoryState(items, images, expandedItemKeys, {
            container: createContainerViewModel(container),
            inventoryStatusText: doneText || '已保存修改',
            inventorySaving: false
          });
          return saved;
        })
        .catch((error) => {
          if (saveVersion === this.inventorySaveVersion) {
            this.setData({
              inventoryStatusText: '保存失败，请重试',
              inventorySaving: false
            });
          }
          wx.showToast({
            title: error && error.message ? error.message : '保存失败',
            icon: 'none'
          });
        });
    };

    this.inventorySaveChain = (this.inventorySaveChain || Promise.resolve())
      .catch(() => {})
      .then(runSave);
    return this.inventorySaveChain;
  },

  reRecognizeCurrent() {
    const image = (this.data.contentImages || [])[this.data.currentImageIndex];
    if (!image) return;

    this.showRecognizingLayer('小懒正在重新看这张，旧线索先放一边。');
    const handleProgress = (progress) => this.updateRecognizingProgress(progress);
    ai.analyzeImage({
      imagePath: image.fileId,
      allowMockFallback: false,
      onProgress: handleProgress
    })
      .then((analyzed) => {
        const items = withDisplayIndexes(analyzed.items || []).map((item) => Object.assign({}, item, {
          sourceImageId: image.imageId,
          sourceImageFileId: image.fileId
        }));

        if (typeof storage.replaceItemsForImageAsync === 'function') {
          return storage.replaceItemsForImageAsync(this.data.container._id, image.imageId, items).then(() => {
            wx.showToast({ title: '已重新识别', icon: 'success' });
            this.load();
          });
        }
        if (typeof storage.replaceItemsForImage === 'function') {
          storage.replaceItemsForImage(this.data.container._id, image.imageId, items);
          wx.showToast({ title: '已重新识别', icon: 'success' });
          this.load();
          return;
        }

        wx.showToast({ title: '数据层同步中，暂未保存', icon: 'none' });
        const contentImages = (this.data.contentImages || []).map((contentImage, index) => {
          if (index !== this.data.currentImageIndex) return contentImage;
          return Object.assign({}, contentImage, { items, itemCount: items.length });
        });
        this.setData({
          contentImages,
          hasContentImages: contentImages.length > 0,
          showContentEmpty: contentImages.length === 0
        });
        this.syncCurrentImage(this.data.currentImageIndex);
      })
      .catch((error) => {
        wx.showModal({
          title: '小懒暂时没看清',
          content: error && error.message ? error.message : '请检查识别服务配置、合法域名和网络后重试。',
          showCancel: false,
          confirmColor: '#1f6048'
        });
      })
      .finally(() => {
        this.setData({ recognizing: false });
      });
  },

  recoverInventoryFromPhoto() {
    if (!(this.data.contentImages || []).length) return;
    this.reRecognizeCurrent();
  },

  addContentPhoto() {
    if ((this.data.contentImages || []).length >= CONTENT_IMAGE_LIMIT) {
      wx.showModal({
        title: '照片数量已达上限',
        content: `当前最多可保存 ${CONTENT_IMAGE_LIMIT} 张箱内照片。`,
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#1f6048'
      });
      return;
    }

    const success = (result) => {
      const fileId = getChosenPath(result);
      if (!fileId) return;
      const index = (this.data.contentImages || []).length;
      const imageInput = {
        imageId: createImageId(index),
        fileId,
        label: `照片 ${index + 1}`,
        sortOrder: index,
        itemCount: 0,
        analyzeStatus: 'analyzing'
      };
      this.showRecognizingLayer('这张照片会加入当前容器清单。');
      const handleProgress = (progress) => this.updateRecognizingProgress(progress);
      const persistOriginal = imageStore.persistImage(fileId, 'find-things/content');
      const persistThumbnail = imageStore.persistThumbnail(fileId, 'find-things/thumbs');
      const analyzePrepared = imageStore.prepareImageForAnalyze(fileId)
        .then((analyzePath) => ai.analyzeImage({
          imagePath: analyzePath,
          allowMockFallback: false,
          onProgress: handleProgress
        }));

      Promise.all([persistOriginal, persistThumbnail, analyzePrepared])
        .then(([storedPath, thumbPath, analyzed]) => {
          imageInput.fileId = storedPath;
          imageInput.thumbFileId = thumbPath || '';
          Object.assign(imageInput, createImageMetadata({
            chooseResult: result,
            imageMetadata: analyzed.imageMetadata
          }));
          if (typeof storage.addContentImageAsync === 'function') {
            return storage.addContentImageAsync(this.data.container._id, imageInput).then((savedImage) => {
              const image = pickAddedContentImage(savedImage, imageInput, index);
              const items = withDisplayIndexes(analyzed.items || []).map((item) => Object.assign({}, item, {
                sourceImageId: image.imageId,
                sourceImageFileId: image.fileId
              }));
              if (typeof storage.replaceItemsForImageAsync === 'function') {
                return storage.replaceItemsForImageAsync(this.data.container._id, image.imageId, items);
              }
              if (typeof storage.replaceItemsForImage === 'function') {
                storage.replaceItemsForImage(this.data.container._id, image.imageId, items);
              }
              return null;
            }).then(() => {
              wx.showToast({ title: '已添加照片', icon: 'success' });
              this.load();
              this.syncCurrentImage(index);
            });
          }
          if (typeof storage.addContentImage === 'function') {
            const savedImage = storage.addContentImage(this.data.container._id, imageInput);
            const image = pickAddedContentImage(savedImage, imageInput, index);
            const items = withDisplayIndexes(analyzed.items || []).map((item) => Object.assign({}, item, {
              sourceImageId: image.imageId,
              sourceImageFileId: image.fileId
            }));
            if (typeof storage.replaceItemsForImage === 'function') {
              storage.replaceItemsForImage(this.data.container._id, image.imageId, items);
            }
            wx.showToast({ title: '已添加照片', icon: 'success' });
            this.load();
            this.syncCurrentImage(index);
            return;
          }

          wx.showToast({ title: '数据层同步中，暂未保存', icon: 'none' });
        })
        .catch((error) => {
          wx.showModal({
            title: '小懒暂时没看清',
            content: error && error.message ? error.message : '请检查识别服务配置、合法域名和网络后重试。',
            showCancel: false,
            confirmColor: '#1f6048'
          });
        })
        .finally(() => {
          this.setData({ recognizing: false });
        });
    };

    const openPicker = () => {
      if (wx.chooseMedia) {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sizeType: ['compressed'],
          sourceType: ['camera', 'album'],
          success
        });
        return;
      }
      wx.chooseImage({ count: 1, sizeType: ['compressed'], sourceType: ['camera', 'album'], success });
    };

    Promise.resolve()
      .then(() => ai.getUsageStatus())
      .then((status) => {
        if (status && status.canAnalyze === false) {
          showUsageLimit(status);
          return;
        }
        openPicker();
      })
      .catch(() => openPicker());
  },

  showRecognizingLayer(descText) {
    this.setData({
      recognizing: true,
      recognizingDescText: descText || '小懒正在认真扒拉照片，稍等一下下。',
      recognizingHintText: '这会儿适合眨眨眼，别和小懒一起紧张。',
      recognizingProgressCount: 0,
      recognizingProgressText: '正在找线索',
      recognizingProgressStateText: '快啦'
    });
  },

  updateRecognizingProgress(progress) {
    const count = Number(progress && progress.recognizedItemCount) || 0;
    if (count <= 0) return;
    console.log('[ftAnalyzeImage:page_progress]', {
      recognizedItemCount: count
    });
    this.setData({
      recognizingDescText: `小懒已经认出来 ${count} 件物品了。`,
      recognizingHintText: `小懒已经认出来 ${count} 件物品了，正在继续扒拉细节。`,
      recognizingProgressCount: count,
      recognizingProgressText: `已认出 ${count} 件`,
      recognizingProgressStateText: `${count} 件`
    });
  },

  deleteContainer() {
    if (!this.data.container || !this.data.container._id) return;

    wx.showModal({
      title: '删除容器',
      content: `确定删除「${this.data.container.name || '这个容器'}」吗？删除后，本地搜索不会再显示这个容器里的物品。`,
      confirmText: '删除',
      confirmColor: '#a33b2f',
      success: (result) => {
        if (!result.confirm) return;
        const runDelete = typeof storage.deleteContainerAsync === 'function'
          ? storage.deleteContainerAsync(this.data.container._id)
          : Promise.resolve(storage.deleteContainer(this.data.container._id));
        runDelete
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            navigateHome();
          })
          .catch((error) => {
            wx.showToast({
              title: error && error.message ? error.message : '数据同步失败',
              icon: 'none'
            });
          });
      }
    });
  },

  goHome() {
    switchSection(HOME_URL);
  },

  goSearch() {
    switchSection(SEARCH_URL);
  }
});
